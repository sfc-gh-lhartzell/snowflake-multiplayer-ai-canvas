import { NextRequest, NextResponse } from "next/server";
import { getCallerIdentity } from "@/lib/auth";
import { listDocs, createDoc, DOC_KINDS, type DocKind } from "@/lib/docs-store";
import { publish } from "@/lib/canvas-bus";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/canvas/:id/docs — documents, decks, and artifacts in this canvas. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id: canvasId } = await ctx.params;
  try {
    return NextResponse.json({ docs: await listDocs(canvasId) });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

/**
 * POST /api/canvas/:id/docs  { kind, title, seed? }
 * Creates a document and announces it to the room.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id: canvasId } = await ctx.params;
  const { user } = getCallerIdentity(req);
  let body: { kind?: string; title?: string; seed?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const kind = (body.kind ?? "doc") as DocKind;
  if (!DOC_KINDS.includes(kind)) return NextResponse.json({ error: "invalid_kind" }, { status: 400 });
  const title = (body.title ?? "").trim().slice(0, 200) || defaultTitle(kind);
  try {
    const doc = await createDoc({ canvasId, kind, title, seed: body.seed, createdBy: user });
    publish(canvasId, { type: "doc.created", canvasId, by: user, payload: { doc }, at: Date.now() });
    return NextResponse.json({ doc });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

function defaultTitle(kind: DocKind): string {
  switch (kind) {
    case "slides":
      return "Untitled deck";
    case "html":
      return "Untitled HTML artifact";
    case "markdown":
      return "Untitled markdown";
    case "chart":
      return "Untitled chart";
    default:
      return "Untitled doc";
  }
}
