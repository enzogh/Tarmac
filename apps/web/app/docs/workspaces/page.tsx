import Link from 'next/link';
import { LayoutGrid, KeyRound, Users, ShieldAlert, Network } from 'lucide-react';
import { PageHeader } from '../../../components/PageHeader';
import { Callout } from '../../../components/Callout';
import { SectionLabel } from '../../../components/SectionLabel';
import { AnimatedGradientText } from '../../../components/ui/animated-gradient-text';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../../components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../components/ui/table';
import { Diagram, DBox, DFrame, DLink, DNote } from '../../../components/docs/Diagram';

const ROLES: { role: string; scope: string; can: string }[] = [
  {
    role: 'Lecteur',
    scope: 'Un workspace',
    can: 'Voit toutes les pages et leurs données, sans pouvoir rien modifier. Idéal pour un client, un auditeur ou une astreinte.',
  },
  {
    role: 'Éditeur',
    scope: 'Un workspace',
    can: 'Consulte et modifie tout : nœuds, stockage, réseau privé, DNS, VPN, alertes. Ne gère ni le workspace ni ses membres.',
  },
  {
    role: 'Personnalisé',
    scope: 'Un workspace',
    can: 'Aucun accès, lecture ou modification, choisi page par page (par exemple : DNS en modification, le reste en lecture). Une page sans accès disparaît du menu.',
  },
  {
    role: 'Administrateur',
    scope: 'Un workspace',
    can: 'Tout, plus : renommer le workspace, gérer ses membres et leurs rôles, ses clés API, le rattacher à un groupe SSO, et le supprimer une fois vidé.',
  },
  {
    role: 'Administrateur de plateforme',
    scope: 'Toute l’installation',
    can: 'Peut basculer dans n’importe quel workspace, en créer de nouveaux et rattacher n’importe quel compte à l’un d’eux.',
  },
];

