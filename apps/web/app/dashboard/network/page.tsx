'use client';

import { useEffect, useMemo, useState } from 'react';
import { api, Vlan, VlanConnection, VlanConnectionTest, VlanStatus } from '@/lib/api';
import { DashboardLayout } from '@/components/DashboardLayout';

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
    <div className="p-8">Loading network status...</div>
  ) : !vlanStatus ? (
    <div className="p-8 text-yellow-600">No VLAN found. Deploy agents to create the network.</div>
  ) : (
    <div className="space-y-6">
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-white rounded-lg shadow p-6">
          <div className="text-gray-600 text-sm font-medium">Cluster Members</div>
          <div className="text-3xl font-bold text-blue-600">{vlanStatus.memberCount}</div>
          <div className="text-xs text-gray-500 mt-2">Nodes active</div>
        </div>
        <div className="bg-white rounded-lg shadow p-6">
          <div className="text-gray-600 text-sm font-medium">Network Health</div>
          <div className="text-3xl font-bold text-green-600">
            {vlanStatus.connectionStats.total > 0
              ? Math.round((vlanStatus.connectionStats.healthy / vlanStatus.connectionStats.total) * 100)
              : 100}
            %
          </div>
          <div className="text-xs text-gray-500 mt-2">{vlanStatus.connectionStats.healthy} of {vlanStatus.connectionStats.total} healthy</div>
        </div>
        <div className="bg-white rounded-lg shadow p-6">
          <div className="text-gray-600 text-sm font-medium">Degraded Links</div>
          <div className="text-3xl font-bold text-yellow-600">{vlanStatus.connectionStats.degraded}</div>
          <div className="text-xs text-gray-500 mt-2">Links below threshold</div>
        </div>
        <div className="bg-white rounded-lg shadow p-6">
          <div className="text-gray-600 text-sm font-medium">Offline Links</div>
          <div className="text-3xl font-bold text-red-600">{vlanStatus.connectionStats.offline}</div>
          <div className="text-xs text-gray-500 mt-2">Disconnected nodes</div>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-xl font-bold mb-4">VLAN Configuration</h2>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="text-sm text-gray-600">Name</div>
            <div className="font-mono text-lg">{vlanStatus.vlan.name}</div>
          </div>
          <div>
            <div className="text-sm text-gray-600">Subnet</div>
            <div className="font-mono text-lg">{vlanStatus.vlan.subnetCidr}</div>
          </div>
          <div>
            <div className="text-sm text-gray-600">Status</div>
            <div className="font-mono text-lg capitalize">
              <span className={`px-2 py-1 rounded text-white text-sm ${vlanStatus.vlan.status === 'active' ? 'bg-green-500' : 'bg-gray-500'}`}>
                {vlanStatus.vlan.status}
              </span>
            </div>
          </div>
          <div>
            <div className="text-sm text-gray-600">Created</div>
            <div className="font-mono text-lg">{new Date(vlanStatus.vlan.createdAt).toLocaleDateString()}</div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-xl font-bold mb-4">Cluster Nodes</h2>
        <div className="grid grid-cols-auto gap-4">
          {(vlanStatus.vlan.members || []).map((member) => (
            <div key={member.id} className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <div className="font-semibold text-gray-800">{member.node?.name || 'Unknown'}</div>
              <div className="text-xs text-gray-600 mt-1">
                <div>IP: <span className="font-mono">{member.vlanIp}</span></div>
                <div>MAC: <span className="font-mono text-xs">{member.vlanMac}</span></div>
                <div>Joined: {new Date(member.joinedAt).toLocaleString()}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-xl font-bold mb-4">Connection Matrix</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-100">
              <tr>
                <th className="text-left p-2 font-semibold">Source</th>
                <th className="text-left p-2 font-semibold">Target</th>
                <th className="text-left p-2 font-semibold">Status</th>
                <th className="text-right p-2 font-semibold">Latency (ms)</th>
                <th className="text-right p-2 font-semibold">Loss %</th>
                <th className="text-left p-2 font-semibold">Last Check</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {connections.map((conn) => (
                <tr key={conn.id} className="hover:bg-gray-50">
                  <td className="p-2 font-mono text-blue-600">{conn.sourceNode?.name}</td>
                  <td className="p-2 font-mono text-blue-600">{conn.targetNode?.name}</td>
                  <td className="p-2">
                    <span className={`px-2 py-1 rounded text-white text-xs font-semibold
                      ${conn.status === 'healthy' ? 'bg-green-500' :
                        conn.status === 'degraded' ? 'bg-yellow-500' :
                        conn.status === 'offline' ? 'bg-red-500' :
                        'bg-gray-500'}`}>
                      {conn.status}
                    </span>
                  </td>
                  <td className="p-2 text-right">{conn.latencyMs ? `${conn.latencyMs.toFixed(1)}` : '—'}</td>
                  <td className="p-2 text-right">{conn.packetLoss ? `${conn.packetLoss.toFixed(1)}` : '—'}</td>
                  <td className="p-2 text-gray-600 text-xs">
                    {conn.lastCheckedAt ? new Date(conn.lastCheckedAt).toLocaleString() : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-xl font-bold mb-4">Connectivity Tests</h2>
        <div className="mb-6 bg-blue-50 p-4 rounded-lg">
          <div className="text-sm font-semibold mb-4 text-gray-700">Run Network Test</div>
          <div className="grid grid-cols-4 gap-4">
            <select
              value={selectedTest.from || ''}
              onChange={(e) => setSelectedTest({ ...selectedTest, from: e.target.value })}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
            >
              <option value="">From Node...</option>
              {(vlanStatus.vlan.members || []).map((m) => (
                <option key={m.nodeId} value={m.nodeId}>
                  {m.node?.name}
                </option>
              ))}
            </select>
            <select
              value={selectedTest.to || ''}
              onChange={(e) => setSelectedTest({ ...selectedTest, to: e.target.value })}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
            >
              <option value="">To Node...</option>
              {(vlanStatus.vlan.members || []).map((m) => (
                <option key={m.nodeId} value={m.nodeId}>
                  {m.node?.name}
                </option>
              ))}
            </select>
            <select
              value={selectedTest.type || ''}
              onChange={(e) => setSelectedTest({ ...selectedTest, type: e.target.value as any })}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
            >
              <option value="">Test Type...</option>
              <option value="ping">Ping</option>
              <option value="connectivity">Connectivity</option>
              <option value="latency">Latency</option>
            </select>
            <button
              onClick={handleRunTest}
              disabled={testRunning}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:bg-gray-400"
            >
              {testRunning ? 'Testing...' : 'Run Test'}
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-100">
              <tr>
                <th className="text-left p-2 font-semibold">From</th>
                <th className="text-left p-2 font-semibold">To</th>
                <th className="text-left p-2 font-semibold">Test Type</th>
                <th className="text-left p-2 font-semibold">Result</th>
                <th className="text-right p-2 font-semibold">Latency (ms)</th>
                <th className="text-right p-2 font-semibold">Loss %</th>
                <th className="text-left p-2 font-semibold">Time</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {tests.slice(0, 20).map((test) => (
                <tr key={test.id} className="hover:bg-gray-50">
                  <td className="p-2 font-mono text-blue-600">{test.initiatorNode?.name}</td>
                  <td className="p-2 font-mono text-blue-600">{test.resultMessage?.split(' ')[0]}</td>
                  <td className="p-2 text-sm">{test.testType}</td>
                  <td className="p-2">
                    <span className={`px-2 py-1 rounded text-white text-xs font-semibold
                      ${test.status === 'success' ? 'bg-green-500' :
                        test.status === 'failed' ? 'bg-red-500' :
                        'bg-yellow-500'}`}>
                      {test.status}
                    </span>
                  </td>
                  <td className="p-2 text-right">{test.latencyMs ? `${test.latencyMs.toFixed(1)}` : '—'}</td>
                  <td className="p-2 text-right">{test.packetLoss ? `${test.packetLoss.toFixed(1)}` : '—'}</td>
                  <td className="p-2 text-gray-600 text-xs">{new Date(test.startedAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {vlanStatus.recentFailures.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-6">
          <h2 className="text-xl font-bold mb-4 text-red-700">Recent Connection Failures</h2>
          <div className="space-y-2">
            {vlanStatus.recentFailures.map((failure) => (
              <div key={failure.id} className="text-sm text-red-700 bg-white p-3 rounded border border-red-100">
                <span className="font-mono">Failed to connect {failure.resultMessage}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  return <DashboardLayout>{content}</DashboardLayout>;
}
