
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  CalendarPlus,
  CheckCheck,
  Copy,
  Download,
  ExternalLink,
  Mail,
  ShoppingBag,
  Sparkles,
  Trash2,
  XCircle,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { generateListing, sendListingsEmail } from '../lib/api';
import {
  type EbayCategoryAspect,
  type EbayCategorySuggestion,
  EbayListingError,
  type EbayStatus,
  createEbayListing,
  delistEbayItem,
  getEbayCategoryAspects,
  getEbayCategorySuggestions,
  getEbayStatus,
  resetEbayItem,
  EBAY_GB_CATEGORIES,
} from '../lib/ebay';
import {
  deleteItem,
  fetchItem,
  itemToForm,
  markItemListed,
  markItemSold,
  scheduleListing,
  updateItem,
  updatePlatformPrices,
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
import { getItemFinanceSummary } from '../lib/finance';
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
  Toast,
  statusTone,
} from '../components/ui';
import { ImageViewer } from '../components/ImageViewer';
import { MarketplaceBadges } from '../components/MarketplaceBadges';

export function ItemDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user, isPro, creditsUsed, creditsLimit } = useAuth();
  const outOfCredits = !isPro && creditsLimit != null && creditsUsed >= creditsLimit;
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const [item, setItem] = useState<Item | null>(null);
  const [form, setForm] = useState<ItemFormData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [scheduleAt, setScheduleAt] = useState('');
  const [schedulePlatform, setSchedulePlatform] = useState('vinted');
  const [salePrice, setSalePrice] = useState('');
  const [emailing, setEmailing] = useState(false);
  const [markingListed, setMarkingListed] = useState(false);
  const [platformPrices, setPlatformPrices] = useState<Record<string, string>>({});
  const [savingPrices, setSavingPrices] = useState(false);
  const [ebayCategoryTouched, setEbayCategoryTouched] = useState(false);
  const [ebayCategoryLabel, setEbayCategoryLabel] = useState<string>(EBAY_GB_CATEGORIES[0].label);
  const [ebayCategorySearch, setEbayCategorySearch] = useState('');
  const [debouncedEbayCategorySearch, setDebouncedEbayCategorySearch] = useState('');
  const [ebayCategorySuggestions, setEbayCategorySuggestions] = useState<EbayCategorySuggestion[]>([]);
  const [ebayCategorySearching, setEbayCategorySearching] = useState(false);

  // eBay listing state
  const [ebayStatus, setEbayStatus] = useState<EbayStatus | null>(null);
  const [ebayListingType, setEbayListingType] = useState<'FIXED_PRICE' | 'AUCTION'>('FIXED_PRICE');
  const [ebayPrice, setEbayPrice] = useState('');
  const [ebayBuyItNow, setEbayBuyItNow] = useState('');
  const [ebayDays, setEbayDays] = useState('7');
  const [ebayCategoryId, setEbayCategoryId] = useState<string>(EBAY_GB_CATEGORIES[0].id); // default: Women's Tops & Shirts
  const [ebayRequiredAspects, setEbayRequiredAspects] = useState<EbayCategoryAspect[]>([]);
  const [ebayAspectValues, setEbayAspectValues] = useState<Record<string, string>>({});
  const [ebayAspectLoading, setEbayAspectLoading] = useState(false);
  const [ebayMissingAspects, setEbayMissingAspects] = useState<string[]>([]);
  const [ebayListing, setEbayListing] = useState(false);
  const [ebayDelisting, setEbayDelisting] = useState(false);
  const [ebayResetting, setEbayResetting] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedEbayCategorySearch(ebayCategorySearch.trim()), 300);
    return () => clearTimeout(t);
  }, [ebayCategorySearch]);

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
        const pp = data.platform_prices ?? {};
        setPlatformPrices({
          vinted: pp.vinted != null ? String(pp.vinted) : '',
          depop: pp.depop != null ? String(pp.depop) : '',
        });
        if (!ebayCategoryTouched) {
          const suggestedCategoryId = suggestEbayCategoryId(itemToForm(data));
          setEbayCategoryId(suggestedCategoryId);
          setEbayCategoryLabel(getPresetCategoryLabel(suggestedCategoryId));
        }
        // Pre-fill eBay price from list_price
        if (data.list_price != null) setEbayPrice(String(data.list_price));
        // Fetch eBay connection status
        getEbayStatus().then(setEbayStatus).catch(() => null);
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

  useEffect(() => {
    if (!ebayCategoryId || !ebayStatus?.connected) return;
    let cancelled = false;
    (async () => {
      setEbayAspectLoading(true);
      try {
        const requiredAspects = await getEbayCategoryAspects(ebayCategoryId);
        if (cancelled) return;
        setEbayRequiredAspects(requiredAspects);
        setEbayAspectValues((current) => {
          const next: Record<string, string> = {};
          for (const aspect of requiredAspects) {
            next[aspect.name] = current[aspect.name] || guessAspectValue(aspect, form, ebayCategoryId);
          }
          return next;
        });
      } catch {
        if (!cancelled) setEbayRequiredAspects([]);
      } finally {
        if (!cancelled) setEbayAspectLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ebayCategoryId, ebayStatus?.connected, form]);

  useEffect(() => {
    if (!ebayStatus?.connected || debouncedEbayCategorySearch.length < 2) {
      setEbayCategorySuggestions([]);
      setEbayCategorySearching(false);
      return;
    }

    let cancelled = false;
    (async () => {
      setEbayCategorySearching(true);
      try {
        const suggestions = await getEbayCategorySuggestions(debouncedEbayCategorySearch);
        if (!cancelled) setEbayCategorySuggestions(suggestions);
      } catch {
        if (!cancelled) setEbayCategorySuggestions([]);
      } finally {
        if (!cancelled) setEbayCategorySearching(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [debouncedEbayCategorySearch, ebayStatus?.connected]);

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

  async function handleEmailListing() {
    if (!item) return;
    setEmailing(true);
    setError(null);
    try {
      await sendListingsEmail([
        {
          item_number: item.item_number,
          title: form?.title || undefined,
          description: form?.description || undefined,
          list_price: form?.list_price ? Number(form.list_price) : null,
          size: form?.size || null,
          colour: form?.colour || null,
          brand: form?.brand || null,
          tags: form?.tags
            ? form.tags.split(',').map((t) => t.trim()).filter(Boolean)
            : null,
          image_urls: item.item_images?.map((i) => i.public_url) || [],
        },
      ]);
      flash('Listing emailed');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Email failed');
    } finally {
      setEmailing(false);
    }
  }

  async function handleSchedule() {
    if (!user || !id || !scheduleAt) return;
    try {
      await scheduleListing(user.id, id, new Date(scheduleAt).toISOString(), undefined, schedulePlatform);
      const refreshed = await fetchItem(id);
      if (refreshed) {
        setItem(refreshed);
        setForm(itemToForm(refreshed));
      }
      flash(`Added to ${schedulePlatform} queue`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Schedule failed');
    }
  }

  async function handleSavePlatformPrices() {
    if (!id) return;
    setSavingPrices(true);
    try {
      const prices: Record<string, number | null> = {
        vinted: platformPrices.vinted ? parseFloat(platformPrices.vinted) : null,
        depop: platformPrices.depop ? parseFloat(platformPrices.depop) : null,
      };
      await updatePlatformPrices(id, prices);
      flash('Platform prices saved');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSavingPrices(false);
    }
  }

  async function handleEbayList() {
    if (!id || !ebayPrice) return;
    setEbayListing(true);
    setError(null);
    setEbayMissingAspects([]);
    try {
      const ebayAspects = Object.fromEntries(
        Object.entries(ebayAspectValues)
          .map(([name, value]) => [name, value.trim()])
          .filter(([, value]) => value)
      );
      const result = await createEbayListing({
        itemId: id,
        listingType: ebayListingType,
        startPrice: parseFloat(ebayPrice),
        buyItNowPrice: ebayBuyItNow ? parseFloat(ebayBuyItNow) : undefined,
        auctionDurationDays: ebayListingType === 'AUCTION' ? parseInt(ebayDays, 10) : undefined,
        ebayCategoryId,
        ebayAspects,
      });
      // Refresh item to get new ebay_listing_id
      const updated = await fetchItem(id);
      if (updated) { setItem(updated); setForm(itemToForm(updated)); }
      flash(`Listed on eBay! Listing ID: ${result.listingId}`);
    } catch (err) {
      if (err instanceof EbayListingError) {
        setEbayMissingAspects(err.missingAspects);
        if (err.requiredAspects.length > 0) setEbayRequiredAspects(err.requiredAspects);
      }
      setError(err instanceof Error ? err.message : 'eBay listing failed');
    } finally {
      setEbayListing(false);
    }
  }

  function handleEbayAspectChange(name: string, value: string) {
    setEbayAspectValues((current) => ({ ...current, [name]: value }));
    setEbayMissingAspects((current) => current.filter((entry) => entry !== name));
  }

  const selectedPresetCategory = EBAY_GB_CATEGORIES.find((category) => category.id === ebayCategoryId);
  const isCustomEbayCategory = !selectedPresetCategory;

  async function handleEbayDelist() {
    if (!item?.ebay_listing_id) return;
    setEbayDelisting(true);
    setError(null);
    try {
      await delistEbayItem(item.ebay_listing_id);
      const updated = await fetchItem(id!);
      if (updated) { setItem(updated); setForm(itemToForm(updated)); }
      flash('eBay listing ended');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delist');
    } finally {
      setEbayDelisting(false);
    }
  }

  async function handleEbayReset() {
    if (!id) return;
    setEbayResetting(true);
    setError(null);
    try {
      await resetEbayItem(id);
      const updated = await fetchItem(id);
      if (updated) { setItem(updated); setForm(itemToForm(updated)); }
      flash('eBay data cleared — ready to list fresh');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reset eBay data');
    } finally {
      setEbayResetting(false);
    }
  }

  async function handleMarkListed() {
    if (!id) return;
    setMarkingListed(true);
    try {
      const updated = await markItemListed(id, 'vinted');
      setItem(updated);
      setForm(itemToForm(updated));
      flash('Marked as listed');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to mark as listed');
    } finally {
      setMarkingListed(false);
    }
  }

  function handleDownloadAll() {
    if (!item?.item_images?.length) return;
    item.item_images.forEach((img, i) => {
      setTimeout(() => {
        const a = document.createElement('a');
        a.href = img.public_url;
        a.download = `${item.item_number}-${i + 1}.jpg`;
        a.target = '_blank';
        document.body.appendChild(a);
        a.click();
        a.remove();
      }, i * 400);
    });
    flash(`Downloading ${item.item_images.length} photos…`);
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

  const finance = getItemFinanceSummary(item);
  const financePreview = getItemFinanceSummary({
    purchase_price: form.purchase_price ? Number(form.purchase_price) : item.purchase_price,
    sale_price: salePrice ? Number(salePrice) : item.sale_price,
    platform_fee: form.platform_fee ? Number(form.platform_fee) : item.platform_fee,
    shipping_cost: form.shipping_cost ? Number(form.shipping_cost) : item.shipping_cost,
    packaging_cost: form.packaging_cost ? Number(form.packaging_cost) : item.packaging_cost,
    other_costs: form.other_costs ? Number(form.other_costs) : item.other_costs,
  });

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
            <MarketplaceBadges marketplaces={item.posted_marketplaces} />
          </div>
          <p className="truncate text-sm text-slate-500">
            Added {formatDate(item.date_added)} · {storageLabel(item)}
          </p>
        </div>
      </div>

      <Toast message={toast} />
      {error && (
        <div className="mb-3">
          <Alert>{error}</Alert>
        </div>
      )}

      {/* Images */}
      <div className="mb-4">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-xs text-slate-400">{item.item_images?.length ?? 0} photo{item.item_images?.length !== 1 ? 's' : ''}</span>
          {(item.item_images?.length ?? 0) > 0 && (
            <button
              type="button"
              onClick={handleDownloadAll}
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-700"
            >
              <Download size={12} /> Download all
            </button>
          )}
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1">
        {item.item_images?.length ? (
          item.item_images.map((img) => (
            <ImageViewer
              key={img.id}
              src={img.public_url}
              alt=""
              showZoomHint
              className="shrink-0 rounded-xl ring-1 ring-slate-200"
              imgClassName="h-36 w-36 object-cover sm:h-44 sm:w-44 rounded-xl"
            />
          ))
        ) : (
          <div className="flex h-36 w-full items-center justify-center rounded-xl bg-slate-100 text-sm text-slate-400">
            No photos
          </div>
        )}        </div>      </div>

      {/* Vinted listing assistant */}
      <Card className="mb-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-800">Vinted listing</h2>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={generating || outOfCredits}
            onClick={outOfCredits ? undefined : handleGenerateListing}
            title={outOfCredits ? 'Upgrade to Pro for unlimited AI' : undefined}
          >
            {generating ? <Spinner /> : <Sparkles size={14} />}
            {outOfCredits ? 'No credits — Upgrade' : 'Generate with AI'}
          </Button>
        </div>
        {outOfCredits && (
          <Link to="/billing" className="inline-flex items-center gap-1 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs font-medium text-amber-800 hover:bg-amber-100">
            <Sparkles size={12} /> You've used all 5 free AI credits — upgrade to Pro for unlimited
          </Link>
        )}

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
                onClick={() => {
                  const parts = [
                    form.title,
                    '',
                    form.description,
                    '',
                    [
                      form.brand && `Brand: ${form.brand}`,
                      form.size && `Size: ${form.size}`,
                      form.colour && `Colour: ${form.colour}`,
                      form.condition && `Condition: ${CONDITION_LABELS[form.condition as ItemCondition] ?? form.condition}`,
                      form.list_price && `Price: £${form.list_price}`,
                      form.tags && `Tags: ${form.tags}`,
                    ].filter(Boolean).join('\n'),
                  ].join('\n').trim();
                  handleCopy(parts, 'Full listing');
                }}
              >
                <Copy size={14} />
                Copy all
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={emailing}
              onClick={handleEmailListing}
            >
              {emailing ? <Spinner /> : <Mail size={14} />}
              Email listing
            </Button>
            {item.status !== 'listed' && item.status !== 'sold' && (
              <Button
                type="button"
                size="sm"
                variant="success"
                disabled={markingListed}
                onClick={handleMarkListed}
              >
                {markingListed ? <Spinner /> : <CheckCheck size={14} />}
                Mark as listed
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
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              label="When to list"
              type="datetime-local"
              value={scheduleAt}
              onChange={(e) => setScheduleAt(e.target.value)}
            />
            <Select
              label="Platform"
              value={schedulePlatform}
              onChange={(e) => setSchedulePlatform(e.target.value)}
            >
              <option value="vinted">Vinted</option>
              <option value="depop">Depop</option>
            </Select>
          </div>
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
          {financePreview.grossProfit != null && (
            <div className="mt-3 space-y-1 text-sm">
              <p className="font-medium text-slate-700">Gross profit: {formatMoney(financePreview.grossProfit)}</p>
              <p className="font-medium text-emerald-700">Net profit: {formatMoney(financePreview.netProfit)}</p>
            </div>
          )}
          {item.sold_date && (
            <p className="mt-1 text-xs text-slate-400">
              Sold {formatDateTime(item.sold_date)} · {formatMoney(item.sale_price)}
            </p>
          )}
        </Card>

        <Card>
          <h2 className="mb-3 text-sm font-semibold text-slate-800">Finance</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              label="Platform fees (£)"
              inputMode="decimal"
              value={form.platform_fee}
              onChange={(e) => update('platform_fee', e.target.value)}
            />
            <Input
              label="Shipping cost (£)"
              inputMode="decimal"
              value={form.shipping_cost}
              onChange={(e) => update('shipping_cost', e.target.value)}
            />
            <Input
              label="Packaging cost (£)"
              inputMode="decimal"
              value={form.packaging_cost}
              onChange={(e) => update('packaging_cost', e.target.value)}
            />
            <Input
              label="Other costs (£)"
              inputMode="decimal"
              value={form.other_costs}
              onChange={(e) => update('other_costs', e.target.value)}
            />
            <Input
              label="Payout received"
              type="date"
              value={form.payout_received_at}
              onChange={(e) => update('payout_received_at', e.target.value)}
            />
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl bg-slate-50 px-3 py-2">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Gross</p>
              <p className="mt-1 text-base font-semibold text-slate-900">{formatMoney(finance.grossProfit)}</p>
            </div>
            <div className="rounded-xl bg-slate-50 px-3 py-2">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Extra costs</p>
              <p className="mt-1 text-base font-semibold text-slate-900">{formatMoney(finance.extraCosts)}</p>
            </div>
            <div className="rounded-xl bg-emerald-50 px-3 py-2">
              <p className="text-xs uppercase tracking-[0.2em] text-emerald-700">Net</p>
              <p className="mt-1 text-base font-semibold text-emerald-800">{formatMoney(finance.netProfit)}</p>
            </div>
          </div>
          {item.payout_received_at ? (
            <p className="mt-3 text-xs text-slate-400">Payout received {formatDate(item.payout_received_at)}</p>
          ) : null}
        </Card>
      </div>

      {/* Per-platform prices */}
      <Card>
        <h2 className="mb-1 text-sm font-semibold text-slate-800">Platform prices</h2>
        <p className="mb-3 text-xs text-slate-400">
          Set different prices per marketplace. The extension will use the matching price when filling forms.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label="Vinted (£)"
            inputMode="decimal"
            value={platformPrices.vinted ?? ''}
            onChange={(e) => setPlatformPrices((p) => ({ ...p, vinted: e.target.value }))}
            placeholder={form?.list_price ?? undefined}
          />
          <Input
            label="Depop (£)"
            inputMode="decimal"
            value={platformPrices.depop ?? ''}
            onChange={(e) => setPlatformPrices((p) => ({ ...p, depop: e.target.value }))}
            placeholder={form?.list_price ?? undefined}
          />
        </div>
        <Button
          type="button"
          className="mt-3"
          variant="secondary"
          size="sm"
          disabled={savingPrices}
          onClick={handleSavePlatformPrices}
        >
          {savingPrices ? <Spinner className="border-t-white" /> : null}
          Save platform prices
        </Button>
      </Card>

      {/* eBay listing */}
      {ebayStatus?.connected && (
        <Card>
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
              <ShoppingBag size={16} className="text-teal-600" />
              List on eBay
            </h2>
            {item?.ebay_listing_id && (
              <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
                Live ✓
              </span>
            )}
          </div>

          {item?.ebay_listing_id ? (
            /* Already listed */
            <div className="space-y-3">
              <p className="text-xs text-slate-500">
                This item has an active eBay listing.
              </p>
              {item.ebay_listing_url && (
                <a
                  href={item.ebay_listing_url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs text-teal-700 hover:underline"
                >
                  <ExternalLink size={12} />
                  View on eBay — #{item.ebay_listing_id}
                </a>
              )}
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={ebayDelisting}
                  onClick={handleEbayDelist}
                >
                  {ebayDelisting ? <Spinner className="border-t-slate-600" /> : <XCircle size={14} />}
                  End listing
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={ebayResetting}
                  onClick={handleEbayReset}
                >
                  {ebayResetting ? <Spinner className="border-t-slate-600" /> : null}
                  Reset eBay data
                </Button>
              </div>
            </div>
          ) : (
            /* Create listing */
            <div className="space-y-3">
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setEbayListingType('FIXED_PRICE')}
                  className={`flex-1 rounded border px-3 py-1.5 text-xs font-medium transition-colors ${
                    ebayListingType === 'FIXED_PRICE'
                      ? 'border-teal-600 bg-teal-50 text-teal-700'
                      : 'border-slate-200 text-slate-500 hover:border-slate-300'
                  }`}
                >
                  Fixed price
                </button>
                <button
                  type="button"
                  onClick={() => setEbayListingType('AUCTION')}
                  className={`flex-1 rounded border px-3 py-1.5 text-xs font-medium transition-colors ${
                    ebayListingType === 'AUCTION'
                      ? 'border-teal-600 bg-teal-50 text-teal-700'
                      : 'border-slate-200 text-slate-500 hover:border-slate-300'
                  }`}
                >
                  Auction
                </button>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">eBay category</label>
                <Input
                  value={ebayCategorySearch}
                  onChange={(e) => setEbayCategorySearch(e.target.value)}
                  placeholder="Search eBay categories, e.g. perfume, lamp, xbox"
                  hint="Use search for broader eBay coverage, or pick from the quick list below."
                />
                {ebayCategorySearching ? (
                  <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
                    Searching eBay categories…
                  </div>
                ) : ebayCategorySuggestions.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {ebayCategorySuggestions.map((suggestion) => (
                      <button
                        key={suggestion.categoryId}
                        type="button"
                        onClick={() => {
                          setEbayCategoryTouched(true);
                          setEbayCategoryId(suggestion.categoryId);
                          setEbayCategoryLabel(suggestion.categoryName);
                          setEbayMissingAspects([]);
                          setEbayCategorySearch(suggestion.categoryName);
                        }}
                        className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                          ebayCategoryId === suggestion.categoryId
                            ? 'border-teal-600 bg-teal-50 text-teal-700'
                            : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                        }`}
                      >
                        {suggestion.categoryName}
                      </button>
                    ))}
                  </div>
                ) : debouncedEbayCategorySearch.length >= 2 ? (
                  <p className="mt-2 text-xs text-slate-400">No matching eBay categories found for that search.</p>
                ) : null}
                {isCustomEbayCategory ? (
                  <div className="mt-2 rounded-xl border border-teal-200 bg-teal-50 px-3 py-2 text-xs text-teal-800">
                    <div className="font-medium">Selected eBay category: {ebayCategoryLabel}</div>
                    <button
                      type="button"
                      onClick={() => {
                        setEbayCategoryId(EBAY_GB_CATEGORIES[0].id);
                        setEbayCategoryLabel(EBAY_GB_CATEGORIES[0].label);
                        setEbayMissingAspects([]);
                      }}
                      className="mt-1 text-teal-700 underline hover:text-teal-800"
                    >
                      Switch back to quick-pick categories
                    </button>
                  </div>
                ) : (
                  <select
                    value={ebayCategoryId}
                    onChange={(e) => {
                      const nextCategoryId = e.target.value;
                      setEbayCategoryTouched(true);
                      setEbayCategoryId(nextCategoryId);
                      setEbayCategoryLabel(getPresetCategoryLabel(nextCategoryId));
                      setEbayMissingAspects([]);
                    }}
                    className="w-full rounded border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700"
                  >
                    {EBAY_GB_CATEGORIES.map((c) => (
                      <option key={c.id} value={c.id}>{c.label}</option>
                    ))}
                  </select>
                )}
              </div>

              {ebayAspectLoading ? (
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
                  Loading required eBay specifics…
                </div>
              ) : ebayRequiredAspects.length > 0 ? (
                <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                  <div>
                    <p className="text-xs font-medium text-slate-700">Required eBay specifics</p>
                    <p className="mt-1 text-xs text-slate-500">
                      This category requires these item specifics before eBay will accept the listing.
                    </p>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {ebayRequiredAspects.map((aspect) => {
                      const missing = ebayMissingAspects.includes(aspect.name);
                      return aspect.mode === 'SELECTION_ONLY' && aspect.values.length > 0 ? (
                        <Select
                          key={aspect.name}
                          label={aspect.name}
                          value={ebayAspectValues[aspect.name] ?? ''}
                          onChange={(e) => handleEbayAspectChange(aspect.name, e.target.value)}
                          className={missing ? 'border-rose-300 focus:border-rose-500 focus:ring-rose-500/20' : undefined}
                        >
                          <option value="">Select {aspect.name}</option>
                          {aspect.values.map((value) => (
                            <option key={value} value={value}>{value}</option>
                          ))}
                        </Select>
                      ) : (
                        <Input
                          key={aspect.name}
                          label={aspect.name}
                          value={ebayAspectValues[aspect.name] ?? ''}
                          onChange={(e) => handleEbayAspectChange(aspect.name, e.target.value)}
                          className={missing ? 'border-rose-300 focus:border-rose-500 focus:ring-rose-500/20' : undefined}
                        />
                      );
                    })}
                  </div>
                </div>
              ) : null}

              <div className="grid gap-2 sm:grid-cols-2">
                <Input
                  label={ebayListingType === 'FIXED_PRICE' ? 'Price (£)' : 'Start price (£)'}
                  inputMode="decimal"
                  value={ebayPrice}
                  onChange={(e) => setEbayPrice(e.target.value)}
                  placeholder="0.00"
                />
                {ebayListingType === 'AUCTION' && (
                  <>
                    <Input
                      label="Buy It Now price (optional)"
                      inputMode="decimal"
                      value={ebayBuyItNow}
                      onChange={(e) => setEbayBuyItNow(e.target.value)}
                      placeholder="0.00"
                    />
                    <div>
                      <label className="mb-1 block text-xs font-medium text-slate-600">Duration</label>
                      <select
                        value={ebayDays}
                        onChange={(e) => setEbayDays(e.target.value)}
                        className="w-full rounded border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700"
                      >
                        <option value="3">3 days</option>
                        <option value="5">5 days</option>
                        <option value="7">7 days</option>
                        <option value="10">10 days</option>
                      </select>
                    </div>
                  </>
                )}
              </div>

              <p className="text-xs text-slate-400">
                Marketplace: <strong>{ebayStatus.marketplace === 'EBAY_GB' ? 'eBay UK' : 'eBay US'}</strong>
                {!ebayStatus.fulfillmentPolicyId && (
                  <span className="ml-2 text-amber-600">
                    · Set shipping policy in Settings first
                  </span>
                )}
              </p>

              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={ebayListing || !ebayPrice}
                  onClick={handleEbayList}
                >
                  {ebayListing ? <Spinner className="border-t-teal-600" /> : <ShoppingBag size={14} />}
                  Publish to eBay
                </Button>
                <button
                  type="button"
                  disabled={ebayResetting}
                  onClick={handleEbayReset}
                  className="text-xs text-slate-400 hover:text-slate-600 hover:underline disabled:opacity-50"
                >
                  {ebayResetting ? 'Resetting…' : 'Reset eBay data'}
                </button>
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

function guessAspectValue(
  aspect: EbayCategoryAspect,
  form: ItemFormData | null,
  categoryId: string
): string {
  if (!form) return '';

  if (aspect.name === 'Brand') return form.brand;
  if (aspect.name === 'Size') return form.size;
  if (aspect.name === 'Colour') return form.colour;
  if (aspect.name === 'Type') return form.product_type;

  if (aspect.name === 'Department') {
    const womenCategories = new Set(['53159', '63861', '11554', '63863', '169001', '63864', '63862', '63866', '155226', '11555', '63865', '63867', '3009', '185082', '260954', '185084', '260011', '53557', '55793', '95672', '45333', '62107', '169291']);
    const menCategories = new Set(['15687', '57990', '57991', '11483', '57989', '57988', '11484', '155183', '15689', '3001', '185708']);
    if (womenCategories.has(categoryId)) return matchAspectValue(aspect.values, ['Women', 'Woman', 'Ladies']);
    if (menCategories.has(categoryId)) return matchAspectValue(aspect.values, ['Men', 'Man', 'Mens']);
  }

  if (aspect.name === 'Sleeve Length') {
    const label = `${form.product_type} ${form.title}`.toLowerCase();
    if (label.includes('sleeveless') || label.includes('vest') || label.includes('tank')) {
      return matchAspectValue(aspect.values, ['Sleeveless']);
    }
    if (label.includes('short sleeve') || label.includes('t-shirt') || label.includes('tee')) {
      return matchAspectValue(aspect.values, ['Short Sleeve']);
    }
    if (label.includes('long sleeve') || label.includes('jumper') || label.includes('hoodie') || label.includes('sweatshirt')) {
      return matchAspectValue(aspect.values, ['Long Sleeve']);
    }
  }

  return '';
}

function matchAspectValue(values: string[], candidates: string[]): string {
  if (values.length === 0) return candidates[0] ?? '';
  for (const candidate of candidates) {
    const match = values.find((value) => value.toLowerCase() === candidate.toLowerCase());
    if (match) return match;
  }
  return '';
}

function getPresetCategoryLabel(categoryId: string): string {
  return EBAY_GB_CATEGORIES.find((category) => category.id === categoryId)?.label ?? categoryId;
}

function suggestEbayCategoryId(form: ItemFormData): string {
  const haystack = [form.product_type, form.title, form.category, form.description, form.tags]
    .join(' ')
    .toLowerCase();

  if (haystack.includes('aftershave') || haystack.includes('cologne')) return '29585';
  if (haystack.includes('perfume') || haystack.includes('fragrance') || haystack.includes('eau de parfum') || haystack.includes('eau de toilette')) return '112661';
  if (haystack.includes('candle') || haystack.includes('diffuser')) return '20552';
  if (haystack.includes('essential oil')) return '41268';

  return EBAY_GB_CATEGORIES[0].id;
}
