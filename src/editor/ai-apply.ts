/**
 * Markdown <-> editor helpers and the code that applies Luke's queued edits
 * to a live TipTap document (as tracked suggestions).
 */

import type { Editor } from "@tiptap/core";
import { DOMParser as PMDOMParser, Fragment, Slice, type Node as PMNode } from "@tiptap/pm/model";
import { marked } from "marked";
import TurndownService from "turndown";
import { markDeletion, insertSuggestedSlice, newSid, type SuggestAuthor } from "./suggest";

export const LUKE: SuggestAuthor = { name: "Luke", agent: true };

marked.setOptions({ gfm: true, breaks: false });

/** Slides are separated by a line containing only ---; keep marked from reading it as a setext heading. */
export function normalizeSlidesMarkdown(md: string): string {
  return md.replace(/^[ \t]*---[ \t]*$/gm, "\n\n---\n\n");
}

export function markdownToHtml(md: string): string {
  return marked.parse(md, { async: false }) as string;
}

const BLOCKY = /(^|\n)\s*(#{1,6}\s|[-*+]\s|\d+\.\s|>\s|```|\|.*\||---\s*$)|\n\s*\n/;

/** Parse markdown into a slice for this editor's schema (inline content when it's a phrase). */
export function markdownToSlice(editor: Editor, md: string): Slice {
  const parser = PMDOMParser.fromSchema(editor.schema);
  const el = document.createElement("div");
  const inline = !BLOCKY.test(md.trim());
  el.innerHTML = inline ? `<p>${marked.parseInline(md.trim(), { async: false }) as string}</p>` : markdownToHtml(md);
  const doc = parser.parse(el);
  if (inline && doc.firstChild) return new Slice(doc.firstChild.content, 0, 0);
  return new Slice(doc.content, 0, 0);
}

// ----- snapshot (what Luke reads) -------------------------------------------

const turndown = new TurndownService({ headingStyle: "atx", hr: "---", bulletListMarker: "-", codeBlockStyle: "fenced" });
turndown.keep(["table"]);
turndown.addRule("taskItem", {
  filter: (node) => node.nodeName === "LI" && (node as HTMLElement).getAttribute("data-type") === "taskItem",
  replacement: (content, node) =>
    `- [${(node as HTMLElement).getAttribute("data-checked") === "true" ? "x" : " "}] ${content.trim()}\n`,
});

/** Markdown of the document with pending suggestions shown as if accepted. */
export function editorToMarkdown(editor: Editor): string {
  const el = document.createElement("div");
  el.innerHTML = editor.getHTML();
  el.querySelectorAll("del[data-sid]").forEach((n) => n.remove());
  el.querySelectorAll("ins[data-sid], span[data-comment-id]").forEach((n) => n.replaceWith(...Array.from(n.childNodes)));
  return turndown.turndown(el.innerHTML).trim();
}

// ----- text search across the document -------------------------------------

interface TextIndex {
  text: string;
  pos: number[]; // pos[i] = doc position of text[i], or -1 for block separators
}

function buildIndex(doc: PMNode): TextIndex {
  let text = "";
  const pos: number[] = [];
  doc.descendants((node, p) => {
    if (node.isTextblock && text.length) {
      text += "\n";
      pos.push(-1);
    }
    if (node.isText && node.text && !node.marks.some((m) => m.type.name === "suggestDelete")) {
      for (let i = 0; i < node.text.length; i++) pos.push(p + i);
      text += node.text;
    }
  });
  return { text, pos };
}

function normalizeWithMap(s: string): { norm: string; map: number[] } {
  let norm = "";
  const map: number[] = [];
  let lastSpace = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    const space = /\s/.test(ch);
    if (space && lastSpace) continue;
    norm += space ? " " : ch.toLowerCase();
    map.push(i);
    lastSpace = space;
  }
  return { norm, map };
}

/** Find text in the document. Exact first, then case/whitespace-insensitive. */
export function findTextRange(doc: PMNode, needle: string): { from: number; to: number } | null {
  const target = needle.replace(/^[\s*_#>-]+|[\s*_]+$/g, "");
  if (!target) return null;
  const idx = buildIndex(doc);
  let start = idx.text.indexOf(target);
  let len = target.length;
  if (start < 0) {
    const hay = normalizeWithMap(idx.text);
    const nNeedle = normalizeWithMap(target).norm;
    const at = hay.norm.indexOf(nNeedle);
    if (at < 0) return null;
    start = hay.map[at];
    const endIdx = hay.map[at + nNeedle.length - 1];
    len = endIdx - start + 1;
  }
  const from = idx.pos[start];
  const last = idx.pos[start + len - 1];
  if (from === undefined || last === undefined || from < 0 || last < 0) return null;
  return { from, to: last + 1 };
}

// ----- applying Luke's queued ops ------------------------------------------

export interface EditOpInput {
  operation?: string;
  find_text?: string;
  new_text?: string;
  quote?: string;
  commentId?: string;
}

/** Returns a short human description of what happened (for the room). */
export function applyEditOp(editor: Editor, input: EditOpInput, asSuggestion: boolean): string {
  const op = (input.operation ?? "append").toLowerCase();
  const newText = input.new_text ?? "";
  const sid = newSid();
  const { state } = editor;
  const tr = state.tr;

  if (op === "replace") {
    const range = findTextRange(state.doc, input.find_text ?? "");
    if (!range) return `couldn't find "${truncate(input.find_text ?? "", 60)}" to replace`;
    const slice = markdownToSlice(editor, newText);
    if (asSuggestion) {
      markDeletion(tr, range.from, range.to, LUKE, sid);
      insertSuggestedSlice(tr, tr.mapping.map(range.to), slice, LUKE, sid);
    } else {
      tr.replace(range.from, range.to, slice);
    }
  } else {
    const slice = markdownToSlice(editor, newText);
    // Appends and prepends are whole blocks; wrap a bare phrase in a paragraph.
    const blockSlice = slice.content.firstChild?.isInline
      ? new Slice(Fragment.from(state.schema.nodes.paragraph.create(null, slice.content)), 0, 0)
      : slice;
    const pos = op === "prepend" ? 0 : state.doc.content.size;
    if (asSuggestion) insertSuggestedSlice(tr, pos, blockSlice, LUKE, sid);
    else tr.replace(pos, pos, blockSlice);
  }
  editor.view.dispatch(tr);
  return op === "replace" ? "suggested a replacement" : `suggested an addition (${op})`;
}

export function applyCommentOp(editor: Editor, input: EditOpInput): boolean {
  if (!input.commentId) return false;
  const range = findTextRange(editor.state.doc, input.quote ?? "");
  if (!range) return false;
  const mark = editor.schema.marks.comment.create({ commentId: input.commentId });
  editor.view.dispatch(editor.state.tr.addMark(range.from, range.to, mark));
  return true;
}

function truncate(s: string, n: number) {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
