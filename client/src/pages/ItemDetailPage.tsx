import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  CalendarPlus,
  Check,
  Copy,
  ExternalLink,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { generateListing } from '../lib/api';
import {
  deleteItem,
  fetchItem,
  itemToForm,
  markItemSold,
  scheduleListing,
  updateItem,
} from '../lib/items';
import {
  CATEGORIES,
  CONDITION_LABELS,
  STATUS_LABELS,
  type Item,
  type ItemCondition,
  type ItemFormData,
  type ItemStatus,
} from '../types';
import {
  copyToClipboard,
  formatDate,
  formatMoney,
  formatDateTime,
  storageLabel,
} from '../lib/format';
import {
  Alert,
  Badge,
  Button,
  Card,
  Input,
  LoadingScreen,
  Select,
  Spinner,
  Textarea,
  statusTone,
} from '../components/ui';

export function ItemDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [item, setItem] = useState<Item | null>(null);
  const [form, setForm] = useState<ItemFormData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [scheduleAt, setScheduleAt] = useState('');
  const [salePrice, setSalePrice] = useState('');

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const data = await fetchItem(id);
        if (cancelled) return;
        if (!data) {
          setError('Item not found');
          return;
        }
        setItem(data);
        setForm(itemToForm(data));
        setSalePrice(data.sale_price != null ? String(data.sale_price) : '');
        if (searchParams.get('fresh') === '1') {
          // Auto-run listing generation for fresh AI items
          // user can still edit
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, searchParams]);

  function update<K extends keyof ItemFormData>(key: K, value: ItemFormData[K]) {
    setForm((f) => (f ? { ...f, [key]: value } : f));
  }

  function flash(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2000);
  }

  async function handleSave() {
    if (!id || !form) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await updateItem(id, form);
      setItem(updated);
      setForm(itemToForm(updated));
      flash('Saved');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function handleGenerateListing() {
    if (!item || !form) return;
    setGenerating(true);
    setError(null);
    try {
      const imageUrls = item.item_images?.map((i) => i.public_url) || [];
      const { listing } = await generateListing({
        brand: form.brand,
        product_type: form.product_type,
        category: form.category,
        size: form.size,
        colour: form.colour,
        condition: form.condition,
        purchase_price: form.purchase_price ? Number(form.purchase_price) : undefined,
        suggested_price: form.suggested_price ? Number(form.suggested_price) : undefined,
        measurements: form.measurements,
        notes: form.notes,
        imageUrls,
      });

      setForm((f) =>
        f
          ? {
              ...f,
              title: listing.title || f.title,
              description: listing.description || f.description,
              list_price:
                listing.list_price != null ? String(listing.list_price) : f.list_price,
              accept_offers_above:
                listing.accept_offers_above != null
                  ? String(listing.accept_offers_above)
                  : f.accept_offers_above,
              tags: listing.tags?.join(', ') || f.tags,
              status: f.status === 'new' ? 'ready_for_listing' : f.status,
            }
          : f
      );
      flash(listing.price_rationale || 'Listing generated');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Listing generation failed');
    } finally {
      setGenerating(false);
    }
  }

  async function handleCopy(text: string, label: string) {
    const ok = await copyToClipboard(text);
    flash(ok ? `${label} copied` : 'Copy failed');
  }

  async function handleSchedule() {
    if (!user || !id || !scheduleAt) return;
    try {
      await scheduleListing(user.id, id, new Date(scheduleAt).toISOString());
      const refreshed = await fetchItem(id);
      if (refreshed) {
        setItem(refreshed);
        setForm(itemToForm(refreshed));
      }
      flash('Added to listing queue');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Schedule failed');
    }
  }

  async function handleSold() {
    if (!id || !salePrice) return;
    try {
      const updated = await markItemSold(id, Number(salePrice));
      setItem(updated);
      setForm(itemToForm(updated));
      flash('Marked as sold');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed');
    }
  }

  async function handleDelete() {
    if (!id || !confirm('Delete this item permanently?')) return;
    try {
      await deleteItem(id);
      navigate('/inventory');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    }
  }

  if (loading) return <LoadingScreen />;
  if (!item || !form) {
    return (
      <div>
        <Alert>{error || 'Item not found'}</Alert>
        <Link to="/inventory" className="mt-4 inline-block text-sm text-teal-700">
          Back to inventory
        </Link>
      </div>
    );
  }

  const profit =
    item.sale_price != null && item.purchase_price != null
      ? Number(item.sale_price) - Number(item.purchase_price)
      : null;

  return (
    <div>
      <div className="mb-4 flex items-center gap-3">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="rounded-xl p-2 text-slate-500 hover:bg-slate-100"
        >
          <ArrowLeft size={20} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-mono text-lg font-bold text-teal-700">{item.item_number}</h1>
            <Badge tone={statusTone(item.status)}>{STATUS_LABELS[item.status]}</Badge>
          </div>
          <p className="truncate text-sm text-slate-500">
            Added {formatDate(item.date_added)} · {storageLabel(item)}
          </p>
        </div>
      </div>

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

      {/* Images */}
      <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
        {item.item_images?.length ? (
          item.item_images.map((img) => (
            <img
              key={img.id}
              src={img.public_url}
              alt=""
              className="h-36 w-36 shrink-0 rounded-xl object-cover ring-1 ring-slate-200 sm:h-44 sm:w-44"
            />
          ))
        ) : (
          <div className="flex h-36 w-full items-center justify-center rounded-xl bg-slate-100 text-sm text-slate-400">
            No photos
          </div>
        )}
      </div>

      {/* Vinted listing assistant */}
      <Card className="mb-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-800">Vinted listing</h2>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={generating}
            onClick={handleGenerateListing}
          >
            {generating ? <Spinner /> : <Sparkles size={14} />}
            Generate with AI
          </Button>
        </div>

        <div className="space-y-3">
          <div className="relative">
            <Input
              label="Title"
              value={form.title}
              onChange={(e) => update('title', e.target.value)}
            />
            {form.title && (
              <button
                type="button"
                className="absolute right-2 top-8 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                onClick={() => handleCopy(form.title, 'Title')}
              >
                <Copy size={14} />
              </button>
            )}
          </div>
          <div className="relative">
            <Textarea
              label="Description"
              rows={5}
              value={form.description}
              onChange={(e) => update('description', e.target.value)}
            />
            {form.description && (
              <button
                type="button"
                className="absolute right-2 top-8 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                onClick={() => handleCopy(form.description, 'Description')}
              >
                <Copy size={14} />
              </button>
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Input
              label="List price (£)"
              value={form.list_price}
              onChange={(e) => update('list_price', e.target.value)}
            />
            <Input
              label="Accept offers above (£)"
              value={form.accept_offers_above}
              onChange={(e) => update('accept_offers_above', e.target.value)}
            />
            <Input
              label="Tags"
              value={form.tags}
              onChange={(e) => update('tags', e.target.value)}
              hint="Comma-separated"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <a
              href="https://www.vinted.co.uk/items/new"
              target="_blank"
              rel="noreferrer"
              className="inline-flex"
            >
              <Button type="button" variant="secondary" size="sm">
                <ExternalLink size={14} />
                Open Vinted
              </Button>
            </a>
            {form.title && form.description && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() =>
                  handleCopy(
                    `${form.title}\n\n${form.description}\n\n£${form.list_price}`,
                    'Full listing'
                  )
                }
              >
                <Copy size={14} />
                Copy all
              </Button>
            )}
          </div>
        </div>
      </Card>

      {/* Details form */}
      <Card className="mb-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-800">Product details</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label="Status"
            value={form.status}
            onChange={(e) => update('status', e.target.value as ItemStatus)}
          >
            {Object.entries(STATUS_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
          <Input
            label="Brand"
            value={form.brand}
            onChange={(e) => update('brand', e.target.value)}
          />
          <Input
            label="Product type"
            value={form.product_type}
            onChange={(e) => update('product_type', e.target.value)}
          />
          <Select
            label="Category"
            value={form.category}
            onChange={(e) => update('category', e.target.value)}
          >
            <option value="">Select…</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
          <Input label="Size" value={form.size} onChange={(e) => update('size', e.target.value)} />
          <Input
            label="Colour"
            value={form.colour}
            onChange={(e) => update('colour', e.target.value)}
          />
          <Select
            label="Condition"
            value={form.condition}
            onChange={(e) => update('condition', e.target.value as ItemCondition | '')}
          >
            <option value="">Select…</option>
            {Object.entries(CONDITION_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
          <Input
            label="Purchase price (£)"
            value={form.purchase_price}
            onChange={(e) => update('purchase_price', e.target.value)}
          />
          <Input
            label="Suggested price (£)"
            value={form.suggested_price}
            onChange={(e) => update('suggested_price', e.target.value)}
          />
          <Input
            label="Measurements"
            value={form.measurements}
            onChange={(e) => update('measurements', e.target.value)}
          />
          <Input
            label="Container"
            value={form.storage_container}
            onChange={(e) => update('storage_container', e.target.value)}
          />
          <Input
            label="Shelf"
            value={form.storage_shelf}
            onChange={(e) => update('storage_shelf', e.target.value)}
          />
          <Input
            label="Box"
            value={form.storage_box}
            onChange={(e) => update('storage_box', e.target.value)}
          />
          <div className="sm:col-span-2">
            <Input
              label="Location notes"
              value={form.storage_notes}
              onChange={(e) => update('storage_notes', e.target.value)}
            />
          </div>
          <div className="sm:col-span-2">
            <Textarea
              label="Notes"
              rows={3}
              value={form.notes}
              onChange={(e) => update('notes', e.target.value)}
            />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Button type="button" disabled={saving} onClick={handleSave}>
            {saving ? <Spinner className="border-t-white" /> : null}
            Save changes
          </Button>
          <Button type="button" variant="danger" onClick={handleDelete}>
            <Trash2 size={16} />
            Delete
          </Button>
        </div>
      </Card>

      {/* Queue + sales */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 text-sm font-semibold text-slate-800">Schedule listing</h2>
          <Input
            label="When to list"
            type="datetime-local"
            value={scheduleAt}
            onChange={(e) => setScheduleAt(e.target.value)}
          />
          <Button
            type="button"
            className="mt-3"
            variant="secondary"
            disabled={!scheduleAt}
            onClick={handleSchedule}
          >
            <CalendarPlus size={16} />
            Add to queue
          </Button>
          {item.listed_date && (
            <p className="mt-2 text-xs text-slate-400">
              Listed {formatDateTime(item.listed_date)}
            </p>
          )}
        </Card>

        <Card>
          <h2 className="mb-3 text-sm font-semibold text-slate-800">Mark as sold</h2>
          <Input
            label="Sale price (£)"
            inputMode="decimal"
            value={salePrice}
            onChange={(e) => setSalePrice(e.target.value)}
          />
          <Button
            type="button"
            className="mt-3"
            variant="success"
            disabled={!salePrice}
            onClick={handleSold}
          >
            Record sale
          </Button>
          {profit != null && (
            <p className="mt-2 text-sm font-medium text-emerald-700">
              Profit: {formatMoney(profit)}
            </p>
          )}
          {item.sold_date && (
            <p className="mt-1 text-xs text-slate-400">
              Sold {formatDateTime(item.sold_date)} · {formatMoney(item.sale_price)}
            </p>
          )}
        </Card>
      </div>
    </div>
  );
}
