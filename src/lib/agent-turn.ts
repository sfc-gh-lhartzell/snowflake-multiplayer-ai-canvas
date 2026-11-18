/**
 * Runs one agent turn and applies Luke's canvas tools as they stream in.
 *
 * Luke's write tools are Snowflake procedures that only log the call (see
 * setup.sql). The real effect happens here, on the app server, as soon as the
 * tool_use event arrives:
 *
 *   create_document      -> new row in DOCS, announced to the room (opens live)
 *   edit_document        -> queued on the doc hub, applied as tracked suggestions
 *   comment_on_document  -> queued on the doc hub, anchored by the first editor
 *   propose_sql          -> PENDING_ACTIONS row + approval card; runs only on approve
 *   code_execution       -> Snowflake's own approval gate (permission_policy
 *                           always_ask): the turn pauses, the room sees an
 *                           approval card, and /permission resumes the turn.
 */

import type { NextRequest } from "next/server";
import type { ConversationInput } from "@snowflake/cortex-agent-sdk";
import { callerAgentClient, agentFqn } from "./agent";
import { getCanvas, putCanvas, deleteCanvas } from "./canvas-store";
import { publish } from "./canvas-bus";
import { createDoc, findDoc, createAction, addComment, DOC_KINDS, type DocKind } from "./docs-store";
import { enqueueAiOp } from "./doc-hub";

export const AGENT_NAME = "LUKE";

interface PendingPermission {
  canvasId: string;
  toolUseId: string;
  options: string[];
  requestedBy: string;
  at: number;
}

const PERM_KEY = "__CANVAS_PENDING_PERMISSIONS__";
function permissions(): Map<string, PendingPermission> {
  const g = globalThis as unknown as Record<string, Map<string, PendingPermission> | undefined>;
  if (!g[PERM_KEY]) g[PERM_KEY] = new Map();
  return g[PERM_KEY]!;
}

export function takePendingPermission(canvasId: string, toolUseId: string): PendingPermission | undefined {
  const p = permissions().get(toolUseId);
  if (!p || p.canvasId !== canvasId) return undefined;
  permissions().delete(toolUseId);
  return p;
}

type AgentEvent = {
  event?: string;
  type?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  permission?: { options?: string[] };
};

export async function runTurn(args: {
  canvasId: string;
  user: string;
  input: ConversationInput;
  req: NextRequest;
}): Promise<void> {
  const { canvasId, user, input, req } = args;
  const client = callerAgentClient(req);
  const handled = new Set<string>();

  try {
    let row = await getCanvas(canvasId);
    const createFreshThread = async () => {
      const convo = await client.conversations.create({
        thread: { origin_application: "canvas-app" },
        agent: { type: "data", spec: agentFqn() },
      });
      await putCanvas({ canvasId, threadId: Number(convo.id), createdBy: user });
      return convo;
    };

    let convo;
    if (!row) {
      convo = await createFreshThread();
    } else {
      try {
        convo = await client.conversations.attach(String(row.THREAD_ID));
      } catch (attachErr) {
        console.warn("[turn] attach failed, creating fresh thread", {
          canvasId,
          message: (attachErr as Error).message,
        });
        await deleteCanvas(canvasId);
        convo = await createFreshThread();
      }
    }

    const turn = await convo.send(input, { agent: { type: "data", spec: agentFqn() } });

    for await (const event of turn.events()) {
      const ev = event as unknown as AgentEvent;
      const kind = ev.event ?? ev.type;
      if (kind === "response.tool_use" && ev.tool_use_id && !handled.has(ev.tool_use_id)) {
        handled.add(ev.tool_use_id);
        // Apply before relaying, so the room sees the doc/card as the tool card lands.
        await applyTool(canvasId, user, ev).catch((err) =>
          console.error("[turn] tool apply failed", { tool: ev.name, message: (err as Error).message })
        );
      }
      publish(canvasId, { type: "agent.event", canvasId, by: user, payload: event, at: Date.now() });
    }
  } catch (err) {
    const e = err as Error & { cause?: unknown; code?: string };
    console.error("[turn] error", { canvasId, user, message: e.message, code: e.code, cause: e.cause });
    publish(canvasId, {
      type: "turn.error",
      canvasId,
      by: user,
      payload: { message: "Luke hit an error on this turn. Try again, or ask a teammate to retry." },
      at: Date.now(),
    });
  } finally {
    publish(canvasId, { type: "turn.done", canvasId, by: user, at: Date.now() });
  }
}

async function applyTool(canvasId: string, user: string, ev: AgentEvent): Promise<void> {
  const input = (ev.input ?? {}) as Record<string, unknown>;
  const str = (k: string) => (typeof input[k] === "string" ? (input[k] as string) : "");
  const toolUseId = ev.tool_use_id!;

  // Snowflake's approval gate (code_execution under always_ask).
  if (ev.permission?.options?.length) {
    permissions().set(toolUseId, {
      canvasId,
      toolUseId,
      options: ev.permission.options,
      requestedBy: user,
      at: Date.now(),
    });
    publish(canvasId, {
      type: "permission.requested",
      canvasId,
      by: user,
      payload: { toolUseId, tool: ev.name, options: ev.permission.options, input },
      at: Date.now(),
    });
    return;
  }

  switch (ev.name) {
    case "create_document": {
      const kind = (DOC_KINDS.includes(str("kind") as DocKind) ? str("kind") : "doc") as DocKind;
      const doc = await createDoc({
        canvasId,
        kind,
        title: str("title").slice(0, 200) || "Untitled",
        seed: str("content"),
        createdBy: AGENT_NAME,
      });
      publish(canvasId, {
        type: "doc.created",
        canvasId,
        by: AGENT_NAME,
        payload: { doc, open: true, requestedBy: user },
        at: Date.now(),
      });
      return;
    }
    case "edit_document":
    case "comment_on_document": {
      const doc = await findDoc(canvasId, str("document"));
      if (!doc) {
        publish(canvasId, {
          type: "system.note",
          canvasId,
          payload: { text: `Luke tried to ${ev.name === "edit_document" ? "edit" : "comment on"} "${str("document")}", but no document has that name.` },
          at: Date.now(),
        });
        return;
      }
      // Luke's comments are written here, server-side, so the author is
      // trustworthy; the editor that claims the op only anchors the mark.
      let opInput = input;
      if (ev.name === "comment_on_document") {
        const comment = await addComment({
          docId: doc.docId,
          canvasId,
          quote: str("quote").slice(0, 500),
          author: AGENT_NAME,
          body: str("comment").slice(0, 4000) || "(empty comment)",
        });
        opInput = { ...input, commentId: comment.commentId };
        publish(canvasId, { type: "comment.changed", canvasId, by: AGENT_NAME, payload: { docId: doc.docId }, at: Date.now() });
      }
      await enqueueAiOp(doc.docId, {
        opId: toolUseId,
        tool: ev.name,
        input: opInput,
        by: user,
        at: Date.now(),
      });
      publish(canvasId, {
        type: "doc.ai_op",
        canvasId,
        by: AGENT_NAME,
        payload: { docId: doc.docId, title: doc.title, tool: ev.name, opId: toolUseId },
        at: Date.now(),
      });
      return;
    }
    case "propose_sql": {
      const action = await createAction({
        actionId: toolUseId,
        canvasId,
        sqlText: str("sql_text"),
        rationale: str("rationale"),
        proposedBy: user,
      });
      publish(canvasId, { type: "action.created", canvasId, by: AGENT_NAME, payload: { action }, at: Date.now() });
      return;
    }
    default:
      return;
  }
}
