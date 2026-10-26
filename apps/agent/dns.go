package main

import (
	"bytes"
	"compress/gzip"
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

type dnsGlueEntry struct {
	Host string
	IP   string
}

func readGlueEntries(payload map[string]interface{}, key string) []dnsGlueEntry {
	raw, ok := payload[key]
	if !ok {
		return nil
	}
	entries, ok := raw.([]interface{})
	if !ok {
		return nil
	}
	result := make([]dnsGlueEntry, 0, len(entries))
	for _, entry := range entries {
		entryMap, ok := entry.(map[string]interface{})
		if !ok {
			continue
		}
		host := readString(entryMap, "host")
		ip := readString(entryMap, "ip")
		if host == "" || ip == "" {
			continue
		}
		result = append(result, dnsGlueEntry{Host: host, IP: ip})
	}
	return result
}

// ---------------------------------------------------------------------
// DNS server groups + zones (PowerDNS)
//
// The agent installs and drives PowerDNS locally via its REST API
// (127.0.0.1:8081) - the control plane never talks to PowerDNS directly,
// same "push desired state over the agent's outbound WebSocket" model as
// apply_mount/apply_pool/apply_overlay. Each node has its own local SQLite
// backend; zone data is physically replicated primary -> secondary via
// PowerDNS's own AXFR/IXFR, over the WireGuard VLAN mesh, so a secondary
// keeps answering correctly even if this agent or the control plane is
// down.
// ---------------------------------------------------------------------

// dnsPort53Mu serializes every agent command handler that can touch port 53
// itself (installing/removing PowerDNS or the dnsmasq fallback forwarder,
// resolving a port conflict, writing the /etc/hosts fallback block) or the
// dnsMarkerPath/internalDnsForwarderMarkerPath state that tracks who owns
// it. Every incoming command runs in its own goroutine (see main.go's
// command dispatch loop), so without this, e.g. a routine
// ensure_internal_dns_route tick landing mid-way through an
// apply_dns_server_group's `apt install pdns-server` could probe port 53
// while a concurrent operation is still claiming it, producing a spurious
// conflict or a corrupted config. Acquired at the top of each relevant
// handleXCommand function in this file - see their doc comments.
var dnsPort53Mu sync.Mutex

const (
	pdnsConfigPath        = "/etc/powerdns/pdns.conf"
	pdnsApiKeyPath        = "/etc/powerdns/tarmac-api-key"
	pdnsApiBaseURL        = "http://127.0.0.1:8081/api/v1/servers/localhost"
	pdnsSqliteDbPath      = "/var/lib/powerdns/pdns.sqlite3"
	pdnsLmdbFilePath      = "/var/lib/powerdns/pdns.lmdb"
	pdnsBackendMarkerPath = "/etc/tarmac-agent/pdns-backend"
	dnsMarkerPath         = "/etc/tarmac-agent/dns-enabled"
	geoipDatabaseDir      = "/usr/share/GeoIP"

	// Dedicated second PowerDNS instance serving *.tarmac.local for the
	// fleet's own internal name resolution - see internal-dns.service.ts on
	// the API side. Fully independent of the "normal" pdns instance above
	// (own config file, database, API port, systemd unit, non-standard DNS
	// port) - launched via `pdns_server --config-name=internal
	// --config-dir=/etc/powerdns`, which PowerDNS resolves to
	// pdns-internal.conf and its own separate control socket/PID (verified
	// empirically: running both --config-name=internal and the default
	// instance side by side on one box, no collision). Never touches port
	// 53, so it never needs the port-conflict probe/kill flow the normal
	// instance uses.
	internalPdnsConfigPath   = "/etc/powerdns/pdns-internal.conf"
	internalPdnsApiKeyPath   = "/etc/powerdns/tarmac-internal-api-key"
	internalPdnsSqliteDbPath = "/var/lib/powerdns/pdns-internal.sqlite3"
	internalPdnsSystemdUnit  = "pdns-internal"
	internalDnsMarkerPath    = "/etc/tarmac-agent/internal-dns-enabled"
	internalDnsZoneName      = "tarmac.local."
)

type dnsPortConflict struct {
	Port        int    `json:"port"`
	Protocol    string `json:"protocol"`
	PID         *int   `json:"pid"`
	ProcessName string `json:"processName"`
}

type dnsServerGroupApplyData struct {
	PortConflict     *dnsPortConflict `json:"portConflict,omitempty"`
	DnsTsigKeySecret string           `json:"dnsTsigKeySecret,omitempty"`
}

type dnsZoneKeysData struct {
	DsRecords     []string `json:"dsRecords"`
	DnskeyRecords []string `json:"dnskeyRecords"`
}

type dnsZoneKeysResultData struct {
	Dns dnsZoneKeysData `json:"dns"`
}

func pdnsSqliteBackendInstalled() bool {
	matches, _ := filepath.Glob("/usr/lib/*/pdns/libgsqlite3backend.so")
	return len(matches) > 0
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}

// probeDnsPortConflict checks whether port 53 tcp/udp is already bound by
// something other than an already-running PowerDNS - an idempotent
// re-apply finding its own listener isn't a conflict.
func probeDnsPortConflict() *dnsPortConflict {
	if commandExists("systemctl") {
		if err := exec.Command("systemctl", "is-active", "--quiet", "pdns").Run(); err == nil {
			return nil
		}
	}
	if conflict := probePortBinding(53, "tcp"); conflict != nil {
		return conflict
	}
	return probePortBinding(53, "udp")
}

func probePortBinding(port int, protocol string) *dnsPortConflict {
	var bound bool
	switch protocol {
	case "tcp":
		ln, err := net.Listen("tcp", fmt.Sprintf(":%d", port))
		if err != nil {
			bound = true
		} else {
			ln.Close()
		}
	case "udp":
		pc, err := net.ListenPacket("udp", fmt.Sprintf(":%d", port))
		if err != nil {
			bound = true
		} else {
			pc.Close()
		}
	}
	if !bound {
		return nil
	}

	pid, name := findProcessOnPort(port, protocol)
	conflict := &dnsPortConflict{Port: port, Protocol: protocol, ProcessName: name}
	if pid > 0 {
		conflict.PID = &pid
	}
	return conflict
}

// findProcessOnPort resolves the PID/name bound to a TCP/UDP port in pure
// Go - reads /proc/net/{tcp,udp} for the socket inode on that port, then
// scans /proc/*/fd for a symlink to that inode. Deliberately avoids
// shelling out to lsof/ss, which may not be installed on a minimal node.
func findProcessOnPort(port int, protocol string) (int, string) {
	// A dual-stack socket (bound to ":port") is only listed in the "6" file.
	var data []byte
	for _, file := range []string{protocol, protocol + "6"} {
		if content, err := os.ReadFile(fmt.Sprintf("/proc/net/%s", file)); err == nil {
			data = append(data, content...)
			data = append(data, '\n')
		}
	}
	if len(data) == 0 {
		return 0, ""
	}

	portHex := fmt.Sprintf("%04X", port)
	var inode string
	for _, line := range strings.Split(string(data), "\n") {
		fields := strings.Fields(line)
		if len(fields) < 10 {
			continue
		}
		parts := strings.Split(fields[1], ":")
		if len(parts) != 2 || !strings.EqualFold(parts[1], portHex) {
			continue
		}
		inode = fields[9]
		break
	}
	if inode == "" || inode == "0" {
		return 0, ""
	}

	procEntries, err := os.ReadDir("/proc")
	if err != nil {
		return 0, ""
	}
	target := fmt.Sprintf("socket:[%s]", inode)
	for _, entry := range procEntries {
		pid, err := strconv.Atoi(entry.Name())
		if err != nil {
			continue
		}
		fdDir := fmt.Sprintf("/proc/%d/fd", pid)
		fds, err := os.ReadDir(fdDir)
		if err != nil {
			continue
		}
		for _, fd := range fds {
			link, err := os.Readlink(fmt.Sprintf("%s/%s", fdDir, fd.Name()))
			if err != nil || link != target {
				continue
			}
			name, _ := os.ReadFile(fmt.Sprintf("/proc/%d/comm", pid))
			return pid, strings.TrimSpace(string(name))
		}
	}
	return 0, ""
}

func knownPort53Services(processName string) []string {
	switch strings.ToLower(processName) {
	case "systemd-resolve", "systemd-resolved":
		return []string{"systemd-resolved"}
	case "named", "bind9":
		return []string{"bind9", "named"}
	case "dnsmasq":
		return []string{"dnsmasq"}
	default:
		return nil
	}
}

// permanentlyDisableService stops, disables AND masks a systemd unit so it
// can never come back - `disable` alone only removes the normal boot-time
// enablement symlink, it does NOT stop the unit from being pulled back in by
// socket activation (systemd-resolved ships a .socket unit) or by another
// unit's `Requires=`/`Wants=`. `mask` symlinks the unit to /dev/null, which
// is the only thing systemd honors as "never start this, by any mechanism,
// ever" - including across a reboot.
func permanentlyDisableService(ctx context.Context, unit string) error {
	if out, err := exec.CommandContext(ctx, "systemctl", "stop", unit).CombinedOutput(); err != nil {
		return fmt.Errorf("systemctl stop %s failed: %s", unit, strings.TrimSpace(string(out)))
	}
	if out, err := exec.CommandContext(ctx, "systemctl", "disable", unit).CombinedOutput(); err != nil {
		log.Printf("dns: systemctl disable %s failed (continuing, mask alone is sufficient): %s", unit, strings.TrimSpace(string(out)))
	}
	if out, err := exec.CommandContext(ctx, "systemctl", "mask", unit).CombinedOutput(); err != nil {
		return fmt.Errorf("systemctl mask %s failed: %s", unit, strings.TrimSpace(string(out)))
	}
	return nil
}

const resolvConfPath = "/etc/resolv.conf"

// fixResolvConfAfterDisablingSystemdResolved replaces /etc/resolv.conf with
// a static file once systemd-resolved is masked. On resolved-managed
// systems that path is a symlink to resolved's own generated stub file
// (/run/systemd/resolve/stub-resolv.conf, 127.0.0.53) - once resolved is
// masked that file stops being regenerated, so the symlink goes stale and
// this node loses its own outbound DNS resolution (PowerDNS itself doesn't
// help here: it's an authoritative server, not a recursive resolver for the
// node's own queries). Only touches the file if it's actually a
// resolved-owned symlink - a real file (already managed some other way) is
// left untouched.
func fixResolvConfAfterDisablingSystemdResolved() error {
	info, err := os.Lstat(resolvConfPath)
	if err != nil {
		return nil
	}
	if info.Mode()&os.ModeSymlink == 0 {
		return nil
	}
	target, err := os.Readlink(resolvConfPath)
	if err != nil || !strings.Contains(target, "systemd/resolve") {
		return nil
	}

	if err := os.Remove(resolvConfPath); err != nil {
		return fmt.Errorf("cannot remove stale resolv.conf symlink: %w", err)
	}
	content := "# Written by tarmac-agent after permanently disabling systemd-resolved so\n" +
		"# PowerDNS could bind port 53. Public resolvers used since no other\n" +
		"# resolver config was available to inherit from at the time.\n" +
		"nameserver 1.1.1.1\nnameserver 9.9.9.9\n"
	if err := os.WriteFile(resolvConfPath, []byte(content), 0o644); err != nil {
		return fmt.Errorf("cannot write static resolv.conf: %w", err)
	}
	return nil
}

// resolveDnsPortConflict only frees the port - it deliberately does not
// re-run applyDnsServerGroup itself. The API already flips the member back
// to "pending" as soon as it dispatches this command (see
// DnsService.resolvePortConflict), so the next 15s reconcile tick sends a
// fresh apply_dns_server_group with the full payload once the port is free.
// When the culprit is a known service (systemd-resolved, bind9/named,
// dnsmasq), it's permanently disabled (see permanentlyDisableService) rather
// than just killed once, so it doesn't come back on the next reboot either.
func resolveDnsPortConflict(ctx context.Context) (string, error) {
	conflict := probeDnsPortConflict()
	if conflict == nil {
		return "port 53 is already free", nil
	}

	stoppedService := false
	if commandExists("systemctl") {
		for _, unit := range knownPort53Services(conflict.ProcessName) {
			if err := permanentlyDisableService(ctx, unit); err != nil {
				log.Printf("dns: could not permanently disable %s: %v", unit, err)
				continue
			}
			stoppedService = true
			log.Printf(
				"dns: stopped, disabled and masked %s to free port %d/%s - it will not start again, including after a reboot",
				unit, conflict.Port, conflict.Protocol,
			)
			if unit == "systemd-resolved" {
				if err := fixResolvConfAfterDisablingSystemdResolved(); err != nil {
					log.Printf("dns: could not fix /etc/resolv.conf after disabling systemd-resolved: %v", err)
				}
			}
			break
		}
	}

	if !stoppedService && conflict.PID != nil {
		if proc, err := os.FindProcess(*conflict.PID); err == nil {
			_ = proc.Signal(syscall.SIGTERM)
			time.Sleep(2 * time.Second)
			_ = proc.Signal(syscall.SIGKILL)
		}
	}

	if remaining := probeDnsPortConflict(); remaining != nil {
		return "", fmt.Errorf("port %d/%s is still in use after attempting to free it", remaining.Port, remaining.Protocol)
	}
	return fmt.Sprintf("freed port %d/%s", conflict.Port, conflict.Protocol), nil
}

func ensurePdnsApiKey() (string, error) {
	return ensureApiKeyAt(pdnsApiKeyPath)
}

// ensureApiKeyAt is the parameterized core of ensurePdnsApiKey, reused by
// the dedicated internal PowerDNS instance (own key file, own instance).
func ensureApiKeyAt(path string) (string, error) {
	if data, err := os.ReadFile(path); err == nil {
		if key := strings.TrimSpace(string(data)); key != "" {
			return key, nil
		}
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return "", fmt.Errorf("cannot create powerdns config dir: %w", err)
	}
	raw := make([]byte, 24)
	if _, err := rand.Read(raw); err != nil {
		return "", fmt.Errorf("cannot generate powerdns api key: %w", err)
	}
	key := base64.RawURLEncoding.EncodeToString(raw)
	if err := os.WriteFile(path, []byte(key), 0o600); err != nil {
		return "", fmt.Errorf("cannot persist powerdns api key: %w", err)
	}
	return key, nil
}

// pdnsSqliteSchemaCandidates covers the schema file paths shipped by
// pdns-backend-sqlite3 across Debian/Ubuntu releases - the package moved it
// from /usr/share/doc (older) to a dedicated /usr/share/pdns-backend-sqlite3
// directory (newer), and older builds ship it gzipped.
var pdnsSqliteSchemaCandidates = []string{
	"/usr/share/pdns-backend-sqlite3/schema/schema.sqlite3.sql",
	"/usr/share/doc/pdns-backend-sqlite3/schema.sqlite3.sql",
	"/usr/share/doc/pdns-backend-sqlite3/schema.sqlite3.sql.gz",
}

func findPdnsSqliteSchema() (string, error) {
	for _, candidate := range pdnsSqliteSchemaCandidates {
		if _, err := os.Stat(candidate); err == nil {
			return candidate, nil
		}
	}
	return "", fmt.Errorf("powerdns sqlite schema file not found (checked: %s)", strings.Join(pdnsSqliteSchemaCandidates, ", "))
}

// ensurePdnsSqliteDatabase creates and initializes the gsqlite3 backend's
// database file the first time this node applies a DNS server group.
// PowerDNS doesn't create its own schema on first run - an empty/missing
// database file makes pdns_server fail to start - so this loads the schema
// SQL shipped by the pdns-backend-sqlite3 package before pdns is ever
// started. No-op if the file already exists (idempotent across re-applies).
func ensurePdnsSqliteDatabase(ctx context.Context) error {
	return ensureSqliteDatabaseAt(ctx, pdnsSqliteDbPath)
}

// ensureSqliteDatabaseAt is the parameterized core of ensurePdnsSqliteDatabase,
// reused by the dedicated internal PowerDNS instance (separate database file,
// same schema) - see ensureInternalPdnsSqliteDatabase below.
func ensureSqliteDatabaseAt(ctx context.Context, dbPath string) error {
	if _, err := os.Stat(dbPath); err == nil {
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(dbPath), 0o755); err != nil {
		return fmt.Errorf("cannot create powerdns database dir: %w", err)
	}
	if !commandExists("sqlite3") {
		if _, err := ensureAgentSystemPackages(ctx, []string{"sqlite3"}); err != nil {
			return fmt.Errorf("cannot install sqlite3: %w", err)
		}
	}

	schemaPath, err := findPdnsSqliteSchema()
	if err != nil {
		return err
	}
	schemaSQL, err := os.ReadFile(schemaPath)
	if err != nil {
		return fmt.Errorf("cannot read powerdns schema file: %w", err)
	}
	if strings.HasSuffix(schemaPath, ".gz") {
		gz, err := gzip.NewReader(bytes.NewReader(schemaSQL))
		if err != nil {
			return fmt.Errorf("cannot decompress powerdns schema file: %w", err)
		}
		defer gz.Close()
		if schemaSQL, err = io.ReadAll(gz); err != nil {
			return fmt.Errorf("cannot read decompressed powerdns schema: %w", err)
		}
	}

	cmd := exec.CommandContext(ctx, "sqlite3", dbPath)
	cmd.Stdin = bytes.NewReader(schemaSQL)
	if out, err := cmd.CombinedOutput(); err != nil {
		_ = os.Remove(dbPath) // don't leave a half-initialized db behind for the next attempt to trip over
		return fmt.Errorf("cannot load powerdns schema into %s: %s", dbPath, strings.TrimSpace(string(out)))
	}

	// pdns_server runs as the "pdns" system user (created by the
	// pdns-server package's postinst) - it needs write access to both the
	// db file and its directory (sqlite writes -wal/-shm files alongside
	// it once opened for read-write).
	if commandExists("chown") {
		if out, err := exec.CommandContext(ctx, "chown", "-R", "pdns:pdns", filepath.Dir(dbPath)).CombinedOutput(); err != nil {
			log.Printf("dns: chown pdns:pdns %s failed (pdns_server may fail to start if it can't write here): %s", filepath.Dir(dbPath), strings.TrimSpace(string(out)))
		}
	}
	return nil
}

// writePdnsConfig accepts the backend explicitly (rather than always
// defaulting to gsqlite3) so a fresh install can go straight to lmdb - see
// readPdnsBackend/migratePdnsBackendToLmdb below for why lmdb is preferred:
// gsqlite3 serializes every write behind a single lock, which becomes the
// query-response-time bottleneck under real load, whereas lmdb is a
// memory-mapped B+tree with much better read concurrency.
// go.mod pins go 1.18 (matches the apt-installed golang-go on production
// nodes, see mmdbwriter pin above) - no builtin max() until Go 1.21.
func pdnsDistributorThreads() int {
	if n := runtime.NumCPU(); n > 2 {
		return n
	}
	return 2
}

func writePdnsConfig(apiKey string, allowAxfrIps []string, backend string) error {
	if err := os.MkdirAll(filepath.Dir(pdnsConfigPath), 0o755); err != nil {
		return fmt.Errorf("cannot create powerdns config dir: %w", err)
	}
	var backendLines []string
	if backend == "lmdb" {
		// The LMDB backend has DNSSEC support built in, no separate toggle.
		backendLines = []string{"launch=lmdb", "lmdb-filename=" + pdnsLmdbFilePath}
	} else {
		// Unlike LMDB, the generic-SQL backends (gsqlite3/gmysql/gpgsql)
		// need their own "<backend>-dnssec=yes" to enable the DNSSEC tables
		// at all - without it, POST .../cryptokeys always fails with
		// "Adding key failed, perhaps DNSSEC not enabled in configuration?"
		// even though the zone and API call are otherwise fine (confirmed
		// in production).
		backendLines = []string{"launch=gsqlite3", "gsqlite3-database=" + pdnsSqliteDbPath, "gsqlite3-dnssec=yes"}
	}
	// No global "dnssec"/"default-ksk-algorithm" setting here on purpose -
	// PowerDNS Authoritative has no such global toggle (that was a mistaken
	// guess that crashed pdns_server outright: "Fatal error: Trying to set
	// unknown setting 'dnssec'"). DNSSEC is enabled per zone instead, via
	// the POST .../cryptokeys call already made in applyDnsZone.
	lines := append(backendLines,
		"local-address=0.0.0.0",
		"local-port=53",
		"api=yes",
		"api-key="+apiKey,
		"webserver=yes",
		"webserver-address=127.0.0.1",
		"webserver-port=8081",
		"webserver-allow-from=127.0.0.1",
		"enable-lua-records=yes",
		// Without these, PowerDNS still accepts API calls to create a
		// Slave-kind zone and even accepts retrieve requests without
		// erroring - but the background SlaveCommunicator thread that
		// actually performs transfers never runs at all, so every retrieve
		// request just sits queued forever with zero network activity and
		// zero further logging (confirmed in production: a manual `dig
		// axfr` to the same primary worked instantly, proving the network/
		// ACL side was always fine - only PowerDNS's own retrieval
		// mechanism was silently inert). "master"/"slave" is the
		// terminology that works across all PowerDNS versions in the
		// field; "primary"/"secondary" are the newer aliases from 4.5+.
		"master=yes",
		"slave=yes",
		"allow-axfr-ips="+strings.Join(append([]string{"127.0.0.1"}, allowAxfrIps...), ","),
		// distributor-threads defaults to 3 regardless of the machine's real
		// core count (confirmed against the actual shipped default via a
		// PowerDNS 4.5.5 spike - the same version `apt install pdns-server`
		// resolves to on the Ubuntu 22.04 nodes this agent targets). Sizing
		// it to the node's own core count costs nothing on small VPS (still
		// resolves to the same default) and removes a real bottleneck on
		// bigger boxes, without needing to know the fleet's hardware ahead
		// of time - runtime.NumCPU() reads it locally on each node.
		fmt.Sprintf("distributor-threads=%d", pdnsDistributorThreads()),
		// Packet-cache TTL, default 20s (also confirmed via the same spike):
		// raised to 60s since it's an independent cap under the record's own
		// TTL, not a floor - a record's own TTL (e.g. Tarmac's 3600s default)
		// still governs correctness. 60s cuts backend/gsqlite3 lookups for
		// repeat identical queries by 3x versus the default without working
		// against the ~15s reconciliation cycle that already pushes out
		// legitimate record changes.
		"cache-ttl=60",
	)
	if len(allowAxfrIps) > 0 {
		lines = append(lines, "also-notify="+strings.Join(allowAxfrIps, ","))
	}
	content := strings.Join(lines, "\n") + "\n"
	return os.WriteFile(pdnsConfigPath, []byte(content), 0o644)
}

// readPdnsAllowAxfrIps recovers the sibling VLAN IPs writePdnsConfig was
// last called with, by reading them back out of the file on disk (own-node
// "127.0.0.1" excluded) - used by refreshPdnsConfigOnStartup, which doesn't
// have a fresh apply_dns_server_group payload to read them from.
func readPdnsAllowAxfrIps() []string {
	data, err := os.ReadFile(pdnsConfigPath)
	if err != nil {
		return nil
	}
	for _, line := range strings.Split(string(data), "\n") {
		if !strings.HasPrefix(line, "allow-axfr-ips=") {
			continue
		}
		var ips []string
		for _, ip := range strings.Split(strings.TrimPrefix(line, "allow-axfr-ips="), ",") {
			ip = strings.TrimSpace(ip)
			if ip != "" && ip != "127.0.0.1" {
				ips = append(ips, ip)
			}
		}
		return ips
	}
	return nil
}

// refreshPdnsConfigOnStartup regenerates pdns.conf from the current backend
// and ACL state on every agent restart, so a config-affecting agent update
// (e.g. adding "gsqlite3-dnssec=yes") takes effect without waiting for the
// control plane to re-send apply_dns_server_group, which only happens if
// the member goes back to pending (confirmed in production: the DNSSEC fix
// alone didn't help an already-provisioned node until this ran). Only
// restarts pdns if the regenerated file actually differs, to avoid an
// unnecessary DNS blip on every plain agent restart.
func refreshPdnsConfigOnStartup(ctx context.Context) {
	apiKey, err := ensurePdnsApiKey()
	if err != nil {
		log.Printf("dns: could not refresh PowerDNS config on startup: %v", err)
		return
	}
	before, _ := os.ReadFile(pdnsConfigPath)
	if err := writePdnsConfig(apiKey, readPdnsAllowAxfrIps(), readPdnsBackend()); err != nil {
		log.Printf("dns: could not refresh PowerDNS config on startup: %v", err)
		return
	}
	after, err := os.ReadFile(pdnsConfigPath)
	if err != nil || bytes.Equal(before, after) {
		return
	}
	if commandExists("systemctl") {
		if out, err := exec.CommandContext(ctx, "systemctl", "restart", "pdns").CombinedOutput(); err != nil {
			log.Printf("dns: could not restart pdns after refreshing config on startup: %s", strings.TrimSpace(string(out)))
		}
	}
}

var tsigKeyNameSanitizer = regexp.MustCompile(`[^a-z0-9-]+`)

func tsigKeyName(groupID string) string {
	return "tarmac-dns-" + tsigKeyNameSanitizer.ReplaceAllString(strings.ToLower(groupID), "-")
}

var pdnsutilGenerateTsigRe = regexp.MustCompile(`(?i)Create new TSIG key \S+ \S+ (\S+)`)

// ensureTsigKey returns the group's TSIG secret, generating it via pdnsutil
// on first call (idempotent - a re-apply on the primary reuses the existing
// key rather than rotating it, which would break already-configured
// secondaries).
func ensureTsigKey(ctx context.Context, keyName string) (string, error) {
	if out, err := exec.CommandContext(ctx, "pdnsutil", "list-tsig-keys").CombinedOutput(); err == nil {
		for _, line := range strings.Split(string(out), "\n") {
			fields := strings.Fields(line)
			if len(fields) >= 3 && fields[0] == keyName {
				return fields[2], nil
			}
		}
	}
	out, err := exec.CommandContext(ctx, "pdnsutil", "generate-tsig-key", keyName, "hmac-sha256").CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("pdnsutil generate-tsig-key failed: %s", strings.TrimSpace(string(out)))
	}
	match := pdnsutilGenerateTsigRe.FindStringSubmatch(string(out))
	if len(match) < 2 {
		return "", fmt.Errorf("could not parse generated TSIG secret from: %s", strings.TrimSpace(string(out)))
	}
	return match[1], nil
}

