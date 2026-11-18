"use client";

// Client-only subscribing hook for the theme state. Separated from theme.ts
// so theme.ts stays React-free and importable by server components.

import { useEffect, useState } from "react";
import { readTheme, type Theme } from "./theme";

export function useTheme(): Theme {
  // Start from the server's value so hydration matches; the effect below
  // picks up the real theme (set pre-hydration on <html>) right after mount.
  const [t, setT] = useState<Theme>("light");

  useEffect(() => {
    if (typeof document === "undefined") return;
    const html = document.documentElement;
    const read = () => setT(readTheme());
    read();
    const obs = new MutationObserver(read);
    obs.observe(html, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);

  return t;
}
