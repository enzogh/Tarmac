package main

import (
	"context"
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

// PowerDNS's own apt repository signing key (fingerprint
// 9FAAA5577E8FCF62093D036C1B0C6205FD380FBB, signs every auth-4x/5x
// repository). Shipped with the agent rather than fetched at upgrade time,
// so a node never trusts a key it downloaded over the network.
//
//go:embed powerdns-repo-key.asc
var powerdnsRepoKey []byte

const (
	pdnsMaintenanceStatePath = "/etc/tarmac-agent/pdns-maintenance.json"
	// Automatic attempts per task before the agent stops retrying on its
	// own: each attempt stops pdns for a moment, so a task that keeps
	// failing must not take DNS down on every agent restart forever. A
	// retry from the UI resets the count.
	pdnsMaintenanceMaxAttempts = 3

	pdnsTaskLmdb    = "lmdb"
	pdnsTaskUpgrade = "upgrade"

	// Outside /var/lib/powerdns on purpose: removeLmdbFiles globs that
	// directory, and a backup must survive whatever happens there.
	pdnsBackupRoot   = "/var/lib/tarmac-agent/pdns-backups"
	pdnsRepoListPath = "/etc/apt/sources.list.d/tarmac-powerdns.list"
	pdnsRepoPinPath  = "/etc/apt/preferences.d/tarmac-powerdns"
	pdnsRepoKeyPath  = "/etc/apt/keyrings/tarmac-powerdns.asc"
)

// pdnsUpgradeSteps are the PowerDNS series a node goes through, in order.
// 4.7 is not optional: 4.8+ can't convert the LMDB schema 4.5 writes (v3)
// - 5.1 and 4.9 both fail with "mdb_get pdns.shards failed" on a database
// created by Ubuntu's 4.5.3 - while 4.7 converts it to v4, which 5.1 then
// takes to v6. Each conversion is one-way, hence the backup before each.
var pdnsUpgradeSteps = []struct {
	series       string
	major, minor int
}{
	{"47", 4, 7},
	{"51", 5, 1},
}

// pdnsTask is the state of one maintenance task (backend migration,
// version upgrade), persisted so the attempt count survives restarts and
// reported to the control plane in each heartbeat.
type pdnsTask struct {
	Status    string `json:"status"` // running, done, failed
	Attempts  int    `json:"attempts"`
	Error     string `json:"error,omitempty"`
	UpdatedAt string `json:"updatedAt"`
}

var pdnsMaintenanceMu sync.Mutex

func loadPdnsMaintenance() map[string]*pdnsTask {
	tasks := map[string]*pdnsTask{}
	data, err := os.ReadFile(pdnsMaintenanceStatePath)
	if err == nil {
		_ = json.Unmarshal(data, &tasks)
	}
	return tasks
}

func savePdnsMaintenance(tasks map[string]*pdnsTask) {
	data, err := json.Marshal(tasks)
	if err != nil {
		return
	}
	if err := os.MkdirAll(filepath.Dir(pdnsMaintenanceStatePath), 0o755); err != nil {
		return
	}
	if err := os.WriteFile(pdnsMaintenanceStatePath, data, 0o644); err != nil {
		log.Printf("dns: could not save maintenance state: %v", err)
	}
}

func updatePdnsTask(name string, mutate func(task *pdnsTask)) {
	tasks := loadPdnsMaintenance()
	task := tasks[name]
	if task == nil {
		task = &pdnsTask{}
		tasks[name] = task
	}
	mutate(task)
	task.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	savePdnsMaintenance(tasks)
}

// pdnsTaskGaveUp reports whether a task already failed as many times as
// the agent retries on its own.
func pdnsTaskGaveUp(name string) bool {
	task := loadPdnsMaintenance()[name]
	return task != nil && task.Status == "failed" && task.Attempts >= pdnsMaintenanceMaxAttempts
}

// runPdnsTask runs one attempt of a task, recording it. attempted is false
// when run found nothing to do: that is neither a success nor a failure.
func runPdnsTask(name string, run func() (attempted bool, err error)) error {
	if pdnsTaskGaveUp(name) {
		return nil
	}
	updatePdnsTask(name, func(task *pdnsTask) { task.Status = "running" })
	attempted, err := run()
	updatePdnsTask(name, func(task *pdnsTask) {
		switch {
		case err != nil:
			task.Status = "failed"
			task.Attempts++
			task.Error = err.Error()
		case attempted || task.Status == "running":
			task.Status = "done"
			task.Attempts = 0
			task.Error = ""
		}
	})
	return err
}

// resetPdnsMaintenance clears the attempt counts, for a retry asked from
// the UI after the agent gave up.
func resetPdnsMaintenance() {
	tasks := loadPdnsMaintenance()
	for _, task := range tasks {
		if task.Status == "failed" {
			task.Attempts = 0
		}
	}
	savePdnsMaintenance(tasks)
}

// runPdnsMaintenance migrates the backend to lmdb, then - once asked from
// the UI (requestPdnsUpgrade) - upgrades PowerDNS, each within its attempt
// budget. The upgrade is never started on its own: it converts the
// database one way and stops DNS on the node for a moment, so it's done
// one node at a time, when the user chooses. Serialized: the startup
// recheck and a request from the UI must never run it twice at once.
func runPdnsMaintenance(ctx context.Context) {
	pdnsMaintenanceMu.Lock()
	defer pdnsMaintenanceMu.Unlock()

	if err := runPdnsTask(pdnsTaskLmdb, func() (bool, error) {
		attempted := readPdnsBackend() == "gsqlite3"
		return attempted, migratePdnsBackendToLmdb(ctx)
	}); err != nil {
		return
	}
	upgrade := loadPdnsMaintenance()[pdnsTaskUpgrade]
	if upgrade == nil || upgrade.Status == "done" {
		return
	}
	// The upgrade converts the lmdb database: it waits for the migration.
	if readPdnsBackend() != "lmdb" {
		return
	}
	// "running" here means an upgrade cut short by an agent restart: it
	// picks up where it stopped, each step being skipped once installed.
	if err := runPdnsTask(pdnsTaskUpgrade, func() (bool, error) {
		if pdnsVersionAtLeast(5, 1) {
			return false, nil
		}
		return true, upgradePdns(ctx)
	}); err != nil {
		log.Printf("dns: PowerDNS upgrade failed: %v", err)
	}
}

// requestPdnsUpgrade records that the user asked for the upgrade, so it
// also resumes after an agent restart.
func requestPdnsUpgrade() {
	updatePdnsTask(pdnsTaskUpgrade, func(task *pdnsTask) {
		if task.Status != "running" {
			task.Status = "requested"
		}
		task.Attempts = 0
		task.Error = ""
	})
}

var pdnsVersionCache struct {
	sync.Mutex
	value string
	at    time.Time
}

// pdnsInstalledVersion is the installed pdns-server package version
// ("4.5.3-1", "5.1.5-1pdns.ubuntu22.04"), "" when not installed. Cached:
// it's read on every heartbeat.
func pdnsInstalledVersion() string {
	pdnsVersionCache.Lock()
	defer pdnsVersionCache.Unlock()
	if time.Since(pdnsVersionCache.at) < 5*time.Minute {
		return pdnsVersionCache.value
	}
	out, err := exec.Command("dpkg-query", "-W", "-f=${Version}", "pdns-server").Output()
	value := ""
	if err == nil {
		value = strings.TrimSpace(string(out))
	}
	pdnsVersionCache.value = value
	pdnsVersionCache.at = time.Now()
	return value
}

func forgetPdnsInstalledVersion() {
	pdnsVersionCache.Lock()
	pdnsVersionCache.at = time.Time{}
	pdnsVersionCache.Unlock()
}

func parsePdnsVersion(version string) (major, minor int, ok bool) {
	if i := strings.Index(version, ":"); i >= 0 {
		version = version[i+1:]
	}
	parts := strings.SplitN(version, ".", 3)
	if len(parts) < 2 {
		return 0, 0, false
	}
	major, errMajor := strconv.Atoi(parts[0])
	minor, errMinor := strconv.Atoi(leadingDigits(parts[1]))
	if errMajor != nil || errMinor != nil {
		return 0, 0, false
	}
	return major, minor, true
}

func leadingDigits(s string) string {
	end := 0
	for end < len(s) && s[end] >= '0' && s[end] <= '9' {
		end++
	}
	return s[:end]
}

func pdnsVersionAtLeast(major, minor int) bool {
	gotMajor, gotMinor, ok := parsePdnsVersion(pdnsInstalledVersion())
	return ok && (gotMajor > major || (gotMajor == major && gotMinor >= minor))
}

// pdnsSupportsCatalog: catalog zones (RFC 9432) arrived in 4.7.
func pdnsSupportsCatalog() bool {
	return pdnsVersionAtLeast(4, 7)
}

type pdnsInventory struct {
	zones, tsigKeys int
}

func readPdnsInventory(ctx context.Context, apiKey string) (pdnsInventory, error) {
	zones, err := fetchPdnsZoneNames(ctx, apiKey)
	if err != nil {
		return pdnsInventory{}, err
	}
	keys, err := (&pdnsClient{apiKey: apiKey}).fetchTsigKeys(ctx)
	if err != nil {
		return pdnsInventory{}, err
	}
	return pdnsInventory{zones: len(zones), tsigKeys: len(keys)}, nil
}

// waitPdnsInventory waits for pdns to answer its API after a (re)start and
// returns what it serves.
func waitPdnsInventory(ctx context.Context, apiKey string) (pdnsInventory, error) {
	var lastErr error
	for i := 0; i < 30; i++ {
		inventory, err := readPdnsInventory(ctx, apiKey)
		if err == nil {
			return inventory, nil
		}
		lastErr = err
		select {
		case <-ctx.Done():
			return pdnsInventory{}, ctx.Err()
		case <-time.After(time.Second):
		}
	}
	return pdnsInventory{}, fmt.Errorf("pdns API not answering: %v", lastErr)
}

func osRelease() map[string]string {
	values := map[string]string{}
	data, err := os.ReadFile("/etc/os-release")
	if err != nil {
		return values
	}
	for _, line := range strings.Split(string(data), "\n") {
		key, value, found := strings.Cut(line, "=")
		if found {
			values[key] = strings.Trim(value, `"`)
		}
	}
	return values
}

// pdnsRepoLine is the apt source for a PowerDNS series on this node's
// distribution, e.g. "deb [...] https://repo.powerdns.com/ubuntu jammy-auth-51 main".
func pdnsRepoLine(series string) (string, error) {
	release := osRelease()
	distro, codename := release["ID"], release["VERSION_CODENAME"]
	if (distro != "ubuntu" && distro != "debian") || codename == "" {
		return "", fmt.Errorf("unsupported distribution %q %q: PowerDNS packages are only set up for Ubuntu and Debian", distro, codename)
	}
	return fmt.Sprintf("deb [arch=amd64,arm64 signed-by=%s] https://repo.powerdns.com/%s %s-auth-%s main", pdnsRepoKeyPath, distro, codename, series), nil
}

func writePdnsRepo(series string) error {
	line, err := pdnsRepoLine(series)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(pdnsRepoKeyPath), 0o755); err != nil {
		return err
	}
	if err := os.WriteFile(pdnsRepoKeyPath, powerdnsRepoKey, 0o644); err != nil {
		return err
	}
	if err := os.WriteFile(pdnsRepoListPath, []byte(line+"\n"), 0o644); err != nil {
		return err
	}
	// The distribution ships its own (older) pdns-*: without the pin apt
	// may keep or pick that one instead.
	pin := "Package: pdns-*\nPin: origin repo.powerdns.com\nPin-Priority: 600\n"
	return os.WriteFile(pdnsRepoPinPath, []byte(pin), 0o644)
}

