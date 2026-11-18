"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FileText, ArrowUpRight, PanelRightClose, Pin } from "lucide-react";
import { MessageBubble } from "@/components/MessageBubble";
import { ToolCard, type ToolStatus } from "@/components/ToolCard";
import { SearchCard, type SearchCitation } from "@/components/SearchCard";
import { ChartCard } from "@/components/ChartCard";
import { FilingCard } from "@/components/FilingCard";
import { Composer } from "@/components/Composer";
import { EmptyState } from "@/components/EmptyState";
import { NoticeBanner } from "@/components/NoticeBanner";
import { SqlApprovalCard, CodePermissionCard, type SqlActionView, type PermissionView } from "@/components/ApprovalCards";
import { useCanvas, useCanvasEvent, type CanvasEvent } from "@/lib/canvas-events";
import { apiFetch } from "@/lib/client-api";
import type { DocMetaClient, OpenDocRef } from "@/components/workspace/types";
import { CocoArt, CocoSled } from "@/components/coco/Coco";

type ToolUse =
  | {
      kind: "analyst";
      id: string;
      toolName: string;
      status: ToolStatus;
      input?: unknown;
      sql?: string;
      resultSummary?: string;
    }
  | {
      kind: "search";
      id: string;
      toolName: string;
      status: ToolStatus;
      query?: string;
      citations?: SearchCitation[];
    }
  | {
      kind: "chart";
      id: string;
      toolName: string;
      status: ToolStatus;
      spec?: unknown;
      title?: string;
    };

type Message =
  | { kind: "user"; id: string; by: string; text: string }
  | { kind: "agent"; id: string; by: string; text: string; streaming: boolean; tools: ToolUse[] }
  | { kind: "system"; id: string; text: string }
  | {
      kind: "filing";
      id: string;
      filedBy: string;
      source: "user" | "agent";
      context: string;
      participants: string[];
      filedAt: number;
    }
  | { kind: "action"; id: string; action: SqlActionView }
  | { kind: "permission"; id: string; req: PermissionView }
  | { kind: "docnote"; id: string; doc: DocMetaClient; requestedBy?: string }
  | { kind: "aiop"; id: string; opId: string; tool: string; title: string; doc?: DocMetaClient; status: "pending" | "done" | "failed"; text?: string };

interface Notice {
  tone: "info" | "warn" | "danger";
  text: string;
}

/** Tools whose inputs are long document bodies: show a short summary instead. */
const DOC_TOOLS = new Set(["create_document", "edit_document", "comment_on_document"]);

