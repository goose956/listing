import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Plus, Search } from 'lucide-react';
import { fetchItems } from '../lib/items';
import type { Item, ItemStatus } from '../types';
import { STATUS_LABELS } from '../types';
import {
  Alert,
  Button,
  EmptyState,
  Input,
  LoadingScreen,
  PageHeader,
  cn,
} from '../components/ui';
import { ItemCard } from '../components/ItemCard';

const FILTERS: Array<{ key: 'all' | ItemStatus; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'new', label: 'New' },
  { key: 'ready_for_listing', label: 'Ready' },
  { key: 'listed', label: 'Listed' },
  { key: 'sold', label: 'Sold' },
  { key: 'archived', label: 'Archived' },
];

export function InventoryPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState(searchParams.get('q') || '');
  const [debounced, setDebounced] = useState(searchParams.get('q') || '');
  const [status, setStatus] = useState<'all' | ItemStatus>(
    (searchParams.get('status') as ItemStatus) || 'all'
  );

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  // Keep URL in sync with filters so dashboard links work
  useEffect(() => {
    const params = new URLSearchParams();
    if (debounced) params.set('q', debounced);
    if (status !== 'all') params.set('status', status);
    setSearchParams(params, { replace: true });
  }, [debounced, status, setSearchParams]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchItems({
          search: debounced || undefined,
          status: status === 'all' ? undefined : status,
        });
        if (!cancelled) setItems(data);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load inventory');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [debounced, status]);

  const countLabel = useMemo(() => {
    if (status === 'all') return `${items.length} items`;
    return `${items.length} ${STATUS_LABELS[status].toLowerCase()}`;
  }, [items.length, status]);

  return (
    <div>
      <PageHeader
        title="Inventory"
        subtitle={countLabel}
        actions={
          <Link to="/add">
            <Button>
              <Plus size={18} />
              Add item
            </Button>
          </Link>
        }
      />

      <div className="mb-4 space-y-3">
        <div className="relative">
          <Search
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
          />
          <Input
            className="pl-9"
            placeholder='Search — e.g. "Nike", "Container 3", "V-00012"'
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setStatus(f.key)}
              className={cn(
                'shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition',
                status === f.key
                  ? 'bg-teal-600 text-white'
                  : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="mb-4">
          <Alert>{error}</Alert>
        </div>
      )}

      {loading ? (
        <LoadingScreen />
      ) : items.length === 0 ? (
        <EmptyState
          title="No items found"
          description={
            debounced || status !== 'all'
              ? 'Try a different search or filter.'
              : 'Start by photographing items at a boot sale.'
          }
          action={
            !debounced && status === 'all' ? (
              <Link to="/add">
                <Button>Add item</Button>
              </Link>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-2.5">
          {items.map((item) => (
            <ItemCard key={item.id} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}
