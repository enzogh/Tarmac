package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math"
	"net/url"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/gorilla/websocket"
)

type heartbeat struct {
	NodeID  string        `json:"nodeId"`
	Metrics metricState   `json:"metrics"`
	Overlay *overlayState `json:"overlay,omitempty"`
}

type overlayState struct {
	PublicKey  string `json:"publicKey"`
	Endpoint   string `json:"endpoint"`
	ListenPort int    `json:"listenPort"`
}

type metricState struct {
	CPU       float64 `json:"cpu"`
	RAM       float64 `json:"ram"`
	Disk      float64 `json:"disk"`
	NetworkRx float64 `json:"networkRx"`
	NetworkTx float64 `json:"networkTx"`
	IORead    float64 `json:"ioRead"`
	IOWrite   float64 `json:"ioWrite"`
}

type diskState struct {
	Name       string `json:"name"`
	MountPath  string `json:"mountPath"`
	Type       string `json:"type"`
	Health     string `json:"health"`
	CapacityGb int    `json:"capacityGb"`
	UsedGb     int    `json:"usedGb"`
}

type smartState struct {
	DiskName           string `json:"diskName"`
	TemperatureC       int    `json:"temperatureC"`
	ReallocatedSectors int    `json:"reallocatedSectors"`
	PendingSectors     int    `json:"pendingSectors"`
	PowerOnHours       int    `json:"powerOnHours"`
	Overall            string `json:"overall"`
}

type stateReport struct {
	NodeID       string       `json:"nodeId"`
	Disks        []diskState  `json:"disks"`
	SmartReports []smartState `json:"smartReports"`
}

type envelope struct {
	Type    string      `json:"type"`
	Payload interface{} `json:"payload,omitempty"`
}

type commandPayload struct {
	Type    string                 `json:"type"`
	Payload map[string]interface{} `json:"payload"`
}

type commandResult struct {
	Command      string `json:"command"`
	ResourceType string `json:"resourceType"`
	ResourceID   string `json:"resourceId"`
	Success      bool   `json:"success"`
	Message      string `json:"message,omitempty"`
}

func envOrDefault(key, fallback string) string {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}
	return value
}

type wsClient struct {
	conn *websocket.Conn
	mu   sync.Mutex
}

func (c *wsClient) send(v interface{}) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.conn.WriteJSON(v)
}

type cpuSnapshot struct {
	idle  uint64
	total uint64
}

type netSnapshot struct {
	rx    uint64
	tx    uint64
	at    time.Time
	valid bool
}

type ioSnapshot struct {
	read  uint64
	write uint64
	at    time.Time
	valid bool
}

type collector struct {
	lastCPU cpuSnapshot
	lastNet netSnapshot
	lastIO  ioSnapshot
}

func round2(v float64) float64 {
	return math.Round(v*100) / 100
}

func readCPUUsage(prev cpuSnapshot) (float64, cpuSnapshot, error) {
	content, err := os.ReadFile("/proc/stat")
	if err != nil {
		return 0, prev, err
	}
	scanner := bufio.NewScanner(bytes.NewReader(content))
	if !scanner.Scan() {
		return 0, prev, errors.New("missing cpu line")
	}
	parts := strings.Fields(scanner.Text())
	if len(parts) < 8 || parts[0] != "cpu" {
		return 0, prev, errors.New("invalid cpu line")
	}
	values := make([]uint64, 0, len(parts)-1)
	for _, p := range parts[1:] {
		v, parseErr := strconv.ParseUint(p, 10, 64)
		if parseErr != nil {
			return 0, prev, parseErr
		}
		values = append(values, v)
	}
	idle := values[3] + values[4]
	var total uint64
	for _, v := range values {
		total += v
	}
	current := cpuSnapshot{idle: idle, total: total}
	if prev.total == 0 || current.total <= prev.total {
		return 0, current, nil
	}
	totalDelta := float64(current.total - prev.total)
	idleDelta := float64(current.idle - prev.idle)
	usage := 100 * (1 - idleDelta/totalDelta)
	if usage < 0 {
		usage = 0
	}
	if usage > 100 {
		usage = 100
	}
	return round2(usage), current, nil
}