func removePdnsRepo() {
	for _, path := range []string{pdnsRepoListPath, pdnsRepoPinPath} {
		if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
			log.Printf("dns: could not remove %s: %v", path, err)
		}
	}
}

func aptGet(ctx context.Context, args ...string) error {
	cmd := exec.CommandContext(ctx, "apt-get", args...)
	// Keep the pdns.conf this agent writes: without these, a package whose
	// shipped config changed stops on an interactive conffile prompt.
	cmd.Env = append(os.Environ(), "DEBIAN_FRONTEND=noninteractive")
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("apt-get %s: %s", args[0], aptFailureSummary(string(out)))
	}
	return nil
}

// aptFailureSummary keeps apt's error lines ("E: ..."): its full output
// opens on a page of "Hit:"/"Get:" progress that says nothing.
func aptFailureSummary(output string) string {
	errorsOnly := []string{}
	for _, line := range strings.Split(output, "\n") {
		if strings.HasPrefix(strings.TrimSpace(line), "E:") {
			errorsOnly = append(errorsOnly, strings.TrimSpace(line))
		}
	}
	text := strings.Join(errorsOnly, " ")
	if text == "" {
		text = strings.TrimSpace(output)
	}
	if len(text) > 600 {
		text = text[len(text)-600:]
	}
	return text
}

