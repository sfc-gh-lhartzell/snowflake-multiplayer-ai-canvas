import { NextRequest, NextResponse } from "next/server";
import { getCallerIdentity } from "@/lib/auth";
import { setCommentResolved } from "@/lib/docs-store";
import { publish } from "@/lib/canvas-bus";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** PATCH /api/comments/:commentId  { resolved, canvasId, docId } — resolve or reopen a thread. */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ commentId: string }> }): Promise<Response> {
  const { commentId } = await ctx.params;
  const { user } = getCallerIdentity(req);
  const body = (await req.json().catch(() => null)) as { resolved?: boolean; canvasId?: string; docId?: string } | null;
  if (typeof body?.resolved !== "boolean") return NextResponse.json({ error: "missing_resolved" }, { status: 400 });
  try {
    await setCommentResolved(commentId, body.resolved);
    if (body.canvasId) {
      publish(body.canvasId, {
        type: "comment.changed",
        canvasId: body.canvasId,
        by: user,
        payload: { docId: body.docId, commentId, resolved: body.resolved },
        at: Date.now(),
      });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
