export const VIEW_W = 960, VIEW_H = 370;

// Palette keyed off the DAMP Lab logo (coral/pink, slate blue-gray, charcoal).
export const C = {
  bg: "#121212", panel: "#1c1c1c", panel2: "#171717", border: "#333333",
  text: "#e5e5e5", muted: "#8a8a8a", teal: "#e2395c", amber: "#f2b134",
  red: "#ff5c6c", blue: "#93b3b8", green: "#8be04e", floor: "#161616",
  slot: "#232323", slotLine: "#3a3a3a",
};
export const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

export const wrapLabel = (t, max) => {
  const w = t.split(" "), l = [];
  let c = "";
  for (const x of w) {
    if ((c + " " + x).trim().length <= max) c = (c + " " + x).trim();
    else { if (c) l.push(c); c = x; }
  }
  if (c) l.push(c);
  return l.slice(0, 2);
};

// Linear-interpolates between two "#rrggbb" colors at t (0..1) — used by
// LabMap's heat map to shade a station by relative visit frequency.
export const mixHex = (hexA, hexB, t) => {
  const a = parseInt(hexA.slice(1), 16), b = parseInt(hexB.slice(1), 16);
  const lerp = (shift) => Math.round(((a >> shift) & 255) + (((b >> shift) & 255) - ((a >> shift) & 255)) * t);
  return `#${[16, 8, 0].map((shift) => lerp(shift).toString(16).padStart(2, "0")).join("")}`;
};
