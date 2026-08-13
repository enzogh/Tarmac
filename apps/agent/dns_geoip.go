package main

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/maxmind/mmdbwriter"
	"github.com/maxmind/mmdbwriter/mmdbtype"
)

// Self-hosted replacement for the old MaxMind GeoLite2 dependency (see the
// removed ensureGeoipDatabase): builds the MMDB that PowerDNS's Lua
// pickclosest() reads directly from the 5 regional Internet registries'
// free, public "delegated-extended" stats files - no account, no license
// key, no third-party geolocation vendor. Country-level precision only
// (RIR delegations are per-country, not per-city), joined against the
// countryCentroids table in dns_geoip_centroids.go to get a lat/lon per
// range. Confirmed empirically against a real pdns_server 4.5.3: writing
// the MMDB to the same path/filename MaxMind's GeoLite2-City.mmdb used,
// with DatabaseType "GeoIP2-City" and country.iso_code/location.latitude/
// location.longitude fields, is exactly what pickclosest() reads - no
// pdns.conf changes needed.
const (
	geoipMmdbPath      = geoipDatabaseDir + "/GeoLite2-City.mmdb"
	geoipMmdbBuiltPath = "/etc/tarmac-agent/geoip-mmdb-built-at"
	geoipMmdbInterval  = 7 * 24 * time.Hour
)

var dnsGeoipRirUrls = []string{
	"https://ftp.apnic.net/apnic/stats/apnic/delegated-apnic-extended-latest",
	"https://ftp.arin.net/pub/stats/arin/delegated-arin-extended-latest",
	"https://ftp.ripe.net/pub/stats/ripencc/delegated-ripencc-extended-latest",
	"https://ftp.lacnic.net/pub/stats/lacnic/delegated-lacnic-extended-latest",
	"https://ftp.afrinic.net/pub/stats/afrinic/delegated-afrinic-extended-latest",
}

// ensureGeoipMmdbFresh rebuilds the GeoIP MMDB if it's missing or older
// than geoipMmdbInterval. Called once at agent startup (see
// runDnsStartupRecheck) and from a weekly background ticker - the marker
// file means a restart soon after a successful build doesn't redundantly
// re-hit all 5 RIR mirrors.
func ensureGeoipMmdbFresh(ctx context.Context) {
	if builtAt, err := os.ReadFile(geoipMmdbBuiltPath); err == nil {
		if ts, err := strconv.ParseInt(strings.TrimSpace(string(builtAt)), 10, 64); err == nil {
			if time.Since(time.Unix(ts, 0)) < geoipMmdbInterval {
				return
			}
		}
	}

	if err := buildGeoipMmdb(ctx); err != nil {
		// Never fatal to the caller - an isGeo record just keeps resolving
		// with whatever MMDB (possibly none) is already on disk until the
		// next retry. Logged distinctly from a stale-but-present MMDB (see
		// applyDnsZone) since this is the "couldn't refresh at all" case.
		log.Printf("dns: geoip mmdb refresh failed, geo records may resolve stale/incorrect until next retry: %v", err)
		return
	}

	if err := os.MkdirAll("/etc/tarmac-agent", 0o755); err == nil {
		_ = os.WriteFile(geoipMmdbBuiltPath, []byte(strconv.FormatInt(time.Now().Unix(), 10)), 0o644)
	}
	log.Printf("dns: geoip mmdb refreshed at %s", geoipMmdbPath)
}

// startGeoipMmdbRefreshTicker runs ensureGeoipMmdbFresh on a weekly cadence
// for the lifetime of the agent process. Started unconditionally from
// runDnsStartupRecheck's dnsMarkerPath-gated block - ensureGeoipMmdbFresh
// itself is a fast no-op when the marker file is still fresh, so starting
// the ticker is cheap even on nodes that aren't DNS servers... except this
// is only ever called from within that gate, so it's DNS nodes only.
func startGeoipMmdbRefreshTicker(ctx context.Context) {
	go func() {
		ticker := time.NewTicker(geoipMmdbInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				ensureGeoipMmdbFresh(ctx)
			}
		}
	}()
}

func buildGeoipMmdb(ctx context.Context) error {
	tree, err := mmdbwriter.New(mmdbwriter.Options{
		DatabaseType: "GeoIP2-City",
		RecordSize:   28,
	})
	if err != nil {
		return fmt.Errorf("cannot initialize mmdb tree: %w", err)
	}

	var inserted int
	var lastErr error
	failedSources := 0
	for _, url := range dnsGeoipRirUrls {
		n, err := fetchAndInsertRirFile(ctx, url, tree)
		if err != nil {
			// One mirror being unreachable shouldn't block the other 4 -
			// partial GeoIP coverage (e.g. missing AFRINIC's ranges) still
			// resolves the vast majority of real client IPs correctly.
			log.Printf("dns: geoip: fetching %s failed, continuing with the other registries: %v", url, err)
			lastErr = err
			failedSources++
			continue
		}
		inserted += n
	}
	if inserted == 0 {
		if lastErr != nil {
			return fmt.Errorf("no registry data could be fetched, last error: %w", lastErr)
		}
		return errors.New("no registry data could be fetched")
	}

	if err := os.MkdirAll(geoipDatabaseDir, 0o755); err != nil {
		return fmt.Errorf("cannot create geoip database dir: %w", err)
	}
	tmpPath := geoipMmdbPath + ".tmp"
	fh, err := os.Create(tmpPath)
	if err != nil {
		return fmt.Errorf("cannot create mmdb file: %w", err)
	}
	if _, err := tree.WriteTo(fh); err != nil {
		fh.Close()
		os.Remove(tmpPath)
		return fmt.Errorf("cannot write mmdb file: %w", err)
	}
	if err := fh.Close(); err != nil {
		os.Remove(tmpPath)
		return fmt.Errorf("cannot close mmdb file: %w", err)
	}
	// Atomic swap - pdns_server keeps its existing mmap'd copy of the old
	// file open and working throughout, and never sees a half-written file.
	if err := os.Rename(tmpPath, geoipMmdbPath); err != nil {
		return fmt.Errorf("cannot install mmdb file: %w", err)
	}
	log.Printf(
		"dns: geoip: inserted %d range(s) from %d/%d registries",
		inserted, len(dnsGeoipRirUrls)-failedSources, len(dnsGeoipRirUrls),
	)
	return nil
}

