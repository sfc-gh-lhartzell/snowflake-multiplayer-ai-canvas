"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { EditorView, basicSetup } from "codemirror";
import { EditorState, Compartment } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import { html as htmlLang } from "@codemirror/lang-html";
import { markdown as mdLang } from "@codemirror/lang-markdown";
import { json as jsonLang } from "@codemirror/lang-json";
import { yCollab } from "y-codemirror.next";
import * as Y from "yjs";
import { Code2, Columns2, Eye, MessagesSquare } from "lucide-react";
import type { SseYProvider, AiOp } from "@/lib/y-provider";
import { fromB64 } from "@/lib/y-provider";
import { apiFetch } from "@/lib/client-api";
import { userColor, displayName } from "@/lib/colors";
import { Markdown } from "@/components/Markdown";
import { ChartCard } from "@/components/ChartCard";
import { cn } from "@/lib/cn";
import { useDocSession } from "./useDocSession";
import { useTheme } from "@/lib/use-theme";
import { useComments } from "./useComments";
import { DocHeader } from "./DocHeader";
import { ThreadsPanel } from "./ThreadsPanel";
import { VersionsDialog } from "./VersionsDialog";
import type { DocMetaClient } from "@/components/workspace/types";
import { CocoLoading, CocoSled, CocoEmpty, CocoArt, CocoFace, useCocoQuip } from "@/components/coco/Coco";

const SNAPSHOT_DEBOUNCE_MS = 2000;
const PREVIEW_DEBOUNCE_MS = 350;

export function CodeArtifactEditor({ doc, me, onNotice }: { doc: DocMetaClient; me: string; onNotice: (t: string) => void }) {
  const pending = useRef<{ synced: boolean; seedPending: boolean; ops: AiOp[] }>({ synced: false, seedPending: false, ops: [] });
  const [pulse, setPulse] = useState(0);
  const session = useDocSession(doc.docId, me, {
    onSynced: ({ seedPending, aiOps }) => {
      pending.current = { synced: true, seedPending, ops: [...pending.current.ops, ...aiOps] };
      setPulse((n) => n + 1);
    },
    onAiOp: (op) => {
      pending.current.ops.push(op);
      setPulse((n) => n + 1);
    },
  });
  if (!session.ydoc || !session.provider || me === "…") {
    return <CocoLoading label="Sledding into the artifact…" />;
  }
  return (
    <div className="relative h-full">
      <Inner
        key={doc.docId}
        doc={doc}
        me={me}
        ydoc={session.ydoc}
        provider={session.provider}
        session={session}
        pending={pending}
        pulse={pulse}
        onNotice={onNotice}
      />
      {!session.synced ? (
        <div className="absolute inset-0 z-40 bg-[color:var(--color-surface-base)]">
          <CocoLoading label="Sledding into the artifact…" />
        </div>
      ) : null}
    </div>
  );
}

