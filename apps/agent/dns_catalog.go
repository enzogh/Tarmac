package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"os"
	"sort"
	"strings"
	"time"
)

// Catalog zones (RFC 9432, PowerDNS 4.7+): the primary lists the group's
// zones in a "producer" zone, which secondaries pull like any other zone
// ("consumer") and from which they create, update and delete the member
// zones on their own. This replaces telling every secondary about every
// zone (apply_dns_zone_slave), which the control plane keeps doing only
// for members still on an older PowerDNS.

const catalogZoneSuffix = ".catalog.tarmac.invalid."

// catalogZoneName is the group's catalog zone. Under .invalid: it is only
// ever transferred between the group's servers, never delegated.
func catalogZoneName(groupID string) string {
	return tsigKeyNameSanitizer.ReplaceAllString(strings.ToLower(groupID), "-") + catalogZoneSuffix
}

// dnsRole is what dnsMarkerPath records about this node's place in its
// DNS server group.
type dnsRole struct {
	groupID, role, primaryVlanIP string
}

func readDnsRole() (dnsRole, bool) {
	data, err := os.ReadFile(dnsMarkerPath)
	if err != nil {
		return dnsRole{}, false
	}
	var r dnsRole
	for _, line := range strings.Split(string(data), "\n") {
		key, value, _ := strings.Cut(strings.TrimSpace(line), "=")
		switch key {
		case "groupId":
			r.groupID = value
		case "role":
			r.role = value
		case "primaryVlanIp":
			r.primaryVlanIP = value
		}
	}
	return r, r.groupID != "" && r.role != ""
}

type pdnsZoneSummary struct {
	Name    string   `json:"name"`
	Kind    string   `json:"kind"`
	Catalog string   `json:"catalog"`
	Masters []string `json:"masters"`
}

func (c *pdnsClient) listZones(ctx context.Context) ([]pdnsZoneSummary, error) {
	body, status, err := c.request(ctx, http.MethodGet, "/zones", nil)
	if err != nil {
		return nil, err
	}
	if status >= 300 {
		return nil, fmt.Errorf("unexpected status %d: %s", status, strings.TrimSpace(string(body)))
	}
	var zones []pdnsZoneSummary
	return zones, json.Unmarshal(body, &zones)
}

type pdnsRrset struct {
	Name    string `json:"name"`
	Type    string `json:"type"`
	TTL     int    `json:"ttl"`
	Records []struct {
		Content  string `json:"content"`
		Disabled bool   `json:"disabled"`
	} `json:"records"`
}

type pdnsZoneDetail struct {
	Name            string      `json:"name"`
	Kind            string      `json:"kind"`
	Serial          uint64      `json:"serial"`
	Catalog         string      `json:"catalog"`
	Masters         []string    `json:"masters"`
	SlaveTsigKeyIDs []string    `json:"slave_tsig_key_ids"`
	Rrsets          []pdnsRrset `json:"rrsets"`
}

func (c *pdnsClient) getZone(ctx context.Context, fqdn string, withRrsets bool) (*pdnsZoneDetail, error) {
	path := "/zones/" + url.PathEscape(fqdn)
	if !withRrsets {
		path += "?rrsets=false"
	}
	body, status, err := c.request(ctx, http.MethodGet, path, nil)
	if err != nil {
		return nil, err
	}
	if status == http.StatusNotFound || status == http.StatusUnprocessableEntity {
		return nil, nil
	}
	if status >= 300 {
		return nil, fmt.Errorf("unexpected status %d: %s", status, strings.TrimSpace(string(body)))
	}
	var zone pdnsZoneDetail
	return &zone, json.Unmarshal(body, &zone)
}

func (c *pdnsClient) putZone(ctx context.Context, fqdn string, fields map[string]interface{}) error {
	body, status, err := c.request(ctx, http.MethodPut, "/zones/"+url.PathEscape(fqdn), fields)
	if err != nil {
		return err
	}
	if status >= 300 {
		return fmt.Errorf("unexpected status %d: %s", status, strings.TrimSpace(string(body)))
	}
	return nil
}

func (c *pdnsClient) postZone(ctx context.Context, fields map[string]interface{}) error {
	body, status, err := c.request(ctx, http.MethodPost, "/zones", fields)
	if err != nil {
		return err
	}
	if status >= 300 {
		return fmt.Errorf("unexpected status %d: %s", status, strings.TrimSpace(string(body)))
	}
	return nil
}

func (c *pdnsClient) hasTsigKey(ctx context.Context, name string) bool {
	keys, err := c.fetchTsigKeys(ctx)
	if err != nil {
		return false
	}
	for _, key := range keys {
		if strings.TrimSuffix(key.Name, ".") == name {
			return true
		}
	}
	return false
}