func readRAMUsage() (float64, error) {
	content, err := os.ReadFile("/proc/meminfo")
	if err != nil {
		return 0, err
	}
	var total, available float64
	scanner := bufio.NewScanner(bytes.NewReader(content))
	for scanner.Scan() {
		fields := strings.Fields(scanner.Text())
		if len(fields) < 2 {
			continue
		}
		switch fields[0] {
		case "MemTotal:":
			v, parseErr := strconv.ParseFloat(fields[1], 64)
			if parseErr == nil {
				total = v
			}
		case "MemAvailable:":
			v, parseErr := strconv.ParseFloat(fields[1], 64)
			if parseErr == nil {
				available = v
			}
		}
	}
	if total <= 0 {
		return 0, errors.New("invalid meminfo total")
	}
	usedRatio := ((total - available) / total) * 100
	if usedRatio < 0 {
		usedRatio = 0
	}
	if usedRatio > 100 {
		usedRatio = 100
	}
	return round2(usedRatio), nil
}

func readNetBytes() (uint64, uint64, error) {
	content, err := os.ReadFile("/proc/net/dev")
	if err != nil {
		return 0, 0, err
	}
	var rxTotal uint64
	var txTotal uint64
	scanner := bufio.NewScanner(bytes.NewReader(content))
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if !strings.Contains(line, ":") {
			continue
		}
		parts := strings.SplitN(line, ":", 2)
		if len(parts) != 2 {
			continue
		}
		iface := strings.TrimSpace(parts[0])
		if strings.HasPrefix(iface, "lo") || strings.HasPrefix(iface, "docker") || strings.HasPrefix(iface, "veth") || strings.HasPrefix(iface, "br-") {
			continue
		}
		fields := strings.Fields(parts[1])
		if len(fields) < 16 {
			continue
		}
		rx, rxErr := strconv.ParseUint(fields[0], 10, 64)
		tx, txErr := strconv.ParseUint(fields[8], 10, 64)
		if rxErr != nil || txErr != nil {
			continue
		}
		rxTotal += rx
		txTotal += tx
	}
	return rxTotal, txTotal, nil
}

func readDiskBytes() (uint64, uint64, error) {
	content, err := os.ReadFile("/proc/diskstats")
	if err != nil {
		return 0, 0, err
	}
	var readSectors uint64
	var writeSectors uint64
	scanner := bufio.NewScanner(bytes.NewReader(content))
	for scanner.Scan() {
		fields := strings.Fields(scanner.Text())
		if len(fields) < 14 {
			continue
		}
		device := fields[2]
		if strings.HasPrefix(device, "loop") || strings.HasPrefix(device, "ram") || strings.HasPrefix(device, "dm-") {
			continue
		}
		readV, readErr := strconv.ParseUint(fields[5], 10, 64)
		writeV, writeErr := strconv.ParseUint(fields[9], 10, 64)
		if readErr != nil || writeErr != nil {
			continue
		}
		readSectors += readV
		writeSectors += writeV
	}
	const sectorSize = 512
	return readSectors * sectorSize, writeSectors * sectorSize, nil
}

func rateBytesPerSecond(prevValue, currentValue uint64, prevAt, now time.Time) float64 {
	if now.Before(prevAt) || currentValue < prevValue {
		return 0
	}
	seconds := now.Sub(prevAt).Seconds()
	if seconds <= 0 {
		return 0
	}
	return round2(float64(currentValue-prevValue) / seconds)
}

