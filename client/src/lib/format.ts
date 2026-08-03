import { format, formatDistanceToNow, parseISO, isValid } from 'date-fns';

export function formatMoney(value: number | null | undefined): string {
  if (value == null || Number.isNaN(Number(value))) return '—';
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(Number(value));
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const d = typeof value === 'string' ? parseISO(value) : value;
  if (!isValid(d)) return '—';
  return format(d, 'dd MMM yyyy');
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const d = typeof value === 'string' ? parseISO(value) : value;
  if (!isValid(d)) return '—';
  return format(d, 'dd MMM yyyy HH:mm');
}

export function formatRelative(value: string | null | undefined): string {
  if (!value) return '';
  const d = parseISO(value);
  if (!isValid(d)) return '';
  return formatDistanceToNow(d, { addSuffix: true });
}

export function parseMoneyInput(value: string): number | null {
  const cleaned = value.replace(/[£,\s]/g, '').trim();
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

export function storageLabel(item: {
  storage_container?: string | null;
  storage_shelf?: string | null;
  storage_box?: string | null;
}): string {
  const parts = [
    item.storage_container,
    item.storage_shelf,
    item.storage_box,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'No location';
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // fallback
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      return true;
    } catch {
      return false;
    } finally {
      document.body.removeChild(ta);
    }
  }
}