var aptKeepConfig = []string{"-o", "Dpkg::Options::=--force-confold", "-o", "Dpkg::Options::=--force-confdef"}

func pdnsPackages() []string {
	packages := []string{"pdns-server", "pdns-backend-lmdb"}
	if pdnsSqliteBackendInstalled() {
		packages = append(packages, "pdns-backend-sqlite3")
	}
	return packages
}

func installPdnsSeries(ctx context.Context, series string) error {
	if err := writePdnsRepo(series); err != nil {
		return err
	}
	if err := aptGet(ctx, "update", "-y"); err != nil {
		return err
	}
	args := append([]string{"install", "-y", "--no-install-recommends"}, aptKeepConfig...)
	err := aptGet(ctx, append(args, pdnsPackages()...)...)
	forgetPdnsInstalledVersion()
	return err
}

// backupPdnsData copies /var/lib/powerdns (lmdb shards, sqlite databases)
// with pdns stopped, so the copy is consistent.
func backupPdnsData(ctx context.Context, label string) (string, error) {
	dir := filepath.Join(pdnsBackupRoot, time.Now().UTC().Format("20060102-150405")+"-"+label)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", err
	}
	stopPdnsServices(ctx)
	defer startPdnsServices(ctx)
	entries, err := os.ReadDir(filepath.Dir(pdnsLmdbFilePath))
	if err != nil {
		return "", err
	}
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		src := filepath.Join(filepath.Dir(pdnsLmdbFilePath), entry.Name())
		if err := copyFile(src, filepath.Join(dir, entry.Name())); err != nil {
			return "", fmt.Errorf("backup of %s: %w", src, err)
		}
	}
	return dir, nil
}

