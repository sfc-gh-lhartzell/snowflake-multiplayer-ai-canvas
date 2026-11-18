/**
 * Suggest mode: tracked insertions and deletions for people and for Luke.
 *
 * While suggesting, typed or pasted text is wrapped in a `suggestInsert`
 * mark, and deleted text is kept but wrapped in `suggestDelete` (struck
 * through) instead of being removed. Every suggestion carries an id, author,
 * and timestamp; a replacement shares one id across its delete and insert.
 * Accept/reject resolve a suggestion by id.
 *
 * Deliberately simple: formatting changes, Enter (new paragraphs), and table
 * structure edits apply directly and are not tracked.
 */

import { Extension, Mark, mergeAttributes } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import type { Node as PMNode, Mark as PMMark, Slice } from "@tiptap/pm/model";
import type { EditorView } from "@tiptap/pm/view";

export interface SuggestAuthor {
  name: string;
  agent?: boolean;
}

const suggestAttrs = {
  sid: { default: null },
  author: { default: null },
  agent: {
    default: false,
    parseHTML: (el: HTMLElement) => el.getAttribute("data-agent") === "true",
    renderHTML: (attrs: { agent?: boolean }) => (attrs.agent ? { "data-agent": "true" } : {}),
  },
  at: { default: null },
};

function attrHtml(el: HTMLElement) {
  return {
    sid: el.getAttribute("data-sid"),
    author: el.getAttribute("data-author"),
    at: Number(el.getAttribute("data-at")) || null,
  };
}

export const SuggestInsert = Mark.create({
  name: "suggestInsert",
  inclusive: false,
  excludes: "suggestDelete",
  addAttributes: () => suggestAttrs,
  parseHTML: () => [{ tag: "ins[data-sid]", getAttrs: (el) => attrHtml(el as HTMLElement) }],
  renderHTML: ({ HTMLAttributes, mark }) => [
    "ins",
    mergeAttributes(HTMLAttributes, {
      class: "suggest-insert",
      "data-sid": mark.attrs.sid,
      "data-author": mark.attrs.author,
      title: `Suggested by ${mark.attrs.author}`,
    }),
    0,
  ],
});

export const SuggestDelete = Mark.create({
  name: "suggestDelete",
  inclusive: false,
  excludes: "suggestInsert",
  addAttributes: () => suggestAttrs,
  parseHTML: () => [{ tag: "del[data-sid]", getAttrs: (el) => attrHtml(el as HTMLElement) }],
  renderHTML: ({ HTMLAttributes, mark }) => [
    "del",
    mergeAttributes(HTMLAttributes, {
      class: "suggest-delete",
      "data-sid": mark.attrs.sid,
      "data-author": mark.attrs.author,
      title: `Deletion suggested by ${mark.attrs.author}`,
    }),
    0,
  ],
});

export const suggestModeKey = new PluginKey("suggestMode");

export interface SuggestModeStorage {
  enabled: boolean;
  author: SuggestAuthor;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    suggestMode: {
      setSuggesting: (enabled: boolean) => ReturnType;
      acceptSuggestion: (sid: string) => ReturnType;
      rejectSuggestion: (sid: string) => ReturnType;
      acceptAllSuggestions: () => ReturnType;
      rejectAllSuggestions: () => ReturnType;
    };
  }
  interface Storage {
    suggestMode: SuggestModeStorage;
  }
}

export function newSid(): string {
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function insertMark(state: EditorState, author: SuggestAuthor, sid: string): PMMark {
  return state.schema.marks.suggestInsert.create({ sid, author: author.name, agent: Boolean(author.agent), at: Date.now() });
}

function deleteMark(state: EditorState, author: SuggestAuthor, sid: string): PMMark {
  return state.schema.marks.suggestDelete.create({ sid, author: author.name, agent: Boolean(author.agent), at: Date.now() });
}

function ownInsertAt(node: PMNode | null | undefined, author: SuggestAuthor): PMMark | undefined {
  return node?.marks.find((m) => m.type.name === "suggestInsert" && m.attrs.author === author.name);
}

/**
 * Mark [from, to) as deleted. Text that is the author's own pending insertion
 * is removed outright (un-typing your own suggestion), everything else is
 * struck through. Returns the transaction for chaining.
 */
export function markDeletion(tr: Transaction, from: number, to: number, author: SuggestAuthor, sid: string): Transaction {
  const segments: { from: number; to: number; own: boolean; deleted: boolean }[] = [];
  tr.doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isText) return;
    const a = Math.max(from, pos);
    const b = Math.min(to, pos + node.nodeSize);
    if (a >= b) return;
    segments.push({
      from: a,
      to: b,
      own: Boolean(ownInsertAt(node, author)),
      deleted: node.marks.some((m) => m.type.name === "suggestDelete"),
    });
  });
  const mark = tr.doc.type.schema.marks.suggestDelete.create({
    sid,
    author: author.name,
    agent: Boolean(author.agent),
    at: Date.now(),
  });
  for (const s of segments.reverse()) {
    if (s.own) tr.delete(s.from, s.to);
    else if (!s.deleted) tr.addMark(s.from, s.to, mark);
  }
  return tr;
}

