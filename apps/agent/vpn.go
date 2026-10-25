package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net"
	"os"
	"os/exec"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
)

// Client VPN (command.apply_vpn). Every apply carries this node's complete
// desired VPN state - never a delta - and converges to it idempotently, so
// adding a profile, switching its exit, deleting it or recovering after a
// reboot are all the same operation. See VpnService.reconcileWorkspace on
// the API side for how the state is computed.
//
// Everything created here is namespaced so it can be found and removed
// again without touching anything else on the host:
//   - the client WireGuard interface (tarmacvpn0 by default)
//   - IPIP tunnels named tvpn<hash> to the other end of each entry/exit pair
//   - routing tables 21000-28999 and ip rules with priority 20000-20999
//   - iptables chains TARMAC-VPN-*
const (
	vpnRulePrefMesh   = 20000
	vpnRulePrefClient = 20100
	vpnRulePrefMin    = 20000
	vpnRulePrefMax    = 20999
	vpnTableMin       = 21000
	vpnTableMax       = 28999
	vpnTunnelPrefix   = "tvpn"
	// Mesh MTU (1420) minus the 20-byte IPIP header.
	vpnTunnelMTU = 1400
	vpnEntryMTU  = 1420

	vpnChainForward = "TARMAC-VPN-FWD"
	vpnChainInput   = "TARMAC-VPN-IN"
	vpnChainNat     = "TARMAC-VPN-NAT"
	vpnChainMss     = "TARMAC-VPN-MSS"
)

var (
	vpnIfaceNamePattern  = regexp.MustCompile(`^[a-zA-Z0-9_.-]{1,15}$`)
	vpnTunnelNamePattern = regexp.MustCompile(`^tvpn[0-9a-f]{8}$`)
	vpnWgKeyPattern      = regexp.MustCompile(`^[A-Za-z0-9+/]{42}[AEIMQUYcgkosw480]=$`)
)

type vpnClient struct {
	publicKey    string
	presharedKey string
	ip           string
	table        int
}

type vpnEntry struct {
	iface        string
	listenPort   int
	addressCidr  string
	clientSubnet string
	clients      []vpnClient
}

type vpnTunnel struct {
	name          string
	localIP       string
	remoteIP      string
	table         int
	returnSubnets []string
}

type vpnDesired struct {
	revision   string
	meshIface  string
	meshCidr   string
	entry      *vpnEntry
	tunnels    []vpnTunnel
	natSubnets []string
}

func (d vpnDesired) active() bool {
	return d.entry != nil || len(d.tunnels) > 0 || len(d.natSubnets) > 0
}

type vpnPeerStat struct {
	PublicKey       string `json:"publicKey"`
	Endpoint        string `json:"endpoint,omitempty"`
	LatestHandshake int64  `json:"latestHandshake,omitempty"`
	RxBytes         int64  `json:"rxBytes"`
	TxBytes         int64  `json:"txBytes"`
}

// Commands run concurrently (one goroutine each), but two applies racing on
// the same interfaces/rules would interleave their diffs - so they're
// serialized, and an apply older than the last one done is skipped.
var (
	vpnApplyMu       sync.Mutex
	vpnLastRevision  string
	vpnEntryIfaceMu  sync.Mutex
	vpnEntryIfaceCur = "tarmacvpn0"
)

func vpnSysctlDropInPath() string {
	return envOrDefault("AGENT_VPN_SYSCTL_DROPIN", "/etc/sysctl.d/99-tarmac-vpn-forward.conf")
}

func validCidr(value string) bool {
	_, _, err := net.ParseCIDR(value)
	return err == nil
}

func validIPv4(value string) bool {
	ip := net.ParseIP(value)
	return ip != nil && ip.To4() != nil
}

