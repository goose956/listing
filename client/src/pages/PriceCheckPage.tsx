import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Link } from 'react-router-dom';
import { Barcode, Camera, Copy, ImagePlus, ScanSearch, Search, Sparkles, Trash2, X } from 'lucide-react';
import { runPriceCheck } from '../lib/api';
import { copyToClipboard, formatMoney, parseMoneyInput } from '../lib/format';
import type { PriceCheckResult } from '../types';
import {
  Alert,
  Badge,
  Button,
  Card,
  Input,
  PageHeader,
  Spinner,
  Textarea,
} from '../components/ui';

interface LocalPhoto {
  id: string;
  file: File;
  preview: string;
}

interface BarcodeDetectionResult {
  rawValue?: string;
}

interface BarcodeDetectorInstance {
  detect(source: ImageBitmapSource): Promise<BarcodeDetectionResult[]>;
}

interface BarcodeDetectorConstructor {
  new (options?: { formats?: string[] }): BarcodeDetectorInstance;
  getSupportedFormats?: () => Promise<string[]>;
}

declare global {
  interface Window {
    BarcodeDetector?: BarcodeDetectorConstructor;
  }
}

const MAX_PHOTOS = 4;

const BASIS_COPY: Record<NonNullable<PriceCheckResult['pricing_basis']>, string> = {
  barcode_match: 'Barcode match',
  visual_match: 'Visual match',
  brand_model_match: 'Brand/model match',
  category_estimate: 'Category estimate',
};