func (c *collector) collectMetrics(disks []diskState) metricState {
	var cpu float64
	if usage, next, err := readCPUUsage(c.lastCPU); err == nil {
		cpu = usage
		c.lastCPU = next
	}

	var ram float64
	if usage, err := readRAMUsage(); err == nil {
		ram = usage
	}

	totalCapacity := 0
	totalUsed := 0
	for _, disk := range disks {
		totalCapacity += disk.CapacityGb
		totalUsed += disk.UsedGb
	}
	diskUsage := 0.0
	if totalCapacity > 0 {
		diskUsage = round2((float64(totalUsed) / float64(totalCapacity)) * 100)
	}

	now := time.Now()
	var networkRx float64
	var networkTx float64
	if rx, tx, err := readNetBytes(); err == nil {
		if c.lastNet.valid {
			networkRx = rateBytesPerSecond(c.lastNet.rx, rx, c.lastNet.at, now)
			networkTx = rateBytesPerSecond(c.lastNet.tx, tx, c.lastNet.at, now)
		}
		c.lastNet = netSnapshot{rx: rx, tx: tx, at: now, valid: true}
	}

	var ioRead float64
	var ioWrite float64
	if readBytes, writeBytes, err := readDiskBytes(); err == nil {
		if c.lastIO.valid {
			ioRead = rateBytesPerSecond(c.lastIO.read, readBytes, c.lastIO.at, now)
			ioWrite = rateBytesPerSecond(c.lastIO.write, writeBytes, c.lastIO.at, now)
		}
		c.lastIO = ioSnapshot{read: readBytes, write: writeBytes, at: now, valid: true}
	}

	return metricState{
		CPU:       cpu,
		RAM:       ram,
		Disk:      diskUsage,
		NetworkRx: networkRx,
		NetworkTx: networkTx,
		IORead:    ioRead,
		IOWrite:   ioWrite,
	}
}

func isVirtualFs(fsType string) bool {
	virtual := map[string]struct{}{
		"proc": {}, "sysfs": {}, "tmpfs": {}, "devtmpfs": {}, "devpts": {}, "overlay": {},
		"squashfs": {}, "cgroup": {}, "cgroup2": {}, "pstore": {}, "securityfs": {}, "debugfs": {},
		"tracefs": {}, "fusectl": {}, "autofs": {}, "mqueue": {}, "hugetlbfs": {}, "rpc_pipefs": {},
		"binfmt_misc": {}, "configfs": {},
	}
	_, ok := virtual[fsType]
	return ok
}

func inferDiskType(device string) string {
	base := filepath.Base(device)
	base = strings.TrimRight(base, "0123456789")
	base = strings.TrimSuffix(base, "p")
	if strings.HasPrefix(base, "nvme") {
		return "nvme"
	}

	rotPath := filepath.Join("/sys/block", base, "queue/rotational")
	rotValue, err := os.ReadFile(rotPath)
	if err == nil {
		switch strings.TrimSpace(string(rotValue)) {
		case "0":
			return "ssd"
		case "1":
			return "hdd"
		}
	}
	return "hdd"
}

func collectDisks() []diskState {
	mountsContent, err := os.ReadFile("/proc/mounts")
	if err != nil {
		return nil
	}
	seen := make(map[string]struct{})
	disks := make([]diskState, 0)

	scanner := bufio.NewScanner(bytes.NewReader(mountsContent))
	for scanner.Scan() {
		fields := strings.Fields(scanner.Text())
		if len(fields) < 3 {
			continue
		}
		device := fields[0]
		mountPath := fields[1]
		fsType := fields[2]
		if isVirtualFs(fsType) {
			continue
		}
		if strings.HasPrefix(device, "tmpfs") || strings.HasPrefix(device, "none") {
			continue
		}
		if _, ok := seen[mountPath]; ok {
			continue
		}
		seen[mountPath] = struct{}{}

		var stat syscall.Statfs_t
		if err := syscall.Statfs(mountPath, &stat); err != nil || stat.Blocks == 0 {
			continue
		}
		capacityBytes := stat.Blocks * uint64(stat.Bsize)
		availableBytes := stat.Bavail * uint64(stat.Bsize)
		usedBytes := capacityBytes - availableBytes

		capacityGb := int(capacityBytes / (1024 * 1024 * 1024))
		usedGb := int(usedBytes / (1024 * 1024 * 1024))
		if capacityGb <= 0 {
			continue
		}

		disks = append(disks, diskState{
			Name:       filepath.Base(device),
			MountPath:  mountPath,
			Type:       inferDiskType(device),
			Health:     "unknown",
			CapacityGb: capacityGb,
			UsedGb:     usedGb,
		})
	}

	sort.Slice(disks, func(i, j int) bool {
		return disks[i].MountPath < disks[j].MountPath
	})
	return disks
}

func buildStateReport(nodeID string) stateReport {
	return stateReport{
		NodeID:       nodeID,
		Disks:        collectDisks(),
		SmartReports: []smartState{},
	}
}

