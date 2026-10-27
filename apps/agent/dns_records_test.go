package main

import (
	"strings"
	"testing"
)

// Every case here is a shape PowerDNS's API rejects outright rather than
// normalising - and because applyDnsZone PATCHes the whole zone atomically,
// a single rejected record takes every other record in the zone with it.
func TestPdnsQualifyTarget(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want string
	}{
		{"appends the root dot to a bare MX target", "mail.intraced.fr", "mail.intraced.fr."},
		{"leaves an already canonical target alone", "mail.intraced.fr.", "mail.intraced.fr."},
		{"only qualifies the target of SRV content", "5 5060 sip.intraced.fr", "5 5060 sip.intraced.fr."},
		{"leaves a canonical SRV target alone", "5 5060 sip.intraced.fr.", "5 5060 sip.intraced.fr."},
		{"keeps the SRV no-service target as the root dot", "0 0 .", "0 0 ."},
		{"qualifies a single-label target", "mail", "mail."},
		{"collapses stray whitespace", "5   5060   sip.intraced.fr", "5 5060 sip.intraced.fr."},
		{"passes empty content through", "", ""},
		{"passes whitespace-only content through", "   ", "   "},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := pdnsQualifyTarget(tc.in); got != tc.want {
				t.Errorf("pdnsQualifyTarget(%q) = %q, want %q", tc.in, got, tc.want)
			}
		})
	}
}

func TestPdnsQuoteTxt(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want string
	}{
		{"quotes a bare SPF record", "v=spf1 mx ~all", `"v=spf1 mx ~all"`},
		{"quotes a bare DMARC record", "v=DMARC1; p=none", `"v=DMARC1; p=none"`},
		{"leaves already quoted content alone", `"v=spf1 mx ~all"`, `"v=spf1 mx ~all"`},
		{"preserves a hand-written multi-string value", `"chunk one" "chunk two"`, `"chunk one" "chunk two"`},
		{"detects the leading quote through whitespace", `  "v=spf1 mx ~all"`, `  "v=spf1 mx ~all"`},
		{"escapes an embedded quote", `say "hi"`, `"say \"hi\""`},
		{"escapes a backslash before quoting", `a\b`, `"a\\b"`},
		{"escapes backslashes before quotes, not after", `a\"b`, `"a\\\"b"`},
		{"quotes empty content", "", `""`},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := pdnsQuoteTxt(tc.in); got != tc.want {
				t.Errorf("pdnsQuoteTxt(%q) = %q, want %q", tc.in, got, tc.want)
			}
		})
	}
}

// The type routing matters as much as the helpers: sending a quoted CNAME or
// an unquoted TXT is just as fatal to the atomic PATCH as sending neither.
func TestPdnsTypeRouting(t *testing.T) {
	for _, rrType := range []string{"CNAME", "DNAME", "NS", "PTR"} {
		if !pdnsTargetTypes[rrType] {
			t.Errorf("%s content ends with a hostname and must be qualified", rrType)
		}
		if pdnsQuotedTypes[rrType] {
			t.Errorf("%s must not be quoted", rrType)
		}
	}

	for _, rrType := range []string{"TXT", "SPF"} {
		if !pdnsQuotedTypes[rrType] {
			t.Errorf("%s content must be quoted", rrType)
		}
		if pdnsTargetTypes[rrType] {
			t.Errorf("%s must not be treated as a hostname target", rrType)
		}
	}

	// MX and SRV carry a hostname too, but applyDnsZone handles them on their
	// own branch so it can prefix the priority - listing them here as well
	// would qualify the target twice.
	for _, rrType := range []string{"MX", "SRV"} {
		if pdnsTargetTypes[rrType] {
			t.Errorf("%s is handled by its own priority-prefixing branch", rrType)
		}
	}

	// Address records are opaque values, not hostnames or character-strings.
	for _, rrType := range []string{"A", "AAAA"} {
		if pdnsTargetTypes[rrType] || pdnsQuotedTypes[rrType] {
			t.Errorf("%s content must be passed through untouched", rrType)
		}
	}
}

func TestParseNameserversSkipsLoopbackStubs(t *testing.T) {
	content := "# generated\nsearch example.net\nnameserver 213.186.33.99\nnameserver 127.0.0.53\nnameserver ::1\nnameserver 2001:41d0:3:163::1\nnameserver bogus\noptions edns0\n"
	got := parseNameservers(content)
	want := []string{"213.186.33.99", "2001:41d0:3:163::1"}
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("parseNameservers = %v, want %v", got, want)
	}
	if len(parseNameservers("nameserver 127.0.0.1\n")) != 0 {
		t.Fatal("a forwarder-only resolv.conf must yield no upstream")
	}
}
