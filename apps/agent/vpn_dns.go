package main

import (
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"os"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"
)

// Internal names for VPN clients (<hostname>.<zone>, e.g.
// laptop-alice.intranet.internal). Every entry node runs this small resolver
// on its client gateway address (x.y.(100+n).1): clients whose config points
// their DNS there get the workspace's VPN names answered locally, and
// everything else relayed to the resolvers chosen for their profile.
//
// - Names answer only for the asking client itself and the addresses its
//   access policy lets it reach: linking two profiles is what makes them
//   see each other by name. Anything else in the zone is NXDOMAIN.
// - The server listens on an unprivileged port of the gateway address and
//   clients reach it on port 53 through a REDIRECT (TARMAC-VPN-DNS), so it
//   never competes with whatever already owns port 53 on the host
//   (systemd-resolved, dnsmasq, a PowerDNS of a DNS server group...).
// - Relayed queries of a client leaving through a remote exit go out
//   through that exit (socket mark -> its routing table), so its DNS
//   traffic keeps leaving from the same public IP as the rest of its
//   traffic, as when the client queried the public resolver itself.
//
// The records travel with every apply_vpn (full state, like the rest), and
// the running server swaps them atomically: a renamed profile resolves
// under its new name as soon as the apply lands.
const (
	vpnDnsPort         = 53535
	vpnDnsDefaultTTL   = 10
	vpnDnsUpstreamWait = 2 * time.Second
	vpnDnsMaxInflight  = 512
	vpnDnsTCPIdle      = 10 * time.Second
	// Socket mark for relayed queries = base | routing table of the exit,
	// matched by an ip rule (pref vpnRulePrefDns) sending them to that
	// table. High bit so it can't collide with the small marks other tools
	// (wg-quick, kube-proxy's 0x4000...) put on their own packets.
	vpnDnsMarkBase = 0x10000000
	vpnDnsMarkMask = "0x10000000/0x10000000"
	vpnChainDns    = "TARMAC-VPN-DNS"
	// The answer to a relayed query comes back through the exit's tunnel,
	// unmarked: reverse-path filtering would look its source up in the
	// main table (not through the tunnel) and drop it. The mark is saved
	// on the connection when the query leaves and restored on the answer,
	// and src_valid_mark lets the check use it (as wg-quick does).
	vpnChainDnsSave    = "TARMAC-VPN-DNSO"
	vpnChainDnsRestore = "TARMAC-VPN-DNSI"

	dnsTypeA    = 1
	dnsTypeNS   = 2
	dnsTypeSOA  = 6
	dnsTypePTR  = 12
	dnsTypeANY  = 255
	dnsClassIN  = 1
	dnsClassANY = 255

	dnsRcodeOK       = 0
	dnsRcodeFormErr  = 1
	dnsRcodeServFail = 2
	dnsRcodeNXDomain = 3
	dnsRcodeNotImp   = 4
)

var vpnDnsLabelPattern = regexp.MustCompile(`^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$`)

type vpnDnsRecord struct {
	name string
	ip   string
}

type vpnDnsSpec struct {
	zone    string
	ttl     int
	records []vpnDnsRecord
}

func validDnsZone(zone string) bool {
	if zone == "" || len(zone) > 200 {
		return false
	}
	for _, label := range strings.Split(zone, ".") {
		if !vpnDnsLabelPattern.MatchString(label) {
			return false
		}
	}
	return true
}

