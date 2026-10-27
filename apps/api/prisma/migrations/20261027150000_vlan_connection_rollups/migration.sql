-- CreateTable
CREATE TABLE "VlanConnectionRollup" (
    "id" TEXT NOT NULL,
    "vlanId" TEXT NOT NULL,
    "sourceNodeId" TEXT NOT NULL,
    "targetNodeId" TEXT NOT NULL,
    "bucketStart" TIMESTAMP(3) NOT NULL,
    "sampleCount" INTEGER NOT NULL,
    "healthyCount" INTEGER NOT NULL,
    "worstStatus" "VlanConnectionStatus" NOT NULL,
    "latencyMs" DOUBLE PRECISION,
    "packetLoss" DOUBLE PRECISION,
    "bandwidth" DOUBLE PRECISION,

    CONSTRAINT "VlanConnectionRollup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VlanConnectionRollup_vlanId_sourceNodeId_targetNodeId_bucketStart_key" ON "VlanConnectionRollup"("vlanId", "sourceNodeId", "targetNodeId", "bucketStart");

-- CreateIndex
CREATE INDEX "VlanConnectionRollup_bucketStart_idx" ON "VlanConnectionRollup"("bucketStart");

-- AddForeignKey
ALTER TABLE "VlanConnectionRollup" ADD CONSTRAINT "VlanConnectionRollup_vlanId_fkey" FOREIGN KEY ("vlanId") REFERENCES "Vlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill every completed hour already sampled, so the raw samples can be
-- pruned down to 48 h without losing the 7-day history.
INSERT INTO "VlanConnectionRollup" ("id", "vlanId", "sourceNodeId", "targetNodeId", "bucketStart", "sampleCount", "healthyCount", "worstStatus", "latencyMs", "packetLoss", "bandwidth")
SELECT
    gen_random_uuid()::text,
    "vlanId",
    LEAST("sourceNodeId", "targetNodeId"),
    GREATEST("sourceNodeId", "targetNodeId"),
    date_trunc('hour', "createdAt"),
    count(*)::int,
    (count(*) FILTER (WHERE "status" = 'healthy'))::int,
    (ARRAY['healthy', 'unknown', 'degraded', 'offline'])[max(CASE "status" WHEN 'healthy' THEN 1 WHEN 'unknown' THEN 2 WHEN 'degraded' THEN 3 ELSE 4 END)]::"VlanConnectionStatus",
    avg("latencyMs"),
    avg("packetLoss"),
    avg("bandwidth")
FROM "VlanConnectionSample"
WHERE "createdAt" < date_trunc('hour', now() AT TIME ZONE 'UTC')
GROUP BY 2, 3, 4, 5;
