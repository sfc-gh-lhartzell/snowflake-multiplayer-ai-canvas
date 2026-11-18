"use client";

import { CocoFace } from "./coco/Coco";

/** The CoCo penguin in a raised tile, the name, and the Co-CoCo tag. */
export function BrandLockup() {
  return (
    <div className="flex items-center gap-2.5 select-none">
      <span className="neu-raised-sm inline-flex h-9 w-9 items-center justify-center rounded-[12px] bg-[color:var(--color-surface-raised)]" aria-hidden>
        <CocoFace size={24} />
      </span>
      <span className="flex items-baseline gap-1.5 text-[16px] font-bold tracking-tight text-[color:var(--color-text-primary)]">
        <span>
          Agent Canvas <span className="text-[color:var(--color-accent)]">Plus</span>
        </span>
        <span className="neu-inset-sm rounded-full px-2 py-0.5 text-[11px] font-bold tracking-tight text-[color:var(--color-accent-emphasis)]">
          Co-CoCo
        </span>
      </span>
    </div>
  );
}
