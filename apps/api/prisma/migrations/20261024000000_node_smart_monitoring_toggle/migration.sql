-- Per-node opt-out for SMART monitoring (see Node.smartMonitoringEnabled).
-- Defaults to true so every existing node keeps its current behaviour.
-- AlterTable
ALTER TABLE "Node" ADD COLUMN "smartMonitoringEnabled" BOOLEAN NOT NULL DEFAULT true;
