// Fixed id of the "Default" workspace created by the add_workspace migration
// backfill (apps/api/prisma/migrations/*_add_workspace/migration.sql). Every
// create() call in the codebase stamps this until Phase 1 wires up
// WorkspaceGuard/@CurrentWorkspace() and callers pass a real caller-scoped
// workspace id instead.
export const DEFAULT_WORKSPACE_ID = 'default-workspace';
