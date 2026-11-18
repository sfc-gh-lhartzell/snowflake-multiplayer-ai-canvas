import { NextRequest, NextResponse } from "next/server";
import { getCallerIdentity } from "@/lib/auth";
import { getDoc, listComments, addComment } from "@/lib/docs-store";
import { publish } from "@/lib/canvas-bus";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/docs/:docId/comments */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ docId: string }> }): Promise<Response> {
  const { docId } = await ctx.params;
  try {
    return NextResponse.json({ comments: await listComments(docId) });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

/**
 * POST /api/docs/:docId/comments  { commentId?, parentId?, quote?, body }
 * commentId is client-generated for new threads so the editor can anchor its
 * comment mark before the row lands.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ docId: string }> }): Promise<Response> {
  const { docId } = await ctx.params;
  const { user } = getCallerIdentity(req);
  const body = (await req.json().catch(() => null)) as {
    commentId?: string;
    parentId?: string;
    quote?: string;
    body?: string;
  } | null;
  const text = body?.body?.trim();
  if (!text) return NextResponse.json({ error: "empty_comment" }, { status: 400 });
  const doc = await getDoc(docId);
  if (!doc) return NextResponse.json({ error: "not_found" }, { status: 404 });
  try {
    const comment = await addComment({
      commentId: body?.commentId && /^[A-Za-z0-9-]{8,64}$/.test(body.commentId) ? body.commentId : undefined,
      docId,
      canvasId: doc.canvasId,
      parentId: body?.parentId ?? null,
      quote: body?.quote?.slice(0, 500) ?? null,
      author: user,
      body: text.slice(0, 4000),
    });
    publish(doc.canvasId, { type: "comment.changed", canvasId: doc.canvasId, by: user, payload: { docId }, at: Date.now() });
    return NextResponse.json({ comment });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
