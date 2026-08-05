import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { CheckCircle, Trash2, XCircle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  fetchAdminStats,
  fetchAdminUsers,
  fetchAdminConfig,
  deleteAdminUser,
  type AdminStats,
  type AdminUser,
  type ConfigKey,
} from '../lib/admin';
import { Alert, Badge, Button, Card, LoadingScreen, Spinner } from '../components/ui';
import { formatDate } from '../lib/format';

type Tab = 'overview' | 'users' | 'config';

export function AdminPage() {
  const { isAdmin, loading } = useAuth();
  const [tab, setTab] = useState<Tab>('overview');

  if (loading) return <LoadingScreen label="Checking access…" />;
  if (!isAdmin) return <Navigate to="/" replace />;

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Admin Panel</h1>
        <p className="text-sm text-slate-500">Platform management — visible to admins only</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-xl bg-slate-100 p-1 w-fit">
        {(['overview', 'users', 'config'] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`rounded-lg px-4 py-1.5 text-sm font-medium capitalize transition-colors ${
              tab === t
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'overview' && <OverviewTab />}
      {tab === 'users' && <UsersTab />}
      {tab === 'config' && <ConfigTab />}
    </div>
  );
}

// ── Overview ──────────────────────────────────────────────────────────────────
function OverviewTab() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchAdminStats()
      .then(setStats)
      .catch((e) => setError(e.message));
  }, []);

  if (error) return <Alert>{error}</Alert>;
  if (!stats) return <div className="flex justify-center p-8"><Spinner /></div>;

  const cards = [
    { label: 'Total users',       value: stats.totalUsers },
    { label: 'Total items',       value: stats.totalItems },
    { label: 'Listed items',      value: stats.listedItems },
    { label: 'Sold items',        value: stats.soldItems },
    { label: 'Queued to list',    value: stats.activeQueueEntries },
  ];

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {cards.map((c) => (
        <Card key={c.label}>
          <p className="text-xs text-slate-500">{c.label}</p>
          <p className="mt-1 text-3xl font-bold text-slate-900">{c.value}</p>
        </Card>
      ))}
    </div>
  );
}

// ── Users ─────────────────────────────────────────────────────────────────────
function UsersTab() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);

  useEffect(() => {
    fetchAdminUsers()
      .then(setUsers)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  async function handleDelete(userId: string) {
    if (confirm !== userId) { setConfirm(userId); return; }
    setDeleting(userId);
    setConfirm(null);
    try {
      await deleteAdminUser(userId);
      setUsers((u) => u.filter((x) => x.id !== userId));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setDeleting(null);
    }
  }

  if (loading) return <div className="flex justify-center p-8"><Spinner /></div>;
  if (error) return <Alert>{error}</Alert>;

  return (
    <Card>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-left text-xs text-slate-500">
              <th className="pb-2 pr-4 font-medium">Email</th>
              <th className="pb-2 pr-4 font-medium">Joined</th>
              <th className="pb-2 pr-4 font-medium">Last sign-in</th>
              <th className="pb-2 pr-4 font-medium text-right">Items</th>
              <th className="pb-2 pr-4 font-medium text-right">AI calls</th>
              <th className="pb-2 font-medium" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {users.map((u) => (
              <tr key={u.id} className="group">
                <td className="py-2 pr-4 font-medium text-slate-800">{u.email}</td>
                <td className="py-2 pr-4 text-slate-500">{formatDate(u.createdAt)}</td>
                <td className="py-2 pr-4 text-slate-500">
                  {u.lastSignIn ? formatDate(u.lastSignIn) : '—'}
                </td>
                <td className="py-2 pr-4 text-right">{u.itemCount}</td>
                <td className="py-2 pr-4 text-right">{u.aiCalls}</td>
                <td className="py-2 text-right">
                  <Button
                    type="button"
                    size="sm"
                    variant="danger"
                    disabled={deleting === u.id}
                    onClick={() => handleDelete(u.id)}
                  >
                    {deleting === u.id ? (
                      <Spinner />
                    ) : (
                      <Trash2 size={13} />
                    )}
                    {confirm === u.id ? 'Confirm?' : 'Delete'}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {users.length === 0 && (
          <p className="py-8 text-center text-sm text-slate-400">No users yet</p>
        )}
      </div>
    </Card>
  );
}

// ── Config ────────────────────────────────────────────────────────────────────
function ConfigTab() {
  const [keys, setKeys] = useState<ConfigKey[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchAdminConfig()
      .then(setKeys)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex justify-center p-8"><Spinner /></div>;
  if (error) return <Alert>{error}</Alert>;

  return (
    <Card>
      <h2 className="mb-3 text-sm font-semibold text-slate-700">Environment / API keys</h2>
      <p className="mb-4 text-xs text-slate-400">
        Keys are set as environment variables on Railway. Values are never exposed here — only configuration status.
      </p>
      <div className="divide-y divide-slate-100">
        {keys.map((k) => (
          <div key={k.key} className="flex items-center justify-between py-3">
            <div>
              <p className="text-sm font-medium text-slate-800">{k.label}</p>
              <p className="text-xs text-slate-400 font-mono">{k.key}</p>
            </div>
            {k.configured ? (
              <Badge tone="emerald" className="flex items-center gap-1">
                <CheckCircle size={12} /> Configured
              </Badge>
            ) : (
              <Badge tone="amber" className="flex items-center gap-1">
                <XCircle size={12} /> Not set
              </Badge>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}
