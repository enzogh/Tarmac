package main

import (
	"encoding/json"
	"testing"
)

func TestParsePdnsVersion(t *testing.T) {
	cases := []struct {
		in           string
		major, minor int
		ok           bool
	}{
		{"4.5.3-1", 4, 5, true},
		{"5.1.5-1pdns.ubuntu22.04", 5, 1, true},
		{"4.7.5-1pdns.jammy", 4, 7, true},
		{"1:4.9.0-2", 4, 9, true},
		{"", 0, 0, false},
	}
	for _, c := range cases {
		major, minor, ok := parsePdnsVersion(c.in)
		if major != c.major || minor != c.minor || ok != c.ok {
			t.Errorf("parsePdnsVersion(%q) = %d.%d %v, want %d.%d %v", c.in, major, minor, ok, c.major, c.minor, c.ok)
		}
	}
}

func TestCatalogZoneName(t *testing.T) {
	if got := catalogZoneName("cmr8emsyg00ZJ"); got != "cmr8emsyg00zj.catalog.tarmac.invalid." {
		t.Fatalf("got %s", got)
	}
}

func zoneFromJSON(t *testing.T, raw string) *pdnsZoneDetail {
	t.Helper()
	var zone pdnsZoneDetail
	if err := json.Unmarshal([]byte(raw), &zone); err != nil {
		t.Fatal(err)
	}
	return &zone
}

// Shapes as PowerDNS 5.1's API returned them in the catalog test.
func TestCatalogMembers(t *testing.T) {
	zone := zoneFromJSON(t, `{"name":"g1.catalog.tarmac.invalid.","rrsets":[
		{"name":"g1.catalog.tarmac.invalid.","type":"NS","ttl":3600,"records":[{"content":"invalid."}]},
		{"name":"version.g1.catalog.tarmac.invalid.","type":"TXT","ttl":3600,"records":[{"content":"\"2\""}]},
		{"name":"buni418lq2bcffql9dfovqvgrqmlbmvl.zones.g1.catalog.tarmac.invalid.","type":"PTR","ttl":3600,"records":[{"content":"Intraced.fr."}]}]}`)
	members := catalogMembers(zone)
	if len(members) != 1 || !members["intraced.fr."] {
		t.Fatalf("got %v", members)
	}
}

// A secondary holds the signatures it received, the primary's API lists
// none: the fingerprint has to match anyway, and must not depend on order.
func TestZoneFingerprintIgnoresDnssecAndOrder(t *testing.T) {
	primary := zoneFromJSON(t, `{"serial":2026102702,"rrsets":[
		{"name":"www.intraced.fr.","type":"A","ttl":60,"records":[{"content":"1.2.3.4"}]},
		{"name":"intraced.fr.","type":"SOA","ttl":3600,"records":[{"content":"ns1. h. 2026102702 1 1 1 1"}]},
		{"name":"intraced.fr.","type":"MX","ttl":60,"records":[{"content":"10 mail.intraced.fr."}]}]}`)
	secondary := zoneFromJSON(t, `{"serial":2026102701,"rrsets":[
		{"name":"intraced.fr.","type":"MX","ttl":60,"records":[{"content":"10 mail.intraced.fr."}]},
		{"name":"intraced.fr.","type":"DNSKEY","ttl":3600,"records":[{"content":"257 3 13 abc"}]},
		{"name":"www.intraced.fr.","type":"RRSIG","ttl":60,"records":[{"content":"A 13 3 60 x"}]},
		{"name":"WWW.intraced.fr.","type":"A","ttl":60,"records":[{"content":"1.2.3.4"}]},
		{"name":"intraced.fr.","type":"SOA","ttl":3600,"records":[{"content":"ns1. h. 2026102701 1 1 1 1"}]}]}`)
	a, b := zoneFingerprint(primary), zoneFingerprint(secondary)
	if a.Fingerprint != b.Fingerprint || a.Records != 2 {
		t.Fatalf("fingerprints differ: %+v vs %+v", a, b)
	}

	changed := zoneFromJSON(t, `{"rrsets":[
		{"name":"www.intraced.fr.","type":"A","ttl":60,"records":[{"content":"5.6.7.8"}]},
		{"name":"intraced.fr.","type":"MX","ttl":60,"records":[{"content":"10 mail.intraced.fr."}]}]}`)
	if zoneFingerprint(changed).Fingerprint == a.Fingerprint {
		t.Fatal("a changed record must change the fingerprint")
	}
}

func TestAptFailureSummary(t *testing.T) {
	out := "Hit:1 http://archive.ubuntu.com/ubuntu jammy InRelease\nErr:2 https://repo.powerdns.com/ubuntu jammy-auth-99 InRelease\n  404  Not Found\nE: The repository 'https://repo.powerdns.com/ubuntu jammy-auth-99 InRelease' does not have a Release file.\n"
	if got := aptFailureSummary(out); got != "E: The repository 'https://repo.powerdns.com/ubuntu jammy-auth-99 InRelease' does not have a Release file." {
		t.Fatalf("got %q", got)
	}
}

func TestSameDnsServer(t *testing.T) {
	if !sameDnsServer("10.255.0.196:53", "10.255.0.196") || sameDnsServer("10.255.0.196", "10.255.0.197") {
		t.Fatal("port 53 must be ignored, addresses compared")
	}
}
