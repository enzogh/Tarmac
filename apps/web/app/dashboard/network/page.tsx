'use client';

import { useEffect, useMemo, useState } from 'react';
import { api, Vlan, VlanConnection, VlanConnectionTest, VlanStatus } from '@/lib/api';
import { DashboardLayout } from '@/components/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AlertCircle, Zap, Shield, Activity, Play } from 'lucide-react';

export default function NetworkPage() {
  const token = useMemo(() => (typeof window !== 'undefined' ? localStorage.getItem('tarmac_token') : null), []);
  const [vlanStatus, setVlanStatus] = useState<VlanStatus | null>(null);
  const [connections, setConnections] = useState<VlanConnection[]>([]);
  const [tests, setTests] = useState<VlanConnectionTest[]>([]);
  const [loading, setLoading] = useState(true);
  const [testRunning, setTestRunning] = useState(false);
  const [selectedTest, setSelectedTest] = useState<{ from?: string; to?: string; type?: 'ping' | 'connectivity' | 'latency' }>({});

  useEffect(() => {
    const fetchData = async () => {
      if (!token) return;
      try {
        setLoading(true);
        const vlans = await api.vlan.getAll(token);
        if (vlans.vlans.length > 0) {
          const vlanId = vlans.vlans[0].id;
          const [status, conns, testsList] = await Promise.all([
            api.vlan.getStatus(token, vlanId),
            api.vlan.getConnections(token, vlanId),
            api.vlan.getTests(token, vlanId),
          ]);
          setVlanStatus(status);
          setConnections(conns.connections);
          setTests(testsList.tests);
        }
      } catch (error) {
        console.error('Failed to fetch VLAN data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, [token]);

  const handleRunTest = async () => {
    if (!token || !vlanStatus || !selectedTest.from || !selectedTest.to || !selectedTest.type) {
      alert('Please select test parameters');
      return;
    }

    try {
      setTestRunning(true);
      const result = await api.vlan.runTest(token, vlanStatus.vlan.id, selectedTest.from, selectedTest.to, selectedTest.type);
      setTests([result.test, ...tests]);
    } catch (error) {
      console.error('Test failed:', error);
      alert('Connection test failed');
    } finally {
      setTestRunning(false);
    }
  };

  const content = loading ? (
    <div className="flex items-center justify-center h-96">
      <p className="text-muted-foreground">Chargement du réseau...</p>
    </div>
  ) : !vlanStatus ? (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-center justify-center py-16 px-4 text-center">
        <div className="mb-4 p-3 rounded-full bg-primary/10">
          <AlertCircle className="w-8 h-8 text-primary" />
        </div>
        <h3 className="text-xl font-semibold text-foreground mb-2">Aucun réseau VLAN trouvé</h3>
        <p className="text-muted-foreground mb-6 max-w-md">Déployez vos premiers agents pour initialiser le cluster réseau</p>
        
        <div className="w-full max-w-md space-y-4">
          {/* Steps */}
          <div className="space-y-3">
            {[
              { icon: Zap, label: 'Déployer votre premier agent/nœud' },
              { icon: Shield, label: 'Agent crée automatiquement le VLAN par défaut' },
              { icon: Activity, label: 'Les nouveaux agents rejoignent automatiquement avec IPs fixes' },
            ].map((step, idx) => {
              const Icon = step.icon;
              return (
                <div key={idx} className="flex gap-3 text-left">
                  <div className="flex-shrink-0">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/20">
                      <Icon className="h-4 w-4 text-primary" />
                    </div>
                  </div>
                  <div className="pt-1">
                    <p className="text-sm text-foreground">{step.label}</p>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Info */}
          <div className="rounded-lg bg-secondary/50 border border-white/10 p-3">
            <p className="text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">💡 Astuce:</span> Le VLAN est initialisé au premier heartbeat de l'agent
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  ) : (
    <div className="space-y-6">
      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Cluster Members</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-primary">{vlanStatus.memberCount}</div>
            <p className="text-xs text-muted-foreground mt-1">Nœuds actifs</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Network Health</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-primary">
              {vlanStatus.connectionStats.total > 0
                ? Math.round((vlanStatus.connectionStats.healthy / vlanStatus.connectionStats.total) * 100)
                : 100}
              %
            </div>
            <p className="text-xs text-muted-foreground mt-1">{vlanStatus.connectionStats.healthy} de {vlanStatus.connectionStats.total} sains</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Degraded Links</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-yellow-500">{vlanStatus.connectionStats.degraded}</div>
            <p className="text-xs text-muted-foreground mt-1">Liens dégradés</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Offline Links</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-destructive">{vlanStatus.connectionStats.offline}</div>
            <p className="text-xs text-muted-foreground mt-1">Nœuds déconnectés</p>
          </CardContent>
        </Card>
      </div>

      {/* VLAN Configuration */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Configuration VLAN</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <p className="text-xs text-muted-foreground mb-1">Nom</p>
              <p className="font-mono text-sm text-foreground">{vlanStatus.vlan.name}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Subnet</p>
              <p className="font-mono text-sm text-foreground">{vlanStatus.vlan.subnetCidr}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Status</p>
              <div className="inline-block">
                <span className={`px-2 py-1 rounded text-xs font-medium ${
                  vlanStatus.vlan.status === 'active' 
                    ? 'bg-primary/20 text-primary' 
                    : 'bg-muted text-muted-foreground'
                }`}>
                  {vlanStatus.vlan.status === 'active' ? '🟢 Actif' : 'Inactif'}
                </span>
              </div>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Créé</p>
              <p className="text-sm text-foreground">{new Date(vlanStatus.vlan.createdAt).toLocaleDateString('fr-FR')}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Cluster Nodes */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Nœuds du Cluster</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {(vlanStatus.vlan.members || []).map((member) => (
              <div key={member.id} className="border border-white/10 rounded-lg p-4 hover:bg-white/5 transition">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="font-semibold text-foreground">{member.node?.name || 'Unknown'}</div>
                    <div className="font-mono text-xs text-muted-foreground mt-1 break-all">{member.nodeId}</div>
                  </div>
                  <span className={`px-2 py-1 rounded text-xs font-medium ${
                    member.node?.status === 'online' ? 'bg-primary/20 text-primary' : 'bg-muted text-muted-foreground'
                  }`}>
                    {member.node?.status === 'online' ? '🟢 Online' : '🔴 Offline'}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <p className="text-muted-foreground">IP VLAN</p>
                    <p className="font-mono text-foreground">{member.vlanIp}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">MAC</p>
                    <p className="font-mono text-foreground text-xs">{member.vlanMac}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Rejoint</p>
                    <p className="text-foreground">{new Date(member.joinedAt).toLocaleString('fr-FR')}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Dernier heartbeat</p>
                    <p className="text-foreground">{new Date(member.lastHeartbeat).toLocaleTimeString('fr-FR')}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Connection Matrix */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Matrice de Connexion</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="border-b border-white/10">
                <tr>
                 <th className="text-left p-2 font-semibold text-muted-foreground">Nœud Source</th>
                 <th className="text-left p-2 font-semibold text-muted-foreground">Nœud Cible</th>
                 <th className="text-center p-2 font-semibold text-muted-foreground">Status</th>
                  <th className="text-right p-2 font-semibold text-muted-foreground">Latency (ms)</th>
                  <th className="text-right p-2 font-semibold text-muted-foreground">Loss %</th>
                 <th className="text-right p-2 font-semibold text-muted-foreground">Débit (Mbps)</th>
               </tr>
             </thead>
             <tbody>
               {connections.map((conn, i) => (
                 <tr key={i} className="border-b border-white/5 hover:bg-white/5">
                   <td className="p-2 font-mono text-foreground text-xs break-all max-w-xs">{conn.sourceNodeId}</td>
                   <td className="p-2 font-mono text-foreground text-xs break-all max-w-xs">{conn.targetNodeId}</td>
                   <td className="p-2 text-center">
                     <span className={`inline-block px-2 py-1 rounded text-xs font-medium ${
                       conn.status === 'healthy' ? 'bg-primary/20 text-primary' : 
                       conn.status === 'degraded' ? 'bg-yellow-500/20 text-yellow-500' : 
                       'bg-destructive/20 text-destructive'
                     }`}>
                       {conn.status === 'healthy' ? '✓ Healthy' : conn.status === 'degraded' ? '⚠ Degraded' : '✕ Offline'}
                     </span>
                   </td>
                   <td className="p-2 text-right font-mono text-foreground">{conn.latencyMs?.toFixed(1) || '-'}</td>
                   <td className="p-2 text-right font-mono text-foreground">{conn.packetLoss?.toFixed(1) || '-'}%</td>
                   <td className="p-2 text-right font-mono text-foreground">{(conn.bandwidth ? (conn.bandwidth / 1000).toFixed(0) : '-')} Mbps</td>
                 </tr>
               ))}
             </tbody>
           </table>
         </div>
       </CardContent>
      </Card>

      {/* Connectivity Tests */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Tests de Connectivité</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-3 gap-3 pb-4">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Depuis</label>
              <select
                value={selectedTest.from || ''}
                onChange={(e) => setSelectedTest({ ...selectedTest, from: e.target.value })}
                className="w-full px-2 py-1 rounded bg-white/5 border border-white/10 text-xs text-foreground"
              >
                <option value="">Sélectionner</option>
                {(vlanStatus.vlan.members || []).map((m) => (
                  <option key={m.id} value={m.nodeId}>{m.node?.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Vers</label>
              <select
                value={selectedTest.to || ''}
                onChange={(e) => setSelectedTest({ ...selectedTest, to: e.target.value })}
                className="w-full px-2 py-1 rounded bg-white/5 border border-white/10 text-xs text-foreground"
              >
                <option value="">Sélectionner</option>
                {(vlanStatus.vlan.members || [])
                  .filter((m) => m.nodeId !== selectedTest.from)
                  .map((m) => (
                    <option key={m.id} value={m.nodeId}>{m.node?.name}</option>
                  ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Type</label>
              <select
                value={selectedTest.type || ''}
                onChange={(e) => setSelectedTest({ ...selectedTest, type: e.target.value as any })}
                className="w-full px-2 py-1 rounded bg-white/5 border border-white/10 text-xs text-foreground"
              >
                <option value="">Sélectionner</option>
                <option value="ping">Ping</option>
                <option value="connectivity">Connectivité</option>
                <option value="latency">Latence</option>
              </select>
            </div>
          </div>
          <Button onClick={handleRunTest} disabled={testRunning} size="sm" className="w-full">
            <Play className="w-4 h-4" />
            {testRunning ? 'Test en cours...' : 'Exécuter le test'}
          </Button>

          {/* Test Results */}
          {tests.length > 0 && (
            <div className="space-y-2">
              {tests.slice(0, 5).map((test, i) => (
                <div key={i} className="border border-white/10 rounded p-2 text-xs">
                  <div className="flex justify-between items-start mb-1">
                    <span className="font-mono text-foreground">{test.initiatorNodeId.slice(0, 8)}→{test.targetNodeId.slice(0, 8)}</span>
                    <span className={`px-2 py-0.5 rounded ${
                      test.status === 'success' ? 'bg-primary/20 text-primary' : 'bg-destructive/20 text-destructive'
                    }`}>
                      {test.status}
                    </span>
                  </div>
                  <div className="text-muted-foreground">
                    Latence: {(test.latencyMs || 0).toFixed(1)}ms | Perte: {(test.packetLoss || 0).toFixed(1)}%
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Réseau VLAN</h1>
          <p className="text-muted-foreground mt-1">Surveillance et diagnostic du cluster réseau</p>
        </div>

        {content}
      </div>
    </DashboardLayout>
  );
}
