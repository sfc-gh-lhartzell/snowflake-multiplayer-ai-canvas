import { NextRequest, NextResponse } from "next/server";
import { saveSnapshot } from "@/lib/docs-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_SNAPSHOT = 200_000;

/**
 * POST /api/docs/:docId/snapshot  { snapshot }
 *
 * Editors send a readable rendering (markdown for docs and decks, raw source
 * for artifacts) a couple of seconds after edits settle. It's what Luke reads
 * through the READ_DOCUMENT tool.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ docId: string }> }): Promise<Response> {
  const { docId } = await ctx.params;
  const body = (await req.json().catch(() => null)) as { snapshot?: string } | null;
  if (typeof body?.snapshot !== "string") return NextResponse.json({ error: "missing_snapshot" }, { status: 400 });
  try {
    await saveSnapshot(docId, body.snapshot.slice(0, MAX_SNAPSHOT));
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