func parseVpnDnsSpec(raw map[string]interface{}) (*vpnDnsSpec, error) {
	spec := &vpnDnsSpec{
		zone: strings.TrimSuffix(strings.ToLower(readString(raw, "zone")), "."),
		ttl:  readInt(raw, "ttl", vpnDnsDefaultTTL),
	}
	if !validDnsZone(spec.zone) {
		return nil, fmt.Errorf("invalid vpn dns zone %q", spec.zone)
	}
	if spec.ttl < 0 || spec.ttl > 86400 {
		spec.ttl = vpnDnsDefaultTTL
	}
	rawRecords, _ := raw["records"].([]interface{})
	for _, item := range rawRecords {
		record, ok := item.(map[string]interface{})
		if !ok {
			continue
		}
		entry := vpnDnsRecord{name: strings.ToLower(readString(record, "name")), ip: readString(record, "ip")}
		if !vpnDnsLabelPattern.MatchString(entry.name) || !validIPv4(entry.ip) {
			return nil, fmt.Errorf("invalid vpn dns record %q -> %q", entry.name, entry.ip)
		}
		spec.records = append(spec.records, entry)
	}
	return spec, nil
}

// ---------------------------------------------------------------------------
// What the running server answers from (rebuilt on every apply)
// ---------------------------------------------------------------------------

type vpnDnsClientView struct {
	self      net.IP
	allow     []*net.IPNet
	upstreams []string
	mark      int
}

func (c *vpnDnsClientView) canSee(ip net.IP) bool {
	if c == nil {
		return false
	}
	if c.self.Equal(ip) {
		return true
	}
	for _, network := range c.allow {
		if network.Contains(ip) {
			return true
		}
	}
	return false
}

type vpnDnsView struct {
	zone     string
	ttl      uint32
	gateway  net.IP
	byName   map[string]net.IP
	byAddr   map[string]string
	clients  map[string]*vpnDnsClientView
	fallback []string
}

func buildVpnDnsView(entry *vpnEntry, systemResolvers []string) (*vpnDnsView, error) {
	gateway, _, err := net.ParseCIDR(entry.addressCidr)
	if err != nil || gateway.To4() == nil {
		return nil, fmt.Errorf("invalid gateway address %q", entry.addressCidr)
	}
	view := &vpnDnsView{
		zone:     entry.dns.zone,
		ttl:      uint32(entry.dns.ttl),
		gateway:  gateway.To4(),
		byName:   map[string]net.IP{},
		byAddr:   map[string]string{},
		clients:  map[string]*vpnDnsClientView{},
		fallback: systemResolvers,
	}
	for _, record := range entry.dns.records {
		ip := net.ParseIP(record.ip).To4()
		view.byName[record.name] = ip
		view.byAddr[ip.String()] = record.name
	}
	for _, client := range entry.clients {
		self := net.ParseIP(client.ip).To4()
		clientView := &vpnDnsClientView{self: self}
		for _, cidr := range client.policy.allow {
			if _, network, err := net.ParseCIDR(cidr); err == nil {
				clientView.allow = append(clientView.allow, network)
			}
		}
		for _, upstream := range client.upstreams {
			ip := net.ParseIP(upstream)
			// The gateway is this very server: relaying to it would loop.
			if ip == nil || ip.Equal(view.gateway) {
				continue
			}
			clientView.upstreams = append(clientView.upstreams, net.JoinHostPort(ip.String(), "53"))
		}
		if client.table != 0 {
			clientView.mark = vpnDnsMarkBase | client.table
		}
		view.clients[self.String()] = clientView
	}
	return view, nil
}

// The host's own resolvers, for clients whose profile names none (private
// mode keeps the device's DNS by default): systemd-resolved's stub, the
// dnsmasq forwarder... which also know the fleet's *.tarmac.local names.
var vpnResolvConfPath = "/etc/resolv.conf"

func systemDnsResolvers() []string {
	resolvers := []string{}
	if data, err := os.ReadFile(vpnResolvConfPath); err == nil {
		for _, line := range strings.Split(string(data), "\n") {
			fields := strings.Fields(line)
			if len(fields) >= 2 && fields[0] == "nameserver" {
				if ip := net.ParseIP(strings.SplitN(fields[1], "%", 2)[0]); ip != nil {
					resolvers = append(resolvers, net.JoinHostPort(ip.String(), "53"))
				}
			}
		}
	}
	if len(resolvers) == 0 {
		resolvers = []string{"1.1.1.1:53", "1.0.0.1:53"}
	}
	return resolvers
}