export default function ChatClient({
  openDoc,
  onOpenDoc,
  onCollapse,
}: {
  openDoc: OpenDocRef | null;
  onOpenDoc: (d: DocMetaClient) => void;
  onCollapse?: () => void;
}) {
  const { canvasId } = useCanvas();
  const [messages, setMessages] = useState<Message[]>([]);
  const [sending, setSending] = useState<boolean>(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [autofill, setAutofill] = useState<string | undefined>(undefined);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const streamingIdRef = useRef<string | null>(null);

  useCanvasEvent((e: CanvasEvent) => handleEvent(e));

  // Show SQL proposals that are still waiting from before this page loaded.
  useEffect(() => {
    apiFetch(`/api/canvas/${encodeURIComponent(canvasId)}/actions`)
      .then((r) => (r.ok ? r.json() : { actions: [] }))
      .then((r: { actions: SqlActionView[] }) => {
        const waiting = r.actions.filter((a) => a.status === "pending").reverse();
        if (waiting.length) setMessages((m) => [...waiting.map((a) => ({ kind: "action" as const, id: `act-${a.actionId}`, action: a })), ...m]);
      })
      .catch(() => {});
  }, [canvasId]);

  function handleEvent(e: CanvasEvent) {
    switch (e.type) {
      case "presence.join":
        if (e.by) pushSystem(`${e.by} joined the canvas`);
        break;
      case "presence.leave":
        if (e.by) pushSystem(`${e.by} left`);
        break;
      case "session.reset":
        setMessages([
          {
            kind: "system",
            id: `s-${e.at}-${Math.random()}`,
            text: `New session started by ${e.by ?? "someone"}. Luke's turn-by-turn memory is reset. Filings and documents remain.`,
          },
        ]);
        break;
      case "system.note": {
        const payload = e.payload as { text?: string };
        if (payload?.text) pushSystem(payload.text);
        break;
      }
      case "user.message": {
        const payload = e.payload as { text: string };
        setMessages((m) => [...m, { kind: "user", id: `u-${e.at}-${e.by ?? "x"}`, by: e.by ?? "unknown", text: payload.text }]);
        break;
      }
      case "context.filed": {
        const p = e.payload as { id: string; source: "user" | "agent"; context: string; participants: string[]; filed_at: number };
        setMessages((m) => [
          ...m,
          {
            kind: "filing",
            id: p.id,
            filedBy: e.by ?? "unknown",
            source: p.source,
            context: p.context,
            participants: p.participants ?? [],
            filedAt: p.filed_at ?? e.at,
          },
        ]);
        break;
      }
      case "doc.created": {
        const p = e.payload as { doc: DocMetaClient; requestedBy?: string };
        if (e.by === "LUKE") {
          setMessages((m) => [...m, { kind: "docnote", id: `doc-${p.doc.docId}`, doc: p.doc, requestedBy: p.requestedBy }]);
        }
        break;
      }
      case "doc.ai_op": {
        const p = e.payload as { title: string; tool: string; opId: string; doc?: DocMetaClient };
        setMessages((m) =>
          m.some((x) => x.kind === "aiop" && x.opId === p.opId)
            ? m
            : [...m, { kind: "aiop", id: `op-${p.opId}`, opId: p.opId, tool: p.tool, title: p.title, doc: p.doc, status: "pending" }]
        );
        break;
      }
      case "doc.ai_op.done": {
        const p = e.payload as { opId: string; ok: boolean; text: string };
        setMessages((m) =>
          m.map((x) => (x.kind === "aiop" && x.opId === p.opId ? { ...x, status: p.ok ? "done" : "failed", text: p.text } : x))
        );
        break;
      }
      case "action.created": {
        const p = e.payload as { action: SqlActionView };
        setMessages((m) =>
          m.some((x) => x.kind === "action" && x.action.actionId === p.action.actionId)
            ? m
            : [...m, { kind: "action", id: `act-${p.action.actionId}`, action: p.action }]
        );
        break;
      }
      case "action.updated": {
        const p = e.payload as { actionId: string; status: SqlActionView["status"]; decidedBy: string; result: SqlActionView["result"] };
        setMessages((m) =>
          m.map((x) =>
            x.kind === "action" && x.action.actionId === p.actionId
              ? { ...x, action: { ...x.action, status: p.status, decidedBy: p.decidedBy, result: p.result ?? x.action.result } }
              : x
          )
        );
        break;
      }
      case "permission.requested": {
        const p = e.payload as PermissionView;
        setMessages((m) => [...m, { kind: "permission", id: `perm-${p.toolUseId}`, req: p }]);
        setSending(false);
        break;
      }
      case "permission.decided": {
        const p = e.payload as { toolUseId: string; decision: string };
        setMessages((m) =>
          m.map((x) => (x.kind === "permission" && x.req.toolUseId === p.toolUseId ? { ...x, req: { ...x.req, decided: { by: e.by ?? "", decision: p.decision } } } : x))
        );
        break;
      }
      case "agent.event": {
        const ev = e.payload as {
          event?: string;
          type?: string;
          text?: string;
          name?: string;
          input?: unknown;
          tool_use_id?: string;
          content?: unknown;
          status?: string;
          chart_spec?: string;
          permission?: unknown;
        };
        const kind = ev.event ?? ev.type;
        if (kind === "response.text.delta" && typeof ev.text === "string") {
          appendStreamingText(e.by ?? "assistant", ev.text);
        } else if (kind === "response.tool_use" && typeof ev.name === "string") {
          if (ev.name === "data_to_chart") break;
          if (ev.permission) break; // rendered as a CodePermissionCard
          attachToolUse(e.by ?? "assistant", { name: ev.name, input: summarizeInput(ev.name, ev.input), tool_use_id: ev.tool_use_id });
        } else if (kind === "response.chart" && typeof ev.chart_spec === "string") {
          attachChart(e.by ?? "assistant", { tool_use_id: ev.tool_use_id, chart_spec: ev.chart_spec });
        } else if (kind === "response.tool_result" && typeof ev.tool_use_id === "string") {
          completeToolUse({ tool_use_id: ev.tool_use_id, content: ev.content });
        }
        break;
      }
      case "turn.done":
        finalizeStreaming();
        setSending(false);
        break;
      case "turn.error": {
        const payload = e.payload as { message?: string };
        setNotice({ tone: "danger", text: `This turn didn't complete: ${payload?.message ?? "unknown error"}. Try again.` });
        finalizeStreaming();
        setSending(false);
        break;
      }
      default:
        break;
    }
  }

  function pushSystem(text: string) {
    setMessages((m) => [...m, { kind: "system", id: `s-${Date.now()}-${Math.random()}`, text }]);
  }

  function appendStreamingText(by: string, delta: string): void {
    setMessages((m) => {
      const id = streamingIdRef.current;
      if (id) return m.map((msg) => (msg.kind === "agent" && msg.id === id ? { ...msg, text: msg.text + delta } : msg));
      const newId = `a-${Date.now()}`;
      streamingIdRef.current = newId;
      return [...m, { kind: "agent", id: newId, by, text: delta, streaming: true, tools: [] }];
    });
  }

  function attachToolUse(by: string, tool: { name: string; input?: unknown; tool_use_id?: string }) {
    setMessages((m) => {
      const id = streamingIdRef.current;
      const newTool = buildToolUse(tool);
      if (id) return m.map((msg) => (msg.kind === "agent" && msg.id === id ? { ...msg, tools: [...msg.tools, newTool] } : msg));
      const newId = `a-${Date.now()}`;
      streamingIdRef.current = newId;
      return [...m, { kind: "agent", id: newId, by, text: "", streaming: true, tools: [newTool] }];
    });
  }

  function attachChart(by: string, args: { tool_use_id?: string; chart_spec: string }) {
    const spec = extractChartSpec(args.chart_spec);
    const chartId = args.tool_use_id ?? `chart-${Date.now()}-${Math.random()}`;
    setMessages((m) => {
      const streamingId = streamingIdRef.current;
      let placed = false;
      const next = m.map((msg) => {
        if (msg.kind !== "agent") return msg;
        if (msg.id !== streamingId && streamingId !== null) return msg;
        placed = true;
        return { ...msg, tools: [...msg.tools, buildChartToolUse(chartId, spec)] };
      });
      if (!placed) {
        const newId = `a-${Date.now()}`;
        streamingIdRef.current = newId;
        next.push({ kind: "agent", id: newId, by, text: "", streaming: true, tools: [buildChartToolUse(chartId, spec)] });
      }
      return next;
    });
  }

  function completeToolUse(tool: { tool_use_id?: string; content?: unknown }) {
    setMessages((m) =>
      m.map((msg) =>
        msg.kind !== "agent" ? msg : { ...msg, tools: msg.tools.map((t) => (t.id === tool.tool_use_id ? completeTool(t, tool.content) : t)) }
      )
    );
  }

  function finalizeStreaming() {
    const id = streamingIdRef.current;
    streamingIdRef.current = null;
    if (!id) return;
    setMessages((m) =>
      m.map((msg) =>
        msg.kind === "agent" && msg.id === id
          ? { ...msg, streaming: false, tools: msg.tools.map((t) => (t.status === "running" ? { ...t, status: "completed" as ToolStatus } : t)) }
          : msg
      )
    );
  }

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const handleSend = useCallback(
    async (text: string) => {
      const invokesAgent = /@luke\b/i.test(text);
      if (invokesAgent) setSending(true);
      setNotice(null);
      try {
        const res = await apiFetch(`/api/canvas/${encodeURIComponent(canvasId)}/send`, {
          method: "POST",
          body: JSON.stringify({ text, openDoc: openDoc ?? undefined }),
        });
        if (res.status === 409) {
          const body = await res.json();
          setNotice({
            tone: "warn",
            text: `${body.inflight_user ?? "Someone"} is in the middle of a turn with Luke. First send wins. Try again when they're done.`,
          });
          setAutofill(text);
          setSending(false);
        } else if (!res.ok) {
          setNotice({ tone: "danger", text: `Send failed (${res.status}). Try again.` });
          setAutofill(text);
          setSending(false);
        } else if (!invokesAgent) {
          setSending(false);
        }
      } catch (err) {
        setNotice({ tone: "danger", text: (err as Error).message });
        setAutofill(text);
        setSending(false);
      }
    },
    [canvasId, openDoc]
  );

  const handleFile = useCallback(
    async (args: { text?: string; source: "user" | "agent" }) => {
      setNotice(null);
      try {
        const res = await apiFetch(`/api/canvas/${encodeURIComponent(canvasId)}/file`, { method: "POST", body: JSON.stringify(args) });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          setNotice({ tone: "danger", text: `Filing failed${body.error ? `: ${body.error}` : ` (${res.status})`}.` });
        }
      } catch (err) {
        setNotice({ tone: "danger", text: (err as Error).message });
      }
    },
    [canvasId]
  );

  const pinChart = useCallback(
    async (spec: unknown) => {
      const title = (spec as { title?: unknown })?.title;
      const res = await apiFetch(`/api/canvas/${encodeURIComponent(canvasId)}/docs`, {
        method: "POST",
        body: JSON.stringify({
          kind: "chart",
          title: typeof title === "string" ? title : "Pinned chart",
          seed: JSON.stringify(spec, null, 2),
        }),
      });
      if (res.ok) onOpenDoc(((await res.json()) as { doc: DocMetaClient }).doc);
      else setNotice({ tone: "danger", text: `Pin failed (${res.status}).` });
    },
    [canvasId, onOpenDoc]
  );

  const isEmpty = messages.length === 0;

  return (
    <aside className="flex h-full w-[clamp(320px,26vw,400px)] shrink-0 flex-col py-5 pr-5" aria-label="Chat with the room and Luke">
      <div className="neu-raised flex min-h-0 flex-1 flex-col overflow-hidden rounded-[28px]">
        <div className="flex items-center gap-2 px-5 pt-4 pb-2">
          <span className="text-[13px] font-bold">Room chat</span>
          {openDoc ? (
            <span className="neu-inset-sm inline-flex min-w-0 items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold text-[color:var(--color-text-secondary)]" title="Luke sees which document you have open">
              <FileText className="h-3 w-3 shrink-0" />
              <span className="truncate">Luke sees: {openDoc.title}</span>
            </span>
          ) : null}
          {onCollapse ? (
            <button type="button" onClick={onCollapse} className="neu-ghost ml-auto inline-flex h-8 w-8 items-center justify-center" aria-label="Hide chat">
              <PanelRightClose className="h-4 w-4" />
            </button>
          ) : null}
        </div>
        <div ref={scrollRef} className="scroll-pane min-h-0 flex-1 overflow-y-auto px-4">
          {notice ? (
            <NoticeBanner tone={notice.tone} onDismiss={() => setNotice(null)}>
              {notice.text}
            </NoticeBanner>
          ) : null}
          {isEmpty ? (
            <EmptyState onPick={handleSend} />
          ) : (
            <div className="pb-4">
              {messages.map((m) => {
                if (m.kind === "system") return <MessageBubble key={m.id} role="system" author="" text={m.text} />;
                if (m.kind === "user") return <MessageBubble key={m.id} role="user" author={m.by} text={m.text} />;
                if (m.kind === "filing") {
                  return (
                    <FilingCard key={m.id} filedBy={m.filedBy} source={m.source} context={m.context} participants={m.participants} filedAt={m.filedAt} />
                  );
                }
                if (m.kind === "action") return <SqlApprovalCard key={m.id} action={m.action} />;
                if (m.kind === "permission") return <CodePermissionCard key={m.id} canvasId={canvasId} req={m.req} />;
                if (m.kind === "aiop") return <AiOpCard key={m.id} m={m} onOpen={m.doc ? () => onOpenDoc(m.doc!) : undefined} />;
                if (m.kind === "docnote") {
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => onOpenDoc(m.doc)}
                      className="neu-btn neu-rise my-2 flex w-full items-center gap-3 rounded-[16px] px-3 py-2.5 text-left"
                    >
                      <span className="neu-accent inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px]">
                        <FileText className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[11px] font-semibold text-[color:var(--color-text-muted)]">Luke created a {m.doc.kind === "doc" ? "doc" : m.doc.kind}</span>
                        <span className="block truncate text-[13px] font-bold">{m.doc.title}</span>
                      </span>
                      <ArrowUpRight className="h-4 w-4 text-[color:var(--color-accent)]" />
                    </button>
                  );
                }
                return (
                  <MessageBubble key={m.id} role="agent" author={m.by} text={m.text} streaming={m.streaming}>
                    {m.tools.map((t) => {
                      if (t.kind === "search") {
                        return (
                          <SearchCard
                            key={t.id}
                            query={t.query}
                            status={t.status}
                            citations={t.citations}
                            by={m.by}
                            variant={t.toolName === "web_search" ? "web" : "docs"}
                          />
                        );
                      }
                      if (t.kind === "chart") {
                        if (t.status === "completed" && t.spec) {
                          return (
                            <div key={t.id} className="relative">
                              <ChartCard spec={t.spec} title={t.title} />
                              <button
                                type="button"
                                onClick={() => pinChart(t.spec)}
                                className="neu-btn absolute right-2 top-4 inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-[11px] font-semibold"
                                title="Save as a chart artifact the team can edit"
                              >
                                <Pin className="h-3 w-3" /> Pin to canvas
                              </button>
                            </div>
                          );
                        }
                        return <ToolCard key={t.id} toolName="Chart" friendlyName="Chart" status={t.status} by={m.by} />;
                      }
                      return (
                        <ToolCard
                          key={t.id}
                          toolName={t.toolName}
                          status={t.status}
                          input={t.input}
                          sql={t.sql}
                          resultSummary={DOC_TOOLS.has(t.toolName) ? undefined : t.resultSummary}
                          by={m.by}
                        />
                      );
                    })}
                  </MessageBubble>
                );
              })}
            </div>
          )}
        </div>
        <Composer onSend={handleSend} onFile={handleFile} busy={sending} autofillValue={autofill} onAutofillConsumed={() => setAutofill(undefined)} />
      </div>
    </aside>
  );
}

