import { useEffect, useMemo, useState } from 'react';
import { Download, Landmark, Receipt, Search, Wallet } from 'lucide-react';
import { fetchItems } from '../lib/items';
import { buildFinanceSummary, getItemFinanceSummary } from '../lib/finance';
import type { Item } from '../types';
import { formatDate, formatMoney } from '../lib/format';
import {
  Alert,
  Button,
  Card,
  EmptyState,
  Input,
  LoadingScreen,
  PageHeader,
  Spinner,
  StatCard,
} from '../components/ui';

type SoldRange = 'all' | '30d' | '90d' | 'year';

const RANGE_OPTIONS: Array<{ key: SoldRange; label: string }> = [
  { key: 'all', label: 'All time' },
  { key: '30d', label: 'Last 30 days' },
  { key: '90d', label: 'Last 90 days' },
  { key: 'year', label: 'Last 12 months' },
];

export function FinancePage() {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [range, setRange] = useState<SoldRange>('90d');
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchItems();
        if (!cancelled) setItems(data);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load finance data');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const soldItems = useMemo(() => items.filter((item) => item.status === 'sold'), [items]);

  const filteredSoldItems = useMemo(() => {
    const threshold = getRangeStart(range);
    const normalizedQuery = query.trim().toLowerCase();

    return soldItems.filter((item) => {
      const soldDate = item.sold_date ? new Date(item.sold_date) : null;
      if (threshold && (!soldDate || soldDate < threshold)) return false;

      if (!normalizedQuery) return true;
      const haystack = [
        item.item_number,
        item.title,
        item.brand,
        item.product_type,
        item.marketplace,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [query, range, soldItems]);

  const summary = useMemo(() => buildFinanceSummary(filteredSoldItems.length > 0 ? filteredSoldItems : []), [filteredSoldItems]);
  const portfolio = useMemo(() => buildFinanceSummary(items), [items]);

  function handleExport() {
    if (filteredSoldItems.length === 0) return;
    setExporting(true);
    try {
      downloadFinanceCsv(filteredSoldItems, range);
    } finally {
      setExporting(false);
    }
  }

  if (loading) return <LoadingScreen label="Loading finance…" />;

  return (
    <div>
      <PageHeader
        title="Finance"
        subtitle="Track sold performance, net profit, and export accountant-friendly reports"
        actions={
          <Button type="button" variant="secondary" disabled={exporting || filteredSoldItems.length === 0} onClick={handleExport}>
            {exporting ? <Spinner /> : <Download size={18} />}
            Export sold report
          </Button>
        }
      />

      {error ? (
        <div className="mb-4">
          <Alert>{error}</Alert>
        </div>
      ) : null}

      {summary.missingPurchasePriceCount > 0 ? (
        <div className="mb-4">
          <Alert tone="warning">
            {summary.missingPurchasePriceCount} sold item{summary.missingPurchasePriceCount === 1 ? '' : 's'} in this report have no purchase cost recorded. Their profit is currently treated as 100% of the sale price before fees and shipping costs.
          </Alert>
        </div>
      ) : null}

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Revenue" value={formatMoney(summary.revenue)} icon={<Wallet size={18} />} />
        <StatCard label="Gross profit" value={formatMoney(summary.grossProfit)} hint={`${summary.soldCount} sold items`} icon={<Landmark size={18} />} />
        <StatCard label="Net profit" value={formatMoney(summary.netProfit)} hint={`Avg ${formatMoney(summary.averageNetProfit)}`} icon={<Receipt size={18} />} />
        <StatCard label="Extra costs" value={formatMoney(summary.totalExtraCosts)} hint="Fees, postage, packaging" />
        <StatCard label="Stock spend" value={formatMoney(portfolio.inventorySpend)} hint="All recorded purchase costs" />
        <StatCard label="Unsold stock cost" value={formatMoney(portfolio.unsoldInventoryCost)} hint="Cash tied up in inventory" />
      </div>

      <Card className="mb-4">
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
          <div className="relative">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input className="pl-9" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search sold items by item number, title, brand, or marketplace" />
          </div>
          <div className="flex flex-wrap gap-2">
            {RANGE_OPTIONS.map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => setRange(option.key)}
                className={range === option.key
                  ? 'rounded-full bg-teal-50 px-3 py-2 text-xs font-semibold text-teal-800 ring-1 ring-teal-200'
                  : 'rounded-full bg-white px-3 py-2 text-xs font-medium text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </Card>

      {filteredSoldItems.length === 0 ? (
        <EmptyState
          title="No sold items in this view"
          description="Record sale prices and costs on items, then your finance report will appear here."
        />
      ) : (
        <Card padding={false}>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-[0.15em] text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Item</th>
                  <th className="px-4 py-3 font-medium">Sold</th>
                  <th className="px-4 py-3 font-medium">Revenue</th>
                  <th className="px-4 py-3 font-medium">Cost basis</th>
                  <th className="px-4 py-3 font-medium">Gross</th>
                  <th className="px-4 py-3 font-medium">Costs</th>
                  <th className="px-4 py-3 font-medium">Net</th>
                  <th className="px-4 py-3 font-medium">Payout</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {filteredSoldItems.map((item) => {
                  const finance = getItemFinanceSummary(item);
                  return (
                    <tr key={item.id}>
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-900">{item.item_number}</div>
                        <div className="text-xs text-slate-500">{item.title || [item.brand, item.product_type].filter(Boolean).join(' ') || 'Untitled item'}</div>
                      </td>
                      <td className="px-4 py-3 text-slate-600">{formatDate(item.sold_date)}</td>
                      <td className="px-4 py-3 font-medium text-slate-900">{formatMoney(item.sale_price)}</td>
                      <td className="px-4 py-3 text-slate-700">
                        {finance.purchasePriceRecorded ? (
                          formatMoney(item.purchase_price)
                        ) : (
                          <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800">No cost recorded</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-700">{formatMoney(finance.grossProfit)}</td>
                      <td className="px-4 py-3 text-slate-700">{formatMoney(finance.extraCosts)}</td>
                      <td className="px-4 py-3 font-semibold text-emerald-700">{formatMoney(finance.netProfit)}</td>
                      <td className="px-4 py-3 text-slate-600">{item.payout_received_at ? formatDate(item.payout_received_at) : 'Pending'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

function getRangeStart(range: SoldRange): Date | null {
  const now = new Date();
  if (range === '30d') return new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30);
  if (range === '90d') return new Date(now.getFullYear(), now.getMonth(), now.getDate() - 90);
  if (range === 'year') return new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
  return null;
}

function downloadFinanceCsv(items: Item[], range: SoldRange) {
  const csv = buildFinanceCsv(items);
  const blob = new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const stamp = new Date().toISOString().slice(0, 10);
  link.href = url;
  link.download = `starsella-finance-${range}-${stamp}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function buildFinanceCsv(items: Item[]): string {
  const headers = [
    'item_number',
    'title',
    'brand',
    'product_type',
    'marketplace',
    'sold_date',
    'payout_received_at',
    'purchase_price',
    'purchase_price_recorded',
    'sale_price',
    'platform_fee',
    'shipping_cost',
    'packaging_cost',
    'other_costs',
    'gross_profit',
    'net_profit',
    'storage_location',
  ];

  const rows = items.map((item) => {
    const finance = getItemFinanceSummary(item);
    return [
      item.item_number,
      item.title ?? '',
      item.brand ?? '',
      item.product_type ?? '',
      item.marketplace ?? '',
      item.sold_date ?? '',
      item.payout_received_at ?? '',
      item.purchase_price ?? '',
      finance.purchasePriceRecorded ? 'yes' : 'no',
      item.sale_price ?? '',
      item.platform_fee ?? '',
      item.shipping_cost ?? '',
      item.packaging_cost ?? '',
      item.other_costs ?? '',
      finance.grossProfit ?? '',
      finance.netProfit ?? '',
      [item.storage_container, item.storage_shelf, item.storage_box].filter(Boolean).join(' / '),
    ];
  });

  return [headers, ...rows].map((row) => row.map(escapeCsv).join(',')).join('\n');
}

function escapeCsv(value: string | number | null): string {
  const text = value == null ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}