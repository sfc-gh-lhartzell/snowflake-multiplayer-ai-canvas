import { NextRequest, NextResponse } from "next/server";
import { getCallerIdentity } from "@/lib/auth";
import { getAction, claimAction, recordActionResult, runApprovedSql, validateProposedSql } from "@/lib/docs-store";
import { publish } from "@/lib/canvas-bus";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/actions/:actionId  { decision: "approve" | "reject" }
 *
 * A teammate's decision on SQL that Luke proposed. Approve runs the statement
 * (caller's rights when deployed, so it executes as the approver) and posts
 * the result back to the room. First decision wins.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ actionId: string }> }): Promise<Response> {
  const { actionId } = await ctx.params;
  const { user } = getCallerIdentity(req);
  const body = (await req.json().catch(() => null)) as { decision?: string } | null;
  if (body?.decision !== "approve" && body?.decision !== "reject") {
    return NextResponse.json({ error: "invalid_decision" }, { status: 400 });
  }
  const action = await getAction(actionId);
  if (!action) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const emit = (status: string, result: unknown) =>
    publish(action.canvasId, {
      type: "action.updated",
      canvasId: action.canvasId,
      by: user,
      payload: { actionId, status, decidedBy: user, result },
      at: Date.now(),
    });

  if (body.decision === "reject") {
    if (!(await claimAction(actionId, "rejected", user))) {
      return NextResponse.json({ error: "already_decided" }, { status: 409 });
    }
    emit("rejected", null);
    return NextResponse.json({ status: "rejected" });
  }

  const invalid = validateProposedSql(action.sqlText);
  if (invalid) {
    if (await claimAction(actionId, "failed", user)) {
      await recordActionResult(actionId, "failed", { error: invalid });
      emit("failed", { error: invalid });
    }
    return NextResponse.json({ status: "failed", error: invalid }, { status: 422 });
  }

  if (!(await claimAction(actionId, "approved", user))) {
    return NextResponse.json({ error: "already_decided" }, { status: 409 });
  }
  emit("running", null);
  try {
    const result = await runApprovedSql(action.sqlText, req);
    await recordActionResult(actionId, "approved", result);
    emit("approved", result);
    return NextResponse.json({ status: "approved", result });
  } catch (err) {
    const result = { error: (err as Error).message };
    await recordActionResult(actionId, "failed", result);
    emit("failed", result);
    return NextResponse.json({ status: "failed", ...result }, { status: 500 });
  }
}
