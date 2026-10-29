-- "Before" state of undoable changes, and when it was put back.
ALTER TABLE "AuditLog" ADD COLUMN "snapshot" JSONB,
ADD COLUMN "restoredAt" TIMESTAMP(3);
