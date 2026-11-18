"use client";

/**
 * Yjs provider over the app's own transport: an SSE stream for server -> client
 * and batched POSTs for client -> server (see /api/docs/[docId]/sync).
 *
 * Exposes `awareness` so TipTap's CollaborationCaret and y-codemirror can show
 * live cursors.
 */

import * as Y from "yjs";
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
  removeAwarenessStates,
} from "y-protocols/awareness";
import { apiFetch, sseUrl } from "./client-api";

export interface AiOp {
  opId: string;
  tool: "edit_document" | "comment_on_document";
  input: Record<string, unknown>;
  by: string;
  at: number;
}

export type SaveState = "idle" | "saving" | "saved" | "error";

interface ProviderEvents {
  onSynced?: (info: { seedPending: boolean; aiOps: AiOp[] }) => void;
  onAiOp?: (op: AiOp) => void;
  onAiOpClaimed?: (opId: string) => void;
  onSaveState?: (s: SaveState, at?: number) => void;
  onConnection?: (live: boolean) => void;
}

const FLUSH_MS = 40;

export class SseYProvider {
  readonly doc: Y.Doc;
  readonly awareness: Awareness;
  readonly connId: string;
  synced = false;

  private es: EventSource | null = null;
  private pendingUpdates: Uint8Array[] = [];
  private pendingAwareness: number[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private sending: Promise<void> = Promise.resolve();
  private destroyed = false;
  private retry = 0;

  constructor(private readonly docId: string, doc: Y.Doc, private readonly events: ProviderEvents = {}) {
    this.doc = doc;
    this.awareness = new Awareness(doc);
    this.connId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

    doc.on("update", this.onDocUpdate);
    this.awareness.on("update", this.onAwarenessUpdate);
    window.addEventListener("beforeunload", this.onUnload);
    this.connect();
  }

  private connect() {
    const url = sseUrl(`/api/docs/${encodeURIComponent(this.docId)}/sync?conn=${this.connId}`);
    const es = new EventSource(url);
    this.es = es;
    es.onopen = () => {
      this.retry = 0;
      this.events.onConnection?.(true);
    };
    es.onerror = () => {
      this.events.onConnection?.(false);
      // EventSource retries network drops itself, but gives up for good on an
      // HTTP error (e.g. a 500 while the server restarts). Take over then.
      if (es.readyState === EventSource.CLOSED && !this.destroyed) {
        const delay = Math.min(10_000, 500 * 2 ** this.retry++);
        setTimeout(() => !this.destroyed && this.connect(), delay);
      }
    };
    es.onmessage = (msg) => {
      let m: { t: string; u?: string; a?: string | null; seedPending?: boolean; aiOps?: AiOp[]; op?: AiOp; opId?: string; at?: number };
      try {
        m = JSON.parse(msg.data);
      } catch {
        return;
      }
      switch (m.t) {
        case "sync": {
          if (m.u) Y.applyUpdate(this.doc, fromB64(m.u), this);
          if (m.a) applyAwarenessUpdate(this.awareness, fromB64(m.a), this);
          const first = !this.synced;
          this.synced = true;
          // After a reconnect, push everything we have; the server merges idempotently.
          this.queueUpdate(Y.encodeStateAsUpdate(this.doc));
          this.queueAwareness([this.doc.clientID]);
          if (first) this.events.onSynced?.({ seedPending: Boolean(m.seedPending), aiOps: m.aiOps ?? [] });
          else for (const op of m.aiOps ?? []) this.events.onAiOp?.(op);
          break;
        }
        case "update":
          if (m.u) Y.applyUpdate(this.doc, fromB64(m.u), this);
          break;
        case "awareness":
          if (m.u) applyAwarenessUpdate(this.awareness, fromB64(m.u), this);
          break;
        case "ai.op":
          if (m.op) this.events.onAiOp?.(m.op);
          break;
        case "ai.op.claimed":
          if (m.opId) this.events.onAiOpClaimed?.(m.opId);
          break;
        case "saving":
          this.events.onSaveState?.("saving");
          break;
        case "saved":
          this.events.onSaveState?.("saved", m.at);
          break;
        case "save_error":
          this.events.onSaveState?.("error");
          break;
        case "reload":
          // Server dropped its copy (dev hot reload). Reconnect; the resync
          // pushes our full state so nothing typed locally is lost.
          es.close();
          if (!this.destroyed) setTimeout(() => this.connect(), 300);
          break;
      }
    };
  }

  private onDocUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === this) return;
    this.queueUpdate(update);
  };

  private onAwarenessUpdate = (
    { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown
  ) => {
    if (origin === this) return;
    this.queueAwareness(added.concat(updated, removed));
  };

  private queueUpdate(u: Uint8Array) {
    if (!this.synced) return; // the post-sync full push covers anything earlier
    this.pendingUpdates.push(u);
    this.scheduleFlush();
  }

  private queueAwareness(ids: number[]) {
    for (const id of ids) if (!this.pendingAwareness.includes(id)) this.pendingAwareness.push(id);
    this.scheduleFlush();
  }

  private scheduleFlush() {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flush();
    }, FLUSH_MS);
  }

  private flush() {
    const updates = this.pendingUpdates.splice(0);
    const aw = this.pendingAwareness.splice(0);
    if (!updates.length && !aw.length) return;
    const body: { conn: string; update?: string; awareness?: string } = { conn: this.connId };
    if (updates.length) body.update = toB64(updates.length === 1 ? updates[0] : Y.mergeUpdates(updates));
    if (aw.length) body.awareness = toB64(encodeAwarenessUpdate(this.awareness, aw));
    // Keep POSTs in order so the server applies edits in the order we made them.
    this.sending = this.sending.then(() =>
      apiFetch(`/api/docs/${encodeURIComponent(this.docId)}/sync`, {
        method: "POST",
        body: JSON.stringify(body),
        keepalive: true,
      })
        .then(() => undefined)
        .catch(() => {
          // Network blip: the next sync after reconnect re-sends full state.
        })
    );
  }

  /** First-claim-wins handoff (seed content or one of Luke's edits). */
  async claim(kind: "seed"): Promise<{ granted: boolean; seed?: string | null }>;
  async claim(kind: "op", opId: string): Promise<{ granted: boolean; op?: AiOp | null }>;
  async claim(kind: "seed" | "op", opId?: string) {
    const res = await apiFetch(`/api/docs/${encodeURIComponent(this.docId)}/claim`, {
      method: "POST",
      body: JSON.stringify({ conn: this.connId, kind, opId }),
    });
    return res.json();
  }

  /** Tell the room how one of Luke's ops went (after this connection applied it). */
  async report(opId: string, ok: boolean, text: string) {
    await apiFetch(`/api/docs/${encodeURIComponent(this.docId)}/claim`, {
      method: "POST",
      body: JSON.stringify({ conn: this.connId, kind: "done", opId, ok, text }),
    }).catch(() => {});
  }

  private onUnload = () => {
    removeAwarenessStates(this.awareness, [this.doc.clientID], "unload");
    this.flush();
  };

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.onUnload();
    window.removeEventListener("beforeunload", this.onUnload);
    this.doc.off("update", this.onDocUpdate);
    this.awareness.off("update", this.onAwarenessUpdate);
    this.es?.close();
    this.awareness.destroy();
  }
}

function toB64(u: Uint8Array): string {
  let s = "";
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromB64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export { toB64, fromB64 };
