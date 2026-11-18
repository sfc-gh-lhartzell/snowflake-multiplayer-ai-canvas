"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";

/**
 * CoCo, the Cortex Code penguin, in pixels. Front poses and palette are ported
 * from the Desktop app's CocoPenguinSprite; the sled pose is drawn here in the
 * same grid style. Every sprite is decorative (aria-hidden) and stands still
 * under prefers-reduced-motion.
 */

const PALETTE: Record<string, string> = {
  P: "#58b2e2", // body
  D: "#3f93c4", // flipper
  B: "#fbf6e9", // belly
  O: "#e09146", // beak, feet
  E: "#37364a", // eye open
  e: "#37364a", // eye closed (drawn as a thin line)
  S: "#e5484d", // scarf
  s: "#b8323a", // scarf shade
  W: "#c98a4b", // sled deck
  w: "#9c6532", // deck shade
  K: "#37364a", // runner
};

const FRONT = {
  stand: ["..PPPPP..", "..PEPEP..", ".PPPOPPP.", ".PPPPPPP.", "PPPBBBPPP", "PPPBBBPPP", ".PPBBBPP.", ".POPPPOP.", "..O...O.."],
  blink: ["..PPPPP..", "..PePeP..", ".PPPOPPP.", ".PPPPPPP.", "PPPBBBPPP", "PPPBBBPPP", ".PPBBBPP.", ".POPPPOP.", "..O...O.."],
  squat: ["..PPPPP..", "..PEPEP..", ".PPPOPPP.", ".PPPOPPP.", "PPPBBBPPP", "PPPBBBPPP", ".POPPPOP.", ".POPPPOP."],
  tuck: ["...PPP...", "..PePeP..", ".PPPOPPP.", "PPPBBBPPP", "PPPBBBPPP", ".PPBBBPP.", "..PPPPP..", "...PPP..."],
} as const;

/** Side view, facing right, riding a sled. Two scarf frames. */
const SLED_A = [
  "..........PPPP......",
  ".........PPPPPP.....",
  ".........PPPPEPOO...",
  ".........PPPPPPO....",
  "...SSsSSSSSSSSS.....",
  ".SSs....PPPPPBBB....",
  "........PPDDPBBBB...",
  "........PDDPPBBBB...",
  ".......PPPPPPBBBOO..",
  "...WWWWWWWWWWWWWWWWK",
  "...wwwwwwwwwwwwwwwwK",
  "....K.....K.....K.K.",
  "..KKKKKKKKKKKKKKKK..",
];
const SLED_B = [
  "..........PPPP......",
  ".........PPPPPP.....",
  ".........PPPPEPOO...",
  ".........PPPPPPO....",
  ".SSs..SSSSSSSSS.....",
  "...SSs..PPPPPBBB....",
  "........PPDDPBBBB...",
  "........PDDPPBBBB...",
  ".......PPPPPPBBBOO..",
  "...WWWWWWWWWWWWWWWWK",
  "...wwwwwwwwwwwwwwwwK",
  "....K.....K.....K.K.",
  "..KKKKKKKKKKKKKKKK..",
];

type FrontPose = keyof typeof FRONT;

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const q = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(q.matches);
    const on = () => setReduced(q.matches);
    q.addEventListener("change", on);
    return () => q.removeEventListener("change", on);
  }, []);
  return reduced;
}

/** Merge horizontal runs of one color into one rect, so a sprite is a few dozen nodes. Eyes draw like Desktop's: open is a tall bar, closed a thin line, on body color. */
function Pixels({ grid, x = 0, y = 0 }: { grid: readonly string[]; x?: number; y?: number }) {
  const rects: React.ReactNode[] = [];
  const base = (ch: string) => (ch === "E" || ch === "e" ? "P" : ch);
  grid.forEach((line, r) => {
    let c = 0;
    while (c < line.length) {
      const key = base(line[c]);
      const fill = PALETTE[key];
      if (!fill) {
        c++;
        continue;
      }
      const start = c;
      while (c < line.length && base(line[c]) === key) c++;
      rects.push(<rect key={`${r}-${start}`} x={x + start} y={y + r} width={c - start} height={1} fill={fill} />);
    }
    for (let i = 0; i < line.length; i++) {
      if (line[i] === "E") rects.push(<rect key={`e${r}-${i}`} x={x + i} y={y + r + 0.13} width={1} height={0.8} fill={PALETTE.E} />);
      else if (line[i] === "e") rects.push(<rect key={`e${r}-${i}`} x={x + i} y={y + r + 0.47} width={1} height={0.2} fill={PALETTE.e} />);
    }
  });
  return <g shapeRendering="crispEdges">{rects}</g>;
}

