"use client";

import { useState } from "react";
import { Database, ShieldCheck, Check, X, LoaderCircle, Terminal, CircleCheck, CircleX } from "lucide-react";
import { apiFetch } from "@/lib/client-api";
import { displayName } from "@/lib/colors";
import { cn } from "@/lib/cn";

export interface SqlActionView {
  actionId: string;
  sqlText: string;
  rationale: string | null;
  proposedBy: string;
  status: "pending" | "running" | "approved" | "rejected" | "failed";
  decidedBy?: string | null;
  result?: { rowCount?: number; rows?: Record<string, unknown>[]; ranAs?: string; error?: string } | null;
}

export function SqlApprovalCard({ action }: { action: SqlActionView }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const decide = async (decision: "approve" | "reject") => {
    setBusy(true);
    setErr(null);
    try {
      const res = await apiFetch(`/api/actions/${encodeURIComponent(action.actionId)}`, {
        method: "POST",
        body: JSON.stringify({ decision }),
      });
      if (!res.ok && res.status !== 500 && res.status !== 422) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        setErr(b.error === "already_decided" ? "A teammate already decided." : b.error ?? `Failed (${res.status})`);
      }
    } finally {
      setBusy(false);
    }
  };

  const pending = action.status === "pending";
  const rows = action.result?.rows ?? [];
  const cols = rows.length ? Object.keys(rows[0]) : [];

  return (
    <div className={cn("neu-raised-sm neu-rise mt-2 overflow-hidden rounded-[18px]", pending && "outline outline-2 outline-[color:rgba(245,158,11,0.45)]")}>
      <div className="flex items-center gap-2 px-3.5 pt-3">
        <span className="neu-raised-sm inline-flex h-7 w-7 items-center justify-center rounded-[9px] text-[#F59E0B]">
          <Database className="h-3.5 w-3.5" />
        </span>
        <span className="text-[13px] font-bold">SQL write proposed</span>
        <StatusPill status={action.status} />
      </div>
      {action.rationale ? <p className="px-3.5 pt-2 text-[12.5px] text-[color:var(--color-text-secondary)]">{action.rationale}</p> : null}
      <pre className="neu-inset-sm mx-3.5 mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-[12px] px-3 py-2.5 font-mono text-[12px] leading-relaxed text-[color:var(--color-text-primary)]">
        {action.sqlText}
      </pre>
      <div className="px-3.5 pb-3 pt-2.5">
        {pending ? (
          <>
            <p className="mb-2 flex items-center gap-1.5 text-[11.5px] text-[color:var(--color-text-muted)]">
              <ShieldCheck className="h-3.5 w-3.5" /> Nothing has run. Any teammate can approve; it runs under the approver&apos;s role when deployed.
            </p>
            <div className="flex gap-2">
              <button type="button" disabled={busy} onClick={() => decide("approve")} className="neu-accent inline-flex h-8 items-center gap-1.5 rounded-full px-4 text-[12.5px] font-semibold disabled:opacity-60">
                {busy ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Approve &amp; run
              </button>
              <button type="button" disabled={busy} onClick={() => decide("reject")} className="neu-btn inline-flex h-8 items-center gap-1.5 rounded-full px-4 text-[12.5px] font-semibold text-[color:var(--color-danger-text)]">
                <X className="h-3.5 w-3.5" /> Reject
              </button>
            </div>
          </>
        ) : (
          <div className="text-[12px] text-[color:var(--color-text-secondary)]">
            {action.decidedBy ? `${statusVerb(action.status)} by ${displayName(action.decidedBy)}` : null}
            {action.result?.ranAs ? ` · ran as ${action.result.ranAs}` : null}
            {action.result?.error ? (
              <p className="neu-inset-sm mt-2 rounded-[10px] px-3 py-2 font-mono text-[11.5px] text-[color:var(--color-danger-text)]">{action.result.error}</p>
            ) : null}
            {cols.length ? (
              <div className="neu-inset-sm mt-2 max-h-40 overflow-auto rounded-[10px]">
                <table className="w-full text-left text-[11.5px]">
                  <thead>
                    <tr>{cols.map((c) => <th key={c} className="px-2 py-1 font-semibold">{c}</th>)}</tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={i}>{cols.map((c) => <td key={c} className="px-2 py-1 font-mono">{String(r[c] ?? "")}</td>)}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        )}
        {err ? <p className="mt-2 text-[11.5px] text-[color:var(--color-danger-text)]">{err}</p> : null}
      </div>
    </div>
  );
}

export interface PermissionView {
  toolUseId: string;
  tool?: string;
  options: string[];
  input?: Record<string, unknown>;
  decided?: { by: string; decision: string };
}

export function CodePermissionCard({ canvasId, req }: { canvasId: string; req: PermissionView }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const code = typeof req.input?.code === "string" ? (req.input.code as string) : JSON.stringify(req.input ?? {}, null, 2);

  const decide = async (decision: string) => {
    setBusy(decision);
    setErr(null);
    try {
      const res = await apiFetch(`/api/canvas/${encodeURIComponent(canvasId)}/permission`, {
        method: "POST",
        body: JSON.stringify({ toolUseId: req.toolUseId, decision }),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
        setErr(b.code === "turn_in_flight" ? "Luke is busy; try again in a moment." : b.error ?? `Failed (${res.status})`);
      }
    } finally {
      setBusy(null);
    }
  };

  const allow = req.options.filter((o) => !/deny|reject/i.test(o));
  const deny = req.options.filter((o) => /deny|reject/i.test(o));

  return (
    <div className={cn("neu-raised-sm neu-rise mt-2 overflow-hidden rounded-[18px]", !req.decided && "outline outline-2 outline-[color:rgba(123,97,255,0.4)]")}>
      <div className="flex items-center gap-2 px-3.5 pt-3">
        <span className="neu-raised-sm inline-flex h-7 w-7 items-center justify-center rounded-[9px] text-[#7B61FF]">
          <Terminal className="h-3.5 w-3.5" />
        </span>
        <span className="text-[13px] font-bold">Run code in the sandbox?</span>
        {req.decided ? (
          <span className="ml-auto text-[11.5px] font-semibold text-[color:var(--color-text-muted)]">
            {req.decided.decision} · {displayName(req.decided.by)}
          </span>
        ) : null}
      </div>
      <pre className="neu-inset-sm mx-3.5 mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-[12px] px-3 py-2.5 font-mono text-[12px] leading-relaxed">{code}</pre>
      {!req.decided ? (
        <div className="flex flex-wrap gap-2 px-3.5 pb-3 pt-2.5">
          {allow.map((o) => (
            <button key={o} type="button" disabled={busy !== null} onClick={() => decide(o)} className="neu-accent inline-flex h-8 items-center gap-1.5 rounded-full px-4 text-[12.5px] font-semibold disabled:opacity-60">
              {busy === o ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} {o}
            </button>
          ))}
          {deny.map((o) => (
            <button key={o} type="button" disabled={busy !== null} onClick={() => decide(o)} className="neu-btn inline-flex h-8 items-center gap-1.5 rounded-full px-4 text-[12.5px] font-semibold text-[color:var(--color-danger-text)]">
              <X className="h-3.5 w-3.5" /> {o}
            </button>
          ))}
          {err ? <p className="w-full text-[11.5px] text-[color:var(--color-danger-text)]">{err}</p> : null}
        </div>
      ) : (
        <div className="pb-3" />
      )}
    </div>
  );
}

function StatusPill({ status }: { status: SqlActionView["status"] }) {
  const map = {
    pending: { label: "Awaiting approval", cls: "text-[color:var(--color-warn-text)]", icon: <ShieldCheck className="h-3 w-3" /> },
    running: { label: "Running…", cls: "text-[color:var(--color-accent-emphasis)]", icon: <LoaderCircle className="h-3 w-3 animate-spin" /> },
    approved: { label: "Ran", cls: "text-[color:var(--color-success-text)]", icon: <CircleCheck className="h-3 w-3" /> },
    rejected: { label: "Rejected", cls: "text-[color:var(--color-text-muted)]", icon: <CircleX className="h-3 w-3" /> },
    failed: { label: "Failed", cls: "text-[color:var(--color-danger-text)]", icon: <CircleX className="h-3 w-3" /> },
  }[status];
  return (
    <span className={cn("neu-inset-sm ml-auto inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold", map.cls)}>
      {map.icon}
      {map.label}
    </span>
  );
}

function statusVerb(s: SqlActionView["status"]) {
  return s === "approved" ? "Approved" : s === "rejected" ? "Rejected" : s === "failed" ? "Approved (failed)" : "Running";
}
