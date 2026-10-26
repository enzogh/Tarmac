import { API_KEY_SCOPES, normalizeScopes } from '../api-keys/api-key-token';

// The role names people see (same as the web app's ROLE_INFO): "owner" rows
// are administrators, members are named after their permissions or after
// the custom role they follow.
export function memberRoleLabel(role: string, permissions: readonly string[], customRoleName?: string | null): string {
  if (role === 'owner') return 'Administrateur';
  if (customRoleName) return customRoleName;
  const scopes = normalizeScopes(permissions);
  if (scopes.length === API_KEY_SCOPES.length) return 'Éditeur';
  const reads = API_KEY_SCOPES.filter((scope) => scope.endsWith(':read'));
  if (scopes.length === reads.length && scopes.every((scope) => scope.endsWith(':read'))) return 'Lecteur';
  return 'Personnalisé';
}

export function memberRoleDescription(label: string): string {
  switch (label) {
    case 'Administrateur':
      return 'Accès complet, plus la gestion du workspace : membres, rôles, clés API et paramètres.';
    case 'Éditeur':
      return 'Consulte et modifie toutes les pages, sans gérer le workspace ni ses membres.';
    case 'Lecteur':
      return 'Consulte toutes les pages, sans rien modifier.';
    default:
      return 'Un accès choisi page par page par les administrateurs du workspace.';
  }
}
