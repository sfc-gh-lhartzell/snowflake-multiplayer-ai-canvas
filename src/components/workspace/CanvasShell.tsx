"use client";

import { useCallback, useEffect, useState } from "react";
import { CanvasHeader } from "@/components/CanvasHeader";
import { DocRail } from "./DocRail";
import { Workspace } from "./Workspace";
import ChatClient from "@/app/canvas/[id]/ChatClient";
import { CanvasEventsProvider, useCanvas, useCanvasEvent } from "@/lib/canvas-events";
import { apiFetch, apiJson } from "@/lib/client-api";
import { useKonami } from "@/lib/konami";
import { toggleHalloween } from "@/lib/theme";
import type { DocKind, DocMetaClient } from "./types";

export function CanvasShell({ canvasId }: { canvasId: string }) {
  return (
    <CanvasEventsProvider canvasId={canvasId}>
      <Shell />
    </CanvasEventsProvider>
  );
}

interface Toast {
  id: number;
  text: string;
}

function Shell() {
  const { canvasId, me } = useCanvas();
  const [docs, setDocs] = useState<DocMetaClient[]>([]);
  const [tabs, setTabs] = useState<DocMetaClient[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [chatHidden, setChatHidden] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [halloweenFlash, setHalloweenFlash] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);
  // docId -> people with that doc open (from the doc hub), for initials in the rail.
  const [viewers, setViewers] = useState<Record<string, string[]>>({});

  useKonami(
    useCallback(() => {
      if (toggleHalloween() === "halloween") setHalloweenFlash(Date.now());
    }, [])
  );

  const toast = useCallback((text: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-3), { id, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000);
  }, []);

  const open = useCallback((d: DocMetaClient) => {
    setTabs((t) => (t.some((x) => x.docId === d.docId) ? t.map((x) => (x.docId === d.docId ? { ...x, ...d } : x)) : [...t, d]));
    setActiveId(d.docId);
  }, []);

  // Initial docs + deep link (?doc=<id>).
  useEffect(() => {
    apiJson<{ docs: DocMetaClient[] }>(`/api/canvas/${encodeURIComponent(canvasId)}/docs`)
      .then((r) => {
        setDocs(r.docs);
        const want = new URLSearchParams(window.location.search).get("doc");
        const d = want ? r.docs.find((x) => x.docId === want) : undefined;
        if (d) open(d);
        setLoaded(true);
      })
      .catch((e) => {
        setLoaded(true);
        toast(`Couldn't load documents: ${(e as Error).message}`);
      });
  }, [canvasId, open, toast]);

  // Keep ?doc= in the URL so a copied link opens the same document.
  useEffect(() => {
    if (!loaded) return; // don't clobber the deep link before it's been read
    const url = new URL(window.location.href);
    if (activeId) url.searchParams.set("doc", activeId);
    else url.searchParams.delete("doc");
    window.history.replaceState(null, "", url.toString());
  }, [activeId, loaded]);

  useCanvasEvent((e) => {
    if (e.type === "doc.viewers.state") {
      setViewers((e.payload as { viewers?: Record<string, string[]> })?.viewers ?? {});
    } else if (e.type === "doc.viewers") {
      const p = e.payload as { docId: string; users: string[] };
      setViewers((v) => ({ ...v, [p.docId]: p.users }));
    } else if (e.type === "doc.ai_op") {
      // Luke's edits apply in an open editor; open the doc for whoever asked, so they land right away.
      const p = e.payload as { doc?: DocMetaClient; requestedBy?: string };
      if (p.doc && p.requestedBy === me) open(p.doc);
    } else if (e.type === "doc.created") {
      const p = e.payload as { doc: DocMetaClient; open?: boolean; requestedBy?: string };
      setDocs((ds) => (ds.some((d) => d.docId === p.doc.docId) ? ds : [p.doc, ...ds]));
      // Luke's new doc opens for whoever asked for it; everyone else gets a card in chat.
      if (p.open && p.requestedBy === me) open(p.doc);
      if (e.by !== me && e.by !== "LUKE") toast(`${e.by} created “${p.doc.title}”`);
    } else if (e.type === "doc.updated") {
      const p = e.payload as { docId: string; title?: string; archived?: boolean };
      const patch = (d: DocMetaClient) => (d.docId === p.docId ? { ...d, title: p.title ?? d.title, updatedBy: e.by ?? d.updatedBy } : d);
      if (p.archived) {
        setDocs((ds) => ds.filter((d) => d.docId !== p.docId));
        setTabs((t) => t.filter((d) => d.docId !== p.docId));
        setActiveId((a) => (a === p.docId ? null : a));
      } else {
        setDocs((ds) => ds.map(patch));
        setTabs((t) => t.map(patch));
      }
    } else if (e.type === "session.reset") {
      toast(`${e.by ?? "Someone"} started a new session with Luke`);
    }
  });

  const create = useCallback(
    async (kind: DocKind) => {
      try {
        const r = await apiJson<{ doc: DocMetaClient }>(`/api/canvas/${encodeURIComponent(canvasId)}/docs`, {
          method: "POST",
          body: JSON.stringify({ kind, seed: STARTERS[kind] }),
        });
        setDocs((ds) => (ds.some((d) => d.docId === r.doc.docId) ? ds : [r.doc, ...ds]));
        open(r.doc);
      } catch (e) {
        toast(`Couldn't create: ${(e as Error).message}`);
      }
    },
    [canvasId, open, toast]
  );

  const archive = useCallback(
    async (d: DocMetaClient) => {
      if (!window.confirm(`Archive “${d.title}” for everyone?`)) return;
      await apiFetch(`/api/docs/${encodeURIComponent(d.docId)}`, { method: "PATCH", body: JSON.stringify({ archived: true }) });
    },
    []
  );

  const close = (d: DocMetaClient) => {
    setTabs((t) => {
      const next = t.filter((x) => x.docId !== d.docId);
      if (activeId === d.docId) setActiveId(next.length ? next[next.length - 1].docId : null);
      return next;
    });
  };

  const newSession = useCallback(async () => {
    const res = await apiFetch(`/api/canvas/${encodeURIComponent(canvasId)}/new-session`, { method: "POST" });
    if (!res.ok) toast(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `New session failed (${res.status}).`);
  }, [canvasId, toast]);

  const loadContext = useCallback(
    async (threadId: number) => {
      const res = await apiFetch(`/api/canvas/${encodeURIComponent(canvasId)}/load-context`, {
        method: "POST",
        body: JSON.stringify({ thread_id: threadId }),
      });
      if (!res.ok) toast(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `Load context failed (${res.status}).`);
    },
    [canvasId, toast]
  );

  const active = tabs.find((t) => t.docId === activeId) ?? null;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[color:var(--color-surface-base)]">
      {halloweenFlash !== null ? (
        <span key={halloweenFlash} className="canvas-halloween-flash" aria-hidden="true" onAnimationEnd={() => setHalloweenFlash(null)}>
          🎃
        </span>
      ) : null}
      <CanvasHeader onNewSession={newSession} onLoadContext={loadContext} chatHidden={chatHidden} onShowChat={() => setChatHidden(false)} />
      <div className="flex min-h-0 flex-1 gap-5">
        <DocRail docs={docs} activeId={activeId} viewers={viewers} me={me} onOpen={open} onCreate={create} onArchive={archive} />
        <Workspace tabs={tabs} active={active} me={me} onSelect={open} onClose={close} onCreate={create} onNotice={toast} />
        {chatHidden ? (
          <div className="w-0" />
        ) : (
          <ChatClient
            openDoc={active ? { id: active.docId, title: active.title, kind: active.kind } : null}
            onOpenDoc={open}
            onCollapse={() => setChatHidden(true)}
          />
        )}
      </div>
      <div className="pointer-events-none fixed bottom-6 left-1/2 z-[80] flex -translate-x-1/2 flex-col items-center gap-2" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="neu-raised neu-rise pointer-events-auto rounded-full px-4 py-2 text-[13px] font-semibold">
            {t.text}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Light starter content so a new doc isn't a blank wall. */