// ensureCatalogProducer creates the group's producer zone on the primary
// and lists zone in it.
func (c *pdnsClient) ensureCatalogProducer(ctx context.Context, groupID string) (string, error) {
	catalog := catalogZoneName(groupID)
	existing, err := c.getZone(ctx, catalog, false)
	if err != nil {
		return "", err
	}
	if existing == nil {
		// PowerDNS sets a producer's serial to the current Unix time on
		// each member change, so it must start below that: created with
		// the API's default SOA-EDIT-API it starts at YYYYMMDD01, larger
		// than any Unix time until 2034 - the next update then reads as
		// older, and a secondary that already pulled the catalog would
		// ignore every later one.
		fields := map[string]interface{}{
			"name": catalog, "kind": "Producer", "nameservers": []string{"invalid."}, "soa_edit_api": "",
			"rrsets": []map[string]interface{}{{
				"name": catalog, "type": "SOA", "ttl": 3600,
				"records": []map[string]interface{}{{"content": "invalid. hostmaster.invalid. 1 3600 600 604800 1800", "disabled": false}},
			}},
		}
		if key := tsigKeyName(groupID); c.hasTsigKey(ctx, key) {
			// Secondaries sign their pulls of the catalog too.
			fields["master_tsig_key_ids"] = []string{key}
		}
		if err := c.postZone(ctx, fields); err != nil {
			return "", fmt.Errorf("cannot create catalog zone %s: %w", catalog, err)
		}
	}
	return catalog, nil
}

// syncCatalogProducer lists every zone this primary serves in the group's
// catalog - the zones applyDnsZone created before catalogs existed too.
func syncCatalogProducer(ctx context.Context, client *pdnsClient, groupID string) error {
	catalog, err := client.ensureCatalogProducer(ctx, groupID)
	if err != nil {
		return err
	}
	zones, err := client.listZones(ctx)
	if err != nil {
		return err
	}
	for _, zone := range zones {
		if zone.Name == catalog || strings.HasSuffix(zone.Name, catalogZoneSuffix) {
			continue
		}
		if !strings.EqualFold(zone.Kind, "Master") || zone.Catalog == catalog {
			continue
		}
		if err := client.putZone(ctx, zone.Name, map[string]interface{}{"catalog": catalog}); err != nil {
			return fmt.Errorf("cannot list %s in catalog: %w", zone.Name, err)
		}
	}
	return nil
}

// catalogMembers reads the member zone names out of a catalog zone held on
// this server (PTR records under zones.<catalog>).
func catalogMembers(zone *pdnsZoneDetail) map[string]bool {
	members := map[string]bool{}
	suffix := ".zones." + zone.Name
	for _, rrset := range zone.Rrsets {
		if rrset.Type != "PTR" || !strings.HasSuffix(rrset.Name, suffix) {
			continue
		}
		for _, record := range rrset.Records {
			members[strings.ToLower(record.Content)] = true
		}
	}
	return members
}

// syncCatalogConsumer makes this secondary consume its group's catalog:
// creates the consumer zone, adopts the zones it already holds once the
// catalog lists them, and makes every member zone sign its transfers with
// the group's TSIG key - zones the consumer creates on its own don't.
func syncCatalogConsumer(ctx context.Context, client *pdnsClient, role dnsRole) error {
	if role.primaryVlanIP == "" {
		return errors.New("primary address unknown")
	}
	catalog := catalogZoneName(role.groupID)
	key := tsigKeyName(role.groupID)
	signed := client.hasTsigKey(ctx, key)
	tsigIDs := []string{}
	if signed {
		tsigIDs = []string{key}
	}

	consumer, err := client.getZone(ctx, catalog, true)
	if err != nil {
		return err
	}
	if consumer == nil {
		if err := client.postZone(ctx, map[string]interface{}{
			"name": catalog, "kind": "Consumer", "masters": []string{role.primaryVlanIP}, "slave_tsig_key_ids": tsigIDs,
		}); err != nil {
			return fmt.Errorf("cannot create catalog consumer %s: %w", catalog, err)
		}
		if err := client.triggerAxfrRetrieve(ctx, catalog); err != nil {
			log.Printf("dns: could not trigger the first transfer of %s: %v", catalog, err)
		}
		// Adoption waits for the catalog's content, on the next pass.
		return nil
	}
	if len(consumer.Masters) != 1 || consumer.Masters[0] != role.primaryVlanIP {
		if err := client.putZone(ctx, catalog, map[string]interface{}{"masters": []string{role.primaryVlanIP}}); err != nil {
			return err
		}
	}

	members := catalogMembers(consumer)
	zones, err := client.listZones(ctx)
	if err != nil {
		return err
	}
	for _, zone := range zones {
		if !strings.EqualFold(zone.Kind, "Slave") {
			continue
		}
		// Only zones the catalog lists are adopted: the consumer deletes a
		// member zone the catalog doesn't list, which would take a zone
		// the primary still serves off this secondary.
		if zone.Catalog == "" && members[strings.ToLower(zone.Name)] {
			if err := client.putZone(ctx, zone.Name, map[string]interface{}{"catalog": catalog}); err != nil {
				return fmt.Errorf("cannot adopt %s into the catalog: %w", zone.Name, err)
			}
			zone.Catalog = catalog
		}
		if zone.Catalog != catalog || !signed {
			continue
		}
		detail, err := client.getZone(ctx, zone.Name, false)
		if err != nil || detail == nil {
			continue
		}
		hasKey := false
		for _, id := range detail.SlaveTsigKeyIDs {
			if strings.TrimSuffix(id, ".") == key {
				hasKey = true
			}
		}
		if !hasKey {
			if err := client.setZoneTsigKeys(ctx, zone.Name, "slave_tsig_key_ids", []string{key}); err != nil {
				return fmt.Errorf("cannot sign transfers of %s: %w", zone.Name, err)
			}
		}
	}
	return nil
}

