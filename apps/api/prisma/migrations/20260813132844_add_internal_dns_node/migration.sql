-- AlterTable
ALTER TABLE "Node" ADD COLUMN     "dnsHostname" TEXT;

-- AlterTable
ALTER TABLE "Workspace" ADD COLUMN     "internalDnsNodeId" TEXT;

-- AddForeignKey
ALTER TABLE "Workspace" ADD CONSTRAINT "Workspace_internalDnsNodeId_fkey" FOREIGN KEY ("internalDnsNodeId") REFERENCES "Node"("id") ON DELETE SET NULL ON UPDATE CASCADE;
