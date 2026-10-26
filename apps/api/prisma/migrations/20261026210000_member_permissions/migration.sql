-- Per-area access for workspace members (owners keep full access). Existing
-- and SSO-granted memberships keep the full access they had until now.
ALTER TABLE "WorkspaceMembership" ADD COLUMN "permissions" TEXT[] DEFAULT ARRAY['nodes:read', 'nodes:write', 'storage:read', 'storage:write', 'network:read', 'network:write', 'dns:read', 'dns:write', 'vpn:read', 'vpn:write', 'alerts:read', 'alerts:write', 'logs:read']::TEXT[];
