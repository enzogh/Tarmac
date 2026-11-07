-- Alerts tied to a condition that can clear on its own (a node, a link...)
-- carry its key and get closed automatically once it has.
ALTER TABLE "Alert" ADD COLUMN "fingerprint" TEXT;
ALTER TABLE "Alert" ADD COLUMN "autoResolved" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "Alert_fingerprint_status_idx" ON "Alert"("fingerprint", "status");

-- Alerts raised before this migration have no key, so the supervisor will
-- never look at them: close the connectivity ones whose node is back right
-- now (the API is only being restarted, so Node.status/lastSeenAt are live).
WITH back AS (
  SELECT n."id"
  FROM "Node" n
  WHERE n."status" <> 'offline'
    AND n."lastSeenAt" > now() - interval '2 minutes'
    AND NOT EXISTS (
      SELECT 1 FROM "VlanConnection" c
      WHERE c."status" = 'offline' AND (c."sourceNodeId" = n."id" OR c."targetNodeId" = n."id")
    )
)
UPDATE "Alert" a
SET "status" = 'resolved', "resolvedAt" = now(), "autoResolved" = true
WHERE a."status" <> 'resolved'
  AND a."nodeId" IN (SELECT "id" FROM back)
  AND (
    a."message" LIKE 'Lien VLAN hors ligne : %'
    OR a."message" LIKE 'Passerelle % injoignable : %'
    OR a."message" LIKE 'Montage "%" bloqué en attente : %'
  );

-- "Passerelle X de retour" was a recovery notice filed as an open alert:
-- it now closes the failover alert instead of opening one of its own.
UPDATE "Alert"
SET "status" = 'resolved', "resolvedAt" = now(), "autoResolved" = true
WHERE "status" <> 'resolved' AND "message" LIKE 'Passerelle % de retour : %';