// removeOrphanTsigKeys deletes the TSIG keys of DNS groups this node is no
// longer part of. Removing a node from a group stops pdns but leaves its
// data, so a node that later joins another group kept the old group's key.
func removeOrphanTsigKeys(ctx context.Context, client *pdnsClient, keep string) error {
	keys, err := client.fetchTsigKeys(ctx)
	if err != nil {
		return err
	}
	for _, key := range keys {
		name := strings.TrimSuffix(key.Name, ".")
		if !strings.HasPrefix(name, "tarmac-dns-") || name == keep {
			continue
		}
		body, status, err := client.request(ctx, http.MethodDelete, "/tsigkeys/"+url.PathEscape(key.ID), nil)
		if err != nil {
			return err
		}
		if status >= 300 && status != http.StatusNotFound {
			return fmt.Errorf("cannot delete TSIG key %s: %s", name, strings.TrimSpace(string(body)))
		}
		log.Printf("dns: removed TSIG key %s, left over from a DNS group this node no longer belongs to", name)
	}
	return nil
}

// reconcileDnsGroupRole keeps the catalog and the TSIG keys in line with
// this node's role. Runs after each apply_dns_server_group and on a ticker:
// the control plane only sends that command when membership changes,
// while catalog membership moves with every zone.
func reconcileDnsGroupRole(ctx context.Context) {
	role, ok := readDnsRole()
	if !ok {
		return
	}
	apiKey, err := ensurePdnsApiKey()
	if err != nil {
		return
	}
	client := &pdnsClient{apiKey: apiKey}
	if err := removeOrphanTsigKeys(ctx, client, tsigKeyName(role.groupID)); err != nil {
		log.Printf("dns: could not clean up TSIG keys: %v", err)
	}
	if !pdnsSupportsCatalog() {
		return
	}
	var syncErr error
	if role.role == "primary" {
		syncErr = syncCatalogProducer(ctx, client, role.groupID)
	} else {
		syncErr = syncCatalogConsumer(ctx, client, role)
	}
	logCatalogStateOnce(syncErr)
}

var lastCatalogError = "unset"

// logCatalogStateOnce reports the catalog's state when it changes, not on
// every tick.
func logCatalogStateOnce(err error) {
	message := ""
	if err != nil {
		message = err.Error()
	}
	if message == lastCatalogError {
		return
	}
	lastCatalogError = message
	if err != nil {
		log.Printf("dns: catalog zone sync failed: %v", err)
	} else {
		log.Printf("dns: catalog zone in sync")
	}
}

func startDnsGroupRoleTicker(ctx context.Context) {
	go func() {
		ticker := time.NewTicker(time.Minute)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				tickCtx, cancel := context.WithTimeout(ctx, 45*time.Second)
				pdnsMaintenanceMu.Lock()
				reconcileDnsGroupRole(tickCtx)
				pdnsMaintenanceMu.Unlock()
				cancel()
			}
		}
	}()
}

// zoneFingerprintSkippedTypes are left out of a zone's fingerprint: SOA
// (its serial is compared on its own) and what DNSSEC generates - the
// primary signs on the fly and its API doesn't list signatures, while a
// secondary stores the signed records it received.
var zoneFingerprintSkippedTypes = map[string]bool{
	"SOA": true, "RRSIG": true, "NSEC": true, "NSEC3": true, "NSEC3PARAM": true, "DNSKEY": true, "CDS": true, "CDNSKEY": true,
}

type dnsZoneFingerprint struct {
	Serial      uint64 `json:"serial"`
	Fingerprint string `json:"fingerprint"`
	Records     int    `json:"records"`
}

