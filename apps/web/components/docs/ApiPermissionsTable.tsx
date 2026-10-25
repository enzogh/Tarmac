import { Card } from '../ui/card';
import { API_KEY_RESOURCES } from '../../lib/api-key-permissions';

// Anchor id of an API reference module — accent-insensitive so "Nœuds"
// doesn't end up as a percent-encoded href.
export function moduleAnchor(name: string) {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

/** What each API key permission opens, for the docs. */
export function ApiPermissionsTable({ linkModules = false }: { linkModules?: boolean }) {
  const moduleHref = (module: string) => (linkModules ? `#${moduleAnchor(module)}` : `/docs/api#${moduleAnchor(module)}`);
  return (
    <Card className="overflow-hidden">
      <div className="scroll-thin overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-2xs uppercase tracking-wider text-muted-foreground">
              <th className="px-4 py-2 font-medium">Module</th>
              <th className="px-4 py-2 font-medium">Lecture</th>
              <th className="px-4 py-2 font-medium">Écriture (inclut la lecture)</th>
            </tr>
          </thead>
          <tbody>
            {API_KEY_RESOURCES.map((resource) => (
              <tr key={resource.id} className="border-b border-border align-top last:border-0">
                <td className="px-4 py-3">
                  <span className="flex items-center gap-2 font-medium text-foreground">
                    <resource.icon className="h-4 w-4 text-primary" />
                    {resource.label}
                  </span>
                  <span className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 pl-6 text-2xs">
                    {resource.modules.map((module) => (
                      <a key={module} href={moduleHref(module)} className="text-muted-foreground hover:text-primary">
                        {module}
                      </a>
                    ))}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs text-muted-foreground">
                  <code className="mb-1 block font-mono text-2xs text-foreground/80">{resource.id}:read</code>
                  {resource.read}
                </td>
                <td className="px-4 py-3 text-xs text-muted-foreground">
                  {resource.write ? (
                    <>
                      <code className="mb-1 block font-mono text-2xs text-foreground/80">{resource.id}:write</code>
                      {resource.write}
                    </>
                  ) : (
                    <span className="italic">Lecture seule</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="border-t border-border px-4 py-2.5 text-xs text-muted-foreground">
        Toujours réservés à une session : Authentification, Workspaces et Clés API — une clé ne peut ni gérer des
        comptes ou des membres, ni modifier ses propres permissions.
      </p>
    </Card>
  );
}
