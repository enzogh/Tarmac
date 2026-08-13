package main

import (
	"net"
	"testing"
)

func TestParseRirLine(t *testing.T) {
	cases := []struct {
		name      string
		line      string
		wantOK    bool
		wantStart string
		wantEnd   string
		wantCC    string
	}{
		{
			name:      "ipv4 allocated",
			line:      "apnic|CN|ipv4|1.0.1.0|256|20110414|allocated",
			wantOK:    true,
			wantStart: "1.0.1.0",
			wantEnd:   "1.0.1.255",
			wantCC:    "CN",
		},
		{
			name:      "ipv4 non-power-of-two count",
			line:      "ripencc|FR|ipv4|2.0.0.0|1000|20100101|allocated",
			wantOK:    true,
			wantStart: "2.0.0.0",
			wantEnd:   "2.0.3.231", // 2.0.0.0 + 999
			wantCC:    "FR",
		},
		{
			name:      "ipv6 prefix length, not a count",
			line:      "apnic|JP|ipv6|2001:200::|32|19990813|allocated",
			wantOK:    true,
			wantStart: "2001:200::",
			wantEnd:   "2001:200:ffff:ffff:ffff:ffff:ffff:ffff",
			wantCC:    "JP",
		},
		{
			name:   "comment line",
			line:   "# some comment",
			wantOK: false,
		},
		{
			name:   "empty line",
			line:   "",
			wantOK: false,
		},
		{
			name:   "version header line",
			line:   "2|apnic|20260812|186738|19910101|20260812|+1000",
			wantOK: false,
		},
		{
			name:   "per-registry summary row",
			line:   "apnic|*|ipv4|*|17408|summary",
			wantOK: false,
		},
		{
			name:   "asn row is not geolocation data",
			line:   "apnic|JP|asn|2497|1|19970801|allocated",
			wantOK: false,
		},
		{
			name:   "available status excluded",
			line:   "apnic|JP|ipv4|3.0.0.0|256|20100101|available",
			wantOK: false,
		},
		{
			name:   "reserved status excluded",
			line:   "apnic|JP|ipv4|3.0.0.0|256|20100101|reserved",
			wantOK: false,
		},
		{
			name:      "assigned status included alongside allocated",
			line:      "arin|US|ipv4|4.0.0.0|256|20100101|assigned",
			wantOK:    true,
			wantStart: "4.0.0.0",
			wantEnd:   "4.0.0.255",
			wantCC:    "US",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			start, end, cc, ok := parseRirLine(tc.line)
			if ok != tc.wantOK {
				t.Fatalf("ok = %v, want %v", ok, tc.wantOK)
			}
			if !ok {
				return
			}
			if !start.Equal(net.ParseIP(tc.wantStart)) {
				t.Errorf("start = %v, want %v", start, tc.wantStart)
			}
			if !end.Equal(net.ParseIP(tc.wantEnd)) {
				t.Errorf("end = %v, want %v", end, tc.wantEnd)
			}
			if cc != tc.wantCC {
				t.Errorf("cc = %q, want %q", cc, tc.wantCC)
			}
		})
	}
}

func TestAddToIPv4Overflow(t *testing.T) {
	// The whole IPv4 space as one range shouldn't overflow into garbage.
	end := addToIPv4(net.ParseIP("255.255.255.0"), 4294967295)
	if !end.Equal(net.ParseIP("255.255.255.255")) {
		t.Errorf("expected clamped overflow to 255.255.255.255, got %v", end)
	}
}

func TestCountryCentroidsCoverCommonCodes(t *testing.T) {
	for _, cc := range []string{"US", "CA", "FR", "DE", "GB", "JP", "CN", "AU", "BR", "IN"} {
		if _, ok := countryCentroids[cc]; !ok {
			t.Errorf("expected countryCentroids to include %q", cc)
		}
	}
}