func parseVpnPayload(payload map[string]interface{}) (vpnDesired, error) {
	desired := vpnDesired{
		revision:  readString(payload, "revision"),
		meshIface: readString(payload, "meshInterface"),
		meshCidr:  readString(payload, "meshCidr"),
	}
	if desired.meshIface == "" {
		desired.meshIface = "tarmacwg0"
	}
	if !vpnIfaceNamePattern.MatchString(desired.meshIface) {
		return desired, fmt.Errorf("invalid mesh interface %q", desired.meshIface)
	}

	if rawEntry, ok := payload["entry"].(map[string]interface{}); ok {
		entry := &vpnEntry{
			iface:        readString(rawEntry, "interfaceName"),
			listenPort:   readInt(rawEntry, "listenPort", 51821),
			addressCidr:  readString(rawEntry, "addressCidr"),
			clientSubnet: readString(rawEntry, "clientSubnet"),
		}
		if entry.iface == "" {
			entry.iface = "tarmacvpn0"
		}
		if !vpnIfaceNamePattern.MatchString(entry.iface) || strings.HasPrefix(entry.iface, vpnTunnelPrefix) {
			return desired, fmt.Errorf("invalid vpn interface %q", entry.iface)
		}
		if entry.listenPort <= 0 || entry.listenPort > 65535 {
			return desired, fmt.Errorf("invalid listen port %d", entry.listenPort)
		}
		if !validCidr(entry.addressCidr) || !validCidr(entry.clientSubnet) || !validCidr(desired.meshCidr) {
			return desired, errors.New("invalid vpn addressing (addressCidr, clientSubnet, meshCidr)")
		}
		rawClients, _ := rawEntry["clients"].([]interface{})
		for _, raw := range rawClients {
			record, ok := raw.(map[string]interface{})
			if !ok {
				continue
			}
			client := vpnClient{
				publicKey:    readString(record, "publicKey"),
				presharedKey: readString(record, "presharedKey"),
				ip:           readString(record, "ip"),
				table:        readInt(record, "table", 0),
			}
			if !vpnWgKeyPattern.MatchString(client.publicKey) || !validIPv4(client.ip) {
				return desired, fmt.Errorf("invalid vpn client %q", client.publicKey)
			}
			if client.presharedKey != "" && !vpnWgKeyPattern.MatchString(client.presharedKey) {
				return desired, fmt.Errorf("invalid preshared key for client %s", client.publicKey)
			}
			if client.table != 0 && (client.table < vpnTableMin || client.table > vpnTableMax) {
				return desired, fmt.Errorf("routing table %d out of the managed range", client.table)
			}
			entry.clients = append(entry.clients, client)
		}
		desired.entry = entry
	}

	rawTunnels, _ := payload["tunnels"].([]interface{})
	for _, raw := range rawTunnels {
		record, ok := raw.(map[string]interface{})
		if !ok {
			continue
		}
		tunnel := vpnTunnel{
			name:          readString(record, "name"),
			localIP:       readString(record, "localIp"),
			remoteIP:      readString(record, "remoteIp"),
			table:         readInt(record, "table", 0),
			returnSubnets: readStringSlice(record, "returnSubnets"),
		}
		if !vpnTunnelNamePattern.MatchString(tunnel.name) || !validIPv4(tunnel.localIP) || !validIPv4(tunnel.remoteIP) {
			return desired, fmt.Errorf("invalid vpn tunnel %q", tunnel.name)
		}
		if tunnel.table != 0 && (tunnel.table < vpnTableMin || tunnel.table > vpnTableMax) {
			return desired, fmt.Errorf("routing table %d out of the managed range", tunnel.table)
		}
		for _, subnet := range tunnel.returnSubnets {
			if !validCidr(subnet) {
				return desired, fmt.Errorf("invalid return subnet %q", subnet)
			}
		}
		desired.tunnels = append(desired.tunnels, tunnel)
	}

	for _, subnet := range readStringSlice(payload, "natSubnets") {
		if !validCidr(subnet) {
			return desired, fmt.Errorf("invalid nat subnet %q", subnet)
		}
		desired.natSubnets = append(desired.natSubnets, subnet)
	}
	return desired, nil
}

func runIP(args ...string) error {
	if out, err := exec.Command("ip", args...).CombinedOutput(); err != nil {
		return fmt.Errorf("ip %s: %s", strings.Join(args, " "), strings.TrimSpace(string(out)))
	}
	return nil
}

func linkExists(name string) bool {
	return exec.Command("ip", "link", "show", "dev", name).Run() == nil
}

