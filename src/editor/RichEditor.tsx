"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import StarterKit from "@tiptap/starter-kit";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCaret from "@tiptap/extension-collaboration-caret";
import { Placeholder } from "@tiptap/extensions";
import { TaskList } from "@tiptap/extension-task-list";
import { TaskItem } from "@tiptap/extension-task-item";
import { TableKit } from "@tiptap/extension-table";
import Highlight from "@tiptap/extension-highlight";
import TextAlign from "@tiptap/extension-text-align";
import Image from "@tiptap/extension-image";
import { yXmlFragmentToProsemirrorJSON } from "@tiptap/y-tiptap";
import * as Y from "yjs";
import { Bold, Italic, Link as LinkIcon, MessageSquarePlus, Sparkles, LoaderCircle, Wand2, LayoutGrid, MessagesSquare } from "lucide-react";
import type { SseYProvider, AiOp } from "@/lib/y-provider";
import { fromB64 } from "@/lib/y-provider";
import { apiFetch, apiJson } from "@/lib/client-api";
import { userColor, displayName } from "@/lib/colors";
import { cn } from "@/lib/cn";
import { SuggestInsert, SuggestDelete, SuggestMode, collectSuggestions, markDeletion, insertSuggestedSlice, newSid, type SuggestionInfo } from "./suggest";
import { CommentMark } from "./comment-mark";
import { applyEditOp, applyCommentOp, editorToMarkdown, markdownToHtml, markdownToSlice, normalizeSlidesMarkdown, findTextRange, LUKE } from "./ai-apply";
import { useDocSession } from "./useDocSession";
import { useComments } from "./useComments";
import { DocHeader } from "./DocHeader";
import { EditorToolbar } from "./EditorToolbar";
import { ThreadsPanel } from "./ThreadsPanel";
import { SlidesRail } from "./Slides";
import { VersionsDialog } from "./VersionsDialog";
import { SlashMenu, SLASH_ITEMS, type SlashItem } from "./SlashMenu";
import type { DocMetaClient } from "@/components/workspace/types";

const SNAPSHOT_DEBOUNCE_MS = 2500;

export function RichEditor({ doc, me, onNotice }: { doc: DocMetaClient; me: string; onNotice: (text: string) => void }) {
  const pending = useRef<{ synced: boolean; seedPending: boolean; ops: AiOp[] }>({ synced: false, seedPending: false, ops: [] });
  const [pulse, setPulse] = useState(0); // bumps when synced/ops arrive so the inner editor processes them

  const session = useDocSession(doc.docId, me, {
    onSynced: ({ seedPending, aiOps }) => {
      pending.current.synced = true;
      pending.current.seedPending = seedPending;
      pending.current.ops.push(...aiOps);
      setPulse((n) => n + 1);
    },
    onAiOp: (op) => {
      pending.current.ops.push(op);
      setPulse((n) => n + 1);
    },
  });

  if (!session.ydoc || !session.provider || me === "…") {
    return <div className="p-10 text-[13px] text-[color:var(--color-text-muted)]">Opening…</div>;
  }
  return (
    <RichEditorInner
      key={doc.docId}
      doc={doc}
      me={me}
      ydoc={session.ydoc}
      provider={session.provider}
      session={session}
      pending={pending}
      pulse={pulse}
      onNotice={onNotice}
    />
  );
}

