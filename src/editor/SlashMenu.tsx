"use client";

import type { Editor } from "@tiptap/react";
import { Heading1, Heading2, Heading3, List, ListOrdered, ListTodo, Quote, SquareCode, Table, Minus, Sparkles, Type } from "lucide-react";
import { cn } from "@/lib/cn";

export interface SlashItem {
  id: string;
  label: string;
  hint: string;
  keywords: string[];
  icon: React.ReactNode;
  run: (editor: Editor) => void;
}

const c = (e: Editor) => e.chain().focus();

export const SLASH_ITEMS: SlashItem[] = [
  { id: "ask", label: "Ask Luke to write…", hint: "AI draft at the cursor", keywords: ["ai", "luke", "write", "generate"], icon: <Sparkles />, run: () => {} },
  { id: "text", label: "Text", hint: "Plain paragraph", keywords: ["paragraph", "p"], icon: <Type />, run: (e) => c(e).setParagraph().run() },
  { id: "h1", label: "Heading 1", hint: "Big section title", keywords: ["title", "h1"], icon: <Heading1 />, run: (e) => c(e).setHeading({ level: 1 }).run() },
  { id: "h2", label: "Heading 2", hint: "Section", keywords: ["h2", "subtitle"], icon: <Heading2 />, run: (e) => c(e).setHeading({ level: 2 }).run() },
  { id: "h3", label: "Heading 3", hint: "Subsection", keywords: ["h3"], icon: <Heading3 />, run: (e) => c(e).setHeading({ level: 3 }).run() },
  { id: "bullet", label: "Bulleted list", hint: "• item", keywords: ["ul", "bullets"], icon: <List />, run: (e) => c(e).toggleBulletList().run() },
  { id: "ordered", label: "Numbered list", hint: "1. item", keywords: ["ol", "numbers"], icon: <ListOrdered />, run: (e) => c(e).toggleOrderedList().run() },
  { id: "task", label: "Checklist", hint: "☐ to-do", keywords: ["todo", "task", "check"], icon: <ListTodo />, run: (e) => c(e).toggleTaskList().run() },
  { id: "quote", label: "Quote", hint: "Callout text", keywords: ["blockquote"], icon: <Quote />, run: (e) => c(e).toggleBlockquote().run() },
  { id: "code", label: "Code block", hint: "Monospace", keywords: ["pre", "snippet", "sql"], icon: <SquareCode />, run: (e) => c(e).toggleCodeBlock().run() },
  { id: "table", label: "Table", hint: "3 × 3", keywords: ["grid"], icon: <Table />, run: (e) => c(e).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
  { id: "slide", label: "New slide", hint: "Start the next slide", keywords: ["slide", "page", "---"], icon: <Minus />, run: (e) => c(e).setHorizontalRule().setHeading({ level: 1 }).run() },
  { id: "divider", label: "Divider", hint: "Horizontal rule", keywords: ["hr", "line"], icon: <Minus />, run: (e) => c(e).setHorizontalRule().run() },
];

export function SlashMenu({
  items,
  index,
  top,
  left,
  onPick,
  onHover,
}: {
  items: SlashItem[];
  index: number;
  top: number;
  left: number;
  onPick: (item: SlashItem) => void;
  onHover: (i: number) => void;
}) {
  return (
    <div
      role="listbox"
      aria-label="Insert block"
      className="neu-menu absolute z-40 w-72 p-1.5"
      style={{ top, left: Math.max(8, left - 8) }}
      onMouseDown={(e) => e.preventDefault()}
    >
      {items.map((it, i) => (
        <button
          key={it.id}
          type="button"
          role="option"
          aria-selected={i === index}
          onMouseEnter={() => onHover(i)}
          onClick={() => onPick(it)}
          className={cn(
            "flex w-full items-center gap-3 rounded-[12px] px-2.5 py-2 text-left transition-shadow",
            i === index && "shadow-[var(--neu-inset-sm)]"
          )}
        >
          <span
            className={cn(
              "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] [&_svg]:h-4 [&_svg]:w-4",
              it.id === "ask" ? "neu-accent" : "neu-raised-sm text-[color:var(--color-text-secondary)]"
            )}
          >
            {it.icon}
          </span>
          <span className="min-w-0">
            <span className="block text-[13px] font-semibold">{it.label}</span>
            <span className="block text-[11.5px] text-[color:var(--color-text-muted)]">{it.hint}</span>
          </span>
        </button>
      ))}
    </div>
  );
}
