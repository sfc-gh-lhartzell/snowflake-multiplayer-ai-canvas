"use client";

import { useState } from "react";
import { Check, X, MessageSquare, PenLine, RotateCcw, CheckCheck, Sparkles } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { displayName } from "@/lib/colors";
import { cn } from "@/lib/cn";
import type { SuggestionInfo } from "./suggest";

export interface CommentThread {
  commentId: string;
  parentId: string | null;
  quote: string | null;
  author: string;
  body: string;
  resolved: boolean;
  createdAt: string;
}

export function ThreadsPanel({
  tab,
  onTab,
  comments,
  activeComment,
  onFocusComment,
  draftQuote,
  onSubmitDraft,
  onCancelDraft,
  onReply,
  onResolve,
  suggestions,
  onAccept,
  onReject,
  onAcceptAll,
  onRejectAll,
  onFocusSuggestion,
  onClose,
}: {
  tab: "comments" | "suggestions";
  onTab: (t: "comments" | "suggestions") => void;
  comments: CommentThread[];
  activeComment: string | null;
  onFocusComment: (id: string) => void;
  draftQuote: string | null;
  onSubmitDraft: (body: string) => void;
  onCancelDraft: () => void;
  onReply: (parentId: string, body: string) => void;
  onResolve: (id: string, resolved: boolean) => void;
  suggestions: SuggestionInfo[];
  onAccept: (sid: string) => void;
  onReject: (sid: string) => void;
  onAcceptAll: () => void;
  onRejectAll: () => void;
  onFocusSuggestion?: (s: SuggestionInfo) => void;
  onClose?: () => void;
}) {
  const [showResolved, setShowResolved] = useState(false);
  const roots = comments.filter((c) => !c.parentId);
  const visible = roots.filter((c) => showResolved || !c.resolved);
  const openCount = roots.filter((c) => !c.resolved).length;

  return (
    <aside className="flex h-full w-[320px] shrink-0 flex-col gap-3 p-4" aria-label="Comments and suggestions">
      <div className="flex items-center gap-2">
      <div className="neu-inset-sm flex flex-1 rounded-full p-1" role="tablist">
        <TabBtn active={tab === "comments"} onClick={() => onTab("comments")} icon={<MessageSquare className="h-3.5 w-3.5" />}>
          Comments{openCount ? ` · ${openCount}` : ""}
        </TabBtn>
        <TabBtn active={tab === "suggestions"} onClick={() => onTab("suggestions")} icon={<PenLine className="h-3.5 w-3.5" />}>
          Suggestions{suggestions.length ? ` · ${suggestions.length}` : ""}
        </TabBtn>
      </div>
      {onClose ? (
        <button type="button" onClick={onClose} aria-label="Close review panel" className="neu-ghost inline-flex h-8 w-8 shrink-0 items-center justify-center">
          <X className="h-4 w-4" />
        </button>
      ) : null}
      </div>

      <div className="scroll-pane -mr-2 flex-1 space-y-3 overflow-y-auto pr-2 pb-4">
        {tab === "comments" ? (
          <>
            {draftQuote !== null ? (
              <NewComment quote={draftQuote} onSubmit={onSubmitDraft} onCancel={onCancelDraft} />
            ) : null}
            {visible.length === 0 && draftQuote === null ? (
              <Empty>Select text and press the comment button to start a thread. Luke can comment too.</Empty>
            ) : null}
            {visible.map((root) => (
              <Thread
                key={root.commentId}
                root={root}
                replies={comments.filter((c) => c.parentId === root.commentId)}
                active={activeComment === root.commentId}
                onFocus={() => onFocusComment(root.commentId)}
                onReply={(b) => onReply(root.commentId, b)}
                onResolve={() => onResolve(root.commentId, !root.resolved)}
              />
            ))}
            {roots.some((c) => c.resolved) ? (
              <button
                type="button"
                onClick={() => setShowResolved((v) => !v)}
                className="neu-ghost w-full px-3 py-2 text-[12px] font-semibold"
              >
                {showResolved ? "Hide resolved" : `Show resolved (${roots.filter((c) => c.resolved).length})`}
              </button>
            ) : null}
          </>
        ) : (
          <>
            {suggestions.length ? (
              <div className="flex gap-2">
                <button type="button" onClick={onAcceptAll} className="neu-btn inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-full text-[12px] font-semibold text-[color:var(--color-success-text)]">
                  <CheckCheck className="h-3.5 w-3.5" /> Accept all
                </button>
                <button type="button" onClick={onRejectAll} className="neu-btn inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-full text-[12px] font-semibold text-[color:var(--color-danger-text)]">
                  <X className="h-3.5 w-3.5" /> Reject all
                </button>
              </div>
            ) : (
              <Empty>No pending suggestions. Switch to Suggesting, or ask Luke to edit, and changes show up here to accept or reject.</Empty>
            )}
            {suggestions.map((s) => (
              <div
                key={s.sid}
                className="neu-raised-sm neu-rise cursor-pointer rounded-[16px] p-3"
                onClick={() => onFocusSuggestion?.(s)}
              >
                <div className="mb-2 flex items-center gap-2">
                  <Avatar name={s.author} variant={s.agent ? "agent" : "person"} size={22} />
                  <span className="text-[12.5px] font-semibold">{s.agent ? "Luke" : displayName(s.author)}</span>
                  {s.agent ? <Sparkles className="h-3 w-3 text-[color:var(--color-accent)]" aria-label="AI suggestion" /> : null}
                  <span className="ml-auto text-[11px] text-[color:var(--color-text-muted)]">{s.at ? time(s.at) : ""}</span>
                </div>
                <div className="space-y-1 text-[13px] leading-snug">
                  {s.deleted ? (
                    <div>
                      <span className="mr-1 text-[10.5px] font-bold uppercase tracking-wide text-[color:var(--color-danger-text)]">Delete</span>
                      <span className="line-through decoration-[color:var(--color-danger-text)]">{clip(s.deleted)}</span>
                    </div>
                  ) : null}
                  {s.inserted ? (
                    <div>
                      <span className="mr-1 text-[10.5px] font-bold uppercase tracking-wide text-[color:var(--color-success-text)]">Add</span>
                      <span>{clip(s.inserted)}</span>
                    </div>
                  ) : null}
                </div>
                <div className="mt-2.5 flex gap-2">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onAccept(s.sid);
                    }}
                    className="neu-btn inline-flex h-7 items-center gap-1 rounded-full px-3 text-[12px] font-semibold text-[color:var(--color-success-text)]"
                  >
                    <Check className="h-3.5 w-3.5" /> Accept
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onReject(s.sid);
                    }}
                    className="neu-btn inline-flex h-7 items-center gap-1 rounded-full px-3 text-[12px] font-semibold text-[color:var(--color-danger-text)]"
                  >
                    <X className="h-3.5 w-3.5" /> Reject
                  </button>
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </aside>
  );
}

function TabBtn({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-full text-[12px] font-semibold transition-all",
        active ? "neu-raised-sm text-[color:var(--color-accent-emphasis)]" : "text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text-primary)]"
      )}
    >
      {icon}
      {children}
    </button>
  );
}

