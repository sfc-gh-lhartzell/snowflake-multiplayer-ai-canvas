"use client";

import type { Editor } from "@tiptap/react";
import { useEditorState } from "@tiptap/react";
import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
  Code,
  Highlighter,
  Link,
  List,
  ListOrdered,
  ListTodo,
  Quote,
  SquareCode,
  Table,
  Image,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Undo2,
  Redo2,
  Heading1,
  Heading2,
  Heading3,
  Minus,
  MessageSquarePlus,
  PenLine,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/cn";

export function EditorToolbar({
  editor,
  kind,
  suggesting,
  onToggleSuggesting,
  lukeSuggests,
  onToggleLukeSuggests,
  onComment,
}: {
  editor: Editor;
  kind: "doc" | "slides";
  suggesting: boolean;
  onToggleSuggesting: () => void;
  lukeSuggests: boolean;
  onToggleLukeSuggests: () => void;
  onComment: () => void;
}) {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      underline: e.isActive("underline"),
      strike: e.isActive("strike"),
      code: e.isActive("code"),
      highlight: e.isActive("highlight"),
      link: e.isActive("link"),
      h1: e.isActive("heading", { level: 1 }),
      h2: e.isActive("heading", { level: 2 }),
      h3: e.isActive("heading", { level: 3 }),
      bullet: e.isActive("bulletList"),
      ordered: e.isActive("orderedList"),
      task: e.isActive("taskList"),
      quote: e.isActive("blockquote"),
      codeBlock: e.isActive("codeBlock"),
      left: e.isActive({ textAlign: "left" }),
      center: e.isActive({ textAlign: "center" }),
      right: e.isActive({ textAlign: "right" }),
      hasSelection: !e.state.selection.empty,
    }),
  });

  const chain = () => editor.chain().focus();

  const setLink = () => {
    const prev = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("Link URL", prev ?? "https://");
    if (url === null) return;
    if (!url.trim()) chain().extendMarkRange("link").unsetLink().run();
    else chain().extendMarkRange("link").setLink({ href: url.trim() }).run();
  };

  const addImage = () => {
    const url = window.prompt("Image URL (https://…)");
    if (url && /^https?:\/\//i.test(url.trim())) chain().setImage({ src: url.trim() }).run();
  };

  return (
    <div
      role="toolbar"
      aria-label="Formatting"
      className="neu-raised-sm sticky top-0 z-20 mx-6 flex flex-wrap items-center gap-1 rounded-[18px] px-2 py-1.5"
    >
      <Group>
        <Tool label="Undo (⌘Z)" onClick={() => chain().undo().run()}>
          <Undo2 />
        </Tool>
        <Tool label="Redo (⌘⇧Z)" onClick={() => chain().redo().run()}>
          <Redo2 />
        </Tool>
      </Group>
      <Sep />
      <Group>
        <Tool label="Heading 1" active={s.h1} onClick={() => chain().toggleHeading({ level: 1 }).run()}>
          <Heading1 />
        </Tool>
        <Tool label="Heading 2" active={s.h2} onClick={() => chain().toggleHeading({ level: 2 }).run()}>
          <Heading2 />
        </Tool>
        <Tool label="Heading 3" active={s.h3} onClick={() => chain().toggleHeading({ level: 3 }).run()}>
          <Heading3 />
        </Tool>
      </Group>
      <Sep />
      <Group>
        <Tool label="Bold (⌘B)" active={s.bold} onClick={() => chain().toggleBold().run()}>
          <Bold />
        </Tool>
        <Tool label="Italic (⌘I)" active={s.italic} onClick={() => chain().toggleItalic().run()}>
          <Italic />
        </Tool>
        <Tool label="Underline (⌘U)" active={s.underline} onClick={() => chain().toggleUnderline().run()}>
          <Underline />
        </Tool>
        <Tool label="Strikethrough" active={s.strike} onClick={() => chain().toggleStrike().run()}>
          <Strikethrough />
        </Tool>
        <Tool label="Inline code" active={s.code} onClick={() => chain().toggleCode().run()}>
          <Code />
        </Tool>
        <Tool label="Highlight" active={s.highlight} onClick={() => chain().toggleHighlight().run()}>
          <Highlighter />
        </Tool>
        <Tool label="Link" active={s.link} onClick={setLink}>
          <Link />
        </Tool>
      </Group>
      <Sep />
      <Group>
        <Tool label="Bulleted list" active={s.bullet} onClick={() => chain().toggleBulletList().run()}>
          <List />
        </Tool>
        <Tool label="Numbered list" active={s.ordered} onClick={() => chain().toggleOrderedList().run()}>
          <ListOrdered />
        </Tool>
        <Tool label="Checklist" active={s.task} onClick={() => chain().toggleTaskList().run()}>
          <ListTodo />
        </Tool>
        <Tool label="Quote" active={s.quote} onClick={() => chain().toggleBlockquote().run()}>
          <Quote />
        </Tool>
        <Tool label="Code block" active={s.codeBlock} onClick={() => chain().toggleCodeBlock().run()}>
          <SquareCode />
        </Tool>
        <Tool label="Table" onClick={() => chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}>
          <Table />
        </Tool>
        <Tool label="Image" onClick={addImage}>
          <Image />
        </Tool>
        <Tool
          label={kind === "slides" ? "New slide" : "Divider"}
          onClick={() => chain().setHorizontalRule().run()}
        >
          <Minus />
        </Tool>
      </Group>
      <Sep />
      <Group>
        <Tool label="Align left" active={s.left} onClick={() => chain().setTextAlign("left").run()}>
          <AlignLeft />
        </Tool>
        <Tool label="Align center" active={s.center} onClick={() => chain().setTextAlign("center").run()}>
          <AlignCenter />
        </Tool>
        <Tool label="Align right" active={s.right} onClick={() => chain().setTextAlign("right").run()}>
          <AlignRight />
        </Tool>
      </Group>
      <Sep />
      <Tool label="Comment on selection" disabled={!s.hasSelection} onClick={onComment}>
        <MessageSquarePlus />
      </Tool>

      <div className="ml-auto flex items-center gap-1.5">
        <ModeToggle
          active={lukeSuggests}
          onClick={onToggleLukeSuggests}
          icon={<Sparkles className="h-3.5 w-3.5" />}
          label="Luke suggests"
          title="When on, Luke's edits arrive as suggestions you accept or reject"
        />
        <ModeToggle
          active={suggesting}
          onClick={onToggleSuggesting}
          icon={<PenLine className="h-3.5 w-3.5" />}
          label={suggesting ? "Suggesting" : "Editing"}
          title="Suggest mode: your changes are tracked for others to accept"
          accent
        />
      </div>
    </div>
  );
}

function Group({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center gap-0.5">{children}</div>;
}

function Sep() {
  return <span aria-hidden className="mx-1 h-5 w-px bg-[color:var(--color-border-subtle)]" />;
}

function Tool({
  label,
  active,
  disabled,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      data-active={active ? "true" : "false"}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className="neu-ghost inline-flex h-8 w-8 items-center justify-center disabled:opacity-35 [&_svg]:h-[15px] [&_svg]:w-[15px]"
    >
      {children}
    </button>
  );
}

function ModeToggle({
  active,
  onClick,
  icon,
  label,
  title,
  accent,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  title: string;
  accent?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-pressed={active}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[12px] font-semibold",
        active && accent ? "neu-accent" : active ? "neu-btn text-[color:var(--color-accent-emphasis)]" : "neu-btn text-[color:var(--color-text-secondary)]"
      )}
      data-active={active && !accent ? "true" : "false"}
    >
      {icon}
      {label}
    </button>
  );
}
