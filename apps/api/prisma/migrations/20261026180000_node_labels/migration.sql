-- Node labels, previously kept in each browser's localStorage.
ALTER TABLE "Node" ADD COLUMN "labels" TEXT[] DEFAULT ARRAY[]::TEXT[];
