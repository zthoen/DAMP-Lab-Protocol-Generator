/** SVG viewBox dimensions the floor plan is drawn at — the `<svg>` itself
 *  scales to its container width via `width: "100%"`, so these only fix the
 *  aspect ratio and the coordinate space every other constant in data.ts is
 *  expressed in. */
export const VIEW_W = 960;
export const VIEW_H = 370;

/** Palette keyed off the DAMP Lab logo (coral/pink, slate blue-gray,
 *  charcoal) — a host application is free to override any of these to match
 *  its own theme; nothing here is load-bearing beyond "a set of distinct
 *  colors for empty/current/next/route/text." */
export const C = {
  bg: "#121212",
  panel: "#1c1c1c",
  panel2: "#171717",
  border: "#333333",
  text: "#e5e5e5",
  muted: "#8a8a8a",
  teal: "#e2395c",
  amber: "#f2b134",
  red: "#ff5c6c",
  blue: "#93b3b8",
  green: "#8be04e",
  sage: "#8fbf9f",
  floor: "#161616",
  slot: "#232323",
  slotLine: "#3a3a3a",
} as const;

export type Palette = typeof C;

export const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

/** Greedily wraps `t` onto at most 2 rows of at most `max` characters each —
 *  used to keep a bench's name legible inside its small box regardless of
 *  how long the real equipment/station name is. */
export function wrapLabel(t: string, max: number): string[] {
  const words = t.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length <= max) cur = (cur + " " + w).trim();
    else {
      if (cur) lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 2);
}
