-- Alerts raised by background work used to be filed under the default
-- workspace whatever the node they were about, and workspace-wide alert
-- rules fired on every node of the platform.

-- A rule's alert on another workspace's node should never have existed.
DELETE FROM "Alert" a
USING "AlertRule" r, "Node" n
WHERE a."ruleId" = r."id" AND a."nodeId" = n."id" AND r."workspaceId" <> n."workspaceId";

-- Everything else goes back to the workspace of its node.
UPDATE "Alert" a
SET "workspaceId" = n."workspaceId"
FROM "Node" n
WHERE a."nodeId" = n."id" AND a."workspaceId" <> n."workspaceId";
