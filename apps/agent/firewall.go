package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

// Workspace firewall (command.apply_firewall). Like apply_vpn, every apply
// carries this node's complete desired state and converges to it, so a
// rule change, a reboot or a reconnect are the same operation. The API
// resolves every selector (nodes, labels) into addresses for THIS node: the
// agent only knows "who may reach me, on what".
//
// Rules are enforced where traffic arrives, on the node being protected, so
// a compromised server can't lift them by editing its own firewall.
//
// Tarmac only ever takes access away: allowed traffic RETURNs to the host's
// own chains (ufw, firewalld, Docker...) instead of being ACCEPTed, so a
// port the server itself closes stays closed.
//
// Everything lives in chains named TARMAC-FW-*, jumped to from INPUT and
// DOCKER-USER (ports published by Docker never reach INPUT).
const (
	fwChainIn    = "TARMAC-FW-IN"
	fwChainMesh  = "TARMAC-FW-MESH"
	fwChainPub   = "TARMAC-FW-PUB"
	fwChainDnat  = "TARMAC-FW-DNAT"
	fwChainMeshD = "TARMAC-FW-MESH-D"
	fwChainPubD  = "TARMAC-FW-PUB-D"
	// SSH brute-force limiter: new SSH connections from the internet go
	// through SSH, whose excess is logged and dropped by SSH-X.
	fwChainSSH  = "TARMAC-FW-SSH"
	fwChainSSHX = "TARMAC-FW-SSH-X"
	// Outbound: connections this server opens towards the internet, jumped
	// to from OUTPUT for the uplinks.
	fwChainOut = "TARMAC-FW-OUT"
	fwChainEgr = "TARMAC-FW-EGR"

	fwCommentPrefix = "tarmac-fw"
	// Kernel log prefix of every packet this firewall logs; see fwParseLogLine.
	fwLogTag = "TFW:"
	// Logging is rate-limited per rule: an attack or a scan must not flood
	// the kernel log (nor the dashboard).
	fwLogLimit = "30/min"
	fwLogBurst = "20"
	// Cap on distinct events buffered between two heartbeats.
	fwMaxEvents = 400
	// Per source address (/64 in IPv6): a burst of 20 new SSH connections,
	// then 10 a minute. Excess SYNs are dropped, not rejected, so a person
	// is only slowed down (the client retries), never locked out.
	fwSSHRate  = "10/min"
	fwSSHBurst = "20"
	// Rule id in logs and counters for packets the limiter dropped.
	fwSSHLimitID = "ssh-limit"
)

// Features this agent supports beyond the base firewall, reported so the
// dashboard never claims a protection an older agent ignores.
var fwFeatures = []string{"ssh-limit", "outbound", "countries"}

var (
	fwPortPattern  = regexp.MustCompile(`^([0-9]{1,5})(?:-([0-9]{1,5}))?$`)
	fwRuleIDRegexp = regexp.MustCompile(`^[A-Za-z0-9:_.-]{1,80}$`)
)

type fwRule struct {
	id        string
	sources   []string // CIDRs, empty = any source (the remote end for outbound)
	countries []string // ISO codes matched through ipsets; replaces sources
	protocol  string   // any | tcp | udp | tcpudp | icmp
	ports     []string // "22", "8000-8100"; empty = every port
}

type fwZone struct {
	mode   string // open | observe | enforce
	denies []fwRule
	allows []fwRule
}

func (z fwZone) active() bool {
	return z.mode == "observe" || z.mode == "enforce" || len(z.denies) > 0
}

type fwSSHLimit struct {
	ports  []string // sshd ports
	exempt []string // CIDRs never limited (allowed by an SSH rule)
}

type fwDesired struct {
	revision  string
	meshIface string
	mesh      fwZone
	public    fwZone
	// Connections opened from this server towards the internet.
	outbound fwZone
	// Answer ping from the internet (public zone, when filtered).
	ping bool
	// Throttle new SSH connections from the internet; nil = off.
	sshLimit *fwSSHLimit
}

func (d fwDesired) publicActive() bool {
	return d.public.active() || d.sshLimit != nil
}

func (d fwDesired) active() bool {
	return d.mesh.active() || d.publicActive() || d.outbound.active()
}

// ---------------------------------------------------------------------
// Payload
// ---------------------------------------------------------------------

func fwNormalizeSource(raw string) (string, bool) {
	value := strings.TrimSpace(raw)
	if value == "" {
		return "", false
	}
	if !strings.Contains(value, "/") {
		ip := net.ParseIP(value)
		if ip == nil {
			return "", false
		}
		if ip.To4() != nil {
			return ip.String() + "/32", true
		}
		return ip.String() + "/128", true
	}
	_, network, err := net.ParseCIDR(value)
	if err != nil {
		return "", false
	}
	return network.String(), true
}

func fwValidPort(raw string) bool {
	match := fwPortPattern.FindStringSubmatch(raw)
	if match == nil {
		return false
	}
	low, _ := strconv.Atoi(match[1])
	if low < 1 || low > 65535 {
		return false
	}
	if match[2] != "" {
		high, _ := strconv.Atoi(match[2])
		if high < low || high > 65535 {
			return false
		}
	}
	return true
}

