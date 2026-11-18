/** Stable per-person colors, shared by avatars and live cursors. */

const PALETTE = [
  "#E8618C", // rose
  "#7B61FF", // violet
  "#F59E0B", // amber
  "#10B981", // emerald
  "#3B82F6", // blue
  "#EF6C3A", // tangerine
  "#14B8A6", // teal
  "#A855F7", // purple
];

export const AGENT_COLOR = "#1FA4D8";

export function userColor(name: string): string {
  if (!name) return PALETTE[0];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

/** Title-case an uppercased Snowflake login for display ("JANE_DOE" -> "Jane Doe"). */
export function displayName(login: string): string {
  return login
    .toLowerCase()
    .split(/[_\s.]+/)
    .filter(Boolean)
    .map((p) => p[0].toUpperCase() + p.slice(1))
    .join(" ");
}