// applyVpn returns whether this node still carries any VPN state afterwards
// (false = everything was torn down), which lets the API stop sending it
// applies.
func applyVpn(payload map[string]interface{}) (string, bool, error) {
	desired, err := parseVpnPayload(payload)
	if err != nil {
		return "", false, err
	}

	vpnApplyMu.Lock()
	defer vpnApplyMu.Unlock()

	// ISO-8601 timestamps in the same format compare correctly as strings.
	if desired.revision != "" && vpnLastRevision != "" && desired.revision < vpnLastRevision {
		return fmt.Sprintf("revision %s older than applied %s, skipped", desired.revision, vpnLastRevision), true, nil
	}
	if !commandExists("ip") {
		return "", false, errors.New("iproute2 missing (ip command not found)")
	}

	active := desired.active()
	if active {
		if len(desired.tunnels) > 0 && commandExists("modprobe") {
			_ = exec.Command("modprobe", "ipip").Run()
		}
		if err := setVpnIPForward(true); err != nil {
			return "", true, err
		}
	}

	if err := syncVpnTunnels(desired.tunnels); err != nil {
		return "", true, err
	}
	if err := syncVpnEntryInterface(desired.entry); err != nil {
		return "", true, err
	}
	if err := syncVpnRoutes(desired.tunnels); err != nil {
		return "", true, err
	}
	changedClients, err := syncVpnRules(desired)
	if err != nil {
		return "", true, err
	}
	if err := syncVpnFirewall(desired); err != nil {
		return "", true, err
	}
	_ = exec.Command("ip", "route", "flush", "cache").Run()

	// A client whose exit just changed still has conntrack entries NATed to
	// the previous exit; dropping them makes its open connections fail fast
	// and reconnect through the new exit instead of hanging.
	conntrackNote := ""
	if len(changedClients) > 0 {
		if commandExists("conntrack") {
			for _, ip := range changedClients {
				_ = exec.Command("conntrack", "-D", "-s", ip).Run()
			}
		} else {
			conntrackNote = " (conntrack missing: already-open flows keep their old route until they time out)"
		}
	}

	if !active {
		if err := setVpnIPForward(false); err != nil {
			return "", false, err
		}
	}

	if desired.revision != "" {
		vpnLastRevision = desired.revision
	}

	if !active {
		return "vpn state cleared", false, nil
	}
	clients := 0
	if desired.entry != nil {
		clients = len(desired.entry.clients)
	}
	return fmt.Sprintf("vpn applied: %d client(s), %d tunnel(s), %d exit route(s) switched%s",
		clients, len(desired.tunnels), len(changedClients), conntrackNote), true, nil
}

// Same approach as applyOverlayIPForward: persist only our own drop-in, and
// never force ip_forward back off on the running kernel (Docker or another
// role on the host may rely on it).
func setVpnIPForward(enabled bool) error {
	path := vpnSysctlDropInPath()
	if enabled {
		if out, err := exec.Command("sysctl", "-w", "net.ipv4.ip_forward=1").CombinedOutput(); err != nil {
			return fmt.Errorf("cannot enable ip forwarding: %s", strings.TrimSpace(string(out)))
		}
		content := "# Managed by tarmac-agent: this node relays client VPN traffic.\nnet.ipv4.ip_forward = 1\n"
		if err := os.WriteFile(path, []byte(content), 0644); err != nil {
			return fmt.Errorf("cannot persist ip forwarding setting: %w", err)
		}
		return nil
	}
	if _, err := os.Stat(path); err == nil {
		if err := os.Remove(path); err != nil {
			return fmt.Errorf("cannot remove ip forwarding drop-in: %w", err)
		}
	}
	return nil
}

func listVpnTunnelLinks() []string {
	out, err := exec.Command("ip", "-o", "link", "show").Output()
	if err != nil {
		return nil
	}
	names := []string{}
	for _, line := range strings.Split(string(out), "\n") {
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}
		name := strings.TrimSuffix(fields[1], ":")
		if at := strings.Index(name, "@"); at >= 0 {
			name = name[:at]
		}
		if vpnTunnelNamePattern.MatchString(name) {
			names = append(names, name)
		}
	}
	return names
}

func tunnelEndpoints(name string) (local, remote string, ok bool) {
	// `ip tunnel show <missing>` exits 0 on some iproute2 versions.
	if !linkExists(name) {
		return "", "", false
	}
	out, err := exec.Command("ip", "tunnel", "show", name).Output()
	if err != nil {
		return "", "", false
	}
	fields := strings.Fields(string(out))
	for i := 0; i+1 < len(fields); i++ {
		switch fields[i] {
		case "local":
			local = fields[i+1]
		case "remote":
			remote = fields[i+1]
		}
	}
	return local, remote, true
}