func restorePdnsData(ctx context.Context, dir string) error {
	stopPdnsServices(ctx)
	dataDir := filepath.Dir(pdnsLmdbFilePath)
	if err := removeLmdbFiles(); err != nil {
		return err
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if err := copyFile(filepath.Join(dir, entry.Name()), filepath.Join(dataDir, entry.Name())); err != nil {
			return err
		}
	}
	if out, err := exec.CommandContext(ctx, "chown", "-R", "pdns:pdns", dataDir).CombinedOutput(); err != nil {
		return fmt.Errorf("chown %s: %s", dataDir, strings.TrimSpace(string(out)))
	}
	return nil
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	info, err := in.Stat()
	if err != nil {
		return err
	}
	out, err := os.OpenFile(dst, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, info.Mode().Perm())
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		return err
	}
	return out.Close()
}

func stopPdnsServices(ctx context.Context) {
	for _, unit := range []string{"pdns", internalPdnsSystemdUnit} {
		_ = exec.CommandContext(ctx, "systemctl", "stop", unit).Run()
	}
}

func startPdnsServices(ctx context.Context) {
	if out, err := exec.CommandContext(ctx, "systemctl", "start", "pdns").CombinedOutput(); err != nil {
		log.Printf("dns: could not start pdns: %s", strings.TrimSpace(string(out)))
	}
	if _, err := os.Stat(internalDnsMarkerPath); err == nil {
		if out, err := exec.CommandContext(ctx, "systemctl", "start", internalPdnsSystemdUnit).CombinedOutput(); err != nil {
			log.Printf("dns: could not start %s: %s", internalPdnsSystemdUnit, strings.TrimSpace(string(out)))
		}
	}
}

