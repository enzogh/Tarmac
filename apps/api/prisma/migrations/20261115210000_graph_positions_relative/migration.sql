-- The private-network graph is now packed by region/country/city, and
-- graphX/graphY hold a dragged node's offset from its packed spot rather
-- than an absolute point of the old fixed 1320x760 layout. Old values mean
-- nothing in the new layout (they would fling nodes out of their parcels):
-- every node starts again from its packed position.
UPDATE "Node" SET "graphX" = NULL, "graphY" = NULL WHERE "graphX" IS NOT NULL OR "graphY" IS NOT NULL;