function summarizeInput(name: string, input: unknown): unknown {
  if (!DOC_TOOLS.has(name) || !input || typeof input !== "object") return input;
  const r = input as Record<string, unknown>;
  const s = (k: string) => (typeof r[k] === "string" ? (r[k] as string) : "");
  if (name === "create_document") return `${s("kind")}: ${s("title")} (${s("content").length.toLocaleString()} chars)`;
  if (name === "edit_document") return `${s("operation")} in “${s("document")}”${s("find_text") ? `: “${s("find_text").slice(0, 80)}”` : ""}`;
  return `on “${s("document")}”: ${s("comment").slice(0, 120)}`;
}

function summarize(content: unknown): string | undefined {
  if (!content) return undefined;
  if (typeof content === "string") return content.length > 200 ? `${content.slice(0, 200)}…` : content;
  try {
    const s = JSON.stringify(content);
    return s.length > 200 ? `${s.slice(0, 200)}…` : s;
  } catch {
    return "Result received.";
  }
}

function classify(name: string): "analyst" | "search" | "chart" {
  const n = name.toLowerCase();
  if (n.includes("chart")) return "chart";
  if (n.includes("search")) return "search";
  return "analyst";
}

function buildToolUse(tool: { name: string; input?: unknown; tool_use_id?: string }): ToolUse {
  const id = tool.tool_use_id ?? `tool-${Date.now()}-${Math.random()}`;
  const kind = classify(tool.name);
  if (kind === "search") return { kind: "search", id, toolName: tool.name, status: "running", query: readQuery(tool.input) };
  if (kind === "chart") {
    const spec = extractChartSpec(readChartInput(tool.input));
    return { kind: "chart", id, toolName: tool.name, status: spec ? "completed" : "running", spec, title: "Chart" };
  }
  return { kind: "analyst", id, toolName: tool.name, status: "running", input: tool.input };
}

