"use client";

import { Sparkles } from "lucide-react";

const SUGGESTIONS = [
  "@Luke, draft a one-page brief on revenue by region as a doc.",
  "@Luke, turn that brief into a 5-slide deck.",
  "@Luke, net revenue by order year. Chart it.",
  "@Luke, propose a SANDBOX table of 2027 revenue targets by region.",
];

export function EmptyState({ onPick }: { onPick: (prompt: string) => void }) {
  return (
    <div className="mx-auto max-w-md px-1 py-6 text-center">
      <div className="neu-raised-sm mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-[16px] text-[color:var(--color-accent)]">
        <Sparkles className="h-5 w-5" />
      </div>
      <h2 className="text-[17px] font-bold tracking-tight text-[color:var(--color-text-primary)]">Chat with the room, build with Luke.</h2>
      <p className="mt-2 text-[13px] leading-relaxed text-[color:var(--color-text-secondary)]">
        Mention <span className="font-semibold text-[color:var(--color-accent-emphasis)]">@Luke</span> to bring the agent in. Luke can query
        data, write and edit docs, slides, and artifacts, run Python, and propose SQL that a teammate approves. Use{" "}
        <span className="font-semibold text-[color:var(--color-accent-emphasis)]">/file</span> to save a team decision.
      </p>
      <div className="mt-5 grid gap-2.5">
        {SUGGESTIONS.map((q) => (
          <button key={q} onClick={() => onPick(q)} className="neu-btn group rounded-[16px] px-3.5 py-2.5 text-left text-[13px]">
            <span className="neu-inset-sm mr-2 inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[color:var(--color-accent-emphasis)]">
              Try
            </span>
            {q}
          </button>
        ))}
      </div>
      <p className="mt-5 text-[11.5px] text-[color:var(--color-text-muted)]">First send wins while Luke is busy. Everyone sees Luke&apos;s work as it happens.</p>
    </div>
  );
}
