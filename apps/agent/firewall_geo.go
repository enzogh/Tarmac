package main

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"log"
	"math/bits"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

// Country rules of the firewall (sourceKind "countries"): each country is
// an ipset (hash:net) per address family, filled from the same public
// registry files as the DNS GeoIP database (dnsGeoipRirUrls), and matched
// with `-m set --match-set tarmac-geo4-CN src`. The ranges are cached on
// disk and refreshed weekly, so an apply never waits on the registries
// once the cache exists.

const (
	fwGeoMaxAge   = 7 * 24 * time.Hour
	fwGeoSetLimit = "1048576"
)

var (
	fwCountryPattern = regexp.MustCompile(`^[A-Z]{2}$`)
	fwGeoMu          sync.Mutex
)

func fwGeoCachePath() string {
	return envOrDefault("AGENT_FIREWALL_GEO_PATH", "/var/lib/tarmac-agent/firewall-countries.txt")
}

func fwGeoSetName(country string, v6 bool) string {
	if v6 {
		return "tarmac-geo6-" + country
	}
	return "tarmac-geo4-" + country
}

// fwRangeToCIDRs splits an IPv4 range into the smallest list of CIDRs
// covering exactly start..end (registry ranges are counts, not prefixes).
func fwRangeToCIDRs(start, end net.IP) []string {
	from, to := start.To4(), end.To4()
	if from == nil || to == nil {
		return nil
	}
	low := uint64(from[0])<<24 | uint64(from[1])<<16 | uint64(from[2])<<8 | uint64(from[3])
	high := uint64(to[0])<<24 | uint64(to[1])<<16 | uint64(to[2])<<8 | uint64(to[3])
	var out []string
	for low <= high {
		// Largest block aligned on low that does not pass high.
		size := 32
		if low != 0 {
			size = bits.TrailingZeros64(low)
			if size > 32 {
				size = 32
			}
		}
		for size > 0 && low+(uint64(1)<<size)-1 > high {
			size--
		}
		out = append(out, fmt.Sprintf("%d.%d.%d.%d/%d", byte(low>>24), byte(low>>16), byte(low>>8), byte(low), 32-size))
		low += uint64(1) << size
	}
	return out
}

type fwGeoData map[string][2][]string // country -> [IPv4 CIDRs, IPv6 CIDRs]

func fwParseGeoLines(scanner *bufio.Scanner, into fwGeoData) int {
	added := 0
	for scanner.Scan() {
		start, end, country, ok := parseRirLine(scanner.Text())
		if !ok {
			continue
		}
		entry := into[country]
		if v4 := start.To4(); v4 != nil {
			entry[0] = append(entry[0], fwRangeToCIDRs(start, end)...)
		} else {
			ones := 128 - commonTrailingOnes(start, end)
			entry[1] = append(entry[1], fmt.Sprintf("%s/%d", start.String(), ones))
		}
		into[country] = entry
		added++
	}
	return added
}

// commonTrailingOnes counts the host bits of an IPv6 prefix given its first
// and last address (registry IPv6 rows are already prefixes).
func commonTrailingOnes(start, end net.IP) int {
	count := 0
	for i := len(start) - 1; i >= 0; i-- {
		diff := start[i] ^ end[i]
		if diff == 0xff {
			count += 8
			continue
		}
		count += bits.TrailingZeros8(^diff)
		break
	}
	return count
}

func fwFetchGeoData(ctx context.Context) (fwGeoData, error) {
	data := fwGeoData{}
	client := &http.Client{Timeout: 2 * time.Minute}
	fetched := 0
	var lastErr error
	for _, url := range dnsGeoipRirUrls {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
		if err != nil {
			lastErr = err
			continue
		}
		resp, err := client.Do(req)
		if err != nil {
			lastErr = err
			continue
		}
		if resp.StatusCode != http.StatusOK {
			resp.Body.Close()
			lastErr = fmt.Errorf("%s: status %d", url, resp.StatusCode)
			continue
		}
		scanner := bufio.NewScanner(resp.Body)
		scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
		fwParseGeoLines(scanner, data)
		err = scanner.Err()
		resp.Body.Close()
		if err != nil {
			lastErr = err
			continue
		}
		fetched++
	}
	// A partial set would silently let a whole region through: all five
	// registries or nothing.
	if fetched < len(dnsGeoipRirUrls) {
		if lastErr == nil {
			lastErr = errors.New("registry data incomplete")
		}
		return nil, lastErr
	}
	return data, nil
}

