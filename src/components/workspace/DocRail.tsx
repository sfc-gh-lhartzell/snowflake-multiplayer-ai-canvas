"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { CocoArt, CocoFace, PixelKindIcon } from "@/components/coco/Coco";
import { cn } from "@/lib/cn";
import { displayName } from "@/lib/colors";
import type { DocKind, DocMetaClient } from "./types";

export const KIND_META: Record<DocKind, { label: string; tint: string }> = {
  doc: { label: "Doc", tint: "#1FA4D8" },
  slides: { label: "Slides", tint: "#F59E0B" },
  html: { label: "HTML", tint: "#7B61FF" },
  markdown: { label: "Markdown", tint: "#10B981" },
  chart: { label: "Chart", tint: "#E8618C" },
};

export function KindIcon({ kind, size = 30 }: { kind: DocKind; size?: number }) {
  const m = KIND_META[kind];
  return (
    <span
      className="neu-raised-sm inline-flex shrink-0 items-center justify-center rounded-[10px]"
      style={{ width: size, height: size }}
      aria-hidden
    >
      <PixelKindIcon kind={kind} tint={m.tint} size={Math.round(size * 0.58)} />
    </span>
  );
}

export function DocRail({
  docs,
  activeId,
  onOpen,
  onCreate,
  onArchive,
}: {
  docs: DocMetaClient[];
  activeId: string | null;
  onOpen: (d: DocMetaClient) => void;
  onCreate: (kind: DocKind) => void;
  onArchive: (d: DocMetaClient) => void;
}) {
  const [menu, setMenu] = useState(false);
  return (
    <nav className="flex h-full w-[clamp(196px,15vw,240px)] shrink-0 flex-col gap-4 py-5 pl-5" aria-label="Canvas documents">
      <div className="relative">
        <button
          type="button"
          onClick={() => setMenu((v) => !v)}
          aria-expanded={menu}
          className="neu-accent inline-flex h-11 w-full items-center justify-center gap-2 rounded-[16px] text-[13.5px] font-semibold"
        >
          <Plus className="h-4 w-4" /> New
        </button>
        {menu ? (
          <div className="neu-menu neu-rise absolute left-0 right-0 top-[52px] z-30 p-1.5" role="menu">
            {(Object.keys(KIND_META) as DocKind[]).map((k) => (
              <button
                key={k}
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenu(false);
                  onCreate(k);
                }}
                className="neu-ghost flex w-full items-center gap-3 px-2.5 py-2 text-left text-[13px] font-semibold"
              >
                <KindIcon kind={k} size={28} />
                {k === "doc" ? "Document" : k === "slides" ? "Slide deck" : k === "html" ? "HTML artifact" : k === "markdown" ? "Markdown file" : "Chart (Vega-Lite)"}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="px-1 text-[10.5px] font-bold uppercase tracking-[0.14em] text-[color:var(--color-text-muted)]">
        In this canvas
      </div>
      <div className="scroll-pane -mr-1 flex-1 space-y-2 overflow-y-auto pb-4 pl-1 pr-3 pt-1">
        {docs.length === 0 ? (
          <div className="neu-inset-sm flex flex-col items-center rounded-[14px] px-3 pb-3 pt-2 text-center text-[12px] leading-relaxed text-[color:var(--color-text-muted)]">
            <CocoArt name="files" size={72} />
            <span>Fresh ice. Create a doc, or ask <span className="font-semibold text-[color:var(--color-accent-emphasis)]">@Luke</span> to draft one.</span>
          </div>
        ) : null}
        {docs.map((d) => (
          <div key={d.docId} className="group relative">
            <button
              type="button"
              onClick={() => onOpen(d)}
              aria-current={d.docId === activeId ? "page" : undefined}
              className={cn(
                "flex w-full items-center gap-3 rounded-[14px] px-2.5 py-2 text-left transition-shadow",
                d.docId === activeId ? "shadow-[var(--neu-inset-sm)]" : "hover:shadow-[var(--neu-raised-sm)]"
              )}
            >
              <KindIcon kind={d.kind} />
              <span className="min-w-0 flex-1">
                <span className={cn("block truncate text-[13px] font-semibold", d.docId === activeId && "text-[color:var(--color-accent-emphasis)]")}>
                  {d.title}
                </span>
                <span className="flex items-center gap-1 truncate text-[11px] text-[color:var(--color-text-muted)]">
                  {d.createdBy === "LUKE" ? <span aria-label="Made by Luke" title="Made by Luke"><CocoFace size={12} /></span> : null}
                  {KIND_META[d.kind].label} · {d.updatedBy ? displayName(d.updatedBy === "LUKE" ? "Luke" : d.updatedBy) : ""}
                </span>
              </span>
            </button>
            <button
              type="button"
              onClick={() => onArchive(d)}
              className="neu-ghost absolute right-1.5 top-1/2 hidden h-7 w-7 -translate-y-1/2 items-center justify-center group-hover:inline-flex group-focus-within:inline-flex"
              aria-label={`Archive ${d.title}`}
              title="Archive"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
    </nav>
  );
}