// ---------------------------------------------------------------------------
// Server lifecycle
// ---------------------------------------------------------------------------

type vpnDnsServer struct {
	addr string
	udp  *net.UDPConn
	tcp  *net.TCPListener
	view atomic.Value // *vpnDnsView
	sem  chan struct{}
	done chan struct{}
}

var (
	vpnDnsMu  sync.Mutex
	vpnDnsCur *vpnDnsServer
)

// syncVpnResolver starts, reconfigures or stops this node's resolver to
// match the apply. Called with vpnApplyMu held, once the client interface
// (and so the gateway address) exists.
func syncVpnResolver(desired vpnDesired) error {
	vpnDnsMu.Lock()
	defer vpnDnsMu.Unlock()

	if desired.entry == nil || desired.entry.dns == nil {
		if vpnDnsCur != nil {
			vpnDnsCur.stop()
			vpnDnsCur = nil
		}
		return nil
	}
	view, err := buildVpnDnsView(desired.entry, systemDnsResolvers())
	if err != nil {
		return err
	}
	addr := net.JoinHostPort(view.gateway.String(), strconv.Itoa(vpnDnsPort))
	if vpnDnsCur != nil && vpnDnsCur.addr != addr {
		vpnDnsCur.stop()
		vpnDnsCur = nil
	}
	if vpnDnsCur == nil {
		server, err := startVpnDnsServer(addr, view)
		if err != nil {
			return fmt.Errorf("internal DNS resolver on %s: %w", addr, err)
		}
		vpnDnsCur = server
		return nil
	}
	vpnDnsCur.view.Store(view)
	return nil
}

func startVpnDnsServer(addr string, view *vpnDnsView) (*vpnDnsServer, error) {
	udpAddr, err := net.ResolveUDPAddr("udp4", addr)
	if err != nil {
		return nil, err
	}
	udp, err := net.ListenUDP("udp4", udpAddr)
	if err != nil {
		return nil, err
	}
	tcpAddr, err := net.ResolveTCPAddr("tcp4", addr)
	if err != nil {
		udp.Close()
		return nil, err
	}
	tcp, err := net.ListenTCP("tcp4", tcpAddr)
	if err != nil {
		udp.Close()
		return nil, err
	}
	server := &vpnDnsServer{
		addr: addr,
		udp:  udp,
		tcp:  tcp,
		sem:  make(chan struct{}, vpnDnsMaxInflight),
		done: make(chan struct{}),
	}
	server.view.Store(view)
	go server.serveUDP()
	go server.serveTCP()
	log.Printf("vpn: internal DNS resolver listening on %s (zone %s)", addr, view.zone)
	return server, nil
}

func (s *vpnDnsServer) stop() {
	select {
	case <-s.done:
		return
	default:
	}
	close(s.done)
	s.udp.Close()
	s.tcp.Close()
	log.Printf("vpn: internal DNS resolver on %s stopped", s.addr)
}

func (s *vpnDnsServer) stopped() bool {
	select {
	case <-s.done:
		return true
	default:
		return false
	}
}

func (s *vpnDnsServer) serveUDP() {
	buf := make([]byte, 65535)
	for {
		n, from, err := s.udp.ReadFromUDP(buf)
		if err != nil {
			if s.stopped() {
				return
			}
			continue
		}
		msg := append([]byte(nil), buf[:n]...)
		select {
		case s.sem <- struct{}{}:
		default:
			// Saturated (upstreams not answering): drop, the client retries.
			continue
		}
		go func() {
			defer func() { <-s.sem }()
			if resp := s.handle(msg, from.IP, false); resp != nil {
				_, _ = s.udp.WriteToUDP(resp, from)
			}
		}()
	}
}

func (s *vpnDnsServer) serveTCP() {
	for {
		conn, err := s.tcp.AcceptTCP()
		if err != nil {
			if s.stopped() {
				return
			}
			continue
		}
		go s.serveTCPConn(conn)
	}
}

