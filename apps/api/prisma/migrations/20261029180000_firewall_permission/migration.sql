-- The firewall gets its own permission area. Whoever reached it through
-- "network" until now keeps the same level on "firewall".
UPDATE "WorkspaceMembership" SET "permissions" = array_append("permissions", 'firewall:read')
  WHERE ('network:read' = ANY("permissions") OR 'network:write' = ANY("permissions")) AND NOT ('firewall:read' = ANY("permissions"));
UPDATE "WorkspaceMembership" SET "permissions" = array_append("permissions", 'firewall:write')
  WHERE 'network:write' = ANY("permissions") AND NOT ('firewall:write' = ANY("permissions"));
UPDATE "WorkspaceCustomRole" SET "permissions" = array_append("permissions", 'firewall:read')
  WHERE ('network:read' = ANY("permissions") OR 'network:write' = ANY("permissions")) AND NOT ('firewall:read' = ANY("permissions"));
UPDATE "WorkspaceCustomRole" SET "permissions" = array_append("permissions", 'firewall:write')
  WHERE 'network:write' = ANY("permissions") AND NOT ('firewall:write' = ANY("permissions"));
UPDATE "WorkspaceInvitation" SET "permissions" = array_append("permissions", 'firewall:read')
  WHERE ('network:read' = ANY("permissions") OR 'network:write' = ANY("permissions")) AND NOT ('firewall:read' = ANY("permissions"));
UPDATE "WorkspaceInvitation" SET "permissions" = array_append("permissions", 'firewall:write')
  WHERE 'network:write' = ANY("permissions") AND NOT ('firewall:write' = ANY("permissions"));
UPDATE "ApiKey" SET "scopes" = array_append("scopes", 'firewall:read')
  WHERE ('network:read' = ANY("scopes") OR 'network:write' = ANY("scopes")) AND NOT ('firewall:read' = ANY("scopes"));
UPDATE "ApiKey" SET "scopes" = array_append("scopes", 'firewall:write')
  WHERE 'network:write' = ANY("scopes") AND NOT ('firewall:write' = ANY("scopes"));

-- New members get every area by default, firewall included.
ALTER TABLE "WorkspaceMembership" ALTER COLUMN "permissions" SET DEFAULT ARRAY['nodes:read', 'nodes:write', 'storage:read', 'storage:write', 'network:read', 'network:write', 'firewall:read', 'firewall:write', 'dns:read', 'dns:write', 'vpn:read', 'vpn:write', 'alerts:read', 'alerts:write', 'logs:read']::TEXT[];