export function PriceCheckPage() {
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  const [photos, setPhotos] = useState<LocalPhoto[]>([]);
  const [barcode, setBarcode] = useState('');
  const [purchasePrice, setPurchasePrice] = useState('');
  const [userNotes, setUserNotes] = useState('');
  const [result, setResult] = useState<PriceCheckResult | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [analysing, setAnalysing] = useState(false);
  const [detectingBarcode, setDetectingBarcode] = useState(false);
  const [barcodeSupport, setBarcodeSupport] = useState<boolean | null>(null);

  useEffect(() => {
    setBarcodeSupport(typeof window !== 'undefined' && typeof window.BarcodeDetector === 'function');
    return () => {
      photos.forEach((photo) => URL.revokeObjectURL(photo.preview));
    };
  }, []);

  function flash(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(null), 2400);
  }

  function onFilesSelected(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []).slice(0, MAX_PHOTOS);
    event.target.value = '';
    if (!files.length) return;

    const next = files.map((file) => ({
      id: crypto.randomUUID(),
      file,
      preview: URL.createObjectURL(file),
    }));

    setPhotos((current) => {
      const updated = [...current, ...next].slice(0, MAX_PHOTOS);
      const removed = [...current, ...next].slice(MAX_PHOTOS);
      removed.forEach((photo) => URL.revokeObjectURL(photo.preview));
      return updated;
    });
    setResult(null);
    setError(null);
    void detectBarcodeFromFiles(files);
  }

  function removePhoto(id: string) {
    setPhotos((current) => {
      const found = current.find((photo) => photo.id === id);
      if (found) URL.revokeObjectURL(found.preview);
      return current.filter((photo) => photo.id !== id);
    });
    setResult(null);
  }

  function resetAll() {
    photos.forEach((photo) => URL.revokeObjectURL(photo.preview));
    setPhotos([]);
    setBarcode('');
    setPurchasePrice('');
    setUserNotes('');
    setResult(null);
    setModel(null);
    setError(null);
  }

  async function detectBarcodeFromFiles(files: File[]) {
    if (!window.BarcodeDetector) return;

    setDetectingBarcode(true);
    try {
      for (const file of files) {
        const detected = await detectBarcodeFromFile(file);
        if (detected) {
          setBarcode((current) => current || detected);
          flash(`Barcode found: ${detected}`);
          return;
        }
      }
    } catch {
      // best effort only
    } finally {
      setDetectingBarcode(false);
    }
  }

  async function handleAnalyse() {
    if (!photos.length) {
      setError('Add at least one photo to run a price check');
      return;
    }

    setAnalysing(true);
    setError(null);
    try {
      const imageUrls = await Promise.all(photos.map((photo) => readFileAsDataUrl(photo.file)));
      const { result: nextResult, model: nextModel } = await runPriceCheck({
        imageUrls,
        barcode: barcode.trim() || undefined,
        purchasePrice: parseMoneyInput(purchasePrice) ?? undefined,
        userNotes: userNotes.trim() || undefined,
      });
      setResult(nextResult);
      setModel(nextModel);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Price check failed');
    } finally {
      setAnalysing(false);
    }
  }

  async function handleCopyKeywords() {
    if (!result?.search_keywords?.length) return;
    const copied = await copyToClipboard(result.search_keywords.join(', '));
    flash(copied ? 'Search keywords copied' : 'Could not copy search keywords');
  }

  async function handleCopySummary() {
    if (!result?.summary) return;
    const copied = await copyToClipboard(result.summary);
    flash(copied ? 'Summary copied' : 'Could not copy summary');
  }

  return (
    <div>
      <PageHeader
        title="Price check"
        subtitle="Scan a barcode or photograph an item to get a rough estimate of retail and resale value before you buy"
        actions={<Link to="/add"><Button type="button" variant="ghost">Open add item</Button></Link>}
      />

      {toast ? (
        <div className="mb-4">
          <Alert tone="success">{toast}</Alert>
        </div>
      ) : null}

      {error ? (
        <div className="mb-4">
          <Alert>{error}</Alert>
        </div>
      ) : null}

      <Card className="mb-4 overflow-hidden bg-[radial-gradient(circle_at_top_right,_rgba(15,118,110,0.12),_transparent_36%),linear-gradient(145deg,#ffffff,#f8fafc)]">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-white/80 px-3 py-1 text-xs font-semibold text-teal-700 ring-1 ring-teal-100">
              <ScanSearch size={14} /> Field sourcing tool
            </div>
            <h2 className="text-xl font-bold tracking-tight text-slate-900">Retail and resale estimate</h2>
            <p className="mt-2 text-sm text-slate-600">
              Use barcode cues, visible branding, and item photos together. This first version gives a structured estimate for likely retail price, rough sold range, and a sensible max buy price.
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-400">How to get better results</p>
            <ul className="mt-2 space-y-1 text-sm text-slate-600">
              <li>Photograph the front of the item.</li>
              <li>Add the brand or size label if possible.</li>
              <li>Include the barcode or box when it exists.</li>
              <li>Treat the result as a guide, not an exact valuation.</li>
            </ul>
          </div>
        </div>
      </Card>

      <Card className="mb-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-800">Photos</h2>
          <span className="text-xs text-slate-400">{photos.length}/{MAX_PHOTOS}</span>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {photos.map((photo) => (
            <div key={photo.id} className="group relative aspect-square overflow-hidden rounded-xl bg-slate-100">
              <img src={photo.preview} alt="" className="h-full w-full object-cover" />
              <button
                type="button"
                onClick={() => removePhoto(photo.id)}
                className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
                aria-label="Remove photo"
              >
                <X size={14} />
              </button>
            </div>
          ))}

          {photos.length < MAX_PHOTOS ? (
            <>
              <button
                type="button"
                onClick={() => cameraRef.current?.click()}
                className="flex aspect-square flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-teal-300 bg-teal-50/50 text-teal-700 transition hover:bg-teal-50"
              >
                <Camera size={22} />
                <span className="text-[11px] font-medium">Camera</span>
              </button>
              <button
                type="button"
                onClick={() => galleryRef.current?.click()}
                className="flex aspect-square flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-slate-200 bg-slate-50 text-slate-500 transition hover:bg-slate-100"
              >
                <ImagePlus size={22} />
                <span className="text-[11px] font-medium">Gallery</span>
              </button>
            </>
          ) : null}
        </div>

        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          multiple
          className="hidden"
          onChange={onFilesSelected}
        />
        <input
          ref={galleryRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={onFilesSelected}
        />

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Input
            label="Barcode"
            value={barcode}
            onChange={(event) => setBarcode(event.target.value)}
            placeholder="Scan or type EAN / UPC / ISBN"
            hint={barcodeSupport === false ? 'This browser does not support automatic barcode detection from images, so use manual entry.' : detectingBarcode ? 'Checking selected photos for a barcode…' : 'If a barcode is visible in your photos, Starsella will try to detect it automatically.'}
          />
          <Input
            label="Your buy price (£)"
            value={purchasePrice}
            onChange={(event) => setPurchasePrice(event.target.value)}
            inputMode="decimal"
            placeholder="Optional"
            hint="Used to judge whether this looks like a sensible buy."
          />
          <div className="sm:col-span-2">
            <Textarea
              label="Notes"
              rows={3}
              value={userNotes}
              onChange={(event) => setUserNotes(event.target.value)}
              placeholder="Optional notes, visible model code, fabric, faults, or what shop price tag says"
            />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Button type="button" disabled={!photos.length || analysing} onClick={handleAnalyse}>
            {analysing ? <Spinner className="border-t-white" /> : <Sparkles size={16} />}
            Run price check
          </Button>
          <Button type="button" variant="ghost" disabled={!photos.length && !barcode && !purchasePrice && !userNotes} onClick={resetAll}>
            <Trash2 size={16} />
            Reset
          </Button>
        </div>
      </Card>

      {result ? (
        <div className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
            <Card>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    {result.pricing_basis ? <Badge tone="teal">{BASIS_COPY[result.pricing_basis]}</Badge> : null}
                    {result.category ? <Badge tone="blue">{result.category}</Badge> : null}
                    {typeof result.confidence === 'number' ? <Badge tone={result.confidence >= 0.75 ? 'emerald' : result.confidence >= 0.45 ? 'amber' : 'rose'}>{Math.round(result.confidence * 100)}% confidence</Badge> : null}
                  </div>
                  <h2 className="mt-3 text-xl font-bold tracking-tight text-slate-900">
                    {result.product_name || [result.brand, result.product_type].filter(Boolean).join(' ') || 'Price check result'}
                  </h2>
                  <p className="mt-2 text-sm text-slate-600">{result.summary || 'No summary returned for this price check.'}</p>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs">
                    <span className="rounded-full bg-emerald-50 px-2.5 py-1 font-medium text-emerald-700">75%+ higher-confidence estimate</span>
                    <span className="rounded-full bg-amber-50 px-2.5 py-1 font-medium text-amber-800">45-74% usable rough guide</span>
                    <span className="rounded-full bg-rose-50 px-2.5 py-1 font-medium text-rose-700">Below 45% double-check before buying</span>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" size="sm" variant="secondary" disabled={!result.search_keywords?.length} onClick={() => void handleCopyKeywords()}>
                    <Copy size={14} />
                    Copy keywords
                  </Button>
                  <Button type="button" size="sm" variant="ghost" disabled={!result.summary} onClick={() => void handleCopySummary()}>
                    <Copy size={14} />
                    Copy summary
                  </Button>
                </div>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <Stat label="Retail estimate" value={formatMoney(result.estimated_retail_price ?? null)} />
                <Stat label="Listing estimate" value={formatPriceBand(result.estimated_resale_listing_low, result.estimated_resale_listing_high)} />
                <Stat label="Sold estimate" value={formatPriceBand(result.estimated_sold_price_low, result.estimated_sold_price_high)} />
                <Stat label="Max buy guide" value={formatMoney(result.recommended_max_buy_price ?? null)} />
              </div>
            </Card>

            <Card>
              <h2 className="text-sm font-semibold text-slate-800">Identification</h2>
              <div className="mt-3 space-y-2 text-sm text-slate-600">
                <DetailRow label="Barcode" value={result.barcode || barcode || '—'} icon={<Barcode size={14} />} />
                <DetailRow label="Brand" value={result.brand || '—'} />
                <DetailRow label="Type" value={result.product_type || '—'} />
                <DetailRow label="Model" value={result.model_number || '—'} />
                <DetailRow label="Colour" value={result.colour || '—'} />
                <DetailRow label="Size" value={result.size || '—'} />
                <DetailRow label="Condition" value={result.condition_summary || '—'} />
                <DetailRow label="Model used" value={model || '—'} />
              </div>
            </Card>
          </div>

          {result.evidence?.length ? (
            <Card>
              <h2 className="text-sm font-semibold text-slate-800">Why this estimate</h2>
              <div className="mt-3 flex flex-wrap gap-2">
                {result.evidence.map((entry, index) => (
                  <span key={`${entry}-${index}`} className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
                    {entry}
                  </span>
                ))}
              </div>
            </Card>
          ) : null}

          {result.search_keywords?.length ? (
            <Card>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-slate-800">Comp search keywords</h2>
                  <p className="mt-1 text-xs text-slate-500">Use these to search sold listings more precisely when you want to double-check the estimate.</p>
                </div>
                <Search size={18} className="text-teal-600" />
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {result.search_keywords.map((keyword, index) => (
                  <span key={`${keyword}-${index}`} className="rounded-full bg-teal-50 px-3 py-1 text-xs font-medium text-teal-700">
                    {keyword}
                  </span>
                ))}
              </div>
            </Card>
          ) : null}

          {result.disclaimer ? (
            <Card>
              <Alert tone="warning">{result.disclaimer}</Alert>
            </Card>
          ) : (
            <Card>
              <Alert tone="warning">This is an estimate only. Use it as a quick sourcing guide, then verify with live comps before committing to a price-sensitive buy.</Alert>
            </Card>
          )}
        </div>
      ) : null}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
      <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-400">{label}</p>
      <p className="mt-2 text-lg font-semibold text-slate-900">{value}</p>
    </div>
  );
}