func syncVpnTunnels(tunnels []vpnTunnel) error {
	desired := make(map[string]vpnTunnel, len(tunnels))
	for _, tunnel := range tunnels {
		desired[tunnel.name] = tunnel
	}
	for _, name := range listVpnTunnelLinks() {
		if _, keep := desired[name]; !keep {
			if err := runIP("link", "delete", "dev", name); err != nil {
				return err
			}
		}
	}

	for _, tunnel := range tunnels {
		local, remote, exists := tunnelEndpoints(tunnel.name)
		if exists && (local != tunnel.localIP || remote != tunnel.remoteIP) {
			if err := runIP("link", "delete", "dev", tunnel.name); err != nil {
				return err
			}
			exists = false
		}
		if !exists {
			if err := runIP("tunnel", "add", tunnel.name, "mode", "ipip", "local", tunnel.localIP, "remote", tunnel.remoteIP, "ttl", "64"); err != nil {
				return err
			}
		}
		if err := runIP("link", "set", "dev", tunnel.name, "mtu", strconv.Itoa(vpnTunnelMTU), "up"); err != nil {
			return err
		}
		// Return traffic from the internet reaches an entry node through
		// the tunnel while its source is only routable via the default
		// route: strict reverse-path filtering would drop all of it.
		_ = exec.Command("sysctl", "-w", fmt.Sprintf("net.ipv4.conf.%s.rp_filter=2", tunnel.name)).Run()
	}
	return nil
}

func syncVpnEntryInterface(entry *vpnEntry) error {
	vpnEntryIfaceMu.Lock()
	previous := vpnEntryIfaceCur
	if entry != nil {
		vpnEntryIfaceCur = entry.iface
	}
	vpnEntryIfaceMu.Unlock()

	if entry == nil {
		if linkExists(previous) {
			return runIP("link", "delete", "dev", previous)
		}
		return nil
	}
	if previous != entry.iface && linkExists(previous) {
		if err := runIP("link", "delete", "dev", previous); err != nil {
			return err
		}
	}
	if !commandExists("wg") {
		return errors.New("wireguard tools missing (install wireguard-tools)")
	}

	// Same key as the mesh interface: one identity per node, already
	// published to the control plane as overlayPublicKey.
	identity, err := ensureOverlayIdentity()
	if err != nil {
		return err
	}
	iface := entry.iface
	if !linkExists(iface) {
		if err := runIP("link", "add", "dev", iface, "type", "wireguard"); err != nil {
			return err
		}
	}
	if out, err := exec.Command("wg", "set", iface, "private-key", identity.privateKeyPath, "listen-port", strconv.Itoa(entry.listenPort)).CombinedOutput(); err != nil {
		return fmt.Errorf("cannot configure %s: %s", iface, strings.TrimSpace(string(out)))
	}

	addrOut, _ := exec.Command("ip", "-o", "-4", "addr", "show", "dev", iface).Output()
	if !strings.Contains(string(addrOut), " "+entry.addressCidr+" ") {
		_ = exec.Command("ip", "address", "flush", "dev", iface).Run()
		if err := runIP("address", "add", entry.addressCidr, "dev", iface); err != nil {
			return err
		}
	}
	if err := runIP("link", "set", "dev", iface, "mtu", strconv.Itoa(vpnEntryMTU), "up"); err != nil {
		return err
	}

	desired := make(map[string]struct{}, len(entry.clients))
	for _, client := range entry.clients {
		desired[client.publicKey] = struct{}{}
	}
	currentRaw, _ := exec.Command("wg", "show", iface, "peers").Output()
	for _, existing := range strings.Fields(string(currentRaw)) {
		if _, keep := desired[existing]; !keep {
			_, _ = exec.Command("wg", "set", iface, "peer", existing, "remove").CombinedOutput()
		}
	}

	for _, client := range entry.clients {
		args := []string{"set", iface, "peer", client.publicKey, "allowed-ips", client.ip + "/32"}
		var pskPath string
		if client.presharedKey != "" {
			// wg only reads preshared keys from a file, never argv.
			file, err := os.CreateTemp("", "tarmac-vpn-psk-*")
			if err != nil {
				return fmt.Errorf("cannot write preshared key: %w", err)
			}
			pskPath = file.Name()
			_ = file.Chmod(0600)
			_, writeErr := file.WriteString(client.presharedKey + "\n")
			_ = file.Close()
			if writeErr != nil {
				_ = os.Remove(pskPath)
				return fmt.Errorf("cannot write preshared key: %w", writeErr)
			}
			args = append(args, "preshared-key", pskPath)
		}
		out, err := exec.Command("wg", args...).CombinedOutput()
		if pskPath != "" {
			_ = os.Remove(pskPath)
		}
		if err != nil {
			return fmt.Errorf("cannot configure vpn client %s: %s", client.publicKey, strings.TrimSpace(string(out)))
		}
	}
	return nil
}

