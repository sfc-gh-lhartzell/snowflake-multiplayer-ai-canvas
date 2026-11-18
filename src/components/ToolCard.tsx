"use client";

import { useState } from "react";
import { ChevronRight, ChevronDown, Database, Loader2, CheckCircle2, XCircle } from "lucide-react";
import { Pill } from "./ui/Pill";
import { cn } from "@/lib/cn";
import { CocoSled } from "@/components/coco/Coco";

export type ToolStatus = "running" | "completed" | "errored";

interface ToolCardProps {
  toolName: string;
  friendlyName?: string;
  status: ToolStatus;
  input?: unknown;
  sql?: string;
  resultSummary?: string;
  by?: string;
}

export function ToolCard({ toolName, friendlyName, status, input, sql, resultSummary, by }: ToolCardProps) {
  const [open, setOpen] = useState(false);
  const label = friendlyName ?? prettify(toolName);

  return (
    <div
      className={cn(
        "neu-raised-sm mt-2 overflow-hidden rounded-[16px]",
        status === "errored" && "outline outline-1 outline-[color:var(--color-danger-border)]"
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 text-[color:var(--color-text-muted)]" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-[color:var(--color-text-muted)]" />
        )}
        <Database className="h-3.5 w-3.5 text-[color:var(--color-snow-700)]" />
        <span className="min-w-0 truncate text-[13px] font-medium text-[color:var(--color-text-primary)]">
          {label}
        </span>
        <span className="hidden truncate text-[12px] text-[color:var(--color-text-muted)] 2xl:inline">
          {statusCopy(status, toolName)}
          {by ? ` · for ${by}` : ""}
        </span>
        <span className="ml-auto">
          <StatusPill status={status} />
        </span>
      </button>

      {open ? (
        <div className="px-3 pb-3 text-[12.5px]">
          {input ? (
            <div className="mb-2">
              <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-[color:var(--color-text-muted)]">
                Prompt
              </div>
              <div className="neu-inset-sm max-h-48 overflow-auto whitespace-pre-wrap rounded-[10px] px-2.5 py-1.5 font-mono text-[12px] text-[color:var(--color-text-primary)]">
                {typeof input === "string" ? input : JSON.stringify(input, null, 2)}
              </div>
            </div>
          ) : null}
          {sql ? (
            <div className="mb-2">
              <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-[color:var(--color-text-muted)]">
                Generated SQL
              </div>
              <pre className="overflow-x-auto rounded-[6px] bg-[color:var(--color-ink-900)] px-3 py-2 font-mono text-[12px] leading-5 text-[color:var(--color-ink-100)]">
                {sql}
              </pre>
            </div>
          ) : null}
          {resultSummary ? (
            <div>
              <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-[color:var(--color-text-muted)]">
                Result
              </div>
              <div className="text-[color:var(--color-text-secondary)]">{resultSummary}</div>
            </div>
          ) : null}
          {!input && !sql && !resultSummary ? (
            <div className="text-[color:var(--color-text-muted)]">No details available yet.</div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function StatusPill({ status }: { status: ToolStatus }) {
  if (status === "running") {
    return (
      <Pill tone="accent">
        <CocoSled size={22} />
        Running
      </Pill>
    );
  }
  if (status === "completed") {
    return (
      <Pill tone="success">
        <CheckCircle2 className="h-3 w-3" />
        Done
      </Pill>
    );
  }
  return (
    <Pill tone="danger">
      <XCircle className="h-3 w-3" />
      Failed
    </Pill>
  );
}

function statusCopy(status: ToolStatus, toolName: string): string {
  const query = /analyst|sql/i.test(toolName);
  if (status === "running") return query ? "generating query" : "working";
  if (status === "completed") return query ? "query complete" : "done";
  return query ? "query failed" : "failed";
}

function prettify(name: string): string {
  if (name === "create_document") return "Create document";
  if (name === "edit_document") return "Suggest edits";
  if (name === "comment_on_document") return "Comment";
  if (name === "read_document") return "Read document";
  if (name === "list_documents") return "List documents";
  if (name === "propose_sql") return "Propose SQL";
  if (name === "describe_sandbox") return "Sandbox schema";
  if (name === "get_filings") return "Team filings";
  if (name === "tpch_analyst") return "Cortex Analyst · TPC-H";
  if (name === "tasty_bytes_analyst") return "Cortex Analyst · Tasty Bytes";
  if (name === "system_execute_sql" || name === "sql_exec" || name === "snowflake_sql_execute") return "Snowflake SQL";
  if (name === "code_execution") return "Python sandbox";
  if (name === "write") return "Write file";
  if (name === "read") return "Read file";
  if (name === "edit") return "Edit file";
  if (name === "bash") return "Shell";
  if (name === "grep") return "Grep";
  if (name === "glob") return "Glob";
  if (name === "web_search") return "Web search";
  if (name === "docs_search" || name.toLowerCase().includes("search")) return "Snowflake docs";
  if (name.toLowerCase().includes("analyst")) return "Cortex Analyst";
  return name.replace(/_/g, " ");
}
