export type DocKind = "doc" | "slides" | "html" | "markdown" | "chart";

export interface DocMetaClient {
  docId: string;
  canvasId: string;
  kind: DocKind;
  title: string;
  createdBy: string;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OpenDocRef {
  id: string;
  title: string;
  kind: DocKind;
}
