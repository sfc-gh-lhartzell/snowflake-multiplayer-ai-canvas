/**
 * In-memory collaboration hub: one live Y.Doc per open document.
 *
 * Browsers connect with an SSE stream (server -> client) and POST updates
 * (client -> server). The hub applies each update to its copy of the doc,
 * fans it out to every other connection, and autosaves the merged state to
 * DOCS (debounced) plus a version snapshot at most once a minute.
 *
 * Like canvas-bus, state is pinned to globalThis and assumes a single
 * container (app.yml max_instances: 1).
 */

import * as Y from "yjs";
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
  removeAwarenessStates,
} from "y-protocols/awareness";
import { getDoc, saveDocState, addVersion, type DocFull } from "./docs-store";

const SAVE_DEBOUNCE_MS = 1500;
const VERSION_EVERY_MS = 60_000;
const ROOM_IDLE_UNLOAD_MS = 5 * 60_000;

export interface AiOp {
  opId: string;            // the agent's tool_use_id
  tool: "edit_document" | "comment_on_document";
  input: Record<string, unknown>;
  by: string;              // teammate whose turn produced it
  at: number;
  claimedBy?: string;      // connection that applied it
}

type Send = (msg: unknown) => void;

interface Connection {
  send: Send;
  user: string;
  clientIds: Set<number>;  // awareness client ids this connection controls
}

interface Room {
  docId: string;
  ydoc: Y.Doc;
  awareness: Awareness;
  conns: Map<string, Connection>;
  meta: DocFull;
  seedClaimed: boolean;
  aiOps: AiOp[];
  saveTimer: NodeJS.Timeout | null;
  lastEditor: string | null;
  lastVersionAt: number;
  dirtySinceVersion: boolean;
  unloadTimer: NodeJS.Timeout | null;
}

interface HubState {
  rooms: Map<string, Room>;
  loading: Map<string, Promise<Room | undefined>>;
}

const KEY = "__CANVAS_DOC_HUB__";
// Each module evaluation gets its own token. In dev, hot reload re-evaluates
// this file with a fresh copy of Yjs; rooms built by the old copy can't take
// updates from the new one, so we start over (state reloads from DOCS).
const MODULE_TOKEN = Symbol("doc-hub");
function hub(): HubState {
  const g = globalThis as unknown as Record<string, (HubState & { token?: symbol }) | undefined>;
  if (!g[KEY] || g[KEY]!.token !== MODULE_TOKEN) {
    const old = g[KEY];
    if (old) {
      for (const room of old.rooms.values()) {
        if (room.saveTimer) clearTimeout(room.saveTimer);
        for (const c of room.conns.values()) c.send({ t: "reload" });
      }
    }
    g[KEY] = { rooms: new Map(), loading: new Map(), token: MODULE_TOKEN };
  }
  return g[KEY]!;
}

export async function getRoom(docId: string): Promise<Room | undefined> {
  const h = hub();
  const existing = h.rooms.get(docId);
  if (existing) return existing;
  if (!h.loading.has(docId)) {
    h.loading.set(
      docId,
      loadRoom(docId).finally(() => h.loading.delete(docId))
    );
  }
  return h.loading.get(docId)!;
}

async function loadRoom(docId: string): Promise<Room | undefined> {
  const meta = await getDoc(docId);
  if (!meta) return undefined;
  const ydoc = new Y.Doc();
  if (meta.ydocState) {
    Y.applyUpdate(ydoc, Buffer.from(meta.ydocState, "base64"), "load");
  }
  const awareness = new Awareness(ydoc);
  // The server is not a participant; drop its own (empty) awareness state.
  awareness.setLocalState(null);

  const room: Room = {
    docId,
    ydoc,
    awareness,
    conns: new Map(),
    meta,
    // A doc that already has content never needs seeding.
    seedClaimed: Boolean(meta.ydocState) || !meta.seed,
    aiOps: [],
    saveTimer: null,
    lastEditor: null,
    lastVersionAt: 0,
    dirtySinceVersion: false,
    unloadTimer: null,
  };

  ydoc.on("update", (update: Uint8Array, origin: unknown) => {
    if (origin === "load") return;
    const msg = { t: "update", u: Buffer.from(update).toString("base64") };
    for (const [id, c] of room.conns) if (id !== origin) c.send(msg);
    scheduleSave(room);
  });

  awareness.on(
    "update",
    ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
      const changed = added.concat(updated, removed);
      const conn = typeof origin === "string" ? room.conns.get(origin) : undefined;
      if (conn) {
        for (const id of added) conn.clientIds.add(id);
        for (const id of removed) conn.clientIds.delete(id);
      }
      const msg = { t: "awareness", u: Buffer.from(encodeAwarenessUpdate(awareness, changed)).toString("base64") };
      for (const [id, c] of room.conns) if (id !== origin) c.send(msg);
    }
  );

  hub().rooms.set(docId, room);
  return room;
}

