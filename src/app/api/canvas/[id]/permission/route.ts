import { NextRequest, NextResponse } from "next/server";
import { getCallerIdentity } from "@/lib/auth";
import { acquireSendLock, releaseSendLock, peekSendLock, publish } from "@/lib/canvas-bus";
import { runTurn, takePendingPermission } from "@/lib/agent-turn";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/canvas/:id/permission  { toolUseId, decision, reason? }
 *
 * Answers Snowflake's approval gate for a code_execution call (the agent's
 * permission_policy is always_ask). Any teammate in the room can decide; the
 * decision resumes the paused turn on the canvas thread.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id: canvasId } = await ctx.params;
  const { user } = getCallerIdentity(req);
  const body = (await req.json().catch(() => null)) as { toolUseId?: string; decision?: string; reason?: string } | null;
  if (!body?.toolUseId || !body.decision) return NextResponse.json({ error: "missing_fields" }, { status: 400 });

  const lock = acquireSendLock(canvasId, user);
  if (!lock) {
    return NextResponse.json({ code: "turn_in_flight", inflight_user: peekSendLock(canvasId)?.user }, { status: 409 });
  }
  const pending = takePendingPermission(canvasId, body.toolUseId);
  if (!pending || !pending.options.includes(body.decision)) {
    releaseSendLock(canvasId);
    return NextResponse.json({ error: "no_pending_request_or_invalid_decision" }, { status: 409 });
  }

  publish(canvasId, {
    type: "permission.decided",
    canvasId,
    by: user,
    payload: { toolUseId: body.toolUseId, decision: body.decision },
    at: Date.now(),
  });

  const denied = /deny|reject|no/i.test(body.decision);
  const decision = {
    type: "permission_decision",
    permission_decision: {
      tool_use_id: body.toolUseId,
      decision: body.decision,
      ...(denied ? { reason: body.reason ?? `${user} declined running this code.` } : {}),
    },
  };

  void runTurn({
    canvasId,
    user,
    input: [decision] as unknown as Parameters<typeof runTurn>[0]["input"],
    req,
  }).finally(() => releaseSendLock(canvasId));

  return NextResponse.json({ accepted: true }, { status: 202 });
}
