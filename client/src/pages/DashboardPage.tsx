import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Package,
  ListChecks,
  ShoppingBag,
  TrendingUp,
  Clock,
  Plus,
  PoundSterling,
  Search,
  CheckCircle2,
  Circle,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { fetchDashboardStats, fetchItems, fetchQueue } from '../lib/items';
import type { DashboardStats, Item, ListingQueueEntry } from '../types';
import { formatMoney, formatDateTime } from '../lib/format';
import {
  Alert,
  Button,
  Card,
  LoadingScreen,
  PageHeader,
  StatCard,
} from '../components/ui';
import { ItemCard } from '../components/ItemCard';

export function DashboardPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [recent, setRecent] = useState<Item[]>([]);
  const [queue, setQueue] = useState<ListingQueueEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  function onSearch(e: FormEvent) {
    e.preventDefault();
    const q = search.trim();
    navigate(q ? `/inventory?q=${encodeURIComponent(q)}` : '/inventory');
  }

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [s, items, q] = await Promise.all([
          fetchDashboardStats(user.id),
          fetchItems({ limit: 6 }),
          fetchQueue(),
        ]);
        if (cancelled) return;
        setStats(s);
        setRecent(items);
        setQueue(q.slice(0, 5));
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load dashboard');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user]);

  if (loading) return <LoadingScreen label="Loading dashboard…" />;

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle="Your resale operation at a glance"
        actions={
          <Link to="/add">
            <Button>
              <Plus size={18} />
              Add item
            </Button>
          </Link>
        }
      />

      {error && (
        <div className="mb-4">
          <Alert>
            {error}
            <p className="mt-1 text-xs opacity-80">
              If this is a fresh setup, run the SQL migration in Supabase first.
            </p>
          </Alert>
        </div>
      )}

      {/* Search */}
      <form onSubmit={onSearch} className="mb-6">
        <div className="relative">
          <Search
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder='Search — e.g. "Nike trainers", "Container 3", "V-00012"'
            className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
          />
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <Link
            to="/inventory?status=ready_for_listing"
            className="rounded-full bg-white px-3 py-1.5 text-xs font-medium text-slate-600 ring-1 ring-slate-200 transition hover:bg-slate-50"
          >
            Ready to list
          </Link>
          <Link
            to="/inventory?status=new"
            className="rounded-full bg-white px-3 py-1.5 text-xs font-medium text-slate-600 ring-1 ring-slate-200 transition hover:bg-slate-50"
          >
            New items
          </Link>
          <Link
            to="/inventory?status=listed"
            className="rounded-full bg-white px-3 py-1.5 text-xs font-medium text-slate-600 ring-1 ring-slate-200 transition hover:bg-slate-50"
          >
            Listed
          </Link>
          <Link
            to="/inventory?status=sold"
            className="rounded-full bg-white px-3 py-1.5 text-xs font-medium text-slate-600 ring-1 ring-slate-200 transition hover:bg-slate-50"
          >
            Sold
          </Link>
        </div>
      </form>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <StatCard
          label="Total items"
          value={stats?.total_items ?? 0}
          icon={<Package size={18} />}
        />
        <StatCard
          label="Ready to list"
          value={stats?.ready_for_listing ?? 0}
          icon={<ListChecks size={18} />}
        />
        <StatCard
          label="Listed"
          value={stats?.listed ?? 0}
          icon={<ShoppingBag size={18} />}
        />
        <StatCard
          label="Sold"
          value={stats?.sold ?? 0}
          icon={<TrendingUp size={18} />}
        />
        <StatCard
          label="Total profit"
          value={formatMoney(stats?.total_profit)}
          hint={`Avg sale ${formatMoney(stats?.average_sale_price)}`}
          icon={<PoundSterling size={18} />}
        />
        <StatCard
          label="Queue"
          value={stats?.queue_pending ?? 0}
          hint="Scheduled listings"
          icon={<Clock size={18} />}
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-800">Recent items</h2>
            <Link to="/inventory" className="text-xs font-medium text-teal-700 hover:underline">
              View all
            </Link>
          </div>
          {recent.length === 0 ? (
            <OnboardingChecklist stats={stats} />
          ) : (
            <div className="space-y-2.5">
              {recent.map((item) => (
                <ItemCard key={item.id} item={item} />
              ))}
            </div>
          )}
        </div>

        <div className="lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-800">Upcoming listings</h2>
            <Link to="/queue" className="text-xs font-medium text-teal-700 hover:underline">
              Open queue
            </Link>
          </div>
          <Card padding={false}>
            {queue.length === 0 ? (
              <div className="p-6 text-center text-sm text-slate-500">
                Nothing scheduled. Mark items ready and add them to the queue.
              </div>
            ) : (
              <ul className="divide-y divide-slate-100">
                {queue.map((entry) => (
                  <li key={entry.id} className="flex items-center gap-3 px-4 py-3">
                    <div className="h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-slate-100">
                      {entry.items?.primary_image_url ? (
                        <img
                          src={entry.items.primary_image_url}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      ) : null}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-900">
                        {entry.items?.item_number} ·{' '}
                        {entry.items?.title || entry.items?.product_type || 'Item'}
                      </p>
                      <p className="text-xs text-slate-500">
                        {formatDateTime(entry.scheduled_at)}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="mt-4 bg-gradient-to-br from-teal-600 to-teal-700 text-white">
            <p className="text-sm font-semibold">Inventory value</p>
            <p className="mt-1 text-2xl font-bold">
              {formatMoney(stats?.total_inventory_value)}
            </p>
            <p className="mt-1 text-xs text-teal-100">
              Based on list / suggested prices · Cost basis{' '}
              {formatMoney(stats?.total_purchase_cost)}
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}

// ── Onboarding checklist (shown when user has no items yet) ───────────────────
function OnboardingChecklist({ stats }: { stats: DashboardStats | null }) {
  const hasItems   = (stats?.total_items ?? 0) > 0;
  const hasListing = ((stats?.ready_for_listing ?? 0) + (stats?.listed ?? 0) + (stats?.sold ?? 0)) > 0;
  const hasPosted  = ((stats?.listed ?? 0) + (stats?.sold ?? 0) + (stats?.queue_pending ?? 0)) > 0;

  const steps = [
    {
      done: hasItems,
      title: 'Add your first item',
      description: 'Take photos of something you want to sell and add it to your inventory.',
      cta: <Link to="/add"><Button size="sm">Add item</Button></Link>,
    },
    {
      done: hasListing,
      title: 'Generate a listing with AI',
      description: 'Open the item, click "Generate with AI" — title, description and price are written for you.',
      cta: null,
    },
    {
      done: hasPosted,
      title: 'Schedule or post it',
      description: 'Copy the listing to Vinted manually, or use the Chrome extension to fill the form automatically.',
      cta: null,
    },
  ];

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-teal-100 bg-gradient-to-br from-teal-50 to-white p-5">
        <p className="text-base font-semibold text-slate-900">Welcome to Starsella</p>
        <p className="mt-1 text-sm text-slate-500">
          Get your first item listed in 3 steps. This guide disappears once you're up and running.
        </p>
      </div>
      {steps.map((step, i) => (
        <div
          key={i}
          className={`flex gap-4 rounded-xl border p-4 transition-opacity ${
            step.done ? 'border-emerald-100 bg-emerald-50/50 opacity-70' : 'border-slate-200 bg-white'
          }`}
        >
          <div className="mt-0.5 shrink-0">
            {step.done
              ? <CheckCircle2 size={20} className="text-emerald-500" />
              : <Circle size={20} className="text-slate-300" />}
          </div>
          <div className="min-w-0 flex-1">
            <p className={`text-sm font-semibold ${step.done ? 'text-slate-400 line-through' : 'text-slate-800'}`}>
              Step {i + 1}: {step.title}
            </p>
            <p className="mt-0.5 text-xs text-slate-500">{step.description}</p>
            {!step.done && step.cta && <div className="mt-3">{step.cta}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}
