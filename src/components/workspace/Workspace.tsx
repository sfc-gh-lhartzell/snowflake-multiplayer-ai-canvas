"use client";

import { X, FileText, Presentation, CodeXml } from "lucide-react";
import { CocoArt } from "@/components/coco/Coco";
import { cn } from "@/lib/cn";
import { RichEditor } from "@/editor/RichEditor";
import { CodeArtifactEditor } from "@/editor/CodeArtifactEditor";
import { KindIcon } from "./DocRail";
import type { DocKind, DocMetaClient } from "./types";

export function Workspace({
  tabs,
  active,
  me,
  onSelect,
  onClose,
  onCreate,
  onNotice,
}: {
  tabs: DocMetaClient[];
  active: DocMetaClient | null;
  me: string;
  onSelect: (d: DocMetaClient) => void;
  onClose: (d: DocMetaClient) => void;
  onCreate: (k: DocKind) => void;
  onNotice: (t: string) => void;
}) {
  return (
    <section className="flex min-w-0 flex-1 flex-col py-5" aria-label="Workspace">
      <div className="neu-raised flex min-h-0 flex-1 flex-col overflow-hidden rounded-[28px]">
        {tabs.length ? (
          <div className="flex items-center gap-1.5 overflow-x-auto px-4 pt-3 pb-1 [scrollbar-width:none]" role="tablist">
            {tabs.map((t) => (
              <div
                key={t.docId}
                role="tab"
                aria-selected={active?.docId === t.docId}
                className={cn(
                  "group flex h-9 max-w-[220px] shrink-0 items-center gap-2 rounded-full pl-1.5 pr-1 text-[12.5px] font-semibold transition-shadow",
                  active?.docId === t.docId ? "shadow-[var(--neu-inset-sm)] text-[color:var(--color-accent-emphasis)]" : "text-[color:var(--color-text-secondary)] hover:shadow-[var(--neu-raised-sm)]"
                )}
              >
                <button type="button" onClick={() => onSelect(t)} className="flex min-w-0 items-center gap-2">
                  <KindIcon kind={t.kind} size={24} />
                  <span className="truncate">{t.title}</span>
                </button>
                <button
                  type="button"
                  onClick={() => onClose(t)}
                  aria-label={`Close ${t.title}`}
                  className="inline-flex h-6 w-6 items-center justify-center rounded-full opacity-60 hover:opacity-100 hover:shadow-[var(--neu-raised-sm)]"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        ) : null}
        <div className="min-h-0 flex-1">
          {active ? (
            active.kind === "doc" || active.kind === "slides" ? (
              <RichEditor key={active.docId} doc={active} me={me} onNotice={onNotice} />
            ) : (
              <CodeArtifactEditor key={active.docId} doc={active} me={me} onNotice={onNotice} />
            )
          ) : (
            <Welcome onCreate={onCreate} />
          )}
        </div>
      </div>
    </section>
  );
}

function Welcome({ onCreate }: { onCreate: (k: DocKind) => void }) {
  const cards: { kind: DocKind; title: string; body: string; icon: React.ReactNode }[] = [
    { kind: "doc", title: "Write a doc", body: "Briefs, specs, decision records. Comments, suggestions, live cursors.", icon: <FileText /> },
    { kind: "slides", title: "Build a deck", body: "Write in one flow; every --- is a new slide. Present in one click.", icon: <Presentation /> },
    { kind: "html", title: "Make an artifact", body: "HTML, markdown, or a chart, with a live sandboxed preview.", icon: <CodeXml /> },
  ];
  return (
    <div className="flex h-full flex-col items-center justify-center px-8 py-12 text-center">
      <div className="mb-3">
        <CocoArt name="artifacts" size={128} />
      </div>
      <h1 className="text-[26px] font-bold tracking-tight">Make things together, with Luke.</h1>
      <p className="mt-2 max-w-xl text-[14.5px] leading-relaxed text-[color:var(--color-text-secondary)]">
        Everyone here edits the same docs live. Ask <span className="font-semibold text-[color:var(--color-accent-emphasis)]">@Luke</span> to draft,
        review, query data, write code, or propose SQL for the team to approve.
      </p>
      <div className="mt-8 grid w-full max-w-3xl gap-5 [grid-template-columns:repeat(auto-fit,minmax(190px,1fr))]">
        {cards.map((c) => (
          <button
            key={c.kind}
            type="button"
            onClick={() => onCreate(c.kind)}
            className="neu-btn group rounded-[22px] p-5 text-left"
          >
            <KindIcon kind={c.kind} size={38} />
            <div className="mt-4 text-[14.5px] font-bold">{c.title}</div>
            <div className="mt-1 text-[12.5px] leading-relaxed text-[color:var(--color-text-muted)]">{c.body}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
