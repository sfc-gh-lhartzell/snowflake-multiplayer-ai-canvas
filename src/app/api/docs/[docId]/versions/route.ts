import { NextRequest, NextResponse } from "next/server";
import { listVersions, getVersion } from "@/lib/docs-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/docs/:docId/versions           -> version list
 * GET /api/docs/:docId/versions?v=<id>    -> one version's Yjs state (to restore)
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ docId: string }> }): Promise<Response> {
  const { docId } = await ctx.params;
  const versionId = req.nextUrl.searchParams.get("v");
  try {
    if (versionId) {
      const v = await getVersion(docId, versionId);
      if (!v) return NextResponse.json({ error: "not_found" }, { status: 404 });
      return NextResponse.json({ version: v });
    }
    return NextResponse.json({ versions: await listVersions(docId) });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