func fwParseRule(raw interface{}) (fwRule, error) {
	record, ok := raw.(map[string]interface{})
	if !ok {
		return fwRule{}, errors.New("invalid rule entry")
	}
	rule := fwRule{
		id:       readString(record, "id"),
		protocol: readString(record, "protocol"),
	}
	if !fwRuleIDRegexp.MatchString(rule.id) {
		return fwRule{}, fmt.Errorf("invalid rule id %q", rule.id)
	}
	switch rule.protocol {
	case "", "any":
		rule.protocol = "any"
	case "tcp", "udp", "tcpudp", "icmp":
	default:
		return fwRule{}, fmt.Errorf("rule %s: invalid protocol %q", rule.id, rule.protocol)
	}
	for _, source := range readStringSlice(record, "sources") {
		normalized, ok := fwNormalizeSource(source)
		if !ok {
			return fwRule{}, fmt.Errorf("rule %s: invalid source %q", rule.id, source)
		}
		rule.sources = append(rule.sources, normalized)
	}
	for _, port := range readStringSlice(record, "ports") {
		port = strings.TrimSpace(port)
		if !fwValidPort(port) {
			return fwRule{}, fmt.Errorf("rule %s: invalid port %q", rule.id, port)
		}
		rule.ports = append(rule.ports, port)
	}
	for _, country := range readStringSlice(record, "countries") {
		country = strings.ToUpper(strings.TrimSpace(country))
		if !fwCountryPattern.MatchString(country) {
			return fwRule{}, fmt.Errorf("rule %s: invalid country %q", rule.id, country)
		}
		rule.countries = append(rule.countries, country)
	}
	if len(rule.countries) > 0 && len(rule.sources) > 0 {
		return fwRule{}, fmt.Errorf("rule %s: countries and sources are exclusive", rule.id)
	}
	// "countries" given but empty must never mean "any source".
	if raw, present := record["countries"]; present {
		if list, ok := raw.([]interface{}); ok && len(list) > 0 && len(rule.countries) == 0 {
			return fwRule{}, fmt.Errorf("rule %s: no valid country", rule.id)
		}
	}
	if len(rule.ports) > 0 && rule.protocol != "tcp" && rule.protocol != "udp" && rule.protocol != "tcpudp" {
		return fwRule{}, fmt.Errorf("rule %s: ports need tcp or udp", rule.id)
	}
	// A rule whose source list was given but came out empty must not turn
	// into "any source".
	if raw, present := record["sources"]; present {
		if list, ok := raw.([]interface{}); ok && len(list) > 0 && len(rule.sources) == 0 {
			return fwRule{}, fmt.Errorf("rule %s: no valid source", rule.id)
		}
	}
	return rule, nil
}

func fwParseZone(payload map[string]interface{}, key string) (fwZone, error) {
	zone := fwZone{mode: "open"}
	raw, ok := payload[key].(map[string]interface{})
	if !ok {
		return zone, nil
	}
	switch mode := readString(raw, "mode"); mode {
	case "", "open", "off":
	case "observe", "enforce":
		zone.mode = mode
	default:
		return zone, fmt.Errorf("%s: invalid mode %q", key, mode)
	}
	for _, field := range []string{"denies", "allows"} {
		entries, _ := raw[field].([]interface{})
		for _, entry := range entries {
			rule, err := fwParseRule(entry)
			if err != nil {
				return zone, fmt.Errorf("%s: %w", key, err)
			}
			if field == "denies" {
				zone.denies = append(zone.denies, rule)
			} else {
				zone.allows = append(zone.allows, rule)
			}
		}
	}
	return zone, nil
}

func parseFirewallPayload(payload map[string]interface{}) (fwDesired, error) {
	desired := fwDesired{
		revision:  readString(payload, "revision"),
		meshIface: readString(payload, "meshInterface"),
		ping:      true,
	}
	if desired.meshIface == "" {
		desired.meshIface = "tarmacwg0"
	}
	if !vpnIfaceNamePattern.MatchString(desired.meshIface) {
		return desired, fmt.Errorf("invalid mesh interface %q", desired.meshIface)
	}
	if raw, ok := payload["ping"].(bool); ok {
		desired.ping = raw
	}
	var err error
	if desired.mesh, err = fwParseZone(payload, "mesh"); err != nil {
		return desired, err
	}
	if desired.public, err = fwParseZone(payload, "public"); err != nil {
		return desired, err
	}
	if desired.outbound, err = fwParseZone(payload, "outbound"); err != nil {
		return desired, err
	}
	if raw, ok := payload["sshLimit"].(map[string]interface{}); ok {
		limit := &fwSSHLimit{}
		for _, port := range readStringSlice(raw, "ports") {
			port = strings.TrimSpace(port)
			if !fwValidPort(port) {
				return desired, fmt.Errorf("sshLimit: invalid port %q", port)
			}
			limit.ports = append(limit.ports, port)
		}
		for _, source := range readStringSlice(raw, "exempt") {
			normalized, ok := fwNormalizeSource(source)
			if !ok {
				return desired, fmt.Errorf("sshLimit: invalid exempt source %q", source)
			}
			limit.exempt = append(limit.exempt, normalized)
		}
		if len(limit.ports) > 0 {
			desired.sshLimit = limit
		}
	}
	return desired, nil
}

// ---------------------------------------------------------------------
// Rule generation (pure, see firewall_test.go)
// ---------------------------------------------------------------------

func fwIsV6(cidr string) bool {
	return strings.Contains(cidr, ":")
}

// fwSourcesFor returns the sources of a rule for one address family: [""]
// for "any source", nil when the rule has no source in that family (and so
// generates nothing there).
func fwSourcesFor(rule fwRule, v6 bool) []string {
	if len(rule.countries) > 0 {
		// Matched through ipsets, see fwMatches.
		return nil
	}
	if len(rule.sources) == 0 {
		return []string{""}
	}
	var out []string
	for _, source := range rule.sources {
		if fwIsV6(source) == v6 {
			out = append(out, source)
		}
	}
	return out
}

func fwProtocols(protocol string, v6 bool) []string {
	switch protocol {
	case "tcpudp":
		return []string{"tcp", "udp"}
	case "icmp":
		if v6 {
			return []string{"ipv6-icmp"}
		}
		return []string{"icmp"}
	case "any":
		return []string{""}
	default:
		return []string{protocol}
	}
}

// fwMatches builds the match part of every iptables rule a Tarmac rule
// expands to. dnat: the packet was DNATed (a Docker published port) - its
// destination port was rewritten, so the port the client asked for is
// matched on the conntrack entry instead.
func fwMatches(rule fwRule, v6, dnat bool) [][]string {
	return fwMatchesDir(rule, v6, dnat, false)
}