function Thread({
  root,
  replies,
  active,
  onFocus,
  onReply,
  onResolve,
}: {
  root: CommentThread;
  replies: CommentThread[];
  active: boolean;
  onFocus: () => void;
  onReply: (body: string) => void;
  onResolve: () => void;
}) {
  const [reply, setReply] = useState("");
  return (
    <div
      onClick={onFocus}
      className={cn(
        "neu-rise cursor-pointer rounded-[16px] p-3 transition-shadow",
        active ? "neu-raised" : "neu-raised-sm",
        root.resolved && "opacity-60"
      )}
    >
      {root.quote ? (
        <div className="mb-2 border-l-2 border-[color:rgba(230,160,0,0.75)] pl-2 text-[12px] italic text-[color:var(--color-text-secondary)]">
          {clip(root.quote, 120)}
        </div>
      ) : null}
      {[root, ...replies].map((c) => (
        <div key={c.commentId} className="mb-2 last:mb-0">
          <div className="mb-0.5 flex items-center gap-2">
            <Avatar name={c.author} variant={c.author === "LUKE" ? "agent" : "person"} size={20} />
            <span className="text-[12.5px] font-semibold">{c.author === "LUKE" ? "Luke" : displayName(c.author)}</span>
            <span className="ml-auto text-[10.5px] text-[color:var(--color-text-muted)]">{time(Date.parse(c.createdAt))}</span>
          </div>
          <p className="whitespace-pre-wrap pl-7 text-[13px] leading-snug text-[color:var(--color-text-primary)]">{c.body}</p>
        </div>
      ))}
      {active && !root.resolved ? (
        <form
          className="mt-2 flex gap-2"
          onClick={(e) => e.stopPropagation()}
          onSubmit={(e) => {
            e.preventDefault();
            if (!reply.trim()) return;
            onReply(reply.trim());
            setReply("");
          }}
        >
          <input
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            placeholder="Reply…"
            aria-label="Reply"
            className="neu-inset-sm neu-focus h-8 min-w-0 flex-1 rounded-full px-3 text-[12.5px] outline-none"
          />
        </form>
      ) : null}
      <div className="mt-2 flex justify-end">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onResolve();
          }}
          className="neu-ghost inline-flex h-7 items-center gap-1 px-2.5 text-[11.5px] font-semibold"
        >
          {root.resolved ? (
            <>
              <RotateCcw className="h-3 w-3" /> Reopen
            </>
          ) : (
            <>
              <Check className="h-3 w-3" /> Resolve
            </>
          )}
        </button>
      </div>
    </div>
  );
}

function NewComment({ quote, onSubmit, onCancel }: { quote: string; onSubmit: (b: string) => void; onCancel: () => void }) {
  const [body, setBody] = useState("");
  return (
    <form
      className="neu-raised neu-rise rounded-[16px] p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (body.trim()) onSubmit(body.trim());
      }}
    >
      {quote ? (
        <div className="mb-2 border-l-2 border-[color:rgba(230,160,0,0.75)] pl-2 text-[12px] italic text-[color:var(--color-text-secondary)]">
          {clip(quote, 120)}
        </div>
      ) : null}
      <textarea
        autoFocus
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            if (body.trim()) onSubmit(body.trim());
          }
          if (e.key === "Escape") onCancel();
        }}
        rows={3}
        placeholder="Add a comment… (⌘↵ to post)"
        aria-label="New comment"
        className="neu-inset-sm neu-focus w-full resize-none rounded-[12px] px-3 py-2 text-[13px] outline-none"
      />
      <div className="mt-2 flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="neu-ghost h-7 px-3 text-[12px] font-semibold">
          Cancel
        </button>
        <button type="submit" disabled={!body.trim()} className="neu-accent h-7 rounded-full px-3 text-[12px] font-semibold disabled:opacity-50">
          Comment
        </button>
      </div>
    </form>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="neu-inset-sm rounded-[14px] px-3 py-3 text-[12.5px] leading-relaxed text-[color:var(--color-text-muted)]">{children}</p>;
}

function clip(s: string, n = 160) {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function time(t: number) {
  if (!Number.isFinite(t)) return "";
  return new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
