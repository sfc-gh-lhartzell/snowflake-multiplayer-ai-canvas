"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { History, RotateCcw, X, LoaderCircle } from "lucide-react";
import { apiJson } from "@/lib/client-api";
import { displayName } from "@/lib/colors";
import { CocoLoading, CocoSled, CocoEmpty, CocoArt, CocoFace, useCocoQuip } from "@/components/coco/Coco";

interface Version {
  versionId: string;
  savedBy: string | null;
  savedAt: string;
}

export function VersionsDialog({
  docId,
  onClose,
  onRestore,
}: {
  docId: string;
  onClose: () => void;
  onRestore: (ydocStateB64: string) => void;
}) {
  const [versions, setVersions] = useState<Version[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    apiJson<{ versions: Version[] }>(`/api/docs/${encodeURIComponent(docId)}/versions`)
      .then((r) => setVersions(r.versions))
      .catch((e) => setError((e as Error).message));
  }, [docId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const restore = async (v: Version) => {
    setBusy(v.versionId);
    try {
      const r = await apiJson<{ version: { ydocState: string | null } }>(
        `/api/docs/${encodeURIComponent(docId)}/versions?v=${encodeURIComponent(v.versionId)}`
      );
      if (r.version.ydocState) onRestore(r.version.ydocState);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/20 p-6 backdrop-blur-[2px]" onClick={onClose}>
      <div
        role="dialog"
        aria-label="Version history"
        className="neu-raised-lg neu-rise w-full max-w-md rounded-[24px] p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center gap-2">
          <History className="h-4 w-4 text-[color:var(--color-accent-emphasis)]" />
          <h2 className="text-[15px] font-bold">Version history</h2>
          <button type="button" onClick={onClose} className="neu-ghost ml-auto inline-flex h-8 w-8 items-center justify-center" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mb-3 text-[12.5px] text-[color:var(--color-text-muted)]">
          Snapshots are saved automatically at most once a minute while people edit. Restoring replaces the current content for everyone (and is itself undoable).
        </p>
        {error ? <p className="mb-3 text-[12.5px] text-[color:var(--color-danger-text)]">{error}</p> : null}
        <div className="scroll-pane max-h-[50vh] space-y-2 overflow-y-auto pr-1">
          {versions === null ? (
            <div className="flex justify-center py-6">
              <CocoSled size={64} label="Digging up snapshots…" />
            </div>
          ) : versions.length === 0 ? (
            <CocoEmpty art="automation" title="No snapshots yet" hint="Keep editing. CoCo saves one within a minute." />
          ) : (
            versions.map((v) => (
              <div key={v.versionId} className="neu-raised-sm flex items-center gap-3 rounded-[14px] px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-semibold">{new Date(Date.parse(v.savedAt)).toLocaleString()}</div>
                  <div className="text-[11.5px] text-[color:var(--color-text-muted)]">{v.savedBy ? displayName(v.savedBy) : "Autosave"}</div>
                </div>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => restore(v)}
                  className="neu-btn inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[12px] font-semibold"
                >
                  {busy === v.versionId ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                  Restore
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