// fwMatchesDir: outbound rules name the remote end, so their addresses
// (and countries) match the destination instead of the source.
func fwMatchesDir(rule fwRule, v6, dnat, outbound bool) [][]string {
	addrFlag, setDir := "-s", "src"
	if outbound {
		addrFlag, setDir = "-d", "dst"
	}
	var origins [][]string
	for _, source := range fwSourcesFor(rule, v6) {
		if source == "" {
			origins = append(origins, nil)
		} else {
			origins = append(origins, []string{addrFlag, source})
		}
	}
	for _, country := range rule.countries {
		origins = append(origins, []string{"-m", "set", "--match-set", fwGeoSetName(country, v6), setDir})
	}
	var out [][]string
	for _, origin := range origins {
		for _, proto := range fwProtocols(rule.protocol, v6) {
			if dnat && (proto == "icmp" || proto == "ipv6-icmp") {
				continue
			}
			base := append([]string{}, origin...)
			if proto != "" {
				base = append(base, "-p", proto)
			}
			if len(rule.ports) == 0 || proto == "" || proto == "icmp" || proto == "ipv6-icmp" {
				out = append(out, base)
				continue
			}
			for _, port := range rule.ports {
				iptPort := strings.Replace(port, "-", ":", 1)
				spec := append([]string{}, base...)
				if dnat {
					spec = append(spec, "-m", "conntrack", "--ctorigdstport", iptPort)
				} else {
					spec = append(spec, "--dport", iptPort)
				}
				out = append(out, spec)
			}
		}
	}
	return out
}

func fwComment(id string) []string {
	return []string{"-m", "comment", "--comment", fwCommentPrefix + ":" + id}
}

func fwLogRule(prefix string) []string {
	return []string{"-m", "limit", "--limit", fwLogLimit, "--limit-burst", fwLogBurst, "-j", "LOG", "--log-prefix", prefix + " ", "--log-level", "4"}
}

// fwZoneRules turns a zone into the body of its chain, after the
// infrastructure rules the caller puts first. denyIndex maps a deny rule's
// id to its position in the log prefix ("TFW:R3"), so a logged packet can
// be traced back to the rule that blocked it.
func fwZoneRules(zone fwZone, v6, dnat bool, denyIndex map[string]int, preDefault [][]string) [][]string {
	return fwZoneRulesDir(zone, v6, dnat, false, denyIndex, preDefault)
}

// fwZoneRulesDir: outbound log tags start with "X" (TFW:XB, TFW:XR2...)
// so a logged packet is known to be one this server tried to send.
func fwZoneRulesDir(zone fwZone, v6, dnat, outbound bool, denyIndex map[string]int, preDefault [][]string) [][]string {
	suffix, tag := "", fwLogTag
	if dnat {
		suffix = "d"
	}
	if outbound {
		tag += "X"
	}
	var rules [][]string
	for _, deny := range zone.denies {
		prefix := fmt.Sprintf("%sR%d%s", tag, denyIndex[deny.id], suffix)
		for _, match := range fwMatchesDir(deny, v6, dnat, outbound) {
			rules = append(rules, append(append([]string{}, match...), fwLogRule(prefix)...))
			rules = append(rules, append(append(append([]string{}, match...), fwComment(deny.id)...), "-j", "DROP"))
		}
	}
	if zone.mode == "open" {
		return rules
	}
	rules = append(rules, preDefault...)
	for _, allow := range zone.allows {
		for _, match := range fwMatchesDir(allow, v6, dnat, outbound) {
			rules = append(rules, append(append(append([]string{}, match...), fwComment(allow.id)...), "-j", "RETURN"))
		}
	}
	if zone.mode == "observe" {
		rules = append(rules, fwLogRule(tag+"O"+suffix))
		return rules
	}
	rules = append(rules, fwLogRule(tag+"B"+suffix))
	rules = append(rules, []string{"-m", "comment", "--comment", fwCommentPrefix + ":default", "-j", "DROP"})
	return rules
}

func fwDenyIndex(desired fwDesired) (map[string]int, []string) {
	index := map[string]int{}
	ids := []string{}
	for _, zone := range []fwZone{desired.mesh, desired.public, desired.outbound} {
		for _, deny := range zone.denies {
			if _, ok := index[deny.id]; ok {
				continue
			}
			index[deny.id] = len(ids)
			ids = append(ids, deny.id)
		}
	}
	return index, ids
}

type fwPlan struct {
	chains []vpnChainSpec
	// Chains that must not exist (zone switched off, Docker gone...).
	obsolete []vpnChainSpec
}