func fwWriteGeoCache(data fwGeoData) error {
	path := fwGeoCachePath()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	countries := make([]string, 0, len(data))
	for country := range data {
		countries = append(countries, country)
	}
	sort.Strings(countries)
	var b strings.Builder
	for _, country := range countries {
		for family, cidrs := range data[country] {
			for _, cidr := range cidrs {
				fmt.Fprintf(&b, "%s %d %s\n", country, 4+2*family, cidr)
			}
		}
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, []byte(b.String()), 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

func fwReadGeoCache() (fwGeoData, time.Time, error) {
	path := fwGeoCachePath()
	info, err := os.Stat(path)
	if err != nil {
		return nil, time.Time{}, err
	}
	fh, err := os.Open(path)
	if err != nil {
		return nil, time.Time{}, err
	}
	defer fh.Close()
	data := fwGeoData{}
	scanner := bufio.NewScanner(fh)
	for scanner.Scan() {
		fields := strings.Fields(scanner.Text())
		if len(fields) != 3 || !fwCountryPattern.MatchString(fields[0]) {
			continue
		}
		entry := data[fields[0]]
		if fields[1] == "6" {
			entry[1] = append(entry[1], fields[2])
		} else {
			entry[0] = append(entry[0], fields[2])
		}
		data[fields[0]] = entry
	}
	return data, info.ModTime(), scanner.Err()
}

// fwGeoLoad returns the country ranges, refreshing the cache when it is
// older than a week. A stale cache is still used when the registries are
// unreachable: old ranges beat no filtering at all.
func fwGeoLoad(ctx context.Context) (fwGeoData, error) {
	cached, at, cacheErr := fwReadGeoCache()
	if cacheErr == nil && time.Since(at) < fwGeoMaxAge && len(cached) > 0 {
		return cached, nil
	}
	fresh, err := fwFetchGeoData(ctx)
	if err == nil {
		if writeErr := fwWriteGeoCache(fresh); writeErr != nil {
			log.Printf("firewall: countries: cache not written: %v", writeErr)
		}
		return fresh, nil
	}
	if cacheErr == nil && len(cached) > 0 {
		log.Printf("firewall: countries: refresh failed, keeping ranges from %s: %v", at.Format(time.RFC3339), err)
		return cached, nil
	}
	return nil, fmt.Errorf("plages d’adresses par pays indisponibles (registres Internet injoignables) : %w", err)
}

// fwEnsureGeoSets fills one ipset per country and family, swapping in the
// new content atomically so a rule never sees a half-filled set.
func fwEnsureGeoSets(ctx context.Context, countries []string) error {
	if len(countries) == 0 {
		return nil
	}
	fwGeoMu.Lock()
	defer fwGeoMu.Unlock()
	if _, err := ensureAgentSystemPackages(ctx, []string{"ipset"}); err != nil || !commandExists("ipset") {
		return errors.New("le paquet ipset est requis pour les règles par pays et n’a pas pu être installé")
	}
	data, err := fwGeoLoad(ctx)
	if err != nil {
		return err
	}
	var script strings.Builder
	for _, country := range countries {
		for family, v6 := range []bool{false, true} {
			name := fwGeoSetName(country, v6)
			tmp := name + "-n"
			inet := "inet"
			if v6 {
				inet = "inet6"
			}
			fmt.Fprintf(&script, "create %s hash:net family %s maxelem %s -exist\n", tmp, inet, fwGeoSetLimit)
			fmt.Fprintf(&script, "flush %s\n", tmp)
			for _, cidr := range data[country][family] {
				fmt.Fprintf(&script, "add %s %s -exist\n", tmp, cidr)
			}
			fmt.Fprintf(&script, "create %s hash:net family %s maxelem %s -exist\n", name, inet, fwGeoSetLimit)
			fmt.Fprintf(&script, "swap %s %s\n", tmp, name)
			fmt.Fprintf(&script, "destroy %s\n", tmp)
		}
	}
	cmd := exec.CommandContext(ctx, "ipset", "restore")
	cmd.Stdin = strings.NewReader(script.String())
	if out, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("ipset restore: %s", strings.TrimSpace(string(out)))
	}
	return nil
}

// fwCleanupGeoSets drops country sets no rule uses any more. Called after
// the chains are installed: a set still referenced can't be destroyed.
func fwCleanupGeoSets(keep []string) {
	if !commandExists("ipset") {
		return
	}
	out, err := exec.Command("ipset", "list", "-n").Output()
	if err != nil {
		return
	}
	wanted := map[string]bool{}
	for _, country := range keep {
		wanted[fwGeoSetName(country, false)] = true
		wanted[fwGeoSetName(country, true)] = true
	}
	for _, name := range strings.Fields(string(out)) {
		if strings.HasPrefix(name, "tarmac-geo") && !wanted[name] {
			_ = exec.Command("ipset", "destroy", name).Run()
		}
	}
}

// fwDesiredCountries lists every country a rule of this payload names.
func fwDesiredCountries(desired fwDesired) []string {
	seen := map[string]bool{}
	var out []string
	for _, zone := range []fwZone{desired.mesh, desired.public, desired.outbound} {
		for _, list := range [][]fwRule{zone.denies, zone.allows} {
			for _, rule := range list {
				for _, country := range rule.countries {
					if !seen[country] {
						seen[country] = true
						out = append(out, country)
					}
				}
			}
		}
	}
	sort.Strings(out)
	return out
}

// startFirewallGeoRefresh refills the country sets once a day, so ranges
// follow the registries (weekly cache) even when no rule changes.
func startFirewallGeoRefresh() {
	go func() {
		ticker := time.NewTicker(24 * time.Hour)
		defer ticker.Stop()
		for range ticker.C {
			fwStateMu.Lock()
			countries := append([]string{}, fwState.countries...)
			fwStateMu.Unlock()
			if len(countries) == 0 {
				continue
			}
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
			if err := fwEnsureGeoSets(ctx, countries); err != nil {
				log.Printf("firewall: countries: daily refresh failed: %v", err)
			}
			cancel()
		}
	}()
}