// readPdnsBackend reports which PowerDNS backend this node uses: the
// persisted marker if one exists, "lmdb" for a genuinely fresh install (no
// gsqlite3 database has ever been created here, so there's nothing to
// migrate - go straight to the better-performing backend), or "gsqlite3"
// for an existing pre-marker install that still needs migrating.
func readPdnsBackend() string {
	if data, err := os.ReadFile(pdnsBackendMarkerPath); err == nil {
		if backend := strings.TrimSpace(string(data)); backend != "" {
			return backend
		}
	}
	if _, err := os.Stat(pdnsSqliteDbPath); err != nil {
		return "lmdb"
	}
	return "gsqlite3"
}

func writePdnsBackendMarker(backend string) error {
	if err := os.MkdirAll(filepath.Dir(pdnsBackendMarkerPath), 0o755); err != nil {
		return err
	}
	return os.WriteFile(pdnsBackendMarkerPath, []byte(backend), 0o644)
}

func fetchPdnsZoneNames(ctx context.Context, apiKey string) ([]string, error) {
	client := &pdnsClient{apiKey: apiKey}
	body, status, err := client.request(ctx, http.MethodGet, "/zones", nil)
	if err != nil {
		return nil, err
	}
	if status >= 300 {
		return nil, fmt.Errorf("unexpected status %d: %s", status, strings.TrimSpace(string(body)))
	}
	var zones []struct {
		Name string `json:"name"`
	}
	if err := json.Unmarshal(body, &zones); err != nil {
		return nil, err
	}
	names := make([]string, 0, len(zones))
	for _, zone := range zones {
		names = append(names, zone.Name)
	}
	return names, nil
}

