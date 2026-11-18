import { NextRequest, NextResponse } from "next/server";
import { runTurn } from "@/lib/agent-turn";
import { getCallerIdentity } from "@/lib/auth";
import {
  acquireSendLock,
  releaseSendLock,
  peekSendLock,
  publish,
  appendRoomLine,
  flushRoomContext,
  type RoomLine,
} from "@/lib/canvas-bus";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The canvas uses @Luke (any case) as the invocation marker. Non-mention
 * messages are chat between humans and never trigger an agent turn.
 */
const AGENT_MENTION = /@luke\b/i;

/**
 * POST /api/canvas/:id/send
 *
 * Body: { text: string }
 *
 * Flow:
 *   1. Resolve caller identity, parse body.
 *   2. If the message does NOT mention @Luke: publish user.message, append
 *      to the in-memory room-context buffer, return 200 "chat_only". No lock.
 *   3. If the message mentions @Luke:
 *      a. Acquire first-send-wins lock (409 if a turn is in flight).
 *      b. Publish user.message.
 *      c. Flush the room-context buffer and build a composite agent prompt
 *         that includes the recent chat for context.
 *      d. Resolve canvas → thread_id, open conversation, stream SSE events.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id: canvasId } = await ctx.params;
  const identity = getCallerIdentity(req);
  const user = identity.user;

  let body: { text?: string; openDoc?: { id?: string; title?: string; kind?: string } };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const text = (body.text ?? "").trim();
  if (!text) return NextResponse.json({ error: "empty_text" }, { status: 400 });

  const invokesAgent = AGENT_MENTION.test(text);
  const at = Date.now();

  // Every message is broadcast to every subscriber.
  publish(canvasId, {
    type: "user.message",
    canvasId,
    by: user,
    payload: { text, mentionsAgent: invokesAgent },
    at,
  });

  if (!invokesAgent) {
    appendRoomLine(canvasId, { by: user, text, at });
    return NextResponse.json({ accepted: true, kind: "chat_only" }, { status: 200 });
  }

  // Agent invocation path.
  const lock = acquireSendLock(canvasId, user);
  if (!lock) {
    const current = peekSendLock(canvasId);
    return NextResponse.json(
      {
        code: "turn_in_flight",
        inflight_user: current?.user,
        inflight_started_at: current?.startedAt,
      },
      { status: 409 }
    );
  }

  const roomLines = flushRoomContext(canvasId);
  const agentPrompt = buildAgentPrompt({ roomLines, user, text, openDoc: body.openDoc });

  void runTurn({ canvasId, user, input: `[canvas: ${canvasId}]\n\n${agentPrompt}`, req }).finally(() => {
    releaseSendLock(canvasId);
  });

  return NextResponse.json(
    { accepted: true, kind: "agent_turn", context_lines: roomLines.length },
    { status: 202 }
  );
}

function buildAgentPrompt(args: {
  roomLines: RoomLine[];
  user: string;
  text: string;
  openDoc?: { id?: string; title?: string; kind?: string };
}): string {
  const { roomLines, user, text, openDoc } = args;
  const focus =
    openDoc?.id && openDoc.title
      ? `[open document: ${openDoc.title.replace(/[\]\n]/g, " ")} (${openDoc.kind ?? "doc"}, id ${openDoc.id})]\n`
      : "";
  if (roomLines.length === 0) {
    return `${focus}[${user} mentioning @Luke]: ${text}`;
  }
  const transcript = roomLines
    .map((l) => `${l.by}: ${l.text}`)
    .join("\n");
  return [
    ...(focus ? [focus.trimEnd()] : []),
    "[Recent room transcript, not addressed to you]",
    transcript,
    "",
    `[${user} is now mentioning @Luke]`,
    text,
  ].join("\n");
}