func (s *vpnDnsServer) serveTCPConn(conn *net.TCPConn) {
	defer conn.Close()
	src := conn.RemoteAddr().(*net.TCPAddr).IP
	var length [2]byte
	for !s.stopped() {
		_ = conn.SetDeadline(time.Now().Add(vpnDnsTCPIdle))
		if _, err := io.ReadFull(conn, length[:]); err != nil {
			return
		}
		msg := make([]byte, binary.BigEndian.Uint16(length[:]))
		if _, err := io.ReadFull(conn, msg); err != nil {
			return
		}
		resp := s.handle(msg, src, true)
		if resp == nil {
			return
		}
		out := make([]byte, 2, 2+len(resp))
		binary.BigEndian.PutUint16(out, uint16(len(resp)))
		if _, err := conn.Write(append(out, resp...)); err != nil {
			return
		}
	}
}

// ---------------------------------------------------------------------------
// Query handling
// ---------------------------------------------------------------------------

type dnsQuestion struct {
	name   string
	qtype  uint16
	qclass uint16
	end    int
}

// parseDnsQuestion reads the single question of a query. Compression
// pointers never appear in a question in practice: one makes the query
// count as unparsable (relayed as-is).
func parseDnsQuestion(msg []byte) (dnsQuestion, bool) {
	var q dnsQuestion
	if len(msg) < 12 || binary.BigEndian.Uint16(msg[4:6]) != 1 {
		return q, false
	}
	labels := []string{}
	offset, total := 12, 0
	for {
		if offset >= len(msg) {
			return q, false
		}
		length := int(msg[offset])
		offset++
		if length == 0 {
			break
		}
		if length&0xC0 != 0 || offset+length > len(msg) {
			return q, false
		}
		total += length + 1
		if total > 255 {
			return q, false
		}
		labels = append(labels, strings.ToLower(string(msg[offset:offset+length])))
		offset += length
	}
	if offset+4 > len(msg) {
		return q, false
	}
	q.name = strings.Join(labels, ".")
	q.qtype = binary.BigEndian.Uint16(msg[offset : offset+2])
	q.qclass = binary.BigEndian.Uint16(msg[offset+2 : offset+4])
	q.end = offset + 4
	return q, true
}

func (s *vpnDnsServer) handle(msg []byte, src net.IP, tcp bool) []byte {
	// Not a query (QR set) or too short to even echo an id: ignore.
	if len(msg) < 12 || msg[2]&0x80 != 0 {
		return nil
	}
	view, _ := s.view.Load().(*vpnDnsView)
	if view == nil {
		return dnsHeaderReply(msg, dnsRcodeServFail)
	}
	if opcode := (msg[2] >> 3) & 0x0F; opcode != 0 {
		return dnsHeaderReply(msg, dnsRcodeNotImp)
	}
	q, ok := parseDnsQuestion(msg)
	if !ok {
		return dnsHeaderReply(msg, dnsRcodeFormErr)
	}
	client := view.clients[src.To4().String()]
	if resp, handled := view.answerLocal(msg, q, client); handled {
		return resp
	}
	return view.relay(msg, q, client, tcp)
}