/** Insert text as a suggestion at `pos`, keeping surrounding formatting marks. */
export function insertSuggestedText(
  tr: Transaction,
  state: EditorState,
  pos: number,
  text: string,
  author: SuggestAuthor,
  sid: string
): number {
  const $pos = tr.doc.resolve(pos);
  const base = (state.storedMarks ?? $pos.marks()).filter(
    (m) => !["suggestInsert", "suggestDelete", "comment"].includes(m.type.name)
  );
  const node = state.schema.text(text, [...base, insertMark(state, author, sid)]);
  tr.insert(pos, node);
  return pos + text.length;
}

/** Insert a whole slice (paste, AI output) and mark its inline content as a suggestion. */
export function insertSuggestedSlice(tr: Transaction, pos: number, slice: Slice, author: SuggestAuthor, sid: string): number {
  const before = tr.doc.content.size;
  tr.replace(pos, pos, slice);
  const end = pos + (tr.doc.content.size - before);
  tr.addMark(pos, end, tr.doc.type.schema.marks.suggestInsert.create({ sid, author: author.name, agent: Boolean(author.agent), at: Date.now() }));
  return end;
}

export interface SuggestionInfo {
  sid: string;
  author: string;
  agent: boolean;
  at: number | null;
  inserted: string;
  deleted: string;
  from: number;
}

/** All pending suggestions in document order, grouped by id. */
export function collectSuggestions(doc: PMNode): SuggestionInfo[] {
  const map = new Map<string, SuggestionInfo>();
  doc.descendants((node, pos) => {
    if (!node.isText) return;
    for (const m of node.marks) {
      if (m.type.name !== "suggestInsert" && m.type.name !== "suggestDelete") continue;
      const sid = String(m.attrs.sid);
      let info = map.get(sid);
      if (!info) {
        info = { sid, author: m.attrs.author, agent: Boolean(m.attrs.agent), at: m.attrs.at, inserted: "", deleted: "", from: pos };
        map.set(sid, info);
      }
      if (m.type.name === "suggestInsert") info.inserted += node.text ?? "";
      else info.deleted += node.text ?? "";
    }
  });
  return Array.from(map.values()).sort((a, b) => a.from - b.from);
}

function resolve(tr: Transaction, match: (sid: string) => boolean, accept: boolean): boolean {
  const ranges: { from: number; to: number; type: "insert" | "delete"; mark: PMMark }[] = [];
  tr.doc.descendants((node, pos) => {
    if (!node.isText) return;
    for (const m of node.marks) {
      if ((m.type.name === "suggestInsert" || m.type.name === "suggestDelete") && match(String(m.attrs.sid))) {
        ranges.push({ from: pos, to: pos + node.nodeSize, type: m.type.name === "suggestInsert" ? "insert" : "delete", mark: m });
      }
    }
  });
  if (!ranges.length) return false;
  const start = tr.steps.length;
  const emptied: number[] = [];
  for (const r of ranges.reverse()) {
    const keep = (r.type === "insert") === accept;
    if (keep) tr.removeMark(r.from, r.to, r.mark);
    else {
      // Ranges run high to low, so this position is still in the original document's coordinates.
      emptied.push(tr.doc.resolve(r.from).before());
      tr.delete(r.from, r.to);
    }
  }
  dropEmptiedBlocks(tr, start, emptied);
  return true;
}

const LIST_WRAPPERS = new Set(["listItem", "taskItem", "bulletList", "orderedList", "taskList"]);

/**
 * A resolved suggestion that removed all of a block's text leaves an empty
 * heading, paragraph, or bullet behind. Remove those blocks (and list items
 * and lists they were the only child of), keeping at least one block.
 */