func syncVpnRoutes(tunnels []vpnTunnel) error {
	desiredTables := map[int]string{}
	desiredReturn := map[string]string{}
	for _, tunnel := range tunnels {
		if tunnel.table != 0 {
			desiredTables[tunnel.table] = tunnel.name
		}
		for _, subnet := range tunnel.returnSubnets {
			desiredReturn[subnet] = tunnel.name
		}
	}

	for table, name := range desiredTables {
		if err := runIP("route", "replace", "default", "dev", name, "table", strconv.Itoa(table)); err != nil {
			return err
		}
	}
	for subnet, name := range desiredReturn {
		if err := runIP("route", "replace", subnet, "dev", name); err != nil {
			return err
		}
	}

	out, err := exec.Command("ip", "-o", "-4", "route", "show", "table", "all").Output()
	if err != nil {
		return nil
	}
	staleTables := map[int]struct{}{}
	for _, line := range strings.Split(string(out), "\n") {
		fields := strings.Fields(line)
		if len(fields) == 0 {
			continue
		}
		table := -1
		dev := ""
		for i := 0; i+1 < len(fields); i++ {
			switch fields[i] {
			case "table":
				if parsed, err := strconv.Atoi(fields[i+1]); err == nil {
					table = parsed
				}
			case "dev":
				dev = fields[i+1]
			}
		}
		if table >= vpnTableMin && table <= vpnTableMax {
			if _, keep := desiredTables[table]; !keep {
				staleTables[table] = struct{}{}
			}
			continue
		}
		// Main-table route through one of our tunnels that is no longer
		// wanted (routes on a deleted tunnel vanish with it already).
		if table == -1 && vpnTunnelNamePattern.MatchString(dev) && desiredReturn[fields[0]] != dev {
			_ = exec.Command("ip", "route", "del", fields[0], "dev", dev).Run()
		}
	}
	for table := range staleTables {
		_ = exec.Command("ip", "route", "flush", "table", strconv.Itoa(table)).Run()
	}
	return nil
}

type vpnRule struct {
	pref  int
	src   string
	dst   string
	table string
}

func (r vpnRule) key() string {
	return fmt.Sprintf("%d|%s|%s|%s", r.pref, r.src, r.dst, r.table)
}

func (r vpnRule) args(action string) []string {
	args := []string{"rule", action, "pref", strconv.Itoa(r.pref)}
	if r.src != "" {
		args = append(args, "from", r.src)
	}
	if r.dst != "" {
		args = append(args, "to", r.dst)
	}
	return append(args, "table", r.table)
}

func normalizeRulePrefix(addr string, length *int) string {
	if addr == "" || addr == "all" {
		return ""
	}
	if length == nil {
		return addr + "/32"
	}
	return fmt.Sprintf("%s/%d", addr, *length)
}

func listManagedVpnRules() ([]vpnRule, error) {
	out, err := exec.Command("ip", "-j", "-4", "rule", "show").Output()
	if err != nil {
		return nil, fmt.Errorf("cannot list ip rules: %w", err)
	}
	var raw []struct {
		Priority int    `json:"priority"`
		Src      string `json:"src"`
		SrcLen   *int   `json:"srclen"`
		Dst      string `json:"dst"`
		DstLen   *int   `json:"dstlen"`
		Table    string `json:"table"`
	}
	if err := json.Unmarshal(out, &raw); err != nil {
		return nil, fmt.Errorf("cannot parse ip rules: %w", err)
	}
	rules := []vpnRule{}
	for _, entry := range raw {
		if entry.Priority < vpnRulePrefMin || entry.Priority > vpnRulePrefMax {
			continue
		}
		rules = append(rules, vpnRule{
			pref:  entry.Priority,
			src:   normalizeRulePrefix(entry.Src, entry.SrcLen),
			dst:   normalizeRulePrefix(entry.Dst, entry.DstLen),
			table: entry.Table,
		})
	}
	return rules, nil
}

