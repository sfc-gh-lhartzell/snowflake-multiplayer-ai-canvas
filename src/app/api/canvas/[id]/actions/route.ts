import { NextRequest, NextResponse } from "next/server";
import { listActions } from "@/lib/docs-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/canvas/:id/actions — recent SQL proposals and their outcomes. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id: canvasId } = await ctx.params;
  try {
    return NextResponse.json({ actions: await listActions(canvasId) });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
