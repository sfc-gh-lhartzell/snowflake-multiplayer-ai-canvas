"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, Play, X } from "lucide-react";

/** Split editor HTML into slides at each horizontal rule (same indexing as the editor's slide frame). */
export function splitSlides(html: string): string[] {
  const slides = html.split(/<hr\s*\/?>/i).map((s) => s.trim());
  const empty = slides.every((s) => !s.replace(/<p>\s*<\/p>/g, "").trim());
  return empty ? ["<h1>Untitled slide</h1>"] : slides;
}

/** Strip suggestion/comment wrappers so slides show the proposed result cleanly. */
function cleanForSlide(html: string): string {
  if (typeof document === "undefined") return html;
  const el = document.createElement("div");
  el.innerHTML = html;
  el.querySelectorAll("del[data-sid]").forEach((n) => n.remove());
  el.querySelectorAll("ins[data-sid], span[data-comment-id]").forEach((n) => n.replaceWith(...Array.from(n.childNodes)));
  return el.innerHTML;
}

export function SlideView({ html, className }: { html: string; className?: string }) {
  return (
    <div className={`slide-frame ${className ?? ""}`}>
      <div className="slide-body" dangerouslySetInnerHTML={{ __html: cleanForSlide(html) }} />
    </div>
  );
}

export function SlidesRail({ html, active, onPick, onClose }: { html: string; active: number; onPick: (i: number) => void; onClose?: () => void }) {
  const slides = splitSlides(html);
  const [presenting, setPresenting] = useState<number | null>(null);
  return (
    <aside className="flex h-full w-[260px] shrink-0 flex-col gap-3 p-4" aria-label="Slides">
      <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => setPresenting(Math.min(active, slides.length - 1))}
        className="neu-accent inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-full text-[13px] font-semibold"
      >
        <Play className="h-4 w-4" /> Present
      </button>
      {onClose ? (
        <button type="button" onClick={onClose} aria-label="Close slides panel" className="neu-ghost inline-flex h-9 w-9 shrink-0 items-center justify-center">
          <X className="h-4 w-4" />
        </button>
      ) : null}
      </div>
      <div className="scroll-pane -mr-2 flex-1 space-y-3 overflow-y-auto px-1 pr-2 pb-4 pt-1">
        {slides.map((s, i) => (
          <button
            key={i}
            type="button"
            onClick={() => onPick(i)}
            className="group block w-full text-left"
            aria-label={`Slide ${i + 1}`}
          >
            <div className="mb-1 text-[10.5px] font-bold tracking-wide text-[color:var(--color-text-muted)]">{i + 1}</div>
            <div className={i === active ? "rounded-[18px] outline outline-2 outline-offset-2 outline-[color:var(--color-accent)]" : ""}>
              <SlideView html={s} />
            </div>
          </button>
        ))}
      </div>
      {presenting !== null ? <PresentMode slides={slides} start={presenting} onClose={() => setPresenting(null)} /> : null}
    </aside>
  );
}

function PresentMode({ slides, start, onClose }: { slides: string[]; start: number; onClose: () => void }) {
  const [i, setI] = useState(start);
  const next = useCallback(() => setI((v) => Math.min(slides.length - 1, v + 1)), [slides.length]);
  const prev = useCallback(() => setI((v) => Math.max(0, v - 1)), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (["ArrowRight", "PageDown", " ", "Enter"].includes(e.key)) {
        e.preventDefault();
        next();
      } else if (["ArrowLeft", "PageUp", "Backspace"].includes(e.key)) {
        e.preventDefault();
        prev();
      }
    };
    window.addEventListener("keydown", onKey);
    document.documentElement.requestFullscreen?.().catch(() => {});
    return () => {
      window.removeEventListener("keydown", onKey);
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    };
  }, [next, prev, onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-[color:var(--color-surface-base)] p-[3vw]"
      role="dialog"
      aria-label="Presentation"
    >
      <div className="w-full max-w-[min(94vw,calc(88vh*16/9))]" key={i}>
        <div className="neu-rise">
          <SlideView html={slides[i]} />
        </div>
      </div>
      <div className="mt-6 flex items-center gap-3">
        <button type="button" onClick={prev} disabled={i === 0} className="neu-btn inline-flex h-10 w-10 items-center justify-center rounded-full disabled:opacity-40" aria-label="Previous slide">
          <ChevronLeft className="h-5 w-5" />
        </button>
        <span className="neu-inset-sm rounded-full px-4 py-2 text-[13px] font-semibold tabular-nums">
          {i + 1} / {slides.length}
        </span>
        <button type="button" onClick={next} disabled={i === slides.length - 1} className="neu-btn inline-flex h-10 w-10 items-center justify-center rounded-full disabled:opacity-40" aria-label="Next slide">
          <ChevronRight className="h-5 w-5" />
        </button>
        <button type="button" onClick={onClose} className="neu-btn ml-4 inline-flex h-10 items-center gap-1.5 rounded-full px-4 text-[13px] font-semibold" aria-label="Exit presentation">
          <X className="h-4 w-4" /> Exit
        </button>
      </div>
    </div>,
    document.body
  );
}
