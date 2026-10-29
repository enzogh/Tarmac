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
	"sync/atomic"
	"syscall"
	"time"

	"github.com/gorilla/websocket"
)

// agentVersion is the short git commit SHA the binary was built from. It is
// injected at build time via -ldflags "-X main.agentVersion=<sha>" by
// install-agent-service.sh and updateAgent(), so it always reflects the
// commit currently deployed without any manual version bump.
var agentVersion = "dev"

type heartbeat struct {
	NodeID      string              `json:"nodeId"`
	Version     string              `json:"version,omitempty"`
	Metrics     metricState         `json:"metrics"`
	Overlay     *overlayState       `json:"overlay,omitempty"`
	LinkMetrics []overlayLinkMetric `json:"linkMetrics,omitempty"`
	VpnPeers    []vpnPeerStat       `json:"vpnPeers,omitempty"`
	System      *systemInfo         `json:"system,omitempty"`
	// Hash of the desired state last applied successfully, per kind (see
	// appliedStates). Lets the control plane skip re-sending a command whose
	// state this node already has.
	AppliedState map[string]string `json:"appliedState,omitempty"`
	// PowerDNS version, backend and maintenance state, on DNS server nodes.
	Dns *dnsServerReport `json:"dns,omitempty"`
	// Public half of the deploy key (see deployKeyPublic).
	DeployKey string `json:"deployKey,omitempty"`
	// Firewall: blocked connections, listening ports, rule hit counters.
	Firewall *fwReport `json:"firewall,omitempty"`
}

// appliedStates holds, per kind of desired state the control plane pushes on
// a tick, the stateHash of the last payload applied successfully. In memory
// only: after a restart nothing is reported, so the control plane re-sends
// and the node converges again.
var appliedStates = struct {
	sync.Mutex
	hashes map[string]string
}{hashes: map[string]string{}}

func setAppliedState(kind, hash string) {
	appliedStates.Lock()
	defer appliedStates.Unlock()
	if hash == "" {
		delete(appliedStates.hashes, kind)
		return
	}
	appliedStates.hashes[kind] = hash
}

func appliedStateSnapshot() map[string]string {
	appliedStates.Lock()
	defer appliedStates.Unlock()
	if len(appliedStates.hashes) == 0 {
		return nil
	}
	snapshot := make(map[string]string, len(appliedStates.hashes))
	for kind, hash := range appliedStates.hashes {
		snapshot[kind] = hash
	}
	return snapshot
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
	Name          string   `json:"name"`
	MountPath     string   `json:"mountPath"`
	Type          string   `json:"type"`
	Health        string   `json:"health"`
	CapacityGb    int      `json:"capacityGb"`
	UsedGb        int      `json:"usedGb"`
	PhysicalDisks []string `json:"physicalDisks"`
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

type tracerouteHop struct {
	Hop       int      `json:"hop"`
	IP        *string  `json:"ip"`
	LatencyMs *float64 `json:"latencyMs"`
}

type tracerouteData struct {
	TargetIP string          `json:"targetIp"`
	Hops     []tracerouteHop `json:"hops"`
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

// wsWriteTimeout/wsReadTimeout/wsPingInterval bound how long the agent will
// let a stalled control-plane connection block it. Without these, a half-open
// TCP connection (e.g. a dead NAT mapping) can leave WriteJSON/ReadJSON
// blocked indefinitely, so the process never notices it needs to reconnect.
// wsPingInterval is well under wsReadTimeout so a healthy connection always
// gets a pong (which resets the read deadline) before the deadline expires.
const (
	wsWriteTimeout = 10 * time.Second
	wsReadTimeout  = 60 * time.Second
	wsPingInterval = 25 * time.Second
)

type wsClient struct {
	conn *websocket.Conn
	mu   sync.Mutex
}

func (c *wsClient) send(v interface{}) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if err := c.conn.SetWriteDeadline(time.Now().Add(wsWriteTimeout)); err != nil {
		return err
	}
	return c.conn.WriteJSON(v)
}

// ping sends a WebSocket ping control frame so the read side (and any
// intermediate proxy/NAT) sees regular traffic even when there's nothing to
// heartbeat about. The server is expected to reply with a pong, which
// SetPongHandler uses to push the read deadline back out.
func (c *wsClient) ping() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.conn.WriteControl(websocket.PingMessage, nil, time.Now().Add(wsWriteTimeout))
}

type logLine struct {
	NodeID    string `json:"nodeId"`
	Level     string `json:"level"`
	Message   string `json:"message"`
	Timestamp string `json:"timestamp"`
}

// wsLogForwarder mirrors everything written to it (i.e. every log.Printf
// call, once main() redirects the standard logger through it) to the
// control plane as "agent.log" envelopes, in addition to the normal
// stderr/journalctl destination. Sends are non-blocking: if the control
// plane can't keep up, lines are dropped rather than stalling whatever
// goroutine happened to log something, and the drop count is reported
// periodically so a burst of lost lines is visible instead of silent.
type wsLogForwarder struct {
	client  *wsClient
	nodeID  string
	lines   chan string
	dropped int64
	done    chan struct{}
}

func newWsLogForwarder(client *wsClient, nodeID string) *wsLogForwarder {
	f := &wsLogForwarder{
		client: client,
		nodeID: nodeID,
		lines:  make(chan string, 200),
		done:   make(chan struct{}),
	}
	go f.run()
	return f
}

func (f *wsLogForwarder) Write(p []byte) (int, error) {
	line := strings.TrimRight(string(p), "\n")
	if line != "" {
		select {
		case f.lines <- line:
		default:
			atomic.AddInt64(&f.dropped, 1)
		}
	}
	return len(p), nil
}

func (f *wsLogForwarder) send(level, message string) {
	_ = f.client.send(envelope{
		Type: "agent.log",
		Payload: logLine{
			NodeID:    f.nodeID,
			Level:     level,
			Message:   message,
			Timestamp: time.Now().UTC().Format(time.RFC3339),
		},
	})
}

func (f *wsLogForwarder) run() {
	dropTicker := time.NewTicker(30 * time.Second)
	defer dropTicker.Stop()
	for {
		select {
		case <-f.done:
			return
		case line := <-f.lines:
			f.send("info", line)
		case <-dropTicker.C:
			if n := atomic.SwapInt64(&f.dropped, 0); n > 0 {
				f.send("warning", fmt.Sprintf("%d log lines dropped (buffer full)", n))
			}
		}
	}
}

func (f *wsLogForwarder) stop() {
	close(f.done)
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
	latencyMs           float64
	packetLoss          float64
	hasLatency          bool
	hasLoss             bool
	at                  time.Time
	consecutiveFailures int
}

