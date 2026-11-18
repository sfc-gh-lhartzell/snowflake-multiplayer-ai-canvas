import { NextRequest, NextResponse } from "next/server";
import { aiComplete } from "@/lib/docs-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PRESETS: Record<string, string> = {
  improve: "Improve the writing: clearer, tighter, same meaning and tone.",
  shorten: "Make it about half as long without losing key facts.",
  expand: "Expand it with one or two more sentences of useful detail.",
  fix: "Fix spelling, grammar, and punctuation only.",
  bullets: "Rewrite it as a short bulleted list.",
  continue: "Continue writing from where the text ends, in the same voice. Return only the new text.",
};

/**
 * POST /api/ai/transform  { action, instruction?, text, title? }
 *
 * Inline "Ask Luke" in the editor. Returns replacement text only; the editor
 * inserts it as a tracked suggestion attributed to Luke.
 */
export async function POST(req: NextRequest): Promise<Response> {
  const body = (await req.json().catch(() => null)) as {
    action?: string;
    instruction?: string;
    text?: string;
    title?: string;
  } | null;
  const text = (body?.text ?? "").slice(0, 12_000);
  const task = body?.instruction?.trim() || PRESETS[body?.action ?? ""] || PRESETS.improve;
  if (!text.trim() && body?.action !== "continue") {
    return NextResponse.json({ error: "empty_text" }, { status: 400 });
  }
  const prompt = [
    "You are Luke, an editor working inside a team's shared document.",
    body?.title ? `Document title: ${body.title}` : "",
    `Task: ${task}`,
    "Return ONLY the resulting text, as plain markdown, with no preamble, quotes, or explanation.",
    "",
    "Text:",
    text,
  ]
    .filter(Boolean)
    .join("\n");
  try {
    const out = (await aiComplete(prompt)).trim();
    return NextResponse.json({ text: out });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