func fetchAndInsertRirFile(ctx context.Context, url string, tree *mmdbwriter.Tree) (int, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return 0, err
	}
	client := &http.Client{Timeout: 2 * time.Minute}
	resp, err := client.Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return 0, fmt.Errorf("unexpected status %d", resp.StatusCode)
	}

	inserted := 0
	scanner := bufio.NewScanner(resp.Body)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	for scanner.Scan() {
		start, end, cc, ok := parseRirLine(scanner.Text())
		if !ok {
			continue
		}
		centroid, ok := countryCentroids[cc]
		if !ok {
			continue
		}
		value := mmdbtype.Map{
			"country": mmdbtype.Map{"iso_code": mmdbtype.String(cc)},
			"location": mmdbtype.Map{
				"latitude":  mmdbtype.Float64(centroid[0]),
				"longitude": mmdbtype.Float64(centroid[1]),
			},
		}
		if err := tree.InsertRange(start, end, value); err != nil {
			continue
		}
		inserted++
	}
	if err := scanner.Err(); err != nil {
		return inserted, err
	}
	return inserted, nil
}

// parseRirLine parses one line of a RIR "delegated-extended" stats file.
// Format: registry|cc|type|start|value|date|status[|opaque-id] - e.g.
// "apnic|CN|ipv4|1.0.1.0|256|20110414|allocated". Comment lines ('#'),
// the version/summary header line, and per-registry "cc == '*'" summary
// rows are all skipped. Only ipv4/ipv6 rows with status allocated/assigned
// are used (asn rows aren't geolocation data at all).
//
// The two record types are NOT symmetric: for ipv4, `value` is a decimal
// address COUNT (so the end of the range is start+value-1); for ipv6,
// `value` is already a prefix LENGTH. Applying the ipv4 arithmetic to an
// ipv6 row (or vice versa) would silently produce nonsense ranges.
func parseRirLine(line string) (start, end net.IP, countryCode string, ok bool) {
	if line == "" || strings.HasPrefix(line, "#") {
		return nil, nil, "", false
	}
	fields := strings.Split(line, "|")
	if len(fields) < 7 {
		return nil, nil, "", false
	}
	cc, kind, startStr, valueStr, status := fields[1], fields[2], fields[3], fields[4], fields[6]
	if cc == "" || cc == "*" {
		return nil, nil, "", false
	}
	if status != "allocated" && status != "assigned" {
		return nil, nil, "", false
	}

	switch kind {
	case "ipv4":
		startIP := net.ParseIP(startStr)
		if startIP == nil {
			return nil, nil, "", false
		}
		count, err := strconv.ParseUint(valueStr, 10, 32)
		if err != nil || count == 0 {
			return nil, nil, "", false
		}
		endIP := addToIPv4(startIP, count-1)
		if endIP == nil {
			return nil, nil, "", false
		}
		return startIP, endIP, strings.ToUpper(cc), true
	case "ipv6":
		prefixLen, err := strconv.Atoi(valueStr)
		if err != nil || prefixLen < 0 || prefixLen > 128 {
			return nil, nil, "", false
		}
		_, network, err := net.ParseCIDR(fmt.Sprintf("%s/%d", startStr, prefixLen))
		if err != nil {
			return nil, nil, "", false
		}
		startIP := network.IP
		endIP := lastIPInNetwork(network)
		return startIP, endIP, strings.ToUpper(cc), true
	default:
		return nil, nil, "", false
	}
}

func addToIPv4(ip net.IP, delta uint64) net.IP {
	v4 := ip.To4()
	if v4 == nil {
		return nil
	}
	value := uint64(v4[0])<<24 | uint64(v4[1])<<16 | uint64(v4[2])<<8 | uint64(v4[3])
	value += delta
	if value > 0xFFFFFFFF {
		return net.IPv4(255, 255, 255, 255).To4()
	}
	return net.IPv4(byte(value>>24), byte(value>>16), byte(value>>8), byte(value)).To4()
}

func lastIPInNetwork(network *net.IPNet) net.IP {
	ip := make(net.IP, len(network.IP))
	for i := range network.IP {
		ip[i] = network.IP[i] | ^network.Mask[i]
	}
	return ip
}
