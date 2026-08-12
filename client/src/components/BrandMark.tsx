type BrandMarkProps = {
  className?: string;
  size?: number;
};

export function BrandMark({ className, size = 36 }: BrandMarkProps) {
  return (
    <div
      className={className}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="4" y="4" width="56" height="56" rx="18" fill="url(#starsella-bg)" />
        <path
          d="M32 14.5L36.767 24.159L47.427 25.708L39.714 33.225L41.535 43.844L32 38.83L22.465 43.844L24.286 33.225L16.573 25.708L27.233 24.159L32 14.5Z"
          fill="#FFF7D6"
        />
        <circle cx="47.5" cy="18.5" r="4.5" fill="#F8FAFC" fillOpacity="0.95" />
        <defs>
          <linearGradient id="starsella-bg" x1="10" y1="8" x2="54" y2="58" gradientUnits="userSpaceOnUse">
            <stop stopColor="#0F766E" />
            <stop offset="1" stopColor="#0F172A" />
          </linearGradient>
        </defs>
      </svg>
    </div>
  );
}