// buildFirewallPlan computes every chain for one address family. uplinks
// are the interfaces carrying the default route ("the internet"); docker
// says whether DOCKER-USER exists for this family.
func buildFirewallPlan(desired fwDesired, v6 bool, uplinks []string, docker bool) fwPlan {
	bin := "iptables"
	if v6 {
		bin = "ip6tables"
	}
	denyIndex, _ := fwDenyIndex(desired)
	spec := func(chain string, parents []string) vpnChainSpec {
		return vpnChainSpec{bin: bin, table: "filter", chain: chain, parents: parents}
	}
	in := spec(fwChainIn, []string{"INPUT"})
	mesh := spec(fwChainMesh, nil)
	pub := spec(fwChainPub, nil)
	dnatIn := spec(fwChainDnat, []string{"DOCKER-USER"})
	meshD := spec(fwChainMeshD, nil)
	pubD := spec(fwChainPubD, nil)
	ssh := spec(fwChainSSH, nil)
	sshX := spec(fwChainSSHX, nil)
	out := spec(fwChainOut, []string{"OUTPUT"})
	egr := spec(fwChainEgr, nil)
	all := []vpnChainSpec{in, mesh, pub, dnatIn, meshD, pubD, ssh, sshX, out, egr}

	// The private mesh is IPv4 only.
	meshOn := !v6 && desired.mesh.active()
	pubOn := desired.publicActive() && len(uplinks) > 0
	sshOn := pubOn && desired.sshLimit != nil
	outOn := desired.outbound.active() && len(uplinks) > 0
	if !meshOn && !pubOn && !outOn {
		return fwPlan{obsolete: all}
	}

	established := []string{"-m", "conntrack", "--ctstate", "RELATED,ESTABLISHED", "-j", "RETURN"}
	in.rules = [][]string{{"-i", "lo", "-j", "RETURN"}}
	dnatIn.rules = [][]string{
		{"-m", "conntrack", "!", "--ctstate", "DNAT", "-j", "RETURN"},
		established,
	}

	var plan fwPlan
	if meshOn {
		in.rules = append(in.rules, []string{"-i", desired.meshIface, "-j", fwChainMesh})
		dnatIn.rules = append(dnatIn.rules, []string{"-i", desired.meshIface, "-j", fwChainMeshD})
		mesh.rules = [][]string{
			established,
			// IPIP between VPN entry and exit nodes: decapsulated traffic
			// belongs to VPN clients, filtered by their own entry node.
			{"-p", "4", "-j", "RETURN"},
			// Tarmac's link supervision (ping) and the UDP/9 pokes that keep
			// WireGuard handshakes fresh.
			{"-p", "icmp", "-j", "RETURN"},
			{"-p", "udp", "--dport", "9", "-j", "RETURN"},
		}
		mesh.rules = append(mesh.rules, fwZoneRules(desired.mesh, false, false, denyIndex, nil)...)
		meshD.rules = fwZoneRules(desired.mesh, false, true, denyIndex, nil)
	}
	if pubOn {
		for _, uplink := range uplinks {
			in.rules = append(in.rules, []string{"-i", uplink, "-j", fwChainPub})
			dnatIn.rules = append(dnatIn.rules, []string{"-i", uplink, "-j", fwChainPubD})
		}
		pub.rules = [][]string{established}
		var pre [][]string
		if v6 {
			// Neighbour discovery, router adverts and path MTU all ride on
			// ICMPv6: dropping it breaks IPv6 itself.
			if desired.ping {
				pub.rules = append(pub.rules, []string{"-p", "ipv6-icmp", "-j", "RETURN"})
			} else {
				pub.rules = append(pub.rules, []string{"-p", "ipv6-icmp", "!", "--icmpv6-type", "echo-request", "-j", "RETURN"})
			}
			pub.rules = append(pub.rules,
				[]string{"-d", "ff00::/8", "-j", "RETURN"},
				// DHCPv6 answers a multicast request: conntrack can't pair them.
				[]string{"-p", "udp", "--sport", "547", "--dport", "546", "-j", "RETURN"},
			)
		} else {
			pub.rules = append(pub.rules,
				// Broadcast and multicast are never filtered (nor logged).
				[]string{"-m", "addrtype", "!", "--dst-type", "LOCAL", "-j", "RETURN"},
				[]string{"-p", "udp", "--sport", "67", "--dport", "68", "-j", "RETURN"},
			)
			if desired.ping {
				pre = append(pre, []string{"-p", "icmp", "-j", "RETURN"})
			} else {
				pre = append(pre, []string{"-p", "icmp", "!", "--icmp-type", "echo-request", "-j", "RETURN"})
			}
		}
		if sshOn {
			// Before the zone rules: the SSH guard allows SSH from anyone,
			// and that is exactly the traffic to throttle.
			for _, port := range desired.sshLimit.ports {
				pub.rules = append(pub.rules, []string{"-p", "tcp", "--dport", strings.Replace(port, "-", ":", 1), "-m", "conntrack", "--ctstate", "NEW", "-j", fwChainSSH})
			}
			for _, source := range desired.sshLimit.exempt {
				if fwIsV6(source) == v6 {
					ssh.rules = append(ssh.rules, []string{"-s", source, "-j", "RETURN"})
				}
			}
			name, mask := "tarmac-ssh4", "32"
			if v6 {
				name, mask = "tarmac-ssh6", "64"
			}
			ssh.rules = append(ssh.rules, []string{
				"-m", "hashlimit", "--hashlimit-above", fwSSHRate, "--hashlimit-burst", fwSSHBurst,
				"--hashlimit-mode", "srcip", "--hashlimit-srcmask", mask, "--hashlimit-name", name,
				"-j", fwChainSSHX,
			})
			sshX.rules = [][]string{
				fwLogRule(fwLogTag + "S"),
				append(fwComment(fwSSHLimitID), "-j", "DROP"),
			}
		}
		pub.rules = append(pub.rules, fwZoneRules(desired.public, v6, false, denyIndex, pre)...)
		pubD.rules = fwZoneRules(desired.public, v6, true, denyIndex, nil)
	}

	if outOn {
		out.rules = [][]string{{"-o", "lo", "-j", "RETURN"}}
		for _, uplink := range uplinks {
			out.rules = append(out.rules, []string{"-o", uplink, "-j", fwChainEgr})
		}
		egr.rules = [][]string{
			{"-m", "conntrack", "--ctstate", "RELATED,ESTABLISHED", "-j", "RETURN"},
			// root stays free: the agent itself (its link to Tarmac), package
			// updates... Outbound filtering is about services (a web app, a
			// database) that would phone out once compromised.
			{"-m", "owner", "--uid-owner", "0", "-j", "RETURN"},
			{"-p", "udp", "--dport", "53", "-j", "RETURN"},
			{"-p", "tcp", "--dport", "53", "-j", "RETURN"},
			{"-p", "udp", "--dport", "123", "-j", "RETURN"},
		}
		if v6 {
			egr.rules = append(egr.rules,
				[]string{"-p", "ipv6-icmp", "-j", "RETURN"},
				[]string{"-d", "ff00::/8", "-j", "RETURN"},
				[]string{"-p", "udp", "--dport", "547", "-j", "RETURN"},
			)
		} else {
			egr.rules = append(egr.rules,
				[]string{"-p", "icmp", "-j", "RETURN"},
				[]string{"-m", "addrtype", "--dst-type", "BROADCAST,MULTICAST", "-j", "RETURN"},
				[]string{"-p", "udp", "--dport", "67", "-j", "RETURN"},
			)
		}
		egr.rules = append(egr.rules, fwZoneRulesDir(desired.outbound, v6, false, true, denyIndex, nil)...)
	}

	// Children first, so the jumps to them never point at a missing chain.
	if outOn {
		plan.chains = append(plan.chains, egr, out)
	} else {
		plan.obsolete = append(plan.obsolete, out, egr)
	}
	if sshOn {
		plan.chains = append(plan.chains, sshX, ssh)
	} else {
		plan.obsolete = append(plan.obsolete, ssh, sshX)
	}
	if meshOn {
		plan.chains = append(plan.chains, mesh)
	} else {
		plan.obsolete = append(plan.obsolete, mesh, meshD)
	}
	if pubOn {
		plan.chains = append(plan.chains, pub)
	} else {
		plan.obsolete = append(plan.obsolete, pub, pubD)
	}
	plan.chains = append(plan.chains, in)
	if docker {
		if meshOn {
			plan.chains = append(plan.chains, meshD)
		}
		if pubOn {
			plan.chains = append(plan.chains, pubD)
		}
		plan.chains = append(plan.chains, dnatIn)
	} else {
		plan.obsolete = append(plan.obsolete, dnatIn, meshD, pubD)
	}
	return plan
}

