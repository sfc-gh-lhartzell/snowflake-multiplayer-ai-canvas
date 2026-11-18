"use client";

import { useEffect, useState } from "react";
import { Cloud, CloudOff, LoaderCircle, History } from "lucide-react";
import type { SaveState } from "@/lib/y-provider";
import type { Peer } from "./useDocSession";
import { apiFetch } from "@/lib/client-api";

const KIND_LABEL: Record<string, string> = {
  doc: "Doc",
  slides: "Slides",
  html: "HTML artifact",
  markdown: "Markdown",
  chart: "Chart",
};

export function DocHeader({
  docId,
  kind,
  title,
  saveState,
  savedAt,
  live,
  peers,
  onOpenHistory,
  right,
}: {
  docId: string;
  kind: string;
  title: string;
  saveState: SaveState;
  savedAt: number | null;
  live: boolean;
  peers: Peer[];
  onOpenHistory?: () => void;
  right?: React.ReactNode;
}) {
  const [draft, setDraft] = useState(title);
  useEffect(() => setDraft(title), [title]);

  const commitTitle = () => {
    const t = draft.trim();
    if (!t || t === title) {
      setDraft(title);
      return;
    }
    void apiFetch(`/api/docs/${encodeURIComponent(docId)}`, { method: "PATCH", body: JSON.stringify({ title: t }) });
  };

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-6 pt-5 pb-3">
      <div className="min-w-[200px] flex-1">
        <div className="mb-1 text-[10.5px] font-bold uppercase tracking-[0.14em] text-[color:var(--color-accent-emphasis)]">
          {KIND_LABEL[kind] ?? kind}
        </div>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitTitle}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") {
              setDraft(title);
              (e.target as HTMLInputElement).blur();
            }
          }}
          aria-label="Document title"
          className="neu-focus w-full rounded-[10px] bg-transparent px-1 -ml-1 text-[22px] font-bold tracking-tight text-[color:var(--color-text-primary)] outline-none"
        />
      </div>
      <PeerStack peers={peers} />
      <SaveBadge state={saveState} savedAt={savedAt} live={live} />
      {onOpenHistory ? (
        <button
          type="button"
          onClick={onOpenHistory}
          className="neu-btn inline-flex h-9 w-9 items-center justify-center rounded-full"
          aria-label="Version history"
          title="Version history"
        >
          <History className="h-4 w-4" />
        </button>
      ) : null}
      {right}
    </div>
  );
}

function PeerStack({ peers }: { peers: Peer[] }) {
  if (!peers.length) return null;
  const shown = peers.slice(0, 4);
  return (
    <div className="flex items-center -space-x-2" aria-label={`Also here: ${peers.map((p) => p.name).join(", ")}`}>
      {shown.map((p) => (
        <span
          key={p.clientId}
          title={`${p.name} is editing`}
          className="inline-flex h-8 w-8 items-center justify-center rounded-full text-[11px] font-bold text-white ring-2 ring-[color:var(--color-surface-base)] shadow-[var(--neu-raised-sm)]"
          style={{ background: p.color }}
        >
          {p.name
            .split(" ")
            .map((s) => s[0])
            .join("")
            .slice(0, 2)}
        </span>
      ))}
      {peers.length > shown.length ? (
        <span className="neu-raised-sm inline-flex h-8 w-8 items-center justify-center rounded-full text-[11px] font-semibold">
          +{peers.length - shown.length}
        </span>
      ) : null}
    </div>
  );
}

function SaveBadge({ state, savedAt, live }: { state: SaveState; savedAt: number | null; live: boolean }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 15_000);
    return () => clearInterval(t);
  }, []);

  let icon = <Cloud className="h-3.5 w-3.5" />;
  let label = "Autosave on";
  let tone = "text-[color:var(--color-text-muted)]";
  if (!live) {
    icon = <CloudOff className="h-3.5 w-3.5" />;
    label = "Reconnecting…";
    tone = "text-[color:var(--color-warn-text)]";
  } else if (state === "saving") {
    icon = <LoaderCircle className="h-3.5 w-3.5 animate-spin" />;
    label = "Saving…";
  } else if (state === "error") {
    icon = <CloudOff className="h-3.5 w-3.5" />;
    label = "Save failed, retrying";
    tone = "text-[color:var(--color-danger-text)]";
  } else if (state === "saved" && savedAt) {
    label = `Saved ${ago(savedAt)}`;
    tone = "text-[color:var(--color-success-text)]";
  }
  return (
    <span className={`neu-inset-sm inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-[11.5px] font-semibold ${tone}`} role="status" aria-live="polite">
      {icon}
      {label}
    </span>
  );
}

function ago(t: number): string {
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 10) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m}m ago` : `${Math.round(m / 60)}h ago`;
}
