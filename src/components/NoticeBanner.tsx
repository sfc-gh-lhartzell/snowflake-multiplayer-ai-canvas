"use client";

import { AlertTriangle, Info, X } from "lucide-react";
import { cn } from "@/lib/cn";

export function NoticeBanner({
  tone = "info",
  children,
  onDismiss,
}: {
  tone?: "info" | "warn" | "danger";
  children: React.ReactNode;
  onDismiss?: () => void;
}) {
  return (
    <div
      className={cn(
        "neu-raised-sm my-2 flex items-start gap-2 rounded-[14px] px-3.5 py-2.5 text-[13px]",
        tone === "info" && "text-[color:var(--color-accent-emphasis)]",
        tone === "warn" && "text-[color:var(--color-warn-text)]",
        tone === "danger" && "text-[color:var(--color-danger-text)]"
      )}
    >
      {tone === "danger" || tone === "warn" ? (
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
      ) : (
        <Info className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
      )}
      <div className="min-w-0 flex-1">{children}</div>
      {onDismiss ? (
        <button
          onClick={onDismiss}
          className="rounded p-0.5 opacity-60 hover:opacity-100"
          aria-label="Dismiss"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </div>
  );
}