// ---------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------

var (
	fwApplyMu      sync.Mutex
	fwLastRevision string
	// Deny rules already enforced, so already-open connections are only cut
	// once, when a block appears.
	fwEnforcedDenies = map[string]bool{}
	fwStateMu        sync.Mutex
	fwState          = struct {
		revision  string
		denyIDs   []string
		uplinks   []string
		docker    bool
		countries []string
	}{}
)

func firewallStatePath() string {
	return envOrDefault("AGENT_FIREWALL_STATE_PATH", "/var/lib/tarmac-agent/firewall.json")
}

// fwUplinks lists the interfaces of the main table's default routes for a
// family - the ones facing the internet. Tarmac's own interfaces never are.
func fwUplinks(v6 bool) []string {
	args := []string{"-4", "route", "show", "default"}
	if v6 {
		args[0] = "-6"
	}
	out, err := exec.Command("ip", args...).Output()
	if err != nil {
		return nil
	}
	return fwParseUplinks(string(out))
}

func fwParseUplinks(output string) []string {
	seen := map[string]bool{}
	var uplinks []string
	fields := strings.Fields(output)
	for i := 0; i+1 < len(fields); i++ {
		if fields[i] != "dev" {
			continue
		}
		name := fields[i+1]
		if name == "lo" || strings.HasPrefix(name, "tarmac") || strings.HasPrefix(name, vpnTunnelPrefix) || seen[name] {
			continue
		}
		if !vpnIfaceNamePattern.MatchString(name) {
			continue
		}
		seen[name] = true
		uplinks = append(uplinks, name)
	}
	sort.Strings(uplinks)
	return uplinks
}

func fwInstallPlan(plan fwPlan) error {
	for _, spec := range plan.chains {
		if !iptablesChainExists(spec.bin, spec.table, spec.chain) {
			if err := iptablesRun(spec.bin, "-t", spec.table, "-N", spec.chain); err != nil {
				return err
			}
		}
		if err := fwFillChain(spec); err != nil {
			return err
		}
		for _, parent := range spec.parents {
			if err := ensureVpnJump(spec.bin, spec.table, parent, spec.chain); err != nil {
				return err
			}
		}
	}
	// Removed once nothing jumps to them any more: the dispatching chains
	// (those with parents) go first, then the zone chains they pointed at.
	obsolete := append([]vpnChainSpec{}, plan.obsolete...)
	sort.SliceStable(obsolete, func(i, j int) bool { return len(obsolete[i].parents) > len(obsolete[j].parents) })
	seen := map[string]bool{}
	for _, spec := range obsolete {
		if seen[spec.chain] {
			continue
		}
		seen[spec.chain] = true
		removeVpnChains([]vpnChainSpec{spec})
	}
	return nil
}

// Same as fillVpnChain, without its blanket comment: firewall rules carry
// their own (the rule id, read back for the hit counters).
func fwFillChain(spec vpnChainSpec) error {
	if commandExists(spec.bin + "-restore") {
		var script strings.Builder
		fmt.Fprintf(&script, "*%s\n:%s - [0:0]\n", spec.table, spec.chain)
		for _, rule := range spec.rules {
			fmt.Fprintf(&script, "-A %s %s\n", spec.chain, fwQuoteArgs(rule))
		}
		script.WriteString("COMMIT\n")
		cmd := exec.Command(spec.bin+"-restore", "--noflush")
		cmd.Stdin = strings.NewReader(script.String())
		if out, err := cmd.CombinedOutput(); err != nil {
			return fmt.Errorf("%s-restore %s/%s: %s", spec.bin, spec.table, spec.chain, strings.TrimSpace(string(out)))
		}
		return nil
	}
	if err := iptablesRun(spec.bin, "-t", spec.table, "-F", spec.chain); err != nil {
		return err
	}
	for _, rule := range spec.rules {
		if err := iptablesRun(spec.bin, append([]string{"-t", spec.table, "-A", spec.chain}, rule...)...); err != nil {
			return err
		}
	}
	return nil
}

// iptables-restore splits on whitespace, honouring double quotes: the log
// prefix ends with a space and must stay quoted.
func fwQuoteArgs(args []string) string {
	quoted := make([]string, len(args))
	for i, arg := range args {
		if arg == "" || strings.ContainsAny(arg, " \t\"") {
			quoted[i] = `"` + strings.ReplaceAll(arg, `"`, `\"`) + `"`
		} else {
			quoted[i] = arg
		}
	}
	return strings.Join(quoted, " ")
}

func fwMeshAddress(iface string) string {
	out, err := exec.Command("ip", "-4", "-o", "addr", "show", "dev", iface).Output()
	if err != nil {
		return ""
	}
	fields := strings.Fields(string(out))
	for i := 0; i+1 < len(fields); i++ {
		if fields[i] == "inet" {
			return strings.SplitN(fields[i+1], "/", 2)[0]
		}
	}
	return ""
}