func readString(payload map[string]interface{}, key string) string {
	raw, ok := payload[key]
	if !ok {
		return ""
	}
	value, ok := raw.(string)
	if !ok {
		return ""
	}
	return strings.TrimSpace(value)
}

func readStringSlice(payload map[string]interface{}, key string) []string {
	raw, ok := payload[key]
	if !ok {
		return nil
	}
	entries, ok := raw.([]interface{})
	if !ok {
		return nil
	}
	result := make([]string, 0, len(entries))
	for _, entry := range entries {
		strEntry, ok := entry.(string)
		if !ok {
			continue
		}
		strEntry = strings.TrimSpace(strEntry)
		if strEntry != "" {
			result = append(result, strEntry)
		}
	}
	return result
}

func readInt(payload map[string]interface{}, key string, fallback int) int {
	raw, ok := payload[key]
	if !ok {
		return fallback
	}
	switch value := raw.(type) {
	case float64:
		return int(value)
	case float32:
		return int(value)
	case int:
		return value
	case int64:
		return int(value)
	case string:
		parsed, err := strconv.Atoi(strings.TrimSpace(value))
		if err == nil {
			return parsed
		}
	}
	return fallback
}

type overlayPeer struct {
	publicKey           string
	endpoint            string
	allowedIPs          []string
	persistentKeepalive int
}

type overlayIdentity struct {
	publicKey      string
	endpoint       string
	listenPort     int
	privateKeyPath string
}

func commandExists(name string) bool {
	_, err := exec.LookPath(name)
	return err == nil
}

func ensureOverlayIdentity() (*overlayIdentity, error) {
	if !commandExists("wg") || !commandExists("ip") {
		return nil, errors.New("wireguard tools not found (install wireguard-tools and iproute2)")
	}

	listenPort := 51820
	if rawPort := strings.TrimSpace(os.Getenv("AGENT_OVERLAY_PORT")); rawPort != "" {
		parsed, err := strconv.Atoi(rawPort)
		if err == nil && parsed > 0 {
			listenPort = parsed
		}
	}

	privateKeyPath := envOrDefault("AGENT_OVERLAY_PRIVATE_KEY_PATH", "/var/lib/tarmac-agent/wireguard/privatekey")
	privateKeyDir := filepath.Dir(privateKeyPath)
	if err := os.MkdirAll(privateKeyDir, 0o700); err != nil {
		return nil, fmt.Errorf("cannot create wireguard key directory: %w", err)
	}

	privateKeyRaw, err := os.ReadFile(privateKeyPath)
	if err != nil {
		if !errors.Is(err, os.ErrNotExist) {
			return nil, fmt.Errorf("cannot read private key: %w", err)
		}
		gen := exec.Command("wg", "genkey")
		generated, genErr := gen.Output()
		if genErr != nil {
			return nil, fmt.Errorf("cannot generate private key: %w", genErr)
		}
		privateKeyRaw = bytes.TrimSpace(generated)
		if err := os.WriteFile(privateKeyPath, append(privateKeyRaw, '\n'), 0o600); err != nil {
			return nil, fmt.Errorf("cannot write private key: %w", err)
		}
	}
	privateKey := strings.TrimSpace(string(privateKeyRaw))
	if privateKey == "" {
		return nil, errors.New("generated private key is empty")
	}

	pubCmd := exec.Command("wg", "pubkey")
	pubCmd.Stdin = strings.NewReader(privateKey)
	pubOut, pubErr := pubCmd.Output()
	if pubErr != nil {
		return nil, fmt.Errorf("cannot derive public key: %w", pubErr)
	}
	publicKey := strings.TrimSpace(string(pubOut))
	if publicKey == "" {
		return nil, errors.New("derived public key is empty")
	}

	endpoint := strings.TrimSpace(os.Getenv("AGENT_OVERLAY_ENDPOINT"))
	if endpoint == "" {
		ipCmd := exec.Command("sh", "-lc", "ip -4 route get 1.1.1.1 | awk '{for(i=1;i<=NF;i++){if($i==\"src\"){print $(i+1); exit}}}'")
		ipOut, ipErr := ipCmd.Output()
		if ipErr == nil {
			ipValue := strings.TrimSpace(string(ipOut))
			if ipValue != "" {
				endpoint = fmt.Sprintf("%s:%d", ipValue, listenPort)
			}
		}
	}

	return &overlayIdentity{
		publicKey:      publicKey,
		endpoint:       endpoint,
		listenPort:     listenPort,
		privateKeyPath: privateKeyPath,
	}, nil
}

