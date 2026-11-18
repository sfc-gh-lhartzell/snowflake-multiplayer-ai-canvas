import { Mark, mergeAttributes } from "@tiptap/core";

/**
 * Comment anchor. The thread itself lives in the COMMENTS table; the mark
 * only carries its id, so it travels with the text as people edit.
 */
export const CommentMark = Mark.create({
  name: "comment",
  inclusive: false,
  excludes: "",

  addAttributes() {
    return {
      commentId: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-comment-id"),
        renderHTML: (attrs) => ({ "data-comment-id": attrs.commentId }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-comment-id]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes, { class: "comment-anchor" }), 0];
  },
});
