import { NextRequest, NextResponse } from "next/server";
import { getCallerIdentity } from "@/lib/auth";
import { getDoc, updateDocMeta } from "@/lib/docs-store";
import { setRoomTitle } from "@/lib/doc-hub";
import { publish } from "@/lib/canvas-bus";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/docs/:docId — metadata (no Yjs state; that arrives over /sync). */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ docId: string }> }): Promise<Response> {
  const { docId } = await ctx.params;
  const doc = await getDoc(docId);
  if (!doc) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const { ydocState: _state, seed: _seed, ...meta } = doc;
  return NextResponse.json({ doc: meta });
}

/** PATCH /api/docs/:docId  { title?, archived? } */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ docId: string }> }): Promise<Response> {
  const { docId } = await ctx.params;
  const { user } = getCallerIdentity(req);
  const body = (await req.json().catch(() => ({}))) as { title?: string; archived?: boolean };
  const doc = await getDoc(docId);
  if (!doc) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const title = typeof body.title === "string" ? body.title.trim().slice(0, 200) : undefined;
  await updateDocMeta(docId, { title: title || undefined, archived: body.archived }, user);
  if (title) setRoomTitle(docId, title);
  publish(doc.canvasId, {
    type: "doc.updated",
    canvasId: doc.canvasId,
    by: user,
    payload: { docId, title, archived: body.archived },
    at: Date.now(),
  });
  return NextResponse.json({ ok: true });
}