// migratePdnsBackendToLmdb runs at most once per node (gated by
// pdnsBackendMarkerPath) - called from main() on every agent startup,
// after the DNS-prerequisite recheck, so it happens automatically on any
// restart including the one an agent update triggers, without needing a
// separate command from the control plane.
//
// Deliberately conservative at every step: the gsqlite3 database is never
// modified or deleted, the new lmdb-backed server's zone list is verified
// against the old one before the switch is considered final, and any
// failure rolls back to the untouched original config and restarts pdns
// on gsqlite3 - so even if pdnsutil's exact behavior here turns out to
// differ from what's assumed, the worst case is a failed, rolled-back
// attempt visible in the Journal, not broken DNS.
func migratePdnsBackendToLmdb(ctx context.Context) {
	if readPdnsBackend() != "gsqlite3" {
		return
	}
	if _, err := os.Stat(pdnsSqliteDbPath); err != nil {
		// Nothing was ever migrated from - either this node was never
		// actually a working DNS server, or applyDnsServerGroup already
		// wrote a marker. Adopt lmdb for the next apply and stop.
		if err := writePdnsBackendMarker("lmdb"); err != nil {
			log.Printf("dns: could not record lmdb backend marker: %v", err)
		}
		return
	}

	log.Printf("dns: migrating PowerDNS backend from gsqlite3 to lmdb for better query response time")

	if _, err := ensureAgentSystemPackages(ctx, []string{"pdns-backend-lmdb"}); err != nil {
		log.Printf("dns: lmdb backend migration aborted, cannot install pdns-backend-lmdb: %v", err)
		return
	}

	apiKey, err := ensurePdnsApiKey()
	if err != nil {
		log.Printf("dns: lmdb backend migration aborted: %v", err)
		return
	}

	beforeZones, err := fetchPdnsZoneNames(ctx, apiKey)
	if err != nil {
		log.Printf("dns: lmdb backend migration aborted, could not read current zone list: %v", err)
		return
	}

	originalConfig, err := os.ReadFile(pdnsConfigPath)
	if err != nil {
		log.Printf("dns: lmdb backend migration aborted, cannot read current pdns.conf: %v", err)
		return
	}

	restoreOriginalConfig := func(reason string) {
		log.Printf("dns: lmdb backend migration failed (%s) - rolling back to gsqlite3, no data was touched", reason)
		if err := os.WriteFile(pdnsConfigPath, originalConfig, 0o644); err != nil {
			log.Printf("dns: could not restore original pdns.conf during rollback: %v", err)
			return
		}
		if out, err := exec.CommandContext(ctx, "systemctl", "restart", "pdns").CombinedOutput(); err != nil {
			log.Printf("dns: could not restart pdns after rollback: %s", strings.TrimSpace(string(out)))
		}
	}

	if out, err := exec.CommandContext(ctx, "systemctl", "stop", "pdns").CombinedOutput(); err != nil {
		log.Printf("dns: lmdb backend migration aborted, cannot stop pdns: %s", strings.TrimSpace(string(out)))
		return
	}

	// Both backends need to be loaded simultaneously for pdnsutil to read
	// from one and write into the other - pdns itself stays stopped
	// throughout, pdnsutil talks to the backend files directly.
	dualConfig := strings.Replace(
		string(originalConfig), "launch=gsqlite3", "launch=gsqlite3,lmdb\nlmdb-filename="+pdnsLmdbFilePath, 1,
	)
	if dualConfig == string(originalConfig) {
		restoreOriginalConfig("could not find the expected \"launch=gsqlite3\" line to extend")
		return
	}
	if err := os.WriteFile(pdnsConfigPath, []byte(dualConfig), 0o644); err != nil {
		restoreOriginalConfig(fmt.Sprintf("could not write dual-backend config: %v", err))
		return
	}

	migrateOut, migrateErr := exec.CommandContext(ctx, "pdnsutil", "b2b-migrate", "gsqlite3", "lmdb").CombinedOutput()
	if migrateErr != nil || strings.Contains(strings.ToLower(string(migrateOut)), "error") {
		restoreOriginalConfig(fmt.Sprintf("pdnsutil b2b-migrate failed: %s", strings.TrimSpace(string(migrateOut))))
		return
	}

	lmdbOnlyConfig := strings.Replace(
		string(originalConfig), "launch=gsqlite3", "launch=lmdb\nlmdb-filename="+pdnsLmdbFilePath, 1,
	)
	if err := os.WriteFile(pdnsConfigPath, []byte(lmdbOnlyConfig), 0o644); err != nil {
		restoreOriginalConfig(fmt.Sprintf("could not write lmdb-only config: %v", err))
		return
	}

	if out, err := exec.CommandContext(ctx, "systemctl", "restart", "pdns").CombinedOutput(); err != nil {
		restoreOriginalConfig(fmt.Sprintf("pdns would not start on lmdb: %s", strings.TrimSpace(string(out))))
		return
	}

	// Give pdns a moment to come fully up before hitting its API.
	time.Sleep(2 * time.Second)
	afterZones, err := fetchPdnsZoneNames(ctx, apiKey)
	if err != nil || len(afterZones) != len(beforeZones) {
		restoreOriginalConfig(fmt.Sprintf(
			"post-migration zone count mismatch (before=%d, after=%d, err=%v)", len(beforeZones), len(afterZones), err,
		))
		return
	}

	if err := writePdnsBackendMarker("lmdb"); err != nil {
		log.Printf("dns: migration succeeded but could not persist the lmdb marker, will retry on next restart: %v", err)
		return
	}
	log.Printf(
		"dns: PowerDNS backend migration to lmdb complete (%d zone(s) verified) - %s is no longer used but was left untouched",
		len(afterZones), pdnsSqliteDbPath,
	)
}

func applyDnsServerGroup(ctx context.Context, payload map[string]interface{}) (string, *dnsServerGroupApplyData, error) {
	groupID := readString(payload, "groupId")
	dnsNodeID := readString(payload, "nodeId")
	role := readString(payload, "role")
	if groupID == "" || dnsNodeID == "" || role == "" {
		return "", nil, errors.New("apply_dns_server_group payload must include groupId, nodeId and role")
	}

	backend := readPdnsBackend()
	backendPackage := "pdns-backend-sqlite3"
	if backend == "lmdb" {
		backendPackage = "pdns-backend-lmdb"
	}
	if _, err := ensureAgentSystemPackages(ctx, []string{"pdns-server", backendPackage}); err != nil {
		return "", nil, fmt.Errorf("cannot install PowerDNS: %w", err)
	}

	if backend != "lmdb" {
		if err := ensurePdnsSqliteDatabase(ctx); err != nil {
			return "", nil, err
		}
	}

	// This node may currently run this agent's own internal-DNS fallback
	// forwarder (dnsmasq, see ensureInternalDnsForwarder) bound to port 53
	// for *.tarmac.local. Unlike a genuinely unknown occupant, we fully own
	// and understand this one, so there's no need to report a conflict and
	// wait for an explicit user "kill and retry" - stop it automatically to
	// make room for the group's own PowerDNS. *.tarmac.local doesn't stay
	// unresolved here for long: once dnsMarkerPath is written below, the
	// next periodic ensure_internal_dns_route tick (~30s, from
	// InternalDnsService.tick) finds it and switches this node to the
	// /etc/hosts fallback instead, exactly like any node that already ran
	// its own PowerDNS from the start.
	if _, err := os.Stat(internalDnsForwarderMarkerPath); err == nil {
		log.Printf("dns: stopping this node's internal-DNS fallback forwarder to free port 53 for the group's own PowerDNS")
		if err := removeInternalDnsForwarder(ctx); err != nil {
			log.Printf("dns: could not stop internal DNS forwarder automatically (continuing, the port probe below may still report a conflict): %v", err)
		}
	}

	if conflict := probeDnsPortConflict(); conflict != nil {
		return "", &dnsServerGroupApplyData{PortConflict: conflict}, fmt.Errorf(
			"port %d/%s already in use by %s",
			conflict.Port, conflict.Protocol, firstNonEmpty(conflict.ProcessName, "an unknown process"),
		)
	}

	apiKey, err := ensurePdnsApiKey()
	if err != nil {
		return "", nil, err
	}

	allowAxfrIps := readStringSlice(payload, "groupMemberVlanIps")
	if err := writePdnsConfig(apiKey, allowAxfrIps, backend); err != nil {
		return "", nil, err
	}
	if err := writePdnsBackendMarker(backend); err != nil {
		log.Printf("dns: could not record pdns backend marker: %v", err)
	}

	if commandExists("systemctl") {
		if out, err := exec.CommandContext(ctx, "systemctl", "enable", "--now", "pdns").CombinedOutput(); err != nil {
			return "", nil, fmt.Errorf("cannot enable/start pdns: %s", strings.TrimSpace(string(out)))
		}
		// enable --now only starts it if it wasn't running - the config may
		// have just changed, so always restart to pick it up.
		if out, err := exec.CommandContext(ctx, "systemctl", "restart", "pdns").CombinedOutput(); err != nil {
			return "", nil, fmt.Errorf("cannot restart pdns: %s", strings.TrimSpace(string(out)))
		}
	}

	data := &dnsServerGroupApplyData{}
	keyName := tsigKeyName(groupID)

	if role == "primary" {
		secret, err := ensureTsigKey(ctx, keyName)
		if err != nil {
			log.Printf("dns: TSIG key generation failed, secondaries won't be able to authenticate zone transfers yet: %v", err)
		} else {
			data.DnsTsigKeySecret = secret
		}
	} else {
		primaryVlanIp := readString(payload, "primaryVlanIp")
		if primaryVlanIp == "" {
			return "", nil, errors.New("secondary role requires primaryVlanIp")
		}
		if tsigSecret := readString(payload, "tsigKeySecret"); tsigSecret != "" {
			if out, err := exec.CommandContext(ctx, "pdnsutil", "import-tsig-key", keyName, "hmac-sha256", tsigSecret).CombinedOutput(); err != nil {
				log.Printf("dns: TSIG key import failed (%s), zone transfers stay IP-restricted via allow-axfr-ips only", strings.TrimSpace(string(out)))
			}
		}
		// Zones themselves are provisioned explicitly per zone via
		// command.apply_dns_zone_slave (dispatched by the control plane's
		// reconciliation loop for every zone in this group), not via
		// PowerDNS's "supermaster" auto-provisioning - that relied on a
		// NOTIFY's claimed nameserver hostname matching one of the zone's
		// real NS records, and the placeholder used here never did, so
		// secondaries silently never picked up any zone at all (confirmed:
		// they answered REFUSED for a zone that had been active on the
		// primary for days). Explicit per-zone Slave creation has no such
		// hidden matching requirement.
	}

	if err := os.MkdirAll(filepath.Dir(dnsMarkerPath), 0o755); err == nil {
		_ = os.WriteFile(dnsMarkerPath, []byte(fmt.Sprintf("groupId=%s\nnodeId=%s\nrole=%s\n", groupID, dnsNodeID, role)), 0o600)
	}

	return fmt.Sprintf("PowerDNS configured as %s for group %s", role, groupID), data, nil
}

type pdnsClient struct {
	apiKey string
	// baseURL overrides pdnsApiBaseURL when set - lets pdnsClient talk to
	// the dedicated internal PowerDNS instance (different port) without
	// duplicating every method. Leave zero-valued to keep talking to the
	// normal instance, as every existing call site does.
	baseURL string
}

