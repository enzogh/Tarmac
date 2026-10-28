package main

import (
	"context"
	"io"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
)

// Services echoing the caller's IPv4 as plain text, tried in order.
var publicIPv4Services = []string{
	"https://api.ipify.org",
	"https://ipv4.icanhazip.com",
	"https://ifconfig.me/ip",
}

const (
	publicIPCacheTTL      = 30 * time.Minute
	publicIPRetryInterval = 5 * time.Minute
)

var publicIPCache struct {
	sync.Mutex
	value     string
	checkedAt time.Time
}

// isNonPublicIP reports addresses other nodes can't reach over the internet:
// RFC 1918, CGNAT (100.64.0.0/10), loopback and link-local.
func isNonPublicIP(raw string) bool {
	ip := net.ParseIP(strings.TrimSpace(raw))
	if ip == nil {
		return false
	}
	if ip.IsPrivate() || ip.IsLoopback() || ip.IsLinkLocalUnicast() || ip.IsUnspecified() {
		return true
	}
	_, cgnat, _ := net.ParseCIDR("100.64.0.0/10")
	return cgnat.Contains(ip)
}

// lookupPublicIPv4 returns the node's public IPv4 as seen from outside, or ""
// when no service answered. Called on every heartbeat, so results (and
// failures) are cached.
func lookupPublicIPv4() string {
	publicIPCache.Lock()
	defer publicIPCache.Unlock()

	ttl := publicIPCacheTTL
	if publicIPCache.value == "" {
		ttl = publicIPRetryInterval
	}
	if !publicIPCache.checkedAt.IsZero() && time.Since(publicIPCache.checkedAt) < ttl {
		return publicIPCache.value
	}

	publicIPCache.checkedAt = time.Now()
	for _, service := range publicIPv4Services {
		if ip := fetchPublicIPv4(service); ip != "" {
			publicIPCache.value = ip
			return ip
		}
	}
	// Keep the last known value through a transient outage.
	return publicIPCache.value
}

func fetchPublicIPv4(url string) string {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return ""
	}
	// Force IPv4 so a dual-stack host doesn't answer with its IPv6.
	dialer := &net.Dialer{}
	transport := &http.Transport{
		DialContext: func(ctx context.Context, _, addr string) (net.Conn, error) {
			return dialer.DialContext(ctx, "tcp4", addr)
		},
	}
	defer transport.CloseIdleConnections()
	resp, err := (&http.Client{Transport: transport}).Do(req)
	if err != nil {
		return ""
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return ""
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 64))
	if err != nil {
		return ""
	}
	ip := net.ParseIP(strings.TrimSpace(string(body)))
	if ip == nil || ip.To4() == nil || isNonPublicIP(ip.String()) {
		return ""
	}
	return ip.To4().String()
}
