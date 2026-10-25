import Link from 'next/link';
import { Eye, KeyRound, ListChecks, Pencil, ShieldCheck, SlidersHorizontal, Sparkles, Terminal } from 'lucide-react';
import { PageHeader } from '../../../components/PageHeader';
import { Callout } from '../../../components/Callout';
import { SectionLabel } from '../../../components/SectionLabel';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../components/ui/table';
import { ApiPermissionsTable } from '../../../components/docs/ApiPermissionsTable';

const STEPS = [
  {
    icon: KeyRound,
    title: 'Créez la clé',
    text: 'Administration → Clés API → « Nouvelle clé ». Donnez-lui le nom de l’outil qui l’utilisera et une durée de vie.',
  },
  {
    icon: SlidersHorizontal,
    title: 'Choisissez ses permissions',
    text: 'Accès complet, lecture seule, ou module par module : aucun accès, lecture, ou lecture et écriture.',
  },
  {
    icon: Terminal,
    title: 'Appelez l’API',
    text: 'Copiez le jeton tmk_… affiché une seule fois et passez-le dans l’en-tête Authorization: Bearer.',
  },
];

const PRESETS = [
  {
    icon: Sparkles,
    title: 'Accès complet',
    text: 'Lecture et écriture sur tous les modules : pour un outil d’automatisation de confiance (Terraform, Ansible, scripts d’exploitation).',
  },
  {
    icon: Eye,
    title: 'Lecture seule',
    text: 'Tout consulter sans rien pouvoir changer : tableaux de bord externes (Grafana), inventaire, supervision.',
  },
  {
    icon: SlidersHorizontal,
    title: 'Personnalisé',
    text: 'Le strict nécessaire, module par module. Exemple : DNS en écriture pour un client ACME, et rien d’autre.',
  },
];

const LIFECYCLE: { action: string; effect: string }[] = [
  {
    action: 'Modifier',
    effect:
      'Nom, permissions et expiration changent sans toucher au secret : vos intégrations continuent de fonctionner, et une permission retirée est refusée dès l’appel suivant.',
  },
  { action: 'Révoquer', effect: 'La clé est refusée immédiatement mais reste listée, pour l’historique.' },
  { action: 'Supprimer', effect: 'La clé disparaît de la liste. Le journal d’actions garde la trace de ce qu’elle a fait.' },
  { action: 'Expirer', effect: 'Passée la date choisie, la clé est refusée comme une clé révoquée. Une expiration se repousse en la modifiant.' },
];

const ERRORS: { code: string; when: string }[] = [
  { code: '401', when: 'Clé malformée, inconnue, révoquée ou expirée.' },
  { code: '403', when: 'La clé n’a pas la permission demandée par la route (le message la nomme, ex. « dns:write »).' },
  { code: '403', when: 'Route réservée à une session (comptes, workspaces, clés API), ou X-Workspace-Id d’un autre workspace.' },
];

const BASE = 'https://votre-api/api/v1';

