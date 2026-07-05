package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"math"
	"net"
	"net/url"
	"os"
	"os/exec"
	"os/signal"
	"os/user"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/gorilla/websocket"
)

type heartbeat struct {
	NodeID      string              `json:"nodeId"`
	Metrics     metricState         `json:"metrics"`
	Overlay     *overlayState       `json:"overlay,omitempty"`
	LinkMetrics []overlayLinkMetric `json:"linkMetrics,omitempty"`
}

type overlayState struct {
	PublicKey    string `json:"publicKey,omitempty"`
	Endpoint     string `json:"endpoint,omitempty"`
	ListenPort   int    `json:"listenPort,omitempty"`
	SSHPublicKey string `json:"sshPublicKey,omitempty"`
	SSHUser      string `json:"sshUser,omitempty"`
}

type overlayLinkMetric struct {
	TargetPublicKey string   `json:"targetPublicKey"`
	TargetVlanIP    string   `json:"targetVlanIp,omitempty"`
	HandshakeAgeSec *int64   `json:"handshakeAgeSec,omitempty"`
	TxMbps          float64  `json:"txMbps"`
	RxMbps          float64  `json:"rxMbps"`
	LatencyMs       *float64 `json:"latencyMs,omitempty"`
	PacketLoss      *float64 `json:"packetLoss,omitempty"`
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
	Data         any    `json:"data,omitempty"`
}

type commandProgress struct {
	Command      string `json:"command"`
	ResourceType string `json:"resourceType"`
	ResourceID   string `json:"resourceId"`
	Progress     int    `json:"progress"`
	Message      string `json:"message,omitempty"`
}

type directoryListData struct {
	BasePath    string   `json:"basePath"`
	Directories []string `json:"directories"`
}

type directorySizeEntry struct {
	Path      string `json:"path"`
	SizeBytes int64  `json:"sizeBytes"`
}

type directoryScanData struct {
	BasePath  string               `json:"basePath"`
	Entries   []directorySizeEntry `json:"entries"`
	Truncated bool                 `json:"truncated"`
}

var rsyncExecutions = struct {
	mu    sync.Mutex
	byKey map[string]context.CancelFunc
}{
	byKey: make(map[string]context.CancelFunc),
}

func rsyncExecutionKey(resourceType, resourceID string) string {
	resourceType = strings.TrimSpace(resourceType)
	resourceID = strings.TrimSpace(resourceID)
	if resourceType == "" || resourceID == "" {
		return ""
	}
	return resourceType + ":" + resourceID
}

func registerRsyncExecution(key string, cancel context.CancelFunc) {
	rsyncExecutions.mu.Lock()
	defer rsyncExecutions.mu.Unlock()
	rsyncExecutions.byKey[key] = cancel
}

func unregisterRsyncExecution(key string) {
	rsyncExecutions.mu.Lock()
	defer rsyncExecutions.mu.Unlock()
	delete(rsyncExecutions.byKey, key)
}