const HOP_Y = [0, 0.4, -1.4, -2, -1.4, 0.4, 0];
const HOP_POSE: FrontPose[] = ["stand", "squat", "tuck", "tuck", "tuck", "squat", "stand"];

/**
 * Front-facing CoCo. `still` stands and blinks now and then; `hop` loops the
 * Desktop hop study (use while something is working).
 */
export function CocoFace({ size = 24, mode = "still", className }: { size?: number; mode?: "still" | "hop"; className?: string }) {
  const reduced = usePrefersReducedMotion();
  const [frame, setFrame] = useState(0);
  const hopping = mode === "hop" && !reduced;
  useEffect(() => {
    setFrame(0);
    if (reduced) return;
    if (hopping) {
      const h = setInterval(() => setFrame((f) => (f + 1) % HOP_Y.length), 120);
      return () => clearInterval(h);
    }
    // Blink: one 140ms frame every ~4s, offset per instance so a room of avatars doesn't blink in sync.
    let t: ReturnType<typeof setTimeout>;
    const loop = () => {
      t = setTimeout(() => {
        setFrame(1);
        t = setTimeout(() => {
          setFrame(0);
          loop();
        }, 140);
      }, 3200 + Math.random() * 2400);
    };
    loop();
    return () => clearTimeout(t);
  }, [hopping, reduced]);
  const pose: FrontPose = hopping ? HOP_POSE[frame] : frame === 1 ? "blink" : "stand";
  const dy = hopping ? HOP_Y[frame] : 0;
  return (
    <svg
      viewBox={mode === "hop" ? "-0.5 -2.5 10 12" : "-0.25 -0.25 9.5 9.5"}
      width={size}
      height={size}
      aria-hidden
      className={cn("block overflow-visible", className)}
    >
      <Pixels grid={FRONT[pose]} y={dy + (9 - FRONT[pose].length)} />
    </svg>
  );
}

/**
 * The loader: CoCo sledding downhill, scarf flapping, snow streaming past.
 * Pass `label` for a one-line caption next to it.
 */
export function CocoSled({ size = 56, label, className }: { size?: number; label?: React.ReactNode; className?: string }) {
  const reduced = usePrefersReducedMotion();
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (reduced) return;
    const h = setInterval(() => setFrame((f) => (f + 1) % 4), 150);
    return () => clearInterval(h);
  }, [reduced]);
  const grid = frame % 2 ? SLED_B : SLED_A;
  const bob = reduced ? 0 : frame === 1 || frame === 2 ? -0.5 : 0;
  return (
    <span role="status" className={cn("inline-flex items-center gap-2", className)}>
      <svg
        viewBox="-4 -3 30 21"
        width={size}
        height={(size * 21) / 30}
        aria-hidden
        className={cn("coco-sled block overflow-visible", reduced && "coco-still")}
      >
        <g className="coco-sled-hill">
          <rect x={-4} y={15.2} width={30} height={0.8} fill="var(--coco-snow-line)" shapeRendering="crispEdges" />
          <g className="coco-sled-flakes" fill="var(--coco-snow)">
            <rect x={-2} y={13} width={2.5} height={0.6} />
            <rect x={6} y={11} width={1.6} height={0.6} />
            <rect x={14} y={14} width={3} height={0.6} />
            <rect x={22} y={12} width={1.8} height={0.6} />
            <rect x={30} y={13.5} width={2.4} height={0.6} />
          </g>
        </g>
        <g transform={`translate(0 ${bob + 2})`}>
          <Pixels grid={grid} />
          {!reduced ? (
            <g className="coco-sled-puff" fill="var(--coco-snow)">
              <rect x={0} y={11} width={1} height={1} />
              <rect x={-1.5} y={10} width={1} height={1} />
              <rect x={-1} y={12} width={0.8} height={0.8} />
            </g>
          ) : null}
        </g>
      </svg>
      {label ? <span className="text-[12.5px] font-medium text-[color:var(--color-text-muted)]">{label}</span> : <span className="sr-only">Loading</span>}
    </span>
  );
}

/** A centered sled for a panel that is still opening. */
export function CocoLoading({ label = "Sledding in…" }: { label?: string }) {
  return (
    <div className="flex h-full min-h-[200px] w-full items-center justify-center p-10">
      <div className="flex flex-col items-center gap-3">
        <CocoSled size={88} />
        <span className="text-[12.5px] font-semibold text-[color:var(--color-text-muted)]">{label}</span>
      </div>
    </div>
  );
}

export type CocoArtName = "waddle" | "waddle-loop" | "slip" | "success" | "tip" | "files" | "artifacts" | "automation" | "changes";