// A new block also cuts what it blocks and is already open (an SSH session
// started before the rule): the chains only see new connections.
func fwCutBlockedConnections(desired fwDesired) {
	current := map[string]bool{}
	for _, deny := range desired.mesh.denies {
		current[deny.id] = true
	}
	defer func() { fwEnforcedDenies = current }()
	if !commandExists("conntrack") {
		return
	}
	local := fwMeshAddress(desired.meshIface)
	if local == "" {
		return
	}
	for _, deny := range desired.mesh.denies {
		if fwEnforcedDenies[deny.id] {
			continue
		}
		for _, source := range fwSourcesFor(deny, false) {
			if source == "" || !strings.HasSuffix(source, "/32") {
				continue
			}
			base := []string{"-D", "-s", strings.TrimSuffix(source, "/32"), "-d", local}
			protocols := fwProtocols(deny.protocol, false)
			for _, proto := range protocols {
				if proto == "" {
					_ = exec.Command("conntrack", base...).Run()
					continue
				}
				if len(deny.ports) == 0 || proto == "icmp" {
					_ = exec.Command("conntrack", append(base, "-p", proto)...).Run()
					continue
				}
				for _, port := range deny.ports {
					if strings.Contains(port, "-") {
						continue
					}
					_ = exec.Command("conntrack", append(base, "-p", proto, "--dport", port)...).Run()
				}
			}
		}
	}
}

func applyFirewall(payload map[string]interface{}) (string, bool, error) {
	desired, err := parseFirewallPayload(payload)
	if err != nil {
		return "", false, err
	}

	fwApplyMu.Lock()
	defer fwApplyMu.Unlock()

	if desired.revision != "" && fwLastRevision != "" && desired.revision < fwLastRevision {
		return fmt.Sprintf("revision %s older than applied %s, skipped", desired.revision, fwLastRevision), true, nil
	}
	if !commandExists("iptables") {
		return "", false, errors.New("iptables introuvable sur ce serveur")
	}

	// Country sets must exist (and be filled) before a rule references them.
	countries := fwDesiredCountries(desired)
	if len(countries) > 0 {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
		err := fwEnsureGeoSets(ctx, countries)
		cancel()
		if err != nil {
			return "", true, err
		}
	}

	uplinks4 := fwUplinks(false)
	docker4 := iptablesChainExists("iptables", "filter", "DOCKER-USER")
	if err := fwInstallPlan(buildFirewallPlan(desired, false, uplinks4, docker4)); err != nil {
		return "", true, err
	}

	note := ""
	uplinks6 := []string{}
	if commandExists("ip6tables") {
		uplinks6 = fwUplinks(true)
		docker6 := iptablesChainExists("ip6tables", "filter", "DOCKER-USER")
		if err := fwInstallPlan(buildFirewallPlan(desired, true, uplinks6, docker6)); err != nil {
			// A host with IPv6 disabled has nothing to filter there.
			log.Printf("firewall: ipv6: %v", err)
			note = " (IPv6 non filtré : " + err.Error() + ")"
		}
	} else if desired.publicActive() || desired.outbound.active() {
		note = " (ip6tables absent : IPv6 non filtré)"
	}
	if desired.publicActive() && len(uplinks4) == 0 && len(uplinks6) == 0 {
		note += " (aucune interface Internet détectée : filtrage Internet inactif)"
	}

	fwCutBlockedConnections(desired)
	fwCleanupGeoSets(countries)

	_, denyIDs := fwDenyIndex(desired)
	uplinks := append(append([]string{}, uplinks4...), uplinks6...)
	sort.Strings(uplinks)
	fwStateMu.Lock()
	fwState.revision = desired.revision
	fwState.denyIDs = denyIDs
	fwState.uplinks = fwDedupe(uplinks)
	fwState.docker = docker4
	fwState.countries = countries
	fwStateMu.Unlock()

	if desired.revision != "" {
		fwLastRevision = desired.revision
	}
	fwPersist(payload, desired.active())

	if !desired.active() {
		return "firewall cleared", false, nil
	}
	limiter := "off"
	if desired.sshLimit != nil {
		limiter = "on"
	}
	return fmt.Sprintf("firewall applied: private network %s (%d block(s), %d allow(s)), internet %s (%d block(s), %d allow(s)), outbound %s (%d block(s), %d allow(s)), ssh limit %s%s",
		desired.mesh.mode, len(desired.mesh.denies), len(desired.mesh.allows),
		desired.public.mode, len(desired.public.denies), len(desired.public.allows),
		desired.outbound.mode, len(desired.outbound.denies), len(desired.outbound.allows), limiter, note), true, nil
}

func fwDedupe(values []string) []string {
	out := []string{}
	for i, value := range values {
		if i == 0 || values[i-1] != value {
			out = append(out, value)
		}
	}
	return out
}

// The last applied state is kept on disk and re-applied when the agent
// starts, so a reboot doesn't leave the node open until the control plane
// is reachable again.
func fwPersist(payload map[string]interface{}, active bool) {
	path := firewallStatePath()
	if !active {
		_ = os.Remove(path)
		return
	}
	data, err := json.Marshal(payload)
	if err != nil {
		return
	}
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		log.Printf("firewall: cannot persist state: %v", err)
		return
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0600); err != nil {
		log.Printf("firewall: cannot persist state: %v", err)
		return
	}
	_ = os.Rename(tmp, path)
}

func restoreFirewallAtStartup() {
	data, err := os.ReadFile(firewallStatePath())
	if err != nil {
		return
	}
	var payload map[string]interface{}
	if err := json.Unmarshal(data, &payload); err != nil {
		log.Printf("firewall: saved state unreadable, ignored: %v", err)
		return
	}
	if message, _, err := applyFirewall(payload); err != nil {
		log.Printf("firewall: restoring saved rules failed: %v", err)
	} else {
		log.Printf("firewall: saved rules restored (%s)", message)
	}
}

// ---------------------------------------------------------------------
// Report: listening ports, hit counters, blocked/observed connections
// ---------------------------------------------------------------------

