package main

import "testing"

func TestIsNonPublicIP(t *testing.T) {
	cases := map[string]bool{
		"10.1.2.183":    true,
		"192.168.1.10":  true,
		"172.16.0.1":    true,
		"100.64.3.4":    true,
		"127.0.0.1":     true,
		"169.254.1.1":   true,
		"144.217.94.0":  false,
		"141.11.178.78": false,
		"not-an-ip":     false,
	}
	for raw, want := range cases {
		if got := isNonPublicIP(raw); got != want {
			t.Errorf("isNonPublicIP(%q) = %v, want %v", raw, got, want)
		}
	}
}