// Overlay latency/loss probing shells out to `ping`, which is relatively
// expensive to run every 5s heartbeat tick for every peer. Results are
// cached well beyond a single tick, and peers that keep failing to respond
// back off to an even slower cadence so a permanently unreachable peer isn't
// re-probed at full frequency forever.
const (
	overlayProbeInterval         = 25 * time.Second
	overlayProbeBackoffInterval  = 60 * time.Second
	overlayProbeFailureThreshold = 3
)

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
	// MemTotal and MemAvailable are the first lines of /proc/meminfo, so
	// breaking out as soon as both are parsed skips ~50 irrelevant lines.
	seen := 0
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
				seen++
			}
		case "MemAvailable:":
			v, parseErr := strconv.ParseFloat(fields[1], 64)
			if parseErr == nil {
				available = v
				seen++
			}
		}
		if seen == 2 {
			break
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
		pingCtx, pingCancel := context.WithTimeout(context.Background(), 3*time.Second)
		cmd := exec.CommandContext(pingCtx, "ping", args...)
		output, err := cmd.CombinedOutput()
		pingCancel()
		latencyMs, packetLoss := parsePingStats(string(output))
		// A 100% loss result is kept and reported: dropping it used to hide
		// dead links, which then stayed "healthy" on handshake/tx alone. The
		// control plane only treats it as down when nothing comes back from
		// the peer either.
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

// Matches "traceroute -n" numeric output, one probe per hop (-q 1):
//
//	1  10.255.0.1  0.512 ms
//	2  * * *
var tracerouteLineRe = regexp.MustCompile(`^\s*(\d+)\s+(\S+)(?:\s+([\d.]+)\s*ms)?`)

func parseTracerouteOutput(output string) []tracerouteHop {
	hops := make([]tracerouteHop, 0, 16)
	for _, line := range strings.Split(output, "\n") {
		match := tracerouteLineRe.FindStringSubmatch(line)
		if match == nil {
			continue
		}
		hopNum, err := strconv.Atoi(match[1])
		if err != nil {
			continue
		}
		hop := tracerouteHop{Hop: hopNum}
		if match[2] != "*" {
			ip := match[2]
			hop.IP = &ip
		}
		if match[3] != "" {
			if latency, err := strconv.ParseFloat(match[3], 64); err == nil {
				hop.LatencyMs = &latency
			}
		}
		hops = append(hops, hop)
	}
	return hops
}

// Matches "tracepath -n" output. Each hop can appear on more than one line
// (asymmetric forward/return probes); later lines for the same hop overwrite
// earlier ones, which naturally keeps the last (most complete) reading:
//
//	1?: [LOCALHOST]                      pmtu 1420
//	1:  10.255.0.1                        0.412ms
//	2:  10.255.0.2                        1.021ms reached
var tracepathLineRe = regexp.MustCompile(`^\s*(\d+)\??:\s+(\S+)\s+([\d.]+)ms`)

func parseTracepathOutput(output string) []tracerouteHop {
	byHop := make(map[int]tracerouteHop)
	order := make([]int, 0, 16)
	for _, line := range strings.Split(output, "\n") {
		match := tracepathLineRe.FindStringSubmatch(line)
		if match == nil {
			continue
		}
		hopNum, err := strconv.Atoi(match[1])
		if err != nil {
			continue
		}
		if _, seen := byHop[hopNum]; !seen {
			order = append(order, hopNum)
		}
		hop := tracerouteHop{Hop: hopNum}
		ip := match[2]
		hop.IP = &ip
		if latency, err := strconv.ParseFloat(match[3], 64); err == nil {
			hop.LatencyMs = &latency
		}
		byHop[hopNum] = hop
	}
	hops := make([]tracerouteHop, 0, len(order))
	for _, hopNum := range order {
		hops = append(hops, byHop[hopNum])
	}
	return hops
}

type pingData struct {
	TargetIP   string   `json:"targetIp"`
	Sent       int      `json:"sent"`
	PacketLoss *float64 `json:"packetLoss,omitempty"`
	MinMs      *float64 `json:"minMs,omitempty"`
	AvgMs      *float64 `json:"avgMs,omitempty"`
	MaxMs      *float64 `json:"maxMs,omitempty"`
}

// On-demand ping from the Diagnostics tab: 5 probes, 200 ms apart, so the
// answer comes back in about a second and a half.
func runPing(payload map[string]interface{}) (pingData, error) {
	targetIP := strings.TrimSpace(readString(payload, "targetIp"))
	if net.ParseIP(targetIP) == nil {
		return pingData{}, errors.New("targetIp is required")
	}
	if !commandExists("ping") {
		return pingData{}, errors.New("ping not found on agent (install iputils-ping)")
	}
	const count = 5
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	output, _ := exec.CommandContext(ctx, "ping", "-n", "-c", strconv.Itoa(count), "-i", "0.2", "-W", "1", targetIP).CombinedOutput()
	data := pingData{TargetIP: targetIP, Sent: count}
	_, data.PacketLoss = parsePingStats(string(output))
	for _, line := range strings.Split(string(output), "\n") {
		if !strings.Contains(line, "min/avg/max") || !strings.Contains(line, "=") {
			continue
		}
		values := strings.Split(strings.Fields(strings.TrimSpace(strings.SplitN(line, "=", 2)[1]))[0], "/")
		parsed := make([]*float64, 0, 3)
		for _, raw := range values {
			if value, err := strconv.ParseFloat(raw, 64); err == nil {
				parsed = append(parsed, &value)
			}
		}
		if len(parsed) >= 3 {
			data.MinMs, data.AvgMs, data.MaxMs = parsed[0], parsed[1], parsed[2]
		}
	}
	if data.PacketLoss == nil {
		return pingData{}, fmt.Errorf("ping vers %s impossible : %s", targetIP, strings.TrimSpace(string(output)))
	}
	return data, nil
}

func runTraceroute(payload map[string]interface{}) (tracerouteData, error) {
	targetIP := strings.TrimSpace(readString(payload, "targetIp"))
	target := net.ParseIP(targetIP).To4()
	if target == nil {
		return tracerouteData{}, errors.New("targetIp is required")
	}

	hops, nativeErr := nativeTraceroute(target)
	if nativeErr == nil {
		return tracerouteData{TargetIP: targetIP, Hops: hops}, nil
	}
	var probeErr tracerouteProbeError
	if errors.As(nativeErr, &probeErr) {
		return tracerouteData{}, describeTraceError(targetIP, probeErr.err)
	}
	log.Printf("traceroute: built-in probe unavailable (%v), falling back to system tools", nativeErr)

	ctx, cancel := context.WithTimeout(context.Background(), 18*time.Second)
	defer cancel()

	var rawOutput string
	switch {
	case commandExists("traceroute"):
		output, _ := exec.CommandContext(ctx, "traceroute", "-n", "-I", "-q", "1", "-w", "1", "-m", "15", targetIP).CombinedOutput()
		rawOutput = string(output)
		hops = parseTracerouteOutput(rawOutput)
	case commandExists("tracepath"):
		output, _ := exec.CommandContext(ctx, "tracepath", "-n", targetIP).CombinedOutput()
		rawOutput = string(output)
		hops = parseTracepathOutput(rawOutput)
	default:
		return tracerouteData{}, describeTraceError(targetIP, nativeErr)
	}

	if len(hops) == 0 {
		if detail := strings.TrimSpace(rawOutput); detail != "" {
			return tracerouteData{}, fmt.Errorf("aucune route vers %s : %s", targetIP, detail)
		}
		return tracerouteData{}, fmt.Errorf("aucune route vers %s", targetIP)
	}

	return tracerouteData{TargetIP: targetIP, Hops: hops}, nil
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
	wgCtx, wgCancel := context.WithTimeout(context.Background(), 2*time.Second)
	out, err := exec.CommandContext(wgCtx, "wg", "show", iface, "dump").Output()
	wgCancel()
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
	// cacheKeys/needProbes are indexed in lockstep with metrics so the
	// probing phase below can write each peer's result into its own slot
	// without any goroutine touching another peer's data or a shared map.
	cacheKeys := make([]string, 0, 8)
	needProbes := make([]bool, 0, 8)

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
			interval := overlayProbeInterval
			if cached.consecutiveFailures >= overlayProbeFailureThreshold {
				interval = overlayProbeBackoffInterval
			}
			needProbe = now.Sub(cached.at) >= interval
		}
		if metric.TargetVlanIP == "" {
			needProbe = false
		}

		metrics = append(metrics, metric)
		cacheKeys = append(cacheKeys, cacheKey)
		needProbes = append(needProbes, needProbe)
	}

	// Probe every peer that needs a fresh reading concurrently instead of
	// sequentially: each probe shells out to `ping` and can take up to a few
	// seconds (see probeOverlayLatency's timeouts), so a sequential loop over
	// N peers could block a single heartbeat tick for up to N times that
	// long, worse when peers are unreachable. Concurrency is bounded by a
	// small worker pool, and each worker only ever writes to its own
	// pre-indexed slot in results, so there's no concurrent write to a
	// shared map or slice.
	type probeResult struct {
		latencyMs  *float64
		packetLoss *float64
		probed     bool
	}
	results := make([]probeResult, len(metrics))

	const maxConcurrentProbes = 8
	workers := len(metrics)
	if workers > maxConcurrentProbes {
		workers = maxConcurrentProbes
	}
	if workers > 0 {
		sem := make(chan struct{}, workers)
		var wg sync.WaitGroup
		for i := range metrics {
			if !needProbes[i] {
				continue
			}
			wg.Add(1)
			sem <- struct{}{}
			go func(i int, targetIP string) {
				defer wg.Done()
				defer func() { <-sem }()
				latencyMs, packetLoss := probeOverlayLatency(iface, targetIP)
				if latencyMs == nil && packetLoss == nil {
					// Keep overlay telemetry active even when ICMP probing is unavailable.
					_ = pokeOverlayTraffic(targetIP)
				}
				results[i] = probeResult{latencyMs: latencyMs, packetLoss: packetLoss, probed: true}
			}(i, metrics[i].TargetVlanIP)
		}
		wg.Wait()
	}

	// Cache map writes happen sequentially, after every probe goroutine has
	// finished, so c.lastOverlayRtt is never written concurrently.
	for i := range metrics {
		if !results[i].probed {
			continue
		}
		cacheKey := cacheKeys[i]
		latencyMs, packetLoss := results[i].latencyMs, results[i].packetLoss
		if latencyMs == nil && packetLoss == nil {
			next := c.lastOverlayRtt[cacheKey]
			next.consecutiveFailures++
			next.at = now
			c.lastOverlayRtt[cacheKey] = next
			continue
		}
		// Only a reply counts as success: a 100% loss reading is reported
		// (without the cached latency of an earlier, answered probe) but
		// still backs off like any other failed probe.
		failures := 0
		if latencyMs == nil {
			metrics[i].LatencyMs = nil
			failures = c.lastOverlayRtt[cacheKey].consecutiveFailures + 1
		} else {
			metrics[i].LatencyMs = latencyMs
		}
		if packetLoss != nil {
			metrics[i].PacketLoss = packetLoss
		}
		snapshot := overlayProbeSnapshot{
			hasLatency:          metrics[i].LatencyMs != nil,
			hasLoss:             metrics[i].PacketLoss != nil,
			at:                  now,
			consecutiveFailures: failures,
		}
		if snapshot.hasLatency {
			snapshot.latencyMs = *metrics[i].LatencyMs
		}
		if snapshot.hasLoss {
			snapshot.packetLoss = *metrics[i].PacketLoss
		}
		c.lastOverlayRtt[cacheKey] = snapshot
	}

	return metrics
}

// virtualFsTypes is built once at init instead of per call: isVirtualFs is
// called for every line of /proc/mounts on every collectDisks, i.e. dozens of
// times per heartbeat tick on a host with many mounts.
var virtualFsTypes = map[string]struct{}{
	"proc": {}, "sysfs": {}, "tmpfs": {}, "devtmpfs": {}, "devpts": {}, "overlay": {},
	"squashfs": {}, "cgroup": {}, "cgroup2": {}, "pstore": {}, "securityfs": {}, "debugfs": {},
	"tracefs": {}, "fusectl": {}, "autofs": {}, "mqueue": {}, "hugetlbfs": {}, "rpc_pipefs": {},
	"binfmt_misc": {}, "configfs": {},
}

func isVirtualFs(fsType string) bool {
	_, ok := virtualFsTypes[fsType]
	return ok
}

func baseBlockDevice(name string) string {
	base := filepath.Base(name)
	base = strings.TrimRight(base, "0123456789")
	base = strings.TrimSuffix(base, "p")
	return base
}

