-- Alert emails: per-user internal address + opt-out, and a per-alert marker
-- for the digest sender (see AlertDigestService).
-- AlterTable
ALTER TABLE "User" ADD COLUMN "internalEmail" TEXT,
ADD COLUMN "alertEmailsEnabled" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "Alert" ADD COLUMN "emailNotifiedAt" TIMESTAMP(3);

-- Every alert that exists before this migration counts as already notified,
-- otherwise the first digest after deploy would mail out the whole history.
UPDATE "Alert" SET "emailNotifiedAt" = "createdAt";

-- CreateIndex
CREATE INDEX "Alert_emailNotifiedAt_idx" ON "Alert"("emailNotifiedAt");