func parseOverlayPeers(payload map[string]interface{}) []overlayPeer {
	rawPeers, ok := payload["peers"]
	if !ok {
		return nil
	}
	entries, ok := rawPeers.([]interface{})
	if !ok {
		return nil
	}

	peers := make([]overlayPeer, 0, len(entries))
	for _, entry := range entries {
		record, ok := entry.(map[string]interface{})
		if !ok {
			continue
		}
		publicKey := strings.TrimSpace(readString(record, "publicKey"))
		if publicKey == "" {
			continue
		}
		allowedIPs := readStringSlice(record, "allowedIps")
		if len(allowedIPs) == 0 {
			continue
		}
		peer := overlayPeer{
			publicKey:           publicKey,
			endpoint:            strings.TrimSpace(readString(record, "endpoint")),
			allowedIPs:          allowedIPs,
			persistentKeepalive: readInt(record, "persistentKeepalive", 25),
		}
		peers = append(peers, peer)
	}
	return peers
}

func applyOverlay(payload map[string]interface{}) (string, error) {
	if !commandExists("wg") || !commandExists("ip") {
		return "", errors.New("wireguard tools missing (install wireguard-tools and iproute2)")
	}

	identity, err := ensureOverlayIdentity()
	if err != nil {
		return "", err
	}

	iface := readString(payload, "interfaceName")
	if iface == "" {
		iface = "tarmacwg0"
	}
	addressCidr := readString(payload, "addressCidr")
	listenPort := readInt(payload, "listenPort", identity.listenPort)
	peers := parseOverlayPeers(payload)

	if exec.Command("ip", "link", "show", iface).Run() != nil {
		if out, err := exec.Command("ip", "link", "add", "dev", iface, "type", "wireguard").CombinedOutput(); err != nil {
			return "", fmt.Errorf("cannot create wireguard interface: %s", strings.TrimSpace(string(out)))
		}
	}

	setArgs := []string{"set", iface, "private-key", identity.privateKeyPath, "listen-port", strconv.Itoa(listenPort)}
	if out, err := exec.Command("wg", setArgs...).CombinedOutput(); err != nil {
		return "", fmt.Errorf("cannot configure wireguard interface: %s", strings.TrimSpace(string(out)))
	}

	if strings.TrimSpace(addressCidr) != "" {
		// Clean old addresses first
		exec.Command("ip", "address", "flush", "dev", iface).CombinedOutput()
		
		if out, err := exec.Command("ip", "address", "add", addressCidr, "dev", iface).CombinedOutput(); err != nil {
			return "", fmt.Errorf("cannot assign interface address: %s", strings.TrimSpace(string(out)))
		}
	}

	if out, err := exec.Command("ip", "link", "set", "up", "dev", iface).CombinedOutput(); err != nil {
		return "", fmt.Errorf("cannot bring interface up: %s", strings.TrimSpace(string(out)))
	}

	currentRaw, _ := exec.Command("wg", "show", iface, "peers").Output()
	currentPeers := strings.Fields(string(currentRaw))
	desired := make(map[string]struct{}, len(peers))
	for _, peer := range peers {
		desired[peer.publicKey] = struct{}{}
	}
	for _, existing := range currentPeers {
		if _, keep := desired[existing]; keep {
			continue
		}
		_, _ = exec.Command("wg", "set", iface, "peer", existing, "remove").CombinedOutput()
	}

	for _, peer := range peers {
		args := []string{"set", iface, "peer", peer.publicKey, "allowed-ips", strings.Join(peer.allowedIPs, ",")}
		if peer.endpoint != "" {
			args = append(args, "endpoint", peer.endpoint)
		}
		if peer.persistentKeepalive > 0 {
			args = append(args, "persistent-keepalive", strconv.Itoa(peer.persistentKeepalive))
		}
		if out, err := exec.Command("wg", args...).CombinedOutput(); err != nil {
			return "", fmt.Errorf("cannot configure peer %s: %s", peer.publicKey, strings.TrimSpace(string(out)))
		}
	}

	return fmt.Sprintf("overlay applied on %s with %d peers", iface, len(peers)), nil
}

