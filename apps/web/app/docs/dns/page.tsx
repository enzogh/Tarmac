import Link from 'next/link';
import { Globe, ShieldCheck, MapPin, Network, ListChecks, Wrench } from 'lucide-react';
import { PageHeader } from '../../../components/PageHeader';
import { Callout } from '../../../components/Callout';
import { SectionLabel } from '../../../components/SectionLabel';
import { AnimatedGradientText } from '../../../components/ui/animated-gradient-text';
import { Badge } from '../../../components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../../components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../components/ui/table';
import { Diagram, DBox, DFrame, DLink, DNote } from '../../../components/docs/Diagram';

const STEPS = [
  {
    title: 'Créer un groupe DNS',
    text: "DNS → « Nouveau groupe DNS ». Un groupe est l'ensemble des serveurs qui feront autorité pour vos zones.",
  },
  {
    title: 'Y placer des serveurs',
    text: "Ajoutez un nœud en primaire, puis jusqu'à trois secondaires. Tarmac installe et configure PowerDNS sur chacun ; le statut passe en vert une fois le serveur opérationnel.",
  },
  {
    title: 'Créer une zone',
    text: "« Nouvelle zone », avec le domaine à héberger. DNSSEC est activé par défaut. La zone est créée sur le primaire puis transférée aux secondaires.",
  },
  {
    title: 'Ajouter des enregistrements',
    text: "A, AAAA, CNAME, MX, TXT… Une valeur peut viser un nœud de la flotte plutôt qu'une IP saisie à la main : elle suit alors le nœud si son adresse change.",
  },
  {
    title: 'Déléguer chez le registrar',
    text: "Déclarez ns1/ns2 comme serveurs de noms du domaine (et leurs glue records). Tarmac vérifie ensuite tout seul que la délégation est effective côté Internet.",
  },
];

const RECORD_TYPES: { type: string; usage: string }[] = [
  { type: 'A / AAAA', usage: 'Adresse IPv4 / IPv6 — le type à utiliser pour pointer vers un nœud de la flotte.' },
  { type: 'CNAME', usage: 'Alias vers un autre nom.' },
  { type: 'MX', usage: 'Serveur de messagerie, avec sa priorité.' },
  { type: 'TXT', usage: 'Texte libre : validation de domaine, SPF, DKIM.' },
  { type: 'NS', usage: 'Délégation d’un sous-domaine à d’autres serveurs de noms.' },
  { type: 'CAA', usage: 'Autorités de certification autorisées à émettre pour ce domaine.' },
  { type: 'SRV', usage: 'Service, port et priorité — utilisé par certains protocoles.' },
  { type: 'PTR', usage: 'Résolution inverse (IP → nom).' },
];

