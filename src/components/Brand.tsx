export function BrandLockup() {
  return (
    <div className="flex items-center gap-2.5 select-none">
      <span className="neu-accent inline-flex h-8 w-8 items-center justify-center rounded-[11px]" aria-hidden>
        <svg width="16" height="16" viewBox="0 0 32 32" fill="none">
          <g stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
            <line x1="16" y1="4" x2="16" y2="28" />
            <line x1="5.5" y1="10" x2="26.5" y2="22" />
            <line x1="5.5" y1="22" x2="26.5" y2="10" />
          </g>
        </svg>
      </span>
      <span className="text-[16px] font-bold tracking-tight text-[color:var(--color-text-primary)]">
        Agent Canvas <span className="text-[color:var(--color-accent)]">Plus</span>
      </span>
    </div>
  );
}
