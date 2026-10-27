package main

import (
	"strings"
	"testing"
	"time"
)

// pdns refuses to start on a setting of a backend it hasn't loaded, so the
// lmdb config must keep nothing of gsqlite3 - this is what rolled back the
// first migrations and left a populated lmdb file behind.
func TestPdnsLmdbOnlyConfig(t *testing.T) {
	gsqlite := strings.Join([]string{
		"launch=gsqlite3",
		"gsqlite3-database=" + pdnsSqliteDbPath,
		"gsqlite3-dnssec=yes",
		"local-address=0.0.0.0",
		"api=yes",
	}, "\n")
	got, ok := pdnsLmdbOnlyConfig(gsqlite)
	if !ok {
		t.Fatal("expected the launch=gsqlite3 line to be found")
	}
	want := strings.Join([]string{
		"launch=lmdb",
		"lmdb-filename=" + pdnsLmdbFilePath,
		"local-address=0.0.0.0",
		"api=yes",
	}, "\n")
	if got != want {
		t.Fatalf("got:\n%s\nwant:\n%s", got, want)
	}
	if !pdnsConfigLaunches(got, "lmdb") || pdnsConfigLaunches(got, "gsqlite3") {
		t.Fatal("converted config should launch lmdb only")
	}

	if _, ok := pdnsLmdbOnlyConfig(got); ok {
		t.Fatal("an lmdb config has no gsqlite3 launch line to replace")
	}
}

// PowerDNS serves max(written + 1, YYYYMMDD01), so writing the current
// serial is what makes each apply reach the secondaries.
func TestNextSoaSerial(t *testing.T) {
	now := time.Date(2026, 10, 27, 12, 0, 0, 0, time.UTC)
	cases := []struct {
		current, want uint64
	}{
		{0, 2026102700},
		{2026102601, 2026102700},
		{2026102701, 2026102701},
		{2026102742, 2026102742},
	}
	for _, c := range cases {
		if got := nextSoaSerial(c.current, now); got != c.want {
			t.Errorf("nextSoaSerial(%d) = %d, want %d", c.current, got, c.want)
		}
	}
}