// answerLocal answers what this resolver is authoritative for: the zone,
// and reverse lookups of the addresses it names. handled=false = relay.
func (v *vpnDnsView) answerLocal(msg []byte, q dnsQuestion, client *vpnDnsClientView) ([]byte, bool) {
	if q.qclass != dnsClassIN && q.qclass != dnsClassANY {
		return nil, false
	}
	soa := v.soaRecord()
	if q.name == v.zone {
		if q.qtype == dnsTypeSOA || q.qtype == dnsTypeANY {
			return dnsReply(msg, q, dnsRcodeOK, [][]byte{v.soaRecordAtQuestion()}, nil), true
		}
		return dnsReply(msg, q, dnsRcodeOK, nil, [][]byte{soa}), true
	}
	if strings.HasSuffix(q.name, "."+v.zone) {
		label := strings.TrimSuffix(q.name, "."+v.zone)
		ip, found := v.byName[label]
		if !found || !client.canSee(ip) {
			return dnsReply(msg, q, dnsRcodeNXDomain, nil, [][]byte{soa}), true
		}
		if q.qtype == dnsTypeA || q.qtype == dnsTypeANY {
			return dnsReply(msg, q, dnsRcodeOK, [][]byte{dnsRR(dnsTypeA, v.ttl, ip)}, nil), true
		}
		// The name exists, just not with this type (AAAA: the VPN is IPv4).
		return dnsReply(msg, q, dnsRcodeOK, nil, [][]byte{soa}), true
	}
	if q.qtype == dnsTypePTR || q.qtype == dnsTypeANY {
		if ip := reverseLookupIP(q.name); ip != nil {
			if label, known := v.byAddr[ip.String()]; known {
				if !client.canSee(ip) {
					return dnsReply(msg, q, dnsRcodeNXDomain, nil, nil), true
				}
				target := encodeDnsName(label + "." + v.zone)
				return dnsReply(msg, q, dnsRcodeOK, [][]byte{dnsRR(dnsTypePTR, v.ttl, target)}, nil), true
			}
		}
	}
	return nil, false
}

// SOA of the zone, sent in the authority section of negative answers so
// clients cache them only for the (short) TTL: a name created a moment
// later resolves right away.
func (v *vpnDnsView) soaRecord() []byte {
	record := encodeDnsName(v.zone)
	return append(record, v.soaBody()...)
}

func (v *vpnDnsView) soaRecordAtQuestion() []byte {
	return append([]byte{0xC0, 0x0C}, v.soaBody()...)
}

func (v *vpnDnsView) soaBody() []byte {
	rdata := encodeDnsName(v.zone)
	rdata = append(rdata, encodeDnsName("hostmaster."+v.zone)...)
	fields := make([]byte, 20)
	binary.BigEndian.PutUint32(fields[0:], uint32(time.Now().Unix()))
	binary.BigEndian.PutUint32(fields[4:], 3600)
	binary.BigEndian.PutUint32(fields[8:], 600)
	binary.BigEndian.PutUint32(fields[12:], 86400)
	binary.BigEndian.PutUint32(fields[16:], v.ttl)
	rdata = append(rdata, fields...)
	out := make([]byte, 10, 10+len(rdata))
	binary.BigEndian.PutUint16(out[0:], dnsTypeSOA)
	binary.BigEndian.PutUint16(out[2:], dnsClassIN)
	binary.BigEndian.PutUint32(out[4:], v.ttl)
	binary.BigEndian.PutUint16(out[8:], uint16(len(rdata)))
	return append(out, rdata...)
}

// dnsRR is an answer for the question's own name (compression pointer to
// offset 12).
func dnsRR(rrtype uint16, ttl uint32, rdata []byte) []byte {
	out := make([]byte, 12, 12+len(rdata))
	out[0], out[1] = 0xC0, 0x0C
	binary.BigEndian.PutUint16(out[2:], rrtype)
	binary.BigEndian.PutUint16(out[4:], dnsClassIN)
	binary.BigEndian.PutUint32(out[6:], ttl)
	binary.BigEndian.PutUint16(out[10:], uint16(len(rdata)))
	return append(out, rdata...)
}

func encodeDnsName(name string) []byte {
	out := []byte{}
	for _, label := range strings.Split(strings.TrimSuffix(name, "."), ".") {
		if label == "" {
			continue
		}
		out = append(out, byte(len(label)))
		out = append(out, label...)
	}
	return append(out, 0)
}