function DetailRow({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2">
      <span className="inline-flex items-center gap-2 text-xs font-medium uppercase tracking-[0.15em] text-slate-400">
        {icon}
        {label}
      </span>
      <span className="max-w-[60%] text-right text-sm font-medium text-slate-700">{value}</span>
    </div>
  );
}

async function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read image'));
    reader.readAsDataURL(file);
  });
}

async function detectBarcodeFromFile(file: File): Promise<string | null> {
  const Detector = window.BarcodeDetector;
  if (!Detector) return null;

  const supportedFormats = typeof Detector.getSupportedFormats === 'function'
    ? await Detector.getSupportedFormats().catch(() => [])
    : [];
  const preferredFormats = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'qr_code'];
  const formats = supportedFormats.length > 0
    ? preferredFormats.filter((format) => supportedFormats.includes(format))
    : undefined;

  const detector = formats?.length ? new Detector({ formats }) : new Detector();
  const bitmap = await createImageBitmap(file);
  try {
    const matches = await detector.detect(bitmap);
    const candidate = matches.find((match) => typeof match.rawValue === 'string' && match.rawValue.trim());
    return candidate?.rawValue?.trim() || null;
  } finally {
    bitmap.close();
  }
}

function formatPriceBand(low?: number | null, high?: number | null): string {
  if (low == null && high == null) return '—';
  if (low != null && high != null) {
    return low === high ? formatMoney(low) : `${formatMoney(low)} to ${formatMoney(high)}`;
  }
  return formatMoney(low ?? high ?? null);
}