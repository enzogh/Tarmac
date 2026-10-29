-- Logged-out sessions, refused until their natural expiry.
CREATE TABLE "RevokedSession" (
    "jti" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RevokedSession_pkey" PRIMARY KEY ("jti")
);

CREATE INDEX "RevokedSession_expiresAt_idx" ON "RevokedSession"("expiresAt");

-- Alerts and the journal are listed per workspace, newest first: one
-- composite index serves both the filter and the sort (and replaces the
-- workspace-only one).
DROP INDEX "Alert_workspaceId_idx";
CREATE INDEX "Alert_workspaceId_triggeredAt_idx" ON "Alert"("workspaceId", "triggeredAt");

DROP INDEX "AuditLog_workspaceId_idx";
CREATE INDEX "AuditLog_workspaceId_createdAt_idx" ON "AuditLog"("workspaceId", "createdAt");