function buildChartToolUse(id: string, spec: unknown): ToolUse {
  return { kind: "chart", id, toolName: "chart", status: spec ? "completed" : "running", spec, title: "Chart" };
}

function completeTool(prev: ToolUse, content: unknown): ToolUse {
  if (prev.kind === "search") return { ...prev, status: "completed", citations: extractCitations(content) ?? prev.citations };
  if (prev.kind === "chart") return { ...prev, status: "completed", spec: extractChartSpec(content) ?? prev.spec };
  return { ...prev, status: "completed", resultSummary: summarize(content) };
}

function readQuery(input: unknown): string | undefined {
  if (!input) return undefined;
  if (typeof input === "string") return input;
  if (typeof input === "object") {
    const r = input as Record<string, unknown>;
    const v = r.query ?? r.question ?? r.text;
    if (typeof v === "string") return v;
  }
  return undefined;
}

function readChartInput(input: unknown): unknown {
  if (!input) return undefined;
  if (typeof input === "object") {
    const rec = input as Record<string, unknown>;
    return rec.chart ?? rec.spec ?? rec.query ?? input;
  }
  return input;
}

function extractCitations(content: unknown): SearchCitation[] | undefined {
  if (!content) return undefined;
  const asArray = Array.isArray(content) ? content : (content as { results?: unknown[] }).results;
  if (!Array.isArray(asArray)) return undefined;
  return asArray.slice(0, 8).map((r) => {
    const rec = r as Record<string, unknown>;
    return {
      title: (rec.title ?? rec.DOCUMENT_TITLE ?? rec.document_title) as string | undefined,
      url: (rec.url ?? rec.SOURCE_URL ?? rec.source_url) as string | undefined,
      snippet: (rec.snippet ?? rec.chunk ?? rec.CHUNK) as string | undefined,
    };
  });
}

