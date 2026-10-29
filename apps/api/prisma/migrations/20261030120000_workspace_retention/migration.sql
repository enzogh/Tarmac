-- How long the firewall Activity and the agents' logs are kept, per workspace.
ALTER TABLE "Workspace" ADD COLUMN "firewallEventRetentionDays" INTEGER NOT NULL DEFAULT 14,
ADD COLUMN "agentLogRetentionDays" INTEGER NOT NULL DEFAULT 14;
