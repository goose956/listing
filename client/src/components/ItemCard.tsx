import { Link } from 'react-router-dom';
import { MapPin, ImageIcon, Trash2 } from 'lucide-react';
import type { Item } from '../types';
import { STATUS_LABELS } from '../types';
import { formatMoney, storageLabel } from '../lib/format';
import { MarketplaceBadges } from './MarketplaceBadges';
import { Badge, cn, statusTone } from './ui';
import { ImageViewer } from './ImageViewer';

export function ItemCard({
  item,
  onDelete,
  footerAction,
}: {
  item: Item;
  onDelete?: () => void;
  footerAction?: React.ReactNode;
}) {
  return (
    <Link
      to={`/items/${item.id}`}
      className="group relative flex gap-3 rounded-2xl border border-slate-200/80 bg-white p-3 shadow-sm transition hover:border-teal-200 hover:shadow-md sm:p-3.5"
    >
      <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-slate-100 sm:h-24 sm:w-24">
        {item.primary_image_url ? (
          <ImageViewer
            src={item.primary_image_url}
            alt=""
            imgClassName="h-full w-full object-cover transition group-hover:scale-105"
            showZoomHint
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-slate-300">
            <ImageIcon size={28} />
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-mono text-xs font-semibold text-teal-700">{item.item_number}</p>
            <p className="truncate text-sm font-semibold text-slate-900">
              {item.title ||
                [item.brand, item.product_type].filter(Boolean).join(' ') ||
                'Untitled item'}
            </p>
          </div>
          <Badge tone={statusTone(item.status)}>{STATUS_LABELS[item.status]}</Badge>
        </div>

        {onDelete && (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onDelete();
            }}
            className={cn(
              'absolute right-3 top-3 z-10 rounded-lg p-1.5 text-slate-400 transition',
              'hover:bg-rose-50 hover:text-rose-600'
            )}
            aria-label={`Delete ${item.item_number}`}
          >
            <Trash2 size={15} />
          </button>
        )}

        <p className="mt-1 truncate text-xs text-slate-500">
          {[item.brand, item.size, item.colour, item.category].filter(Boolean).join(' · ') ||
            'Details pending'}
        </p>

        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <span className="font-semibold text-slate-800">
            {formatMoney(item.list_price ?? item.suggested_price)}
          </span>
          {item.purchase_price != null && (
            <span className="text-slate-400">Cost {formatMoney(item.purchase_price)}</span>
          )}
          <span className="inline-flex items-center gap-1 text-slate-400">
            <MapPin size={12} />
            {storageLabel(item)}
          </span>
        </div>

        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <MarketplaceBadges marketplaces={item.posted_marketplaces} />
          {footerAction ? <div className="relative z-10">{footerAction}</div> : null}
        </div>
      </div>
    </Link>
  );
}
