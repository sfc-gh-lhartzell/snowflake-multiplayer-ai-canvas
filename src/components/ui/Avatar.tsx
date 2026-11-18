"use client";

import { cn } from "@/lib/cn";
import { useTheme } from "@/lib/use-theme";
import { userColor } from "@/lib/colors";
import { CocoFace } from "@/components/coco/Coco";

export function Avatar({
  name,
  variant = "person",
  size = 28,
  online,
  title,
}: {
  name: string;
  variant?: "person" | "agent" | "system";
  size?: number;
  online?: boolean;
  title?: string;
}) {
  const initials = pickInitials(name);
  const style =
    variant === "person"
      ? { width: size, height: size, background: userColor(name), color: "#fff", fontSize: size < 24 ? Math.max(8, Math.round(size * 0.45)) : undefined }
      : { width: size, height: size };
  const theme = useTheme();
  const spooky = theme === "halloween" && variant === "agent";

  return (
    <div className="relative inline-flex" title={title ?? name}>
      <div
        className={cn(
          "inline-flex items-center justify-center rounded-full text-[11px] font-semibold uppercase shadow-[var(--neu-raised-sm)]",
          variant === "agent" &&
            "bg-[color:var(--color-surface-raised)]",
          variant === "system" &&
            "bg-[color:var(--color-ink-800)] text-[color:var(--color-ink-100)]"
        )}
        style={style}
      >
        {variant === "agent" ? <CocoFace size={Math.round(size * 0.78)} /> : initials}
      </div>
      {spooky ? (
        <span
          className="pointer-events-none absolute -top-2 -right-1 text-[14px] leading-none select-none"
          aria-hidden="true"
        >
          🎃
        </span>
      ) : null}
      {online ? (
        <span
          className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-[color:var(--color-success-500)] ring-2 ring-[color:var(--color-surface-raised)]"
          aria-label="online"
        />
      ) : null}
    </div>
  );
}

function pickInitials(name: string): string {
  const parts = name.replace(/[^a-zA-Z0-9 _-]/g, "").split(/[ _-]+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

