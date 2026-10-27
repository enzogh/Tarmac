-- AlterTable
ALTER TABLE "DnsZone" ADD COLUMN "syncCheckedAt" TIMESTAMP(3),
ADD COLUMN "syncDetail" JSONB;