// Returns the client IPs whose routing changed (exit switched, added or
// removed), for the conntrack flush in applyVpn.
func syncVpnRules(desired vpnDesired) ([]string, error) {
	want := map[string]vpnRule{}
	if desired.entry != nil {
		// Client traffic to the private mesh never takes a remote exit.
		rule := vpnRule{pref: vpnRulePrefMesh, src: desired.entry.clientSubnet, dst: desired.meshCidr, table: "main"}
		want[rule.key()] = rule
		for _, client := range desired.entry.clients {
			if client.table == 0 {
				continue
			}
			rule := vpnRule{pref: vpnRulePrefClient, src: client.ip + "/32", table: strconv.Itoa(client.table)}
			want[rule.key()] = rule
		}
	}

	existing, err := listManagedVpnRules()
	if err != nil {
		return nil, err
	}
	have := map[string]vpnRule{}
	for _, rule := range existing {
		have[rule.key()] = rule
	}

	changed := map[string]struct{}{}
	for key, rule := range have {
		if _, keep := want[key]; keep {
			continue
		}
		if err := runIP(rule.args("del")...); err != nil {
			return nil, err
		}
		if rule.pref == vpnRulePrefClient {
			changed[strings.TrimSuffix(rule.src, "/32")] = struct{}{}
		}
	}
	keys := make([]string, 0, len(want))
	for key := range want {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		if _, ok := have[key]; ok {
			continue
		}
		rule := want[key]
		if err := runIP(rule.args("add")...); err != nil {
			return nil, err
		}
		if rule.pref == vpnRulePrefClient {
			changed[strings.TrimSuffix(rule.src, "/32")] = struct{}{}
		}
	}

	ips := make([]string, 0, len(changed))
	for ip := range changed {
		ips = append(ips, ip)
	}
	sort.Strings(ips)
	return ips, nil
}

func iptablesRun(args ...string) error {
	if out, err := exec.Command("iptables", args...).CombinedOutput(); err != nil {
		return fmt.Errorf("iptables %s: %s", strings.Join(args, " "), strings.TrimSpace(string(out)))
	}
	return nil
}

func iptablesChainExists(table, chain string) bool {
	return exec.Command("iptables", "-t", table, "-n", "-L", chain).Run() == nil
}

func ensureVpnJump(table, parent, chain string) error {
	if exec.Command("iptables", "-t", table, "-C", parent, "-j", chain).Run() == nil {
		return nil
	}
	return iptablesRun("-t", table, "-I", parent, "1", "-j", chain)
}

func removeVpnJump(table, parent, chain string) {
	for exec.Command("iptables", "-t", table, "-C", parent, "-j", chain).Run() == nil {
		if exec.Command("iptables", "-t", table, "-D", parent, "-j", chain).Run() != nil {
			return
		}
	}
}

type vpnChainSpec struct {
	table   string
	chain   string
	parents []string
	rules   [][]string
}