func isTargetMounted(target string) (string, bool) {
	cmd := exec.Command("findmnt", "--noheadings", "--output", "SOURCE", "--target", target)
	output, err := cmd.Output()
	if err != nil {
		return "", false
	}
	source := strings.TrimSpace(string(output))
	return source, source != ""
}

func applyMount(payload map[string]interface{}) (string, error) {
	source := readString(payload, "sourcePath")
	target := readString(payload, "targetPath")
	if source == "" || target == "" {
		return "", errors.New("mount payload must include sourcePath and targetPath")
	}

	fsType := readString(payload, "fsType")
	if fsType == "" {
		fsType = "nfs"
	}
	options := readString(payload, "mountOptions")

	sources := []string{source}
	sources = append(sources, readStringSlice(payload, "additionalSources")...)
	filtered := make([]string, 0, len(sources))
	seen := make(map[string]struct{})
	for _, entry := range sources {
		entry = strings.TrimSpace(entry)
		if entry == "" {
			continue
		}
		if _, ok := seen[entry]; ok {
			continue
		}
		seen[entry] = struct{}{}
		filtered = append(filtered, entry)
	}
	if len(filtered) == 0 {
		return "", errors.New("no mount source provided")
	}

	if err := os.MkdirAll(target, 0o755); err != nil {
		return "", fmt.Errorf("cannot create target path: %w", err)
	}

	if currentSource, mounted := isTargetMounted(target); mounted {
		for _, entry := range filtered {
			if entry == currentSource {
				return fmt.Sprintf("already mounted (%s -> %s)", currentSource, target), nil
			}
		}
		return "", fmt.Errorf("target path already mounted from %s", currentSource)
	}

	if fsType == "nfs" && !commandExists("mount.nfs") {
		return "", errors.New("mount.nfs not found (install nfs-common)")
	}
	if fsType == "cifs" && !commandExists("mount.cifs") {
		return "", errors.New("mount.cifs not found (install cifs-utils)")
	}

	var attempts []string
	for _, candidate := range filtered {
		args := make([]string, 0, 8)
		if fsType != "" {
			args = append(args, "-t", fsType)
		}
		if options != "" {
			args = append(args, "-o", options)
		}
		args = append(args, candidate, target)

		cmd := exec.Command("mount", args...)
		output, err := cmd.CombinedOutput()
		if err == nil {
			return fmt.Sprintf("mounted %s on %s", candidate, target), nil
		}
		attempts = append(attempts, fmt.Sprintf("%s: %s", candidate, strings.TrimSpace(string(output))))
	}

	return "", fmt.Errorf("mount failed: %s", strings.Join(attempts, " | "))
}

func handleCommand(cmd commandPayload) commandResult {
	result := commandResult{Success: true, Message: "ok"}
	switch cmd.Type {
	case "command.apply_export":
		result.Command = "apply_export"
		result.ResourceType = "share"
		result.ResourceID = readString(cmd.Payload, "shareId")
		result.Message = "export apply simulated"
	case "command.apply_mount":
		result.Command = "apply_mount"
		result.ResourceType = "mount"
		result.ResourceID = readString(cmd.Payload, "mountId")
		message, err := applyMount(cmd.Payload)
		if err != nil {
			result.Success = false
			result.Message = err.Error()
		} else {
			result.Message = message
		}
	case "command.apply_pool":
		result.Command = "apply_pool"
		result.ResourceType = "pool_member"
		poolID := readString(cmd.Payload, "poolId")
		nodeID := readString(cmd.Payload, "nodeId")
		result.ResourceID = fmt.Sprintf("%s:%s", poolID, nodeID)
		result.Message = "pool apply simulated"
	case "command.run_rsync":
		result.Command = "run_rsync"
		result.ResourceType = "sync_job_run"
		result.ResourceID = readString(cmd.Payload, "runId")
		result.Message = "rsync simulated"
	case "command.apply_overlay":
		result.Command = "apply_overlay"
		result.ResourceType = "overlay"
		result.ResourceID = readString(cmd.Payload, "interfaceName")
		if result.ResourceID == "" {
			result.ResourceID = "tarmacwg0"
		}
		message, err := applyOverlay(cmd.Payload)
		if err != nil {
			result.Success = false
			result.Message = err.Error()
		} else {
			result.Message = message
		}
	default:
		result.Success = false
		result.Message = fmt.Sprintf("unknown command %s", cmd.Type)
	}
	return result
}

