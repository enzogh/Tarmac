-- Slugs a workspace had before being renamed, kept as redirect aliases.
ALTER TABLE "Workspace" ADD COLUMN "previousSlugs" TEXT[] DEFAULT ARRAY[]::TEXT[];
