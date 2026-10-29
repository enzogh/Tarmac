import { Bell, BellRing, Cable, Code2, Gauge, HardDrive, Mail, RefreshCw, Server } from 'lucide-react';
import Link from 'next/link';
import { PageHeader } from '../../../components/PageHeader';
import { Callout } from '../../../components/Callout';
import { SectionLabel } from '../../../components/SectionLabel';
import { DocCard, DocTable } from '../../../components/docs/DocBlocks';

export default function AlertsDocsPage() {
  return (
    <div className="space-y-12">
      <PageHeader
        title="Alertes"
        description="Les problèmes détectés sur la flotte, au même endroit : ce que la supervision repère toute seule, et ce que vos règles de seuil surveillent."
      />

      <Callout>
        Une alerte reste <strong className="text-violet-100">à traiter</strong> tant qu’elle n’est pas résolue. Les alertes de seuil se résolvent seules
        dès que la mesure revient à la normale ; les autres se résolvent depuis la page Alertes une fois le problème traité.
      </Callout>

      <section className="space-y-4">
        <SectionLabel>Ce que Tarmac surveille de lui-même</SectionLabel>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <DocCard icon={Cable} title="Liens du réseau privé">
            Un lien coupé plus de 90 secondes. Les 3 minutes qui suivent un redémarrage de Tarmac sont ignorées, le temps que les agents se reconnectent.
          </DocCard>
          <DocCard icon={HardDrive} title="Santé des disques">
            Un disque dont l’état SMART se dégrade, au plus une alerte par heure et par disque.
          </DocCard>
          <DocCard icon={RefreshCw} title="Copies et migrations">
            Une tâche de réplication ou une migration qui échoue.
          </DocCard>
          <DocCard icon={Server} title="DNS et agents">
            Un serveur DNS secondaire qui ne suit plus son primaire, un agent qui envoie des données illisibles.
          </DocCard>
        </div>
      </section>

      <section className="space-y-4">
        <SectionLabel>Règles de seuil</SectionLabel>
        <DocCard icon={Gauge} title="CPU, mémoire et disque">
          Une règle compare chaque minute la dernière mesure d’un nœud (ou de tous) à un seuil — par exemple « disque au-dessus de 90 % » — avec une
          gravité de faible à critique. Les règles se gèrent pour l’instant par l’API (<code>/alert-rules</code>), voir la{' '}
          <Link href="/docs/api" className="text-primary underline-offset-2 hover:underline">
            référence API
          </Link>
          .
        </DocCard>
        <DocTable
          head={['Gravité', 'À utiliser pour']}
          rows={[
            ['Critique', 'Un service est arrêté ou va l’être : à traiter tout de suite.'],
            ['Élevée', 'Un risque proche : disque presque plein, lien instable.'],
            ['Moyenne', 'À regarder dans la journée.'],
            ['Faible', 'Pour information.'],
          ]}
        />
      </section>

      <section className="space-y-4">
        <SectionLabel>Être prévenu</SectionLabel>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <DocCard icon={Mail} title="Par e-mail">
            Les alertes arrivent par e-mail, regroupées en un seul message quand plusieurs se déclenchent ensemble. Chacun choisit de les recevoir ou non
            dans Paramètres › Notifications.
          </DocCard>
          <DocCard icon={BellRing} title="Slack ou webhook">
            Des canaux de notification (e-mail, Slack, webhook) se configurent et se testent par l’API (<code>/notification-channels</code>), puis se
            rattachent à une règle de seuil.
          </DocCard>
          <DocCard icon={Bell} title="Le rapport du lundi">
            Le rapport hebdomadaire reprend les alertes de la semaine, avec ce qui demande votre attention en premier (Paramètres › Rapport
            hebdomadaire).
          </DocCard>
          <DocCard icon={Code2} title="Export">
            La page Alertes exporte les alertes des 30 derniers jours en CSV (tableur) ou JSON.
          </DocCard>
        </div>
      </section>
    </div>
  );
}
