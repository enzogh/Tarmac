'use client';

import { useParams } from 'next/navigation';
import { api, type ApiKeyResource, type ApiKeyScope } from './api';
import { maxLevel, RESOURCE_BY_ID, type AccessLevel } from './api-key-permissions';
import { usePolling } from './hooks/usePolling';

/**
 * What a page needs to be reachable. `manage` pages belong to workspace
 * administrators (owners and platform admins); everything else maps to the
 * permission area its API lives behind, so the nav and the API agree.
 */
export type PageArea = ApiKeyResource | 'manage';

const AREA_BY_SEGMENT: Record<string, PageArea> = {
  infrastructure: 'nodes',
  network: 'network',
  dns: 'dns',
  vpn: 'vpn',
  storage: 'storage',
  mounts: 'storage',
  replication: 'storage',
  migrations: 'storage',
  alerts: 'alerts',
  logs: 'logs',
  'api-keys': 'manage',
};

/** The area of a dashboard path (/<slug>/dashboard/<segment>/...), if any. */
export function areaOfPath(pathname: string): PageArea | null {
  const segment = pathname.split('/')[3];
  return segment ? (AREA_BY_SEGMENT[segment] ?? null) : null;
}

export function levelFromScopes(scopes: readonly ApiKeyScope[] | undefined, resource: ApiKeyResource): AccessLevel {
  if (!scopes) return 'none';
  if (scopes.includes(`${resource}:write`)) return 'write';
  if (scopes.includes(`${resource}:read`)) return 'read';
  return 'none';
}

/** Read-only that the member could be granted more of (the journal is read-only for everyone). */
export function isRestrictedToRead(area: PageArea, level: AccessLevel): boolean {
  return area !== 'manage' && level === 'read' && maxLevel(RESOURCE_BY_ID[area]) === 'write';
}

export type WorkspaceAccess = {
  ready: boolean;
  isManager: boolean;
  /** 'write' for a manage area means "administrator". */
  level: (area: PageArea) => AccessLevel;
};

// Shares the 'workspaces' SWR entry with the switcher and settings page.
export function useWorkspaceAccess(enabled = true): WorkspaceAccess {
  const params = useParams<{ workspace?: string }>();
  const { data: workspaces } = usePolling(enabled && params.workspace ? 'workspaces' : null, api.workspaces.list, {
    intervalMs: 30000,
    redirectOnError: false,
  });
  const workspace = workspaces?.find((item) => item.slug === params.workspace || item.id === params.workspace);
  if (!workspace) {
    // Unknown yet: let everything through rather than flash restrictions.
    return { ready: false, isManager: false, level: () => 'write' };
  }
  const isManager = workspace.myRole === 'owner';
  return {
    ready: true,
    isManager,
    level: (area) => (area === 'manage' ? (isManager ? 'write' : 'none') : levelFromScopes(workspace.myPermissions, area)),
  };
}
