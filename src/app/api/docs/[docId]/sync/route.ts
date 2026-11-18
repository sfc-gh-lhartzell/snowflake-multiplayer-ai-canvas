import { NextRequest, NextResponse } from "next/server";
import { getCallerIdentity } from "@/lib/auth";
import { getRoom, connect, disconnect, applyClientUpdate, applyClientAwareness } from "@/lib/doc-hub";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/docs/:docId/sync?conn=<id>
 *
 * SSE stream for one document. First message is the full Yjs state plus
 * current cursors; then incremental updates, cursor changes, save status, and
 * Luke's queued edits.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ docId: string }> }): Promise<Response> {
  const { docId } = await ctx.params;
  const { user } = getCallerIdentity(req);
  const connId = req.nextUrl.searchParams.get("conn");
  if (!connId) return NextResponse.json({ error: "missing_conn" }, { status: 400 });

  const room = await getRoom(docId);
  if (!room) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const send = (msg: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(msg)}\n\n`));
        } catch {
          closed = true;
        }
      };
      connect(room, connId, user, send);
      const heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`: hb\n\n`));
        } catch {
          closed = true;
        }
      }, 20_000);
      req.signal.addEventListener("abort", () => {
        closed = true;
        clearInterval(heartbeat);
        disconnect(room, connId);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
      connection: "keep-alive",
    },
  });
}

/** POST /api/docs/:docId/sync  { conn, update?, awareness? } (base64 Yjs payloads) */
export async function POST(req: NextRequest, ctx: { params: Promise<{ docId: string }> }): Promise<Response> {
  const { docId } = await ctx.params;
  const { user } = getCallerIdentity(req);
  const body = (await req.json().catch(() => null)) as { conn?: string; update?: string; awareness?: string } | null;
  if (!body?.conn) return NextResponse.json({ error: "missing_conn" }, { status: 400 });
  const room = await getRoom(docId);
  if (!room) return NextResponse.json({ error: "not_found" }, { status: 404 });
  try {
    if (body.update) applyClientUpdate(room, body.conn, body.update, user);
    if (body.awareness) applyClientAwareness(room, body.conn, body.awareness);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
