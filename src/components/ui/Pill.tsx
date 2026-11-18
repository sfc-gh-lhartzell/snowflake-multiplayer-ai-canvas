import { cn } from "@/lib/cn";

type Tone = "neutral" | "accent" | "success" | "warn" | "danger";

export function Pill({
  children,
  tone = "neutral",
  dot,
  pulsing,
  className,
}: {
  children: React.ReactNode;
  tone?: Tone;
  dot?: boolean;
  pulsing?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold shadow-[var(--neu-inset-sm)]",
        tone === "neutral" && "bg-[color:var(--color-surface-base)] text-[color:var(--color-text-secondary)]",
        tone === "accent" && "bg-[color:var(--color-accent-subtle)] text-[color:var(--color-accent-emphasis)]",
        tone === "success" && "bg-[color:var(--color-surface-base)] text-[color:var(--color-success-text)]",
        tone === "warn" && "bg-[color:var(--color-surface-base)] text-[color:var(--color-warn-text)]",
        tone === "danger" && "bg-[color:var(--color-surface-base)] text-[color:var(--color-danger-text)]",
        className
      )}
    >
      {dot ? (
        <span
          className={cn(
            "h-1.5 w-1.5 rounded-full",
            pulsing && "canvas-pulse-dot",
            tone === "neutral" && "bg-[color:var(--color-ink-400)]",
            tone === "accent" && "bg-[color:var(--color-snow-500)]",
            tone === "success" && "bg-[color:var(--color-success-500)]",
            tone === "warn" && "bg-[color:var(--color-warn-500)]",
            tone === "danger" && "bg-[color:var(--color-danger-500)]"
          )}
        />
      ) : null}
      {children}
    </span>
  );
}
