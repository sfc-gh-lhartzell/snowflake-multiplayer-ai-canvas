import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";

/**
 * Slides are one document with a horizontal rule between slides. To edit them
 * like slides, show only the slide holding the cursor: every other top-level
 * block (and the rules themselves) gets a `slide-off` class that hides it, so
 * the editor frame can be a fixed 16:9 page. Moving the cursor past a rule
 * (arrow keys, typing ---, picking a thumbnail) moves to that slide.
 */
export const slideFocusKey = new PluginKey<number>("slideFocus");

export function slideIndexAtPos(doc: PMNode, pos: number): number {
  let n = 0;
  doc.forEach((node, offset) => {
    if (offset < pos && node.type.name === "horizontalRule") n += 1;
  });
  return n;
}

export const SlideFocus = Extension.create({
  name: "slideFocus",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: slideFocusKey,
        props: {
          decorations(state) {
            const active = slideIndexAtPos(state.doc, state.selection.from);
            const decos: Decoration[] = [];
            let slide = 0;
            state.doc.forEach((node, offset) => {
              const isRule = node.type.name === "horizontalRule";
              if (isRule || slide !== active) {
                decos.push(Decoration.node(offset, offset + node.nodeSize, { class: "slide-off" }));
              }
              if (isRule) slide += 1;
            });
            return DecorationSet.create(state.doc, decos);
          },
        },
      }),
    ];
  },
});
