// Shared by WorkspacesService (workspace slugs) and InternalDnsService
// (default <hostname>.tarmac.local labels derived from a node's name).
export function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