function dropEmptiedBlocks(tr: Transaction, start: number, origPositions: number[]) {
  const map = tr.mapping.slice(start);
  const positions = Array.from(new Set(origPositions.map((p) => map.map(p, 1)))).sort((a, b) => b - a);
  for (const pos of positions) {
    if (pos < 0 || pos > tr.doc.content.size) continue;
    const node = tr.doc.nodeAt(pos);
    if (!node || !node.isTextblock || node.content.size > 0) continue;
    const $pos = tr.doc.resolve(pos);
    let from = pos;
    let to = pos + node.nodeSize;
    for (let d = $pos.depth; d > 0; d--) {
      const parent = $pos.node(d);
      if (!LIST_WRAPPERS.has(parent.type.name) || parent.childCount !== 1) break;
      from = $pos.before(d);
      to = $pos.after(d);
    }
    if (to - from >= tr.doc.content.size) continue; // never empty the document
    tr.delete(from, to);
  }
}

export const SuggestMode = Extension.create<Record<string, never>, SuggestModeStorage>({
  name: "suggestMode",

  addStorage() {
    return { enabled: false, author: { name: "Someone" } };
  },

  addCommands() {
    return {
      setSuggesting:
        (enabled) =>
        ({ editor }) => {
          editor.storage.suggestMode.enabled = enabled;
          return true;
        },
      acceptSuggestion:
        (sid) =>
        ({ tr }) =>
          resolve(tr, (s) => s === sid, true),
      rejectSuggestion:
        (sid) =>
        ({ tr }) =>
          resolve(tr, (s) => s === sid, false),
      acceptAllSuggestions:
        () =>
        ({ tr }) =>
          resolve(tr, () => true, true),
      rejectAllSuggestions:
        () =>
        ({ tr }) =>
          resolve(tr, () => true, false),
    };
  },

  addProseMirrorPlugins() {
    // Read through the editor each time: the extension's own `this.storage`
    // can be a different object from editor.storage in TipTap v3.
    const editor = this.editor;
    const storage = {
      get enabled() {
        return Boolean(editor.storage.suggestMode?.enabled);
      },
      get author(): SuggestAuthor {
        return editor.storage.suggestMode?.author ?? { name: "Someone" };
      },
    };
    const on = () => storage.enabled;

    const moveTo = (tr: Transaction, pos: number) => tr.setSelection(TextSelection.create(tr.doc, pos));

    return [
      new Plugin({
        key: suggestModeKey,
        props: {
          handleTextInput(view: EditorView, from: number, to: number, text: string) {
            if (!on() || view.composing) return false;
            const { state } = view;
            const author = storage.author;
            // Continue the author's adjacent insertion instead of starting a new one.
            const before = from > 0 ? state.doc.resolve(from).nodeBefore : null;
            const sid = (from === to && ownInsertAt(before, author)?.attrs.sid) || newSid();
            const tr = state.tr;
            if (from < to) markDeletion(tr, from, to, author, sid);
            const at = tr.mapping.map(to);
            const end = insertSuggestedText(tr, state, at, text, author, sid);
            moveTo(tr, end);
            view.dispatch(tr.scrollIntoView());
            return true;
          },

          handleKeyDown(view: EditorView, event: KeyboardEvent) {
            if (!on()) return false;
            if (event.key !== "Backspace" && event.key !== "Delete") return false;
            const { state } = view;
            const { from, to, empty, $from } = state.selection;
            const author = storage.author;
            const tr = state.tr;
            if (!empty) {
              markDeletion(tr, from, to, author, newSid());
              moveTo(tr, event.key === "Backspace" ? tr.mapping.map(from, -1) : tr.mapping.map(to));
              view.dispatch(tr);
              return true;
            }
            if (event.key === "Backspace") {
              if ($from.parentOffset === 0) return false; // joining blocks: structural, untracked
              markDeletion(tr, from - 1, from, author, newSid());
              moveTo(tr, tr.mapping.map(from - 1, -1));
            } else {
              if ($from.parentOffset === $from.parent.content.size) return false;
              markDeletion(tr, from, from + 1, author, newSid());
              moveTo(tr, tr.mapping.map(from + 1));
            }
            view.dispatch(tr);
            return true;
          },

          handlePaste(view: EditorView, _event: ClipboardEvent, slice: Slice) {
            if (!on()) return false;
            const { state } = view;
            const { from, to } = state.selection;
            const sid = newSid();
            const tr = state.tr;
            if (from < to) markDeletion(tr, from, to, storage.author, sid);
            const end = insertSuggestedSlice(tr, tr.mapping.map(to), slice, storage.author, sid);
            moveTo(tr, Math.min(end, tr.doc.content.size));
            view.dispatch(tr.scrollIntoView());
            return true;
          },

          handleDrop() {
            // Drag-and-drop moves would bypass tracking; block them while suggesting.
            return on();
          },
        },
      }),
    ];
  },
});

export { deleteMark };