func inferDiskType(device string) string {
	base := baseBlockDevice(device)
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

// resolvePhysicalDisks returns the physical disk name(s) backing a mounted
// device. A plain partition (e.g. "sda1", "nvme0n1p3") resolves to its own
// base disk. A Linux software RAID device (e.g. "md2") has no SMART data of
// its own, so its /sys/block/mdX/slaves entries are read to find the
// underlying member partitions, each resolved down to its physical disk.
func resolvePhysicalDisks(device string) []string {
	base := filepath.Base(device)
	if !strings.HasPrefix(base, "md") {
		return []string{baseBlockDevice(base)}
	}

	entries, err := os.ReadDir(filepath.Join("/sys/block", base, "slaves"))
	if err != nil || len(entries) == 0 {
		return nil
	}

	seen := make(map[string]struct{})
	physical := make([]string, 0, len(entries))
	for _, entry := range entries {
		disk := baseBlockDevice(entry.Name())
		if disk == "" {
			continue
		}
		if _, ok := seen[disk]; ok {
			continue
		}
		seen[disk] = struct{}{}
		physical = append(physical, disk)
	}
	return physical
}

// diskTopology holds the slow-changing device metadata that inferDiskType
// (rotational vs. SSD/NVMe, via /sys/block/<dev>/queue/rotational) and
// resolvePhysicalDisks (RAID member mapping, via /sys/block/mdX/slaves)
// compute. Both come from disk/RAID topology that essentially never changes
// at runtime, so results are cached and refreshed on a much slower cadence
// than the 5s heartbeat ticker (and 20s state-report ticker) that call
// collectDisks. This mirrors the smartCache pattern used for SMART data
// below. The real-time capacity/usage numbers (syscall.Statfs) are NOT
// cached here and are still computed fresh on every call.
const diskTopologyRefreshInterval = 60 * time.Second

type diskTopology struct {
	diskType      string
	physicalDisks []string
}

var diskTopologyCache = struct {
	mu          sync.Mutex
	byDevice    map[string]diskTopology
	collectedAt time.Time
}{}

func getDiskTopology(device string) diskTopology {
	diskTopologyCache.mu.Lock()
	defer diskTopologyCache.mu.Unlock()
	if diskTopologyCache.byDevice == nil || time.Since(diskTopologyCache.collectedAt) >= diskTopologyRefreshInterval {
		diskTopologyCache.byDevice = make(map[string]diskTopology)
		diskTopologyCache.collectedAt = time.Now()
	}
	if cached, ok := diskTopologyCache.byDevice[device]; ok {
		return cached
	}
	topo := diskTopology{
		diskType:      inferDiskType(device),
		physicalDisks: resolvePhysicalDisks(device),
	}
	diskTopologyCache.byDevice[device] = topo
	return topo
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
		if isNFSFilesystem(fsType) {
			continue
		}
		if isRcloneFuseMount(fsType) {
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

		topo := getDiskTopology(device)
		disks = append(disks, diskState{
			Name:          filepath.Base(device),
			MountPath:     mountPath,
			Type:          topo.diskType,
			Health:        "unknown",
			CapacityGb:    capacityGb,
			UsedGb:        usedGb,
			PhysicalDisks: topo.physicalDisks,
		})
	}

	sort.Slice(disks, func(i, j int) bool {
		return disks[i].MountPath < disks[j].MountPath
	})
	return disks
}

// buildStateReport takes the disks the caller already collected for the
// heartbeat in the same cycle instead of walking /proc/mounts and re-running
// statfs on every mount a second time.
//
// Both slices are forced non-nil: encoding/json writes a nil slice as `null`,
// which control planes before the null-tolerant onStateReport rejected.
func buildStateReport(nodeID string, disks []diskState) stateReport {
	if disks == nil {
		disks = []diskState{}
	}
	smart := collectSmartReports()
	if smart == nil {
		smart = []smartState{}
	}
	return stateReport{
		NodeID:       nodeID,
		Disks:        disks,
		SmartReports: smart,
	}
}

// smartctlOutput captures only the fields we care about from `smartctl -a -j`.
// ATA and NVMe drives populate different sub-objects, so both are optional.
type smartctlOutput struct {
	SmartStatus struct {
		// Pointer, not bool: smartctl omits this key entirely when a device has
		// no real SMART data behind it (e.g. a virtio/virtual disk on a VPS).
		// A plain bool would zero-value to false in that case and read as an
		// explicit failure, which it isn't — see buildSmartState.
		Passed *bool `json:"passed"`
	} `json:"smart_status"`
	Temperature struct {
		Current int `json:"current"`
	} `json:"temperature"`
	PowerOnTime struct {
		Hours int `json:"hours"`
	} `json:"power_on_time"`
	AtaSmartAttributes struct {
		Table []struct {
			ID  int `json:"id"`
			Raw struct {
				Value int64 `json:"value"`
			} `json:"raw"`
		} `json:"table"`
	} `json:"ata_smart_attributes"`
	NvmeLog struct {
		Temperature     int   `json:"temperature"`
		PowerOnHours    int   `json:"power_on_hours"`
		MediaErrors     int64 `json:"media_errors"`
		PercentageUsed  int   `json:"percentage_used"`
		CriticalWarning int   `json:"critical_warning"`
	} `json:"nvme_smart_health_information_log"`
}

const (
	ataAttrReallocatedSectorCt  = 5
	ataAttrCurrentPendingSector = 197
)

func listPhysicalDisks() []string {
	entries, err := os.ReadDir("/sys/block")
	if err != nil {
		return nil
	}
	disks := make([]string, 0, len(entries))
	for _, entry := range entries {
		name := entry.Name()
		if strings.HasPrefix(name, "loop") || strings.HasPrefix(name, "ram") ||
			strings.HasPrefix(name, "dm-") || strings.HasPrefix(name, "md") ||
			strings.HasPrefix(name, "sr") || strings.HasPrefix(name, "zram") {
			continue
		}
		disks = append(disks, name)
	}
	return disks
}

// runSmartctl intentionally ignores the exit code: smartctl encodes SMART
// warnings/failures as exit-status bits rather than a "command failed"
// signal, so any stdout at all is treated as a usable (if degraded) result.
func runSmartctl(device string) []byte {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	out, _ := exec.CommandContext(ctx, "smartctl", "-a", "-j", "/dev/"+device).Output()
	return out
}

func buildSmartState(diskName string, parsed smartctlOutput) smartState {
	temperatureC := parsed.Temperature.Current
	if temperatureC == 0 {
		temperatureC = parsed.NvmeLog.Temperature
	}
	powerOnHours := parsed.PowerOnTime.Hours
	if powerOnHours == 0 {
		powerOnHours = parsed.NvmeLog.PowerOnHours
	}

	hasAtaData := len(parsed.AtaSmartAttributes.Table) > 0
	hasNvmeData := parsed.NvmeLog.PowerOnHours > 0 || parsed.NvmeLog.Temperature > 0 ||
		parsed.NvmeLog.CriticalWarning != 0 || parsed.NvmeLog.MediaErrors > 0 || parsed.NvmeLog.PercentageUsed > 0

	reallocatedSectors := int64(0)
	pendingSectors := int64(0)
	for _, attr := range parsed.AtaSmartAttributes.Table {
		switch attr.ID {
		case ataAttrReallocatedSectorCt:
			reallocatedSectors = attr.Raw.Value
		case ataAttrCurrentPendingSector:
			pendingSectors = attr.Raw.Value
		}
	}
	if !hasAtaData {
		// NVMe has no reallocated/pending sector concept; media errors are
		// the closest equivalent signal of physical media degradation.
		reallocatedSectors = parsed.NvmeLog.MediaErrors
	}

	var overall string
	switch {
	case !hasAtaData && !hasNvmeData:
		// smartctl returned no usable ATA or NVMe attributes at all — typical
		// of a virtualized block device (e.g. a VPS's virtio disk), which has
		// no real physical SMART data behind it. Reporting "critical" off an
		// all-zeroed response here would be a false positive, not an actual
		// disk problem, so leave it unclassified instead of alerting on it.
		overall = "unknown"
	case parsed.SmartStatus.Passed != nil && !*parsed.SmartStatus.Passed:
		overall = "critical"
	case parsed.NvmeLog.CriticalWarning != 0:
		overall = "critical"
	case reallocatedSectors > 0 || pendingSectors > 0:
		overall = "warning"
	case parsed.NvmeLog.PercentageUsed >= 90:
		overall = "warning"
	default:
		overall = "healthy"
	}

	return smartState{
		DiskName:           diskName,
		TemperatureC:       temperatureC,
		ReallocatedSectors: int(reallocatedSectors),
		PendingSectors:     int(pendingSectors),
		PowerOnHours:       powerOnHours,
		Overall:            overall,
	}
}

func gatherSmartReports() []smartState {
	if !commandExists("smartctl") {
		return nil
	}
	reports := make([]smartState, 0)
	for _, name := range listPhysicalDisks() {
		out := runSmartctl(name)
		if len(out) == 0 {
			continue
		}
		var parsed smartctlOutput
		if err := json.Unmarshal(out, &parsed); err != nil {
			continue
		}
		reports = append(reports, buildSmartState(name, parsed))
	}
	return reports
}

// SMART attributes change slowly and `smartctl -a` costs a real disk I/O
// round-trip, so results are cached and refreshed on a much slower cadence
// than the 20s state-report ticker that calls collectSmartReports.
const smartRefreshInterval = 5 * time.Minute

var smartCache = struct {
	mu          sync.Mutex
	reports     []smartState
	collectedAt time.Time
	collected   bool
	refreshing  bool
}{}

// collectSmartReports never blocks its caller on smartctl. gatherSmartReports
// runs `smartctl -a` once per physical disk, each with a 10s timeout, so on a
// multi-disk host a refresh can take tens of seconds - long enough to stall
// the reporting cycle that calls it and, on the very first report, to delay
// the node showing up as online. The refresh therefore happens in a
// background goroutine (one at a time) and callers get whatever is cached,
// which is empty only until the first refresh lands.
func collectSmartReports() []smartState {
	smartCache.mu.Lock()
	defer smartCache.mu.Unlock()
	stale := !smartCache.collected || time.Since(smartCache.collectedAt) >= smartRefreshInterval
	if stale && !smartCache.refreshing {
		smartCache.refreshing = true
		go func() {
			reports := gatherSmartReports()
			smartCache.mu.Lock()
			smartCache.reports = reports
			smartCache.collectedAt = time.Now()
			smartCache.collected = true
			smartCache.refreshing = false
			smartCache.mu.Unlock()
		}()
	}
	return smartCache.reports
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

func readBool(payload map[string]interface{}, key string) bool {
	raw, ok := payload[key]
	if !ok {
		return false
	}
	value, ok := raw.(bool)
	if !ok {
		return false
	}
	return value
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
	privateKey     string
}

type sshIdentity struct {
	publicKey string
	user      string
}

// commandExistsCache memoizes exec.LookPath results: binary presence on the
// host can't change while the agent process is running, but commandExists is
// called once per heartbeat tick and once per overlay peer, so re-scanning
// $PATH every time is wasted work on a host that shares resources with real
// workloads.
var (
	commandExistsMu    sync.Mutex
	commandExistsCache = make(map[string]bool)
)

func commandExists(name string) bool {
	commandExistsMu.Lock()
	if cached, ok := commandExistsCache[name]; ok {
		commandExistsMu.Unlock()
		return cached
	}
	commandExistsMu.Unlock()

	_, err := exec.LookPath(name)
	exists := err == nil

	commandExistsMu.Lock()
	commandExistsCache[name] = exists
	commandExistsMu.Unlock()
	return exists
}

// resetCommandExistsCache drops every memoized lookup. Binary presence can't
// change on its own while the agent runs, but the agent itself installs
// packages (ensureAgentSystemPackages, ensureRclone), and a "not found"
// answer cached from before that install would otherwise stick for the rest
// of the process's life - which is how a node that just had smartmontools
// installed kept reporting no SMART data until its next restart.
func resetCommandExistsCache() {
	commandExistsMu.Lock()
	commandExistsCache = make(map[string]bool)
	commandExistsMu.Unlock()
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
			// Behind NAT (e.g. a cloud VPS with a private interface address)
			// the route source is unreachable from other nodes: report the
			// public address seen from outside instead, when it can be found.
			if isNonPublicIP(ipValue) {
				if publicIP := lookupPublicIPv4(); publicIP != "" {
					ipValue = publicIP
				}
			}
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
		privateKey:     privateKey,
	}, nil
}

// wgSetPrivateKey loads the node's key into iface through stdin rather than
// by path: Ubuntu 26.04's AppArmor profile for wg only lets it open files
// under /etc/wireguard ("fopen: Permission denied" otherwise), while pipes
// stay allowed - wg-quick feeds wg the same way.
func wgSetPrivateKey(iface string, identity *overlayIdentity, listenPort int) ([]byte, error) {
	cmd := exec.Command("wg", "set", iface, "private-key", "/dev/stdin", "listen-port", strconv.Itoa(listenPort))
	cmd.Stdin = strings.NewReader(identity.privateKey + "\n")
	return cmd.CombinedOutput()
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
		"conntrack",
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

	refName := strings.TrimSpace(ref)
	if refName == "" {
		refName = "main"
	}

	// Nodes onboarded via the dashboard use a private repo over an SSH
	// deploy key (see node-onboarding.service.ts), but the agent's own
	// service context has no SSH agent/default identity, so plain git
	// commands can't authenticate. Point git at the same deploy key the
	// onboarding script installs, if present.
	gitEnv := os.Environ()
	if deployKeyPath := agentDeployKeyPath(); deployKeyPath != "" {
		if _, statErr := os.Stat(deployKeyPath); statErr == nil {
			gitEnv = append(gitEnv, fmt.Sprintf(
				"GIT_SSH_COMMAND=ssh -i %s -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new",
				deployKeyPath,
			))
		}
	}

	// fetch + reset --hard instead of pull --ff-only: nodes provisioned with
	// a shallow clone (--depth 1) can have truncated history that git can't
	// prove is a fast-forward even with no real divergence. Since this
	// worktree only ever holds a clean deployment checkout, resetting to
	// origin's tip is safe and side-steps that entirely.
	fetch := exec.CommandContext(ctx, "git", "-C", workDir, "fetch", "--depth", "1", "origin", refName)
	fetch.Env = gitEnv
	if output, fetchErr := fetch.CombinedOutput(); fetchErr != nil {
		return "", fmt.Errorf("cannot fetch repository: %s", strings.TrimSpace(string(output)))
	}

	reset := exec.CommandContext(ctx, "git", "-C", workDir, "reset", "--hard", "origin/"+refName)
	if output, resetErr := reset.CombinedOutput(); resetErr != nil {
		return "", fmt.Errorf("cannot reset repository to origin/%s: %s", refName, strings.TrimSpace(string(output)))
	}

	commitSha := "dev"
	revParseNote := ""
	revParse := exec.CommandContext(ctx, "git", "-C", workDir, "rev-parse", "--short", "HEAD")
	if output, revErr := revParse.CombinedOutput(); revErr == nil {
		if sha := strings.TrimSpace(string(output)); sha != "" {
			commitSha = sha
		} else {
			revParseNote = "git rev-parse returned an empty SHA"
			log.Printf("update_agent: %s in %s", revParseNote, workDir)
		}
	} else {
		revParseNote = fmt.Sprintf("git rev-parse failed: %s", strings.TrimSpace(string(output)))
		log.Printf("update_agent: %s", revParseNote)
	}

	build := exec.CommandContext(ctx, "go", "build", "-ldflags", fmt.Sprintf("-X main.agentVersion=%s", commitSha), "-o", tmpBinPath, ".")
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

	message := fmt.Sprintf("agent updated from %s (version %s); service daemon-reload+restart scheduled", workDir, commitSha)
	if revParseNote != "" {
		message += fmt.Sprintf("; version detection fell back to \"dev\": %s", revParseNote)
	}
	if len(installedPackages) > 0 {
		message += fmt.Sprintf("; installed packages: %s", strings.Join(installedPackages, ", "))
	}
	return message, nil
}

// removeManagedSSHKeysBlock strips the "# BEGIN/END TARMAC MANAGED KEYS" block
// written by applySSHAuthorizedKeys from the target user's authorized_keys,
// mirroring uninstall-agent-service.sh but without shelling out.
func removeManagedSSHKeysBlock(targetUser string) error {
	account, err := user.Lookup(targetUser)
	if err != nil {
		return nil
	}
	homeDir := strings.TrimSpace(account.HomeDir)
	if homeDir == "" {
		return nil
	}
	authorizedKeysPath := filepath.Join(homeDir, ".ssh", "authorized_keys")
	existingRaw, readErr := os.ReadFile(authorizedKeysPath)
	if readErr != nil {
		return nil
	}
	existing := string(existingRaw)

	const beginMarker = "# BEGIN TARMAC MANAGED KEYS"
	const endMarker = "# END TARMAC MANAGED KEYS"
	start := strings.Index(existing, beginMarker)
	end := strings.Index(existing, endMarker)
	if start < 0 || end < start {
		return nil
	}
	end += len(endMarker)
	if end < len(existing) && existing[end] == '\n' {
		end++
	}
	return os.WriteFile(authorizedKeysPath, []byte(existing[:start]+existing[end:]), 0o600)
}

// uninstallAgent tears down everything install-agent-service.sh sets up
// (systemd unit, WireGuard interface, managed SSH keys, binaries, worktree)
// so deleting a node from the dashboard leaves nothing behind on the host.
// Cleanup runs a moment after this returns so the success result can still
// reach the control plane before the service is stopped.
func uninstallAgent(payload map[string]interface{}) (string, error) {
	serviceName := readString(payload, "serviceName")
	if serviceName == "" {
		serviceName = envOrDefault("AGENT_SERVICE_NAME", "tarmac-agent.service")
	}
	if matched, _ := regexp.MatchString(`^[a-zA-Z0-9_.@-]+$`, serviceName); !matched {
		return "", errors.New("serviceName contains invalid characters")
	}
	if !commandExists("systemctl") {
		return "", errors.New("systemctl not found; uninstall cannot be automated")
	}

	sshUser := envOrDefault("AGENT_SSH_USER", "root")
	if err := removeManagedSSHKeysBlock(sshUser); err != nil {
		log.Printf("failed to clean authorized_keys during uninstall: %v", err)
	}

	teardownVpn()

	const wgIface = "tarmacwg0"
	if exec.Command("ip", "link", "show", wgIface).Run() == nil {
		_ = exec.Command("ip", "link", "set", wgIface, "down").Run()
		_ = exec.Command("ip", "link", "delete", "dev", wgIface).Run()
	}

	binPath := envOrDefault("AGENT_BIN_PATH", "/usr/local/bin/tarmac-agent")
	envFile := envOrDefault("AGENT_ENV_FILE", "/etc/tarmac-agent.env")
	serviceFile := filepath.Join("/etc/systemd/system", serviceName)
	sshKeyDir := envOrDefault("AGENT_SSH_KEY_DIR", "/var/lib/tarmac-agent/ssh")
	wgDir := envOrDefault("AGENT_WIREGUARD_DIR", "/var/lib/tarmac-agent/wireguard")
	workDir := envOrDefault("AGENT_WORKTREE_DIR", "/root/.apps/Tarmac")
	const legacyInstallDir = "/opt/tarmac-agent-build"

	cleanupShell := fmt.Sprintf(
		"nohup sh -c 'sleep 1; systemctl disable --now %s >/dev/null 2>&1; ip link delete dev %s >/dev/null 2>&1; rm -rf %s %s %s %s; rm -f %s %s %s; systemctl daemon-reload >/dev/null 2>&1' >/dev/null 2>&1 &",
		serviceName,
		wgIface,
		shellSingleQuote(sshKeyDir), shellSingleQuote(wgDir), shellSingleQuote(workDir), shellSingleQuote(legacyInstallDir),
		shellSingleQuote(binPath), shellSingleQuote(envFile), shellSingleQuote(serviceFile),
	)
	cleanup := exec.Command("sh", "-c", cleanupShell)
	if output, err := cleanup.CombinedOutput(); err != nil {
		return "", fmt.Errorf("uninstall scheduled but cleanup failed to launch: %s", strings.TrimSpace(string(output)))
	}

	return fmt.Sprintf("agent %s uninstall scheduled; service stopping and files being removed", serviceName), nil
}

// rotateAgentToken rewrites the AGENT_TOKEN line in the systemd env file and
// restarts the service so it reconnects with the new token. It never hot-swaps
// the token in the running process: systemd's EnvironmentFile is the single
// source of truth, so a clean restart is more reliable than mutating in-memory
// state and the live WS connection.
func rotateAgentToken(payload map[string]interface{}) (string, error) {
	token := readString(payload, "token")
	if token == "" {
		return "", errors.New("token is required")
	}

	serviceName := envOrDefault("AGENT_SERVICE_NAME", "tarmac-agent.service")
	envFile := envOrDefault("AGENT_ENV_FILE", "/etc/tarmac-agent.env")

	existing, err := os.ReadFile(envFile)
	if err != nil {
		return "", fmt.Errorf("cannot read %s: %w", envFile, err)
	}

	lines := strings.Split(string(existing), "\n")
	replaced := false
	for i, line := range lines {
		if strings.HasPrefix(line, "AGENT_TOKEN=") {
			lines[i] = "AGENT_TOKEN=" + token
			replaced = true
			break
		}
	}
	if !replaced {
		lines = append(lines, "AGENT_TOKEN="+token)
	}

	tmpFile := envFile + ".tmp"
	if err := os.WriteFile(tmpFile, []byte(strings.Join(lines, "\n")), 0o600); err != nil {
		return "", fmt.Errorf("cannot write updated env file: %w", err)
	}
	if err := os.Rename(tmpFile, envFile); err != nil {
		return "", fmt.Errorf("cannot replace env file: %w", err)
	}

	if !commandExists("systemctl") {
		return "", errors.New("systemctl not found; restart cannot be automated")
	}

	restartShell := fmt.Sprintf(
		"nohup sh -c 'sleep 1; if [ \"$(id -u)\" -eq 0 ]; then systemctl restart %s; else sudo systemctl restart %s; fi' >/dev/null 2>&1 &",
		serviceName,
		serviceName,
	)
	restart := exec.Command("sh", "-c", restartShell)
	if output, restartErr := restart.CombinedOutput(); restartErr != nil {
		return "", fmt.Errorf("token updated but restart scheduling failed: %s", strings.TrimSpace(string(output)))
	}

	return "agent token rotated; service restarting to pick it up", nil
}

func ensureAgentSystemPackages(ctx context.Context, packages []string) ([]string, error) {
	if len(packages) == 0 {
		return nil, nil
	}

	missing := make([]string, 0, len(packages))
	checks := map[string]func() bool{
		"git":                  func() bool { return commandExists("git") },
		"golang-go":            func() bool { return commandExists("go") },
		"rsync":                func() bool { return commandExists("rsync") },
		"sshpass":              func() bool { return commandExists("sshpass") },
		"nfs-common":           func() bool { return commandExists("mount.nfs") },
		"nfs-kernel-server":    func() bool { return commandExists("exportfs") },
		"cifs-utils":           func() bool { return commandExists("mount.cifs") },
		"wireguard-tools":      func() bool { return commandExists("wg") },
		"iproute2":             func() bool { return commandExists("ip") },
		"util-linux":           func() bool { return commandExists("mount") },
		"conntrack":            func() bool { return commandExists("conntrack") },
		"smartmontools":        func() bool { return commandExists("smartctl") },
		"pdns-server":          func() bool { return commandExists("pdns_server") },
		"pdns-backend-sqlite3": func() bool { return pdnsSqliteBackendInstalled() },
		"sqlite3":              func() bool { return commandExists("sqlite3") },
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

	// The binaries these packages provide exist now, so any "missing" answer
	// memoized before this install has to go.
	resetCommandExistsCache()

	return missing, nil
}

// rclone isn't in ensureAgentSystemPackages' apt-driven checks map on purpose:
// the apt-packaged version lags far enough behind upstream that `rclone mount`
// features we rely on (systemd notify readiness, --vfs-cache-mode) can be
// missing or buggy. ensureRclone installs/upgrades via the official script
// instead, on demand, the first time a rclone-sftp mount is applied.
const rcloneMinMajor = 1
const rcloneMinMinor = 60

func ensureRclone(ctx context.Context) error {
	if commandExists("rclone") && rcloneVersionSupported() {
		return nil
	}
	if err := installRcloneFromOfficialScript(ctx); err != nil {
		return err
	}
	resetCommandExistsCache()
	return nil
}

func rcloneVersionSupported() bool {
	output, err := exec.Command("rclone", "version").Output()
	if err != nil {
		return false
	}
	firstLine := strings.SplitN(string(output), "\n", 2)[0]
	fields := strings.Fields(firstLine)
	if len(fields) < 2 {
		return false
	}
	major, minor, ok := parseRcloneVersion(fields[1])
	if !ok {
		return false
	}
	if major != rcloneMinMajor {
		return major > rcloneMinMajor
	}
	return minor >= rcloneMinMinor
}

func parseRcloneVersion(raw string) (int, int, bool) {
	trimmed := strings.TrimPrefix(strings.TrimSpace(raw), "v")
	parts := strings.SplitN(trimmed, ".", 3)
	if len(parts) < 2 {
		return 0, 0, false
	}
	major, majorErr := strconv.Atoi(parts[0])
	minor, minorErr := strconv.Atoi(parts[1])
	if majorErr != nil || minorErr != nil {
		return 0, 0, false
	}
	return major, minor, true
}

func installRcloneFromOfficialScript(ctx context.Context) error {
	if !commandExists("curl") {
		return errors.New("curl not found on agent; cannot install rclone")
	}

	var cmd *exec.Cmd
	if os.Geteuid() == 0 {
		cmd = exec.CommandContext(ctx, "sh", "-c", "curl -fsSL https://rclone.org/install.sh | bash")
	} else {
		if !commandExists("sudo") {
			return errors.New("rclone is missing/outdated and sudo is unavailable to install it")
		}
		cmd = exec.CommandContext(ctx, "sh", "-c", "curl -fsSL https://rclone.org/install.sh | sudo bash")
	}

	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("cannot install rclone via official script: %s", strings.TrimSpace(string(output)))
	}
	if !commandExists("rclone") {
		return errors.New("rclone install script completed but rclone binary still not found in PATH")
	}
	return nil
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

	if out, err := wgSetPrivateKey(iface, identity, listenPort); err != nil {
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

	if err := applyOverlayIPForward(readBool(payload, "ipForward")); err != nil {
		return "", err
	}
	if err := applyOverlayForwardFirewallRule(readBool(payload, "ipForward"), iface); err != nil {
		return "", err
	}
	// Never fails the overlay: link supervision is a nice-to-have on top of
	// a working tunnel.
	if err := ensureOverlayProbeRule(iface); err != nil {
		log.Printf("overlay: cannot allow supervision pings on %s: %v", iface, err)
	}

	return fmt.Sprintf("overlay applied on %s with %d peers", iface, len(peers)), nil
}

// overlayForwardSysctlDropIn persists IP forwarding across reboots only while
// this node is a designated VLAN regional gateway (see reconcileOverlayForVlan
// server-side). Regional segmentation routes cross-region traffic through a
// pair of gateway nodes, so the gateway's kernel must forward packets between
// the two WireGuard tunnels sharing the tarmacwg0 interface.
const overlayForwardSysctlDropIn = "/etc/sysctl.d/99-tarmac-overlay-forward.conf"

func applyOverlayIPForward(enabled bool) error {
	if enabled {
		if out, err := exec.Command("sysctl", "-w", "net.ipv4.ip_forward=1").CombinedOutput(); err != nil {
			return fmt.Errorf("cannot enable ip forwarding: %s", strings.TrimSpace(string(out)))
		}
		content := "# Managed by tarmac-agent: this node is a VLAN regional gateway.\nnet.ipv4.ip_forward = 1\n"
		if err := os.WriteFile(overlayForwardSysctlDropIn, []byte(content), 0644); err != nil {
			return fmt.Errorf("cannot persist ip forwarding setting: %w", err)
		}
		return nil
	}

	// No longer a gateway: only remove our own persisted drop-in so a reboot
	// won't re-enable forwarding. Deliberately does NOT force
	// net.ipv4.ip_forward back to 0 on the running kernel — something else on
	// this host (Docker, another VM/router role, ...) may also depend on it
	// being on, and we have no way to know that from here.
	if _, err := os.Stat(overlayForwardSysctlDropIn); err == nil {
		if err := os.Remove(overlayForwardSysctlDropIn); err != nil {
			return fmt.Errorf("cannot remove ip forwarding drop-in: %w", err)
		}
	}
	return nil
}

// overlayForwardRuleComment tags the iptables rule this agent owns, so it can
// find and remove exactly that rule later without touching anything else in
// the chain.
const overlayForwardRuleComment = "tarmac-overlay-forward"

// applyOverlayForwardFirewallRule keeps a gateway's kernel-level ip_forward
// (applyOverlayIPForward) from being silently useless: net.ipv4.ip_forward=1
// only lets the kernel route packets — it says nothing about the firewall's
// FORWARD chain, which most distros default to ACCEPT but which Docker
// unconditionally flips to DROP (and inserts its own DOCKER-USER chain ahead
// of it) as soon as it's installed, regardless of ufw's state. Without an
// explicit ACCEPT here, cross-region traffic relayed through this node's two
// WireGuard tunnels on the overlay interface is silently dropped even though
// wg/sysctl both report everything as configured correctly.
//
// iface must match the interface actually passed to applyOverlay - every
// node today still only ever runs a single "tarmacwg0" interface (one
// workspace per node), but hardcoding that name here regardless of the
// caller's actual interface would silently do nothing (or worse, touch the
// wrong interface) the day a node ever runs a second named overlay.
func applyOverlayForwardFirewallRule(enabled bool, iface string) error {
	if !commandExists("iptables") {
		return nil
	}
	if iface == "" {
		iface = "tarmacwg0"
	}

	spec := []string{"-i", iface, "-o", iface, "-j", "ACCEPT", "-m", "comment", "--comment", overlayForwardRuleComment}
	chains := []string{"FORWARD"}
	// DOCKER-USER is consulted before the plain FORWARD chain whenever Docker
	// manages iptables, and — unlike FORWARD — Docker never rewrites rules
	// already present in it, so a rule inserted here survives Docker/daemon
	// restarts. Only touch it when it actually exists (i.e. Docker is present).
	if exec.Command("iptables", "-L", "DOCKER-USER", "-n").Run() == nil {
		chains = append(chains, "DOCKER-USER")
	}

	for _, chain := range chains {
		exists := exec.Command("iptables", append([]string{"-C", chain}, spec...)...).Run() == nil
		switch {
		case enabled && !exists:
			args := append([]string{"-I", chain}, spec...)
			if out, err := exec.Command("iptables", args...).CombinedOutput(); err != nil {
				return fmt.Errorf("cannot insert overlay forward rule in %s: %s", chain, strings.TrimSpace(string(out)))
			}
		case !enabled && exists:
			args := append([]string{"-D", chain}, spec...)
			if out, err := exec.Command("iptables", args...).CombinedOutput(); err != nil {
				return fmt.Errorf("cannot remove overlay forward rule from %s: %s", chain, strings.TrimSpace(string(out)))
			}
		}
	}
	return nil
}

// overlayProbeRuleComment tags the INPUT rule letting the other nodes'
// supervision pings in over the private network.
const overlayProbeRuleComment = "tarmac-overlay-probe"

// ensureOverlayProbeRule accepts ICMP echo requests arriving on the overlay
// interface, ahead of whatever the host's own firewall does (ufw, a DROP
// policy, a hosting provider's template...). Without it a node that drops
// incoming pings can't be measured by its peers: no latency for that
// direction, and its links read as degraded although the tunnel works.
// Only echo requests, only on the overlay interface - nothing else changes,
// and the replies already go out as ESTABLISHED/RELATED traffic.
func ensureOverlayProbeRule(iface string) error {
	if !commandExists("iptables") {
		return nil
	}
	if iface == "" {
		iface = "tarmacwg0"
	}
	spec := []string{"-i", iface, "-p", "icmp", "--icmp-type", "echo-request", "-m", "comment", "--comment", overlayProbeRuleComment, "-j", "ACCEPT"}
	if exec.Command("iptables", append([]string{"-C", "INPUT"}, spec...)...).Run() == nil {
		return nil
	}
	if out, err := exec.Command("iptables", append([]string{"-I", "INPUT", "1"}, spec...)...).CombinedOutput(); err != nil {
		return fmt.Errorf("%s", strings.TrimSpace(string(out)))
	}
	return nil
}

func isTargetMounted(target string) (string, bool) {
	// --mountpoint requires an exact match on the mount target, unlike
	// --target which also matches any path merely residing on a filesystem
	// (e.g. a fresh, never-mounted directory on the root partition would be
	// reported as "mounted from" the root device).
	cmd := exec.Command("findmnt", "--noheadings", "--output", "SOURCE", "--mountpoint", target)
	output, err := cmd.Output()
	if err != nil {
		return "", false
	}
	source := strings.TrimSpace(string(output))
	return source, source != ""
}

// isRcloneFuseMount matches the "fuse.rclone" fstype that `rclone mount`
// registers in /proc/mounts for Tarmac's remote SFTP mounts (see
// applyRcloneSftpMount). These are remote-backed, not local disks, so they
// must be excluded from collectDisks the same way NFS mounts are.
func isRcloneFuseMount(fsType string) bool {
	normalized := strings.ToLower(strings.TrimSpace(fsType))
	return normalized == "fuse.rclone" || strings.HasPrefix(normalized, "fuse.rclone-")
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

func applyExport(payload map[string]interface{}) (string, error) {
	path := readString(payload, "path")
	if path == "" {
		return "", errors.New("export payload must include path")
	}
	allowedCidr := readString(payload, "allowedCidr")
	if allowedCidr == "" {
		allowedCidr = "10.255.0.0/16"
	}

	if !commandExists("exportfs") {
		installCtx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
		_, err := ensureAgentSystemPackages(installCtx, []string{"nfs-kernel-server"})
		cancel()
		if err != nil {
			return "", fmt.Errorf("exportfs not found and automatic install failed: %w", err)
		}
	}

	if err := os.MkdirAll(path, 0o755); err != nil {
		return "", fmt.Errorf("cannot create export path: %w", err)
	}

	if err := persistExportInEtcExports(path, allowedCidr); err != nil {
		return "", fmt.Errorf("cannot persist NFS export: %w", err)
	}

	if out, err := exec.Command("exportfs", "-ra").CombinedOutput(); err != nil {
		return "", fmt.Errorf("exportfs -ra failed: %s", strings.TrimSpace(string(out)))
	}

	if commandExists("systemctl") {
		if out, err := exec.Command("systemctl", "enable", "--now", "nfs-kernel-server").CombinedOutput(); err != nil {
			return "", fmt.Errorf("cannot enable/start nfs-kernel-server: %s", strings.TrimSpace(string(out)))
		}
	}

	return fmt.Sprintf("exported %s to %s", path, allowedCidr), nil
}

func persistExportInEtcExports(path, allowedCidr string) error {
	const exportsPath = "/etc/exports"
	entry := fmt.Sprintf("%s %s(rw,sync,no_subtree_check,no_root_squash)", path, allowedCidr)

	content, err := os.ReadFile(exportsPath)
	if err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("cannot read %s: %w", exportsPath, err)
	}

	lines := strings.Split(strings.ReplaceAll(string(content), "\r\n", "\n"), "\n")
	kept := make([]string, 0, len(lines))
	found := false
	changed := false

	// Collapse to exactly one export line per path, regardless of how many
	// duplicate/conflicting entries exist (manual edits, previous partial
	// runs, ...). Multiple export lines for the same path confuse nfsd/mountd
	// and can cause spurious "access denied" errors even when the client IP
	// is within the allowed range.
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, "#") {
			kept = append(kept, line)
			continue
		}
		fields := strings.Fields(trimmed)
		if len(fields) == 0 || fields[0] != path {
			kept = append(kept, line)
			continue
		}
		if found {
			changed = true // duplicate export for the same path, drop it
			continue
		}
		found = true
		if trimmed != entry {
			kept = append(kept, entry)
			changed = true
		} else {
			kept = append(kept, line)
		}
	}

	if !found {
		kept = append(kept, entry)
		changed = true
	}

	if !changed {
		return nil
	}

	normalized := strings.TrimRight(strings.Join(kept, "\n"), "\n") + "\n"
	return os.WriteFile(exportsPath, []byte(normalized), 0o644)
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

// removeMount undoes what applyMount did on this node: unmounts the target if
// currently mounted, drops its /etc/fstab entry, and removes the local mount
// point directory if (and only if) it is now empty. It never touches the
// remote NFS/CIFS server or its data — umount only detaches the local view,
// and the directory is removed with os.Remove (not RemoveAll), which refuses
// to delete anything that still has content in it.
func removeMount(payload map[string]interface{}) (string, error) {
	target := readString(payload, "targetPath")
	if target == "" {
		return "", errors.New("remove_mount payload must include targetPath")
	}

	// remove_mount's payload doesn't carry fsType (mounts.service.ts sends
	// just mountId/sourcePath/targetPath), so detect an rclone-managed mount
	// by the presence of its dedicated systemd unit rather than trusting a
	// caller-supplied type.
	if mountID, err := sanitizeMountID(readString(payload, "mountId")); err == nil {
		if _, statErr := os.Stat(filepath.Join("/etc/systemd/system", rcloneServiceName(mountID))); statErr == nil {
			return removeRcloneSftpMount(mountID, target)
		}
	}

	var notes []string

	if _, mounted := isTargetMounted(target); mounted {
		if out, err := exec.Command("umount", target).CombinedOutput(); err != nil {
			if out2, err2 := exec.Command("umount", "-l", target).CombinedOutput(); err2 != nil {
				return "", fmt.Errorf(
					"cannot unmount %s: %s (lazy unmount also failed: %s)",
					target, strings.TrimSpace(string(out)), strings.TrimSpace(string(out2)),
				)
			}
			notes = append(notes, "lazy unmount used (target was busy)")
		} else {
			notes = append(notes, "unmounted")
		}
	} else {
		notes = append(notes, "was not mounted")
	}

	if err := removeMountFromFstab(target); err != nil {
		return "", fmt.Errorf("cannot remove fstab entry: %w", err)
	}
	notes = append(notes, "fstab entry removed")

	if _, stillMounted := isTargetMounted(target); !stillMounted {
		if err := os.Remove(target); err == nil {
			notes = append(notes, "local mount point directory removed")
		} else if !os.IsNotExist(err) {
			notes = append(notes, fmt.Sprintf("kept local directory %s (%s)", target, err.Error()))
		}
	}

	return strings.Join(notes, "; "), nil
}

// removeRcloneSftpMount undoes applyRcloneSftpMount: stops and deletes the
// dedicated systemd unit, unmounts the FUSE mount (fusermount first, lazy
// umount as a fallback for a wedged mount, mirroring removeMount's own
// fallback), drops the rclone remote config, and removes the local mount
// point directory if it's now empty. Like removeMount, this never touches
// the remote host or its data - fusermount/umount only detach the local
// FUSE view.
func removeRcloneSftpMount(mountID, target string) (string, error) {
	var notes []string
	unitName := rcloneServiceName(mountID)
	unitPath := filepath.Join("/etc/systemd/system", unitName)

	if commandExists("systemctl") {
		_ = exec.Command("systemctl", "disable", "--now", unitName).Run()
		notes = append(notes, fmt.Sprintf("%s stopped/disabled", unitName))
	}

	if err := os.Remove(unitPath); err == nil {
		notes = append(notes, "systemd unit removed")
	} else if !os.IsNotExist(err) {
		notes = append(notes, fmt.Sprintf("kept unit file %s (%s)", unitPath, err.Error()))
	}
	if commandExists("systemctl") {
		_ = exec.Command("systemctl", "daemon-reload").Run()
	}

	if _, mounted := isTargetMounted(target); mounted {
		unmounted := false
		if commandExists("fusermount") {
			if out, err := exec.Command("fusermount", "-uz", target).CombinedOutput(); err != nil {
				notes = append(notes, fmt.Sprintf("fusermount failed (%s), trying lazy umount", strings.TrimSpace(string(out))))
			} else {
				notes = append(notes, "unmounted (fusermount)")
				unmounted = true
			}
		}
		if !unmounted {
			if out, err := exec.Command("umount", "-l", target).CombinedOutput(); err != nil {
				return "", fmt.Errorf("cannot unmount %s: %s", target, strings.TrimSpace(string(out)))
			}
			notes = append(notes, "lazy unmount used")
		}
	} else {
		notes = append(notes, "was not mounted")
	}

	remoteName := rcloneRemoteName(mountID)
	if commandExists("rclone") {
		if out, err := exec.Command("rclone", "--config", rcloneConfigPath(), "config", "delete", remoteName).CombinedOutput(); err != nil {
			notes = append(notes, fmt.Sprintf("could not remove rclone remote %s (%s)", remoteName, strings.TrimSpace(string(out))))
		} else {
			notes = append(notes, "rclone remote removed")
		}
	}

	if _, stillMounted := isTargetMounted(target); !stillMounted {
		if err := os.Remove(target); err == nil {
			notes = append(notes, "local mount point directory removed")
		} else if !os.IsNotExist(err) {
			notes = append(notes, fmt.Sprintf("kept local directory %s (%s)", target, err.Error()))
		}
	}

	return strings.Join(notes, "; "), nil
}

func removeMountFromFstab(target string) error {
	const fstabPath = "/etc/fstab"

	content, err := os.ReadFile(fstabPath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return fmt.Errorf("cannot read %s: %w", fstabPath, err)
	}

	lines := strings.Split(strings.ReplaceAll(string(content), "\r\n", "\n"), "\n")
	kept := make([]string, 0, len(lines))
	changed := false

	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, "#") {
			kept = append(kept, line)
			continue
		}

		fields := strings.Fields(trimmed)
		if len(fields) >= 2 && fields[1] == target {
			changed = true
			continue
		}
		kept = append(kept, line)
	}

	if !changed {
		return nil
	}

	normalized := strings.TrimRight(strings.Join(kept, "\n"), "\n") + "\n"
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

	if fsType == "rclone-sftp" {
		return applyRcloneSftpMount(payload, source, target)
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
		installCtx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
		if _, err := ensureAgentSystemPackages(installCtx, []string{"nfs-common"}); err != nil {
			cancel()
			return "", fmt.Errorf("mount.nfs not found and automatic install failed: %w", err)
		}
		cancel()
	}
	if fsType == "cifs" && !commandExists("mount.cifs") {
		installCtx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
		if _, err := ensureAgentSystemPackages(installCtx, []string{"cifs-utils"}); err != nil {
			cancel()
			return "", fmt.Errorf("mount.cifs not found and automatic install failed: %w", err)
		}
		cancel()
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

var mountIDPattern = regexp.MustCompile(`^[a-zA-Z0-9_-]+$`)

// sanitizeMountID guards against a mountId being used to build a systemd
// unit file path or rclone remote name: both are constructed by simple
// string concatenation (not shell-interpreted), but a stray "/" or ".."
// could still escape the intended /etc/systemd/system/ directory.
func sanitizeMountID(id string) (string, error) {
	id = strings.TrimSpace(id)
	if id == "" || !mountIDPattern.MatchString(id) {
		return "", fmt.Errorf("invalid mountId %q", id)
	}
	return id, nil
}

func rcloneRemoteName(mountID string) string {
	return "tarmac-mount-" + mountID
}

func rcloneServiceName(mountID string) string {
	return "tarmac-rclone-" + mountID + ".service"
}

// rcloneConfigPath is passed explicitly (--config) to every rclone
// invocation, both when creating the remote (run by the agent process) and
// in the mount unit's ExecStart (run fresh by systemd). Without an explicit
// path, rclone resolves its config file relative to the calling process's
// user/HOME, which isn't guaranteed to match between those two contexts -
// the remote created by one would then be invisible to the other and the
// mount would fail immediately on start.
func rcloneConfigPath() string {
	return envOrDefault("AGENT_RCLONE_CONFIG_PATH", "/var/lib/tarmac-agent/rclone/rclone.conf")
}

// applyRcloneSftpMount mounts a remote SFTP-only host (e.g. an external
// seedbox with no root access, not a Tarmac node) as a local FUSE mount via
// rclone. Auth reuses the agent's own SSH identity (ensureSSHIdentity) - the
// operator copies its public key into the remote host's authorized_keys once,
// via the dashboard; no seedbox password is ever stored or passed here.
//
// The mount is supervised by a dedicated systemd unit per mount
// (tarmac-rclone-<mountId>.service) using Type=notify + Restart=always -
// rclone mount natively sends the systemd readiness notification once the
// FUSE mount is up, so `systemctl enable --now` blocks until it's actually
// mounted (or fails). This is deliberately NOT rclone's own --daemon mode:
// that forks and detaches, which defeats systemd's ability to supervise and
// restart it on crash like the rest of the Tarmac-managed services.
func applyRcloneSftpMount(payload map[string]interface{}, source, target string) (string, error) {
	mountID, err := sanitizeMountID(readString(payload, "mountId"))
	if err != nil {
		return "", fmt.Errorf("rclone-sftp mount: %w", err)
	}
	remoteHost := strings.TrimSpace(readString(payload, "remoteHost"))
	if remoteHost == "" {
		return "", errors.New("rclone-sftp mount payload must include remoteHost")
	}
	remoteUser := strings.TrimSpace(readString(payload, "remoteUser"))
	if remoteUser == "" {
		remoteUser = "root"
	}
	remoteSshPort := readInt(payload, "remoteSshPort", 22)

	if currentSource, mounted := isTargetMounted(target); mounted {
		return fmt.Sprintf("already mounted (%s -> %s)", currentSource, target), nil
	}

	installCtx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	rcloneErr := ensureRclone(installCtx)
	cancel()
	if rcloneErr != nil {
		return "", fmt.Errorf("rclone not available and automatic install failed: %w", rcloneErr)
	}

	if _, err := ensureSSHIdentity(); err != nil {
		return "", fmt.Errorf("cannot prepare ssh identity for rclone: %w", err)
	}
	privateKeyPath := envOrDefault("AGENT_SSH_PRIVATE_KEY_PATH", "/var/lib/tarmac-agent/ssh/id_ed25519")

	configPath := rcloneConfigPath()
	if err := os.MkdirAll(filepath.Dir(configPath), 0o700); err != nil {
		return "", fmt.Errorf("cannot create rclone config directory: %w", err)
	}

	remoteName := rcloneRemoteName(mountID)
	configArgs := []string{
		"--config", configPath,
		"config", "create", remoteName, "sftp",
		"host", remoteHost,
		"user", remoteUser,
		"port", strconv.Itoa(remoteSshPort),
		"key_file", privateKeyPath,
	}
	if out, err := exec.Command("rclone", configArgs...).CombinedOutput(); err != nil {
		return "", fmt.Errorf("cannot configure rclone remote %s: %s", remoteName, strings.TrimSpace(string(out)))
	}

	if err := os.MkdirAll(target, 0o755); err != nil {
		return "", fmt.Errorf("cannot create target path: %w", err)
	}

	rcloneBinary, err := exec.LookPath("rclone")
	if err != nil {
		return "", errors.New("rclone binary not found in PATH after install")
	}

	unitName := rcloneServiceName(mountID)
	unitPath := filepath.Join("/etc/systemd/system", unitName)
	execStartArgs := []string{
		rcloneBinary, "mount",
		fmt.Sprintf("%s:%s", remoteName, source),
		target,
		"--config", configPath,
		"--allow-other",
		"--vfs-cache-mode=minimal",
	}
	quotedExecStart := make([]string, len(execStartArgs))
	for i, arg := range execStartArgs {
		quotedExecStart[i] = sftpDoubleQuote(arg)
	}
	unitContent := fmt.Sprintf(`[Unit]
Description=Tarmac rclone mount %s
After=network-online.target
Wants=network-online.target

[Service]
Type=notify
ExecStart=%s
ExecStop=/bin/fusermount -uz %s
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
`, mountID, strings.Join(quotedExecStart, " "), sftpDoubleQuote(target))

	if err := os.WriteFile(unitPath, []byte(unitContent), 0o644); err != nil {
		return "", fmt.Errorf("cannot write systemd unit for rclone mount: %w", err)
	}

	if !commandExists("systemctl") {
		return "", errors.New("systemctl not found; cannot manage rclone mount service")
	}
	if out, err := exec.Command("systemctl", "daemon-reload").CombinedOutput(); err != nil {
		return "", fmt.Errorf("systemctl daemon-reload failed: %s", strings.TrimSpace(string(out)))
	}
	if out, err := exec.Command("systemctl", "enable", "--now", unitName).CombinedOutput(); err != nil {
		return "", fmt.Errorf("cannot enable/start %s: %s", unitName, strings.TrimSpace(string(out)))
	}

	if _, mounted := isTargetMounted(target); !mounted {
		return "", fmt.Errorf("%s reported ready but %s is not mounted; check `systemctl status %s`", unitName, target, unitName)
	}

	return fmt.Sprintf("mounted %s:%s on %s via rclone (%s)", remoteName, source, target, unitName), nil
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

// Remote hosts (seedboxes, storage boxes, other nodes) are trusted on first
// use and pinned in the agent's own known_hosts afterwards, instead of
// accepting any key on every connection: a host answering later with
// another key is refused rather than handed the password.
func sshKnownHostsFile() string {
	dir := envOrDefault("AGENT_SSH_KEY_DIR", "/var/lib/tarmac-agent/ssh")
	_ = os.MkdirAll(dir, 0o700)
	return filepath.Join(dir, "known_hosts")
}

func sshHostKeyArgs() []string {
	return []string{"-o", "StrictHostKeyChecking=accept-new", "-o", "UserKnownHostsFile=" + sshKnownHostsFile()}
}

// sshpass reads the password from $SSHPASS with -e, so it never appears in
// the process list the way `sshpass -p <password>` does.
func withSSHPass(cmd *exec.Cmd, password string) *exec.Cmd {
	cmd.Env = append(os.Environ(), "SSHPASS="+password)
	return cmd
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
	if !commandExists("sftp") {
		return nil, errors.New("sftp not found on agent; install OpenSSH client to browse Storage Box endpoints")
	}

	basePath = strings.TrimSpace(basePath)
	if basePath == "" {
		basePath = "/home"
	}
	if !strings.HasPrefix(basePath, "/") {
		return nil, errors.New("basePath must be absolute")
	}

	// Create SFTP batch script
	batchScript := fmt.Sprintf("cd %s\nls -ahl\nquit\n", sftpDoubleQuote(basePath))

	sftpArgs := append([]string{"-P", strconv.Itoa(port)}, sshHostKeyArgs()...)
	sftpArgs = append(sftpArgs, "-o", "ConnectTimeout=10", fmt.Sprintf("%s@%s", username, host))

	ctx, cancel := context.WithTimeout(context.Background(), time.Duration(timeoutMs)*time.Millisecond)
	defer cancel()

	var cmd *exec.Cmd
	if password != "" {
		if !commandExists("sshpass") {
			return nil, errors.New("sshpass not found on agent; reinstall or update the agent to enable password-based storagebox browsing")
		}
		cmd = withSSHPass(exec.CommandContext(ctx, "sshpass", append([]string{"-e", "sftp"}, sftpArgs...)...), password)
	} else {
		sshKeyPath := envOrDefault("AGENT_SSH_PRIVATE_KEY_PATH", "/var/lib/tarmac-agent/ssh/id_ed25519")
		sftpArgs = append([]string{
			"-i", sshKeyPath,
			"-o", "IdentitiesOnly=yes",
			"-o", "BatchMode=yes",
			"-o", "PasswordAuthentication=no",
			"-o", "PreferredAuthentications=publickey",
		}, sftpArgs...)
		cmd = exec.CommandContext(ctx, "sftp", sftpArgs...)
	}
	cmd.Stdin = strings.NewReader(batchScript)

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
		if trimmed == "" || strings.HasPrefix(trimmed, "sftp>") {
			continue
		}

		fields := strings.Fields(trimmed)
		if len(fields) < 9 || !strings.HasPrefix(fields[0], "d") {
			continue
		}
		name := strings.Join(fields[8:], " ")
		if name == "." || name == ".." {
			continue
		}
		directories = append(directories, filepath.Join(basePath, name))
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
		sshArgs := append([]string{"-p", strconv.Itoa(port)}, sshHostKeyArgs()...)
		sshArgs = append(sshArgs,
			"-o", "ConnectTimeout=10",
			fmt.Sprintf("%s@%s", username, host),
			fmt.Sprintf("find %s -mindepth 1 -maxdepth 1 -type d -print 2>/dev/null", shellSingleQuote(basePath)),
		)

		var cmd *exec.Cmd
		ctx, cancel := context.WithTimeout(context.Background(), time.Duration(timeoutMs)*time.Millisecond)
		defer cancel()
		if password != "" {
			if !commandExists("sshpass") {
				return directoryListData{}, errors.New("sshpass not found on agent; reinstall or update the agent to enable password-based seedbox browsing")
			}
			cmd = withSSHPass(exec.CommandContext(ctx, "sshpass", append([]string{"-e", "ssh"}, sshArgs...)...), password)
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

func runRsyncWithProgress(sessionCtx context.Context, payload map[string]interface{}, onProgress func(progress int, message string)) (string, error) {
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
	rsyncPassword := ""
	knownHosts := sshKnownHostsFile()
	if sourceHost != "" {
		sshCommand := fmt.Sprintf(
			"ssh -p %d -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=%s -o ConnectTimeout=%d -o ServerAliveInterval=30 -o ServerAliveCountMax=120 -o TCPKeepAlive=yes",
			sourceSshPort,
			knownHosts,
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
			rsyncPassword = sourcePassword
		}
	}
	if targetHost != "" {
		sshCommand := fmt.Sprintf(
			"ssh -p %d -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=%s -o ConnectTimeout=%d -o ServerAliveInterval=30 -o ServerAliveCountMax=120 -o TCPKeepAlive=yes",
			targetSshPort,
			knownHosts,
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
			rsyncPassword = targetPassword
		}
	}

	// Rooting baseCtx in the caller's sessionCtx (the current session's
	// context) means an in-flight rsync is cancelled both by an explicit
	// stop_rsync command (via registerRsyncExecution's cancel) and, without
	// any extra bookkeeping, by the session ending (reconnect/shutdown) —
	// rsync has no timeout by default, so without this it could otherwise
	// run forever past a dead connection.
	baseCtx, cancel := context.WithCancel(sessionCtx)
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
	cmd := exec.CommandContext(ctx, "rsync", args...)
	if rsyncPassword != "" {
		cmd = withSSHPass(exec.CommandContext(ctx, "sshpass", append([]string{"-e", "rsync"}, args...)...), rsyncPassword)
	}
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

// agentStartupDone is closed once main's background startup housekeeping
// (package checks, DNS/GeoIP re-verification) has finished. Commands wait for
// it so they keep seeing the same fully-verified host they saw when that work
// still ran before the connection was established.
var agentStartupDone = make(chan struct{})

func handleCommand(ctx context.Context, cmd commandPayload, onProgress func(progress commandProgress)) commandResult {
	result := commandResult{Success: true, Message: "ok"}
	if err := ctx.Err(); err != nil {
		result.Success = false
		result.Message = "command not run: session ended before it could start"
		return result
	}
	select {
	case <-agentStartupDone:
	default:
		log.Printf("command %s waiting for agent startup checks to finish", cmd.Type)
		select {
		case <-agentStartupDone:
		case <-ctx.Done():
			result.Success = false
			result.Message = "command not run: session ended while agent startup checks were still running"
			return result
		}
	}
	switch cmd.Type {
	case "command.apply_export":
		result.Command = "apply_export"
		result.ResourceType = "share"
		result.ResourceID = readString(cmd.Payload, "shareId")
		message, err := applyExport(cmd.Payload)
		if err != nil {
			result.Success = false
			result.Message = err.Error()
		} else {
			result.Message = message
		}
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
	case "command.remove_mount":
		result.Command = "remove_mount"
		result.ResourceType = "mount_cleanup"
		result.ResourceID = readString(cmd.Payload, "mountId")
		message, err := removeMount(cmd.Payload)
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
		message, err := runRsyncWithProgress(ctx, cmd.Payload, func(progress int, msg string) {
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
	case "command.apply_vpn":
		result.Command = "apply_vpn"
		result.ResourceType = "vpn"
		// The revision is what the API matches results against.
		result.ResourceID = readString(cmd.Payload, "revision")
		message, active, err := applyVpn(cmd.Payload)
		result.Data = map[string]bool{"vpnActive": active, "vpnPolicy": true}
		if err != nil {
			result.Success = false
			result.Message = err.Error()
		} else {
			result.Message = message
		}
	case "command.apply_firewall":
		result.Command = "apply_firewall"
		result.ResourceType = "firewall"
		// The revision is what the API matches results against.
		result.ResourceID = readString(cmd.Payload, "revision")
		message, active, err := applyFirewall(cmd.Payload)
		result.Data = map[string]bool{"firewallActive": active}
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
	case "command.run_ping":
		result.Command = "run_ping"
		result.ResourceType = "ping"
		result.ResourceID = readString(cmd.Payload, "requestId")
		data, err := runPing(cmd.Payload)
		if err != nil {
			result.Success = false
			result.Message = err.Error()
		} else {
			result.Data = data
			result.Message = fmt.Sprintf("ping %s: %.0f%% loss", data.TargetIP, *data.PacketLoss)
		}
	case "command.run_traceroute":
		result.Command = "run_traceroute"
		result.ResourceType = "traceroute"
		result.ResourceID = readString(cmd.Payload, "requestId")
		if result.ResourceID == "" {
			result.ResourceID = fmt.Sprintf("trace-%d", time.Now().UnixNano())
		}
		data, err := runTraceroute(cmd.Payload)
		if err != nil {
			result.Success = false
			result.Message = err.Error()
		} else {
			result.Data = data
			result.Message = fmt.Sprintf("%d hops", len(data.Hops))
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
	case "command.uninstall_agent":
		result.Command = "uninstall_agent"
		result.ResourceType = "agent"
		result.ResourceID = readString(cmd.Payload, "nodeId")
		if result.ResourceID == "" {
			result.ResourceID = envOrDefault("NODE_ID", "agent")
		}
		message, err := uninstallAgent(cmd.Payload)
		if err != nil {
			result.Success = false
			result.Message = err.Error()
		} else {
			result.Message = message
		}
	case "command.rotate_token":
		result.Command = "rotate_token"
		result.ResourceType = "agent"
		result.ResourceID = envOrDefault("NODE_ID", "agent")
		message, err := rotateAgentToken(cmd.Payload)
		if err != nil {
			result.Success = false
			result.Message = err.Error()
		} else {
			result.Message = message
		}
	case "command.apply_dns_server_group":
		handleApplyDnsServerGroupCommand(ctx, cmd, &result)
	case "command.apply_dns_zone":
		handleApplyDnsZoneCommand(cmd, &result)
	case "command.apply_dns_zone_slave":
		handleApplyDnsZoneSlaveCommand(cmd, &result)
	case "command.remove_dns_zone":
		handleRemoveDnsZoneCommand(cmd, &result)
	case "command.uninstall_dns_node":
		handleUninstallDnsNodeCommand(ctx, cmd, &result)
	case "command.setup_internal_dns":
		handleSetupInternalDnsCommand(ctx, cmd, &result)
	case "command.remove_internal_dns":
		handleRemoveInternalDnsCommand(ctx, cmd, &result)
	case "command.ensure_internal_dns_route":
		handleEnsureInternalDnsRouteCommand(ctx, cmd, &result)
	case "command.resolve_internal_dns_forwarder_conflict":
		handleResolveInternalDnsForwarderConflictCommand(ctx, cmd, &result)
	case "command.dns_get_zone_keys":
		handleDnsGetZoneKeysCommand(cmd, &result)
	case "command.dns_zone_fingerprint":
		handleDnsZoneFingerprintCommand(ctx, cmd, &result)
	case "command.dns_maintenance":
		handleDnsMaintenanceCommand(cmd, &result)
	case "command.dns_resolve_port_conflict":
		handleDnsResolvePortConflictCommand(ctx, cmd, &result)
	default:
		result.Success = false
		result.Message = fmt.Sprintf("unknown command %s", cmd.Type)
	}
	return result
}

// routineCommands are re-sent by the control plane on a fixed tick to
// self-heal drift. Logging every one buried the node's log under identical
// "received/ok" pairs twice a minute, so they're only logged when their
// outcome changes.
var routineCommands = map[string]bool{
	"command.ensure_internal_dns_route": true,
}

var (
	routineResultsMu sync.Mutex
	routineResults   = map[string]string{}
)

func routineResultChanged(commandType, resultMsg string) bool {
	routineResultsMu.Lock()
	defer routineResultsMu.Unlock()
	if routineResults[commandType] == resultMsg {
		return false
	}
	routineResults[commandType] = resultMsg
	return true
}

// redactedURL strips query parameters (which carry the agent auth token)
// before a URL is logged, so the token never lands in journalctl, the
// agent-log stream, or the AgentLog table.
func redactedURL(raw string) string {
	u, err := url.Parse(raw)
	if err != nil {
		return raw
	}
	u.RawQuery = ""
	return u.String()
}

func runSession(ctx context.Context, wsURL string, nodeID string) error {
	log.Printf("connecting to %s", redactedURL(wsURL))
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		return err
	}
	defer conn.Close()

	// Bound how long a stalled read can block: if nothing (not even a pong)
	// arrives within wsReadTimeout, ReadJSON below returns an error and the
	// existing reconnect loop in main() takes over. Every pong pushes the
	// deadline back out, so a healthy connection never trips it.
	if err := conn.SetReadDeadline(time.Now().Add(wsReadTimeout)); err != nil {
		return err
	}
	conn.SetPongHandler(func(string) error {
		return conn.SetReadDeadline(time.Now().Add(wsReadTimeout))
	})

	client := &wsClient{conn: conn}

	// sessionCtx is cancelled as soon as runSession returns (by any path:
	// clean shutdown, read/write error, etc.), independent of the longer-
	// lived ctx passed in from main (which only cancels on process
	// shutdown). It's threaded into handleCommand so an in-flight command
	// is cancelled the moment its session ends instead of continuing to run
	// past a reconnect with nothing left to report its result to.
	sessionCtx, sessionCancel := context.WithCancel(ctx)
	defer sessionCancel()
	logForwarder := newWsLogForwarder(client, nodeID)
	log.SetOutput(io.MultiWriter(os.Stderr, logForwarder))
	defer func() {
		log.SetOutput(os.Stderr)
		logForwarder.stop()
	}()
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
				routine := routineCommands[command.Type]
				if !routine {
					log.Printf("command received: %s", command.Type)
				}
				result := handleCommand(sessionCtx, command, func(progress commandProgress) {
					if err := client.send(envelope{Type: "command_progress", Payload: progress}); err != nil {
						log.Printf("failed to send command_progress: %v", err)
					}
				})
				status := "ok"
				if !result.Success {
					status = "failed"
				}
				resultMsg := fmt.Sprintf("command %s: %s (%s/%s)", status, result.Command, result.ResourceType, result.ResourceID)
				if result.Message != "" {
					resultMsg += ": " + result.Message
				}
				if !routine || routineResultChanged(command.Type, resultMsg) {
					log.Printf("%s", resultMsg)
				}
				if err := client.send(envelope{Type: "command_result", Payload: result}); err != nil {
					select {
					case readDone <- err:
					default:
					}
				}
			}()
		}
	}()

	// Telemetry runs on its own goroutine rather than inline in the select
	// loop below. Gathering a heartbeat is not cheap or bounded by the 5s
	// tick: collectOverlayLinkMetrics shells out to `wg show` and, when a
	// peer's cached RTT has expired, to `ping` (seconds per unreachable
	// peer). Inline, a single slow cycle also delayed the WebSocket ping
	// frames and the reading of command results queued in this same loop,
	// which is exactly how a busy node ended up looking dead to the control
	// plane. Keeping it separate means a slow cycle only skips its own
	// ticks - time.Ticker drops ticks nobody is receiving - instead of
	// piling up work and starving the connection's liveness.
	reportDone := make(chan error, 1)
	go func() {
		c := &collector{}

		// Overlay/SSH identity generation also shells out (wg, ssh-keygen)
		// and only has to happen once per session, so it runs here rather
		// than before the loop starts.
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

		fail := func(err error) {
			select {
			case reportDone <- err:
			default:
			}
		}

		// One ticker for both reports: the state report rides on every
		// stateReportEveryTicks-th heartbeat cycle and reuses that cycle's
		// disks, so /proc/mounts and statfs are walked once per cycle
		// instead of once per report type.
		const stateReportEveryTicks = 4
		sendCycle := func(withState bool) error {
			disks := collectDisks()
			metrics := c.collectMetrics(disks)
			linkMetrics := c.collectOverlayLinkMetrics("tarmacwg0")
			system := collectSystemInfo()
			if err := client.send(envelope{
				Type: "agent.heartbeat",
				Payload: heartbeat{
					NodeID:       nodeID,
					Version:      agentVersion,
					Metrics:      metrics,
					Overlay:      overlay,
					LinkMetrics:  linkMetrics,
					VpnPeers:     collectVpnPeerStats(),
					System:       &system,
					AppliedState: appliedStateSnapshot(),
					Dns:          currentDnsServerReport(),
					DeployKey:    deployKeyPublic(),
					Firewall:     collectFirewallReport(withState),
				},
			}); err != nil {
				return err
			}
			if !withState {
				return nil
			}
			return client.send(envelope{
				Type:    "agent.state_report",
				Payload: buildStateReport(nodeID, disks),
			})
		}

		if err := sendCycle(true); err != nil {
			fail(err)
			return
		}

		ticker := time.NewTicker(5 * time.Second)
		defer ticker.Stop()
		tick := 0
		for {
			select {
			case <-sessionCtx.Done():
				return
			case <-ticker.C:
				tick++
				if err := sendCycle(tick%stateReportEveryTicks == 0); err != nil {
					fail(err)
					return
				}
			}
		}
	}()

	pingTicker := time.NewTicker(wsPingInterval)
	defer pingTicker.Stop()

	for {
		select {
		case <-ctx.Done():
			client.mu.Lock()
			_ = conn.WriteMessage(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.CloseNormalClosure, "shutdown"))
			client.mu.Unlock()
			return nil
		case err := <-readDone:
			return err
		case err := <-reportDone:
			return err
		case <-pingTicker.C:
			if err := client.ping(); err != nil {
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

	// Startup housekeeping runs in the background so it can't hold the
	// control-plane connection hostage. It shells out to apt-get and, on a
	// DNS node, to a backend migration and a GeoIP build: together up to
	// ~13 minutes of timeouts during which the node used to be invisible to
	// the control plane (offline in the UI, no agent logs, no metrics,
	// every command queued). Connecting first means the work is now
	// observable while it happens. Commands still wait for it to finish
	// (see agentStartupDone in handleCommand), so nothing races with it.
	go func() {
		defer close(agentStartupDone)

		if !commandExists("smartctl") {
			installCtx, installCancel := context.WithTimeout(context.Background(), 2*time.Minute)
			if _, err := ensureAgentSystemPackages(installCtx, []string{"smartmontools"}); err != nil {
				log.Printf("smartmontools unavailable, SMART disk health monitoring disabled: %v", err)
			}
			installCancel()
		}

		// This node was previously configured as a DNS server - re-verify
		// PowerDNS/geoip prerequisites and pdns.conf on every restart
		// (including the one triggered by "update agent") so they can't
		// silently go missing after an update. See runDnsStartupRecheck in
		// dns.go.
		runDnsStartupRecheck()
	}()

	// Before connecting: a rebooted node gets its last firewall rules back
	// right away instead of staying open until the control plane answers.
	restoreFirewallAtStartup()
	startFirewallLogReader()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	interrupt := make(chan os.Signal, 1)
	signal.Notify(interrupt, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-interrupt
		cancel()
	}()

	const initialReconnectBackoff = 2 * time.Second
	// A session that stayed up at least this long is considered healthy: the
	// backoff is reset so a later, unrelated blip doesn't inherit a delay
	// that only made sense during an earlier bad patch of reconnects.
	const healthySessionThreshold = 60 * time.Second

	backoff := initialReconnectBackoff
	for {
		select {
		case <-ctx.Done():
			return
		default:
			sessionStart := time.Now()
			err := runSession(ctx, u.String(), nodeID)
			if err == nil || ctx.Err() != nil {
				return
			}
			log.Printf("connection dropped: %v", err)
			if time.Since(sessionStart) >= healthySessionThreshold {
				backoff = initialReconnectBackoff
			}
			time.Sleep(backoff)
			if backoff < 30*time.Second {
				backoff *= 2
			}
		}
	}
}
