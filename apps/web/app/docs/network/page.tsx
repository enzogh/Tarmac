import { Activity, Gauge, History, Map, Radar, Route, ShieldCheck, Wrench } from 'lucide-react';
import { PageHeader } from '../../../components/PageHeader';
import { Callout } from '../../../components/Callout';
import { SectionLabel } from '../../../components/SectionLabel';
import { DocCard, DocTable } from '../../../components/docs/DocBlocks';

export default function NetworkDocsPage() {
  return (
    <div className="space-y-12">
      <PageHeader
        title="Réseau privé"
        description="Le réseau chiffré qui relie tous les serveurs d’un workspace, comme s’ils étaient dans la même salle — quel que soit leur hébergeur."
      />

      <Callout>
        Chaque nœud reçoit une adresse privée (par exemple <code>10.16.0.5</code>) sur une interface WireGuard, <code>tarmacwg0</code>. Les clés et les
        adresses sont gérées par l’agent : il n’y a rien à configurer à la main, un nouveau nœud rejoint le réseau dès son installation.
      </Callout>

      <section className="space-y-4">
        <SectionLabel>Comment il est organisé</SectionLabel>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <DocCard icon={Route} title="Maillage, puis régions">
            Dans une même région, chaque nœud est relié directement à tous les autres. Au-delà de deux régions, un nœud « passerelle » par région relie
            les régions entre elles : le nombre de liens reste raisonnable même avec des dizaines de serveurs.
          </DocCard>
          <DocCard icon={ShieldCheck} title="Chiffré de bout en bout">
            Tout le trafic entre nœuds passe par WireGuard. Ce que les nœuds ont le droit de se dire se règle dans Pare-feu › Entre serveurs.
          </DocCard>
        </div>
      </section>

      <section className="space-y-4">
        <SectionLabel>Surveiller les liens</SectionLabel>
        <DocTable
          head={['Mesure', 'Ce qu’elle indique']}
          rows={[
            ['Latence', 'Le temps d’un aller-retour entre deux nœuds.'],
            ['Perte de paquets', 'La part des paquets qui n’arrivent pas : au-delà de quelques pourcents, les transferts ralentissent.'],
            ['Dernier handshake', 'L’âge du dernier échange de clés WireGuard. Un lien sans handshake récent est considéré hors ligne.'],
            ['Débit', 'Le volume échangé sur le lien.'],
          ]}
        />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <DocCard icon={Map} title="Topologie">
            Graphe des liens ou carte du monde ; les positions des nœuds se déplacent et sont mémorisées.
          </DocCard>
          <DocCard icon={History} title="Historique">
            Disponibilité de chaque lien sur 1 h, 24 h ou 7 jours, gardée 30 jours.
          </DocCard>
          <DocCard icon={Radar} title="Diagnostic">
            Ping et traceroute lancés en direct depuis un nœud vers un autre. Les résultats ne sont pas conservés.
          </DocCard>
        </div>
      </section>

      <section className="space-y-4">
        <SectionLabel>Alertes</SectionLabel>
        <DocCard icon={Activity} title="« Lien VLAN hors ligne »">
          Levée seulement si un lien reste coupé 90 secondes, pour ignorer les micro-coupures. Pendant les 3 minutes qui suivent un redémarrage de Tarmac,
          le temps que les agents se reconnectent, aucune alerte de lien n’est émise.
        </DocCard>
      </section>

      <section className="space-y-4">
        <SectionLabel>Dépannage</SectionLabel>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <DocCard icon={Wrench} title="Un lien reste hors ligne" tone="warn">
            L’un des deux nœuds doit pouvoir recevoir du WireGuard (UDP) depuis l’autre. Si l’hébergeur filtre en amont, ouvrez le port WireGuard du nœud
            dans sa console. Le diagnostic (ping, traceroute) montre où la connexion s’arrête.
          </DocCard>
          <DocCard icon={Gauge} title="Une latence élevée entre régions">
            Normal entre continents. Placez les services qui se parlent beaucoup dans la même région ; la passerelle régionale n’ajoute qu’un saut.
          </DocCard>
        </div>
      </section>
    </div>
  );
}