// Our chains are flushed and refilled on every apply rather than diffed:
// they hold only our own rules, and each is rebuilt in a few milliseconds.
func syncVpnFirewall(desired vpnDesired) error {
	if !commandExists("iptables") {
		return nil
	}

	forwardParents := []string{"FORWARD"}
	// Docker evaluates DOCKER-USER before its own FORWARD DROP policy and
	// never rewrites it - same reasoning as applyOverlayForwardFirewallRule.
	if iptablesChainExists("filter", "DOCKER-USER") {
		forwardParents = append(forwardParents, "DOCKER-USER")
	}

	entryIface := ""
	if desired.entry != nil {
		entryIface = desired.entry.iface
	}
	specs := []vpnChainSpec{
		{table: "filter", chain: vpnChainForward, parents: forwardParents},
		{table: "filter", chain: vpnChainInput, parents: []string{"INPUT"}},
		{table: "nat", chain: vpnChainNat, parents: []string{"POSTROUTING"}},
		{table: "mangle", chain: vpnChainMss, parents: []string{"FORWARD"}},
	}

	if !desired.active() {
		for _, spec := range specs {
			for _, parent := range append(spec.parents, "DOCKER-USER") {
				removeVpnJump(spec.table, parent, spec.chain)
			}
			if iptablesChainExists(spec.table, spec.chain) {
				_ = exec.Command("iptables", "-t", spec.table, "-F", spec.chain).Run()
				_ = exec.Command("iptables", "-t", spec.table, "-X", spec.chain).Run()
			}
		}
		return nil
	}

	tunnels := vpnTunnelPrefix + "+"
	clamp := []string{"-p", "tcp", "--tcp-flags", "SYN,RST", "SYN", "-j", "TCPMSS", "--clamp-mss-to-pmtu"}
	specs[0].rules = [][]string{{"-i", tunnels, "-j", "ACCEPT"}, {"-o", tunnels, "-j", "ACCEPT"}}
	specs[3].rules = [][]string{append([]string{"-o", tunnels}, clamp...)}
	if entryIface != "" {
		specs[0].rules = append(specs[0].rules, []string{"-i", entryIface, "-j", "ACCEPT"}, []string{"-o", entryIface, "-j", "ACCEPT"})
		specs[1].rules = append(specs[1].rules, []string{"-p", "udp", "--dport", strconv.Itoa(desired.entry.listenPort), "-j", "ACCEPT"})
		specs[3].rules = append(specs[3].rules, append([]string{"-o", entryIface}, clamp...))
	}
	if len(desired.tunnels) > 0 {
		// IPIP (protocol 4) between entry and exit arrives over the mesh.
		specs[1].rules = append(specs[1].rules, []string{"-i", desired.meshIface, "-p", "4", "-j", "ACCEPT"})
	}
	for _, subnet := range desired.natSubnets {
		// Client-to-client and entry->exit relaying keep the client's own
		// address; anything leaving elsewhere (internet, mesh) is NATed.
		if entryIface != "" {
			specs[2].rules = append(specs[2].rules, []string{"-s", subnet, "-o", entryIface, "-j", "RETURN"})
		}
		specs[2].rules = append(specs[2].rules,
			[]string{"-s", subnet, "-o", tunnels, "-j", "RETURN"},
			[]string{"-s", subnet, "-j", "MASQUERADE"},
		)
	}

	for _, spec := range specs {
		if !iptablesChainExists(spec.table, spec.chain) {
			if err := iptablesRun("-t", spec.table, "-N", spec.chain); err != nil {
				return err
			}
		}
		if err := iptablesRun("-t", spec.table, "-F", spec.chain); err != nil {
			return err
		}
		for _, rule := range spec.rules {
			args := append([]string{"-t", spec.table, "-A", spec.chain}, rule...)
			args = append(args, "-m", "comment", "--comment", "tarmac-vpn")
			if err := iptablesRun(args...); err != nil {
				return err
			}
		}
		for _, parent := range spec.parents {
			if err := ensureVpnJump(spec.table, parent, spec.chain); err != nil {
				return err
			}
		}
	}
	return nil
}

// Live sessions on this node's client interface, reported with every
// heartbeat (handshake age, endpoint and byte counters per client).
func collectVpnPeerStats() []vpnPeerStat {
	vpnEntryIfaceMu.Lock()
	iface := vpnEntryIfaceCur
	vpnEntryIfaceMu.Unlock()
	if !commandExists("wg") || !linkExists(iface) {
		return nil
	}
	out, err := exec.Command("wg", "show", iface, "dump").Output()
	if err != nil {
		return nil
	}
	lines := strings.Split(strings.TrimSpace(string(out)), "\n")
	stats := []vpnPeerStat{}
	// First line describes the interface itself.
	for _, line := range lines[1:] {
		fields := strings.Split(line, "\t")
		if len(fields) < 7 {
			continue
		}
		handshake, _ := strconv.ParseInt(fields[4], 10, 64)
		rx, _ := strconv.ParseInt(fields[5], 10, 64)
		tx, _ := strconv.ParseInt(fields[6], 10, 64)
		stat := vpnPeerStat{PublicKey: fields[0], LatestHandshake: handshake, RxBytes: rx, TxBytes: tx}
		if fields[2] != "(none)" {
			stat.Endpoint = fields[2]
		}
		stats = append(stats, stat)
	}
	return stats
}

func teardownVpn() {
	if _, _, err := applyVpn(map[string]interface{}{}); err != nil {
		log.Printf("vpn teardown failed: %v", err)
	}
}