function scheduleSave(room: Room) {
  room.dirtySinceVersion = true;
  if (room.saveTimer) clearTimeout(room.saveTimer);
  room.saveTimer = setTimeout(() => void flush(room), SAVE_DEBOUNCE_MS);
  broadcast(room, { t: "saving" });
}

async function flush(room: Room): Promise<void> {
  room.saveTimer = null;
  const state = Buffer.from(Y.encodeStateAsUpdate(room.ydoc)).toString("base64");
  try {
    await saveDocState(room.docId, state, room.lastEditor);
    if (room.dirtySinceVersion && Date.now() - room.lastVersionAt > VERSION_EVERY_MS) {
      room.lastVersionAt = Date.now();
      room.dirtySinceVersion = false;
      await addVersion(room.docId, state, null, room.lastEditor);
    }
    broadcast(room, { t: "saved", at: Date.now() });
  } catch (err) {
    console.error("[doc-hub] save failed", { docId: room.docId, message: (err as Error).message });
    broadcast(room, { t: "save_error" });
  }
}

function broadcast(room: Room, msg: unknown) {
  for (const c of room.conns.values()) c.send(msg);
}

// ----- connections ---------------------------------------------------------

export function connect(room: Room, connId: string, user: string, send: Send): void {
  if (room.unloadTimer) {
    clearTimeout(room.unloadTimer);
    room.unloadTimer = null;
  }
  room.conns.set(connId, { send, user, clientIds: new Set() });
  const states = Array.from(room.awareness.getStates().keys());
  send({
    t: "sync",
    u: Buffer.from(Y.encodeStateAsUpdate(room.ydoc)).toString("base64"),
    a: states.length ? Buffer.from(encodeAwarenessUpdate(room.awareness, states)).toString("base64") : null,
    seedPending: !room.seedClaimed,
    aiOps: room.aiOps.filter((o) => !o.claimedBy),
  });
}

export function disconnect(room: Room, connId: string): void {
  const c = room.conns.get(connId);
  room.conns.delete(connId);
  if (c && c.clientIds.size) removeAwarenessStates(room.awareness, Array.from(c.clientIds), "server");
  if (room.conns.size === 0) {
    room.unloadTimer = setTimeout(async () => {
      if (room.conns.size > 0) return;
      if (room.saveTimer) {
        clearTimeout(room.saveTimer);
        await flush(room);
      }
      hub().rooms.delete(room.docId);
      room.ydoc.destroy();
    }, ROOM_IDLE_UNLOAD_MS);
  }
}

export function applyClientUpdate(room: Room, connId: string, updateB64: string, user: string): void {
  room.lastEditor = user;
  Y.applyUpdate(room.ydoc, Buffer.from(updateB64, "base64"), connId);
}

export function applyClientAwareness(room: Room, connId: string, updateB64: string): void {
  applyAwarenessUpdate(room.awareness, Buffer.from(updateB64, "base64"), connId);
}

/** The first editor to open a fresh doc writes its seed content; others wait for the sync. */
export function claimSeed(room: Room): string | null {
  if (room.seedClaimed) return null;
  room.seedClaimed = true;
  return room.meta.seed ?? null;
}

export function roomMeta(room: Room): DocFull {
  return room.meta;
}

export function setRoomTitle(docId: string, title: string) {
  const room = hub().rooms.get(docId);
  if (room) room.meta = { ...room.meta, title };
}

// ----- agent edits ---------------------------------------------------------

/**
 * Queue one of Luke's edits for a document. Every open editor receives it;
 * the first to claim it applies the change (as a tracked suggestion) and the
 * Yjs sync carries the result to everyone else. If nobody has the doc open,
 * the op waits and is applied by the next editor that opens it.
 */
export async function enqueueAiOp(docId: string, op: AiOp): Promise<boolean> {
  const room = await getRoom(docId);
  if (!room) return false;
  if (room.aiOps.some((o) => o.opId === op.opId)) return true;
  room.aiOps.push(op);
  if (room.aiOps.length > 100) room.aiOps.shift();
  broadcast(room, { t: "ai.op", op });
  return true;
}

export function claimAiOp(room: Room, opId: string, connId: string): AiOp | null {
  const op = room.aiOps.find((o) => o.opId === opId);
  if (!op || op.claimedBy) return null;
  op.claimedBy = connId;
  broadcast(room, { t: "ai.op.claimed", opId });
  return op;
}

export function openRooms(): string[] {
  return Array.from(hub().rooms.keys());
}