// pdnsSqliteSchemaUpgrade is shipped by pdns-backend-sqlite3 4.7+: the
// columns catalog zones added to the gsqlite3 schema. Without them 4.7+
// can't read the database at all ("no such column: domains.catalog").
var pdnsSqliteSchemaUpgradeCandidates = []string{
	"/usr/share/pdns-backend-sqlite3/schema/4.3.1_to_4.7.0_schema.sqlite3.sql",
	"/usr/share/doc/pdns-backend-sqlite3/4.3.1_to_4.7.0_schema.sqlite3.sql",
}

// upgradePdnsSqliteSchemas brings every gsqlite3 database on the node (the
// internal DNS instance's, and the public one's from before lmdb) to the
// 4.7 schema. The script isn't idempotent ("duplicate column name"), so a
// database already carrying the new column is left alone.
func upgradePdnsSqliteSchemas(ctx context.Context) error {
	var script string
	for _, candidate := range pdnsSqliteSchemaUpgradeCandidates {
		if _, err := os.Stat(candidate); err == nil {
			script = candidate
			break
		}
	}
	for _, db := range []string{internalPdnsSqliteDbPath, pdnsSqliteDbPath} {
		if _, err := os.Stat(db); err != nil {
			continue
		}
		out, err := exec.CommandContext(ctx, "sqlite3", db, "SELECT COUNT(*) FROM pragma_table_info('domains') WHERE name='catalog';").Output()
		if err != nil {
			return fmt.Errorf("cannot inspect %s: %v", db, err)
		}
		if strings.TrimSpace(string(out)) != "0" {
			continue
		}
		if script == "" {
			return fmt.Errorf("sqlite schema upgrade script not found for %s", db)
		}
		cmd := exec.CommandContext(ctx, "sqlite3", db)
		input, err := os.Open(script)
		if err != nil {
			return err
		}
		cmd.Stdin = input
		combined, err := cmd.CombinedOutput()
		input.Close()
		if err != nil {
			return fmt.Errorf("sqlite schema upgrade of %s: %s", db, strings.TrimSpace(string(combined)))
		}
		log.Printf("dns: upgraded %s to the PowerDNS 4.7 sqlite schema", db)
	}
	return nil
}

