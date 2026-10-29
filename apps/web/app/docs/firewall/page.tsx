import { Ban, Eye, Globe2, ListChecks, LockKeyhole, Network, RotateCcw, Send, ShieldCheck, Wrench } from 'lucide-react';
import { PageHeader } from '../../../components/PageHeader';
import { Callout } from '../../../components/Callout';
import { SectionLabel } from '../../../components/SectionLabel';
import { DocCard, DocSteps, DocTable } from '../../../components/docs/DocBlocks';

const STEPS = [
  {
    title: 'Passer en observation',
    text: 'Pare-feu → onglet « Entre serveurs » (ou un serveur dans « Depuis Internet » / « Vers Internet ») → mode Observation. Rien n’est coupé : chaque connexion qui serait bloquée est notée dans l’onglet Activité.',
  },
  {
    title: 'Autoriser ce qui est légitime',
    text: 'Dans Activité, ouvrez une connexion : « Autoriser cette connexion » crée la règle pré-remplie. Ce qui est normal mais doit rester bloqué se marque « Vu, rien à faire » et ne revient plus dans le décompte.',
  },
  {
    title: 'Tester avant d’appliquer',
    text: '« Tester une connexion » dit si un trajet passerait, quelle règle en décide, et ce qui changerait une fois le mode appliqué. Rien n’est envoyé aux serveurs.',
  },
  {
    title: 'Appliquer',
    text: 'Passez en mode Appliqué : seules les connexions autorisées passent. Une confirmation rappelle combien de trajets seront coupés ; les connexions déjà ouvertes ne sont pas interrompues.',
  },
];

