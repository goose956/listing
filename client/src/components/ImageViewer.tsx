import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from './ui';

interface ImageViewerProps {
  src: string;
  alt?: string;
  className?: string;
  imgClassName?: string;
  showZoomHint?: boolean;
}

/**
 * A clickable image that opens a full-screen lightbox overlay.
 * Uses createPortal so the overlay is not clipped by parent containers.
 * Supports Escape key and click-outside-to-close.
 */
export function ImageViewer({
  src,
  alt = '',
  className,
  imgClassName,
  showZoomHint = false,
}: ImageViewerProps) {
  const [open, setOpen] = useState(false);

  // Close on Escape and lock body scroll when open
  useEffect(() => {
    if (!open) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open]);

  return (
    <>
      <div
        className={cn(
          'relative cursor-zoom-in',
          showZoomHint &&
            'group after:pointer-events-none after:absolute after:inset-0 after:rounded-lg after:bg-gradient-to-t after:from-black/20 after:to-transparent',
          className
        )}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
      >
        <img src={src} alt={alt} className={imgClassName} />
        {showZoomHint && (
          <div className="absolute right-1 top-1 rounded-full bg-black/40 p-1 text-white opacity-0 group-hover:opacity-100">
            <ZoomIcon size={14} />
          </div>
        )}
      </div>

      {open &&
        createPortal(
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          >
            <img
              src={src}
              alt={alt}
              className="max-w-[92vw] max-h-[92vh] object-contain"
              onClick={(e) => e.stopPropagation()}
            />
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="absolute right-4 top-4 rounded-full bg-white/15 p-2 text-white hover:bg-white/25"
              aria-label="Close"
            >
              <X size={20} />
            </button>
          </div>,
          document.body
        )}
    </>
  );
}

// Inline zoom icon (magnifying glass) so we don't depend on a separate import
function ZoomIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="10" cy="10" r="7" />
      <line x1="15" y1="15" x2="1" y2="1" />
    </svg>
  );
}