// "4.3.2.1.in-addr.arpa" -> 1.2.3.4
func reverseLookupIP(name string) net.IP {
	if !strings.HasSuffix(name, ".in-addr.arpa") {
		return nil
	}
	parts := strings.Split(strings.TrimSuffix(name, ".in-addr.arpa"), ".")
	if len(parts) != 4 {
		return nil
	}
	ip := net.ParseIP(parts[3] + "." + parts[2] + "." + parts[1] + "." + parts[0])
	if ip == nil {
		return nil
	}
	return ip.To4()
}

func dnsReply(msg []byte, q dnsQuestion, rcode byte, answers, authority [][]byte) []byte {
	out := make([]byte, 12, 512)
	copy(out[0:2], msg[0:2])
	// QR, the query's opcode, AA, its RD bit; RA and the rcode.
	out[2] = 0x80 | (msg[2] & 0x78) | 0x04 | (msg[2] & 0x01)
	out[3] = 0x80 | rcode
	binary.BigEndian.PutUint16(out[4:], 1)
	binary.BigEndian.PutUint16(out[6:], uint16(len(answers)))
	binary.BigEndian.PutUint16(out[8:], uint16(len(authority)))
	out = append(out, msg[12:q.end]...)
	for _, record := range answers {
		out = append(out, record...)
	}
	for _, record := range authority {
		out = append(out, record...)
	}
	return out
}

// dnsHeaderReply answers with the bare header (no question echoed), for
// queries this server can't or won't read.
func dnsHeaderReply(msg []byte, rcode byte) []byte {
	out := make([]byte, 12)
	copy(out[0:2], msg[0:2])
	out[2] = 0x80 | (msg[2] & 0x78) | (msg[2] & 0x01)
	out[3] = 0x80 | rcode
	return out
}

// relay hands the query, untouched, to the client's upstream resolvers in
// order, and returns the first answer as-is.
func (v *vpnDnsView) relay(msg []byte, q dnsQuestion, client *vpnDnsClientView, tcp bool) []byte {
	upstreams, mark := v.fallback, 0
	if client != nil && len(client.upstreams) > 0 {
		upstreams, mark = client.upstreams, client.mark
	}
	for _, upstream := range upstreams {
		resp, err := vpnDnsExchange(msg, upstream, tcp, mark, v.gateway)
		if err == nil {
			return resp
		}
	}
	return dnsReply(msg, q, dnsRcodeServFail, nil, nil)
}

var errDnsMismatch = errors.New("answer does not match the query")

func vpnDnsExchange(msg []byte, upstream string, tcp bool, mark int, gateway net.IP) ([]byte, error) {
	host, _, err := net.SplitHostPort(upstream)
	if err != nil {
		return nil, err
	}
	dialer := net.Dialer{Timeout: vpnDnsUpstreamWait}
	upstreamIP := net.ParseIP(host)
	// Through the client's exit: sent from the gateway address (part of
	// the client subnet the exit NATs and routes back) with the mark that
	// selects the exit's table. Loopback/IPv6 upstreams stay local.
	if mark != 0 && upstreamIP != nil && upstreamIP.To4() != nil && !upstreamIP.IsLoopback() {
		if tcp {
			dialer.LocalAddr = &net.TCPAddr{IP: gateway}
		} else {
			dialer.LocalAddr = &net.UDPAddr{IP: gateway}
		}
		dialer.Control = func(network, address string, conn syscall.RawConn) error {
			var sockErr error
			if err := conn.Control(func(fd uintptr) {
				sockErr = syscall.SetsockoptInt(int(fd), syscall.SOL_SOCKET, syscall.SO_MARK, mark)
			}); err != nil {
				return err
			}
			return sockErr
		}
	}
	network := "udp"
	if tcp {
		network = "tcp"
	}
	conn, err := dialer.Dial(network, upstream)
	if err != nil {
		return nil, err
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(vpnDnsUpstreamWait))

	if tcp {
		out := make([]byte, 2, 2+len(msg))
		binary.BigEndian.PutUint16(out, uint16(len(msg)))
		if _, err := conn.Write(append(out, msg...)); err != nil {
			return nil, err
		}
		var length [2]byte
		if _, err := io.ReadFull(conn, length[:]); err != nil {
			return nil, err
		}
		resp := make([]byte, binary.BigEndian.Uint16(length[:]))
		if _, err := io.ReadFull(conn, resp); err != nil {
			return nil, err
		}
		if len(resp) < 12 || resp[0] != msg[0] || resp[1] != msg[1] {
			return nil, errDnsMismatch
		}
		return resp, nil
	}

	if _, err := conn.Write(msg); err != nil {
		return nil, err
	}
	buf := make([]byte, 65535)
	for {
		n, err := conn.Read(buf)
		if err != nil {
			return nil, err
		}
		// A stray datagram (late answer to an earlier try) is skipped.
		if n >= 12 && buf[0] == msg[0] && buf[1] == msg[1] && buf[2]&0x80 != 0 {
			return append([]byte(nil), buf[:n]...), nil
		}
	}
}

