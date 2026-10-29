-- Throttle new SSH connections from the internet (per source address).
ALTER TABLE "Workspace" ADD COLUMN "firewallSshLimit" BOOLEAN NOT NULL DEFAULT true;