export default function DnsDocsPage() {
  return (
    <div className="space-y-12">
      <PageHeader
        icon={Globe}
        title={<AnimatedGradientText speed={0.6}>DNS</AnimatedGradientText>}
        description="Hébergez vos propres domaines sur votre flotte : serveurs primaire/secondaire, zones signées DNSSEC, réponses géolocalisées — et un résolveur interne pour joindre vos nœuds par leur nom."
      />

      <Callout>
        Deux choses distinctes portent le nom « DNS » dans Tarmac. Le <strong className="text-violet-100">DNS public</strong>{' '}
        (groupes, zones, enregistrements) fait autorité sur vos domaines pour tout Internet. Le{' '}
        <strong className="text-violet-100">DNS interne</strong> ne sert qu&apos;à vos propres serveurs, en{' '}
        <code>*.tarmac.local</code>, sur le réseau privé. Les deux cohabitent sans se gêner, y compris sur un même nœud.
      </Callout>

      <section className="space-y-4">
        <SectionLabel>Vue d&apos;ensemble</SectionLabel>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Un groupe, un primaire, des copies</CardTitle>
            <CardDescription>
              Vous modifiez une zone depuis le tableau de bord ; elle est appliquée sur le nœud primaire, qui la
              transfère aux secondaires. N&apos;importe lequel des serveurs peut ensuite répondre aux résolveurs
              d&apos;Internet — c&apos;est ce qui rend le service tolérant à la panne d&apos;un serveur.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Diagram
              viewBox="0 0 700 300"
              label="Schéma d'un groupe DNS : le tableau de bord applique la zone sur le nœud primaire, qui la transfère par AXFR à ses secondaires, et les trois répondent aux résolveurs d'Internet"
            >
              <DBox x={262} y={12} w={196} h={54} title="Tableau de bord" sub="vos zones et enregistrements" tone="accent" glow />

              <DFrame x={206} y={92} w={306} h={192} label="Groupe DNS" />
              <DBox x={228} y={124} w={262} h={62} title="Nœud primaire" sub={['PowerDNS', 'reçoit vos modifications']} tone="accent" />
              <DBox x={228} y={212} w={124} h={58} title="Secondaire 1" sub="copie de la zone" />
              <DBox x={366} y={212} w={124} h={58} title="Secondaire 2" sub="copie de la zone" />

              <DLink x1={360} y1={70} x2={360} y2={120} label="applique" labelDy={-4} />
              <DLink x1={290} y1={190} x2={290} y2={208} flow />
              <DLink x1={428} y1={190} x2={428} y2={208} flow />
              <DNote x={524} y={228} anchor="start" tone="accent">transfert AXFR</DNote>
              <DNote x={524} y={244} anchor="start">automatique, à chaque</DNote>
              <DNote x={524} y={258} anchor="start">modification de zone</DNote>

              <DBox x={16} y={148} w={150} h={64} title="Résolveur" sub={['le visiteur', 'de votre site']} />
              <DLink x1={170} y1={162} x2={222} y2={150} arrow="both" tone="default" />
              <DLink x1={170} y1={196} x2={222} y2={236} arrow="both" tone="default" />
              <DNote x={94} y={232}>requêtes DNS</DNote>
              <DNote x={94} y={246}>port 53, public</DNote>
            </Diagram>
          </CardContent>
        </Card>
      </section>

      <section className="space-y-4">
        <SectionLabel>Mise en route</SectionLabel>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {STEPS.map((step, index) => (
            <Card key={step.title} className="bg-panel-glow">
              <CardHeader>
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-600/15 text-xs font-semibold text-violet-300">
                  {index + 1}
                </div>
                <CardTitle className="pt-3 text-base">{step.title}</CardTitle>
                <CardDescription>{step.text}</CardDescription>
              </CardHeader>
            </Card>
          ))}
          <Card className="bg-panel-glow">
            <CardHeader>
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-300">
                <ListChecks className="h-4 w-4" />
              </div>
              <CardTitle className="pt-3 text-base">Suivre l&apos;avancement</CardTitle>
              <CardDescription>
                Chaque groupe, chaque serveur et chaque zone affiche son statut — en attente, actif ou en erreur — et
                déplie son propre journal PowerDNS ainsi que la latence du lien VLAN vers les autres membres.
              </CardDescription>
            </CardHeader>
          </Card>
        </div>
      </section>

      <section className="space-y-4">
        <SectionLabel>Délégation &amp; DNSSEC</SectionLabel>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="h-4 w-4 text-violet-400" />
              Rendre la zone réellement joignable
            </CardTitle>
            <CardDescription>
              Créer une zone ne suffit pas : tant que le registrar du domaine n&apos;a pas été mis à jour, personne
              n&apos;est envoyé vers vos serveurs. Tarmac vous donne les valeurs exactes à saisir, puis vérifie le
              résultat depuis l&apos;extérieur, sans que vous ayez à le demander.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Diagram
              viewBox="0 0 700 256"
              label="Schéma de la délégation : le registrar publie les serveurs de noms et l'enregistrement DS dans la zone parente, qui renvoie vers vos serveurs, et Tarmac vérifie automatiquement le résultat"
            >
              <DBox x={16} y={84} w={166} h={72} title="Registrar" sub={['là où le domaine', 'a été acheté']} />
              <DBox x={238} y={84} w={176} h={72} title="Zone parente" sub={['.fr, .com…', 'NS + DS publiés']} />
              <DBox x={470} y={26} w={214} h={66} title="ns1 / ns2.exemple.fr" sub={['vos nœuds du groupe', 'IP publiques (glue)']} tone="accent" glow />
              <DBox x={470} y={148} w={214} h={66} title="Vérification automatique" sub={['Tarmac interroge', 'les serveurs publics']} tone="success" />

              <DLink x1={186} y1={120} x2={234} y2={120} label="vous saisissez" labelDy={-8} />
              <DLink x1={418} y1={104} x2={466} y2={70} label="délégation" labelDy={-8} />
              <DLink x1={568} y1={96} x2={568} y2={144} arrow="both" tone="success" dashed />
              <DNote x={350} y={246}>DNSSEC : la clé DS est fournie par Tarmac, publiée par le registrar</DNote>
            </Diagram>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Serveurs de noms &amp; glue</CardTitle>
              <CardDescription>
                Tarmac propose des serveurs de noms internes au domaine — <code>ns1.exemple.fr</code>,{' '}
                <code>ns2.exemple.fr</code> — pointant sur l&apos;IP publique de chaque membre du groupe. La plupart
                des registrars exigent en plus d&apos;enregistrer ces « glue records » séparément : cette étape reste
                manuelle, l&apos;écran de délégation affiche les valeurs à recopier.
              </CardDescription>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">DNSSEC</CardTitle>
              <CardDescription>
                Activé par défaut à la création d&apos;une zone. Les clés vivent sur le serveur primaire et ne sont
                jamais recopiées dans la base de Tarmac : l&apos;écran DNSSEC va les lire en direct sur le nœud. Il ne
                reste qu&apos;à publier l&apos;enregistrement DS chez le registrar pour fermer la chaîne de confiance.
              </CardDescription>
            </CardHeader>
          </Card>
        </div>
      </section>

      <section className="space-y-4">
        <SectionLabel>Réponses géolocalisées</SectionLabel>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <MapPin className="h-4 w-4 text-violet-400" />
              Un enregistrement, plusieurs nœuds, la réponse la plus proche
            </CardTitle>
            <CardDescription>
              Cochez « géo » sur un enregistrement et listez plusieurs nœuds comme valeurs : le serveur choisit celui
              qui est géographiquement le plus proche de la personne qui interroge, au lieu de répondre au hasard. La
              localisation est déduite d&apos;une base GeoIP auto-hébergée, sans dépendance à un service tiers.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Diagram
              viewBox="0 0 700 220"
              label="Schéma du GeoDNS : deux visiteurs situés sur des continents différents interrogent le même enregistrement et reçoivent chacun l'adresse du nœud le plus proche"
            >
              <DBox x={16} y={26} w={158} h={58} title="Visiteur à Paris" />
              <DBox x={16} y={134} w={158} h={58} title="Visiteur à New York" />

              <DBox x={252} y={72} w={196} h={74} title="www.exemple.fr" sub={['enregistrement « géo »', 'deux nœuds en valeur']} tone="accent" glow />

              <DBox x={528} y={26} w={156} h={58} title="Nœud Paris" sub="203.0.113.10" tone="success" />
              <DBox x={528} y={134} w={156} h={58} title="Nœud New York" sub="198.51.100.20" tone="success" />

              <DLink x1={178} y1={58} x2={248} y2={96} />
              <DLink x1={178} y1={160} x2={248} y2={124} />
              <DLink x1={452} y1={96} x2={524} y2={58} tone="success" flow />
              <DLink x1={452} y1={124} x2={524} y2={160} tone="success" flow />
              <DNote x={350} y={186}>sans « géo », les valeurs sont simplement servies à tour de rôle</DNote>
            </Diagram>
          </CardContent>
        </Card>
      </section>

      <section className="space-y-4">
        <SectionLabel>DNS interne</SectionLabel>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Network className="h-4 w-4 text-violet-400" />
              Joindre vos serveurs par leur nom, sur le réseau privé
            </CardTitle>
            <CardDescription>
              Désignez un nœud comme résolveur interne du workspace : chaque serveur devient joignable en{' '}
              <code>&lt;nom&gt;.tarmac.local</code> depuis n&apos;importe quel autre nœud du VLAN. La liste des noms est
              regénérée automatiquement quand un serveur est ajouté, renommé ou retiré — un nom personnalisé peut être
              défini sur chaque nœud.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Diagram
              viewBox="0 0 700 242"
              label="Schéma du DNS interne : un nœud désigné résolveur répond aux requêtes tarmac.local des autres nœuds du réseau privé"
            >
              <DFrame x={14} y={14} w={672} h={200} label="Réseau privé du workspace" />
              <DBox x={250} y={44} w={200} h={66} title="Résolveur interne" sub={['nœud désigné', 'sert *.tarmac.local']} tone="accent" glow />

              <DBox x={40} y={144} w={168} h={56} title="web-1" sub="web-1.tarmac.local" />
              <DBox x={266} y={144} w={168} h={56} title="db-1" sub="db-1.tarmac.local" />
              <DBox x={492} y={144} w={168} h={56} title="backup-1" sub="backup-1.tarmac.local" />

              <DLink x1={280} y1={112} x2={140} y2={140} arrow="both" dashed />
              <DLink x1={350} y1={112} x2={350} y2={140} arrow="both" dashed />
              <DLink x1={420} y1={112} x2={560} y2={140} arrow="both" dashed />
              <DNote x={350} y={234} tone="accent">résolution par nom sur le réseau privé, jamais exposée à Internet</DNote>
            </Diagram>
          </CardContent>
        </Card>
      </section>

      <section className="space-y-4">
        <SectionLabel>Types d&apos;enregistrements</SectionLabel>
        <Card>
          <CardContent className="pt-6">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-32">Type</TableHead>
                  <TableHead>À quoi ça sert</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {RECORD_TYPES.map((record) => (
                  <TableRow key={record.type}>
                    <TableCell>
                      <Badge variant="info" className="font-mono">
                        {record.type}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{record.usage}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </section>

      <section className="space-y-4">
        <SectionLabel>Dépannage</SectionLabel>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Wrench className="h-4 w-4 text-amber-400" />
                Le port 53 est déjà pris
              </CardTitle>
              <CardDescription>
                Un serveur DNS ne peut démarrer que si le port 53 est libre — or beaucoup de distributions y font
                tourner leur propre résolveur local. Le serveur apparaît alors « en erreur » avec le détail du
                processus fautif, et un bouton propose de libérer le port sans intervention en ligne de commande.
              </CardDescription>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Wrench className="h-4 w-4 text-amber-400" />
                Une zone reste en erreur
              </CardTitle>
              <CardDescription>
                L&apos;action « Réappliquer » repousse la zone complète sur tous les serveurs du groupe. Le journal
                déplié sous chaque membre montre ce que PowerDNS a réellement répondu, ce qui suffit en général à
                identifier la cause.
              </CardDescription>
            </CardHeader>
          </Card>
        </div>
        <Callout variant="warning">
          Supprimer un groupe exige d&apos;avoir d&apos;abord retiré ses zones. Retirer un serveur d&apos;un groupe ou
          supprimer une zone déclenche le nettoyage correspondant sur le nœud : PowerDNS est arrêté et la zone
          supprimée localement, plutôt que laissée à répondre dans son coin.
        </Callout>
      </section>

      <p className="text-sm text-muted-foreground">
        Les routes correspondantes sont détaillées dans la{' '}
        <Link href="/docs/api" className="underline underline-offset-2">
          référence API
        </Link>
        , section « DNS ».
      </p>
    </div>
  );
}
