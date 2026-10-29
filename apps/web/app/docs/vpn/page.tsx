import { Globe2, KeyRound, LockKeyhole, QrCode, RadioTower, Users, Wrench } from 'lucide-react';
import { PageHeader } from '../../../components/PageHeader';
import { Callout } from '../../../components/Callout';
import { SectionLabel } from '../../../components/SectionLabel';
import { DocCard, DocSteps, DocTable } from '../../../components/docs/DocBlocks';

const STEPS = [
  {
    title: 'Choisir les passerelles',
    text: 'Accès distant › Passerelles : les nœuds par lesquels les appareils entrent dans la flotte. Ils doivent recevoir de l’UDP sur le port 51821.',
  },
  {
    title: 'Créer un profil par appareil',
    text: 'Accès distant › Profils VPN › Nouveau profil : un profil par ordinateur ou téléphone, avec son point d’entrée et, en mode « tout le trafic », sa sortie Internet.',
  },
  {
    title: 'Installer la configuration',
    text: 'Téléchargez le fichier WireGuard ou scannez le QR code depuis l’application WireGuard de l’appareil. La clé privée peut aussi rester sur l’appareil : fournissez seulement sa clé publique.',
  },
  {
    title: 'Régler ce que l’appareil peut joindre',
    text: 'Pour chaque profil : quels serveurs du réseau privé (tous, certains, aucun) et quels autres appareils VPN (isolé par défaut). Les règles sont appliquées par le pare-feu du point d’entrée.',
  },
];

export default function VpnDocsPage() {
  return (
    <div className="space-y-12">
      <PageHeader
        title="VPN"
        description="Un accès WireGuard à votre flotte pour chaque appareil : par où il entre, par où il sort sur Internet, et ce qu’il a le droit de joindre."
      />

      <Callout>
        Le VPN fait entrer un appareil — votre ordinateur, un téléphone — dans le réseau privé, sans exposer vos serveurs à Internet. Chaque profil est
        un appareil : le retirer, ou le laisser expirer, coupe son accès sans toucher aux autres.
      </Callout>

      <section className="space-y-4">
        <SectionLabel>Mettre en place</SectionLabel>
        <DocSteps steps={STEPS} />
      </section>

      <section className="space-y-4">
        <SectionLabel>Deux façons de sortir</SectionLabel>
        <DocTable
          head={['Mode', 'Effet']}
          rows={[
            ['Réseau privé uniquement', 'Seul le trafic vers vos serveurs passe par le VPN ; le reste va sur Internet comme d’habitude. Un tel profil ne peut pas sortir sur Internet par la flotte, même en modifiant sa configuration.'],
            ['Tout le trafic', 'Tout le trafic de l’appareil passe par la flotte et sort sur Internet par le nœud choisi — utile en déplacement sur un Wi-Fi public. La sortie se change en un clic, sans reconnecter l’appareil.'],
          ]}
        />
      </section>

      <section className="space-y-4">
        <SectionLabel>Bon à savoir</SectionLabel>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <DocCard icon={RadioTower} title="Entrée et sortie distinctes">
            Un appareil peut entrer par un nœud et sortir par un autre, n’importe où dans la flotte : le trafic est relayé sur le réseau privé.
          </DocCard>
          <DocCard icon={Users} title="Pensé pour des centaines de profils">
            Tableau filtrable, libellés, et actions groupées (accès, liens, activation, suppression) pour gérer toute une équipe d’un coup.
          </DocCard>
          <DocCard icon={KeyRound} title="Expiration et nouvelles clés">
            Un profil peut expirer à une date donnée. « Régénérer les clés » invalide l’ancienne configuration, par exemple après la perte d’un appareil.
          </DocCard>
          <DocCard icon={QrCode} title="Sessions en direct">
            Chaque profil montre s’il est connecté et son débit, en temps réel.
          </DocCard>
          <DocCard icon={LockKeyhole} title="Par API">
            Création et bascule de sortie aussi par API, avec une clé portant la permission VPN en lecture ou en écriture.
          </DocCard>
          <DocCard icon={Globe2} title="Sortie Internet">
            Le nœud de sortie fait suivre le trafic de l’appareil vers Internet avec sa propre adresse publique : c’est elle que voient les sites visités.
          </DocCard>
        </div>
      </section>

      <section className="space-y-4">
        <SectionLabel>Dépannage</SectionLabel>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <DocCard icon={Wrench} title="L’appareil ne se connecte pas" tone="warn">
            Le point d’entrée doit recevoir de l’UDP sur le port 51821. Si l’hébergeur filtre en amont, ouvrez ce port dans sa console.
          </DocCard>
          <DocCard icon={Wrench} title="« Agent à mettre à jour »" tone="warn">
            Un agent trop ancien sur un nœud d’entrée ou de sortie applique le VPN sans cloisonner les appareils. Mettez-le à jour depuis la page Nœuds.
          </DocCard>
        </div>
      </section>
    </div>
  );
}
