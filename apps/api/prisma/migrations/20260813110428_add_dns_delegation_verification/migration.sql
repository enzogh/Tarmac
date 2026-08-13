-- AlterTable
ALTER TABLE "DnsZone" ADD COLUMN     "delegationCheckedAt" TIMESTAMP(3),
ADD COLUMN     "delegationDetail" JSONB,
ADD COLUMN     "delegationVerified" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "DnsZone_status_delegationVerified_idx" ON "DnsZone"("status", "delegationVerified");