function Inner({
  doc,
  me,
  ydoc,
  provider,
  session,
  pending,
  pulse,
  onNotice,
}: {
  doc: DocMetaClient;
  me: string;
  ydoc: Y.Doc;
  provider: SseYProvider;
  session: ReturnType<typeof useDocSession>;
  pending: React.MutableRefObject<{ synced: boolean; seedPending: boolean; ops: AiOp[] }>;
  pulse: number;
  onNotice: (t: string) => void;
}) {
  const ytext = useMemo(() => ydoc.getText("code"), [ydoc]);
  const hostRef = useRef<HTMLDivElement>(null);
  const [source, setSource] = useState(() => ytext.toString());
  const [preview, setPreview] = useState(source);
  const [layout, setLayout] = useState<"split" | "code" | "preview">("split");
  const [threadsOpen, setThreadsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const { comments, add, resolve } = useComments(doc.docId);
  const [draft, setDraft] = useState<string | null>(null);
  const theme = useTheme();
  const viewRef = useRef<EditorView | null>(null);
  const themeSlot = useMemo(() => new Compartment(), []);

  // CodeMirror bound to the shared Y.Text, with live cursors.
  useEffect(() => {
    if (!hostRef.current) return;
    provider.awareness.setLocalStateField("user", {
      name: displayName(me),
      color: userColor(me),
      colorLight: `${userColor(me)}33`,
    });
    const undoManager = new Y.UndoManager(ytext);
    const lang = doc.kind === "html" ? htmlLang() : doc.kind === "chart" ? jsonLang() : mdLang();
    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: ytext.toString(),
        extensions: [
          basicSetup,
          lang,
          EditorView.lineWrapping,
          themeSlot.of(theme === "light" ? [] : oneDark),
          yCollab(ytext, provider.awareness, { undoManager }),
        ],
      }),
    });
    viewRef.current = view;
    const onText = () => setSource(ytext.toString());
    ytext.observe(onText);
    return () => {
      ytext.unobserve(onText);
      view.destroy();
      viewRef.current = null;
      undoManager.destroy();
    };
    // The theme is applied below without rebuilding the editor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ytext, provider, me, doc.kind]);

  useEffect(() => {
    viewRef.current?.dispatch({ effects: themeSlot.reconfigure(theme === "light" ? [] : oneDark) });
  }, [theme, themeSlot]);

  // Debounced preview + snapshot for Luke.
  useEffect(() => {
    const t = setTimeout(() => setPreview(source), PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [source]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onUpdate = (_u: Uint8Array, origin: unknown) => {
      if (origin === provider) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        void apiFetch(`/api/docs/${encodeURIComponent(doc.docId)}/snapshot`, {
          method: "POST",
          body: JSON.stringify({ snapshot: ytext.toString() }),
        });
      }, SNAPSHOT_DEBOUNCE_MS);
    };
    ydoc.on("update", onUpdate);
    return () => {
      ydoc.off("update", onUpdate);
      if (timer) clearTimeout(timer);
    };
  }, [ydoc, ytext, provider, doc.docId]);

  // Seed and Luke's edits (code is edited directly; there is no suggest mode for source).
  const busy = useRef(false);
  useEffect(() => {
    if (!pending.current.synced || busy.current) return;
    busy.current = true;
    (async () => {
      try {
        if (pending.current.seedPending) {
          pending.current.seedPending = false;
          const r = await provider.claim("seed");
          if (r.granted && r.seed && ytext.length === 0) ytext.insert(0, prettySeed(doc.kind, r.seed));
        }
        while (pending.current.ops.length) {
          const op = pending.current.ops.shift()!;
          const r = await provider.claim("op", op.opId);
          if (!r.granted) continue;
          if (op.tool === "edit_document") onNotice(applyCodeEdit(ytext, op.input, doc.title));
          else {
            setThreadsOpen(true);
          }
        }
      } finally {
        busy.current = false;
      }
    })();
  }, [pulse, provider, ytext, doc.kind, doc.title, onNotice, pending]);

  const restore = (b64: string) => {
    const tmp = new Y.Doc();
    Y.applyUpdate(tmp, fromB64(b64));
    const text = tmp.getText("code").toString();
    tmp.destroy();
    ydoc.transact(() => {
      ytext.delete(0, ytext.length);
      ytext.insert(0, text);
    });
    onNotice(`Restored an earlier version of “${doc.title}”.`);
  };

  return (
    <div className="relative flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col">
        <DocHeader
          docId={doc.docId}
          kind={doc.kind}
          title={doc.title}
          saveState={session.saveState}
          savedAt={session.savedAt}
          live={session.live}
          peers={session.peers}
          onOpenHistory={() => setHistoryOpen(true)}
          right={
            <div className="flex items-center gap-1">
              <div className="neu-inset-sm flex rounded-full p-1">
                <Seg active={layout === "code"} onClick={() => setLayout("code")} label="Code" icon={<Code2 className="h-3.5 w-3.5" />} />
                <Seg active={layout === "split"} onClick={() => setLayout("split")} label="Split" icon={<Columns2 className="h-3.5 w-3.5" />} />
                <Seg active={layout === "preview"} onClick={() => setLayout("preview")} label="Preview" icon={<Eye className="h-3.5 w-3.5" />} />
              </div>
              <button
                type="button"
                onClick={() => setThreadsOpen((v) => !v)}
                aria-pressed={threadsOpen}
                data-active={threadsOpen ? "true" : "false"}
                className="neu-btn inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-[12px] font-semibold"
              >
                <MessagesSquare className="h-3.5 w-3.5" />
                {comments.filter((c) => !c.parentId && !c.resolved).length || ""}
              </button>
            </div>
          }
        />
        <div className="flex min-h-0 flex-1 gap-5 px-6 pb-6">
          <div className={cn("neu-inset cm-host min-h-0 overflow-hidden rounded-[22px] p-2", layout === "preview" ? "hidden" : "flex-1")}>
            <div ref={hostRef} className="h-full overflow-auto" />
          </div>
          <div className={cn("neu-raised min-h-0 overflow-hidden rounded-[22px]", layout === "code" ? "hidden" : "flex-1")}>
            <Preview kind={doc.kind} source={preview} />
          </div>
        </div>
      </div>
      {threadsOpen ? (
        <div className="absolute bottom-3 right-3 top-3 z-30 flex min-h-0 flex-col overflow-hidden rounded-[24px] bg-[color:var(--color-surface-base)] shadow-[var(--neu-raised-lg)] neu-rise">
        <ThreadsPanel
          tab="comments"
          onTab={() => {}}
          comments={comments}
          activeComment={null}
          onFocusComment={() => {}}
          draftQuote={draft}
          onSubmitDraft={(body) => {
            void add({ body, quote: null });
            setDraft(null);
          }}
          onCancelDraft={() => setDraft(null)}
          onReply={(parentId, body) => void add({ parentId, body })}
          onResolve={(id, r) => void resolve(id, r)}
          suggestions={[]}
          onAccept={() => {}}
          onReject={() => {}}
          onAcceptAll={() => {}}
          onRejectAll={() => {}}
          onClose={() => setThreadsOpen(false)}
        />
        </div>
      ) : null}
      {threadsOpen && draft === null ? (
        <button
          type="button"
          onClick={() => setDraft("")}
          className="neu-accent absolute bottom-8 right-[352px] z-40 h-10 rounded-full px-4 text-[12.5px] font-semibold"
        >
          New comment
        </button>
      ) : null}
      {historyOpen ? <VersionsDialog docId={doc.docId} onClose={() => setHistoryOpen(false)} onRestore={restore} /> : null}
    </div>
  );
}