func (c *pdnsClient) request(ctx context.Context, method, path string, body interface{}) ([]byte, int, error) {
	var reader io.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			return nil, 0, err
		}
		reader = bytes.NewReader(encoded)
	}
	base := c.baseURL
	if base == "" {
		base = pdnsApiBaseURL
	}
	req, err := http.NewRequestWithContext(ctx, method, base+path, reader)
	if err != nil {
		return nil, 0, err
	}
	req.Header.Set("X-API-Key", c.apiKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := (&http.Client{Timeout: 15 * time.Second}).Do(req)
	if err != nil {
		return nil, 0, err
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(resp.Body)
	return respBody, resp.StatusCode, nil
}

func (c *pdnsClient) zoneExists(ctx context.Context, fqdn string) bool {
	_, status, err := c.request(ctx, http.MethodGet, "/zones/"+url.PathEscape(fqdn), nil)
	return err == nil && status == http.StatusOK
}

func (c *pdnsClient) createZone(ctx context.Context, fqdn string) error {
	// nameservers is deliberately empty here, not an oversight: PowerDNS
	// would otherwise auto-generate NS records using whatever hostname the
	// system itself reports, which has nothing to do with the group's
	// actual vanity nameserver names. applyDnsZone always PATCHes the real
	// NS rrset right after this, on every apply (not just creation).
	body := map[string]interface{}{"name": fqdn, "kind": "Master", "nameservers": []string{}}
	respBody, status, err := c.request(ctx, http.MethodPost, "/zones", body)
	if err != nil {
		return fmt.Errorf("cannot create zone %s: %w", fqdn, err)
	}
	if status >= 300 {
		return fmt.Errorf("cannot create zone %s: %s", fqdn, strings.TrimSpace(string(respBody)))
	}
	return nil
}

// createSlaveZone explicitly registers this node as authoritative-via-AXFR
// for fqdn, with masterIp as the zone's master - deterministic, no
// dependency on a NOTIFY's claimed nameserver matching anything (unlike
// the supermaster auto-provisioning this replaced, see applyDnsServerGroup).
func (c *pdnsClient) createSlaveZone(ctx context.Context, fqdn, masterIp string) error {
	body := map[string]interface{}{"name": fqdn, "kind": "Slave", "masters": []string{masterIp}}
	respBody, status, err := c.request(ctx, http.MethodPost, "/zones", body)
	if err != nil {
		return fmt.Errorf("cannot create slave zone %s: %w", fqdn, err)
	}
	if status >= 300 {
		return fmt.Errorf("cannot create slave zone %s: %s", fqdn, strings.TrimSpace(string(respBody)))
	}
	return nil
}

// triggerAxfrRetrieve asks PowerDNS to pull the zone from its master right
// away, instead of waiting for the SOA refresh timer (up to 3 hours away
// with the refresh value applyDnsZone writes into the SOA).
func (c *pdnsClient) triggerAxfrRetrieve(ctx context.Context, fqdn string) error {
	respBody, status, err := c.request(ctx, http.MethodPut, "/zones/"+url.PathEscape(fqdn)+"/axfr-retrieve", nil)
	if err != nil {
		return err
	}
	if status >= 300 {
		return fmt.Errorf("unexpected status %d: %s", status, strings.TrimSpace(string(respBody)))
	}
	return nil
}

// setZoneMetadata is used to point a slave zone at the TSIG key it should
// use to authenticate its AXFR pulls (metadata kind "AXFR-MASTER-TSIG"),
// upgrading transfers from IP-restricted-only to TSIG-signed.
func (c *pdnsClient) setZoneMetadata(ctx context.Context, fqdn, kind string, values []string) error {
	body := map[string]interface{}{"kind": kind, "metadata": values}
	respBody, status, err := c.request(ctx, http.MethodPut, "/zones/"+url.PathEscape(fqdn)+"/metadata/"+kind, body)
	if err != nil {
		return err
	}
	if status >= 300 {
		return fmt.Errorf("unexpected status %d: %s", status, strings.TrimSpace(string(respBody)))
	}
	return nil
}

func (c *pdnsClient) patchRrsets(ctx context.Context, fqdn string, rrsets []map[string]interface{}) error {
	respBody, status, err := c.request(ctx, http.MethodPatch, "/zones/"+url.PathEscape(fqdn), map[string]interface{}{"rrsets": rrsets})
	if err != nil {
		return fmt.Errorf("cannot apply records to zone %s: %w", fqdn, err)
	}
	if status >= 300 {
		return fmt.Errorf("cannot apply records to zone %s: %s", fqdn, strings.TrimSpace(string(respBody)))
	}
	return nil
}

// fetchZoneARecordNames lists the fully-qualified names of every A rrset
// currently in the zone - used by applyInternalDnsRecords to find records
// that need an explicit DELETE (see the comment there for why REPLACE alone
// isn't enough to keep tarmac.local in sync with the fleet's current node
// list).
func (c *pdnsClient) fetchZoneARecordNames(ctx context.Context, fqdn string) ([]string, error) {
	respBody, status, err := c.request(ctx, http.MethodGet, "/zones/"+url.PathEscape(fqdn), nil)
	if err != nil {
		return nil, fmt.Errorf("cannot fetch zone %s: %w", fqdn, err)
	}
	if status >= 300 {
		return nil, fmt.Errorf("cannot fetch zone %s: status %d", fqdn, status)
	}
	var zone struct {
		Rrsets []struct {
			Name string `json:"name"`
			Type string `json:"type"`
		} `json:"rrsets"`
	}
	if err := json.Unmarshal(respBody, &zone); err != nil {
		return nil, fmt.Errorf("cannot parse zone %s: %w", fqdn, err)
	}
	names := make([]string, 0, len(zone.Rrsets))
	for _, rrset := range zone.Rrsets {
		if rrset.Type == "A" {
			names = append(names, rrset.Name)
		}
	}
	return names, nil
}

// enableDnssec is idempotent and self-healing. It used to unconditionally
// POST a new key on every call - harmless-looking, but applyDnsZone calls it
// on every apply (every reconciliation pass, every "Réappliquer", every
// record edit that flips the zone back to pending), so a zone left signed
// for any length of time accumulated one extra key per apply with the old
// ones never removed (confirmed in production: intraced.fr had 6 active
// keys). Now it fetches existing keys first and only creates one if none is
// active; if it finds more than one (recovering from that old bug), it
// keeps the most recently created key and deletes the rest - safe either
// way since without a DS published at the parent zone (the state a zone is
// in until the operator adds it at their registrar), no resolver has
// anchored trust to any specific key yet.
func (c *pdnsClient) enableDnssec(ctx context.Context, fqdn string) error {
	existing, err := c.fetchCryptoKeys(ctx, fqdn)
	if err != nil {
		return err
	}

	var activeIDs []int
	for _, key := range existing {
		if active, ok := key["active"].(bool); ok && active {
			if id, ok := key["id"].(float64); ok {
				activeIDs = append(activeIDs, int(id))
			}
		}
	}

	if len(activeIDs) == 1 {
		return nil
	}

	if len(activeIDs) > 1 {
		sort.Ints(activeIDs)
		for _, id := range activeIDs[:len(activeIDs)-1] {
			if err := c.deleteCryptoKey(ctx, fqdn, id); err != nil {
				log.Printf("dns: failed to remove duplicate DNSSEC key %d for %s: %v", id, fqdn, err)
			}
		}
		return nil
	}

	respBody, status, err := c.request(ctx, http.MethodPost, "/zones/"+url.PathEscape(fqdn)+"/cryptokeys", map[string]interface{}{"keytype": "ksk", "active": true})
	if err != nil {
		return err
	}
	if status >= 300 {
		return fmt.Errorf("%s", strings.TrimSpace(string(respBody)))
	}
	return nil
}

func (c *pdnsClient) deleteCryptoKey(ctx context.Context, fqdn string, id int) error {
	respBody, status, err := c.request(ctx, http.MethodDelete, "/zones/"+url.PathEscape(fqdn)+"/cryptokeys/"+strconv.Itoa(id), nil)
	if err != nil {
		return err
	}
	if status >= 300 {
		return fmt.Errorf("%s", strings.TrimSpace(string(respBody)))
	}
	return nil
}

func (c *pdnsClient) fetchCryptoKeys(ctx context.Context, fqdn string) ([]map[string]interface{}, error) {
	respBody, status, err := c.request(ctx, http.MethodGet, "/zones/"+url.PathEscape(fqdn)+"/cryptokeys", nil)
	if err != nil {
		return nil, err
	}
	if status >= 300 {
		return nil, fmt.Errorf("%s", strings.TrimSpace(string(respBody)))
	}
	var keys []map[string]interface{}
	if err := json.Unmarshal(respBody, &keys); err != nil {
		return nil, err
	}
	return keys, nil
}

func (c *pdnsClient) deleteZone(ctx context.Context, fqdn string) error {
	_, status, err := c.request(ctx, http.MethodDelete, "/zones/"+url.PathEscape(fqdn), nil)
	if err != nil {
		return err
	}
	if status >= 300 && status != http.StatusNotFound {
		return fmt.Errorf("delete zone %s failed with status %d", fqdn, status)
	}
	return nil
}

type dnsRecordValuePayload struct {
	Content  string
	Priority int
}

type dnsRecordPayload struct {
	Name   string
	Type   string
	Ttl    int
	IsGeo  bool
	Values []dnsRecordValuePayload
}

func parseDnsRecords(payload map[string]interface{}) []dnsRecordPayload {
	rawRecords, ok := payload["records"].([]interface{})
	if !ok {
		return nil
	}

	records := make([]dnsRecordPayload, 0, len(rawRecords))
	for _, entry := range rawRecords {
		record, ok := entry.(map[string]interface{})
		if !ok {
			continue
		}
		name := readString(record, "name")
		recordType := readString(record, "type")
		if name == "" || recordType == "" {
			continue
		}

		var values []dnsRecordValuePayload
		if rawValues, ok := record["values"].([]interface{}); ok {
			for _, rv := range rawValues {
				valueMap, ok := rv.(map[string]interface{})
				if !ok {
					continue
				}
				content := readString(valueMap, "content")
				if content == "" {
					continue
				}
				values = append(values, dnsRecordValuePayload{Content: content, Priority: readInt(valueMap, "priority", 0)})
			}
		}

		records = append(records, dnsRecordPayload{
			Name:   name,
			Type:   recordType,
			Ttl:    readInt(record, "ttl", 3600),
			IsGeo:  readBool(record, "isGeo"),
			Values: values,
		})
	}
	return records
}

func dnsRecordFqdn(zoneName, label string) string {
	if label == "" || label == "@" {
		return zoneName + "."
	}
	return label + "." + zoneName + "."
}

// pdnsTargetTypes are the record types whose content ends with a hostname
// that PowerDNS requires in canonical (root-anchored) form. MX and SRV are
// handled separately because their content is prefixed with a priority, but
// the same rule applies to their target.
var pdnsTargetTypes = map[string]bool{
	"CNAME": true,
	"DNAME": true,
	"NS":    true,
	"PTR":   true,
}

// pdnsQuotedTypes are the record types whose content PowerDNS requires as
// one or more quoted character-strings rather than a bare value.
var pdnsQuotedTypes = map[string]bool{
	"TXT": true,
	"SPF": true,
}

// pdnsQualifyTarget appends the root dot to the hostname at the end of a
// record's content. PowerDNS's API rejects a non-canonical target outright
// instead of normalising it - "Record intraced.fr./MX '10 mail.intraced.fr':
// Not in expected format (parsed as '10 mail.intraced.fr.')" - and since
// applyDnsZone PATCHes the whole zone as a single atomic request, one
// unqualified target rejects every other record in the zone along with it
// (confirmed in production: an MX added to intraced.fr blocked the TXT/SPF
// record created a minute later from ever being published).
//
// Only the LAST whitespace-separated field is touched: SRV content reaches
// here as "<weight> <port> <target>", so qualifying the whole string would
// corrupt the numeric fields. A target that is already canonical - including
// the bare "." that means "no service" in SRV - is returned unchanged.
func pdnsQualifyTarget(content string) string {
	fields := strings.Fields(content)
	if len(fields) == 0 {
		return content
	}
	if last := fields[len(fields)-1]; !strings.HasSuffix(last, ".") {
		fields[len(fields)-1] = last + "."
	}
	return strings.Join(fields, " ")
}

// pdnsQuoteTxt wraps TXT/SPF content in the quoted form PowerDNS demands
// ("Data field in DNS should start with quote (\") at position 0 of
// 'v=spf1 mx ~all'" - same production zone, same atomic-PATCH consequence as
// pdnsQualifyTarget). Content that is already quoted is passed through
// untouched so an operator can still hand-write the multi-string form
// ("chunk one" "chunk two") that long DKIM keys need.
func pdnsQuoteTxt(content string) string {
	if strings.HasPrefix(strings.TrimSpace(content), "\"") {
		return content
	}
	escaped := strings.ReplaceAll(content, "\\", "\\\\")
	escaped = strings.ReplaceAll(escaped, "\"", "\\\"")
	return "\"" + escaped + "\""
}

// applyDnsZone pushes the zone's complete record set on every call (like
// applyOverlay's full peer-list push), not a diff - simpler and safer over
// an unreliable channel, at the cost of re-writing the whole zone for a
// single-record edit. Acceptable for the zone sizes expected in v1.
func applyDnsZone(payload map[string]interface{}) (string, error) {
	zoneName := readString(payload, "zoneName")
	if zoneName == "" {
		return "", errors.New("apply_dns_zone payload must include zoneName")
	}
	fqdn := zoneName + "."
	records := parseDnsRecords(payload)

	for _, record := range records {
		if !record.IsGeo {
			continue
		}
		if _, err := os.Stat(geoipMmdbPath); err != nil {
			log.Printf("dns: no geoip mmdb present yet for zone %s, isGeo records will not resolve correctly until the next refresh", zoneName)
		}
		break
	}

	apiKey, err := ensurePdnsApiKey()
	if err != nil {
		return "", err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	client := &pdnsClient{apiKey: apiKey}

	if !client.zoneExists(ctx, fqdn) {
		if err := client.createZone(ctx, fqdn); err != nil {
			return "", err
		}
	}

	// PowerDNS auto-creates an SOA on zone creation using its
	// "default-soa-content" template, which is literally
	// "a.misconfigured.dns.server.invalid hostmaster.@ ..." until something
	// overwrites it - so every zone was serving that placeholder as its
	// primary nameserver to every resolver on the internet. Always PATCH a
	// real SOA (using the same ns1.<zone> convention already shown in the
	// delegation panel) so this happens on every apply, not just the first.
	rrsets := []map[string]interface{}{{
		"name":       fqdn,
		"type":       "SOA",
		"ttl":        3600,
		"changetype": "REPLACE",
		"records": []map[string]interface{}{{
			"content":  fmt.Sprintf("ns1.%s. hostmaster.%s. %s 10800 3600 604800 3600", zoneName, zoneName, time.Now().Format("20060102")+"00"),
			"disabled": false,
		}},
	}}

	// createZone passes an empty nameservers list on purpose (see its own
	// comment) - PowerDNS never auto-creates NS records for the zone, so
	// without this the zone has none at all, which is exactly what showed
	// up as "missing nameservers" / "mismatched NS records" from an
	// external DNS health check. One NS record per group member, matching
	// the ns1./ns2./... names already shown in the delegation panel.
	nameservers := readStringSlice(payload, "nameservers")
	if len(nameservers) == 0 {
		nameservers = []string{"ns1." + zoneName}
	}
	nsRecords := make([]map[string]interface{}, 0, len(nameservers))
	for _, ns := range nameservers {
		// pdnsQualifyTarget rather than a bare ns+"." so a nameserver that
		// already arrives canonical doesn't become "ns1.example.com.." and
		// take the whole atomic zone PATCH down with it.
		nsRecords = append(nsRecords, map[string]interface{}{"content": pdnsQualifyTarget(ns), "disabled": false})
	}
	rrsets = append(rrsets, map[string]interface{}{
		"name":       fqdn,
		"type":       "NS",
		"ttl":        3600,
		"changetype": "REPLACE",
		"records":    nsRecords,
	})

	// In-bailiwick nameservers (ns1.<zone>, ns2.<zone>, ... living inside the
	// zone they serve) need an A/AAAA record for themselves inside the zone
	// itself, in addition to glue registered at the registrar - a resolver
	// that reaches this zone's own authoritative server still needs to
	// resolve "what's the address of ns1.<zone>?" from zone data, otherwise
	// it gets NXDOMAIN even though delegation works (confirmed in
	// production). One rrset per glue entry, keyed by whether the address
	// is IPv4 or IPv6.
	for _, glue := range readGlueEntries(payload, "nsGlue") {
		rrType := "A"
		if parsed := net.ParseIP(glue.IP); parsed != nil && parsed.To4() == nil {
			rrType = "AAAA"
		}
		rrsets = append(rrsets, map[string]interface{}{
			"name":       glue.Host + ".",
			"type":       rrType,
			"ttl":        3600,
			"changetype": "REPLACE",
			"records":    []map[string]interface{}{{"content": glue.IP, "disabled": false}},
		})
	}

	for _, record := range records {
		var pdnsRecords []map[string]interface{}
		rrsetType := record.Type
		if record.IsGeo {
			rrsetType = "LUA"
			quoted := make([]string, 0, len(record.Values))
			for _, value := range record.Values {
				quoted = append(quoted, "'"+strings.ReplaceAll(value.Content, "'", "\\'")+"'")
			}
			// PowerDNS's LUA rrset content is "<returned-type> \"<lua
			// expression>\"" - the type comes FIRST, unquoted, and the Lua
			// expression itself is what's quoted. The previous
			// "\"a\" pickclosest(...)" form (type quoted, expression bare)
			// was rejected outright by the API ("Unknown DNS type '"a"'"),
			// confirmed empirically against a real pdns_server 4.5.3 - isGeo
			// records never actually worked before this fix.
			pdnsRecords = []map[string]interface{}{{
				"content":  fmt.Sprintf("A \"pickclosest({%s})\"", strings.Join(quoted, ",")),
				"disabled": false,
			}}
		} else {
			for _, value := range record.Values {
				content := value.Content
				switch {
				case record.Type == "MX" || record.Type == "SRV":
					content = fmt.Sprintf("%d %s", value.Priority, pdnsQualifyTarget(content))
				case pdnsTargetTypes[record.Type]:
					content = pdnsQualifyTarget(content)
				case pdnsQuotedTypes[record.Type]:
					content = pdnsQuoteTxt(content)
				}
				pdnsRecords = append(pdnsRecords, map[string]interface{}{"content": content, "disabled": false})
			}
		}

		rrsets = append(rrsets, map[string]interface{}{
			"name":       dnsRecordFqdn(zoneName, record.Name),
			"type":       rrsetType,
			"ttl":        record.Ttl,
			"changetype": "REPLACE",
			"records":    pdnsRecords,
		})
	}

	if len(rrsets) > 0 {
		if err := client.patchRrsets(ctx, fqdn, rrsets); err != nil {
			return "", err
		}
	}

	if readBool(payload, "dnssecEnabled") {
		if err := client.enableDnssec(ctx, fqdn); err != nil {
			log.Printf("dns: enabling DNSSEC for %s failed: %v", zoneName, err)
		}
	}

	return fmt.Sprintf("applied %d record(s) to zone %s", len(rrsets), zoneName), nil
}

// applyDnsZoneSlave explicitly ensures this (secondary) node has the zone
// configured as a Slave of the primary. Idempotent - if the zone already
// exists here (as Slave from a previous apply), it's a no-op; actual data
// sync happens over native AXFR between PowerDNS instances afterwards, not
// through Tarmac. Best-effort forces an immediate transfer and TSIG
// association rather than failing the whole apply if either doesn't work,
// since the zone is still correctly configured either way (via
// allow-axfr-ips) and will pick up on the next natural SOA refresh.
func applyDnsZoneSlave(payload map[string]interface{}) (string, error) {
	zoneName := readString(payload, "zoneName")
	primaryVlanIp := readString(payload, "primaryVlanIp")
	groupID := readString(payload, "groupId")
	if zoneName == "" || primaryVlanIp == "" {
		return "", errors.New("apply_dns_zone_slave payload must include zoneName and primaryVlanIp")
	}
	fqdn := zoneName + "."

	apiKey, err := ensurePdnsApiKey()
	if err != nil {
		return "", err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	client := &pdnsClient{apiKey: apiKey}

	// Only the creation step is skip-if-exists - metadata and the AXFR
	// trigger below always re-run on every apply. Skipping them too (as a
	// previous version did) made this non-idempotent: if the zone shell got
	// created but the very first transfer silently failed, every later
	// reapply became a no-op forever, leaving the secondary stuck REFUSED
	// for a zone it never actually received (confirmed in production).
	if !client.zoneExists(ctx, fqdn) {
		if err := client.createSlaveZone(ctx, fqdn, primaryVlanIp); err != nil {
			return "", err
		}
	}

	if groupID != "" {
		if err := client.setZoneMetadata(ctx, fqdn, "AXFR-MASTER-TSIG", []string{tsigKeyName(groupID)}); err != nil {
			log.Printf("dns: could not associate TSIG key with slave zone %s, transfer stays IP-restricted via allow-axfr-ips only: %v", zoneName, err)
		}
	}

	if err := client.triggerAxfrRetrieve(ctx, fqdn); err != nil {
		log.Printf("dns: could not trigger immediate AXFR for %s, it will still transfer on the next SOA refresh: %v", zoneName, err)
	}

	return fmt.Sprintf("zone %s configured as slave of %s", zoneName, primaryVlanIp), nil
}

func removeDnsZone(payload map[string]interface{}) (string, error) {
	zoneName := readString(payload, "zoneName")
	if zoneName == "" {
		return "", errors.New("remove_dns_zone payload must include zoneName")
	}
	apiKey, err := ensurePdnsApiKey()
	if err != nil {
		return "", err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := (&pdnsClient{apiKey: apiKey}).deleteZone(ctx, zoneName+"."); err != nil {
		return "", err
	}
	return fmt.Sprintf("removed zone %s", zoneName), nil
}

// uninstallDnsFromNode runs when this node is removed from a DNS server
// group (or its group is deleted) - removes every zone this node's own
// PowerDNS is currently serving and stops it from answering further.
// Idempotent (safe to call more than once, e.g. a retried command): no-ops
// entirely if dnsMarkerPath is already gone, and every step logs and
// continues on error rather than aborting, so a single failed zone deletion
// doesn't leave the service running or later zones un-cleaned.
//
// Deliberately does NOT touch the port-53 competitor
// (knownPort53Services/permanentlyDisableService) or /etc/resolv.conf -
// restoring the node's original resolver is out of scope for now (no way to
// verify that against real systemd from this development environment); the
// node is left with PowerDNS stopped/disabled but the original resolver
// still masked, same as it is mid-lifecycle today.
//
// Also deliberately does NOT uninstall the pdns-server/pdns-backend-sqlite3
// packages themselves - stop+disable is enough to free port 53 and stop it
// answering, and leaves the node instantly reusable (no reinstall) if it
// rejoins a group later.
func uninstallDnsFromNode(ctx context.Context) (string, error) {
	if _, err := os.Stat(dnsMarkerPath); err != nil {
		return "node was not DNS-enabled, nothing to clean up", nil
	}

	zonesRemoved := 0
	if apiKey, err := ensurePdnsApiKey(); err != nil {
		log.Printf("dns: uninstall could not read the PowerDNS API key, skipping zone cleanup: %v", err)
	} else if zoneNames, err := fetchPdnsZoneNames(ctx, apiKey); err != nil {
		log.Printf("dns: uninstall could not list zones to remove, skipping zone cleanup: %v", err)
	} else {
		client := &pdnsClient{apiKey: apiKey}
		for _, zoneName := range zoneNames {
			if err := client.deleteZone(ctx, zoneName); err != nil {
				log.Printf("dns: uninstall could not remove zone %s (continuing): %v", zoneName, err)
				continue
			}
			zonesRemoved++
		}
	}

	if commandExists("systemctl") {
		if out, err := exec.CommandContext(ctx, "systemctl", "stop", "pdns").CombinedOutput(); err != nil {
			log.Printf("dns: uninstall: systemctl stop pdns failed (continuing): %s", strings.TrimSpace(string(out)))
		}
		if out, err := exec.CommandContext(ctx, "systemctl", "disable", "pdns").CombinedOutput(); err != nil {
			log.Printf("dns: uninstall: systemctl disable pdns failed (continuing): %s", strings.TrimSpace(string(out)))
		}
	}

	_ = os.Remove(dnsMarkerPath)
	return fmt.Sprintf("PowerDNS stopped, %d zone(s) removed from this node", zonesRemoved), nil
}

// ---------------------------------------------------------------------
// Internal PowerDNS instance - a second, independent pdns_server process
// (via --config-name=internal) serving *.tarmac.local on a non-standard
// port for the fleet's own name resolution. See the constants block above
// for why this is kept fully separate from the normal instance.
// ---------------------------------------------------------------------

var pdnsUnitCandidates = []string{
	"/lib/systemd/system/pdns.service",
	"/usr/lib/systemd/system/pdns.service",
}

// ensureInternalPdnsSystemdUnit writes /etc/systemd/system/pdns-internal.service
// by copying the pdns-server package's own real unit file and only touching
// the ExecStart line (appends --config-name=internal) - deliberately not
// hand-authored from scratch, since guessing at User=/resource limits/
// Type=notify semantics without being able to verify against a real
// systemd from this environment would be exactly the kind of unverified
// PowerDNS assumption this project has been burned by before. No-op if the
// unit file already exists (idempotent across re-applies).
func ensureInternalPdnsSystemdUnit(ctx context.Context) error {
	if !commandExists("systemctl") {
		return nil
	}
	unitPath := "/etc/systemd/system/" + internalPdnsSystemdUnit + ".service"
	if _, err := os.Stat(unitPath); err == nil {
		return nil
	}

	var source string
	for _, candidate := range pdnsUnitCandidates {
		if data, err := os.ReadFile(candidate); err == nil {
			source = string(data)
			break
		}
	}
	if source == "" {
		return fmt.Errorf("could not find the pdns-server package's own systemd unit (checked: %s)", strings.Join(pdnsUnitCandidates, ", "))
	}

	lines := strings.Split(source, "\n")
	found := false
	for i, line := range lines {
		if strings.HasPrefix(strings.TrimSpace(line), "ExecStart=") {
			lines[i] = strings.TrimRight(line, " \t") + " --config-name=internal"
			found = true
			break
		}
	}
	if !found {
		return errors.New("pdns-server's systemd unit has no ExecStart line to extend")
	}

	if err := os.WriteFile(unitPath, []byte(strings.Join(lines, "\n")), 0o644); err != nil {
		return fmt.Errorf("cannot write %s: %w", unitPath, err)
	}
	if out, err := exec.CommandContext(ctx, "systemctl", "daemon-reload").CombinedOutput(); err != nil {
		return fmt.Errorf("systemctl daemon-reload failed: %s", strings.TrimSpace(string(out)))
	}
	return nil
}

// writeInternalPdnsConfig reports whether the file actually changed, so the
// instance is only restarted when its configuration did.
func writeInternalPdnsConfig(apiKey string, port, apiPort int) (bool, error) {
	if err := os.MkdirAll(filepath.Dir(internalPdnsConfigPath), 0o755); err != nil {
		return false, fmt.Errorf("cannot create powerdns config dir: %w", err)
	}
	lines := []string{
		"launch=gsqlite3",
		"gsqlite3-database=" + internalPdnsSqliteDbPath,
		"local-address=0.0.0.0",
		fmt.Sprintf("local-port=%d", port),
		"api=yes",
		"api-key=" + apiKey,
		"webserver=yes",
		"webserver-address=127.0.0.1",
		fmt.Sprintf("webserver-port=%d", apiPort),
		"webserver-allow-from=127.0.0.1",
		// Single always-Master instance, no AXFR fan-out - one node,
		// designated explicitly by the user, serves the whole fleet's
		// internal zone directly (see the plan's topology discussion:
		// deliberately not replicated like DnsServerGroup's public zones).
	}
	content := strings.Join(lines, "\n") + "\n"
	if current, err := os.ReadFile(internalPdnsConfigPath); err == nil && string(current) == content {
		return false, nil
	}
	return true, os.WriteFile(internalPdnsConfigPath, []byte(content), 0o644)
}

// internalPdnsConfiguredPort reads a port setting back from the instance's
// current config file (0 when absent).
func internalPdnsConfiguredPort(key string) int {
	data, err := os.ReadFile(internalPdnsConfigPath)
	if err != nil {
		return 0
	}
	for _, line := range strings.Split(string(data), "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, key+"=") {
			port, _ := strconv.Atoi(strings.TrimSpace(strings.TrimPrefix(line, key+"=")))
			return port
		}
	}
	return 0
}

func internalPdnsActive(ctx context.Context) bool {
	return commandExists("systemctl") && exec.CommandContext(ctx, "systemctl", "is-active", "--quiet", internalPdnsSystemdUnit).Run() == nil
}

// A port bound by pdns_server while pdns-internal runs with that very port
// in its config is our own listener, not a conflict.
func heldByOurInstance(ctx context.Context, conflict *dnsPortConflict, key string, port int) bool {
	return conflict != nil && strings.HasPrefix(conflict.ProcessName, "pdns") &&
		internalPdnsConfiguredPort(key) == port && internalPdnsActive(ctx)
}

func describePortHolder(conflict *dnsPortConflict) string {
	if conflict.ProcessName == "" {
		return "un autre processus"
	}
	if conflict.PID != nil {
		return fmt.Sprintf("%s (pid %d)", conflict.ProcessName, *conflict.PID)
	}
	return conflict.ProcessName
}

// pickInternalPdnsApiPort keeps the control plane's port when it is free.
// The API port is only ever reached by this agent on 127.0.0.1, so when
// another service already listens there the next free port is used instead
// of failing: that collision is what left pdns-internal unable to start
// (webserver bind error) while the agent talked to the other service and
// got back a 404 that wasn't PowerDNS's.
func pickInternalPdnsApiPort(ctx context.Context, preferred int) (int, error) {
	for offset := 0; offset <= 20; offset++ {
		candidate := preferred + offset
		conflict := probePortBinding(candidate, "tcp")
		if conflict == nil || heldByOurInstance(ctx, conflict, "webserver-port", candidate) {
			if offset > 0 {
				log.Printf("dns: internal PowerDNS API port %d is taken by %s, using %d", preferred, describePortHolder(probePortBinding(preferred, "tcp")), candidate)
			}
			return candidate, nil
		}
	}
	return 0, fmt.Errorf("aucun port libre pour l'API PowerDNS interne entre %d et %d", preferred, preferred+20)
}

// The DNS port is the one every node of the fleet forwards to, so unlike
// the API port it can't move: report who holds it.
func checkInternalPdnsDnsPort(ctx context.Context, port int) error {
	for _, protocol := range []string{"udp", "tcp"} {
		conflict := probePortBinding(port, protocol)
		if conflict == nil || heldByOurInstance(ctx, conflict, "local-port", port) {
			continue
		}
		return fmt.Errorf("le port DNS %d/%s est déjà utilisé par %s : libérez-le puis relancez l'installation", port, protocol, describePortHolder(conflict))
	}
	return nil
}

const internalDnsFirewallComment = "tarmac-internal-dns"

// setInternalDnsFirewall opens (or closes) the internal DNS port on the
// overlay interface only. Hosts running ufw or a default-DROP INPUT policy
// otherwise drop every query the rest of the fleet sends here: the instance
// answers locally, its API works, and *.tarmac.local still times out
// everywhere else. The rule goes first in INPUT, ahead of ufw's chains, and
// accepts nothing that doesn't arrive over the WireGuard mesh.
func setInternalDnsFirewall(enabled bool, port int) error {
	if !commandExists("iptables") || port <= 0 {
		return nil
	}
	var firstErr error
	for _, protocol := range []string{"udp", "tcp"} {
		spec := []string{"-i", "tarmacwg0", "-p", protocol, "--dport", strconv.Itoa(port), "-j", "ACCEPT", "-m", "comment", "--comment", internalDnsFirewallComment}
		exists := exec.Command("iptables", append([]string{"-C", "INPUT"}, spec...)...).Run() == nil
		var out []byte
		var err error
		switch {
		case enabled && !exists:
			out, err = exec.Command("iptables", append([]string{"-I", "INPUT", "1"}, spec...)...).CombinedOutput()
		case !enabled && exists:
			out, err = exec.Command("iptables", append([]string{"-D", "INPUT"}, spec...)...).CombinedOutput()
		}
		if err != nil && firstErr == nil {
			firstErr = fmt.Errorf("internal DNS firewall rule (%s/%d): %s", protocol, port, strings.TrimSpace(string(out)))
		}
	}
	return firstErr
}

// internalPdnsJournalTail returns the instance's last log lines, appended
// to a start failure so the Journal says why instead of "see journalctl".
func internalPdnsJournalTail(ctx context.Context) string {
	if !commandExists("journalctl") {
		return ""
	}
	out, err := exec.CommandContext(ctx, "journalctl", "-u", internalPdnsSystemdUnit, "-n", "8", "--no-pager", "-o", "cat").Output()
	if err != nil {
		return ""
	}
	lines := []string{}
	for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		if line = strings.TrimSpace(line); line != "" {
			lines = append(lines, line)
		}
	}
	if len(lines) == 0 {
		return ""
	}
	return " — journal pdns-internal : " + strings.Join(lines, " / ")
}

// waitInternalPdnsApi waits for the freshly (re)started instance to answer,
// and checks that what answers really is PowerDNS.
func waitInternalPdnsApi(ctx context.Context, client *pdnsClient) error {
	deadline := time.Now().Add(15 * time.Second)
	var lastErr error
	for time.Now().Before(deadline) {
		body, status, err := client.request(ctx, http.MethodGet, "", nil)
		if err == nil {
			// Until it is up, PowerDNS doesn't accept connections at all:
			// any HTTP answer is final.
			var server struct {
				DaemonType string `json:"daemon_type"`
				Error      string `json:"error"`
			}
			_ = json.Unmarshal(body, &server)
			switch {
			case status == http.StatusOK && server.DaemonType != "":
				return nil
			case server.Error != "":
				return fmt.Errorf("l'API PowerDNS interne refuse la requête (HTTP %d : %s)", status, server.Error)
			default:
				return fmt.Errorf("le port de l'API PowerDNS interne est occupé par un autre service (HTTP %d : %s)", status, truncate(strings.TrimSpace(string(body)), 160))
			}
		}
		lastErr = err
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(500 * time.Millisecond):
		}
	}
	return fmt.Errorf("l'API PowerDNS interne ne répond pas après 15 s (%v)%s", lastErr, internalPdnsJournalTail(ctx))
}

// installInternalPdns brings up the dedicated internal PowerDNS instance if
// it isn't already running - idempotent, safe to call on every sync tick
// (which is exactly how the control plane drives it: command.setup_internal_dns
// doubles as both first-install and every subsequent record sync). Returns
// the API key and the API port actually used (see pickInternalPdnsApiPort).
func installInternalPdns(ctx context.Context, port, apiPort int) (string, int, error) {
	if _, err := ensureAgentSystemPackages(ctx, []string{"pdns-server", "pdns-backend-sqlite3"}); err != nil {
		return "", 0, fmt.Errorf("cannot install PowerDNS: %w", err)
	}
	if err := ensureSqliteDatabaseAt(ctx, internalPdnsSqliteDbPath); err != nil {
		return "", 0, err
	}
	apiKey, err := ensureApiKeyAt(internalPdnsApiKeyPath)
	if err != nil {
		return "", 0, err
	}
	if err := checkInternalPdnsDnsPort(ctx, port); err != nil {
		return "", 0, err
	}
	apiPort, err = pickInternalPdnsApiPort(ctx, apiPort)
	if err != nil {
		return "", 0, err
	}
	changed, err := writeInternalPdnsConfig(apiKey, port, apiPort)
	if err != nil {
		return "", 0, err
	}
	if err := ensureInternalPdnsSystemdUnit(ctx); err != nil {
		return "", 0, err
	}
	if commandExists("systemctl") {
		if out, err := exec.CommandContext(ctx, "systemctl", "enable", internalPdnsSystemdUnit).CombinedOutput(); err != nil {
			return "", 0, fmt.Errorf("cannot enable %s: %s", internalPdnsSystemdUnit, strings.TrimSpace(string(out)))
		}
		// Restarting on every sync tick would drop queries for nothing.
		if changed || !internalPdnsActive(ctx) {
			if out, err := exec.CommandContext(ctx, "systemctl", "restart", internalPdnsSystemdUnit).CombinedOutput(); err != nil {
				return "", 0, fmt.Errorf("cannot start %s: %s%s", internalPdnsSystemdUnit, firstLine(string(out)), internalPdnsJournalTail(ctx))
			}
		}
	}
	if err := setInternalDnsFirewall(true, port); err != nil {
		return "", 0, err
	}
	if err := os.MkdirAll(filepath.Dir(internalDnsMarkerPath), 0o755); err == nil {
		_ = os.WriteFile(internalDnsMarkerPath, []byte("enabled\n"), 0o600)
	}
	return apiKey, apiPort, nil
}

func truncate(value string, max int) string {
	if len(value) <= max {
		return value
	}
	return value[:max] + "…"
}

func firstLine(value string) string {
	line := strings.TrimSpace(value)
	if index := strings.IndexByte(line, '\n'); index >= 0 {
		line = line[:index]
	}
	return line
}

// applyInternalDnsRecords installs (if needed) and (re)applies the full A
// record set for tarmac.local - same whole-zone-snapshot-push style as
// applyDnsZone, just simpler (single Master zone, no primary/secondary
// role, no DNSSEC).
func applyInternalDnsRecords(ctx context.Context, payload map[string]interface{}) (string, error) {
	port := readInt(payload, "port", 5300)
	apiPort := readInt(payload, "apiPort", 8090)

	apiKey, apiPort, err := installInternalPdns(ctx, port, apiPort)
	if err != nil {
		return "", err
	}
	client := &pdnsClient{apiKey: apiKey, baseURL: fmt.Sprintf("http://127.0.0.1:%d/api/v1/servers/localhost", apiPort)}
	if err := waitInternalPdnsApi(ctx, client); err != nil {
		return "", err
	}
	if !client.zoneExists(ctx, internalDnsZoneName) {
		if err := client.createZone(ctx, internalDnsZoneName); err != nil {
			return "", err
		}
	}

	rawRecords, _ := payload["records"].([]interface{})
	desired := make(map[string]string, len(rawRecords))
	for _, raw := range rawRecords {
		entry, ok := raw.(map[string]interface{})
		if !ok {
			continue
		}
		name := readString(entry, "name")
		content := readString(entry, "content")
		if name == "" || content == "" {
			continue
		}
		desired[dnsRecordFqdn(strings.TrimSuffix(internalDnsZoneName, "."), name)] = content
	}

	// PATCH with changetype REPLACE only ever touches the rrsets named in
	// the request - it never removes ones that simply aren't mentioned
	// anymore. Since this function recomputes the *entire* desired set from
	// scratch every call (no per-node "delete this one" ever gets sent
	// separately, unlike the user-facing DnsRecordsService flow), a stale
	// node here would otherwise linger in tarmac.local forever. So: diff
	// against what's actually in the zone today and explicitly DELETE
	// whatever A record is no longer desired (confirmed empirically this
	// left node2/node3 behind on the first version of this function without
	// this diff, caught by the Docker verification spike before this ever
	// shipped).
	existing, err := client.fetchZoneARecordNames(ctx, internalDnsZoneName)
	if err != nil {
		return "", err
	}

	rrsets := make([]map[string]interface{}, 0, len(desired)+len(existing))
	for name, content := range desired {
		rrsets = append(rrsets, map[string]interface{}{
			"name":       name,
			"type":       "A",
			"ttl":        300,
			"changetype": "REPLACE",
			"records":    []map[string]interface{}{{"content": content, "disabled": false}},
		})
	}
	for _, name := range existing {
		if _, stillDesired := desired[name]; stillDesired {
			continue
		}
		rrsets = append(rrsets, map[string]interface{}{
			"name":       name,
			"type":       "A",
			"changetype": "DELETE",
		})
	}

	if len(rrsets) > 0 {
		if err := client.patchRrsets(ctx, internalDnsZoneName, rrsets); err != nil {
			return "", err
		}
	}
	return fmt.Sprintf("tarmac.local ready with %d record(s)", len(desired)), nil
}

// removeInternalDns is uninstallDnsFromNode's counterpart for the dedicated
// internal instance - same idempotent, tolerant-of-partial-failure shape,
// targeting pdns-internal instead of the normal pdns service.
func removeInternalDns(ctx context.Context) (string, error) {
	if _, err := os.Stat(internalDnsMarkerPath); err != nil {
		return "node was not running the internal DNS instance, nothing to clean up", nil
	}

	if apiKey, err := os.ReadFile(internalPdnsApiKeyPath); err == nil {
		apiPort := internalPdnsConfiguredPort("webserver-port")
		if apiPort == 0 {
			apiPort = 8090
		}
		client := &pdnsClient{apiKey: strings.TrimSpace(string(apiKey)), baseURL: fmt.Sprintf("http://127.0.0.1:%d/api/v1/servers/localhost", apiPort)}
		if err := client.deleteZone(ctx, internalDnsZoneName); err != nil {
			log.Printf("dns: internal DNS uninstall could not remove tarmac.local (continuing): %v", err)
		}
	}

	if commandExists("systemctl") {
		if out, err := exec.CommandContext(ctx, "systemctl", "stop", internalPdnsSystemdUnit).CombinedOutput(); err != nil {
			log.Printf("dns: internal DNS uninstall: systemctl stop %s failed (continuing): %s", internalPdnsSystemdUnit, strings.TrimSpace(string(out)))
		}
		if out, err := exec.CommandContext(ctx, "systemctl", "disable", internalPdnsSystemdUnit).CombinedOutput(); err != nil {
			log.Printf("dns: internal DNS uninstall: systemctl disable %s failed (continuing): %s", internalPdnsSystemdUnit, strings.TrimSpace(string(out)))
		}
	}

	if err := setInternalDnsFirewall(false, internalPdnsConfiguredPort("local-port")); err != nil {
		log.Printf("dns: internal DNS uninstall: %v (continuing)", err)
	}
	_ = os.Remove(internalDnsMarkerPath)
	return "internal DNS instance stopped and tarmac.local removed", nil
}

func fetchDnsZoneKeys(payload map[string]interface{}) (dnsZoneKeysResultData, error) {
	zoneName := readString(payload, "zoneName")
	if zoneName == "" {
		return dnsZoneKeysResultData{}, errors.New("dns_get_zone_keys payload must include zoneName")
	}
	apiKey, err := ensurePdnsApiKey()
	if err != nil {
		return dnsZoneKeysResultData{}, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	keys, err := (&pdnsClient{apiKey: apiKey}).fetchCryptoKeys(ctx, zoneName+".")
	if err != nil {
		return dnsZoneKeysResultData{}, err
	}

	var ds, dnskey []string
	for _, key := range keys {
		active, _ := key["active"].(bool)
		if !active {
			continue
		}
		if rawDs, ok := key["ds"].([]interface{}); ok {
			for _, entry := range rawDs {
				if s, ok := entry.(string); ok {
					ds = append(ds, s)
				}
			}
		}
		if s, ok := key["dnskey"].(string); ok && s != "" {
			dnskey = append(dnskey, s)
		}
	}
	return dnsZoneKeysResultData{Dns: dnsZoneKeysData{DsRecords: ds, DnskeyRecords: dnskey}}, nil
}

// ---------------------------------------------------------------------
// handleCommand wrappers - the switch itself stays in main.go (shared
// dispatcher for every command type), these hold the DNS-specific case
// body logic that used to live inline there.
// ---------------------------------------------------------------------

func handleApplyDnsServerGroupCommand(ctx context.Context, cmd commandPayload, result *commandResult) {
	dnsPort53Mu.Lock()
	defer dnsPort53Mu.Unlock()
	result.Command = "apply_dns_server_group"
	result.ResourceType = "dns_server_group_member"
	dnsGroupID := readString(cmd.Payload, "groupId")
	dnsMemberNodeID := readString(cmd.Payload, "nodeId")
	result.ResourceID = fmt.Sprintf("%s:%s", dnsGroupID, dnsMemberNodeID)
	message, data, err := applyDnsServerGroup(ctx, cmd.Payload)
	if data != nil {
		result.Data = data
	}
	if err != nil {
		result.Success = false
		result.Message = err.Error()
	} else {
		result.Message = message
	}
}

func handleApplyDnsZoneCommand(cmd commandPayload, result *commandResult) {
	result.Command = "apply_dns_zone"
	result.ResourceType = "dns_zone"
	result.ResourceID = readString(cmd.Payload, "zoneId")
	message, err := applyDnsZone(cmd.Payload)
	if err != nil {
		result.Success = false
		result.Message = err.Error()
	} else {
		result.Message = message
	}
}

func handleApplyDnsZoneSlaveCommand(cmd commandPayload, result *commandResult) {
	result.Command = "apply_dns_zone_slave"
	result.ResourceType = "dns_zone_slave"
	result.ResourceID = readString(cmd.Payload, "zoneId")
	message, err := applyDnsZoneSlave(cmd.Payload)
	if err != nil {
		result.Success = false
		result.Message = err.Error()
	} else {
		result.Message = message
	}
}

func handleRemoveDnsZoneCommand(cmd commandPayload, result *commandResult) {
	result.Command = "remove_dns_zone"
	result.ResourceType = "dns_zone"
	result.ResourceID = readString(cmd.Payload, "zoneId")
	message, err := removeDnsZone(cmd.Payload)
	if err != nil {
		result.Success = false
		result.Message = err.Error()
	} else {
		result.Message = message
	}
}

func handleUninstallDnsNodeCommand(ctx context.Context, cmd commandPayload, result *commandResult) {
	dnsPort53Mu.Lock()
	defer dnsPort53Mu.Unlock()
	result.Command = "uninstall_dns_node"
	result.ResourceType = "dns_node"
	result.ResourceID = envOrDefault("NODE_ID", "agent")
	message, err := uninstallDnsFromNode(ctx)
	if err != nil {
		result.Success = false
		result.Message = err.Error()
	} else {
		result.Message = message
	}
}

func handleSetupInternalDnsCommand(ctx context.Context, cmd commandPayload, result *commandResult) {
	result.Command = "setup_internal_dns"
	result.ResourceType = "internal_dns"
	result.ResourceID = envOrDefault("NODE_ID", "agent")
	message, err := applyInternalDnsRecords(ctx, cmd.Payload)
	if err != nil {
		result.Success = false
		result.Message = err.Error()
	} else {
		result.Message = message
	}
}

func handleRemoveInternalDnsCommand(ctx context.Context, cmd commandPayload, result *commandResult) {
	result.Command = "remove_internal_dns"
	result.ResourceType = "internal_dns"
	result.ResourceID = envOrDefault("NODE_ID", "agent")
	message, err := removeInternalDns(ctx)
	if err != nil {
		result.Success = false
		result.Message = err.Error()
	} else {
		result.Message = message
	}
}

const (
	internalDnsForwarderMarkerPath = "/etc/tarmac-agent/internal-dns-forwarder-enabled"
	internalDnsDnsmasqConfigPath   = "/etc/dnsmasq.d/tarmac-internal.conf"
	internalDnsHostsBeginMarker    = "# BEGIN TARMAC INTERNAL DNS (tarmac.local) - managed by tarmac-agent, do not edit"
	internalDnsHostsEndMarker      = "# END TARMAC INTERNAL DNS"
)

// hostsPath is a var (not const) so tests can point it at a temp file
// instead of the real /etc/hosts.
var hostsPath = "/etc/hosts"

// hostsSafeLabelRe matches exactly what slugify() on the API side already
// constrains node names/dnsHostname to - lowercase alphanumerics and
// hyphens, no leading/trailing hyphen. Re-checked here because /etc/hosts
// has no escaping: a name containing whitespace or a newline could corrupt
// the file's line structure or inject an unrelated-looking entry.
var hostsSafeLabelRe = regexp.MustCompile(`^[a-z0-9]([a-z0-9-]*[a-z0-9])?$`)

type internalDnsRouteResultData struct {
	Status   string           `json:"status"`
	Conflict *dnsPortConflict `json:"conflict,omitempty"`
}

// ensureInternalDnsSplitRoute points *.tarmac.local queries at the
// workspace's designated internal DNS node over the overlay mesh. Tries
// systemd-resolved's per-link "routing domain" feature first (resolvectl
// domain/dns on tarmacwg0 - touches nothing else on the node), and actually
// exercises the commands rather than just checking the binary exists: a
// node can have the resolvectl CLI installed with the resolved service
// itself not running (confirmed in production - "Unit
// dbus-org.freedesktop.resolve1.service not found" on a real fleet node),
// which silently no-ops if only checked for command presence. Falls back to
// a local dnsmasq forwarder (ensureInternalDnsForwarder) when resolvectl is
// missing or fails. Idempotent either way - safe to re-run with the same or
// different ip on every sync tick (see internal-dns.service.ts's
// pushRouteToFleet), which is what makes an already-deployed fleet pick up
// the route automatically the moment its agent reconnects. Empty ip clears
// the route (internal DNS turned off for this workspace).
// probeInternalDns sends one real query (SOA tarmac.local) to the internal
// DNS server over the mesh. A configured route says nothing about whether
// the server answers: a firewall on the DNS node dropping the port left
// every node reporting "active" while *.tarmac.local timed out everywhere.
func probeInternalDns(ip string, port int) bool {
	conn, err := net.DialTimeout("udp", net.JoinHostPort(ip, strconv.Itoa(port)), 2*time.Second)
	if err != nil {
		return false
	}
	defer conn.Close()
	id := uint16(time.Now().UnixNano())
	query := []byte{byte(id >> 8), byte(id), 0x01, 0x00, 0, 1, 0, 0, 0, 0, 0, 0}
	for _, label := range strings.Split(strings.TrimSuffix(internalDnsZoneName, "."), ".") {
		query = append(query, byte(len(label)))
		query = append(query, label...)
	}
	query = append(query, 0, 0, 6, 0, 1) // QTYPE SOA, QCLASS IN
	for attempt := 0; attempt < 2; attempt++ {
		_ = conn.SetDeadline(time.Now().Add(1500 * time.Millisecond))
		if _, err := conn.Write(query); err != nil {
			return false
		}
		reply := make([]byte, 512)
		n, err := conn.Read(reply)
		if err == nil && n >= 12 && reply[0] == query[0] && reply[1] == query[1] {
			return true
		}
	}
	return false
}

func ensureInternalDnsSplitRoute(ctx context.Context, ip string, port int, records []internalDnsHostRecord) internalDnsRouteResultData {
	result := applyInternalDnsSplitRoute(ctx, ip, port, records)
	if result.Status == "active" && !probeInternalDns(ip, port) {
		result.Status = "unreachable"
	}
	return result
}

func applyInternalDnsSplitRoute(ctx context.Context, ip string, port int, records []internalDnsHostRecord) internalDnsRouteResultData {
	if ip == "" {
		if commandExists("resolvectl") {
			if out, err := exec.CommandContext(ctx, "resolvectl", "domain", "tarmacwg0", "").CombinedOutput(); err != nil {
				log.Printf("dns: could not clear tarmac.local routing domain (continuing): %s", strings.TrimSpace(string(out)))
			}
		}
		if err := removeInternalDnsForwarder(ctx); err != nil {
			log.Printf("dns: could not remove internal DNS forwarder (continuing): %v", err)
		}
		if err := removeInternalDnsHostsBlock(); err != nil {
			log.Printf("dns: could not remove internal DNS /etc/hosts block (continuing): %v", err)
		}
		return internalDnsRouteResultData{Status: "cleared"}
	}

	if commandExists("resolvectl") {
		_, dnsErr := exec.CommandContext(ctx, "resolvectl", "dns", "tarmacwg0", fmt.Sprintf("%s:%d", ip, port)).CombinedOutput()
		_, domainErr := exec.CommandContext(ctx, "resolvectl", "domain", "tarmacwg0", "~tarmac.local").CombinedOutput()
		if dnsErr == nil && domainErr == nil {
			// resolvectl works now - clean up anything a previous, less
			// capable state left behind (a dnsmasq forwarder installed while
			// resolvectl was broken, or a static /etc/hosts block from
			// before this node ran its own PowerDNS) so it doesn't linger
			// and shadow live results forever. Best-effort: a resolving
			// split-DNS route is the important part, this is just tidying.
			if err := removeInternalDnsForwarder(ctx); err != nil {
				log.Printf("dns: could not remove stale internal DNS forwarder (continuing): %v", err)
			}
			if err := removeInternalDnsHostsBlock(); err != nil {
				log.Printf("dns: could not remove stale internal DNS /etc/hosts block (continuing): %v", err)
			}
			return internalDnsRouteResultData{Status: "active"}
		}
		log.Printf("dns: resolvectl present but not usable on this node (systemd-resolved not running?), trying local dnsmasq forwarder fallback")
	} else {
		log.Printf("dns: resolvectl not installed, trying local dnsmasq forwarder fallback")
	}

	status, conflict, err := ensureInternalDnsForwarder(ctx, ip, port, records)
	if err != nil {
		log.Printf("dns: internal DNS forwarder fallback failed: %v", err)
		return internalDnsRouteResultData{Status: "error"}
	}
	return internalDnsRouteResultData{Status: status, Conflict: conflict}
}

// ensureInternalDnsForwarder installs and configures a local dnsmasq
// listening on 127.0.0.1:53, forwarding *.tarmac.local to the internal DNS
// node and everything else to public resolvers (same 1.1.1.1/9.9.9.9
// fallback already used by fixResolvConfAfterDisablingSystemdResolved) -
// the port-53 fallback for nodes where systemd-resolved's split-DNS routing
// isn't usable. Deliberately never touches a node that already runs this
// agent's own PowerDNS on port 53 for a DnsServerGroup (dnsMarkerPath) -
// that port is already legitimately ours there, and dnsmasq would only
// fight with it. Instead, on such a node, *.tarmac.local is made to resolve
// via a static /etc/hosts block (writeInternalDnsHostsBlock) - NSS resolves
// from /etc/hosts before ever making a DNS query, so this needs no port,
// can't conflict with the node's own public PowerDNS, and carries none of
// the open-resolver risk that adding a catch-all recursive forward-zone to
// that already-internet-exposed PowerDNS instance would (see the plan doc
// for why that approach was rejected). When something else holds the port,
// this reports the conflict (status "conflict") without touching it -
// killing anything is only ever done via the explicit
// resolveInternalDnsForwarderConflict flow, the same "propose, don't
// auto-kill" rule already followed for DnsServerGroup's own port-53 use.
func ensureInternalDnsForwarder(ctx context.Context, ip string, port int, records []internalDnsHostRecord) (string, *dnsPortConflict, error) {
	if _, err := os.Stat(dnsMarkerPath); err == nil {
		if err := writeInternalDnsHostsBlock(records); err != nil {
			return "", nil, fmt.Errorf("cannot write /etc/hosts fallback: %w", err)
		}
		return "active", nil, nil
	}

	if _, err := os.Stat(internalDnsForwarderMarkerPath); err != nil {
		if conflict := probeDnsPortConflict(); conflict != nil {
			return "conflict", conflict, nil
		}
		if _, err := ensureAgentSystemPackages(ctx, []string{"dnsmasq"}); err != nil {
			return "", nil, fmt.Errorf("cannot install dnsmasq: %w", err)
		}
	}

	if err := writeInternalDnsmasqConfig(ip, port); err != nil {
		return "", nil, err
	}

	if commandExists("systemctl") {
		if out, err := exec.CommandContext(ctx, "systemctl", "enable", "--now", "dnsmasq").CombinedOutput(); err != nil {
			return "", nil, fmt.Errorf("cannot enable/start dnsmasq: %s", strings.TrimSpace(string(out)))
		}
		if out, err := exec.CommandContext(ctx, "systemctl", "restart", "dnsmasq").CombinedOutput(); err != nil {
			return "", nil, fmt.Errorf("cannot restart dnsmasq: %s", strings.TrimSpace(string(out)))
		}
	}

	if err := pointResolvConfAtLocalhost(); err != nil {
		log.Printf("dns: dnsmasq is running but could not repoint resolv.conf (continuing): %v", err)
	}

	if err := os.MkdirAll(filepath.Dir(internalDnsForwarderMarkerPath), 0o755); err == nil {
		_ = os.WriteFile(internalDnsForwarderMarkerPath, []byte("enabled\n"), 0o600)
	}
	// A stale /etc/hosts block can only exist here if this node ran its own
	// PowerDNS (dnsMarkerPath) very recently and just left that group - see
	// applyDnsServerGroup's own port-53 handoff. Clean it up now that
	// dnsmasq is taking over, so the old static entries don't shadow live
	// DNS answers going forward. Best-effort, same as above.
	if err := removeInternalDnsHostsBlock(); err != nil {
		log.Printf("dns: could not remove stale internal DNS /etc/hosts block (continuing): %v", err)
	}
	return "active", nil, nil
}

func writeInternalDnsmasqConfig(ip string, port int) error {
	if err := os.MkdirAll(filepath.Dir(internalDnsDnsmasqConfigPath), 0o755); err != nil {
		return fmt.Errorf("cannot create dnsmasq config dir: %w", err)
	}
	lines := []string{
		"port=53",
		"bind-interfaces",
		"listen-address=127.0.0.1",
		fmt.Sprintf("server=/tarmac.local/%s#%d", ip, port),
		"server=1.1.1.1",
		"server=9.9.9.9",
		"no-resolv",
	}
	content := strings.Join(lines, "\n") + "\n"
	if err := os.WriteFile(internalDnsDnsmasqConfigPath, []byte(content), 0o644); err != nil {
		return fmt.Errorf("cannot write dnsmasq config: %w", err)
	}
	return nil
}

type internalDnsHostRecord struct {
	Name    string `json:"name"`
	Content string `json:"content"`
}

// writeInternalDnsHostsBlock maintains a clearly-marked block of
// *.tarmac.local entries in /etc/hosts, for nodes where a port-53 forwarder
// can't be used. NSS resolves /etc/hosts before ever making a DNS query
// (nsswitch.conf's default "files dns" order), so this needs no listening
// process and can't conflict with anything already bound to port 53. Only
// rewrites the file when the block's content actually changed, same
// diff-before-write discipline as refreshPdnsConfigOnStartup - this runs on
// every ~30s reconciliation tick (pushRouteToFleet), so avoiding needless
// writes matters. Idempotent: re-running with the same records is a no-op,
// and any existing block is replaced in place rather than duplicated.
func writeInternalDnsHostsBlock(records []internalDnsHostRecord) error {
	var entries []string
	for _, record := range records {
		if record.Name == "" || record.Content == "" {
			continue
		}
		// Defense in depth: records arrive over the network from the
		// control plane. The API already slugifies hostnames to [a-z0-9-]
		// before they ever reach here, but /etc/hosts has no escaping
		// mechanism at all - a stray space or newline in either field would
		// corrupt the file's structure or inject an unrelated-looking
		// entry, so validate independently rather than trust the sender.
		if !hostsSafeLabelRe.MatchString(record.Name) {
			log.Printf("dns: skipping internal DNS hosts entry with unexpected name %q", record.Name)
			continue
		}
		if net.ParseIP(record.Content) == nil {
			log.Printf("dns: skipping internal DNS hosts entry %q with unparseable address %q", record.Name, record.Content)
			continue
		}
		// dnsRecordFqdn appends a trailing dot, the DNS zone-file
		// convention for "fully qualified" (it's also used to build the
		// real PowerDNS zone data, where that dot matters). /etc/hosts has
		// no such convention - NSS matches hostnames there by exact string,
		// so a stored "foo.tarmac.local." never matches a lookup for
		// "foo.tarmac.local" (confirmed in production: every entry
		// resolved via this block failed with "Name or service not known"
		// until this trim was added). Strip it back off here.
		fqdn := strings.TrimSuffix(dnsRecordFqdn(strings.TrimSuffix(internalDnsZoneName, "."), record.Name), ".")
		entries = append(entries, fmt.Sprintf("%s %s", record.Content, fqdn))
	}
	if len(entries) == 0 {
		return removeInternalDnsHostsBlock()
	}
	lines := append([]string{internalDnsHostsBeginMarker}, entries...)
	lines = append(lines, internalDnsHostsEndMarker)
	return replaceInternalDnsHostsBlock(lines)
}

// removeInternalDnsHostsBlock strips the managed block if present -
// idempotent no-op otherwise, called when internal DNS is cleared for the
// workspace or the split-DNS route is torn down.
func removeInternalDnsHostsBlock() error {
	return replaceInternalDnsHostsBlock(nil)
}

// replaceInternalDnsHostsBlock does the actual read-modify-write: strips any
// existing marked block from /etc/hosts, then splices in newBlock (nil means
// "just remove, don't add anything back") at the end. Lines outside the
// markers are left untouched.
func replaceInternalDnsHostsBlock(newBlock []string) error {
	existing, err := os.ReadFile(hostsPath)
	if err != nil {
		return fmt.Errorf("cannot read %s: %w", hostsPath, err)
	}

	var kept []string
	inBlock := false
	for _, line := range strings.Split(string(existing), "\n") {
		switch {
		case strings.TrimSpace(line) == internalDnsHostsBeginMarker:
			inBlock = true
		case strings.TrimSpace(line) == internalDnsHostsEndMarker:
			inBlock = false
		case !inBlock:
			kept = append(kept, line)
		}
	}
	// Splitting on "\n" leaves a trailing "" for files that end in a
	// newline (the normal case) - drop it here and re-add exactly one
	// newline at the end below, so re-running this doesn't accumulate
	// blank lines.
	for len(kept) > 0 && kept[len(kept)-1] == "" {
		kept = kept[:len(kept)-1]
	}

	final := kept
	if len(newBlock) > 0 {
		final = append(final, newBlock...)
	}
	content := strings.Join(final, "\n") + "\n"
	if content == string(existing) {
		return nil
	}
	return atomicWriteFile(hostsPath, []byte(content), 0o644)
}

// atomicWriteFile writes via a temp file in the same directory (so the
// final rename stays on one filesystem, which is what makes it atomic) then
// renames it into place, instead of truncating the target in place like
// os.WriteFile. /etc/hosts is read by every process doing name resolution
// on the node - a crash or kill signal mid-write with a plain truncate+write
// could leave it half-written, breaking all resolution including localhost,
// which is a far worse failure than anything this file is trying to fix.
func atomicWriteFile(path string, content []byte, perm os.FileMode) error {
	dir := filepath.Dir(path)
	tmp, err := os.CreateTemp(dir, ".tarmac-hosts-*")
	if err != nil {
		return fmt.Errorf("cannot create temp file in %s: %w", dir, err)
	}
	tmpPath := tmp.Name()
	defer os.Remove(tmpPath) // no-op once the rename below succeeds

	if _, err := tmp.Write(content); err != nil {
		tmp.Close()
		return fmt.Errorf("cannot write temp file: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("cannot close temp file: %w", err)
	}
	if err := os.Chmod(tmpPath, perm); err != nil {
		return fmt.Errorf("cannot set permissions on temp file: %w", err)
	}
	if err := os.Rename(tmpPath, path); err != nil {
		return fmt.Errorf("cannot rename temp file into place: %w", err)
	}
	return nil
}

// pointResolvConfAtLocalhost hands this node's own DNS resolution to the
// dnsmasq forwarder just configured - same reasoning as
// fixResolvConfAfterDisablingSystemdResolved (a static file, not a
// symlink, since whatever previously regenerated it may no longer be
// running), just triggered by installing our own forwarder rather than by
// disabling a competitor.
func pointResolvConfAtLocalhost() error {
	if info, err := os.Lstat(resolvConfPath); err == nil && info.Mode()&os.ModeSymlink != 0 {
		if err := os.Remove(resolvConfPath); err != nil {
			return fmt.Errorf("cannot remove existing resolv.conf symlink: %w", err)
		}
	}
	content := "# Written by tarmac-agent - local dnsmasq forwarder handles *.tarmac.local\n" +
		"# and forwards everything else to public resolvers.\n" +
		"nameserver 127.0.0.1\n"
	if err := os.WriteFile(resolvConfPath, []byte(content), 0o644); err != nil {
		return fmt.Errorf("cannot write resolv.conf: %w", err)
	}
	return nil
}

// removeInternalDnsForwarder is idempotent and tolerant like the rest of
// this file's cleanup paths - a no-op if the forwarder was never installed.
func removeInternalDnsForwarder(ctx context.Context) error {
	if _, err := os.Stat(internalDnsForwarderMarkerPath); err != nil {
		return nil
	}
	if commandExists("systemctl") {
		if out, err := exec.CommandContext(ctx, "systemctl", "stop", "dnsmasq").CombinedOutput(); err != nil {
			log.Printf("dns: systemctl stop dnsmasq failed (continuing): %s", strings.TrimSpace(string(out)))
		}
		if out, err := exec.CommandContext(ctx, "systemctl", "disable", "dnsmasq").CombinedOutput(); err != nil {
			log.Printf("dns: systemctl disable dnsmasq failed (continuing): %s", strings.TrimSpace(string(out)))
		}
	}
	_ = os.Remove(internalDnsDnsmasqConfigPath)
	_ = os.Remove(internalDnsForwarderMarkerPath)
	return nil
}

// resolveInternalDnsForwarderConflict is the explicit, user-triggered
// counterpart to the "conflict" status ensureInternalDnsForwarder can
// report - kills and permanently disables the known culprit (same
// permanentlyDisableService/knownPort53Services already used for
// DnsServerGroup's own port-53 conflicts), then retries directly rather
// than waiting for another control-plane round-trip, since this whole flow
// is self-contained on the agent.
func resolveInternalDnsForwarderConflict(ctx context.Context, ip string, port int) (string, error) {
	conflict := probeDnsPortConflict()
	if conflict != nil {
		for _, unit := range knownPort53Services(conflict.ProcessName) {
			if err := permanentlyDisableService(ctx, unit); err != nil {
				return "", fmt.Errorf("could not disable %s: %w", unit, err)
			}
			if unit == "systemd-resolved" {
				if err := fixResolvConfAfterDisablingSystemdResolved(); err != nil {
					log.Printf("dns: could not fix resolv.conf after disabling systemd-resolved (continuing): %v", err)
				}
			}
		}
	}
	// records is nil here - this path only ever runs after a genuine port
	// conflict was reported, which never happens on a dnsMarkerPath node
	// (that branch returns "active" via the /etc/hosts fallback, never
	// "conflict"), so the records-consuming branch below can't be reached.
	status, newConflict, err := ensureInternalDnsForwarder(ctx, ip, port, nil)
	if err != nil {
		return "", err
	}
	if newConflict != nil {
		return "", fmt.Errorf("port 53 still occupied by %s after attempting to free it", newConflict.ProcessName)
	}
	return status, nil
}

func handleEnsureInternalDnsRouteCommand(ctx context.Context, cmd commandPayload, result *commandResult) {
	dnsPort53Mu.Lock()
	defer dnsPort53Mu.Unlock()
	result.Command = "ensure_internal_dns_route"
	result.ResourceType = "internal_dns_route"
	result.ResourceID = envOrDefault("NODE_ID", "agent")
	ip := readString(cmd.Payload, "ip")
	port := readInt(cmd.Payload, "port", 5300)
	rawRecords, _ := cmd.Payload["records"].([]interface{})
	records := make([]internalDnsHostRecord, 0, len(rawRecords))
	for _, raw := range rawRecords {
		entry, ok := raw.(map[string]interface{})
		if !ok {
			continue
		}
		name := readString(entry, "name")
		content := readString(entry, "content")
		if name == "" || content == "" {
			continue
		}
		records = append(records, internalDnsHostRecord{Name: name, Content: content})
	}
	data := ensureInternalDnsSplitRoute(ctx, ip, port, records)
	// This 30 s tick also reaches the node serving the zone: the firewall
	// rule isn't persistent, so it is restored here after a reboot or an
	// iptables reload instead of waiting for the next record change.
	if _, err := os.Stat(internalDnsMarkerPath); err == nil {
		if err := setInternalDnsFirewall(true, internalPdnsConfiguredPort("local-port")); err != nil {
			log.Printf("dns: %v", err)
		}
	}
	result.Data = data
	if data.Status == "conflict" {
		result.Success = false
	}
	if ip == "" {
		result.Message = "tarmac.local split-DNS route cleared"
	} else {
		result.Message = fmt.Sprintf("tarmac.local split-DNS route: %s", data.Status)
	}
}

func handleResolveInternalDnsForwarderConflictCommand(ctx context.Context, cmd commandPayload, result *commandResult) {
	dnsPort53Mu.Lock()
	defer dnsPort53Mu.Unlock()
	result.Command = "resolve_internal_dns_forwarder_conflict"
	result.ResourceType = "internal_dns_route"
	result.ResourceID = envOrDefault("NODE_ID", "agent")
	ip := readString(cmd.Payload, "ip")
	port := readInt(cmd.Payload, "port", 5300)
	status, err := resolveInternalDnsForwarderConflict(ctx, ip, port)
	if err != nil {
		result.Success = false
		result.Message = err.Error()
		result.Data = internalDnsRouteResultData{Status: "conflict"}
		return
	}
	result.Data = internalDnsRouteResultData{Status: status}
	result.Message = fmt.Sprintf("internal DNS forwarder: %s", status)
}

func handleDnsGetZoneKeysCommand(cmd commandPayload, result *commandResult) {
	result.Command = "dns_get_zone_keys"
	result.ResourceType = "dns_zone_keys"
	result.ResourceID = readString(cmd.Payload, "requestId")
	data, err := fetchDnsZoneKeys(cmd.Payload)
	if err != nil {
		result.Success = false
		result.Message = err.Error()
	} else {
		result.Data = data
		result.Message = fmt.Sprintf("%d DS record(s)", len(data.Dns.DsRecords))
	}
}

func handleDnsResolvePortConflictCommand(ctx context.Context, cmd commandPayload, result *commandResult) {
	dnsPort53Mu.Lock()
	defer dnsPort53Mu.Unlock()
	result.Command = "dns_resolve_port_conflict"
	result.ResourceType = "dns_port_conflict"
	result.ResourceID = fmt.Sprintf("%s:%s", readString(cmd.Payload, "groupId"), readString(cmd.Payload, "nodeId"))
	message, err := resolveDnsPortConflict(ctx)
	if err != nil {
		result.Success = false
		result.Message = err.Error()
	} else {
		result.Message = message
	}
}

// runDnsStartupRecheck re-verifies PowerDNS prerequisites, the
// gsqlite3->lmdb backend migration, and pdns.conf itself on every agent
// restart (including the one an agent update triggers) when this node was
// previously configured as a DNS server (see applyDnsServerGroup) - so none
// of it can silently go missing after an update without waiting for the
// control plane to re-send apply_dns_server_group.
func runDnsStartupRecheck() {
	if _, err := os.Stat(dnsMarkerPath); err != nil {
		return
	}

	installCtx, installCancel := context.WithTimeout(context.Background(), 3*time.Minute)
	if _, err := ensureAgentSystemPackages(installCtx, []string{"pdns-server", "pdns-backend-sqlite3"}); err != nil {
		log.Printf("dns: failed to re-verify PowerDNS prerequisites on startup: %v", err)
	}
	installCancel()

	// Runs on every restart (including the one an agent update triggers),
	// so a still-on-gsqlite3 node gets migrated to lmdb for better query
	// response time automatically, with no separate command needed - see
	// migratePdnsBackendToLmdb for the safety net.
	migrateCtx, migrateCancel := context.WithTimeout(context.Background(), 5*time.Minute)
	migratePdnsBackendToLmdb(migrateCtx)
	migrateCancel()

	// Same reasoning: a pdns.conf-affecting agent update (new static
	// setting, e.g. a backend-specific dnssec flag) must take effect on its
	// own, not stay stuck until the control plane happens to re-send
	// apply_dns_server_group.
	refreshCtx, refreshCancel := context.WithTimeout(context.Background(), 30*time.Second)
	refreshPdnsConfigOnStartup(refreshCtx)
	refreshCancel()

	// Builds/refreshes the self-hosted GeoIP mmdb isGeo records need (see
	// dns_geoip.go) - synchronous here so a node that's never had one gets
	// it before the first zone apply, then a background ticker keeps it
	// current for the rest of the process's life.
	geoipCtx, geoipCancel := context.WithTimeout(context.Background(), 5*time.Minute)
	ensureGeoipMmdbFresh(geoipCtx)
	geoipCancel()
	startGeoipMmdbRefreshTicker(context.Background())
}
