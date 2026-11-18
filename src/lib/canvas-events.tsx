"use client";

/**
 * One SSE connection per canvas, shared by every pane (chat, doc rail,
 * editors, header). Components subscribe with useCanvasEvent.
 */

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { sseUrl } from "./client-api";

export interface CanvasEvent {
  type: string;
  canvasId: string;
  by?: string;
  payload?: unknown;
  at: number;
}

export type ConnState = "connecting" | "live" | "disconnected";

type Listener = (e: CanvasEvent) => void;

interface Ctx {
  canvasId: string;
  me: string;
  users: string[];
  conn: ConnState;
  subscribe: (fn: Listener) => () => void;
}

const CanvasEventsContext = createContext<Ctx | null>(null);

export function CanvasEventsProvider({ canvasId, children }: { canvasId: string; children: ReactNode }) {
  const listeners = useRef(new Set<Listener>());
  const [me, setMe] = useState("…");
  const [users, setUsers] = useState<string[]>([]);
  const [conn, setConn] = useState<ConnState>("connecting");

  useEffect(() => {
    let es: EventSource | null = null;
    let stopped = false;
    let retry = 0;
    const onMessage = (msg: MessageEvent) => {
      let e: CanvasEvent;
      try {
        e = JSON.parse(msg.data) as CanvasEvent;
      } catch {
        return;
      }
      if (e.type === "presence.you" && e.by) setMe(e.by);
      if (e.type === "presence.state") setUsers(((e.payload as { users?: string[] })?.users) ?? []);
      for (const fn of listeners.current) {
        try {
          fn(e);
        } catch (err) {
          console.error("[canvas-events] listener failed", err);
        }
      }
    };
    const open = () => {
      es = new EventSource(sseUrl(`/api/canvas/${encodeURIComponent(canvasId)}/stream`));
      es.onopen = () => {
        retry = 0;
        setConn("live");
      };
      es.onerror = () => {
        setConn("disconnected");
        // Network drops auto-retry; an HTTP error closes the stream for good.
        if (es?.readyState === EventSource.CLOSED && !stopped) {
          setTimeout(() => !stopped && open(), Math.min(10_000, 500 * 2 ** retry++));
        }
      };
      es.onmessage = onMessage;
    };
    open();
    return () => {
      stopped = true;
      es?.close();
    };
  }, [canvasId]);

  const value: Ctx = {
    canvasId,
    me,
    users,
    conn,
    subscribe: (fn) => {
      listeners.current.add(fn);
      return () => listeners.current.delete(fn);
    },
  };
  return <CanvasEventsContext.Provider value={value}>{children}</CanvasEventsContext.Provider>;
}

export function useCanvas(): Ctx {
  const ctx = useContext(CanvasEventsContext);
  if (!ctx) throw new Error("useCanvas must be used inside CanvasEventsProvider");
  return ctx;
}

/** Subscribe to every canvas event. The latest handler is always used. */
export function useCanvasEvent(handler: Listener): void {
  const { subscribe } = useCanvas();
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => subscribe((e) => ref.current(e)), [subscribe]);
}
