export const VIEW_W = 960, VIEW_H = 370;

// Palette keyed off the DAMP Lab logo (coral/pink, slate blue-gray, charcoal).
export const C = {
  bg: "#121212", panel: "#1c1c1c", panel2: "#171717", border: "#333333",
  text: "#e5e5e5", muted: "#8a8a8a", teal: "#e2395c", amber: "#f2b134",
  red: "#ff5c6c", blue: "#93b3b8", green: "#8be04e", floor: "#161616",
  slot: "#232323", slotLine: "#3a3a3a",
};
// Light companion palette for cards/tables that should read as "paper" against the
// dark chrome.
export const LC = {
  bg: "#ffffff", panel: "#ffffff", panel2: "#f4f4f4", border: "#dcdcdc",
  text: "#1a1a1a", muted: "#666666",
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