function RichEditorInner({
  doc,
  me,
  ydoc,
  provider,
  session,
  pending,
  pulse,
  onNotice,
}: {
  doc: DocMetaClient;
  me: string;
  ydoc: Y.Doc;
  provider: SseYProvider;
  session: ReturnType<typeof useDocSession>;
  pending: React.MutableRefObject<{ synced: boolean; seedPending: boolean; ops: AiOp[] }>;
  pulse: number;
  onNotice: (text: string) => void;
}) {
  const isSlides = doc.kind === "slides";
  const [suggesting, setSuggesting] = useState(false);
  const [lukeSuggests, setLukeSuggests] = useState(true);
  const [tab, setTab] = useState<"comments" | "suggestions">("comments");
  const [rightPane, setRightPane] = useState<"slides" | "threads" | null>(isSlides ? "slides" : null);
  const [suggestions, setSuggestions] = useState<SuggestionInfo[]>([]);
  const [draftQuote, setDraftQuote] = useState<string | null>(null);
  const draftRange = useRef<{ from: number; to: number } | null>(null);
  const [activeComment, setActiveComment] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [html, setHtml] = useState("");
  const [activeSlide, setActiveSlide] = useState(0);
  const [aiBusy, setAiBusy] = useState(false);
  const [askOpen, setAskOpen] = useState(false);
  const [askText, setAskText] = useState("");
  const [slash, setSlash] = useState<{ query: string; from: number; top: number; left: number } | null>(null);
  const [slashIndex, setSlashIndex] = useState(0);
  const slashRef = useRef<typeof slash>(null);
  slashRef.current = slash;
  const slashIndexRef = useRef(0);
  slashIndexRef.current = slashIndex;
  const pickSlashRef = useRef<(item: SlashItem) => void>(() => {});

  const { comments, add: addComment, resolve: resolveComment } = useComments(doc.docId);
  const lukeSuggestsRef = useRef(lukeSuggests);
  lukeSuggestsRef.current = lukeSuggests;

  const user = useMemo(() => ({ name: displayName(me), color: userColor(me) }), [me]);

  const editor = useEditor(
    {
      immediatelyRender: false,
      extensions: [
        StarterKit.configure({ undoRedo: false, link: { openOnClick: false, autolink: true } }),
        Placeholder.configure({
          placeholder: ({ node }) =>
            node.type.name === "heading" ? "Heading" : isSlides ? "Type / for blocks · --- starts a new slide" : "Type / for blocks, or select text and Ask Luke",
        }),
        TaskList,
        TaskItem.configure({ nested: true }),
        TableKit.configure({ table: { resizable: true } }),
        Highlight,
        TextAlign.configure({ types: ["heading", "paragraph"] }),
        Image,
        CommentMark,
        SuggestInsert,
        SuggestDelete,
        SuggestMode,
        Collaboration.configure({ document: ydoc, field: "content" }),
        CollaborationCaret.configure({ provider, user }),
      ],
      editorProps: {
        attributes: { class: "focus:outline-none", spellcheck: "true" },
        handleKeyDown: (_view, event) => {
          const s = slashRef.current;
          if (!s) return false;
          const items = filterSlash(s.query, isSlides);
          if (event.key === "ArrowDown") {
            setSlashIndex((i) => (i + 1) % Math.max(1, items.length));
            return true;
          }
          if (event.key === "ArrowUp") {
            setSlashIndex((i) => (i - 1 + items.length) % Math.max(1, items.length));
            return true;
          }
          if (event.key === "Enter" && items.length) {
            pickSlashRef.current(items[Math.min(slashIndexRef.current, items.length - 1)]);
            return true;
          }
          if (event.key === "Escape") {
            setSlash(null);
            return true;
          }
          return false;
        },
        handleClick: (view, pos) => {
          const marks = view.state.doc.resolve(pos).marks();
          const c = marks.find((m) => m.type.name === "comment");
          if (c?.attrs.commentId) {
            setActiveComment(c.attrs.commentId);
            setTab("comments");
            setRightPane("threads");
          }
          return false;
        },
      },
      onUpdate: ({ editor: e }) => refreshDerived(e),
      onSelectionUpdate: ({ editor: e }) => {
        detectSlash(e);
        if (isSlides) setActiveSlide(slideIndexAt(e));
      },
    },
    []
  );

  // Suggest-mode author and toggle live in extension storage.
  useEffect(() => {
    if (!editor) return;
    editor.storage.suggestMode.author = { name: me };
    editor.commands.setSuggesting(suggesting);
  }, [editor, me, suggesting]);

  const refreshDerived = useCallback(
    (e: Editor) => {
      setSuggestions(collectSuggestions(e.state.doc));
      setHtml(e.getHTML());
      detectSlash(e);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  function detectSlash(e: Editor) {
    const { selection } = e.state;
    if (!selection.empty) return setSlash(null);
    const $from = selection.$from;
    const text = $from.parent.textContent;
    if ($from.parent.type.name !== "paragraph" || !text.startsWith("/") || $from.parentOffset !== text.length || text.length > 24 || /\s/.test(text)) {
      if (slashRef.current) setSlash(null);
      return;
    }
    const coords = e.view.coordsAtPos(selection.from);
    const host = e.view.dom.closest(".editor-scroll")?.getBoundingClientRect();
    const scrollTop = e.view.dom.closest(".editor-scroll")?.scrollTop ?? 0;
    if (!slashRef.current || slashRef.current.query !== text.slice(1)) setSlashIndex(0);
    setSlash({
      query: text.slice(1),
      from: $from.start(),
      top: coords.bottom - (host?.top ?? 0) + scrollTop + 6,
      left: coords.left - (host?.left ?? 0),
    });
  }

  // ----- seed + Luke's queued edits ----------------------------------------
  const processing = useRef(false);
  useEffect(() => {
    if (!editor || !pending.current.synced || processing.current) return;
    processing.current = true;
    (async () => {
      try {
        if (pending.current.seedPending) {
          pending.current.seedPending = false;
          const r = await provider.claim("seed");
          if (r.granted && r.seed) {
            const md = isSlides ? normalizeSlidesMarkdown(r.seed) : r.seed;
            editor.commands.setContent(markdownToHtml(md));
          }
        }
        while (pending.current.ops.length) {
          const op = pending.current.ops.shift()!;
          const r = await provider.claim("op", op.opId);
          if (!r.granted) continue;
          if (op.tool === "edit_document") {
            const what = applyEditOp(editor, op.input, lukeSuggestsRef.current);
            onNotice(`Luke ${what} in “${doc.title}”.`);
            setTab("suggestions");
            setRightPane("threads");
          } else if (op.tool === "comment_on_document") {
            applyCommentOp(editor, op.input);
            setTab("comments");
            setRightPane("threads");
          }
        }
      } finally {
        processing.current = false;
      }
    })();
  }, [editor, pulse, provider, isSlides, doc.title, onNotice, pending]);

  // ----- snapshot for Luke (READ_DOCUMENT) ----------------------------------
  useEffect(() => {
    if (!editor) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onUpdate = (_u: Uint8Array, origin: unknown) => {
      if (origin === provider) return; // remote edits: their author's editor snapshots
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        void apiFetch(`/api/docs/${encodeURIComponent(doc.docId)}/snapshot`, {
          method: "POST",
          body: JSON.stringify({ snapshot: editorToMarkdown(editor) }),
        });
      }, SNAPSHOT_DEBOUNCE_MS);
    };
    ydoc.on("update", onUpdate);
    refreshDerived(editor);
    return () => {
      ydoc.off("update", onUpdate);
      if (timer) clearTimeout(timer);
    };
  }, [editor, ydoc, provider, doc.docId, refreshDerived]);

  // ----- comment anchors: active + resolved styling --------------------------
  useEffect(() => {
    if (!editor) return;
    const root = editor.view.dom;
    const resolved = new Set(comments.filter((c) => !c.parentId && c.resolved).map((c) => c.commentId));
    root.querySelectorAll<HTMLElement>("[data-comment-id]").forEach((el) => {
      const id = el.getAttribute("data-comment-id")!;
      el.classList.toggle("comment-active", id === activeComment);
      el.setAttribute("data-resolved", resolved.has(id) ? "true" : "false");
    });
  }, [editor, comments, activeComment, html]);

  // ----- actions -------------------------------------------------------------
  const startComment = () => {
    if (!editor) return;
    const { from, to } = editor.state.selection;
    if (from === to) return;
    draftRange.current = { from, to };
    setDraftQuote(editor.state.doc.textBetween(from, to, " "));
    setTab("comments");
    setRightPane("threads");
  };

  const submitComment = async (body: string) => {
    if (!editor || !draftRange.current) return;
    const commentId = crypto.randomUUID();
    const { from, to } = draftRange.current;
    const quote = draftQuote;
    editor.view.dispatch(editor.state.tr.addMark(from, to, editor.schema.marks.comment.create({ commentId })));
    setDraftQuote(null);
    draftRange.current = null;
    setActiveComment(commentId);
    await addComment({ commentId, quote, body });
  };

  const focusComment = (id: string) => {
    setActiveComment(id);
    const el = editor?.view.dom.querySelector(`[data-comment-id="${CSS.escape(id)}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const focusSuggestion = (s: SuggestionInfo) => {
    if (!editor) return;
    editor.chain().focus().setTextSelection(s.from).scrollIntoView().run();
  };

  /** Replace the selection (or insert at the cursor) with Luke's text, as a suggestion if enabled. */
  const askLuke = async (action: string, instruction?: string) => {
    if (!editor) return;
    const { from, to } = editor.state.selection;
    const selected = editor.state.doc.textBetween(from, to, "\n");
    // What Luke should rewrite: the selection as it would read with pending deletions applied.
    let visible = "";
    editor.state.doc.nodesBetween(from, to, (node, pos) => {
      if (node.isTextblock && visible && pos > from) visible += "\n";
      if (node.isText && !node.marks.some((m) => m.type.name === "suggestDelete")) {
        visible += (node.text ?? "").slice(Math.max(0, from - pos), Math.max(0, to - pos));
      }
    });
    const context = from === to ? editorToMarkdown(editor).slice(-4000) : visible;
    setAiBusy(true);
    setAskOpen(false);
    try {
      const r = await apiJson<{ text: string }>("/api/ai/transform", {
        method: "POST",
        body: JSON.stringify({ action: from === to ? "continue" : action, instruction, text: context, title: doc.title }),
      });
      if (!r.text) return;
      // The doc may have changed while Luke was thinking; re-find the original text.
      let range = { from, to };
      if (from !== to && editor.state.doc.textBetween(from, Math.min(to, editor.state.doc.content.size), "\n") !== selected) {
        const found = findTextRange(editor.state.doc, selected);
        if (!found) {
          onNotice("The text changed while Luke was writing, so the suggestion was dropped.");
          return;
        }
        range = found;
      }
      const slice = markdownToSlice(editor, r.text);
      const tr = editor.state.tr;
      if (lukeSuggestsRef.current) {
        const sid = newSid();
        if (range.from < range.to) markDeletion(tr, range.from, range.to, LUKE, sid);
        insertSuggestedSlice(tr, tr.mapping.map(range.to), slice, LUKE, sid);
      } else {
        tr.replace(range.from, range.to, slice);
      }
      editor.view.dispatch(tr);
      if (lukeSuggestsRef.current) setTab("suggestions");
    } catch (err) {
      onNotice(`Ask Luke failed: ${(err as Error).message}`);
    } finally {
      setAiBusy(false);
      setAskText("");
    }
  };

  pickSlashRef.current = (item: SlashItem) => {
    if (!editor || !slashRef.current) return;
    const { from } = slashRef.current;
    const to = editor.state.selection.from;
    setSlash(null);
    editor.chain().focus().deleteRange({ from, to }).run();
    if (item.id === "ask") {
      const prompt = window.prompt("What should Luke write here?");
      if (prompt?.trim()) void askLuke("continue", prompt.trim());
      return;
    }
    item.run(editor);
  };

  const restoreVersion = (b64: string) => {
    if (!editor) return;
    const tmp = new Y.Doc();
    Y.applyUpdate(tmp, fromB64(b64));
    const json = yXmlFragmentToProsemirrorJSON(tmp.getXmlFragment("content"));
    tmp.destroy();
    editor.commands.setContent(json);
    onNotice(`Restored an earlier version of “${doc.title}”.`);
  };

  const jumpToSlide = (i: number) => {
    if (!editor) return;
    let seen = 0;
    let target = 1;
    if (i > 0) {
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === "horizontalRule") {
          seen += 1;
          if (seen === i) target = pos + node.nodeSize + 1;
        }
        return seen < i;
      });
    }
    editor.chain().focus().setTextSelection(Math.min(target, editor.state.doc.content.size)).scrollIntoView().run();
    setActiveSlide(i);
  };

  if (!editor) return null;

  const slashItems = slash ? filterSlash(slash.query, isSlides) : [];

  return (
    <div className="relative flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col">
        <DocHeader
          docId={doc.docId}
          kind={doc.kind}
          title={doc.title}
          saveState={session.saveState}
          savedAt={session.savedAt}
          live={session.live}
          peers={session.peers}
          onOpenHistory={() => setHistoryOpen(true)}
          right={
            <div className="flex items-center gap-1.5">
              {isSlides ? (
                <PaneBtn
                  active={rightPane === "slides"}
                  onClick={() => setRightPane((p) => (p === "slides" ? null : "slides"))}
                  icon={<LayoutGrid className="h-3.5 w-3.5" />}
                  label="Slides"
                />
              ) : null}
              <PaneBtn
                active={rightPane === "threads"}
                onClick={() => setRightPane((p) => (p === "threads" ? null : "threads"))}
                icon={<MessagesSquare className="h-3.5 w-3.5" />}
                label={reviewLabel(comments.filter((c) => !c.parentId && !c.resolved).length, suggestions.length)}
              />
            </div>
          }
        />
        <EditorToolbar
          editor={editor}
          kind={isSlides ? "slides" : "doc"}
          suggesting={suggesting}
          onToggleSuggesting={() => setSuggesting((v) => !v)}
          lukeSuggests={lukeSuggests}
          onToggleLukeSuggests={() => setLukeSuggests((v) => !v)}
          onComment={startComment}
        />
        <div className="editor-scroll scroll-pane relative min-h-0 flex-1 overflow-y-auto px-6 pb-24 pt-5">
          <div
            className={cn(
              "neu-raised canvas-editor mx-auto w-full max-w-[820px] rounded-[26px] px-[clamp(24px,5vw,64px)] py-12",
              isSlides && "slides-editor",
              suggesting && "outline outline-2 outline-offset-4 outline-[color:rgba(31,157,85,0.35)]"
            )}
          >
            <EditorContent editor={editor} />
          </div>
          {slash && slashItems.length ? (
            <SlashMenu items={slashItems} index={slashIndex} top={slash.top} left={slash.left} onPick={(it) => pickSlashRef.current(it)} onHover={setSlashIndex} />
          ) : null}
          {aiBusy ? (
            <div className="neu-raised-sm fixed bottom-8 left-1/2 z-40 inline-flex -translate-x-1/2 items-center gap-2 rounded-full px-4 py-2 text-[12.5px] font-semibold text-[color:var(--color-accent-emphasis)]">
              <LoaderCircle className="h-4 w-4 animate-spin" /> Luke is writing…
            </div>
          ) : null}
        </div>

        <BubbleMenu
          editor={editor}
          shouldShow={({ editor: e, state }) => !state.selection.empty && !e.isActive("codeBlock") && e.isEditable}
          options={{ placement: "top" }}
        >
          <div className="neu-menu flex items-center gap-0.5 p-1">
            <BubbleBtn label="Bold" active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}>
              <Bold />
            </BubbleBtn>
            <BubbleBtn label="Italic" active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}>
              <Italic />
            </BubbleBtn>
            <BubbleBtn
              label="Link"
              active={editor.isActive("link")}
              onClick={() => {
                const url = window.prompt("Link URL", "https://");
                if (url?.trim()) editor.chain().focus().extendMarkRange("link").setLink({ href: url.trim() }).run();
              }}
            >
              <LinkIcon />
            </BubbleBtn>
            <BubbleBtn label="Comment" onClick={startComment}>
              <MessageSquarePlus />
            </BubbleBtn>
            <span className="mx-1 h-5 w-px bg-[color:var(--color-border-subtle)]" />
            <div className="relative">
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setAskOpen((v) => !v)}
                className="neu-accent inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[12px] font-semibold"
              >
                <Sparkles className="h-3.5 w-3.5" /> Ask Luke
              </button>
              {askOpen ? (
                <div className="neu-menu absolute left-0 top-10 z-50 w-64 p-2" onMouseDown={(e) => e.preventDefault()}>
                  {[
                    ["improve", "Improve writing"],
                    ["shorten", "Make shorter"],
                    ["expand", "Expand"],
                    ["fix", "Fix spelling & grammar"],
                    ["bullets", "Turn into bullets"],
                  ].map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => askLuke(id)}
                      className="neu-ghost flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] font-medium"
                    >
                      <Wand2 className="h-3.5 w-3.5 text-[color:var(--color-accent)]" />
                      {label}
                    </button>
                  ))}
                  <form
                    className="mt-1"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (askText.trim()) void askLuke("custom", askText.trim());
                    }}
                  >
                    <input
                      value={askText}
                      onChange={(e) => setAskText(e.target.value)}
                      onMouseDown={(e) => e.stopPropagation()}
                      placeholder="Or tell Luke what to do…"
                      aria-label="Custom instruction for Luke"
                      className="neu-inset-sm neu-focus h-9 w-full rounded-full px-3 text-[12.5px] outline-none"
                    />
                  </form>
                </div>
              ) : null}
            </div>
          </div>
        </BubbleMenu>
      </div>

      {rightPane ? (
        <div className="absolute bottom-3 right-3 top-3 z-30 flex min-h-0 flex-col overflow-hidden rounded-[24px] bg-[color:var(--color-surface-base)] shadow-[var(--neu-raised-lg)] neu-rise">
          {rightPane === "slides" ? (
            <SlidesRail html={html} active={activeSlide} onPick={jumpToSlide} onClose={() => setRightPane(null)} />
          ) : (
            <ThreadsPanel
              tab={tab}
              onTab={setTab}
              comments={comments}
              activeComment={activeComment}
              onFocusComment={focusComment}
              draftQuote={draftQuote}
              onSubmitDraft={submitComment}
              onCancelDraft={() => {
                setDraftQuote(null);
                draftRange.current = null;
              }}
              onReply={(parentId, body) => void addComment({ parentId, body })}
              onResolve={(id, resolved) => void resolveComment(id, resolved)}
              suggestions={suggestions}
              onAccept={(sid) => editor.chain().focus().acceptSuggestion(sid).run()}
              onReject={(sid) => editor.chain().focus().rejectSuggestion(sid).run()}
              onAcceptAll={() => editor.chain().focus().acceptAllSuggestions().run()}
              onRejectAll={() => editor.chain().focus().rejectAllSuggestions().run()}
              onFocusSuggestion={focusSuggestion}
              onClose={() => setRightPane(null)}
            />
          )}
        </div>
      ) : null}

      {historyOpen ? <VersionsDialog docId={doc.docId} onClose={() => setHistoryOpen(false)} onRestore={restoreVersion} /> : null}
    </div>
  );
}

function reviewLabel(openComments: number, suggestions: number): string {
  const parts = [];
  if (openComments) parts.push(`${openComments} comment${openComments === 1 ? "" : "s"}`);
  if (suggestions) parts.push(`${suggestions} suggestion${suggestions === 1 ? "" : "s"}`);
  return parts.length ? parts.join(" · ") : "Review";
}

function filterSlash(query: string, isSlides: boolean): SlashItem[] {
  const q = query.toLowerCase();
  return SLASH_ITEMS.filter((it) => (isSlides || it.id !== "slide") && (!q || it.label.toLowerCase().includes(q) || it.keywords.some((k) => k.includes(q))));
}

function slideIndexAt(e: Editor): number {
  const pos = e.state.selection.from;
  let n = 0;
  e.state.doc.descendants((node, p) => {
    if (p >= pos) return false;
    if (node.type.name === "horizontalRule") n += 1;
    return true;
  });
  return n;
}

function BubbleBtn({ label, active, onClick, children }: { label: string; active?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      data-active={active ? "true" : "false"}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className="neu-ghost inline-flex h-8 w-8 items-center justify-center [&_svg]:h-[15px] [&_svg]:w-[15px]"
    >
      {children}
    </button>
  );
}

function PaneBtn({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      data-active={active ? "true" : "false"}
      className="neu-btn inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-[12px] font-semibold"
    >
      {icon}
      {label}
    </button>
  );
}
