import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Package, Search } from 'lucide-react';
import { fetchItems } from '../lib/items';
import type { Item } from '../types';
import { storageLabel } from '../lib/format';
import {
  Alert,
  Card,
  EmptyState,
  Input,
  LoadingScreen,
  PageHeader,
  Badge,
} from '../components/ui';

interface LocationGroup {
  key: string;
  container: string;
  box: string;
  shelf: string;
  items: Item[];
}

export function StoragePage() {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchItems({
          status: ['new', 'ready_for_listing', 'listed'],
        });
        if (!cancelled) setItems(data);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const groups = useMemo(() => {
    const map = new Map<string, LocationGroup>();
    for (const item of items) {
      const container = item.storage_container?.trim() || 'Unassigned';
      const box = item.storage_box?.trim() || '';
      const shelf = item.storage_shelf?.trim() || '';
      const key = `${container}||${shelf}||${box}`;
      if (!map.has(key)) {
        map.set(key, { key, container, box, shelf, items: [] });
      }
      map.get(key)!.items.push(item);
    }

    let list = Array.from(map.values()).sort((a, b) => {
      if (a.container === 'Unassigned') return 1;
      if (b.container === 'Unassigned') return -1;
      return a.container.localeCompare(b.container) || a.box.localeCompare(b.box);
    });

    if (filter.trim()) {
      const q = filter.trim().toLowerCase();
      list = list.filter(
        (g) =>
          g.container.toLowerCase().includes(q) ||
          g.box.toLowerCase().includes(q) ||
          g.shelf.toLowerCase().includes(q) ||
          g.items.some(
            (i) =>
              i.item_number.toLowerCase().includes(q) ||
              i.brand?.toLowerCase().includes(q) ||
              i.product_type?.toLowerCase().includes(q)
          )
      );
    }

    return list;
  }, [items, filter]);

  if (loading) return <LoadingScreen />;

  return (
    <div>
      <PageHeader
        title="Storage"
        subtitle="Find where items live — containers, shelves, boxes"
      />

      <div className="relative mb-4">
        <Search
          size={16}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
        />
        <Input
          className="pl-9"
          placeholder='e.g. "Container 2", "Box 14", brand…'
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>

      {error && (
        <div className="mb-4">
          <Alert>{error}</Alert>
        </div>
      )}

      {groups.length === 0 ? (
        <EmptyState
          title="No storage data yet"
          description="Set container / box on items when you put them away."
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {groups.map((g) => (
            <Card key={g.key}>
              <div className="mb-3 flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold text-slate-900">{g.container}</p>
                  <p className="text-xs text-slate-500">
                    {[g.shelf && `Shelf ${g.shelf}`, g.box && `Box ${g.box}`]
                      .filter(Boolean)
                      .join(' · ') || 'No box/shelf'}
                  </p>
                </div>
                <Badge tone="teal">
                  <span className="inline-flex items-center gap-1">
                    <Package size={12} />
                    {g.items.length}
                  </span>
                </Badge>
              </div>
              <ul className="max-h-64 space-y-2 overflow-y-auto">
                {g.items.map((item) => (
                  <li key={item.id}>
                    <Link
                      to={`/items/${item.id}`}
                      className="flex items-center gap-2 rounded-lg px-1 py-1 hover:bg-slate-50"
                    >
                      <div className="h-9 w-9 shrink-0 overflow-hidden rounded-lg bg-slate-100">
                        {item.primary_image_url && (
                          <img
                            src={item.primary_image_url}
                            alt=""
                            className="h-full w-full object-cover"
                          />
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-xs font-medium text-slate-800">
                          <span className="font-mono text-teal-700">{item.item_number}</span>{' '}
                          {item.brand || item.product_type || 'Item'}
                        </p>
                        <p className="truncate text-[11px] text-slate-400">
                          {storageLabel(item)}
                        </p>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
