/**
 * Persistence for Canvas Plus: documents, versions, comments, and the SQL
 * approval queue. All tables live in AGENT_CANVAS_PLUS.PUBLIC (see setup.sql).
 *
 * Uses one cached owner-rights connection (re-opened every 10 minutes, or on
 * error) because autosave writes frequently. Approved SQL is the exception:
 * it runs on a caller's-rights connection when deployed, so it executes under
 * the approving teammate's own role.
 */

import { randomUUID } from "node:crypto";
import type { Connection } from "snowflake-sdk";
import type { IncomingMessage } from "node:http";
import { openOwnerConnection, callerConnection, executeAsync } from "./canvas-store";
import { getServiceToken, getCallerToken } from "./auth";

const T = "AGENT_CANVAS_PLUS.PUBLIC";
const CONN_TTL_MS = 10 * 60_000;

let cachedConn: { conn: Connection; openedAt: number } | null = null;
let connecting: Promise<Connection> | null = null;

async function conn(): Promise<Connection> {
  if (cachedConn && Date.now() - cachedConn.openedAt < CONN_TTL_MS && cachedConn.conn.isUp()) {
    return cachedConn.conn;
  }
  if (!connecting) {
    connecting = openOwnerConnection()
      .then(async (c) => {
        // Timestamps are TIMESTAMP_NTZ; pin the session to UTC so the "Z"
        // suffix we format them with is true.
        await executeAsync(c, "ALTER SESSION SET TIMEZONE = 'UTC'");
        const old = cachedConn?.conn;
        cachedConn = { conn: c, openedAt: Date.now() };
        if (old) old.destroy(() => {});
        return c;
      })
      .finally(() => {
        connecting = null;
      });
  }
  return connecting;
}

async function q<T>(sql: string, binds: unknown[] = []): Promise<T[]> {
  try {
    return await executeAsync<T>(await conn(), sql, binds);
  } catch (err) {
    // One retry on a fresh connection covers expired tokens and dropped sockets.
    cachedConn = null;
    return await executeAsync<T>(await conn(), sql, binds);
  }
}

// ----- documents -----------------------------------------------------------

export type DocKind = "doc" | "slides" | "html" | "markdown" | "chart";
export const DOC_KINDS: DocKind[] = ["doc", "slides", "html", "markdown", "chart"];