func stopRsyncExecution(resourceType, resourceID string) bool {
	key := rsyncExecutionKey(resourceType, resourceID)
	if key == "" {
		return false
	}

	rsyncExecutions.mu.Lock()
	cancel, ok := rsyncExecutions.byKey[key]
	rsyncExecutions.mu.Unlock()
	if !ok {
		return false
	}

	cancel()
	return true
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

type overlayTrafficSnapshot struct {
	rxBytes uint64
	txBytes uint64
	at      time.Time
}

type overlayProbeSnapshot struct {
	latencyMs  float64
	packetLoss float64
	hasLatency bool
	hasLoss    bool
	at         time.Time
}

type collector struct {
	lastCPU        cpuSnapshot
	lastNet        netSnapshot
	lastIO         ioSnapshot
	lastOverlay    map[string]overlayTrafficSnapshot
	lastOverlayRtt map[string]overlayProbeSnapshot
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

func firstAllowedIP(allowed string) string {
	parts := strings.Split(allowed, ",")
	for _, part := range parts {
		candidate := strings.TrimSpace(part)
		if candidate == "" {
			continue
		}
		if strings.Contains(candidate, "/") {
			candidate = strings.SplitN(candidate, "/", 2)[0]
		}
		if candidate != "" && net.ParseIP(candidate) != nil {
			return candidate
		}
	}
	return ""
}

func parsePingStats(output string) (*float64, *float64) {
	var latencyMs *float64
	var packetLoss *float64
	for _, line := range strings.Split(output, "\n") {
		trimmed := strings.TrimSpace(line)
		if strings.Contains(trimmed, "packet loss") {
			chunks := strings.Split(trimmed, ",")
			for _, chunk := range chunks {
				value := strings.TrimSpace(chunk)
				if !strings.Contains(value, "packet loss") || !strings.Contains(value, "%") {
					continue
				}
				raw := strings.TrimSpace(strings.Split(value, "%")[0])
				fields := strings.Fields(raw)
				if len(fields) > 0 {
					if parsed, err := strconv.ParseFloat(fields[len(fields)-1], 64); err == nil {
						packetLoss = &parsed
					}
				}
			}
		}
		if strings.Contains(trimmed, "min/avg/max") && strings.Contains(trimmed, "=") {
			stats := strings.TrimSpace(strings.SplitN(trimmed, "=", 2)[1])
			values := strings.Split(stats, "/")
			if len(values) >= 2 {
				avgRaw := strings.TrimSpace(values[1])
				if parsed, err := strconv.ParseFloat(avgRaw, 64); err == nil {
					latencyMs = &parsed
				}
			}
		}
	}
	return latencyMs, packetLoss
}

func probeOverlayLatency(iface, targetIP string) (*float64, *float64) {
	if targetIP == "" || !commandExists("ping") {
		return nil, nil
	}

	// Try without forcing interface first (kernel routing already prefers WG route).
	commands := [][]string{
		{"-c", "2", "-W", "1", targetIP},
		{"-I", iface, "-c", "2", "-W", "1", targetIP},
	}
	var fallbackLatency *float64
	var fallbackLoss *float64
	for _, args := range commands {
		cmd := exec.Command("ping", args...)
		output, err := cmd.CombinedOutput()
		latencyMs, packetLoss := parsePingStats(string(output))
		// Ignore pure 100% loss samples without RTT: they are often probe artifacts
		// and cause false degraded states in the dashboard.
		if latencyMs == nil && packetLoss != nil && *packetLoss >= 100 {
			packetLoss = nil
		}

		if err == nil {
			return latencyMs, packetLoss
		}

		// Keep parsed failure stats as fallback, but continue to try the next command.
		// This avoids false negatives when the first probe path fails and -I succeeds.
		if latencyMs != nil || packetLoss != nil {
			fallbackLatency = latencyMs
			fallbackLoss = packetLoss
		}
	}
	return fallbackLatency, fallbackLoss
}

func pokeOverlayTraffic(targetIP string) bool {
	if targetIP == "" {
		return false
	}
	conn, err := net.DialTimeout("udp", net.JoinHostPort(targetIP, "9"), 800*time.Millisecond)
	if err != nil {
		return false
	}
	defer conn.Close()
	_, err = conn.Write(make([]byte, 8192))
	return err == nil
}

func int64Ptr(value int64) *int64 {
	v := value
	return &v
}

func (c *collector) collectOverlayLinkMetrics(iface string) []overlayLinkMetric {
	if !commandExists("wg") {
		return nil
	}
	out, err := exec.Command("wg", "show", iface, "dump").Output()
	if err != nil {
		return nil
	}

	if c.lastOverlay == nil {
		c.lastOverlay = make(map[string]overlayTrafficSnapshot)
	}
	if c.lastOverlayRtt == nil {
		c.lastOverlayRtt = make(map[string]overlayProbeSnapshot)
	}

	now := time.Now()
	metrics := make([]overlayLinkMetric, 0, 8)
	scanner := bufio.NewScanner(bytes.NewReader(out))
	lineIndex := 0
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		lineIndex++
		// First line is the local interface dump; peers start after that.
		if lineIndex == 1 {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 8 {
			continue
		}

		publicKey := strings.TrimSpace(fields[0])
		allowedIPs := fields[3]
		latestHandshake, handshakeErr := strconv.ParseInt(fields[4], 10, 64)
		rxBytes, rxErr := strconv.ParseUint(fields[5], 10, 64)
		txBytes, txErr := strconv.ParseUint(fields[6], 10, 64)
		if publicKey == "" || handshakeErr != nil || rxErr != nil || txErr != nil {
			continue
		}

		metric := overlayLinkMetric{
			TargetPublicKey: publicKey,
			TargetVlanIP:    firstAllowedIP(allowedIPs),
		}
		if latestHandshake > 0 {
			metric.HandshakeAgeSec = int64Ptr(now.Unix() - latestHandshake)
		}

		if prev, ok := c.lastOverlay[publicKey]; ok {
			if now.After(prev.at) {
				seconds := now.Sub(prev.at).Seconds()
				if seconds > 0 {
					if txBytes >= prev.txBytes {
						metric.TxMbps = round2((float64(txBytes-prev.txBytes) * 8) / seconds / 1_000_000)
					}
					if rxBytes >= prev.rxBytes {
						metric.RxMbps = round2((float64(rxBytes-prev.rxBytes) * 8) / seconds / 1_000_000)
					}
				}
			}
		}
		c.lastOverlay[publicKey] = overlayTrafficSnapshot{rxBytes: rxBytes, txBytes: txBytes, at: now}

		cacheKey := publicKey
		if metric.TargetVlanIP != "" {
			cacheKey = publicKey + "|" + metric.TargetVlanIP
		}
		needProbe := true
		if cached, ok := c.lastOverlayRtt[cacheKey]; ok {
			if cached.hasLatency {
				cachedLatency := cached.latencyMs
				metric.LatencyMs = &cachedLatency
			}
			if cached.hasLoss {
				cachedLoss := cached.packetLoss
				metric.PacketLoss = &cachedLoss
			}
			needProbe = now.Sub(cached.at) >= 5*time.Second
		}
		if needProbe && metric.TargetVlanIP != "" {
			latencyMs, packetLoss := probeOverlayLatency(iface, metric.TargetVlanIP)
			if latencyMs != nil || packetLoss != nil {
				if latencyMs != nil {
					metric.LatencyMs = latencyMs
				}
				if packetLoss != nil {
					metric.PacketLoss = packetLoss
				}
				cachedLatency := 0.0
				if metric.LatencyMs != nil {
					cachedLatency = *metric.LatencyMs
				}
				cachedLoss := 0.0
				if metric.PacketLoss != nil {
					cachedLoss = *metric.PacketLoss
				}
				c.lastOverlayRtt[cacheKey] = overlayProbeSnapshot{
					latencyMs:  cachedLatency,
					packetLoss: cachedLoss,
					hasLatency: metric.LatencyMs != nil,
					hasLoss:    metric.PacketLoss != nil,
					at:         now,
				}
			} else {
				// Keep overlay telemetry active even when ICMP probing is unavailable.
				_ = pokeOverlayTraffic(metric.TargetVlanIP)
			}
		}

		metrics = append(metrics, metric)
	}

	return metrics
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

type sshIdentity struct {
	publicKey string
	user      string
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

func ensureSSHIdentity() (*sshIdentity, error) {
	if !commandExists("ssh-keygen") {
		return nil, errors.New("ssh-keygen not found")
	}

	sshUser := strings.TrimSpace(os.Getenv("AGENT_SSH_USER"))
	if sshUser == "" {
		if current, err := user.Current(); err == nil && strings.TrimSpace(current.Username) != "" {
			sshUser = current.Username
		}
	}
	if sshUser == "" {
		sshUser = "root"
	}

	privateKeyPath := envOrDefault("AGENT_SSH_PRIVATE_KEY_PATH", "/var/lib/tarmac-agent/ssh/id_ed25519")
	if err := os.MkdirAll(filepath.Dir(privateKeyPath), 0o700); err != nil {
		return nil, fmt.Errorf("cannot create ssh key directory: %w", err)
	}
	publicKeyPath := privateKeyPath + ".pub"
	if _, err := os.Stat(publicKeyPath); errors.Is(err, os.ErrNotExist) {
		host, _ := os.Hostname()
		comment := fmt.Sprintf("tarmac-agent@%s", host)
		cmd := exec.Command("ssh-keygen", "-t", "ed25519", "-N", "", "-f", privateKeyPath, "-C", comment)
		output, genErr := cmd.CombinedOutput()
		if genErr != nil {
			return nil, fmt.Errorf("cannot generate ssh key: %s", strings.TrimSpace(string(output)))
		}
	} else if err != nil {
		return nil, fmt.Errorf("cannot stat ssh public key: %w", err)
	}

	publicKeyRaw, err := os.ReadFile(publicKeyPath)
	if err != nil {
		return nil, fmt.Errorf("cannot read ssh public key: %w", err)
	}
	publicKey := strings.TrimSpace(string(publicKeyRaw))
	if publicKey == "" {
		return nil, errors.New("ssh public key is empty")
	}
	return &sshIdentity{publicKey: publicKey, user: sshUser}, nil
}

func applySSHAuthorizedKeys(payload map[string]interface{}) (string, error) {
	targetUser := strings.TrimSpace(readString(payload, "user"))
	if targetUser == "" {
		targetUser = "root"
	}

	rawKeys := readStringSlice(payload, "authorizedKeys")
	unique := make(map[string]struct{}, len(rawKeys))
	keys := make([]string, 0, len(rawKeys))
	for _, key := range rawKeys {
		candidate := strings.TrimSpace(key)
		if candidate == "" {
			continue
		}
		if !strings.HasPrefix(candidate, "ssh-") {
			continue
		}
		if _, exists := unique[candidate]; exists {
			continue
		}
		unique[candidate] = struct{}{}
		keys = append(keys, candidate)
	}
	if len(keys) == 0 {
		return "", errors.New("no valid authorized keys provided")
	}
	sort.Strings(keys)

	account, err := user.Lookup(targetUser)
	if err != nil {
		return "", fmt.Errorf("cannot lookup user %s: %w", targetUser, err)
	}
	homeDir := strings.TrimSpace(account.HomeDir)
	if homeDir == "" {
		return "", fmt.Errorf("user %s has no home directory", targetUser)
	}

	sshDir := filepath.Join(homeDir, ".ssh")
	if err := os.MkdirAll(sshDir, 0o700); err != nil {
		return "", fmt.Errorf("cannot create %s: %w", sshDir, err)
	}
	authorizedKeysPath := filepath.Join(sshDir, "authorized_keys")
	existingRaw, readErr := os.ReadFile(authorizedKeysPath)
	if readErr != nil && !errors.Is(readErr, os.ErrNotExist) {
		return "", fmt.Errorf("cannot read authorized_keys: %w", readErr)
	}
	existing := string(existingRaw)

	const beginMarker = "# BEGIN TARMAC MANAGED KEYS"
	const endMarker = "# END TARMAC MANAGED KEYS"
	managed := beginMarker + "\n" + strings.Join(keys, "\n") + "\n" + endMarker + "\n"

	newContent := managed
	start := strings.Index(existing, beginMarker)
	end := strings.Index(existing, endMarker)
	if start >= 0 && end > start {
		end += len(endMarker)
		if end < len(existing) && existing[end] == '\n' {
			end++
		}
		newContent = existing[:start] + managed + existing[end:]
	} else if strings.TrimSpace(existing) != "" {
		if !strings.HasSuffix(existing, "\n") {
			existing += "\n"
		}
		newContent = existing + managed
	}

	if err := os.WriteFile(authorizedKeysPath, []byte(newContent), 0o600); err != nil {
		return "", fmt.Errorf("cannot write authorized_keys: %w", err)
	}

	if os.Geteuid() == 0 {
		uid, uidErr := strconv.Atoi(account.Uid)
		gid, gidErr := strconv.Atoi(account.Gid)
		if uidErr == nil && gidErr == nil {
			_ = os.Chown(sshDir, uid, gid)
			_ = os.Chown(authorizedKeysPath, uid, gid)
		}
	}

	return fmt.Sprintf("configured %d ssh keys for user %s", len(keys), targetUser), nil
}

func updateAgent(payload map[string]interface{}) (string, error) {
	ref := readString(payload, "ref")
	serviceName := readString(payload, "serviceName")
	if serviceName == "" {
		serviceName = envOrDefault("AGENT_SERVICE_NAME", "tarmac-agent.service")
	}

	if matched, _ := regexp.MatchString(`^[a-zA-Z0-9_.@-]+$`, serviceName); !matched {
		return "", errors.New("serviceName contains invalid characters")
	}

	workDir := envOrDefault("AGENT_WORKTREE_DIR", "/root/.apps/Tarmac")
	agentSourceDir := filepath.Join(workDir, "apps", "agent")
	binPath := envOrDefault("AGENT_BIN_PATH", "/usr/local/bin/tarmac-agent")
	tmpBinPath := binPath + ".new"

	if !commandExists("git") {
		return "", errors.New("git not found on agent")
	}
	if !commandExists("systemctl") {
		return "", errors.New("systemctl not found; restart cannot be automated")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Minute)
	defer cancel()

	installedPackages := []string{}
	dependencyPackages := []string{
		"git",
		"golang-go",
		"rsync",
		"sshpass",
		"nfs-common",
		"cifs-utils",
		"wireguard-tools",
		"iproute2",
		"util-linux",
	}
	var dependencyErr error
	installedPackages, dependencyErr = ensureAgentSystemPackages(ctx, dependencyPackages)
	if dependencyErr != nil {
		return "", dependencyErr
	}

	if !commandExists("go") {
		return "", errors.New("go not found on agent after dependency install")
	}

	if _, err := os.Stat(filepath.Join(workDir, ".git")); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return "", fmt.Errorf("repository not found in %s", workDir)
		}
		return "", fmt.Errorf("cannot access repository dir: %w", err)
	}

	pullArgs := []string{"-C", workDir, "pull", "--ff-only"}
	if strings.TrimSpace(ref) != "" {
		pullArgs = append(pullArgs, "origin", ref)
	}
	pull := exec.CommandContext(ctx, "git", pullArgs...)
	if output, pullErr := pull.CombinedOutput(); pullErr != nil {
		return "", fmt.Errorf("cannot pull repository: %s", strings.TrimSpace(string(output)))
	}

	build := exec.CommandContext(ctx, "go", "build", "-o", tmpBinPath, ".")
	build.Dir = agentSourceDir
	if output, buildErr := build.CombinedOutput(); buildErr != nil {
		return "", fmt.Errorf("cannot build agent: %s", strings.TrimSpace(string(output)))
	}

	if err := os.Chmod(tmpBinPath, 0o755); err != nil {
		return "", fmt.Errorf("cannot chmod new binary: %w", err)
	}
	if err := os.Rename(tmpBinPath, binPath); err != nil {
		return "", fmt.Errorf("cannot replace agent binary: %w", err)
	}

	restartShell := fmt.Sprintf(
		"nohup sh -c 'sleep 1; if [ \"$(id -u)\" -eq 0 ]; then systemctl daemon-reload && systemctl restart %s; else sudo systemctl daemon-reload && sudo systemctl restart %s; fi' >/dev/null 2>&1 &",
		serviceName,
		serviceName,
	)
	restart := exec.Command("sh", "-c", restartShell)
	if output, restartErr := restart.CombinedOutput(); restartErr != nil {
		return "", fmt.Errorf("binary updated but restart scheduling failed: %s", strings.TrimSpace(string(output)))
	}

	message := fmt.Sprintf("agent updated from %s; service daemon-reload+restart scheduled", workDir)
	if len(installedPackages) > 0 {
		message += fmt.Sprintf("; installed packages: %s", strings.Join(installedPackages, ", "))
	}
	return message, nil
}

func ensureAgentSystemPackages(ctx context.Context, packages []string) ([]string, error) {
	if len(packages) == 0 {
		return nil, nil
	}

	missing := make([]string, 0, len(packages))
	checks := map[string]func() bool{
		"git":             func() bool { return commandExists("git") },
		"golang-go":       func() bool { return commandExists("go") },
		"rsync":           func() bool { return commandExists("rsync") },
		"sshpass":         func() bool { return commandExists("sshpass") },
		"nfs-common":      func() bool { return commandExists("mount.nfs") },
		"cifs-utils":      func() bool { return commandExists("mount.cifs") },
		"wireguard-tools": func() bool { return commandExists("wg") },
		"iproute2":        func() bool { return commandExists("ip") },
		"util-linux":      func() bool { return commandExists("mount") },
	}

	for _, pkg := range packages {
		check, ok := checks[pkg]
		if !ok || !check() {
			missing = append(missing, pkg)
		}
	}
	if len(missing) == 0 {
		return nil, nil
	}

	if !commandExists("apt-get") {
		return nil, fmt.Errorf(
			"missing required packages (%s) and apt-get is unavailable; install them manually before updating",
			strings.Join(missing, ", "),
		)
	}

	var updateCmd *exec.Cmd
	var installCmd *exec.Cmd
	installArgs := append([]string{"install", "-y", "--no-install-recommends"}, missing...)
	if os.Geteuid() == 0 {
		updateCmd = exec.CommandContext(ctx, "apt-get", "update", "-y")
		installCmd = exec.CommandContext(ctx, "apt-get", installArgs...)
	} else {
		if !commandExists("sudo") {
			return nil, fmt.Errorf(
				"missing required packages (%s) and sudo is unavailable; install them manually before updating",
				strings.Join(missing, ", "),
			)
		}
		updateCmd = exec.CommandContext(ctx, "sudo", "apt-get", "update", "-y")
		installCmd = exec.CommandContext(ctx, "sudo", append([]string{"apt-get"}, installArgs...)...)
	}

	updateCmd.Env = append(os.Environ(), "DEBIAN_FRONTEND=noninteractive")
	installCmd.Env = append(os.Environ(), "DEBIAN_FRONTEND=noninteractive")

	if output, err := updateCmd.CombinedOutput(); err != nil {
		return nil, fmt.Errorf("cannot refresh package index before agent update: %s", strings.TrimSpace(string(output)))
	}
	if output, err := installCmd.CombinedOutput(); err != nil {
		return nil, fmt.Errorf("cannot install required packages for agent update: %s", strings.TrimSpace(string(output)))
	}

	return missing, nil
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

func isNFSFilesystem(fsType string) bool {
	normalized := strings.ToLower(strings.TrimSpace(fsType))
	return strings.HasPrefix(normalized, "nfs")
}

func parseMountOptions(raw string) []string {
	if strings.TrimSpace(raw) == "" {
		return nil
	}
	parts := strings.Split(raw, ",")
	seen := make(map[string]struct{}, len(parts))
	options := make([]string, 0, len(parts))
	for _, part := range parts {
		opt := strings.TrimSpace(part)
		if opt == "" {
			continue
		}
		if _, exists := seen[opt]; exists {
			continue
		}
		seen[opt] = struct{}{}
		options = append(options, opt)
	}
	return options
}

func appendMissingOptions(options []string, required ...string) []string {
	seen := make(map[string]struct{}, len(options))
	result := make([]string, 0, len(options)+len(required))
	for _, opt := range options {
		trimmed := strings.TrimSpace(opt)
		if trimmed == "" {
			continue
		}
		if _, exists := seen[trimmed]; exists {
			continue
		}
		seen[trimmed] = struct{}{}
		result = append(result, trimmed)
	}
	for _, opt := range required {
		trimmed := strings.TrimSpace(opt)
		if trimmed == "" {
			continue
		}
		if _, exists := seen[trimmed]; exists {
			continue
		}
		seen[trimmed] = struct{}{}
		result = append(result, trimmed)
	}
	return result
}

func joinMountOptions(options []string) string {
	if len(options) == 0 {
		return ""
	}
	return strings.Join(options, ",")
}

func persistMountInFstab(source, target, fsType, options string) error {
	const fstabPath = "/etc/fstab"
	entry := fmt.Sprintf("%s %s %s %s 0 0", source, target, fsType, options)

	content, err := os.ReadFile(fstabPath)
	if err != nil {
		return fmt.Errorf("cannot read %s: %w", fstabPath, err)
	}

	lines := strings.Split(strings.ReplaceAll(string(content), "\r\n", "\n"), "\n")
	foundTarget := false
	changed := false

	for idx, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, "#") {
			continue
		}

		fields := strings.Fields(trimmed)
		if len(fields) < 2 {
			continue
		}

		if fields[1] != target {
			continue
		}

		foundTarget = true
		if trimmed != entry {
			lines[idx] = entry
			changed = true
		}
	}

	if !foundTarget {
		lines = append(lines, entry)
		changed = true
	}

	if !changed {
		return nil
	}

	normalized := strings.TrimRight(strings.Join(lines, "\n"), "\n") + "\n"
	if err := os.WriteFile(fstabPath, []byte(normalized), 0o644); err != nil {
		return fmt.Errorf("cannot write %s: %w", fstabPath, err)
	}

	if commandExists("systemctl") {
		if out, err := exec.Command("systemctl", "daemon-reload").CombinedOutput(); err != nil {
			return fmt.Errorf("systemctl daemon-reload failed: %s", strings.TrimSpace(string(out)))
		}
	}

	return nil
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
	runtimeOptionsSlice := parseMountOptions(options)
	runtimeOptions := joinMountOptions(runtimeOptionsSlice)

	fstabSourceOptions := runtimeOptionsSlice
	if len(fstabSourceOptions) == 0 {
		fstabSourceOptions = []string{"defaults"}
	}
	persistentOptions := joinMountOptions(fstabSourceOptions)
	if isNFSFilesystem(fsType) {
		persistentOptions = joinMountOptions(appendMissingOptions(
			fstabSourceOptions,
			"_netdev",
			"nofail",
			"x-systemd.automount",
			"x-systemd.requires=network-online.target",
			"x-systemd.device-timeout=10s",
			"x-systemd.mount-timeout=30s",
		))
	}

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

	if isNFSFilesystem(fsType) && !commandExists("mount.nfs") {
		return "", errors.New("mount.nfs not found (install nfs-common)")
	}
	if fsType == "cifs" && !commandExists("mount.cifs") {
		return "", errors.New("mount.cifs not found (install cifs-utils)")
	}

	if isNFSFilesystem(fsType) {
		if err := persistMountInFstab(filtered[0], target, fsType, persistentOptions); err != nil {
			return "", fmt.Errorf("cannot persist mount for reboot recovery: %w", err)
		}
	}

	var attempts []string
	for _, candidate := range filtered {
		args := make([]string, 0, 8)
		if fsType != "" {
			args = append(args, "-t", fsType)
		}
		if runtimeOptions != "" {
			args = append(args, "-o", runtimeOptions)
		}
		args = append(args, candidate, target)

		cmd := exec.Command("mount", args...)
		output, err := cmd.CombinedOutput()
		if err == nil {
			if isNFSFilesystem(fsType) && candidate != filtered[0] {
				if updateErr := persistMountInFstab(candidate, target, fsType, persistentOptions); updateErr != nil {
					return "", fmt.Errorf("mounted %s but failed to update persistent source: %w", candidate, updateErr)
				}
			}
			return fmt.Sprintf("mounted %s on %s (persistent via /etc/fstab)", candidate, target), nil
		}
		attempts = append(attempts, fmt.Sprintf("%s: %s", candidate, strings.TrimSpace(string(output))))
	}

	if isNFSFilesystem(fsType) {
		return "", fmt.Errorf(
			"mount failed now: %s (persistent retry configured at boot for %s -> %s)",
			strings.Join(attempts, " | "),
			filtered[0],
			target,
		)
	}

	return "", fmt.Errorf("mount failed: %s", strings.Join(attempts, " | "))
}

func listDirectories(payload map[string]interface{}) (directoryListData, error) {
	basePath := strings.TrimSpace(readString(payload, "basePath"))
	if basePath == "" {
		basePath = "/"
	}
	basePath = filepath.Clean(basePath)
	if !filepath.IsAbs(basePath) {
		return directoryListData{}, errors.New("basePath must be absolute")
	}

	directories, err := listBrowsableDirectories(basePath)
	if err != nil {
		return directoryListData{}, err
	}
	if len(directories) > 500 {
		directories = directories[:500]
	}

	return directoryListData{
		BasePath:    basePath,
		Directories: directories,
	}, nil
}

func shellSingleQuote(input string) string {
	return "'" + strings.ReplaceAll(input, "'", `'"'"'`) + "'"
}

func sftpDoubleQuote(input string) string {
	return `"` + strings.NewReplacer(`\`, `\\`, `"`, `\"`).Replace(input) + `"`
}

func normalizeRemoteEndpointType(raw string) string {
	switch strings.TrimSpace(strings.ToLower(raw)) {
	case "storagebox":
		return "storagebox"
	default:
		return "seedbox"
	}
}

func listStorageboxDirectories(host, username, password, basePath string, port, timeoutMs int) ([]string, error) {
	basePath = strings.TrimSpace(basePath)
	if basePath == "" {
		basePath = "/home"
	}
	if !strings.HasPrefix(basePath, "/") {
		return nil, errors.New("basePath must be absolute")
	}

	sshArgs := []string{
		"-p", strconv.Itoa(port),
		"-o", "StrictHostKeyChecking=no",
		"-o", "UserKnownHostsFile=/dev/null",
		"-o", "ConnectTimeout=10",
		fmt.Sprintf("%s@%s", username, host),
		fmt.Sprintf("ls -1 %s", shellSingleQuote(basePath)),
	}

	var cmd *exec.Cmd
	ctx, cancel := context.WithTimeout(context.Background(), time.Duration(timeoutMs)*time.Millisecond)
	defer cancel()
	if password != "" {
		if !commandExists("sshpass") {
			return nil, errors.New("sshpass not found on agent; reinstall or update the agent to enable password-based storagebox browsing")
		}
		cmd = exec.CommandContext(ctx, "sshpass", append([]string{"-p", password, "ssh"}, sshArgs...)...)
	} else {
		sshKeyPath := envOrDefault("AGENT_SSH_PRIVATE_KEY_PATH", "/var/lib/tarmac-agent/ssh/id_ed25519")
		sshArgs = append([]string{
			"-i", sshKeyPath,
			"-o", "IdentitiesOnly=yes",
			"-o", "BatchMode=yes",
			"-o", "PasswordAuthentication=no",
			"-o", "PreferredAuthentications=publickey",
		}, sshArgs...)
		cmd = exec.CommandContext(ctx, "ssh", sshArgs...)
	}

	output, err := cmd.CombinedOutput()
	if err != nil {
		if ctx.Err() == context.DeadlineExceeded {
			return nil, errors.New("remote directory listing timeout")
		}
		details := strings.TrimSpace(string(output))
		if details != "" {
			return nil, fmt.Errorf("cannot list storagebox directories: %s", details)
		}
		return nil, fmt.Errorf("cannot list storagebox directories: %w", err)
	}

	lines := strings.Split(string(output), "\n")
	directories := make([]string, 0, len(lines))
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || trimmed == "." || trimmed == ".." {
			continue
		}
		// Add all entries as directories (Hetzner doesn't distinguish in simple ls)
		fullPath := filepath.Join(basePath, trimmed)
		directories = append(directories, fullPath)
	}

	sort.Strings(directories)
	return directories, nil
}

func listRemoteDirectories(payload map[string]interface{}) (directoryListData, error) {
	host := readString(payload, "host")
	username := readString(payload, "username")
	password := readString(payload, "password")
	if host == "" || username == "" {
		return directoryListData{}, errors.New("host and username are required")
	}

	basePath := strings.TrimSpace(readString(payload, "basePath"))
	endpointType := normalizeRemoteEndpointType(readString(payload, "endpointType"))
	if basePath == "" {
		if endpointType == "storagebox" {
			basePath = "/home"
		} else {
			basePath = "/"
		}
	}
	if !strings.HasPrefix(basePath, "/") {
		return directoryListData{}, errors.New("basePath must be absolute")
	}
	defaultPort := 22
	if endpointType == "storagebox" {
		defaultPort = 23
	}
	port := readInt(payload, "port", defaultPort)
	if port <= 0 || port > 65535 {
		port = defaultPort
	}
	timeoutMs := readInt(payload, "timeoutMs", 12000)
	if timeoutMs < 1000 {
		timeoutMs = 1000
	}
	if timeoutMs > 30000 {
		timeoutMs = 30000
	}
	directories := []string{}
	if endpointType == "storagebox" {
		listed, err := listStorageboxDirectories(host, username, password, basePath, port, timeoutMs)
		if err != nil {
			return directoryListData{}, err
		}
		directories = listed
	} else {
		sshArgs := []string{
			"-p", strconv.Itoa(port),
			"-o", "StrictHostKeyChecking=no",
			"-o", "UserKnownHostsFile=/dev/null",
			"-o", "ConnectTimeout=10",
			fmt.Sprintf("%s@%s", username, host),
			fmt.Sprintf("find %s -mindepth 1 -maxdepth 1 -type d -print 2>/dev/null", shellSingleQuote(basePath)),
		}

		var cmd *exec.Cmd
		ctx, cancel := context.WithTimeout(context.Background(), time.Duration(timeoutMs)*time.Millisecond)
		defer cancel()
		if password != "" {
			if !commandExists("sshpass") {
				return directoryListData{}, errors.New("sshpass not found on agent; reinstall or update the agent to enable password-based seedbox browsing")
			}
			cmd = exec.CommandContext(ctx, "sshpass", append([]string{"-p", password, "ssh"}, sshArgs...)...)
		} else {
			sshKeyPath := envOrDefault("AGENT_SSH_PRIVATE_KEY_PATH", "/var/lib/tarmac-agent/ssh/id_ed25519")
			sshArgs = append([]string{
				"-i", sshKeyPath,
				"-o", "IdentitiesOnly=yes",
				"-o", "BatchMode=yes",
				"-o", "PasswordAuthentication=no",
				"-o", "PreferredAuthentications=publickey",
			}, sshArgs...)
			cmd = exec.CommandContext(ctx, "ssh", sshArgs...)
		}

		output, err := cmd.CombinedOutput()
		if err != nil {
			if ctx.Err() == context.DeadlineExceeded {
				return directoryListData{}, errors.New("remote directory listing timeout")
			}
			details := strings.TrimSpace(string(output))
			if details != "" {
				return directoryListData{}, fmt.Errorf("cannot list remote directories: %s", details)
			}
			return directoryListData{}, fmt.Errorf("cannot list remote directories: %w", err)
		}

		lines := strings.Split(string(output), "\n")
		for _, line := range lines {
			trimmed := strings.TrimSpace(line)
			if trimmed == "" {
				continue
			}
			directories = append(directories, trimmed)
		}
	}
	sort.Strings(directories)
	if len(directories) > 500 {
		directories = directories[:500]
	}

	return directoryListData{
		BasePath:    basePath,
		Directories: directories,
	}, nil
}

func scanDirectorySizes(payload map[string]interface{}) (directoryScanData, error) {
	basePath := strings.TrimSpace(readString(payload, "basePath"))
	if basePath == "" {
		basePath = "/"
	}
	basePath = filepath.Clean(basePath)
	if !filepath.IsAbs(basePath) {
		return directoryScanData{}, errors.New("basePath must be absolute")
	}

	maxEntries := readInt(payload, "maxEntries", 20)
	if maxEntries < 1 {
		maxEntries = 1
	}
	if maxEntries > 100 {
		maxEntries = 100
	}

	directories, err := listBrowsableDirectories(basePath)
	if err != nil {
		return directoryScanData{}, err
	}

	const scanInputLimit = 120
	truncated := false
	if len(directories) > scanInputLimit {
		directories = directories[:scanInputLimit]
		truncated = true
	}

	timeoutMs := readInt(payload, "timeoutMs", 3500)
	if timeoutMs < 500 {
		timeoutMs = 500
	}
	if timeoutMs > 15000 {
		timeoutMs = 15000
	}

	ctx, cancel := context.WithTimeout(context.Background(), time.Duration(timeoutMs)*time.Millisecond)
	defer cancel()

	type result struct {
		entry directorySizeEntry
		ok    bool
	}

	workCh := make(chan string)
	resultCh := make(chan result, len(directories))
	workerCount := 6
	if len(directories) < workerCount {
		workerCount = len(directories)
	}

	var wg sync.WaitGroup
	worker := func() {
		defer wg.Done()
		for directory := range workCh {
			cmd := exec.CommandContext(ctx, "du", "-sk", directory)
			output, err := cmd.Output()
			if err != nil {
				continue
			}
			fields := strings.Fields(string(output))
			if len(fields) == 0 {
				continue
			}
			sizeKb, parseErr := strconv.ParseInt(fields[0], 10, 64)
			if parseErr != nil {
				continue
			}
			select {
			case resultCh <- result{
				entry: directorySizeEntry{
					Path:      directory,
					SizeBytes: sizeKb * 1024,
				},
				ok: true,
			}:
			case <-ctx.Done():
				return
			}
		}
	}

	for i := 0; i < workerCount; i++ {
		wg.Add(1)
		go worker()
	}

	go func() {
		defer close(workCh)
		for _, directory := range directories {
			select {
			case workCh <- directory:
			case <-ctx.Done():
				return
			}
		}
	}()

	wg.Wait()
	close(resultCh)

	bySize := make([]directorySizeEntry, 0, len(directories))
	for item := range resultCh {
		if !item.ok {
			continue
		}
		bySize = append(bySize, item.entry)
	}

	if ctx.Err() != nil {
		truncated = true
	}
	if len(bySize) < len(directories) {
		truncated = true
	}

	sort.Slice(bySize, func(i, j int) bool {
		return bySize[i].SizeBytes > bySize[j].SizeBytes
	})

	if len(bySize) > maxEntries {
		bySize = bySize[:maxEntries]
		truncated = true
	}

	return directoryScanData{
		BasePath:  basePath,
		Entries:   bySize,
		Truncated: truncated,
	}, nil
}

func listBrowsableDirectories(basePath string) ([]string, error) {
	entries, err := os.ReadDir(basePath)
	if err != nil {
		return nil, fmt.Errorf("cannot read %s: %w", basePath, err)
	}

	directories := make([]string, 0, len(entries))
	for _, entry := range entries {
		entryPath := filepath.Clean(filepath.Join(basePath, entry.Name()))
		if entry.IsDir() {
			directories = append(directories, entryPath)
			continue
		}

		entryType := entry.Type()
		if entryType != 0 && entryType&os.ModeSymlink == 0 {
			continue
		}

		info, statErr := os.Stat(entryPath)
		if statErr != nil || !info.IsDir() {
			continue
		}
		directories = append(directories, entryPath)
	}

	sort.Strings(directories)
	return directories, nil
}

func splitByCRLF(data []byte, atEOF bool) (advance int, token []byte, err error) {
	for i := 0; i < len(data); i++ {
		if data[i] == '\n' || data[i] == '\r' {
			return i + 1, bytes.TrimSpace(data[:i]), nil
		}
	}
	if atEOF && len(data) > 0 {
		return len(data), bytes.TrimSpace(data), nil
	}
	return 0, nil, nil
}

var progressPercentRe = regexp.MustCompile(`(\d{1,3})%`)

func parseProgressPercent(line string) (int, bool) {
	match := progressPercentRe.FindStringSubmatch(line)
	if len(match) < 2 {
		return 0, false
	}
	percent, err := strconv.Atoi(match[1])
	if err != nil {
		return 0, false
	}
	if percent < 0 {
		percent = 0
	}
	if percent > 100 {
		percent = 100
	}
	return percent, true
}

func runRsyncWithProgress(payload map[string]interface{}, onProgress func(progress int, message string)) (string, error) {
	if !commandExists("rsync") {
		return "", errors.New("rsync not found on agent")
	}

	sourcePath := readString(payload, "sourcePath")
	targetPath := readString(payload, "targetPath")
	if sourcePath == "" || targetPath == "" {
		return "", errors.New("run_rsync payload must include sourcePath and targetPath")
	}

	sourceHost := readString(payload, "sourceHost")
	sourceUser := readString(payload, "sourceUser")
	sourcePassword := readString(payload, "sourcePassword")
	if sourceUser == "" {
		sourceUser = "root"
	}
	sourceSshPort := readInt(payload, "sourceSshPort", readInt(payload, "sshPort", 22))
	targetHost := readString(payload, "targetHost")
	targetUser := readString(payload, "targetUser")
	targetPassword := readString(payload, "targetPassword")
	targetSshPort := readInt(payload, "targetSshPort", 22)
	if targetUser == "" {
		targetUser = "root"
	}
	if sourceHost != "" && targetHost != "" {
		return "", errors.New("run_rsync supports only one remote endpoint")
	}
	timeoutSeconds := readInt(payload, "timeoutSeconds", 0)
	if timeoutSeconds < 0 {
		timeoutSeconds = 0
	}
	connectTimeoutSeconds := readInt(payload, "connectTimeoutSeconds", 30)
	if connectTimeoutSeconds <= 0 {
		connectTimeoutSeconds = 30
	}
	sshKeyPath := envOrDefault("AGENT_SSH_PRIVATE_KEY_PATH", "/var/lib/tarmac-agent/ssh/id_ed25519")
	resourceType := readString(payload, "resourceType")
	if resourceType == "" {
		resourceType = "sync_job_run"
	}
	resourceID := readString(payload, "resourceId")
	if resourceID == "" {
		resourceID = readString(payload, "runId")
	}
	key := rsyncExecutionKey(resourceType, resourceID)
	if key == "" {
		return "", errors.New("run_rsync payload must include resourceType/resourceId")
	}

	sourceArg := sourcePath
	if sourceHost != "" {
		if sourceUser != "" {
			sourceArg = fmt.Sprintf("%s@%s:%s", sourceUser, sourceHost, sourcePath)
		} else {
			sourceArg = fmt.Sprintf("%s:%s", sourceHost, sourcePath)
		}
	}

	targetArg := targetPath
	if targetHost != "" {
		if targetUser != "" {
			targetArg = fmt.Sprintf("%s@%s:%s", targetUser, targetHost, targetPath)
		} else {
			targetArg = fmt.Sprintf("%s:%s", targetHost, targetPath)
		}
	} else if err := os.MkdirAll(targetPath, 0o755); err != nil {
		return "", fmt.Errorf("cannot create target path: %w", err)
	}

	args := []string{"-a", "--delete", "--partial", "--append-verify", "--info=progress2", sourceArg, targetArg}
	if sourceHost != "" {
		sshCommand := fmt.Sprintf(
			"ssh -p %d -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=%d -o ServerAliveInterval=30 -o ServerAliveCountMax=120 -o TCPKeepAlive=yes",
			sourceSshPort,
			connectTimeoutSeconds,
		)
		usePassword := sourcePassword != ""
		if !usePassword {
			sshCommand += fmt.Sprintf(
				" -i %s -o IdentitiesOnly=yes -o BatchMode=yes -o PasswordAuthentication=no -o PreferredAuthentications=publickey",
				sshKeyPath,
			)
		}
		args = append([]string{"-e", sshCommand}, args...)
		if usePassword {
			if !commandExists("sshpass") {
				return "", errors.New("sshpass not found on agent; reinstall or update the agent to enable password-based seedbox transfers")
			}
			args = append([]string{"-p", sourcePassword, "rsync"}, args...)
		}
	}
	if targetHost != "" {
		sshCommand := fmt.Sprintf(
			"ssh -p %d -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=%d -o ServerAliveInterval=30 -o ServerAliveCountMax=120 -o TCPKeepAlive=yes",
			targetSshPort,
			connectTimeoutSeconds,
		)
		usePassword := targetPassword != ""
		if !usePassword {
			sshCommand += fmt.Sprintf(
				" -i %s -o IdentitiesOnly=yes -o BatchMode=yes -o PasswordAuthentication=no -o PreferredAuthentications=publickey",
				sshKeyPath,
			)
		}
		args = append([]string{"-e", sshCommand}, args...)
		if usePassword {
			if !commandExists("sshpass") {
				return "", errors.New("sshpass not found on agent; reinstall or update the agent to enable password-based seedbox transfers")
			}
			args = append([]string{"-p", targetPassword, "rsync"}, args...)
		}
	}

	baseCtx, cancel := context.WithCancel(context.Background())
	registerRsyncExecution(key, cancel)
	defer func() {
		unregisterRsyncExecution(key)
		cancel()
	}()
	ctx := baseCtx
	timeoutCancel := func() {}
	if timeoutSeconds > 0 {
		ctx, timeoutCancel = context.WithTimeout(baseCtx, time.Duration(timeoutSeconds)*time.Second)
	}
	defer timeoutCancel()
	cmdName := "rsync"
	if len(args) > 0 && args[0] == "-p" {
		cmdName = "sshpass"
	}
	cmd := exec.CommandContext(ctx, cmdName, args...)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return "", fmt.Errorf("cannot open rsync stdout: %w", err)
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return "", fmt.Errorf("cannot open rsync stderr: %w", err)
	}

	if err := cmd.Start(); err != nil {
		return "", fmt.Errorf("cannot start rsync: %w", err)
	}

	var wg sync.WaitGroup
	var parseMu sync.Mutex
	lastProgress := -1
	parseStream := func(reader io.Reader) {
		defer wg.Done()
		scanner := bufio.NewScanner(reader)
		scanner.Split(splitByCRLF)
		for scanner.Scan() {
			line := strings.TrimSpace(scanner.Text())
			if line == "" {
				continue
			}
			percent, ok := parseProgressPercent(line)
			if !ok {
				continue
			}

			parseMu.Lock()
			if percent > lastProgress {
				lastProgress = percent
				parseMu.Unlock()
				onProgress(percent, line)
			} else {
				parseMu.Unlock()
			}
		}
	}

	wg.Add(2)
	go parseStream(stdout)
	go parseStream(stderr)

	waitErr := cmd.Wait()
	wg.Wait()
	if errors.Is(ctx.Err(), context.Canceled) {
		return "", errors.New("rsync stopped by user")
	}
	if timeoutSeconds > 0 && errors.Is(ctx.Err(), context.DeadlineExceeded) {
		return "", fmt.Errorf("rsync timed out after %ds", timeoutSeconds)
	}
	if waitErr != nil {
		return "", fmt.Errorf("rsync failed: %w", waitErr)
	}

	if lastProgress < 100 {
		onProgress(100, "rsync completed")
	}
	return "rsync completed", nil
}

func handleCommand(cmd commandPayload, onProgress func(progress commandProgress)) commandResult {
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
		result.ResourceType = readString(cmd.Payload, "resourceType")
		if result.ResourceType == "" {
			result.ResourceType = "sync_job_run"
		}
		result.ResourceID = readString(cmd.Payload, "resourceId")
		if result.ResourceID == "" {
			result.ResourceID = readString(cmd.Payload, "runId")
		}
		message, err := runRsyncWithProgress(cmd.Payload, func(progress int, msg string) {
			onProgress(commandProgress{
				Command:      "run_rsync",
				ResourceType: result.ResourceType,
				ResourceID:   result.ResourceID,
				Progress:     progress,
				Message:      msg,
			})
		})
		if err != nil {
			result.Success = false
			result.Message = err.Error()
		} else {
			result.Message = message
		}
	case "command.stop_rsync":
		result.Command = "stop_rsync"
		result.ResourceType = readString(cmd.Payload, "resourceType")
		if result.ResourceType == "" {
			result.ResourceType = "sync_job_run"
		}
		result.ResourceID = readString(cmd.Payload, "resourceId")
		if result.ResourceID == "" {
			result.ResourceID = readString(cmd.Payload, "runId")
		}
		if result.ResourceID == "" {
			result.Success = false
			result.Message = "resourceId is required"
			break
		}
		if stopped := stopRsyncExecution(result.ResourceType, result.ResourceID); !stopped {
			result.Success = false
			result.Message = "no running rsync found for this resource"
		} else {
			result.Message = "stop signal sent"
		}
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
	case "command.list_directories":
		result.Command = "list_directories"
		result.ResourceType = "directory_list"
		result.ResourceID = readString(cmd.Payload, "requestId")
		if result.ResourceID == "" {
			result.ResourceID = fmt.Sprintf("dirs-%d", time.Now().UnixNano())
		}
		data, err := listDirectories(cmd.Payload)
		if err != nil {
			result.Success = false
			result.Message = err.Error()
		} else {
			result.Data = data
			result.Message = fmt.Sprintf("%d directories listed", len(data.Directories))
		}
	case "command.list_remote_directories":
		result.Command = "list_remote_directories"
		result.ResourceType = "directory_list"
		result.ResourceID = readString(cmd.Payload, "requestId")
		if result.ResourceID == "" {
			result.ResourceID = fmt.Sprintf("rdirs-%d", time.Now().UnixNano())
		}
		data, err := listRemoteDirectories(cmd.Payload)
		if err != nil {
			result.Success = false
			result.Message = err.Error()
		} else {
			result.Data = data
			result.Message = fmt.Sprintf("%d remote directories listed", len(data.Directories))
		}
	case "command.scan_directory_sizes":
		result.Command = "scan_directory_sizes"
		result.ResourceType = "directory_scan"
		result.ResourceID = readString(cmd.Payload, "requestId")
		if result.ResourceID == "" {
			result.ResourceID = fmt.Sprintf("scan-%d", time.Now().UnixNano())
		}
		data, err := scanDirectorySizes(cmd.Payload)
		if err != nil {
			result.Success = false
			result.Message = err.Error()
		} else {
			result.Data = data
			result.Message = fmt.Sprintf("%d directories scanned", len(data.Entries))
		}
	case "command.apply_ssh_authorized_keys":
		result.Command = "apply_ssh_authorized_keys"
		result.ResourceType = "overlay"
		result.ResourceID = readString(cmd.Payload, "user")
		if result.ResourceID == "" {
			result.ResourceID = "root"
		}
		message, err := applySSHAuthorizedKeys(cmd.Payload)
		if err != nil {
			result.Success = false
			result.Message = err.Error()
		} else {
			result.Message = message
		}
	case "command.update_agent":
		result.Command = "update_agent"
		result.ResourceType = "agent"
		result.ResourceID = readString(cmd.Payload, "nodeId")
		if result.ResourceID == "" {
			result.ResourceID = envOrDefault("NODE_ID", "agent")
		}
		message, err := updateAgent(cmd.Payload)
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
	hasOverlayState := false
	overlayStatePayload := &overlayState{}
	if identity, err := ensureOverlayIdentity(); err == nil {
		overlayStatePayload.PublicKey = identity.publicKey
		overlayStatePayload.Endpoint = identity.endpoint
		overlayStatePayload.ListenPort = identity.listenPort
		hasOverlayState = true
	} else {
		log.Printf("overlay identity unavailable: %v", err)
	}
	if identity, err := ensureSSHIdentity(); err == nil {
		overlayStatePayload.SSHPublicKey = identity.publicKey
		overlayStatePayload.SSHUser = identity.user
		hasOverlayState = true
	} else {
		log.Printf("ssh identity unavailable: %v", err)
	}
	if hasOverlayState {
		overlay = overlayStatePayload
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
			command := cmd
			go func() {
				result := handleCommand(command, func(progress commandProgress) {
					if err := client.send(envelope{Type: "command_progress", Payload: progress}); err != nil {
						log.Printf("failed to send command_progress: %v", err)
					}
				})
				if err := client.send(envelope{Type: "command_result", Payload: result}); err != nil {
					select {
					case readDone <- err:
					default:
					}
				}
			}()
		}
	}()

	sendReport := func() error {
		report := buildStateReport(nodeID)
		metrics := c.collectMetrics(report.Disks)
		linkMetrics := c.collectOverlayLinkMetrics("tarmacwg0")
		if err := client.send(envelope{
			Type: "agent.heartbeat",
			Payload: heartbeat{
				NodeID:      nodeID,
				Metrics:     metrics,
				Overlay:     overlay,
				LinkMetrics: linkMetrics,
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
			linkMetrics := c.collectOverlayLinkMetrics("tarmacwg0")
			if err := client.send(envelope{
				Type: "agent.heartbeat",
				Payload: heartbeat{
					NodeID:      nodeID,
					Metrics:     metrics,
					Overlay:     overlay,
					LinkMetrics: linkMetrics,
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