export default function FirewallDocsPage() {
  return (
    <div className="space-y-12">
      <PageHeader
        title="Pare-feu"
        description="Choisissez qui peut joindre vos serveurs — entre eux, depuis Internet — et ce qu’ils peuvent contacter. Chaque serveur applique lui-même ses règles, en quelques secondes."
      />

      <Callout>
        Le pare-feu de Tarmac <strong className="text-violet-100">ne fait que retirer des accès</strong> : ce qu’il autorise est rendu aux règles
        existantes du serveur (ufw, firewalld, Docker…). Un port que le serveur ferme lui-même reste fermé. Les flux dont Tarmac a besoin — réseau privé,
        montages, synchronisations, DNS, VPN — sont toujours autorisés et listés en lecture seule.
      </Callout>

      <section className="space-y-4">
        <SectionLabel>Trois zones</SectionLabel>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <DocCard icon={Network} title="Entre serveurs">
            Le trafic du réseau privé Tarmac. Un seul mode pour tout le workspace, et une matrice « qui peut joindre qui » qui résume chaque trajet.
          </DocCard>
          <DocCard icon={Globe2} title="Depuis Internet">
            Ce que vos serveurs exposent au monde, serveur par serveur : ports en écoute, services sensibles exposés, règles par adresse, liste ou pays.
          </DocCard>
          <DocCard icon={Send} title="Vers Internet">
            Ce que les services d’un serveur peuvent contacter. Si un site ou une base de données est piraté, il ne joint que ce que vous autorisez.
          </DocCard>
        </div>
      </section>

      <section className="space-y-4">
        <SectionLabel>Les modes</SectionLabel>
        <DocTable
          head={['Mode', 'Effet']}
          rows={[
            ['Ouvert', 'Tout passe, sauf ce qu’une règle de blocage interdit.'],
            [
              'Observation',
              'Tout passe encore, mais ce qui serait bloqué est noté dans Activité. C’est l’étape qui évite de casser une application en production.',
            ],
            ['Appliqué', 'Seul ce qu’une règle (ou Tarmac lui-même) autorise passe. Tout le reste est refusé et noté.'],
          ]}
        />
        <p className="text-sm text-muted-foreground">
          Les blocages passent toujours avant les autorisations, dans tous les modes. Une règle peut être temporaire (1 h, 24 h, 7 jours…) : elle se
          désactive seule à l’échéance.
        </p>
      </section>

      <section className="space-y-4">
        <SectionLabel>Mettre en place sans rien casser</SectionLabel>
        <DocSteps steps={STEPS} />
      </section>

      <section className="space-y-4">
        <SectionLabel>Origines et destinations</SectionLabel>
        <DocTable
          head={['Type', 'Quand l’utiliser']}
          rows={[
            ['Serveurs, étiquettes', 'Entre serveurs : un serveur précis, ou tous ceux qui portent une étiquette (« web », « db »).'],
            ['Adresses IP', 'Une adresse ou une plage, IPv4 ou IPv6 : l’IP d’un bureau, d’un partenaire.'],
            [
              'Listes d’adresses',
              'Un nom (« Bureau », « Prestataire ») pour un groupe d’adresses, géré dans Depuis Internet. Changez une adresse une fois : toutes les règles qui utilisent la liste suivent.',
            ],
            [
              'Pays',
              'Les adresses que les registres Internet attribuent à un pays, mises à jour chaque semaine par les serveurs. Utile contre les robots ; un VPN ou un proxy peut masquer le vrai pays.',
            ],
          ]}
        />
      </section>

      <section className="space-y-4">
        <SectionLabel>Protections intégrées</SectionLabel>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <DocCard icon={LockKeyhole} title="Anti-verrouillage SSH">
            Sur les serveurs filtrés, SSH reste joignable quoi que disent les règles, pour ne jamais perdre la main. Désactivable dans Depuis Internet ›
            Réglages, une fois une règle SSH en place (par exemple depuis l’adresse de votre bureau).
          </DocCard>
          <DocCard icon={ShieldCheck} title="Limite des tentatives SSH">
            Une même adresse peut ouvrir 20 connexions SSH d’affilée, puis 10 par minute ; au-delà elle est ralentie, jamais bloquée. Les adresses
            qu’une règle SSH autorise ne sont jamais limitées. Active par défaut, y compris sur les serveurs non filtrés.
          </DocCard>
          <DocCard icon={Send} title="Ce que le filtrage sortant laisse passer">
            Les processus système (root) — dont l’agent Tarmac et les mises à jour —, le DNS, l’heure et le ping restent toujours libres : un serveur ne
            perd jamais le contact avec Tarmac. Les conteneurs Docker ne sont pas concernés.
          </DocCard>
          <DocCard icon={Eye} title="Activité">
            Les connexions refusées, ou qui le seraient, regroupées par trajet et par heure, en direct. Durée de conservation réglable dans Paramètres ›
            Conservation des données ; export CSV ou JSON selon les filtres affichés.
          </DocCard>
        </div>
      </section>

      <section className="space-y-4">
        <SectionLabel>Dépannage</SectionLabel>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <DocCard icon={Wrench} title="« Agent à mettre à jour »" tone="warn">
            Le pare-feu sortant, les règles par pays et la limite SSH demandent un agent récent. Un agent trop ancien ne reçoit pas ces règles — jamais une
            version élargie — et l’interface le signale. Mettez-le à jour depuis la page Nœuds.
          </DocCard>
          <DocCard icon={Ban} title="Une application ne marche plus" tone="warn">
            Ouvrez Activité, filtrez sur le serveur concerné : la connexion refusée y apparaît avec la règle qui en décide. « Autoriser cette connexion »
            crée l’exception en un clic.
          </DocCard>
          <DocCard icon={RotateCcw} title="Revenir en arrière">
            Une règle modifiée ou supprimée par erreur se restaure depuis le Journal : « Restaurer » remet son état d’avant, et la réapplique sur les
            serveurs.
          </DocCard>
          <DocCard icon={ListChecks} title="Une liste d’adresses ne se supprime pas">
            Elle est encore utilisée par une règle : le message les nomme. Changez l’origine de ces règles, puis supprimez la liste.
          </DocCard>
        </div>
      </section>
    </div>
  );
}
