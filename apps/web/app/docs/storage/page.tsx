import { ArrowRightLeft, Database, FolderSync, HardDrive, LifeBuoy, RefreshCw, Share2, TrendingUp, Webhook, Wrench } from 'lucide-react';
import { PageHeader } from '../../../components/PageHeader';
import { Callout } from '../../../components/Callout';
import { SectionLabel } from '../../../components/SectionLabel';
import { DocCard, DocSteps, DocTable } from '../../../components/docs/DocBlocks';

const SHARE_STEPS = [
  {
    title: 'Partager un dossier',
    text: 'Stockage › Montages › « Nouveau partage NFS via VLAN » : choisissez le serveur et le dossier à partager, en naviguant dans ses dossiers en direct.',
  },
  {
    title: 'Le monter ailleurs',
    text: 'Choisissez le serveur client et l’endroit où le dossier apparaîtra. Tarmac autorise le client sur le partage, monte le dossier et l’inscrit dans /etc/fstab pour qu’il survive à un redémarrage.',
  },
  {
    title: 'Prévoir un secours',
    text: 'Un montage peut avoir des sources de secours : si la source principale tombe, il bascule sur la suivante.',
  },
];

export default function StorageDocsPage() {
  return (
    <div className="space-y-12">
      <PageHeader
        title="Stockage et réplication"
        description="Partagez des dossiers entre serveurs, regroupez des disques, copiez et déplacez des données — sans ligne de commande."
      />

      <Callout>
        Tout passe par le <strong className="text-violet-100">réseau privé</strong> : un partage n’est jamais exposé sur Internet, et une copie entre
        serveurs ne traverse que des liens chiffrés.
      </Callout>

      <section className="space-y-4">
        <SectionLabel>Partages et montages</SectionLabel>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <DocCard icon={Share2} title="Partage NFS">
            Rend un dossier d’un serveur accessible depuis vos autres serveurs, comme s’il était local. Seules les adresses autorisées peuvent le monter.
          </DocCard>
          <DocCard icon={HardDrive} title="Montage">
            Le côté client : NFS, CIFS (partage Windows / Samba) ou SFTP via rclone, par exemple une Storage Box. Persisté dans /etc/fstab.
          </DocCard>
        </div>
        <DocSteps steps={SHARE_STEPS} />
      </section>

      <section className="space-y-4">
        <SectionLabel>Pools</SectionLabel>
        <DocCard icon={Database} title="Regrouper les disques de plusieurs nœuds">
          Un pool réunit plusieurs serveurs dans un même espace, avec la protection de votre choix. Le premier membre est le primaire, les autres ses
          répliques.
        </DocCard>
        <DocTable
          head={['Protection', 'Principe']}
          rows={[
            ['Miroir', 'Chaque nœud garde une copie identique : redondance maximale.'],
            ['RAID 5', 'Répartition avec parité : bon équilibre entre redondance et capacité.'],
            ['RAID 6', 'Parité double : tolère la perte de deux nœuds.'],
            ['Simple', 'Un seul nœud, sans redondance : capacité maximale.'],
          ]}
        />
      </section>

      <section className="space-y-4">
        <SectionLabel>Copier et déplacer des données</SectionLabel>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <DocCard icon={RefreshCw} title="Réplication">
            Une tâche copie un dossier vers un autre serveur avec rsync, à la demande. La progression s’affiche en pourcentage ; la copie peut être arrêtée
            à tout moment. La source peut aussi être un serveur extérieur en SSH ou SFTP.
          </DocCard>
          <DocCard icon={Webhook} title="Déclencher depuis un script">
            Chaque tâche a un jeton de déclenchement : un appel HTTP avec ce jeton lance la copie, par exemple à la fin d’une sauvegarde.
          </DocCard>
          <DocCard icon={ArrowRightLeft} title="Migrations">
            Pour déplacer des données d’un serveur à un autre une bonne fois, avec choix des dossiers en direct des deux côtés et suivi de l’avancement.
          </DocCard>
          <DocCard icon={FolderSync} title="Seedbox et Storage Box">
            Une migration ou une copie peut partir d’un serveur extérieur (SFTP / SSH). Les mots de passe des migrations sont chiffrés dans la base de
            Tarmac.
          </DocCard>
        </div>
      </section>

      <section className="space-y-4">
        <SectionLabel>Anticiper</SectionLabel>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <DocCard icon={TrendingUp} title="Prévision de remplissage">
            La page Stockage estime, d’après l’évolution récente, quand chaque disque sera plein.
          </DocCard>
          <DocCard icon={LifeBuoy} title="Santé des disques">
            L’état SMART de chaque disque est suivi ; un disque qui se dégrade lève une alerte. Les disques virtuels sans données exploitables sont
            classés « inconnu », pas « critique ».
          </DocCard>
        </div>
      </section>

      <section className="space-y-4">
        <SectionLabel>Dépannage</SectionLabel>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <DocCard icon={Wrench} title="Un montage reste « en attente »" tone="warn">
            Le serveur client est peut-être hors ligne : Tarmac l’appliquera dès son retour. S’il est en ligne, le détail du montage donne le message
            d’erreur de l’agent.
          </DocCard>
          <DocCard icon={Wrench} title="Le pare-feu bloque un partage" tone="warn">
            Les flux des montages et des copies sont autorisés automatiquement par le pare-feu. Si un montage a été créé à la main hors de Tarmac, ajoutez
            une règle « Entre serveurs ».
          </DocCard>
        </div>
      </section>
    </div>
  );
}
