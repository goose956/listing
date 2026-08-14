import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Download, Plus, Search, ShoppingBag } from 'lucide-react';
import { createEbayListing, EbayListingError, getEbayStatus } from '../lib/ebay';
import { deleteItem, fetchItem, fetchItems } from '../lib/items';
import type { Item, ItemStatus } from '../types';
import { STATUS_LABELS } from '../types';
import {
  Alert,
  Button,
  EmptyState,
  Input,
  LoadingScreen,
  PageHeader,
  Spinner,
  Toast,
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
  const [toast, setToast] = useState<string | null>(null);
  const [search, setSearch] = useState(searchParams.get('q') || '');
  const [debounced, setDebounced] = useState(searchParams.get('q') || '');
  const [status, setStatus] = useState<'all' | ItemStatus>(
    (searchParams.get('status') as ItemStatus) || 'all'
  );
  const [ebayConnected, setEbayConnected] = useState(false);
  const [listingItemId, setListingItemId] = useState<string | null>(null);
  const [exporting, setExporting] = useState<'filtered' | 'all' | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    let cancelled = false;
    getEbayStatus()
      .then((data) => {
        if (!cancelled) setEbayConnected(Boolean(data.connected));
      })
      .catch(() => {
        if (!cancelled) setEbayConnected(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

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

  async function handleDelete(itemId: string, itemNumber: string) {
    if (!confirm(`Remove ${itemNumber} from inventory? This cannot be undone.`)) return;
    try {
      await deleteItem(itemId);
      setItems((prev) => prev.filter((i) => i.id !== itemId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    }
  }

  function flash(message: string) {
    setToast(message);
    setTimeout(() => setToast(null), 2000);
  }

  async function handleListOnEbay(item: Item) {
    if (listingItemId) return;

    const startPrice = item.platform_prices?.ebay ?? item.list_price ?? item.suggested_price;
    if (startPrice == null || Number.isNaN(Number(startPrice)) || Number(startPrice) <= 0) {
      setError(`Add a valid list price before publishing ${item.item_number} to eBay.`);
      return;
    }

    setListingItemId(item.id);
    setError(null);
    try {
      const result = await createEbayListing({
        itemId: item.id,
        listingType: 'FIXED_PRICE',
        startPrice: Number(startPrice),
      });

      const refreshed = await fetchItem(item.id);
      if (refreshed) {
        setItems((current) => current.map((entry) => (entry.id === item.id ? refreshed : entry)));
      }

      flash(`Published ${item.item_number} to eBay as ${result.listingId}`);
    } catch (err) {
      if (err instanceof EbayListingError && err.missingAspects.length > 0) {
        setError(`eBay needs more specifics for ${item.item_number}: ${err.missingAspects.join(', ')}.`);
      } else {
        setError(err instanceof Error ? err.message : 'Failed to publish item to eBay');
      }
    } finally {
      setListingItemId(null);
    }
  }

  async function handleExportInventory(scope: 'filtered' | 'all') {
    setExporting(scope);
    setError(null);
    try {
      const exportItems = scope === 'all'
        ? await fetchItems()
        : items;

      if (exportItems.length === 0) {
        flash('No inventory items to export');
        return;
      }

      downloadInventoryCsv(exportItems, scope);
      flash(`Exported ${exportItems.length} ${scope === 'all' ? 'inventory' : 'filtered'} items to spreadsheet`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to export inventory');
    } finally {
      setExporting(null);
    }
  }

  return (
    <div>
      <Toast message={toast} />

      <PageHeader
        title="Inventory"
        subtitle={countLabel}
        actions={
          <>
            <Button
              type="button"
              variant="secondary"
              disabled={exporting != null || items.length === 0}
              onClick={() => void handleExportInventory('filtered')}
            >
              {exporting === 'filtered' ? <Spinner /> : <Download size={18} />}
              Export filtered
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={exporting != null}
              onClick={() => void handleExportInventory('all')}
            >
              {exporting === 'all' ? <Spinner /> : <Download size={18} />}
              Export all
            </Button>
            <Link to="/add">
              <Button>
                <Plus size={18} />
                Add item
              </Button>
            </Link>
          </>
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
            <ItemCard
              key={item.id}
              item={item}
              onDelete={() => handleDelete(item.id, item.item_number)}
              footerAction={
                ebayConnected && item.status === 'listed' && !item.ebay_listing_id ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={listingItemId != null}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      void handleListOnEbay(item);
                    }}
                  >
                    {listingItemId === item.id ? <Spinner className="border-t-teal-600" /> : <ShoppingBag size={14} />}
                    {item.posted_marketplaces.includes('ebay') ? 'Relist on eBay' : 'List on eBay'}
                  </Button>
                ) : undefined
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

function downloadInventoryCsv(items: Item[], scope: 'filtered' | 'all') {
  const csv = buildInventoryCsv(items);
  const blob = new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const stamp = new Date().toISOString().slice(0, 10);
  link.href = url;
  link.download = `starsella-inventory-${scope}-${stamp}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function buildInventoryCsv(items: Item[]): string {
  const maxImages = items.reduce((max, item) => Math.max(max, item.item_images?.length ?? 0), 0);
  const headers = [
    'item_number',
    'headline',
    'text',
    'status',
    'brand',
    'product_type',
    'category',
    'size',
    'colour',
    'condition',
    'purchase_price',
    'suggested_price',
    'listed_price',
    'sale_price',
    'accept_offers_above',
    'posted_marketplaces',
    'storage_container',
    'storage_shelf',
    'storage_box',
    'storage_notes',
    'date_added',
    'listed_date',
    'sold_date',
    'ebay_listing_id',
    'ebay_listing_url',
    'primary_image_url',
    'image_count',
    'image_links',
    ...Array.from({ length: maxImages }, (_, index) => `image_${index + 1}`),
  ];

  const rows = items.map((item) => {
    const imageUrls = (item.item_images ?? []).map((image) => image.public_url).filter(Boolean);
    return [
      item.item_number,
      item.title ?? '',
      item.description ?? '',
      STATUS_LABELS[item.status],
      item.brand ?? '',
      item.product_type ?? '',
      item.category ?? '',
      item.size ?? '',
      item.colour ?? '',
      item.condition ?? '',
      item.purchase_price ?? '',
      item.suggested_price ?? '',
      item.list_price ?? item.suggested_price ?? '',
      item.sale_price ?? '',
      item.accept_offers_above ?? '',
      item.posted_marketplaces.join(', '),
      item.storage_container ?? '',
      item.storage_shelf ?? '',
      item.storage_box ?? '',
      item.storage_notes ?? '',
      item.date_added ?? '',
      item.listed_date ?? '',
      item.sold_date ?? '',
      item.ebay_listing_id ?? '',
      item.ebay_listing_url ?? '',
      item.primary_image_url ?? imageUrls[0] ?? '',
      imageUrls.length,
      imageUrls.join('\n'),
      ...Array.from({ length: maxImages }, (_, index) => imageUrls[index] ?? ''),
    ];
  });

  return [headers, ...rows]
    .map((row) => row.map(csvCell).join(','))
    .join('\r\n');
}

function csvCell(value: string | number | null | undefined): string {
  const text = value == null ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}
