import { NextRequest, NextResponse } from "next/server";
import { getRoom, claimSeed, claimAiOp } from "@/lib/doc-hub";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/docs/:docId/claim  { conn, kind: "seed" | "op", opId? }
 *
 * First-claim-wins handoff for work exactly one editor must do: writing a new
 * doc's initial content, or applying one of Luke's queued edits.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ docId: string }> }): Promise<Response> {
  const { docId } = await ctx.params;
  const body = (await req.json().catch(() => null)) as { conn?: string; kind?: string; opId?: string } | null;
  if (!body?.conn) return NextResponse.json({ error: "missing_conn" }, { status: 400 });
  const room = await getRoom(docId);
  if (!room) return NextResponse.json({ error: "not_found" }, { status: 404 });

  if (body.kind === "seed") {
    const seed = claimSeed(room);
    return NextResponse.json({ granted: seed !== null, seed });
  }
  if (body.kind === "op" && body.opId) {
    const op = claimAiOp(room, body.opId, body.conn);
    return NextResponse.json({ granted: op !== null, op });
  }
  return NextResponse.json({ error: "invalid_kind" }, { status: 400 });
}