let playCounter = 0;

/**
 * One of the Desktop app's animated penguin illustrations (public/coco). Each
 * plays once on mount; clicking replays it. Chromium shares an animation
 * timeline per image URL, so each play needs a fresh query string; `#rest`
 * is the SVG's own :target rule for its resting frame.
 */
export function CocoArt({ name, size = 120, className, replay = true }: { name: CocoArtName; size?: number; className?: string; replay?: boolean }) {
  const reduced = usePrefersReducedMotion();
  const [play, setPlay] = useState<number | null>(null);
  useEffect(() => setPlay(playCounter++), []);
  const src = reduced || play === null ? `/coco/coco-${name}.svg#rest` : `/coco/coco-${name}.svg?play=${play}`;
  // eslint-disable-next-line @next/next/no-img-element
  const img = <img src={src} width={size} height={size} alt="" aria-hidden draggable={false} className="block select-none" style={{ imageRendering: "pixelated" }} />;
  if (!replay) return <span className={cn("inline-block", className)}>{img}</span>;
  return (
    <button
      type="button"
      onClick={() => setPlay(playCounter++)}
      title="Play again"
      aria-label="Play animation again"
      className={cn("inline-block cursor-pointer rounded-[16px] bg-transparent outline-none focus-visible:shadow-[var(--neu-inset-sm)]", className)}
    >
      {img}
    </button>
  );
}

/** Empty state: penguin, one bold line, an optional hint. */
export function CocoEmpty({ art, title, hint, size = 96 }: { art: CocoArtName; title: string; hint?: React.ReactNode; size?: number }) {
  return (
    <div className="flex flex-col items-center px-3 py-5 text-center">
      <CocoArt name={art} size={size} />
      <div className="mt-2 text-[13px] font-bold text-[color:var(--color-text-primary)]">{title}</div>
      {hint ? <div className="mt-1 max-w-[260px] text-[12px] leading-relaxed text-[color:var(--color-text-muted)]">{hint}</div> : null}
    </div>
  );
}

const QUIPS = ["Waxing the sled", "Checking the ice", "Reading the room", "Sledding through your data", "Huddling with the warehouse"];

/** A short rotating caption for "Luke is thinking", changes every few seconds. */
export function useCocoQuip(active: boolean) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (!active) return;
    setI(Math.floor(Math.random() * QUIPS.length));
    const h = setInterval(() => setI((n) => (n + 1) % QUIPS.length), 2600);
    return () => clearInterval(h);
  }, [active]);
  return QUIPS[i];
}

/* ---------- CoCo-style pixel icons for document kinds ---------- */

const ICONS: Record<string, readonly string[]> = {
  doc: ["XXXXXX..", "X....XX.", "X.LL..XX", "X......X", "X.LLLL.X", "X......X", "X.LLLL.X", "X......X", "X.LLL..X", "XXXXXXXX"],
  slides: ["XXXXXXXXXX", "X........X", "X.LLLL...X", "X........X", "X.LL.AAA.X", "X....AAA.X", "XXXXXXXXXX", "....XX....", "...XXXX..."],
  html: ["..X....A.X..", ".X....A...X.", "X....A.....X", ".X..A.....X.", "..XA.....X.."],
  markdown: ["XXXXXXXXXX", "X........X", "X.X...X.AX", "X.XX.XX.AX", "X.X.X.XAAX", "X.X...X.AX", "X........X", "XXXXXXXXXX"],
  chart: ["........AA", "........AA", ".....XX.AA", ".....XX.AA", "..LL.XX.AA", "..LL.XX.AA", "..LL.XX.AA", "XXXXXXXXXX"],
};

export function PixelKindIcon({ kind, tint, size = 15 }: { kind: string; tint: string; size?: number }) {
  const grid = ICONS[kind] ?? ICONS.doc;
  const w = Math.max(...grid.map((l) => l.length));
  const h = grid.length;
  const colors: Record<string, string> = { X: tint, L: "currentColor", A: "#e09146" };
  const rects: React.ReactNode[] = [];
  grid.forEach((line, r) => {
    for (let c = 0; c < line.length; c++) {
      const f = colors[line[c]];
      if (f) rects.push(<rect key={`${r}-${c}`} x={c} y={r} width={1.02} height={1.02} fill={f} />);
    }
  });
  const box = Math.max(w, h);
  return (
    <svg viewBox={`${-(box - w) / 2} ${-(box - h) / 2} ${box} ${box}`} width={size} height={size} aria-hidden shapeRendering="crispEdges" className="block text-[color:var(--color-text-muted)]">
      {rects}
    </svg>
  );
}