function Preview({ kind, source }: { kind: string; source: string }) {
  if (kind === "html") {
    // Scripts run, but the frame has an opaque origin: no cookies, storage, or app access.
    return <iframe title="HTML artifact preview" sandbox="allow-scripts" srcDoc={source} className="h-full w-full rounded-[22px] bg-white" />;
  }
  if (kind === "chart") {
    let spec: unknown = null;
    let error: string | null = null;
    try {
      spec = source.trim() ? JSON.parse(source) : null;
    } catch (e) {
      error = (e as Error).message;
    }
    return (
      <div className="scroll-pane h-full overflow-auto p-5">
        {error ? (
          <p className="neu-inset-sm rounded-[14px] p-3 font-mono text-[12px] text-[color:var(--color-danger-text)]">JSON error: {error}</p>
        ) : spec ? (
          <ChartCard spec={spec} title="Live preview" />
        ) : (
          <p className="text-[13px] text-[color:var(--color-text-muted)]">Write a Vega-Lite spec on the left, or ask Luke to chart something.</p>
        )}
      </div>
    );
  }
  return (
    <div className="scroll-pane prose-canvas h-full overflow-auto px-8 py-6">
      <Markdown>{source || "_Nothing here yet._"}</Markdown>
    </div>
  );
}

function Seg({ active, onClick, label, icon }: { active: boolean; onClick: () => void; label: string; icon: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-[11.5px] font-semibold",
        active ? "neu-raised-sm text-[color:var(--color-accent-emphasis)]" : "text-[color:var(--color-text-muted)]"
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function prettySeed(kind: string, seed: string): string {
  if (kind !== "chart") return seed;
  try {
    return JSON.stringify(JSON.parse(seed), null, 2);
  } catch {
    return seed;
  }
}

function applyCodeEdit(ytext: Y.Text, input: Record<string, unknown>, title: string): string {
  const op = String(input.operation ?? "append").toLowerCase();
  const find = String(input.find_text ?? "");
  const next = String(input.new_text ?? "");
  const text = ytext.toString();
  if (op === "replace") {
    const at = find ? text.indexOf(find) : -1;
    if (at < 0) return `Luke couldn't find the text to replace in “${title}”.`;
    ytext.doc!.transact(() => {
      ytext.delete(at, find.length);
      ytext.insert(at, next);
    });
    return `Luke updated “${title}”.`;
  }
  if (op === "prepend") ytext.insert(0, `${next}\n`);
  else ytext.insert(ytext.length, `${text.endsWith("\n") || !text ? "" : "\n"}${next}`);
  return `Luke updated “${title}”.`;
}