// zoneFingerprint hashes a zone's content as this server holds it, so
// primary and secondaries can be compared beyond their SOA serial: a
// serial that didn't move hides content that did.
func zoneFingerprint(zone *pdnsZoneDetail) dnsZoneFingerprint {
	lines := []string{}
	for _, rrset := range zone.Rrsets {
		if zoneFingerprintSkippedTypes[rrset.Type] {
			continue
		}
		for _, record := range rrset.Records {
			if record.Disabled {
				continue
			}
			lines = append(lines, fmt.Sprintf("%s %s %d %s", strings.ToLower(rrset.Name), rrset.Type, rrset.TTL, record.Content))
		}
	}
	sort.Strings(lines)
	sum := sha256.Sum256([]byte(strings.Join(lines, "\n")))
	return dnsZoneFingerprint{Serial: zone.Serial, Fingerprint: hex.EncodeToString(sum[:16]), Records: len(lines)}
}

func fetchDnsZoneFingerprint(ctx context.Context, payload map[string]interface{}) (dnsZoneFingerprint, error) {
	zoneName := readString(payload, "zoneName")
	if zoneName == "" {
		return dnsZoneFingerprint{}, errors.New("dns_zone_fingerprint payload must include zoneName")
	}
	apiKey, err := ensurePdnsApiKey()
	if err != nil {
		return dnsZoneFingerprint{}, err
	}
	zone, err := (&pdnsClient{apiKey: apiKey}).getZone(ctx, zoneName+".", true)
	if err != nil {
		return dnsZoneFingerprint{}, err
	}
	if zone == nil {
		return dnsZoneFingerprint{}, fmt.Errorf("zone %s not found on this server", zoneName)
	}
	return zoneFingerprint(zone), nil
}

func handleDnsZoneFingerprintCommand(ctx context.Context, cmd commandPayload, result *commandResult) {
	result.Command = "dns_zone_fingerprint"
	result.ResourceType = "dns_zone_fingerprint"
	result.ResourceID = readString(cmd.Payload, "requestId")
	queryCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	data, err := fetchDnsZoneFingerprint(queryCtx, cmd.Payload)
	if err != nil {
		result.Success = false
		result.Message = err.Error()
		return
	}
	result.Data = data
	result.Message = fmt.Sprintf("%d record(s), serial %d", data.Records, data.Serial)
}

// handleDnsMaintenanceCommand runs the node's PowerDNS maintenance on
// request from the UI: the upgrade (payload "upgrade": true), or a retry
// once the agent gave up on a task. Not tied to the control-plane session:
// an upgrade must not be cut halfway by a reconnect.
func handleDnsMaintenanceCommand(cmd commandPayload, result *commandResult) {
	result.Command = "dns_maintenance"
	result.ResourceType = "dns_maintenance"
	result.ResourceID = envOrDefault("NODE_ID", "agent")
	if _, err := os.Stat(dnsMarkerPath); err != nil {
		result.Success = false
		result.Message = "this node is not a DNS server"
		return
	}
	resetPdnsMaintenance()
	if readBool(cmd.Payload, "upgrade") {
		requestPdnsUpgrade()
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Minute)
	defer cancel()
	runPdnsMaintenance(ctx)
	report := currentDnsServerReport()
	for name, task := range report.Tasks {
		if task.Status == "failed" {
			result.Success = false
			result.Message = fmt.Sprintf("%s: %s", name, task.Error)
			return
		}
	}
	result.Message = fmt.Sprintf("PowerDNS %s on %s", report.PdnsVersion, report.Backend)
}

// dnsServerReport is what a DNS server node tells the control plane about
// its PowerDNS in each heartbeat.
type dnsServerReport struct {
	PdnsVersion string                    `json:"pdnsVersion"`
	Backend     string                    `json:"backend"`
	Catalog     bool                      `json:"catalog"`
	MaxAttempts int                       `json:"maxAttempts"`
	Tasks       map[string]pdnsTaskReport `json:"tasks,omitempty"`
}

type pdnsTaskReport struct {
	Status    string `json:"status"`
	Attempts  int    `json:"attempts"`
	Error     string `json:"error,omitempty"`
	UpdatedAt string `json:"updatedAt"`
}

func currentDnsServerReport() *dnsServerReport {
	if _, err := os.Stat(dnsMarkerPath); err != nil {
		return nil
	}
	report := &dnsServerReport{
		PdnsVersion: pdnsInstalledVersion(),
		Backend:     readPdnsBackend(),
		Catalog:     pdnsSupportsCatalog(),
		MaxAttempts: pdnsMaintenanceMaxAttempts,
		Tasks:       map[string]pdnsTaskReport{},
	}
	for name, task := range loadPdnsMaintenance() {
		report.Tasks[name] = pdnsTaskReport{Status: task.Status, Attempts: task.Attempts, Error: task.Error, UpdatedAt: task.UpdatedAt}
	}
	return report
}
