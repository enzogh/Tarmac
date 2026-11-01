-- Ban from SSH addresses that keep failing to log in, longer on every repeat offence.
ALTER TABLE "Workspace" ADD COLUMN "firewallSshBan" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Workspace" ADD COLUMN "firewallSshBanAttempts" INTEGER NOT NULL DEFAULT 5;
ALTER TABLE "Workspace" ADD COLUMN "firewallSshBanMinutes" INTEGER NOT NULL DEFAULT 10;
ALTER TABLE "Workspace" ADD COLUMN "firewallSshBanEscalate" BOOLEAN NOT NULL DEFAULT true;

-- Ban from the whole server addresses spamming rpcbind over TCP.
ALTER TABLE "Workspace" ADD COLUMN "firewallRpcBan" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Workspace" ADD COLUMN "firewallRpcBanAttempts" INTEGER NOT NULL DEFAULT 10;