func runSession(ctx context.Context, wsURL string, nodeID string) error {
	log.Printf("connecting to %s", wsURL)
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		return err
	}
	defer conn.Close()

	client := &wsClient{conn: conn}
	c := &collector{}
	var overlay *overlayState
	if identity, err := ensureOverlayIdentity(); err == nil {
		overlay = &overlayState{
			PublicKey:  identity.publicKey,
			Endpoint:   identity.endpoint,
			ListenPort: identity.listenPort,
		}
	} else {
		log.Printf("overlay identity unavailable: %v", err)
	}

	readDone := make(chan error, 1)
	go func() {
		for {
			var msg envelope
			if err := conn.ReadJSON(&msg); err != nil {
				readDone <- err
				return
			}
			if msg.Type != "command" {
				continue
			}
			raw, _ := json.Marshal(msg.Payload)
			var cmd commandPayload
			if err := json.Unmarshal(raw, &cmd); err != nil {
				continue
			}
			result := handleCommand(cmd)
			if err := client.send(envelope{Type: "command_result", Payload: result}); err != nil {
				readDone <- err
				return
			}
		}
	}()

	sendReport := func() error {
		report := buildStateReport(nodeID)
		metrics := c.collectMetrics(report.Disks)
		if err := client.send(envelope{
			Type: "agent.heartbeat",
			Payload: heartbeat{
				NodeID:  nodeID,
				Metrics: metrics,
				Overlay: overlay,
			},
		}); err != nil {
			return err
		}
		return client.send(envelope{
			Type:    "agent.state_report",
			Payload: report,
		})
	}

	heartbeatTicker := time.NewTicker(5 * time.Second)
	stateTicker := time.NewTicker(20 * time.Second)
	defer heartbeatTicker.Stop()
	defer stateTicker.Stop()

	if err := sendReport(); err != nil {
		return err
	}

	for {
		select {
		case <-ctx.Done():
			client.mu.Lock()
			_ = conn.WriteMessage(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.CloseNormalClosure, "shutdown"))
			client.mu.Unlock()
			return nil
		case err := <-readDone:
			return err
		case <-heartbeatTicker.C:
			disks := collectDisks()
			metrics := c.collectMetrics(disks)
			if err := client.send(envelope{
				Type: "agent.heartbeat",
				Payload: heartbeat{
					NodeID:  nodeID,
					Metrics: metrics,
					Overlay: overlay,
				},
			}); err != nil {
				return err
			}
		case <-stateTicker.C:
			if err := client.send(envelope{
				Type:    "agent.state_report",
				Payload: buildStateReport(nodeID),
			}); err != nil {
				return err
			}
		}
	}
}

func main() {
	controlPlane := envOrDefault("CONTROL_PLANE_WS", "ws://localhost:3001/agents-ws")
	token := envOrDefault("AGENT_TOKEN", "agent-secret")
	nodeID := envOrDefault("NODE_ID", "node-local")

	u, err := url.Parse(controlPlane)
	if err != nil {
		log.Fatalf("invalid CONTROL_PLANE_WS: %v", err)
	}
	q := u.Query()
	q.Set("token", token)
	q.Set("nodeId", nodeID)
	u.RawQuery = q.Encode()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	interrupt := make(chan os.Signal, 1)
	signal.Notify(interrupt, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-interrupt
		cancel()
	}()

	backoff := 2 * time.Second
	for {
		select {
		case <-ctx.Done():
			return
		default:
			err := runSession(ctx, u.String(), nodeID)
			if err == nil || ctx.Err() != nil {
				return
			}
			log.Printf("connection dropped: %v", err)
			time.Sleep(backoff)
			if backoff < 30*time.Second {
				backoff *= 2
			}
		}
	}
}
