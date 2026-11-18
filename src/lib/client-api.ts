"use client";

/**
 * Client-side request helpers.
 *
 * Local dev only: open the app with `?as=Jane` to act as a different teammate
 * in that tab. The name is kept in sessionStorage (per tab) and sent as the
 * x-canvas-as header / `as` query param. The server ignores it when deployed,
 * where identity comes from the Snowflake ingress.
 */

const KEY = "canvas-dev-as";

export function devAs(): string | null {
  if (typeof window === "undefined") return null;
  const fromUrl = new URLSearchParams(window.location.search).get("as");
  try {
    if (fromUrl) sessionStorage.setItem(KEY, fromUrl);
    return fromUrl ?? sessionStorage.getItem(KEY);
  } catch {
    return fromUrl;
  }
}

export function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const as = devAs();
  const headers = new Headers(init.headers);
  if (as) headers.set("x-canvas-as", as);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  return fetch(input, { ...init, headers });
}

export async function apiJson<T>(input: string, init: RequestInit = {}): Promise<T> {
  const res = await apiFetch(input, init);
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body;
}

/** EventSource can't set headers, so the dev identity rides on the query string. */
export function sseUrl(path: string): string {
  const as = devAs();
  if (!as) return path;
  return `${path}${path.includes("?") ? "&" : "?"}as=${encodeURIComponent(as)}`;
}
