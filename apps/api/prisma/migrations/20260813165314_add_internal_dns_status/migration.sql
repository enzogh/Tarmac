-- AlterTable
ALTER TABLE "Node" ADD COLUMN     "internalDnsForwarderConflict" JSONB,
ADD COLUMN     "internalDnsForwarderStatus" TEXT;

-- AlterTable
ALTER TABLE "Workspace" ADD COLUMN     "internalDnsStatus" "DnsServerGroupMemberStatus" NOT NULL DEFAULT 'pending';
