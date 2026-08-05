import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Check,
  Copy,
  ExternalLink,
  Mail,
  SkipForward,
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

  async function handleCopy(text: string, label: string) {
    const ok = await copyToClipboard(text || '');
    flash(ok ? `${label} copied` : 'Nothing to copy');
  }

  async function handleComplete(entry: ListingQueueEntry) {
    setBusyId(entry.id);
    try {
      await completeQueueEntry(entry.id, entry.item_id);
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

  if (loading) return <LoadingScreen label="Loading queue…" />;

  return (
    <div>
      <PageHeader
        title="Listing queue"
        subtitle="Prepare listings, copy content, post manually on Vinted"
        actions={
          queue.length > 0 ? (
            <Button
              type="button"
              variant="secondary"
              disabled={emailingAll}
              onClick={handleEmailAll}
            >
              {emailingAll ? <Spinner /> : <Mail size={16} />}
              Email all ready
            </Button>
          ) : undefined
        }
      />

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