type fwListen struct {
	Protocol  string   `json:"protocol"`
	Port      int      `json:"port"`
	Addresses []string `json:"addresses"`
	Processes []string `json:"processes,omitempty"`
}

type fwEvent struct {
	Verdict  string `json:"verdict"` // blocked | observed
	RuleID   string `json:"ruleId,omitempty"`
	Source   string `json:"source"`
	Dest     string `json:"destination,omitempty"`
	Protocol string `json:"protocol"`
	Port     int    `json:"port,omitempty"`
	Iface    string `json:"interface,omitempty"`
	Docker   bool   `json:"docker,omitempty"`
	// Sent by this server (outbound zone): Dest is the remote end.
	Outbound bool  `json:"outbound,omitempty"`
	Count    int   `json:"count"`
	First    int64 `json:"firstSeen"`
	Last     int64 `json:"lastSeen"`
}

type fwReport struct {
	Revision  string            `json:"revision,omitempty"`
	Uplinks   []string          `json:"uplinks,omitempty"`
	Docker    bool              `json:"docker"`
	Logging   bool              `json:"logging"`
	Listening []fwListen        `json:"listening,omitempty"`
	Counters  map[string]uint64 `json:"counters,omitempty"`
	Events    []fwEvent         `json:"events,omitempty"`
	Features  []string          `json:"features,omitempty"`
	// False on heartbeats carrying only events (see collectFirewallReport).
	Full bool `json:"full"`
}

var (
	fwProcessPattern = regexp.MustCompile(`\("([^"]+)"`)
	fwCounterPattern = regexp.MustCompile(`^\[(\d+):\d+\] -A TARMAC-FW-\S+ .*--comment "?` + fwCommentPrefix + `:([A-Za-z0-9:_.-]+)"?`)
)

// fwParseListening reads `ss -H -tulnp`: one line per socket, local address
// in the 5th column. Loopback-only sockets can't be reached from outside
// and are left out.
func fwParseListening(output string) []fwListen {
	type key struct {
		proto string
		port  int
	}
	byKey := map[key]*fwListen{}
	var order []key
	for _, line := range strings.Split(output, "\n") {
		fields := strings.Fields(line)
		if len(fields) < 5 {
			continue
		}
		proto := fields[0]
		if proto != "tcp" && proto != "udp" {
			continue
		}
		local := fields[4]
		sep := strings.LastIndex(local, ":")
		if sep <= 0 {
			continue
		}
		port, err := strconv.Atoi(local[sep+1:])
		if err != nil || port <= 0 {
			continue
		}
		address := strings.Trim(local[:sep], "[]")
		if zone := strings.Index(address, "%"); zone >= 0 {
			if address[zone+1:] == "lo" {
				continue
			}
			address = address[:zone]
		}
		switch address {
		case "*", "0.0.0.0", "::":
			address = "*"
		}
		if ip := net.ParseIP(address); ip != nil && ip.IsLoopback() {
			continue
		}
		k := key{proto, port}
		entry := byKey[k]
		if entry == nil {
			entry = &fwListen{Protocol: proto, Port: port}
			byKey[k] = entry
			order = append(order, k)
		}
		if !fwContains(entry.Addresses, address) {
			entry.Addresses = append(entry.Addresses, address)
		}
		for _, match := range fwProcessPattern.FindAllStringSubmatch(strings.Join(fields[5:], " "), -1) {
			if !fwContains(entry.Processes, match[1]) {
				entry.Processes = append(entry.Processes, match[1])
			}
		}
	}
	sort.Slice(order, func(i, j int) bool {
		if order[i].port != order[j].port {
			return order[i].port < order[j].port
		}
		return order[i].proto < order[j].proto
	})
	out := []fwListen{}
	for _, k := range order {
		if len(out) >= 200 {
			break
		}
		entry := byKey[k]
		sort.Strings(entry.Addresses)
		out = append(out, *entry)
	}
	return out
}

func fwContains(list []string, value string) bool {
	for _, item := range list {
		if item == value {
			return true
		}
	}
	return false
}

func fwListeningPorts() []fwListen {
	if !commandExists("ss") {
		return nil
	}
	out, err := exec.Command("ss", "-H", "-tulnp").Output()
	if err != nil {
		return nil
	}
	return fwParseListening(string(out))
}

// Packets matched per rule id since the chains were last filled, summed
// over both families and the INPUT/Docker chains.
func fwParseCounters(output string, into map[string]uint64) {
	for _, line := range strings.Split(output, "\n") {
		match := fwCounterPattern.FindStringSubmatch(line)
		if match == nil {
			continue
		}
		packets, err := strconv.ParseUint(match[1], 10, 64)
		if err != nil {
			continue
		}
		into[match[2]] += packets
	}
}

func fwCounters() map[string]uint64 {
	counters := map[string]uint64{}
	for _, bin := range []string{"iptables-save", "ip6tables-save"} {
		if !commandExists(bin) {
			continue
		}
		out, err := exec.Command(bin, "-c", "-t", "filter").Output()
		if err != nil {
			continue
		}
		fwParseCounters(string(out), counters)
	}
	return counters
}

// --- Kernel log -------------------------------------------------------

var fwEvents = struct {
	sync.Mutex
	byKey   map[string]*fwEvent
	logging bool
}{byKey: map[string]*fwEvent{}}

var fwLogFieldPattern = regexp.MustCompile(`\b(IN|OUT|SRC|DST|PROTO|DPT)=(\S*)`)

