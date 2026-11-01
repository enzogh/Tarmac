-- Keep rpcbind (port 111) reachable from the private mesh only.
ALTER TABLE "Workspace" ADD COLUMN "firewallRpcGuard" BOOLEAN NOT NULL DEFAULT true;