// upgradePdns takes this node's PowerDNS from the distribution's 4.5 to
// 5.1 through 4.7 (see pdnsUpgradeSteps), checking after each step that
// pdns serves the same zones and TSIG keys as before. Any failure puts the
// original packages and data back.
func upgradePdns(ctx context.Context) error {
	if !commandExists("apt-get") {
		return errors.New("apt-get unavailable")
	}
	if _, err := pdnsRepoLine("51"); err != nil {
		return err
	}
	if _, err := ensureAgentSystemPackages(ctx, []string{"sqlite3"}); err != nil {
		return fmt.Errorf("cannot install sqlite3: %w", err)
	}
	apiKey, err := ensurePdnsApiKey()
	if err != nil {
		return err
	}
	before, err := readPdnsInventory(ctx, apiKey)
	if err != nil {
		return fmt.Errorf("cannot read what pdns serves before upgrading: %w", err)
	}
	originalVersion := pdnsInstalledVersion()
	originalConfig, err := os.ReadFile(pdnsConfigPath)
	if err != nil {
		return err
	}
	backup, err := backupPdnsData(ctx, originalVersion)
	if err != nil {
		return fmt.Errorf("backup before upgrade failed: %w", err)
	}
	log.Printf("dns: upgrading PowerDNS %s to 5.1 (%d zone(s), %d TSIG key(s), backup in %s)", originalVersion, before.zones, before.tsigKeys, backup)

	// pdns.conf without the settings 4.9 removed: installing a package
	// restarts pdns with whatever config is in place.
	if err := writePdnsConfig(apiKey, readPdnsAllowAxfrIps(), readPdnsBackend()); err != nil {
		return err
	}

	rollback := func(cause error) error {
		log.Printf("dns: PowerDNS upgrade failed (%v) - restoring %s and its data", cause, originalVersion)
		removePdnsRepo()
		if err := aptGet(ctx, "update", "-y"); err != nil {
			log.Printf("dns: rollback: %v", err)
		}
		// The distribution's pdns-backend-* share pdns-server's version.
		packages := []string{}
		for _, pkg := range pdnsPackages() {
			packages = append(packages, pkg+"="+originalVersion)
		}
		args := append([]string{"install", "-y", "--no-install-recommends", "--allow-downgrades"}, aptKeepConfig...)
		if err := aptGet(ctx, append(args, packages...)...); err != nil {
			log.Printf("dns: rollback: %v", err)
		}
		forgetPdnsInstalledVersion()
		if err := restorePdnsData(ctx, backup); err != nil {
			log.Printf("dns: rollback: could not restore data from %s: %v", backup, err)
		}
		if err := os.WriteFile(pdnsConfigPath, originalConfig, 0o644); err != nil {
			log.Printf("dns: rollback: could not restore pdns.conf: %v", err)
		}
		startPdnsServices(ctx)
		return cause
	}

	for _, step := range pdnsUpgradeSteps {
		if pdnsVersionAtLeast(step.major, step.minor) {
			continue
		}
		if err := installPdnsSeries(ctx, step.series); err != nil {
			return rollback(err)
		}
		if !pdnsVersionAtLeast(step.major, step.minor) {
			return rollback(fmt.Errorf("pdns-server %s installed instead of %d.%d", pdnsInstalledVersion(), step.major, step.minor))
		}
		if err := upgradePdnsSqliteSchemas(ctx); err != nil {
			return rollback(err)
		}
		// Settings that depend on the version (enable-lua-record-updates).
		if err := writePdnsConfig(apiKey, readPdnsAllowAxfrIps(), readPdnsBackend()); err != nil {
			return rollback(err)
		}
		stopPdnsServices(ctx)
		startPdnsServices(ctx)
		after, err := waitPdnsInventory(ctx, apiKey)
		if err != nil {
			return rollback(fmt.Errorf("pdns %s does not answer: %w", pdnsInstalledVersion(), err))
		}
		if after != before {
			return rollback(fmt.Errorf("pdns %s serves %d zone(s) and %d TSIG key(s) instead of %d and %d",
				pdnsInstalledVersion(), after.zones, after.tsigKeys, before.zones, before.tsigKeys))
		}
		log.Printf("dns: PowerDNS %s running, %d zone(s) and %d TSIG key(s) verified", pdnsInstalledVersion(), after.zones, after.tsigKeys)
	}
	return nil
}