function extractChartSpec(content: unknown): unknown | undefined {
  if (!content) return undefined;
  if (typeof content === "string") {
    try {
      return JSON.parse(content);
    } catch {
      return undefined;
    }
  }
  if (typeof content === "object") {
    const rec = content as Record<string, unknown>;
    return rec.spec ?? rec.chart ?? rec.vega_lite ?? content;
  }
  return content;
}

type AiOpMessage = Extract<Message, { kind: "aiop" }>;

/** Luke's edit or comment on a doc: pending (sledding) until the editor that applied it reports back. */
function AiOpCard({ m, onOpen }: { m: AiOpMessage; onOpen?: () => void }) {
  const edit = m.tool === "edit_document";
  const head =
    m.status === "pending"
      ? edit
        ? `Luke is editing \u201c${m.title}\u201d`
        : `Luke is commenting on \u201c${m.title}\u201d`
      : m.status === "failed"
        ? `Luke's edit to \u201c${m.title}\u201d didn't apply`
        : `Luke ${m.text ?? "edited"} in \u201c${m.title}\u201d`;
  const sub =
    m.status === "pending"
      ? "Lands as soon as someone has the doc open."
      : m.status === "failed"
        ? `He ${m.text ?? "couldn't apply it"}. Ask him to try again with the current text.`
        : edit
          ? "Review it in the doc's Suggestions tab."
          : null;
  return (
    <div className="neu-raised-sm neu-rise my-2 flex items-center gap-3 rounded-[16px] px-3 py-2.5">
      <span className="flex h-10 w-12 shrink-0 items-center justify-center">
        {m.status === "pending" ? <CocoSled size={44} /> : <CocoArt name={m.status === "failed" ? "slip" : "success"} size={40} replay={false} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[12.5px] font-bold leading-snug">{head}</span>
        {sub ? <span className="block text-[11.5px] text-[color:var(--color-text-muted)]">{sub}</span> : null}
      </span>
      {onOpen ? (
        <button type="button" onClick={onOpen} className="neu-btn inline-flex h-8 shrink-0 items-center gap-1 rounded-full px-3 text-[12px] font-semibold text-[color:var(--color-accent-emphasis)]">
          Open <ArrowUpRight className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </div>
  );
}
