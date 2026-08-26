import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Check,
  CheckSquare,
  Copy,
  ExternalLink,
  Mail,
  Printer,
  SkipForward,
  Square,
  X,
} from 'lucide-react';
import {
  cancelQueueEntry,
  completeQueueEntry,
  fetchQueue,
  skipQueueEntry,
} from '../lib/items';
import { sendListingsEmail } from '../lib/api';
import type { ListingQueueEntry } from '../types';
import { copyToClipboard, formatDateTime, formatMoney, formatRelative } from '../lib/format';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  LoadingScreen,
  PageHeader,
  Spinner,
} from '../components/ui';
import { ImageViewer } from '../components/ImageViewer';
import { format, isToday, isTomorrow, parseISO, startOfDay } from 'date-fns';

export function QueuePage() {
  const [queue, setQueue] = useState<ListingQueueEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [emailingAll, setEmailingAll] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setQueue(await fetchQueue());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load queue');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    setSelectedIds((current) => current.filter((id) => queue.some((entry) => entry.id === id)));
  }, [queue]);

  function flash(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2000);
  }

  const grouped = useMemo(() => {
    const map = new Map<string, ListingQueueEntry[]>();
    for (const entry of queue) {
      const d = parseISO(entry.scheduled_at);
      let key: string;
      if (isToday(d)) key = 'Today';
      else if (isTomorrow(d)) key = 'Tomorrow';
      else key = format(startOfDay(d), 'EEEE d MMM');
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(entry);
    }
    return Array.from(map.entries());
  }, [queue]);

  const dueNow = useMemo(() => {
    const now = Date.now();
    return queue.filter((e) => parseISO(e.scheduled_at).getTime() <= now);
  }, [queue]);

  const printableEntries = useMemo(
    () => queue.filter((entry) => selectedIds.includes(entry.id)),
    [queue, selectedIds]
  );

  const printableCount = printableEntries.length;

  async function handleCopy(text: string, label: string) {
    const ok = await copyToClipboard(text || '');
    flash(ok ? `${label} copied` : 'Nothing to copy');
  }

  async function handleComplete(entry: ListingQueueEntry) {
    setBusyId(entry.id);
    try {
      await completeQueueEntry(entry.id, entry.item_id, entry.platform);
      flash('Marked listed');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setBusyId(null);
    }
  }

  async function handleSkip(entry: ListingQueueEntry) {
    setBusyId(entry.id);
    try {
      await skipQueueEntry(entry.id);
      await load();
    } finally {
      setBusyId(null);
    }
  }

  async function handleCancel(entry: ListingQueueEntry) {
    setBusyId(entry.id);
    try {
      await cancelQueueEntry(entry.id);
      await load();
    } finally {
      setBusyId(null);
    }
  }

  async function handleEmailAll() {
    const ready = queue.filter((e) => e.items?.title && e.items?.description);
    if (!ready.length) {
      flash('No listings with title + description yet');
      return;
    }
    setEmailingAll(true);
    setError(null);
    try {
      await sendListingsEmail(
        ready.map((e) => ({
          item_number: e.items?.item_number,
          title: e.items?.title || undefined,
          description: e.items?.description || undefined,
          list_price: e.items?.list_price ?? e.items?.suggested_price ?? null,
          size: e.items?.size || null,
          colour: e.items?.colour || null,
          brand: e.items?.brand || null,
          tags: e.items?.tags || null,
          image_urls: e.items?.item_images?.map((i) => i.public_url) || [],
        }))
      );
      flash(`Emailed ${ready.length} listing${ready.length > 1 ? 's' : ''}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Email failed');
    } finally {
      setEmailingAll(false);
    }
  }

  function toggleSelected(entryId: string) {
    setSelectedIds((current) => (
      current.includes(entryId)
        ? current.filter((id) => id !== entryId)
        : [...current, entryId]
    ));
  }

  function selectAllVisible() {
    setSelectedIds(queue.map((entry) => entry.id));
  }

  function clearSelection() {
    setSelectedIds([]);
  }

  function handlePrintSelected() {
    if (printableEntries.length === 0) {
      flash('Select at least one pending listing to print');
      return;
    }

    setError(null);

    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    iframe.setAttribute('aria-hidden', 'true');

    const cleanup = () => {
      window.setTimeout(() => {
        iframe.remove();
      }, 500);
    };

    iframe.onload = () => {
      const printFrame = iframe.contentWindow;
      if (!printFrame) {
        cleanup();
        setError('Could not open print preview');
        return;
      }

      printFrame.onafterprint = cleanup;
      printFrame.focus();
      window.setTimeout(() => {
        printFrame.print();
      }, 250);
    };

    document.body.appendChild(iframe);

    const doc = iframe.contentDocument;
    if (!doc) {
      cleanup();
      setError('Could not prepare print preview');
      return;
    }

    doc.open();
    doc.write(buildPrintDocument(printableEntries));
    doc.close();
  }

  if (loading) return <LoadingScreen label="Loading queue…" />;

  return (
    <div>
      <PageHeader
        title="Listing queue"
        subtitle="Prepare listings, copy content, post manually on Vinted"
        actions={
          queue.length > 0 ? (
            <>
              <Button
                type="button"
                variant="secondary"
                disabled={printableCount === 0}
                onClick={handlePrintSelected}
              >
                <Printer size={16} />
                Print selected
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={queue.length === 0 || printableCount === queue.length}
                onClick={selectAllVisible}
              >
                <CheckSquare size={16} />
                Select all
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={printableCount === 0}
                onClick={clearSelection}
              >
                <Square size={16} />
                Clear
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={emailingAll}
                onClick={handleEmailAll}
              >
                {emailingAll ? <Spinner /> : <Mail size={16} />}
                Email all ready
              </Button>
            </>
          ) : undefined
        }
      />

      {queue.length > 0 && (
        <div className="mb-4 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-slate-900">Print review pack</p>
              <p className="text-xs text-slate-500">
                Select the pending listings you want to proof before uploading. The print view includes branding, images, headline, price, and full copy.
              </p>
            </div>
            <div className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
              {printableCount} selected
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="mb-3">
          <Alert tone="success">
            <span className="inline-flex items-center gap-1">
              <Check size={14} /> {toast}
            </span>
          </Alert>
        </div>
      )}
      {error && (
        <div className="mb-3">
          <Alert>{error}</Alert>
        </div>
      )}

      {dueNow.length > 0 && (
        <Card className="mb-4 border-amber-200 bg-amber-50">
          <p className="text-sm font-semibold text-amber-900">
            {dueNow.length} item{dueNow.length > 1 ? 's' : ''} due to list now
          </p>
          <p className="mt-1 text-xs text-amber-800">
            Copy the title and description, open Vinted, then mark as listed when done.
          </p>
        </Card>
      )}

      {queue.length === 0 ? (
        <EmptyState
          title="Queue is empty"
          description="Open an item and schedule a listing time to build your posting plan."
          action={
            <Link to="/inventory">
              <Button variant="secondary">Browse inventory</Button>
            </Link>
          }
        />
      ) : (
        <div className="space-y-6">
          {grouped.map(([day, entries]) => (
            <section key={day}>
              <h2 className="mb-2 text-sm font-semibold text-slate-700">{day}</h2>
              <div className="space-y-3">
                {entries.map((entry) => {
                  const item = entry.items;
                  const isDue = parseISO(entry.scheduled_at).getTime() <= Date.now();
                  return (
                    <Card key={entry.id} className={isDue ? 'ring-2 ring-amber-300' : ''}>
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <button
                          type="button"
                          onClick={() => toggleSelected(entry.id)}
                          className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-600 hover:border-teal-200 hover:bg-teal-50 hover:text-teal-700"
                        >
                          {selectedIds.includes(entry.id) ? <CheckSquare size={14} /> : <Square size={14} />}
                          {selectedIds.includes(entry.id) ? 'Selected for print' : 'Select for print'}
                        </button>
                      </div>
                      <div className="flex gap-3">
                        <div className="h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-slate-100">
                          {item?.primary_image_url && (
                            <ImageViewer
                              src={item.primary_image_url}
                              alt=""
                              imgClassName="h-full w-full object-cover"
                              showZoomHint
                            />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <Link
                              to={`/items/${entry.item_id}`}
                              className="font-mono text-xs font-semibold text-teal-700 hover:underline"
                            >
                              {item?.item_number || 'Item'}
                            </Link>
                            {isDue && <Badge tone="amber">Due</Badge>}
                            {entry.platform && entry.platform !== 'vinted' && (
                              <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium capitalize text-slate-600">
                                {entry.platform}
                              </span>
                            )}
                            <span className="text-xs text-slate-400">
                              {formatDateTime(entry.scheduled_at)} ·{' '}
                              {formatRelative(entry.scheduled_at)}
                            </span>
                          </div>
                          <p className="mt-0.5 text-sm font-semibold text-slate-900">
                            {item?.title ||
                              [item?.brand, item?.product_type].filter(Boolean).join(' ') ||
                              'Untitled'}
                          </p>
                          <p className="text-xs text-slate-500">
                            {formatMoney(item?.list_price ?? item?.suggested_price)}
                            {item?.size ? ` · Size ${item.size}` : ''}
                          </p>
                        </div>
                      </div>

                      {item?.description && (
                        <p className="mt-3 line-clamp-3 rounded-xl bg-slate-50 p-3 text-xs text-slate-600">
                          {item.description}
                        </p>
                      )}

                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          onClick={() => handleCopy(item?.title || '', 'Title')}
                        >
                          <Copy size={14} />
                          Title
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          onClick={() => handleCopy(item?.description || '', 'Description')}
                        >
                          <Copy size={14} />
                          Description
                        </Button>
                        <a
                          href="https://www.vinted.co.uk/items/new"
                          target="_blank"
                          rel="noreferrer"
                        >
                          <Button type="button" size="sm" variant="secondary">
                            <ExternalLink size={14} />
                            Vinted
                          </Button>
                        </a>
                        <Button
                          type="button"
                          size="sm"
                          variant="success"
                          disabled={busyId === entry.id}
                          onClick={() => handleComplete(entry)}
                        >
                          {busyId === entry.id ? <Spinner /> : <Check size={14} />}
                          Mark listed
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          disabled={busyId === entry.id}
                          onClick={() => handleSkip(entry)}
                        >
                          <SkipForward size={14} />
                          Skip
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          disabled={busyId === entry.id}
                          onClick={() => handleCancel(entry)}
                        >
                          <X size={14} />
                          Cancel
                        </Button>
                      </div>
                    </Card>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function buildPrintDocument(entries: ListingQueueEntry[]): string {
  const printedAt = new Date().toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  const cards = entries.map((entry) => buildPrintCard(entry)).join('');

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Starsella Pending Listings</title>
    <style>
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: Georgia, 'Times New Roman', serif;
        color: #172033;
        background: #eef2f7;
      }
      .page {
        max-width: 980px;
        margin: 0 auto;
        padding: 32px 28px 40px;
      }
      .hero {
        display: flex;
        justify-content: space-between;
        align-items: flex-end;
        gap: 20px;
        padding: 24px 28px;
        border-radius: 28px;
        background: linear-gradient(135deg, #0f766e, #0f172a 75%);
        color: #f8fafc;
      }
      .brand-row {
        display: flex;
        align-items: center;
        gap: 14px;
        margin-bottom: 10px;
      }
      .brand-mark {
        width: 42px;
        height: 42px;
        border-radius: 14px;
        background: radial-gradient(circle at 35% 35%, #fef3c7, #f59e0b 60%, #b45309 100%);
        box-shadow: 0 10px 24px rgba(15, 23, 42, 0.35);
      }
      .eyebrow {
        font-size: 11px;
        letter-spacing: 0.22em;
        text-transform: uppercase;
        color: #99f6e4;
      }
      .title {
        margin: 0;
        font-size: 34px;
        line-height: 1.05;
      }
      .subtitle {
        margin: 8px 0 0;
        max-width: 540px;
        font-size: 14px;
        line-height: 1.5;
        color: #dbeafe;
      }
      .meta {
        text-align: right;
        font-size: 12px;
        line-height: 1.6;
        color: #d1fae5;
      }
      .summary {
        display: flex;
        gap: 12px;
        margin: 18px 0 24px;
        flex-wrap: wrap;
      }
      .pill {
        border-radius: 999px;
        padding: 8px 14px;
        background: #ffffff;
        border: 1px solid #dbe4f0;
        font-size: 12px;
        font-weight: 600;
        color: #334155;
      }
      .listing {
        break-inside: avoid;
        page-break-inside: avoid;
        margin-bottom: 22px;
        padding: 22px;
        border-radius: 24px;
        background: #ffffff;
        border: 1px solid #dbe4f0;
        box-shadow: 0 10px 30px rgba(15, 23, 42, 0.08);
      }
      .listing-header {
        display: flex;
        justify-content: space-between;
        gap: 18px;
        margin-bottom: 18px;
      }
      .listing-code {
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: #0f766e;
      }
      .listing-title {
        margin: 6px 0 0;
        font-size: 24px;
        line-height: 1.2;
      }
      .listing-meta {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 12px;
      }
      .chip {
        border-radius: 999px;
        background: #f8fafc;
        border: 1px solid #dbe4f0;
        padding: 6px 10px;
        font-size: 11px;
        font-weight: 600;
        color: #475569;
      }
      .listing-price {
        min-width: 140px;
        text-align: right;
      }
      .price-label {
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.18em;
        color: #64748b;
      }
      .price-value {
        margin-top: 6px;
        font-size: 30px;
        font-weight: 700;
        color: #0f172a;
      }
      .content {
        display: grid;
        grid-template-columns: 280px 1fr;
        gap: 20px;
        align-items: start;
      }
      .main-image {
        width: 100%;
        aspect-ratio: 1;
        object-fit: cover;
        border-radius: 20px;
        display: block;
        background: linear-gradient(135deg, #e2e8f0, #cbd5e1);
      }
      .thumb-grid {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 8px;
        margin-top: 10px;
      }
      .thumb-grid img {
        width: 100%;
        aspect-ratio: 1;
        object-fit: cover;
        border-radius: 12px;
        display: block;
        background: #e2e8f0;
      }
      .copy-box {
        border-radius: 20px;
        background: #f8fafc;
        border: 1px solid #dbe4f0;
        padding: 16px 18px;
      }
      .copy-label {
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.18em;
        color: #64748b;
        margin-bottom: 10px;
      }
      .copy-text {
        white-space: pre-wrap;
        font-size: 14px;
        line-height: 1.6;
        color: #334155;
      }
      .image-links {
        margin-top: 14px;
        padding-top: 14px;
        border-top: 1px dashed #cbd5e1;
      }
      .image-links h4 {
        margin: 0 0 8px;
        font-size: 11px;
        letter-spacing: 0.18em;
        text-transform: uppercase;
        color: #64748b;
      }
      .image-links ol {
        margin: 0;
        padding-left: 18px;
      }
      .image-links li {
        margin-bottom: 6px;
        font-size: 11px;
        line-height: 1.5;
        word-break: break-all;
        color: #475569;
      }
      @media print {
        body { background: #ffffff; }
        .page { max-width: none; padding: 0; }
        .listing { box-shadow: none; }
      }
    </style>
  </head>
  <body>
    <div class="page">
      <section class="hero">
        <div>
          <div class="brand-row">
            <div class="brand-mark"></div>
            <div>
              <div class="eyebrow">Starsella review pack</div>
              <h1 class="title">Pending Listings</h1>
            </div>
          </div>
          <p class="subtitle">Proof headlines, prices, photos, and listing copy before you upload. Built for quick print checks and pen-mark corrections.</p>
        </div>
        <div class="meta">
          <div>Printed ${escapeHtml(printedAt)}</div>
          <div>${entries.length} listing${entries.length === 1 ? '' : 's'} selected</div>
        </div>
      </section>
      <div class="summary">
        <div class="pill">Headlines</div>
        <div class="pill">Images</div>
        <div class="pill">Prices</div>
        <div class="pill">Copy</div>
      </div>
      ${cards}
    </div>
  </body>
</html>`;
}

function buildPrintCard(entry: ListingQueueEntry): string {
  const item = entry.items;
  const imageUrls = item?.item_images?.map((image) => image.public_url).filter(Boolean) ?? [];
  const primaryImage = item?.primary_image_url ?? imageUrls[0] ?? '';
  const thumbnails = imageUrls.slice(1, 7)
    .map((url, index) => `<img src="${escapeAttribute(url)}" alt="Listing image ${index + 2}" />`)
    .join('');
  const meta = [
    entry.platform ? capitalize(entry.platform) : null,
    item?.brand || null,
    item?.size ? `Size ${item.size}` : null,
    formatDateTime(entry.scheduled_at),
  ].filter(Boolean) as string[];

  return `
    <section class="listing">
      <div class="listing-header">
        <div>
          <div class="listing-code">${escapeHtml(item?.item_number || 'Pending item')}</div>
          <h2 class="listing-title">${escapeHtml(item?.title || [item?.brand, item?.product_type].filter(Boolean).join(' ') || 'Untitled listing')}</h2>
          <div class="listing-meta">
            ${meta.map((value) => `<span class="chip">${escapeHtml(value)}</span>`).join('')}
          </div>
        </div>
        <div class="listing-price">
          <div class="price-label">Target price</div>
          <div class="price-value">${escapeHtml(formatMoney(item?.list_price ?? item?.suggested_price))}</div>
        </div>
      </div>
      <div class="content">
        <div>
          ${primaryImage
            ? `<img class="main-image" src="${escapeAttribute(primaryImage)}" alt="Primary product image" />`
            : '<div class="main-image"></div>'}
          ${thumbnails ? `<div class="thumb-grid">${thumbnails}</div>` : ''}
        </div>
        <div>
          <div class="copy-box">
            <div class="copy-label">Listing copy</div>
            <div class="copy-text">${escapeHtml(item?.description || 'No description yet')}</div>
          </div>
          ${imageUrls.length > 0 ? `
            <div class="image-links">
              <h4>Image links</h4>
              <ol>
                ${imageUrls.map((url) => `<li>${escapeHtml(url)}</li>`).join('')}
              </ol>
            </div>
          ` : ''}
        </div>
      </div>
    </section>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttribute(value: string): string {
  return escapeHtml(value);
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