// fwParseLogLine reads a LOG line written by one of our rules, e.g.
// "TFW:R2 IN=tarmacwg0 OUT= SRC=10.16.0.5 DST=10.16.0.220 ... PROTO=TCP SPT=4000 DPT=22".
func fwParseLogLine(message string, denyIDs []string) (fwEvent, bool) {
	start := strings.Index(message, fwLogTag)
	if start < 0 {
		return fwEvent{}, false
	}
	rest := message[start+len(fwLogTag):]
	space := strings.IndexByte(rest, ' ')
	if space <= 0 {
		return fwEvent{}, false
	}
	tag := rest[:space]
	event := fwEvent{Count: 1}
	if strings.HasPrefix(tag, "X") {
		event.Outbound = true
		tag = strings.TrimPrefix(tag, "X")
	}
	if strings.HasSuffix(tag, "d") {
		event.Docker = true
		tag = strings.TrimSuffix(tag, "d")
	}
	switch {
	case tag == "B":
		event.Verdict = "blocked"
	case tag == "O":
		event.Verdict = "observed"
	case tag == "S":
		event.Verdict = "blocked"
		event.RuleID = fwSSHLimitID
	case strings.HasPrefix(tag, "R"):
		index, err := strconv.Atoi(tag[1:])
		if err != nil {
			return fwEvent{}, false
		}
		event.Verdict = "blocked"
		if index >= 0 && index < len(denyIDs) {
			event.RuleID = denyIDs[index]
		}
	default:
		return fwEvent{}, false
	}
	for _, match := range fwLogFieldPattern.FindAllStringSubmatch(rest[space:], -1) {
		switch match[1] {
		case "IN":
			if !event.Outbound {
				event.Iface = match[2]
			}
		case "OUT":
			if event.Outbound {
				event.Iface = match[2]
			}
		case "SRC":
			event.Source = match[2]
		case "DST":
			event.Dest = match[2]
		case "PROTO":
			event.Protocol = strings.ToLower(match[2])
		case "DPT":
			event.Port, _ = strconv.Atoi(match[2])
		}
	}
	if event.Source == "" || event.Protocol == "" {
		return fwEvent{}, false
	}
	if event.Protocol == "icmpv6" || event.Protocol == "ipv6-icmp" {
		event.Protocol = "icmp"
	}
	return event, true
}

func fwRecordEvent(event fwEvent, at time.Time) {
	key := strings.Join([]string{event.Verdict, event.RuleID, event.Source, event.Dest, event.Protocol, strconv.Itoa(event.Port), event.Iface, strconv.FormatBool(event.Docker), strconv.FormatBool(event.Outbound)}, "|")
	fwEvents.Lock()
	defer fwEvents.Unlock()
	if existing := fwEvents.byKey[key]; existing != nil {
		existing.Count++
		existing.Last = at.Unix()
		return
	}
	if len(fwEvents.byKey) >= fwMaxEvents {
		return
	}
	event.First = at.Unix()
	event.Last = at.Unix()
	fwEvents.byKey[key] = &event
}

func fwDrainEvents() []fwEvent {
	fwEvents.Lock()
	defer fwEvents.Unlock()
	if len(fwEvents.byKey) == 0 {
		return nil
	}
	out := make([]fwEvent, 0, len(fwEvents.byKey))
	for _, event := range fwEvents.byKey {
		out = append(out, *event)
	}
	fwEvents.byKey = map[string]*fwEvent{}
	sort.Slice(out, func(i, j int) bool { return out[i].First < out[j].First })
	return out
}

// Follows /dev/kmsg (one record per read) from its end, for the life of the
// agent. Without it (a container, a locked-down kernel) the firewall still
// works; the dashboard just says connection logging is unavailable.
func startFirewallLogReader() {
	file, err := os.Open("/dev/kmsg")
	if err != nil {
		log.Printf("firewall: kernel log unavailable, blocked connections won't be reported: %v", err)
		return
	}
	if _, err := file.Seek(0, io.SeekEnd); err != nil {
		log.Printf("firewall: kernel log not seekable: %v", err)
	}
	fwEvents.Lock()
	fwEvents.logging = true
	fwEvents.Unlock()
	go func() {
		defer file.Close()
		// Each read returns exactly one record.
		buf := make([]byte, 16384)
		for {
			n, err := file.Read(buf)
			if err != nil {
				// EPIPE: records were overwritten before we read them; the
				// next read resumes at the oldest one still there.
				if errors.Is(err, syscall.EPIPE) || errors.Is(err, syscall.EINTR) {
					continue
				}
				if errors.Is(err, io.EOF) {
					time.Sleep(time.Second)
					continue
				}
				log.Printf("firewall: kernel log read stopped: %v", err)
				fwEvents.Lock()
				fwEvents.logging = false
				fwEvents.Unlock()
				return
			}
			record := string(buf[:n])
			if !strings.Contains(record, fwLogTag) {
				continue
			}
			message := record
			if semi := strings.IndexByte(record, ';'); semi >= 0 {
				message = record[semi+1:]
			}
			if newline := strings.IndexByte(message, '\n'); newline >= 0 {
				message = message[:newline]
			}
			fwStateMu.Lock()
			denyIDs := fwState.denyIDs
			fwStateMu.Unlock()
			if event, ok := fwParseLogLine(message, denyIDs); ok {
				fwRecordEvent(event, time.Now())
			}
		}
	}()
}

// collectFirewallReport rides on the heartbeat. Events go out on every
// heartbeat (they are what someone watching the Activity tab waits for);
// ports and counters, which shell out, only with the periodic state report.
func collectFirewallReport(full bool) *fwReport {
	events := fwDrainEvents()
	fwStateMu.Lock()
	revision := fwState.revision
	uplinks := append([]string{}, fwState.uplinks...)
	docker := fwState.docker
	fwStateMu.Unlock()
	if !full && len(events) == 0 {
		return nil
	}
	fwEvents.Lock()
	logging := fwEvents.logging
	fwEvents.Unlock()
	report := &fwReport{Revision: revision, Events: events, Logging: logging, Full: full}
	if full {
		report.Features = fwFeatures
	}
	if full {
		report.Listening = fwListeningPorts()
		if revision != "" {
			report.Counters = fwCounters()
			report.Uplinks = uplinks
			report.Docker = docker
		} else {
			all := append(fwUplinks(false), fwUplinks(true)...)
			sort.Strings(all)
			report.Uplinks = fwDedupe(all)
			report.Docker = commandExists("iptables") && iptablesChainExists("iptables", "filter", "DOCKER-USER")
		}
	}
	return report
}
