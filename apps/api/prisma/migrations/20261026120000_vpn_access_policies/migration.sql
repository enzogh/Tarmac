-- CreateEnum
CREATE TYPE "VpnAccessScope" AS ENUM ('all', 'selected', 'none');

-- AlterTable
-- Existing profiles keep their access to the whole private network; client
-- to client traffic becomes opt-in (it used to be implicitly open between
-- clients of the same entry node).
ALTER TABLE "VpnProfile" ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "meshAccess" "VpnAccessScope" NOT NULL DEFAULT 'all',
ADD COLUMN     "meshNodeIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "peerAccess" "VpnAccessScope" NOT NULL DEFAULT 'none',
ADD COLUMN     "peerProfileIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