export default function WorkspacesDocsPage() {
  return (
    <div className="space-y-12">
      <PageHeader
        title="Workspaces &amp; accès"
        description="Plusieurs flottes indépendantes dans une même installation Tarmac : chacune avec ses serveurs, son réseau privé, ses zones DNS et ses membres."
      />

      <Callout>
        Le workspace actif se choisit en haut de la barre latérale, et se lit dans l&apos;adresse du tableau de bord :
        l&apos;URL commence par son identifiant. Chaque écran ne montre que les ressources du workspace courant — il
        n&apos;existe aucune vue « toutes flottes confondues ».
      </Callout>

      <section className="space-y-4">
        <SectionLabel>Isolation</SectionLabel>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Ce que « cloisonné » veut dire concrètement</CardTitle>
            <CardDescription>
              La séparation n&apos;est pas seulement un filtre d&apos;affichage : chaque workspace reçoit son propre
              sous-réseau privé à sa création, et les serveurs de deux workspaces ne se voient donc littéralement pas
              sur le réseau, même s&apos;ils sont hébergés côte à côte.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Diagram
              viewBox="0 0 700 280"
              label="Schéma de l'isolation : deux workspaces partagent le même control plane mais disposent chacun de leur sous-réseau privé, de leurs nœuds et de leurs zones DNS, sans communication entre eux"
            >
              <DBox x={252} y={12} w={196} h={54} title="Control plane" sub="une seule installation" tone="accent" glow />

              <DFrame x={14} y={92} w={318} h={176} label="Workspace « production »" />
              <DBox x={36} y={124} w={132} h={54} title="Nœud A" sub="10.16.0.1" />
              <DBox x={182} y={124} w={132} h={54} title="Nœud B" sub="10.16.0.2" />
              <DBox x={36} y={196} w={278} h={54} title="Zones DNS, partages, alertes" sub="visibles ici uniquement" />

              <DFrame x={368} y={92} w={318} h={176} label="Workspace « labo »" />
              <DBox x={390} y={124} w={132} h={54} title="Nœud C" sub="10.17.0.1" />
              <DBox x={536} y={124} w={132} h={54} title="Nœud D" sub="10.17.0.2" />
              <DBox x={390} y={196} w={278} h={54} title="Zones DNS, partages, alertes" sub="visibles ici uniquement" />

              <DLink x1={300} y1={70} x2={190} y2={88} />
              <DLink x1={400} y1={70} x2={510} y2={88} />

              <line x1={350} y1={104} x2={350} y2={256} stroke="rgb(244 63 94 / 0.35)" strokeWidth="2" strokeDasharray="5 6" />
              <DNote x={350} y={278} tone="danger">aucun trafic entre les deux réseaux</DNote>
            </Diagram>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Network className="h-4 w-4 text-muted-foreground" />
                Un sous-réseau par workspace
              </CardTitle>
              <CardDescription>
                Le réseau privé est provisionné dès la création du workspace, avant même le premier serveur, et sa
                plage lui reste réservée. Les workspaces créés depuis l&apos;interface se partagent seize plages
                distinctes ; le workspace initial conserve la sienne d&apos;origine pour que les adresses déjà
                attribuées ne bougent jamais.
              </CardDescription>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <ShieldAlert className="h-4 w-4 text-muted-foreground" />
                Suppression protégée
              </CardTitle>
              <CardDescription>
                Un workspace ne peut être supprimé qu&apos;une fois réellement vide — plus aucun serveur, partage,
                zone ni tâche. C&apos;est volontaire : la suppression ne doit jamais emporter silencieusement une
                flotte encore en service.
              </CardDescription>
            </CardHeader>
          </Card>
        </div>
      </section>

      <section className="space-y-4">
        <SectionLabel>Connexion</SectionLabel>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <KeyRound className="h-4 w-4 text-muted-foreground" />
              Mot de passe ou SSO Authentik
            </CardTitle>
            <CardDescription>
              Deux chemins mènent à la même session : les identifiants locaux, ou une connexion Authentik en OpenID
              Connect. Dans les deux cas, la session est un cookie sécurisé posé par le serveur — aucun jeton n&apos;est
              stocké dans le navigateur. À l&apos;ouverture de l&apos;application, Tarmac demande discrètement à
              Authentik si une session existe déjà : si oui, l&apos;utilisateur est connecté sans écran intermédiaire.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Diagram
              viewBox="0 0 700 230"
              label="Schéma de la connexion SSO : le navigateur est redirigé vers Authentik, revient sur le control plane qui pose un cookie de session, puis les groupes Authentik déterminent les workspaces accessibles"
            >
              <DBox x={16} y={78} w={140} h={66} title="Navigateur" />
              <DBox x={250} y={78} w={160} h={66} title="Authentik" sub={['fournisseur', "d'identité"]} tone="accent" glow />
              <DBox x={470} y={78} w={216} h={66} title="Control plane" sub="pose le cookie de session" />
              <DBox x={470} y={166} w={216} h={48} title="Workspaces accessibles" sub="déduits des groupes" tone="success" />

              <DLink x1={160} y1={96} x2={246} y2={96} label="1. redirection" labelDy={-9} />
              <DLink x1={246} y1={128} x2={160} y2={128} label="2. retour signé" labelDy={15} />
              <DLink x1={414} y1={111} x2={466} y2={111} label="3. échange" labelDy={-9} />
              <DLink x1={578} y1={148} x2={578} y2={162} tone="success" />
              <DNote x={16} y={196} anchor="start">session = cookie serveur, rien à gérer côté client</DNote>
            </Diagram>
          </CardContent>
        </Card>
      </section>

      <section className="space-y-4">
        <SectionLabel>Membres</SectionLabel>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Users className="h-4 w-4 text-muted-foreground" />
                Ajout manuel
              </CardTitle>
              <CardDescription>
                Depuis Paramètres → Membres et rôles, un administrateur ajoute quelqu&apos;un par son adresse e-mail et
                choisit son rôle (Lecteur par défaut). Le compte doit déjà exister : Tarmac n&apos;envoie pas
                d&apos;invitation, l&apos;ajout est immédiat.
              </CardDescription>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <KeyRound className="h-4 w-4 text-muted-foreground" />
                Rattachement par groupe SSO
              </CardTitle>
              <CardDescription>
                Un workspace peut déclarer un groupe Authentik (Paramètres › Général). Toute personne membre de ce groupe devient
                automatiquement membre du workspace à sa connexion suivante, sans intervention. Les accès accordés de
                cette façon sont marqués « SSO » et reçoivent le rôle Éditeur, ajustable ensuite comme les autres.
              </CardDescription>
            </CardHeader>
          </Card>
        </div>

        <Card>
          <CardContent className="pt-6">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-56">Rôle</TableHead>
                  <TableHead className="w-40">Portée</TableHead>
                  <TableHead>Ce qu&apos;il permet</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ROLES.map((entry) => (
                  <TableRow key={entry.role}>
                    <TableCell className="text-sm font-medium text-foreground">{entry.role}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{entry.scope}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{entry.can}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Callout>
          Les rôles s&apos;appliquent côté API autant que dans l&apos;interface : un lecteur qui appelle une route
          d&apos;écriture reçoit un refus explicite (403). Ils reprennent le découpage des{' '}
          <Link href="/docs/api-keys" className="underline underline-offset-2">
            clés API
          </Link>{' '}
          : nœuds, stockage, réseau privé, DNS, VPN, alertes et journal. Chacun retrouve ses droits dans Paramètres →
          Mon accès.
        </Callout>
        <Callout variant="warning">
          Personne ne modifie son propre rôle ni ne se retire soi-même d&apos;un workspace qu&apos;il administre, et le
          dernier administrateur ne peut être ni rétrogradé ni retiré : le workspace resterait sans personne pour le
          gérer. Nommez d&apos;abord un autre administrateur.
        </Callout>
        <Callout>
          Le nom et l&apos;identifiant d&apos;URL (slug) se changent dans Paramètres → Général, y compris pour le
          workspace par défaut. Les agents ne dépendent pas du slug, et l&apos;ancien reste une redirection : favoris et
          liens des e-mails d&apos;alerte continuent de fonctionner.
        </Callout>
      </section>

      <p className="text-sm text-muted-foreground">
        Les routes correspondantes sont détaillées dans la{' '}
        <Link href="/docs/api" className="underline underline-offset-2">
          référence API
        </Link>
        , sections « Workspaces » et « Authentification ».
      </p>
    </div>
  );
}