export interface DocMeta {
  docId: string;
  canvasId: string;
  kind: DocKind;
  title: string;
  createdBy: string;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DocFull extends DocMeta {
  ydocState: string | null;
  snapshot: string | null;
  seed: string | null;
}

const META_COLS = `doc_id AS "docId", canvas_id AS "canvasId", kind AS "kind", title AS "title",
  created_by AS "createdBy", updated_by AS "updatedBy",
  TO_VARCHAR(created_at, 'YYYY-MM-DD"T"HH24:MI:SS.FF3"Z"') AS "createdAt",
  TO_VARCHAR(updated_at, 'YYYY-MM-DD"T"HH24:MI:SS.FF3"Z"') AS "updatedAt"`;

export async function listDocs(canvasId: string): Promise<DocMeta[]> {
  return q<DocMeta>(
    `SELECT ${META_COLS} FROM ${T}.DOCS WHERE canvas_id = ? AND NOT archived ORDER BY updated_at DESC`,
    [canvasId]
  );
}

export async function getDoc(docId: string): Promise<DocFull | undefined> {
  const rows = await q<DocFull>(
    `SELECT ${META_COLS}, ydoc_state AS "ydocState", snapshot AS "snapshot", seed AS "seed"
     FROM ${T}.DOCS WHERE doc_id = ?`,
    [docId]
  );
  return rows[0];
}

/** Resolve a document by id or (case-insensitive) title within a canvas. */
export async function findDoc(canvasId: string, ref: string): Promise<DocMeta | undefined> {
  const rows = await q<DocMeta>(
    `SELECT ${META_COLS} FROM ${T}.DOCS
     WHERE canvas_id = ? AND NOT archived AND (doc_id = ? OR LOWER(title) = LOWER(?))
     ORDER BY updated_at DESC LIMIT 1`,
    [canvasId, ref, ref.trim()]
  );
  return rows[0];
}

export async function createDoc(args: {
  canvasId: string;
  kind: DocKind;
  title: string;
  seed?: string;
  createdBy: string;
}): Promise<DocMeta> {
  const docId = randomUUID();
  const now = new Date().toISOString();
  await q(
    `INSERT INTO ${T}.DOCS (doc_id, canvas_id, kind, title, seed, snapshot, created_by, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [docId, args.canvasId, args.kind, args.title, args.seed ?? null, args.seed ?? null, args.createdBy, args.createdBy]
  );
  return {
    docId,
    canvasId: args.canvasId,
    kind: args.kind,
    title: args.title,
    createdBy: args.createdBy,
    updatedBy: args.createdBy,
    createdAt: now,
    updatedAt: now,
  };
}

export async function saveDocState(docId: string, ydocState: string, by: string | null): Promise<void> {
  await q(
    `UPDATE ${T}.DOCS SET ydoc_state = ?, updated_by = COALESCE(?, updated_by), updated_at = CURRENT_TIMESTAMP()
     WHERE doc_id = ?`,
    [ydocState, by, docId]
  );
}

export async function saveSnapshot(docId: string, snapshot: string): Promise<void> {
  await q(`UPDATE ${T}.DOCS SET snapshot = ? WHERE doc_id = ?`, [snapshot, docId]);
}

export async function updateDocMeta(
  docId: string,
  patch: { title?: string; archived?: boolean },
  by: string
): Promise<void> {
  if (patch.title !== undefined) {
    await q(`UPDATE ${T}.DOCS SET title = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP() WHERE doc_id = ?`, [
      patch.title,
      by,
      docId,
    ]);
  }
  if (patch.archived !== undefined) {
    await q(`UPDATE ${T}.DOCS SET archived = ?, updated_by = ? WHERE doc_id = ?`, [patch.archived, by, docId]);
  }
}

// ----- versions ------------------------------------------------------------

export interface DocVersion {
  versionId: string;
  savedBy: string | null;
  savedAt: string;
}

export async function addVersion(docId: string, ydocState: string, snapshot: string | null, by: string | null) {
  await q(
    `INSERT INTO ${T}.DOC_VERSIONS (version_id, doc_id, ydoc_state, snapshot, saved_by) VALUES (?, ?, ?, ?, ?)`,
    [randomUUID(), docId, ydocState, snapshot, by]
  );
}

export async function listVersions(docId: string): Promise<DocVersion[]> {
  return q<DocVersion>(
    `SELECT version_id AS "versionId", saved_by AS "savedBy",
       TO_VARCHAR(saved_at, 'YYYY-MM-DD"T"HH24:MI:SS.FF3"Z"') AS "savedAt"
     FROM ${T}.DOC_VERSIONS WHERE doc_id = ? ORDER BY saved_at DESC LIMIT 50`,
    [docId]
  );
}

export async function getVersion(docId: string, versionId: string) {
  const rows = await q<{ ydocState: string | null; snapshot: string | null }>(
    `SELECT ydoc_state AS "ydocState", snapshot AS "snapshot" FROM ${T}.DOC_VERSIONS
     WHERE doc_id = ? AND version_id = ?`,
    [docId, versionId]
  );
  return rows[0];
}

// ----- comments ------------------------------------------------------------

export interface CommentRow {
  commentId: string;
  docId: string;
  parentId: string | null;
  quote: string | null;
  author: string;
  body: string;
  resolved: boolean;
  createdAt: string;
}

export async function listComments(docId: string): Promise<CommentRow[]> {
  return q<CommentRow>(
    `SELECT comment_id AS "commentId", doc_id AS "docId", parent_id AS "parentId", quote AS "quote",
       author AS "author", body AS "body", resolved AS "resolved",
       TO_VARCHAR(created_at, 'YYYY-MM-DD"T"HH24:MI:SS.FF3"Z"') AS "createdAt"
     FROM ${T}.COMMENTS WHERE doc_id = ? ORDER BY created_at ASC`,
    [docId]
  );
}

export async function addComment(args: {
  commentId?: string;
  docId: string;
  canvasId: string;
  parentId?: string | null;
  quote?: string | null;
  author: string;
  body: string;
}): Promise<CommentRow> {
  const commentId = args.commentId ?? randomUUID();
  await q(
    `INSERT INTO ${T}.COMMENTS (comment_id, doc_id, canvas_id, parent_id, quote, author, body)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [commentId, args.docId, args.canvasId, args.parentId ?? null, args.quote ?? null, args.author, args.body]
  );
  return {
    commentId,
    docId: args.docId,
    parentId: args.parentId ?? null,
    quote: args.quote ?? null,
    author: args.author,
    body: args.body,
    resolved: false,
    createdAt: new Date().toISOString(),
  };
}

export async function setCommentResolved(commentId: string, resolved: boolean): Promise<void> {
  await q(
    `UPDATE ${T}.COMMENTS SET resolved = ?, updated_at = CURRENT_TIMESTAMP() WHERE comment_id = ? OR parent_id = ?`,
    [resolved, commentId, commentId]
  );
}

// ----- SQL approvals -------------------------------------------------------

export type ActionStatus = "pending" | "approved" | "rejected" | "failed";

export interface ActionRow {
  actionId: string;
  canvasId: string;
  kind: "sql";
  sqlText: string;
  rationale: string | null;
  proposedBy: string;
  status: ActionStatus;
  decidedBy: string | null;
  result: unknown;
  createdAt: string;
}

const ACTION_COLS = `action_id AS "actionId", canvas_id AS "canvasId", kind AS "kind", sql_text AS "sqlText",
  rationale AS "rationale", proposed_by AS "proposedBy", status AS "status", decided_by AS "decidedBy",
  result AS "result", TO_VARCHAR(created_at, 'YYYY-MM-DD"T"HH24:MI:SS.FF3"Z"') AS "createdAt"`;

export async function createAction(args: {
  actionId?: string;
  canvasId: string;
  sqlText: string;
  rationale?: string;
  proposedBy: string;
}): Promise<ActionRow> {
  const actionId = args.actionId ?? randomUUID();
  await q(
    `INSERT INTO ${T}.PENDING_ACTIONS (action_id, canvas_id, kind, sql_text, rationale, proposed_by, status)
     VALUES (?, ?, 'sql', ?, ?, ?, 'pending')`,
    [actionId, args.canvasId, args.sqlText, args.rationale ?? null, args.proposedBy]
  );
  return {
    actionId,
    canvasId: args.canvasId,
    kind: "sql",
    sqlText: args.sqlText,
    rationale: args.rationale ?? null,
    proposedBy: args.proposedBy,
    status: "pending",
    decidedBy: null,
    result: null,
    createdAt: new Date().toISOString(),
  };
}

export async function getAction(actionId: string): Promise<ActionRow | undefined> {
  const rows = await q<ActionRow>(`SELECT ${ACTION_COLS} FROM ${T}.PENDING_ACTIONS WHERE action_id = ?`, [actionId]);
  const row = rows[0];
  if (row && typeof row.result === "string") {
    try {
      row.result = JSON.parse(row.result);
    } catch {
      /* leave as string */
    }
  }
  return row;
}

export async function listActions(canvasId: string): Promise<ActionRow[]> {
  const rows = await q<ActionRow>(
    `SELECT ${ACTION_COLS} FROM ${T}.PENDING_ACTIONS WHERE canvas_id = ? ORDER BY created_at DESC LIMIT 50`,
    [canvasId]
  );
  for (const row of rows) {
    if (typeof row.result === "string") {
      try {
        row.result = JSON.parse(row.result);
      } catch {
        /* leave as string */
      }
    }
  }
  return rows;
}

/**
 * Atomically move a pending action to a decided state. Returns false when it
 * was already decided (two teammates clicking at once: first click wins).
 */
export async function claimAction(actionId: string, status: ActionStatus, by: string): Promise<boolean> {
  const rows = await q<{ "number of rows updated": number }>(
    `UPDATE ${T}.PENDING_ACTIONS SET status = ?, decided_by = ?, decided_at = CURRENT_TIMESTAMP()
     WHERE action_id = ? AND status = 'pending'`,
    [status, by, actionId]
  );
  return Number(rows[0]?.["number of rows updated"] ?? 0) > 0;
}

export async function recordActionResult(actionId: string, status: ActionStatus, result: unknown): Promise<void> {
  await q(`UPDATE ${T}.PENDING_ACTIONS SET status = ?, result = PARSE_JSON(?) WHERE action_id = ?`, [
    status,
    JSON.stringify(result ?? null),
    actionId,
  ]);
}

// ----- approved SQL execution ---------------------------------------------

/** Statements an approval can never run, whatever the role allows. */
const BLOCKED = /^\s*(DROP\s+(DATABASE|SCHEMA|ROLE|USER|WAREHOUSE)|GRANT|REVOKE|ALTER\s+(ACCOUNT|USER|ROLE)|CREATE\s+(USER|ROLE)|USE\s+ROLE)\b/i;

export function validateProposedSql(sql: string): string | null {
  const trimmed = sql.trim().replace(/;\s*$/, "");
  if (!trimmed) return "Empty statement.";
  // A semicolon outside quotes means more than one statement.
  if (/;(?=(?:[^']*'[^']*')*[^']*$)/.test(trimmed)) return "Only one statement can be approved at a time.";
  if (BLOCKED.test(trimmed)) return "This kind of statement (account, role, user, or grant changes) is blocked in the canvas.";
  return null;
}

/**
 * Run an approved statement. Deployed: caller's rights, so it executes as the
 * teammate who clicked Approve. Local dev: the dev service user's role.
 */
export async function runApprovedSql(sql: string, req: IncomingMessage | Request) {
  const deployed = Boolean(getServiceToken());
  const deployedCaller = deployed && Boolean(getCallerToken(req));
  // Deployed, approved SQL runs only as the approver. Never fall back to the app role.
  if (deployed && !deployedCaller) throw new Error("Approver identity missing; refusing to run as the app role.");
  const c = deployedCaller ? await callerConnection(req) : await conn();
  try {
    const rows = await executeAsync<Record<string, unknown>>(c, sql.trim().replace(/;\s*$/, ""));
    return {
      ranAs: deployedCaller ? "approver" : "app role (local dev)",
      rowCount: rows.length,
      rows: rows.slice(0, 20),
    };
  } finally {
    if (deployedCaller) c.destroy(() => {});
  }
}

// ----- inline AI (Ask Luke in the editor) ----------------------------------

const AI_MODEL = process.env.CANVAS_AI_MODEL ?? "claude-sonnet-4-5";

export async function aiComplete(prompt: string): Promise<string> {
  const rows = await q<{ OUT: string }>(`SELECT AI_COMPLETE(?, ?) AS "OUT"`, [AI_MODEL, prompt]);
  const out = rows[0]?.OUT ?? "";
  // AI_COMPLETE returns a JSON-encoded string for plain prompts.
  try {
    const parsed = JSON.parse(out);
    return typeof parsed === "string" ? parsed : out;
  } catch {
    return out;
  }
}