const STARTERS: Record<DocKind, string | undefined> = {
  doc: undefined,
  slides: "# Title slide\n\nSubtitle or presenter\n\n---\n\n# Agenda\n\n- First point\n- Second point\n- Third point\n",
  html: `<!doctype html>
<html>
  <head>
    <style>
      body { font-family: system-ui, sans-serif; margin: 0; display: grid; place-items: center; min-height: 100vh; background: #e7ecf3; }
      .card { padding: 32px 40px; border-radius: 24px; background: #e7ecf3; box-shadow: 10px 10px 24px #b8c2d0, -10px -10px 24px #ffffff; }
      h1 { margin: 0 0 8px; font-size: 28px; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>Hello from the canvas</h1>
      <p>Edit the HTML on the left. Everyone sees the preview update live.</p>
    </div>
  </body>
</html>
`,
  markdown: "# Notes\n\nWrite markdown on the left; the preview renders on the right.\n",
  chart: JSON.stringify(
    {
      $schema: "https://vega.github.io/schema/vega-lite/v5.json",
      title: "Sample",
      data: { values: [{ x: "A", y: 28 }, { x: "B", y: 55 }, { x: "C", y: 43 }] },
      mark: "bar",
      encoding: { x: { field: "x", type: "nominal" }, y: { field: "y", type: "quantitative" } },
    },
    null,
    2
  ),
};