export default function ApiKeysDocsPage() {
  return (
    <div className="space-y-12">
      <PageHeader
        title="Clés API &amp; automatisation"
        description="Pilotez Tarmac depuis vos scripts et vos outils : chaque clé est rattachée à un workspace et ne peut faire que ce que vous lui avez permis."
      />

      <Callout>
        Les clés se gèrent dans <strong>Administration → Clés API</strong>, par les gérants du workspace (propriétaires
        et administrateurs de la plateforme). Chaque route de la{' '}
        <Link href="/docs/api" className="underline underline-offset-2">
          référence API
        </Link>{' '}
        indique la permission qu&apos;elle demande.
      </Callout>

      <section className="space-y-4">
        <SectionLabel>En trois étapes</SectionLabel>
        <div className="grid gap-4 sm:grid-cols-3">
          {STEPS.map((step, index) => (
            <Card key={step.title} className="h-full">
              <CardHeader className="flex-col items-start justify-start gap-y-1 border-b-0">
                <div className="flex items-center gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-violet-600/15 text-xs font-semibold text-primary">
                    {index + 1}
                  </span>
                  <step.icon className="h-4 w-4 text-muted-foreground" />
                </div>
                <CardTitle className="pt-3 text-base">{step.title}</CardTitle>
                <CardDescription>{step.text}</CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>
      </section>

      <section className="space-y-4">
        <SectionLabel>Choisir les permissions</SectionLabel>
        <p className="text-sm text-muted-foreground">
          Trois raccourcis couvrent la plupart des besoins ; le mode personnalisé règle chaque module séparément. Toucher
          une ligne après avoir choisi un raccourci passe simplement en « Personnalisé ».
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          {PRESETS.map((preset) => (
            <div key={preset.title} className="panel flex items-start gap-3 p-4">
              <preset.icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <div>
                <p className="text-sm font-medium text-foreground">{preset.title}</p>
                <p className="text-sm text-muted-foreground">{preset.text}</p>
              </div>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <Eye className="h-3.5 w-3.5" /> Lecture : toutes les routes GET du module
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Pencil className="h-3.5 w-3.5" /> Écriture : création, modification, suppression et actions (inclut la lecture)
          </span>
        </div>
        <ApiPermissionsTable />
      </section>

      <section className="space-y-4">
        <SectionLabel>Utiliser la clé</SectionLabel>
        <Card>
          <CardContent className="space-y-3 pt-5">
            <p className="text-sm text-muted-foreground">
              Pas besoin d&apos;en-tête <code>X-Workspace-Id</code> : la clé agit toujours sur son propre workspace.
            </p>
            <pre className="code-block">
{`# Lister les nœuds (nodes:read)
curl -s ${BASE}/nodes \\
  -H "Authorization: Bearer $TARMAC_API_KEY"

# Ajouter un enregistrement DNS (dns:write)
curl -s -X POST ${BASE}/dns/zones/<ID_ZONE>/records \\
  -H "Authorization: Bearer $TARMAC_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"name":"www","type":"A","ttl":300,"values":[{"content":"203.0.113.10"}]}'

# Faire sortir un profil VPN par un autre serveur, à chaud (vpn:write)
curl -s -X POST ${BASE}/vpn/profiles/<ID_PROFIL>/exit \\
  -H "Authorization: Bearer $TARMAC_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"exitNodeId":"<ID_NOEUD_SORTIE>"}'`}
            </pre>
          </CardContent>
        </Card>
      </section>

      <section className="space-y-4">
        <SectionLabel>Cycle de vie</SectionLabel>
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-32">Action</TableHead>
                <TableHead>Effet</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {LIFECYCLE.map((row) => (
                <TableRow key={row.action}>
                  <TableCell className="font-medium text-foreground">{row.action}</TableCell>
                  <TableCell className="text-muted-foreground">{row.effect}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      </section>

      <section className="space-y-4">
        <SectionLabel>Sécurité</SectionLabel>
        <div className="grid gap-3 sm:grid-cols-2">
          {[
            { icon: ShieldCheck, text: 'Tarmac ne stocke qu’une empreinte du secret : une clé perdue ne se récupère pas, elle se remplace.' },
            { icon: KeyRound, text: 'Une clé ne peut jamais créer, modifier ou élargir une clé : ces actions demandent une session.' },
            { icon: ListChecks, text: 'Chaque modification faite avec une clé apparaît dans le Journal avec le nom de la clé.' },
            { icon: Terminal, text: 'Une clé peut mettre à jour un agent depuis son dépôt configuré, jamais depuis un autre dépôt.' },
          ].map((item) => (
            <div key={item.text} className="panel flex items-start gap-3 p-4">
              <item.icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">{item.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-4">
        <SectionLabel>Erreurs</SectionLabel>
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-24">Code</TableHead>
                <TableHead>Quand</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ERRORS.map((row) => (
                <TableRow key={row.when}>
                  <TableCell className="font-mono text-foreground">{row.code}</TableCell>
                  <TableCell className="text-muted-foreground">{row.when}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      </section>
    </div>
  );
}
