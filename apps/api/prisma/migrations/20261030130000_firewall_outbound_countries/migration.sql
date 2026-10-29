-- Outbound filtering per node, and country sources for rules.
ALTER TABLE "Node" ADD COLUMN "firewallOutboundMode" TEXT NOT NULL DEFAULT 'open';
ALTER TABLE "FirewallRule" ADD COLUMN "sourceCountries" TEXT[] DEFAULT ARRAY[]::TEXT[];
