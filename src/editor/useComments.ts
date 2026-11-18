"use client";

import { useCallback, useEffect, useState } from "react";
import { apiJson, apiFetch } from "@/lib/client-api";
import { useCanvasEvent, useCanvas } from "@/lib/canvas-events";
import type { CommentThread } from "./ThreadsPanel";

/** Comments for one document, kept fresh by comment.changed events from the room. */
export function useComments(docId: string) {
  const { canvasId } = useCanvas();
  const [comments, setComments] = useState<CommentThread[]>([]);

  const refresh = useCallback(() => {
    apiJson<{ comments: CommentThread[] }>(`/api/docs/${encodeURIComponent(docId)}/comments`)
      .then((r) => setComments(r.comments))
      .catch(() => {});
  }, [docId]);

  useEffect(refresh, [refresh]);
  useCanvasEvent((e) => {
    if (e.type === "comment.changed" && (e.payload as { docId?: string })?.docId === docId) refresh();
  });

  const add = useCallback(
    async (args: { commentId?: string; parentId?: string; quote?: string | null; body: string }) => {
      await apiFetch(`/api/docs/${encodeURIComponent(docId)}/comments`, { method: "POST", body: JSON.stringify(args) });
      refresh();
    },
    [docId, refresh]
  );

  const resolve = useCallback(
    async (commentId: string, resolved: boolean) => {
      setComments((cs) => cs.map((c) => (c.commentId === commentId || c.parentId === commentId ? { ...c, resolved } : c)));
      await apiFetch(`/api/comments/${encodeURIComponent(commentId)}`, {
        method: "PATCH",
        body: JSON.stringify({ resolved, canvasId, docId }),
      });
    },
    [canvasId, docId]
  );

  return { comments, add, resolve, refresh };
}
