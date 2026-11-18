"use client";

/**
 * One live collaborative session for a document: the Y.Doc, its provider,
 * save status, and who else is here. Shared by the rich editor (docs, slides)
 * and the code editor (HTML, markdown, chart artifacts).
 */

import { useEffect, useRef, useState } from "react";
import * as Y from "yjs";
import { SseYProvider, type AiOp, type SaveState } from "@/lib/y-provider";
import { userColor, displayName } from "@/lib/colors";

export interface Peer {
  clientId: number;
  name: string;
  color: string;
}

export interface DocSessionHandlers {
  onSynced?: (info: { seedPending: boolean; aiOps: AiOp[] }) => void;
  onAiOp?: (op: AiOp) => void;
}

export function useDocSession(docId: string, me: string, handlers: DocSessionHandlers) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  const [session, setSession] = useState<{ ydoc: Y.Doc; provider: SseYProvider } | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [peers, setPeers] = useState<Peer[]>([]);
  const [live, setLive] = useState(false);
  const [synced, setSynced] = useState(false);

  useEffect(() => {
    const ydoc = new Y.Doc();
    const provider = new SseYProvider(docId, ydoc, {
      onSynced: (info) => {
        setSynced(true);
        handlersRef.current.onSynced?.(info);
      },
      onAiOp: (op) => handlersRef.current.onAiOp?.(op),
      onSaveState: (s, at) => {
        setSaveState(s);
        if (s === "saved" && at) setSavedAt(at);
      },
      onConnection: setLive,
    });
    const updatePeers = () => {
      const list: Peer[] = [];
      provider.awareness.getStates().forEach((state, clientId) => {
        const u = (state as { user?: { name?: string; color?: string } }).user;
        if (u?.name && clientId !== ydoc.clientID) list.push({ clientId, name: u.name, color: u.color ?? "#888" });
      });
      setPeers(list);
    };
    provider.awareness.on("change", updatePeers);
    setSession({ ydoc, provider });
    setSynced(false);
    return () => {
      provider.awareness.off("change", updatePeers);
      provider.destroy();
      ydoc.destroy();
      setSession(null);
    };
  }, [docId]);

  // Publish who I am to everyone viewing this doc.
  useEffect(() => {
    if (!session || me === "…") return;
    session.provider.awareness.setLocalStateField("user", { name: displayName(me), color: userColor(me) });
  }, [session, me]);

  return { ...session, saveState, savedAt, peers, live, synced };
}
