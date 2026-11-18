-- CreateTable
CREATE TABLE "LinkCapture" (
    "id" TEXT NOT NULL,
    "vlanId" TEXT NOT NULL,
    "nodeAId" TEXT NOT NULL,
    "nodeBId" TEXT NOT NULL,
    "triggerSourceId" TEXT NOT NULL,
    "triggerStatus" TEXT NOT NULL,
    "triggerLoss" DOUBLE PRECISION,
    "triggerLatency" DOUBLE PRECISION,
    "aToB" JSONB NOT NULL,
    "bToA" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LinkCapture_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LinkCapture_vlanId_nodeAId_nodeBId_createdAt_idx" ON "LinkCapture"("vlanId", "nodeAId", "nodeBId", "createdAt");

-- CreateIndex
CREATE INDEX "LinkCapture_createdAt_idx" ON "LinkCapture"("createdAt");

-- AddForeignKey
ALTER TABLE "LinkCapture" ADD CONSTRAINT "LinkCapture_vlanId_fkey" FOREIGN KEY ("vlanId") REFERENCES "Vlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
