import { cn } from "@/lib/cn";
import { forwardRef, type ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", className, children, ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-[12px] font-medium disabled:cursor-not-allowed disabled:opacity-50",
        size === "md" && "h-10 px-4 text-sm",
        size === "sm" && "h-8 px-3 text-xs",
        variant === "primary" && "neu-accent",
        variant === "secondary" && "neu-btn",
        variant === "ghost" && "neu-ghost",
        variant === "danger" &&
          "bg-[color:var(--color-danger-500)] text-[color:var(--color-text-inverse)] shadow-[var(--neu-raised-sm)] hover:bg-[color:var(--color-danger-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--color-danger-500)]",
        className
      )}
      {...rest}
    >
      {children}
    </button>
  );
});
