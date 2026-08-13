import { Badge } from './ui';

const MARKETPLACE_META: Record<string, { label: string; tone: 'teal' | 'blue' | 'rose' | 'violet' | 'emerald' | 'amber' | 'slate' }> = {
  vinted: { label: 'Vinted', tone: 'teal' },
  depop: { label: 'Depop', tone: 'rose' },
  ebay: { label: 'eBay', tone: 'blue' },
};

export function MarketplaceBadges({ marketplaces }: { marketplaces: string[] | null | undefined }) {
  const normalized = [...new Set((marketplaces ?? []).map((value) => value.trim().toLowerCase()).filter(Boolean))];
  if (normalized.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {normalized.map((marketplace) => {
        const meta = MARKETPLACE_META[marketplace] ?? { label: marketplace, tone: 'slate' as const };
        return (
          <Badge key={marketplace} tone={meta.tone}>
            {meta.label}
          </Badge>
        );
      })}
    </div>
  );
}
