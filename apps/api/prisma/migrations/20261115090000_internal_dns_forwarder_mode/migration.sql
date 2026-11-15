-- How each node resolves *.tarmac.local, and why its last attempt failed.
ALTER TABLE "Node" ADD COLUMN "internalDnsForwarderMode" TEXT;
ALTER TABLE "Node" ADD COLUMN "internalDnsForwarderError" TEXT;
