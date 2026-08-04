import { useRef, useState, type ChangeEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Camera, ImagePlus, Save, Sparkles, Trash2, Wand2, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { analyseImages, enhanceImage } from '../lib/api';
import { clearItemImages, createItem, deleteItem, updateItem, uploadItemImage } from '../lib/items';
import {
  CATEGORIES,
  CONDITION_LABELS,
  EMPTY_ITEM_FORM,
  type ItemCondition,
  type ItemFormData,
} from '../types';
import {
  Alert,
  Button,
  Card,
  Input,
  PageHeader,
  Select,
  Spinner,
  Textarea,
} from '../components/ui';

interface LocalPhoto {
  id: string;
  file: File;
  preview: string;
  enhanced?: boolean;
}

export function AddItemPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  const [photos, setPhotos] = useState<LocalPhoto[]>([]);
  const [form, setForm] = useState<ItemFormData>({ ...EMPTY_ITEM_FORM });
  const [aiNotes, setAiNotes] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [analysing, setAnalysing] = useState(false);
  const [enhancing, setEnhancing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [step, setStep] = useState<'photos' | 'details'>('photos');
  const [draftId, setDraftId] = useState<string | null>(null);

  function update<K extends keyof ItemFormData>(key: K, value: ItemFormData[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function onFilesSelected(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length) return;

    const next: LocalPhoto[] = files.map((file) => ({
      id: crypto.randomUUID(),
      file,
      preview: URL.createObjectURL(file),
    }));
    setPhotos((p) => [...p, ...next].slice(0, 10));
  }

  function removePhoto(id: string) {
    setPhotos((p) => {
      const found = p.find((x) => x.id === id);
      if (found) URL.revokeObjectURL(found.preview);
      return p.filter((x) => x.id !== id);
    });
  }

  async function handleEnhanceAll() {
    if (!photos.length) return;
    setEnhancing(true);
    setError(null);
    try {
      const updated: LocalPhoto[] = [];
      for (const photo of photos) {
        const blob = await enhanceImage(photo.file);
        const file = new File(
          [blob],
          photo.file.name.replace(/\.\w+$/, '') + '-enhanced.jpg',
          { type: 'image/jpeg' }
        );
        URL.revokeObjectURL(photo.preview);
        updated.push({
          id: photo.id,
          file,
          preview: URL.createObjectURL(file),
          enhanced: true,
        });
      }
      setPhotos(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Enhancement failed');
    } finally {
      setEnhancing(false);
    }
  }

  /**
   * Upload photos to a draft item, run AI analysis, then fill the form
   * in place so the user can review/edit every suggestion before saving.
   * The AI suggestions are ALSO saved to the draft immediately so the
   * data is never lost, even if the user navigates away.
   */
  async function handleAnalyse() {
    if (!user || !photos.length) return;
    setAnalysing(true);
    setError(null);
    setAiNotes(null);
    try {
      // Create a draft item to host images so OpenAI can fetch public URLs.
      const draft = await createItem(user.id, {
        ...EMPTY_ITEM_FORM,
        purchase_price: form.purchase_price,
        status: 'new',
      });
      setDraftId(draft.id);

      const urls: string[] = [];
      for (let i = 0; i < photos.length; i++) {
        const img = await uploadItemImage(user.id, draft.id, photos[i].file, {
          isPrimary: i === 0,
          sortOrder: i,
          isEnhanced: photos[i].enhanced,
        });
        urls.push(img.public_url);
      }

      const purchase = form.purchase_price ? Number(form.purchase_price) : undefined;
      const { analysis } = await analyseImages(urls, purchase);

      // Build a form carrying all AI suggestions (without losing purchase price).
      const aiForm: Partial<ItemFormData> = {
        purchase_price: form.purchase_price,
        brand: analysis.brand || '',
        product_type: analysis.product_type || '',
        category: analysis.category || '',
        colour: analysis.colour || '',
        size: analysis.size || '',
        condition: (analysis.condition as ItemCondition) || '',
        suggested_price:
          analysis.suggested_price != null ? String(analysis.suggested_price) : '',
        accept_offers_above:
          analysis.accept_offers_above != null ? String(analysis.accept_offers_above) : '',
        tags: analysis.tags?.join(', ') || '',
        notes: [analysis.condition_notes, analysis.notes].filter(Boolean).join('\n'),
        measurements: analysis.measurements_visible || '',
        status: 'new',
      };

      // Save the AI suggestions onto the draft item (NOT an empty form).
      await updateItem(draft.id, aiForm, {
        ai_analysis: analysis as unknown as Record<string, unknown>,
      });

      // Fill the on-screen form with the same AI suggestions for editing.
      setForm({ ...EMPTY_ITEM_FORM, ...aiForm });
      setDraftId(draft.id);
      setStep('details');
      setAiNotes(
        `AI suggestions ready (${Math.round((analysis.confidence ?? 0) * 100)}% confidence). ` +
          'Review and edit everything before saving.'
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI analysis failed');
      // Still allow manual entry
      setStep('details');
    } finally {
      setAnalysing(false);
    }
  }

  /** Reset the page back to the photo step, cleaning up any draft item. */
  async function handleReset() {
    if (draftId) {
      try {
        await clearItemImages(draftId);
        await deleteItem(draftId);
      } catch {
        // Best-effort cleanup; ignore failures
      }
      setDraftId(null);
    }
    photos.forEach((p) => URL.revokeObjectURL(p.preview));
    setPhotos([]);
    setForm({ ...EMPTY_ITEM_FORM });
    setAiNotes(null);
    setError(null);
    setStep('photos');
  }

  async function handleSaveManual() {
    if (!user) return;
    if (!photos.length) {
      setError('Add at least one photo');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      let item;
      if (draftId) {
        // Draft already exists (AI analysis ran) — update it, don't duplicate.
        item = await updateItem(draftId, form);
      } else {
        // No draft — create a new item and upload its photos.
        item = await createItem(user.id, form);
        for (let i = 0; i < photos.length; i++) {
          await uploadItemImage(user.id, item.id, photos[i].file, {
            isPrimary: i === 0,
            sortOrder: i,
            isEnhanced: photos[i].enhanced,
          });
        }
      }
      setDraftId(null);
      navigate(`/items/${item.id}?fresh=1`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save item');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Add new item"
        subtitle="Photograph at the boot sale, then fill details"
      />

      {error && (
        <div className="mb-4">
          <Alert>{error}</Alert>
        </div>
      )}
      {aiNotes && (
        <div className="mb-4">
          <Alert tone="info">{aiNotes}</Alert>
        </div>
      )}

      {/* Photos */}
      <Card className="mb-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-800">Photos</h2>
          <span className="text-xs text-slate-400">{photos.length}/10</span>
        </div>

        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
          {photos.map((p) => (
            <div
              key={p.id}
              className="group relative aspect-square overflow-hidden rounded-xl bg-slate-100"
            >
              <img src={p.preview} alt="" className="h-full w-full object-cover" />
              {p.enhanced && (
                <span className="absolute left-1 top-1 rounded bg-teal-600/90 px-1.5 py-0.5 text-[10px] font-medium text-white">
                  Enhanced
                </span>
              )}
              <button
                type="button"
                onClick={() => removePhoto(p.id)}
                className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
                aria-label="Remove photo"
              >
                <X size={14} />
              </button>
            </div>
          ))}

          {photos.length < 10 && (
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
          )}
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

        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            disabled={!photos.length || enhancing}
            onClick={handleEnhanceAll}
          >
            {enhancing ? <Spinner /> : <Wand2 size={16} />}
            Enhance lighting
          </Button>
          <Button
            type="button"
            disabled={!photos.length || analysing}
            onClick={handleAnalyse}
          >
            {analysing ? <Spinner className="border-t-white" /> : <Sparkles size={16} />}
            AI analyse
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={!photos.length}
            onClick={() => setStep('details')}
          >
            Enter details manually
          </Button>
        </div>
        <p className="mt-2 text-xs text-slate-400">
          Enhancement improves brightness/contrast only — it will not hide damage or change colours.
        </p>
      </Card>

      {(step === 'details' || form.brand || form.product_type) && (
        <Card className="mb-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-800">Item details</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              label="Purchase price (£)"
              inputMode="decimal"
              placeholder="0.00"
              value={form.purchase_price}
              onChange={(e) => update('purchase_price', e.target.value)}
            />
            <Input
              label="Brand"
              value={form.brand}
              onChange={(e) => update('brand', e.target.value)}
              placeholder="e.g. Barbour"
            />
            <Input
              label="Product type"
              value={form.product_type}
              onChange={(e) => update('product_type', e.target.value)}
              placeholder="e.g. Wax Jacket"
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
            <Input
              label="Size"
              value={form.size}
              onChange={(e) => update('size', e.target.value)}
            />
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
              label="Suggested price (£)"
              inputMode="decimal"
              value={form.suggested_price}
              onChange={(e) => update('suggested_price', e.target.value)}
            />
            <Input
              label="Container"
              value={form.storage_container}
              onChange={(e) => update('storage_container', e.target.value)}
              placeholder="e.g. Container 2"
            />
            <Input
              label="Box"
              value={form.storage_box}
              onChange={(e) => update('storage_box', e.target.value)}
              placeholder="e.g. Box 14"
            />
            <Input
              label="Shelf"
              value={form.storage_shelf}
              onChange={(e) => update('storage_shelf', e.target.value)}
            />
            <div className="sm:col-span-2">
              <Input
                label="Tags"
                value={form.tags}
                onChange={(e) => update('tags', e.target.value)}
                hint="Comma-separated search keywords"
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
            <Button type="button" disabled={saving} onClick={handleSaveManual}>
              {saving ? <Spinner className="border-t-white" /> : <Save size={16} />}
              Save item
            </Button>
            <Button type="button" variant="ghost" onClick={handleReset}>
              <Trash2 size={16} />
              Reset
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}