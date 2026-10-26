-- Agent message of the last failed internal DNS install, shown on the Nodes page.
ALTER TABLE "Workspace" ADD COLUMN "internalDnsError" TEXT;
