import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bell, Copy, Mail, RefreshCw } from 'lucide-react';
import { fetchSoldForwardingInfo, type SoldForwardingInfo } from '../lib/api';
import { copyToClipboard, formatDateTime, formatMoney } from '../lib/format';
import { fetchSaleInboxEvents, type SaleInboxEventView } from '../lib/sales';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  LoadingScreen,
  PageHeader,
  Spinner,
  Toast,
} from '../components/ui';

const STATUS_COPY: Record<SaleInboxEventView['processing_status'], string> = {
  received: 'Received',
  matched: 'Matched',
  auto_marked_sold: 'Auto-marked sold',
  needs_review: 'Needs review',
  ignored: 'Ignored',
  error: 'Error',
};

const STATUS_TONE: Record<SaleInboxEventView['processing_status'], 'slate' | 'teal' | 'amber' | 'blue' | 'emerald' | 'rose' | 'violet'> = {
  received: 'blue',
  matched: 'teal',
  auto_marked_sold: 'emerald',
  needs_review: 'amber',
  ignored: 'slate',
  error: 'rose',
};

export function SoldInboxPage() {
  const [events, setEvents] = useState<SaleInboxEventView[]>([]);
  const [forwarding, setForwarding] = useState<SoldForwardingInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  async function load(silent = false) {
    if (silent) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);
    try {
      const [nextForwarding, nextEvents] = await Promise.all([
        fetchSoldForwardingInfo(),
        fetchSaleInboxEvents(),
      ]);
      setForwarding(nextForwarding);
      setEvents(nextEvents);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load sold inbox');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    void load();
    const interval = window.setInterval(() => {
      void load(true);
    }, 60_000);
    return () => window.clearInterval(interval);
  }, []);

  function flash(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(null), 2000);
  }

  async function handleCopyAddress() {
    if (!forwarding?.address) return;
    const copied = await copyToClipboard(forwarding.address);
    flash(copied ? 'Forwarding address copied' : 'Could not copy forwarding address');
  }

  const summary = useMemo(() => ({
    autoMarked: events.filter((event) => event.auto_marked_sold).length,
    needsReview: events.filter((event) => event.processing_status === 'needs_review').length,
  }), [events]);

  if (loading) return <LoadingScreen label="Loading sold inbox…" />;

  return (
    <div>
      <PageHeader
        title="Sold inbox"
        subtitle="Forward marketplace sold emails here and let Starsella track them"
        actions={
          <Button type="button" variant="secondary" disabled={refreshing} onClick={() => void load(true)}>
            {refreshing ? <Spinner /> : <RefreshCw size={16} />}
            Refresh
          </Button>
        }
      />

      <Toast message={toast} />
      {error && (
        <div className="mb-4">
          <Alert>{error}</Alert>
        </div>
      )}

      <Card className="mb-4 overflow-hidden bg-[radial-gradient(circle_at_top_left,_rgba(45,212,191,0.18),_transparent_42%),linear-gradient(135deg,#ffffff,#f8fafc)]">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-white/80 px-3 py-1 text-xs font-semibold text-teal-700 ring-1 ring-teal-100">
              <Bell size={14} /> Sale forwarding
            </div>
            <h2 className="text-xl font-bold tracking-tight text-slate-900">Unique forwarding address for your sold notifications</h2>
            <p className="mt-2 text-sm text-slate-600">
              Forward sold emails from Vinted, eBay, and Depop to this address. When Starsella finds an exact item number, it auto-marks the item as sold.
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-400">Forward to</p>
            <p className="mt-2 max-w-sm break-all font-mono text-sm text-slate-900">
              {forwarding?.address || 'Inbound email domain not configured yet'}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="secondary" disabled={!forwarding?.address} onClick={handleCopyAddress}>
                <Copy size={14} />
                Copy address
              </Button>
              <Link to="/settings" className="inline-flex">
                <Button type="button" size="sm" variant="ghost">
                  <Mail size={14} />
                  Open settings
                </Button>
              </Link>
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2 text-xs">
          <Badge tone="emerald">{summary.autoMarked} auto-marked sold</Badge>
          <Badge tone="amber">{summary.needsReview} need review</Badge>
          <Badge tone="blue">{events.length} emails captured</Badge>
        </div>
      </Card>

      {!forwarding?.configured && (
        <div className="mb-4">
          <Alert tone="warning">
            Inbound email is not fully configured on the server yet. Add the sold inbox domain and MX or webhook provider, then this forwarding address will go live.
          </Alert>
        </div>
      )}

      {events.length === 0 ? (
        <EmptyState
          title="No sold emails yet"
          description="Set up email forwarding from your marketplaces and sold notifications will appear here."
        />
      ) : (
        <div className="space-y-3">
          {events.map((event) => (
            <Card key={event.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={STATUS_TONE[event.processing_status]}>{STATUS_COPY[event.processing_status]}</Badge>
                    {event.source_platform ? <Badge tone="violet">{capitalize(event.source_platform)}</Badge> : null}
                    <span className="text-xs text-slate-400">{formatDateTime(event.received_at)}</span>
                  </div>
                  <p className="mt-2 text-sm font-semibold text-slate-900">
                    {event.subject || event.detected_listing_title || 'Sold email received'}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    From {event.from_address || 'unknown sender'}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Sale price</p>
                  <p className="mt-1 text-lg font-semibold text-slate-900">
                    {event.detected_sale_price != null ? formatMoney(event.detected_sale_price) : '—'}
                  </p>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-500">
                {event.detected_item_number ? <span className="rounded-full bg-slate-100 px-2.5 py-1">Item #{event.detected_item_number}</span> : null}
                {event.matched_item ? (
                  <Link to={`/items/${event.matched_item.id}`} className="rounded-full bg-emerald-50 px-2.5 py-1 font-medium text-emerald-700 hover:underline">
                    Matched {event.matched_item.item_number}
                  </Link>
                ) : null}
                {event.auto_marked_sold ? <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-emerald-700">Item status updated automatically</span> : null}
              </div>

              {event.body_excerpt ? (
                <div className="mt-3 rounded-xl bg-slate-50 p-3 text-xs leading-6 text-slate-600">
                  {event.body_excerpt}
                </div>
              ) : null}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}