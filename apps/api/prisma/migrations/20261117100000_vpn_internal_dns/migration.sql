-- Internal DNS names for VPN clients (<hostname>.<zone>).
ALTER TABLE "Workspace" ADD COLUMN "vpnDnsZone" TEXT NOT NULL DEFAULT 'intranet.internal';

-- Existing profiles get their hostname from VpnService at startup (same
-- derivation from the name as new ones).
ALTER TABLE "VpnProfile" ADD COLUMN "hostname" TEXT;
ALTER TABLE "VpnProfile" ADD COLUMN "useInternalDns" BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX "VpnProfile_workspaceId_hostname_key" ON "VpnProfile"("workspaceId", "hostname");
