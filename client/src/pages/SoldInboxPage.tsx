import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bell, Copy, Mail, Printer, RefreshCw, Search, ShieldCheck, Trash2 } from 'lucide-react';
import { fetchSoldForwardingInfo, reviewSaleInboxEvent, type SoldForwardingInfo } from '../lib/api';
import { copyToClipboard, formatDateTime, formatMoney } from '../lib/format';
import { fetchSaleInboxEvents, type SaleInboxEventView } from '../lib/sales';
import { fetchItems } from '../lib/items';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  LoadingScreen,
  PageHeader,
  Select,
  Spinner,
  Toast,
} from '../components/ui';

const STATUS_COPY: Record<SaleInboxEventView['processing_status'], string> = {
  received: 'Received',
  matched: 'Matched',
  auto_marked_sold: 'Auto-marked sold',
  manually_marked_sold: 'Marked sold',
  needs_review: 'Needs review',
  ignored: 'Ignored',
  error: 'Error',
};

const STATUS_TONE: Record<SaleInboxEventView['processing_status'], 'slate' | 'teal' | 'amber' | 'blue' | 'emerald' | 'rose' | 'violet'> = {
  received: 'blue',
  matched: 'teal',
  auto_marked_sold: 'emerald',
  manually_marked_sold: 'emerald',
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
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [actioningId, setActioningId] = useState<string | null>(null);
  const [searchingId, setSearchingId] = useState<string | null>(null);
  const [matchQuery, setMatchQuery] = useState<Record<string, string>>({});
  const [matchOptions, setMatchOptions] = useState<Record<string, Array<{ id: string; item_number: string; title: string | null; status: string }>>>({});
  const [selectedMatch, setSelectedMatch] = useState<Record<string, string>>({});

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

  function toggleSelected(eventId: string) {
    setSelectedIds((current) => current.includes(eventId)
      ? current.filter((id) => id !== eventId)
      : [...current, eventId]);
  }

  function selectPrintable() {
    setSelectedIds(events.filter(hasBuyerAddress).map((event) => event.id));
  }

  function clearSelection() {
    setSelectedIds([]);
  }

  async function handleSearchMatches(event: SaleInboxEventView) {
    const query = (matchQuery[event.id] ?? getDefaultMatchQuery(event)).trim();
    if (!query) {
      flash('Add an item number or title to search');
      return;
    }

    setSearchingId(event.id);
    try {
      const items = await fetchItems({ search: query, status: ['new', 'ready_for_listing', 'listed', 'sold'], limit: 8 });
      const options = items.map((item) => ({
        id: item.id,
        item_number: item.item_number,
        title: item.title,
        status: item.status,
      }));
      setMatchOptions((current) => ({ ...current, [event.id]: options }));
      if (options.length === 1) {
        setSelectedMatch((current) => ({ ...current, [event.id]: options[0].id }));
      }
      flash(options.length > 0 ? `Found ${options.length} item match${options.length === 1 ? '' : 'es'}` : 'No matching items found');
    } catch (err) {
      flash(err instanceof Error ? err.message : 'Item search failed');
    } finally {
      setSearchingId(null);
    }
  }

  async function handleReviewAction(event: SaleInboxEventView, action: 'ignore' | 'reopen' | 'match_item' | 'match_and_mark_sold') {
    const matchedItemId = selectedMatch[event.id] || event.matched_item_id || undefined;
    if ((action === 'match_item' || action === 'match_and_mark_sold') && !matchedItemId) {
      flash('Select a matching item first');
      return;
    }

    setActioningId(event.id);
    setError(null);
    try {
      await reviewSaleInboxEvent(event.id, { action, matchedItemId });
      await load(true);
      flash(action === 'ignore'
        ? 'Event ignored'
        : action === 'reopen'
          ? 'Event moved back to review'
          : action === 'match_item'
            ? 'Item matched'
            : 'Item marked sold');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Review action failed');
    } finally {
      setActioningId(null);
    }
  }

  function handlePrintSelectedLabels() {
    const printableEvents = events.filter((event) => selectedIds.includes(event.id) && hasBuyerAddress(event));
    printLabels(printableEvents);
  }

  function handlePrintSingleLabel(event: SaleInboxEventView) {
    printLabels([event]);
  }

  function printLabels(printableEvents: SaleInboxEventView[]) {
    if (printableEvents.length === 0) {
      flash('Select at least one sold email with a buyer address');
      return;
    }

    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    iframe.setAttribute('aria-hidden', 'true');

    const cleanup = () => {
      window.setTimeout(() => iframe.remove(), 500);
    };

    iframe.onload = () => {
      const printFrame = iframe.contentWindow;
      if (!printFrame) {
        cleanup();
        setError('Could not open label print preview');
        return;
      }

      printFrame.onafterprint = cleanup;
      printFrame.focus();
      window.setTimeout(() => printFrame.print(), 250);
    };

    document.body.appendChild(iframe);

    const doc = iframe.contentDocument;
    if (!doc) {
      cleanup();
      setError('Could not prepare label print preview');
      return;
    }

    doc.open();
    doc.write(buildLabelPrintDocument(printableEvents));
    doc.close();
  }

  const summary = useMemo(() => ({
    autoMarked: events.filter((event) => event.auto_marked_sold).length,
    needsReview: events.filter((event) => event.processing_status === 'needs_review').length,
    printable: events.filter(hasBuyerAddress).length,
  }), [events]);

  if (loading) return <LoadingScreen label="Loading sold inbox…" />;

  return (
    <div>
      <PageHeader
        title="Sold inbox"
        subtitle="Forward marketplace sold emails here and let Starsella track them"
        actions={
          <>
            <Button type="button" variant="secondary" disabled={summary.printable === 0} onClick={selectPrintable}>
              Select printable
            </Button>
            <Button type="button" variant="secondary" disabled={selectedIds.length === 0} onClick={handlePrintSelectedLabels}>
              <Printer size={16} />
              Print labels
            </Button>
            <Button type="button" variant="ghost" disabled={selectedIds.length === 0} onClick={clearSelection}>
              Clear
            </Button>
            <Button type="button" variant="secondary" disabled={refreshing} onClick={() => void load(true)}>
              {refreshing ? <Spinner /> : <RefreshCw size={16} />}
              Refresh
            </Button>
          </>
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
          <Badge tone="teal">{summary.printable} labels ready</Badge>
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
                    {hasBuyerAddress(event) ? (
                      <label className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">
                        <input
                          type="checkbox"
                          className="rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                          checked={selectedIds.includes(event.id)}
                          onChange={() => toggleSelected(event.id)}
                        />
                        Label
                      </label>
                    ) : null}
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

              <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Buyer address</p>
                  {hasBuyerAddress(event) ? (
                    <div className="mt-2 rounded-xl border border-slate-200 bg-white p-3 text-sm leading-6 text-slate-700">
                      {buildPrintableAddressLines(event).map((line, index) => (
                        <div key={`${event.id}-address-${index}`}>{line}</div>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-2 text-sm text-slate-500">No buyer address detected in this email yet.</p>
                  )}
                </div>

                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Review actions</p>
                  <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
                    {!event.matched_item ? (
                      <div className="space-y-2">
                        <div className="flex gap-2">
                          <Input
                            value={matchQuery[event.id] ?? getDefaultMatchQuery(event)}
                            onChange={(e) => setMatchQuery((current) => ({ ...current, [event.id]: e.target.value }))}
                            placeholder="Search item number or title"
                          />
                          <Button
                            type="button"
                            variant="secondary"
                            disabled={searchingId === event.id}
                            onClick={() => void handleSearchMatches(event)}
                          >
                            {searchingId === event.id ? <Spinner /> : <Search size={14} />}
                            Find
                          </Button>
                        </div>
                        <Select
                          value={selectedMatch[event.id] ?? ''}
                          onChange={(e) => setSelectedMatch((current) => ({ ...current, [event.id]: e.target.value }))}
                        >
                          <option value="">Select matching item</option>
                          {(matchOptions[event.id] ?? []).map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.item_number} · {item.title || item.status}
                            </option>
                          ))}
                        </Select>
                      </div>
                    ) : (
                      <div className="rounded-xl bg-white px-3 py-2 text-sm text-slate-700">
                        Working with matched item {event.matched_item.item_number}
                      </div>
                    )}

                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        disabled={actioningId === event.id}
                        onClick={() => void handleReviewAction(event, 'match_item')}
                      >
                        <ShieldCheck size={14} />
                        Match item
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="success"
                        disabled={actioningId === event.id}
                        onClick={() => void handleReviewAction(event, 'match_and_mark_sold')}
                      >
                        <ShieldCheck size={14} />
                        Mark sold
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={actioningId === event.id}
                        onClick={() => void handleReviewAction(event, 'reopen')}
                      >
                        Needs review
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={actioningId === event.id}
                        onClick={() => void handleReviewAction(event, 'ignore')}
                      >
                        <Trash2 size={14} />
                        Ignore
                      </Button>
                      {hasBuyerAddress(event) ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => handlePrintSingleLabel(event)}
                        >
                          <Printer size={14} />
                          Print label
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </div>
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

function getDefaultMatchQuery(event: SaleInboxEventView): string {
  return event.detected_item_number || event.detected_listing_title || event.subject || '';
}

function hasBuyerAddress(event: SaleInboxEventView): boolean {
  return Array.isArray(event.buyer_address_lines) && event.buyer_address_lines.length > 0;
}

function buildPrintableAddressLines(event: SaleInboxEventView): string[] {
  const lines = [
    event.buyer_name,
    ...(event.buyer_address_lines ?? []),
  ].filter((value): value is string => Boolean(value?.trim()));

  const merged = [...lines];
  const mergedText = merged.join(' ').toLowerCase();
  if (event.buyer_postcode && !mergedText.includes(event.buyer_postcode.toLowerCase())) {
    merged.push(event.buyer_postcode);
  }
  if (event.buyer_country && !mergedText.includes(event.buyer_country.toLowerCase())) {
    merged.push(event.buyer_country);
  }
  return merged;
}

function buildLabelPrintDocument(events: SaleInboxEventView[]): string {
  const pages = chunk(events, 8);
  const body = pages.map((page) => `
    <section class="page">
      <div class="grid">
        ${page.map((event) => `
          <article class="label">
            <div>
              <div class="label-lines">
                ${buildPrintableAddressLines(event).map((line) => `<div>${escapeHtml(line)}</div>`).join('')}
              </div>
            </div>
            <div class="meta">
              <div>${escapeHtml(event.matched_item?.item_number || event.detected_item_number || 'Sold item')}</div>
              <div>${escapeHtml(capitalize(event.source_platform || 'marketplace'))} · ${escapeHtml(formatDateTime(event.received_at))}</div>
            </div>
          </article>
        `).join('')}
      </div>
    </section>
  `).join('');

  return `<!doctype html>
  <html>
    <head>
      <meta charset="utf-8" />
      <title>Sold labels</title>
      <style>
        @page { size: A4 portrait; margin: 8mm; }
        * { box-sizing: border-box; }
        body { margin: 0; font-family: Arial, sans-serif; color: #0f172a; }
        .page { page-break-after: always; }
        .page:last-child { page-break-after: auto; }
        .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 4mm; }
        .label {
          min-height: 64mm;
          border: 1px solid #cbd5e1;
          border-radius: 4mm;
          padding: 6mm;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          break-inside: avoid;
        }
        .label-lines {
          font-size: 16px;
          line-height: 1.45;
          font-weight: 600;
          white-space: pre-wrap;
        }
        .meta {
          margin-top: 6mm;
          font-size: 10px;
          line-height: 1.4;
          color: #475569;
          text-transform: uppercase;
          letter-spacing: 0.08em;
        }
      </style>
    </head>
    <body>${body}</body>
  </html>`;
}

function chunk<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}