// ---------------------------------------------------------------------------
// Firewall and routing pieces (wired into syncVpnFirewall / syncVpnRules)
// ---------------------------------------------------------------------------

func vpnGatewayIP(entry *vpnEntry) string {
	if entry == nil {
		return ""
	}
	ip, _, err := net.ParseCIDR(entry.addressCidr)
	if err != nil {
		return ""
	}
	return ip.String()
}

// Clients query their gateway on port 53; the server listens on vpnDnsPort.
func vpnDnsRedirectRules(desired vpnDesired) [][]string {
	if desired.entry == nil || desired.entry.dns == nil {
		return nil
	}
	gateway := vpnGatewayIP(desired.entry)
	rules := [][]string{}
	for _, proto := range []string{"udp", "tcp"} {
		rules = append(rules, []string{
			"-i", desired.entry.iface, "-d", gateway + "/32", "-p", proto, "--dport", "53",
			"-j", "REDIRECT", "--to-ports", strconv.Itoa(vpnDnsPort),
		})
	}
	return rules
}

func vpnDnsInputRules(desired vpnDesired) [][]string {
	if desired.entry == nil || desired.entry.dns == nil {
		return nil
	}
	gateway := vpnGatewayIP(desired.entry)
	rules := [][]string{}
	for _, proto := range []string{"udp", "tcp"} {
		rules = append(rules, []string{
			"-i", desired.entry.iface, "-d", gateway + "/32", "-p", proto, "--dport", strconv.Itoa(vpnDnsPort), "-j", "ACCEPT",
		})
	}
	return rules
}

func vpnDnsConnmarkRules(desired vpnDesired) (save, restore [][]string) {
	if desired.entry == nil || desired.entry.dns == nil {
		return nil, nil
	}
	gateway := vpnGatewayIP(desired.entry) + "/32"
	save = [][]string{{"-s", gateway, "-m", "mark", "--mark", vpnDnsMarkMask, "-j", "CONNMARK", "--save-mark"}}
	restore = [][]string{{
		"-i", vpnTunnelPrefix + "+", "-d", gateway, "-m", "connmark", "--mark", vpnDnsMarkMask, "-j", "CONNMARK", "--restore-mark",
	}}
	return save, restore
}

// One rule per exit table used by this node's clients: relayed queries
// carrying that table's mark follow it.
func vpnDnsMarkRules(desired vpnDesired) []vpnRule {
	if desired.entry == nil || desired.entry.dns == nil {
		return nil
	}
	seen := map[int]bool{}
	rules := []vpnRule{}
	for _, client := range desired.entry.clients {
		if client.table == 0 || seen[client.table] {
			continue
		}
		seen[client.table] = true
		rules = append(rules, vpnRule{
			pref:   vpnRulePrefDns,
			fwmark: fmt.Sprintf("0x%x", vpnDnsMarkBase|client.table),
			table:  strconv.Itoa(client.table),
		})
	}
	return rules
}
