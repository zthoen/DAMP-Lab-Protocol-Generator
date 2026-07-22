/* Static lab floor geometry: the physical grid every station map is drawn onto,
   independent of whatever equipment/station table a user loads. Fixed at 8 columns
   (A-H) x 3 rows (1-3) = 24 benches, plus 8 fixed utility fixtures around the back
   wall (waste/sharps/recycling/sink/glassware/consumables/refrigerator — see
   FIXTURES below). Storage aisles from the original sim are otherwise out of
   scope for now. */

// Real-world reference measurements the protocol generator's "distance walked" is
// built from (see routeDistanceFt below) — approximate, as given by the lab:
// benches are ~6ft long (front-to-back) and ~2.5ft wide (side-to-side), walkways
// are ~6ft wide, and the walkway past row 3 is ~5ft wide.
export const BENCH_LEN_FT = 6;
export const BENCH_WIDTH_FT = 2.5;
export const WALKWAY_WIDTH_FT = 6;
export const BACK_AISLE_FT = 5;

// Benches touch — there's no gap within a column (A1 touches A2 touches A3) or
// between the two columns of a touching pair (B touches C, D touches E, F touches
// G). The only open space on the floor is the 5 walkways: one between each of
// A|B, C|D, E|F, G|H, plus the back walkway past row 3. A bench can only be
// reached by walking to its front (the edge facing its walkway) and using that
// walkway — never by cutting through another bench.
const SLOT_W = 70, SLOT_H = 62;
const COL_X = { A: 40, B: 150, C: 220, D: 330, E: 400, F: 510, G: 580, H: 690 };
const ROW_Y = { 1: 30, 2: 30 + SLOT_H, 3: 30 + 2 * SLOT_H };
export const SLOTS = {};
for (const [c, x] of Object.entries(COL_X)) for (const r of [1, 2, 3]) SLOTS[c + r] = { x, y: ROW_Y[r], w: SLOT_W, h: SLOT_H };

// Each pair shares one walkway; the first column in a pair faces it on the right,
// the second faces it on the left (the pair's touching neighbor, if any, blocks
// the other side).
const WALKWAY_GROUPS = [["A", "B"], ["C", "D"], ["E", "F"], ["G", "H"]];
const COL_ORDER = WALKWAY_GROUPS.flat();
const groupOf = (col) => WALKWAY_GROUPS.findIndex((g) => g.includes(col));
const frontSide = (col) => (WALKWAY_GROUPS[groupOf(col)][0] === col ? "right" : "left");
const walkwayCenterX = (g) => {
  const [l, r] = WALKWAY_GROUPS[g];
  return (COL_X[l] + SLOT_W + COL_X[r]) / 2;
};

/* Fixed utility fixtures — baselines that never move. The sharps bin, recycling
   bin, and biohazard box sit touching the bottom of row 3 (the end of columns B
   and C), exactly like a 4th row with nothing beyond it. The sink, glassware,
   and the two consumables stations sit in a row on the *far* side of the back
   walkway (left to right: sink, glassware, Consumables 1, Consumables 2),
   shifted right so the sink's left edge lines up with B3's left edge. The 4C
   refrigerator sits on that same far side, off on its own past the last
   column. Real dimensions (feet) are kept as "length" (the top-to-bottom
   extent, facing the wall) x "width" (the left-to-right extent), scaled up for
   map legibility since a couple of feet would otherwise round to an unreadable
   box. */
// Exported so the map can draw an honest pixel-accurate scale marker (see
// LabMap.jsx) — the only part of the floor plan actually drawn to a literal
// feet-to-pixel scale; bench spacing is stylized for legibility, not to scale.
export const FIXTURE_PX_PER_FT = 16;
const FIXTURE_GAP = 12;
const box = (lengthFt, widthFt) => ({ w: Math.round(widthFt * FIXTURE_PX_PER_FT), h: Math.round(lengthFt * FIXTURE_PX_PER_FT) });

const sharpsBox = box(2, 1), recycleBox = box(1.5, 3), wasteBox = box(2, 2);
const sinkBox = box(2.5, 5);
const glasswareBox = box(2.25, 4), consum1Box = box(2.25, 4), consum2Box = box(2.25, 4);
const refrigeratorBox = box(2.5, 5);

// The trio's top edge touches row 3's bottom edge directly (no gap), chained
// left to right and centered on whichever touching pair's boundary it straddles.
const TRIO_TOP_Y = ROW_Y[3] + SLOT_H;
const trioWidth = sharpsBox.w + FIXTURE_GAP + recycleBox.w + FIXTURE_GAP + wasteBox.w;

// The 3 touching column-pairs (see the comment above WALKWAY_GROUPS — B-C, D-E,
// F-G touch directly, unlike the walkway pairs) the sharps/recycling/biohazard
// trio can anchor to as a group; A and H each touch only one neighbor via a
// walkway, not a touching pair, so they're never eligible. The Lab Optimizer is
// the only thing that ever picks anything but "BC" (today's fixed layout).
export const TOUCHING_PAIRS = { BC: ["B", "C"], DE: ["D", "E"], FG: ["F", "G"] };
export const DEFAULT_TRIO_ANCHOR = "BC";

// Pixel boxes for the trio anchored at a given touching pair, keeping its fixed
// left-to-right internal order (sharps, recycling, biohazard) and vertical
// placement (touching row 3) regardless of which pair it's centered on.
function trioBoxesFor([leftCol, rightCol]) {
  const midX = (COL_X[leftCol] + SLOT_W / 2 + COL_X[rightCol] + SLOT_W / 2) / 2;
  const sharpsX = midX - trioWidth / 2;
  const recycleX = sharpsX + sharpsBox.w + FIXTURE_GAP;
  const wasteX = recycleX + recycleBox.w + FIXTURE_GAP;
  return {
    SHARPS: { name: "Sharps Bin", x: sharpsX, y: TRIO_TOP_Y, w: sharpsBox.w, h: sharpsBox.h },
    RECYCLE: { name: "Recycling Bin", x: recycleX, y: TRIO_TOP_Y, w: recycleBox.w, h: recycleBox.h },
    WASTE: { name: "Biohazard Waste", x: wasteX, y: TRIO_TOP_Y, w: wasteBox.w, h: wasteBox.h },
  };
}
// Exposed so the Lab Optimizer's map view can render the trio relocated to
// whichever anchor it recommends, without disturbing the default layout below.
export const trioFixturesForAnchor = (anchorKey) => trioBoxesFor(TOUCHING_PAIRS[anchorKey]);

// The back walkway starts right where the trio ends (so the trio sits flush
// between row 3 above and the walkway below) and runs the full width of the
// floor, connecting all 4 vertical walkways into one continuous strip.
const BACK_AISLE_Y = TRIO_TOP_Y + Math.max(sharpsBox.h, recycleBox.h, wasteBox.h) + 17;
const BACK_AISLE_H = 34;
const BACK_AISLE_TOP = BACK_AISLE_Y - BACK_AISLE_H / 2;
const BACK_AISLE_BOTTOM = BACK_AISLE_Y + BACK_AISLE_H / 2;

// The sink/glassware/Consumables-1/Consumables-2 row sits below the back
// walkway (the far side from the trio), shifted right so the sink's left edge
// lines up with B3's left edge — directly across the walkway from the
// sharps/recycling/biohazard group, but offset from it rather than centered
// on the same boundary.
const FAR_TOP_Y = BACK_AISLE_BOTTOM + 22; // headroom for the ID label above the box
const sinkX = COL_X.B;
const glasswareX = sinkX + sinkBox.w + FIXTURE_GAP;
const consum1X = glasswareX + glasswareBox.w + FIXTURE_GAP;
const consum2X = consum1X + consum1Box.w + FIXTURE_GAP;

// The refrigerator sits on the same far side, off past the last column — 5ft
// to the right of H3, across the walkway from it (same FAR_TOP_Y as the rest
// of the far row, since it's the same "beyond the back walkway" distance,
// just far to the right instead of over by B-C).
const refrigeratorX = COL_X.H + SLOT_W + 5 * FIXTURE_PX_PER_FT;

export const FIXTURES = {
  ...trioBoxesFor(TOUCHING_PAIRS[DEFAULT_TRIO_ANCHOR]),
  SINK: { name: "Sink", x: sinkX, y: FAR_TOP_Y, w: sinkBox.w, h: sinkBox.h },
  GLASSWARE: { name: "Glassware", x: glasswareX, y: FAR_TOP_Y, w: glasswareBox.w, h: glasswareBox.h },
  CONSUM1: { name: "Consumables 1", x: consum1X, y: FAR_TOP_Y, w: consum1Box.w, h: consum1Box.h },
  CONSUM2: { name: "Consumables 2", x: consum2X, y: FAR_TOP_Y, w: consum2Box.w, h: consum2Box.h },
  REFRIGERATOR: { name: "4C Refrigerator", x: refrigeratorX, y: FAR_TOP_Y, w: refrigeratorBox.w, h: refrigeratorBox.h },
};

// None of the 8 fixtures carry any built-in equipment — every piece of
// equipment a protocol can use, at a fixture or a bench alike, has to come
// from the table pasted on the Equipment Input tab. A fixture is just a
// destination on the map, exactly like a bench, until a pasted row explicitly
// maps something to it.

// The trio (touching row 3, reached via whichever of B's or C's own walkway is
// closer — never a separate back-walkway crossing) vs. everything else beyond
// the back walkway (genuinely across it, like the fixtures in the previous
// layout). FAR_FEETX values are lateral feet along the far side, purely for the
// distance model — they tell the same qualitative story as the pixel layout
// above (sink, glassware, Consumables 1, Consumables 2 in that order, with the
// refrigerator far off past column H) without needing to be derived from it.
// SHARPS aliases to the anchor's left column, WASTE to the right, RECYCLE to
// either — the trio's fixed left-to-right order, wherever it's anchored.
function nearFixturesFor([leftCol, rightCol]) {
  return { SHARPS: [leftCol], WASTE: [rightCol], RECYCLE: [leftCol, rightCol] };
}
// Exposed for the Lab Optimizer to build a distance table for a candidate anchor.
export const nearFixturesForAnchor = (anchorKey) => nearFixturesFor(TOUCHING_PAIRS[anchorKey]);
const NEAR_FIXTURES = nearFixturesFor(TOUCHING_PAIRS[DEFAULT_TRIO_ANCHOR]);
const FAR_FEETX = {
  SINK: 0,
  GLASSWARE: 4,
  CONSUM1: 8,
  CONSUM2: 12,
  REFRIGERATOR: COL_ORDER.indexOf("H") * BENCH_WIDTH_FT + 5,
};
const isNearFixture = (id) => Object.prototype.hasOwnProperty.call(NEAR_FIXTURES, id);
const isFarFixture = (id) => Object.prototype.hasOwnProperty.call(FAR_FEETX, id);
export const isFixtureId = (id) => isNearFixture(id) || isFarFixture(id);
// Exposed so the map can label the trio below its box (it touches row 3 above,
// with no room for a label there) and the far pair above (which does have room).
export { isNearFixture };

// Vertical walkway rectangles extended down to meet the back walkway with no
// gap, plus the back walkway itself — together they render as one continuous
// shaded region (a comb shape) rather than 5 separate boxes. The back walkway
// runs wide enough to reach past the refrigerator, so it reads as one continuous
// walkway rather than an unmarked gap between the far row and the refrigerator.
const WALKWAYS = WALKWAY_GROUPS.map(([l, r]) => ({
  x: COL_X[l] + SLOT_W,
  width: COL_X[r] - (COL_X[l] + SLOT_W),
  y: ROW_Y[1],
  height: BACK_AISLE_TOP - ROW_Y[1],
}));
const FLOOR_X = 20;
const floorRightEdge = refrigeratorX + refrigeratorBox.w + FLOOR_X;
const BACK_AISLE = { x: FLOOR_X, y: BACK_AISLE_TOP, width: floorRightEdge - FLOOR_X, height: BACK_AISLE_H };

// A single outline tracing the 4 prongs + the back-aisle bar as one comb-shaped
// polygon, so the map can fill/stroke it as one continuous region instead of 5
// separate rectangles with visible seams between them.
export const WALKWAY_PATH = (() => {
  const pts = [[BACK_AISLE.x, BACK_AISLE_TOP]];
  for (const w of WALKWAYS) {
    pts.push([w.x, BACK_AISLE_TOP], [w.x, w.y], [w.x + w.width, w.y], [w.x + w.width, BACK_AISLE_TOP]);
  }
  pts.push(
    [BACK_AISLE.x + BACK_AISLE.width, BACK_AISLE_TOP],
    [BACK_AISLE.x + BACK_AISLE.width, BACK_AISLE_BOTTOM],
    [BACK_AISLE.x, BACK_AISLE_BOTTOM],
  );
  return `M ${pts.map((p) => p.join(",")).join(" L ")} Z`;
})();

// centers are static (SLOTS/FIXTURES never change at runtime) — precompute once.
const CENTER_CACHE = {};
for (const id in SLOTS) CENTER_CACHE[id] = { x: SLOTS[id].x + SLOTS[id].w / 2, y: SLOTS[id].y + SLOTS[id].h / 2 };
for (const id in FIXTURES) CENTER_CACHE[id] = { x: FIXTURES[id].x + FIXTURES[id].w / 2, y: FIXTURES[id].y + FIXTURES[id].h / 2 };
export const center = (id) => CENTER_CACHE[id];

// The point on a station's edge that actually opens onto its walkway — every
// route starts and ends here, never overlapping into the station's own box.
// A bench's front faces its walkway; the trio's front is its bottom edge (facing
// the back walkway below it); the far pair's front is its top edge (facing the
// back walkway above it). Exported so LabMap.jsx can anchor a highlighted
// path's very first point here too, instead of at the first station's center.
export const front = (id) => {
  if (isNearFixture(id)) { const f = FIXTURES[id]; return { x: f.x + f.w / 2, y: f.y + f.h }; }
  if (isFarFixture(id)) { const f = FIXTURES[id]; return { x: f.x + f.w / 2, y: f.y }; }
  const r = SLOTS[id], c = center(id);
  return frontSide(id[0]) === "right" ? { x: r.x + r.w, y: c.y } : { x: r.x, y: c.y };
};

export const STATION_IDS = [...Object.keys(SLOTS), ...Object.keys(FIXTURES)];

// Every bench has a fixed, hardcoded name — the physical lab's real station
// names, not something a pasted table supplies. Row 1 is nearest the front of
// the room, row 3 nearest the back wall/fixtures; columns run A-H left to right.
export const BENCH_NAMES = {
  A1: "Opentrons", B1: "Dry Chemical Weighing", C1: "NanoDrop", D1: "DNA/RNA Prep",
  E1: "Microbial Culture Prep", F1: "Microbial Culture Processing", G1: "Research", H1: "Small Equipment",
  A2: "Automation Prep 1", B2: "Dry Chemical Prep", C2: "Gel Electrophoresis", D2: "DNA Prep",
  E2: "Microbial Incubators", F2: "GC-MS 1", G2: "Imaging", H2: "Transfyr",
  A3: "Hamilton", B3: "Automation Prep 2", C3: "Gel Imaging", D3: "PCR",
  E3: "Cell Culture Plate Reader", F3: "GC-MS 2", G3: "Vacuum Oven", H3: "Prototyping",
};

// Every station (bench or fixture) has exactly one fixed name — this is what a
// pasted table's "Station Name" column is matched against (see labTable.js),
// not the internal A1-H3/SHARPS-style ids, which are purely an implementation
// detail of the geometry model below.
export const STATION_NAME = { ...BENCH_NAMES };
for (const [id, f] of Object.entries(FIXTURES)) STATION_NAME[id] = f.name;

// Reverse lookup for parsing a pasted station name back to its internal id,
// case-insensitively.
export const NAME_TO_STATION_ID = {};
for (const [id, name] of Object.entries(STATION_NAME)) NAME_TO_STATION_ID[name.toLowerCase()] = id;

// A pipette isn't tied to one station the way a piece of equipment is — any
// bench with pipettes and bench space works. `protocolImport.js` resolves a
// step whose Equipment cell literally reads "Pipette" to whichever of these
// is nearest, instead of requiring it in the pasted equipment list like
// everything else has to be. Exported by name (not just resolved id) so the
// Lab Optimizer can re-resolve the pool under a candidate bench-name layout —
// the ids below are only valid for the real, current layout.
export const PIPETTE_STATION_NAMES = [
  "Dry Chemical Prep", "Automation Prep 2", "NanoDrop", "Gel Imaging",
  "Research", "Transfyr", "DNA/RNA Prep", "Microbial Culture Prep",
];
export const PIPETTE_STATIONS = PIPETTE_STATION_NAMES.map((n) => NAME_TO_STATION_ID[n.toLowerCase()]);

const rowOf = (id) => Number(id[1]);

/* Same-walkway pairs (same column, or the two columns of a walkway pair) never
   need the back-walkway detour — the whole walkway between them is one open
   rectangle. Two benches in the same COLUMN still can't cut a corner, though:
   a third bench sits directly between any two non-adjacent rows there (A1 and
   A3 have A2 physically between them), so that case stays a pure vertical
   distance.

   Between two DIFFERENT columns of the same walkway, a diagonal is only safe
   when the rows are the same or adjacent. A column has no gaps between its own
   three benches (A1 touches A2 touches A3), so while a diagonal's x is still
   inside a column's width, its y can't drift outside that specific bench's own
   row without clipping the row next to it — and for a same-row or adjacent-row
   pair, the straight line from center to center never drifts that far before
   x clears the column on both ends (verified exhaustively against every real
   bench pair in data.test.js). Two rows apart (row 1 to row 3), that's no
   longer true — the middle row is too tall relative to the walkway's width, so
   the direct line clips it on both sides — so that one case keeps the old
   squared-off route instead. Diagonal or not, it's still never worse than the
   squared-off distance (Math.hypot(v, l) <= v + l). */
function benchToBenchFt(aId, bId) {
  if (aId === bId) return 0;
  const colA = aId[0], colB = bId[0], rowA = rowOf(aId), rowB = rowOf(bId);
  const gA = groupOf(colA), gB = groupOf(colB);
  const vertical = Math.abs(rowA - rowB) * BENCH_LEN_FT;
  if (gA === gB) {
    if (colA === colB) return vertical;
    if (Math.abs(rowA - rowB) <= 1) return Math.hypot(vertical, WALKWAY_WIDTH_FT);
    return vertical + WALKWAY_WIDTH_FT; // two rows apart: the middle row blocks a direct diagonal
  }
  // Different walkways: down/up your own walkway is still a straight, un-
  // diagonalizable vertical hop (cutting sideways before reaching the back
  // walkway would clip straight through whatever benches sit between the two
  // walkways). Only once you've reached the back walkway is the floor open in
  // every direction, so *that* crossing — its own depth plus however far
  // sideways to the other walkway — can be walked as one diagonal instead of
  // a straight-across-then-done line, the same reasoning as the same-walkway
  // case above, just applied to the aisle's own rectangle instead of a
  // walkway's.
  const down = (3 - rowA) * BENCH_LEN_FT;
  const up = (3 - rowB) * BENCH_LEN_FT;
  const lateral = Math.abs(COL_ORDER.indexOf(colA) - COL_ORDER.indexOf(colB)) * BENCH_WIDTH_FT;
  return down + Math.hypot(BACK_AISLE_FT, lateral) + up;
}

// Same idea as benchToBenchFt's cross-walkway case: down your own walkway
// stays a straight vertical hop, but the back-walkway crossing to line up
// with the far fixture's position is one diagonal (its own depth plus the
// lateral distance) instead of two squared-off legs.
function benchToFarFt(benchId, farId) {
  const down = (3 - rowOf(benchId)) * BENCH_LEN_FT;
  const lateral = Math.abs(COL_ORDER.indexOf(benchId[0]) * BENCH_WIDTH_FT - FAR_FEETX[farId]);
  return down + Math.hypot(BACK_AISLE_FT, lateral);
}

/* A bench can only be reached through its walkway, so every bench-to-bench route
   is: front of the start bench -> down/up its walkway -> (if the destination is
   on a different walkway) across the back walkway -> down/up the destination's
   walkway -> front of the destination bench. Two benches sharing one walkway
   (same column, or the two columns of a touching pair) skip the back-walkway
   detour entirely. Wherever a leg of that route is a single open rectangle of
   floor with nothing else in it (a shared walkway between two different
   columns, or the back walkway itself), it's walked as one diagonal line
   instead of two squared-off ones — shorter, and still never crosses a bench,
   since the whole rectangle it's cutting across is clear (see benchToBenchFt/
   benchToFarFt).

   The sharps/recycling/biohazard trio sits touching row 3, so reaching one is
   *aliased* to reaching its anchor column's row-3 bench (recycling straddles
   both B and C, so it takes whichever is closer) — no separate back-walkway
   crossing beyond what reaching that bench already costs. The sink/consumables
   pair sits genuinely beyond the back walkway, so reaching one always costs one
   crossing plus the lateral walk to line up with it; two far fixtures are both
   already past that walkway, so moving between them is pure lateral distance.

   `nearFixtures` defaults to the trio's real, current anchor (NEAR_FIXTURES) —
   the Lab Optimizer is the only caller that ever passes a different one, to
   evaluate a candidate anchor without disturbing this default. */
export function routeDistanceFt(aId, bId, nearFixtures = NEAR_FIXTURES) {
  if (aId === bId) return 0;
  if (isNearFixture(aId)) return Math.min(...nearFixtures[aId].map((c) => routeDistanceFt(`${c}3`, bId, nearFixtures)));
  if (isNearFixture(bId)) return Math.min(...nearFixtures[bId].map((c) => routeDistanceFt(aId, `${c}3`, nearFixtures)));
  if (isFarFixture(aId) && isFarFixture(bId)) return Math.abs(FAR_FEETX[aId] - FAR_FEETX[bId]);
  if (isFarFixture(aId)) return benchToFarFt(bId, aId);
  if (isFarFixture(bId)) return benchToFarFt(aId, bId);
  return benchToBenchFt(aId, bId);
}

// A full station x station distance table for an arbitrary near-fixture anchor —
// what BENCH_DIST_FT below is for the real, current anchor. Exposed so the Lab
// Optimizer can score a candidate trio placement (BC/DE/FG) without recomputing
// routeDistanceFt per pair on every search iteration.
export function buildDistTable(nearFixtures) {
  const table = {};
  for (const a of STATION_IDS) {
    table[a] = {};
    for (const b of STATION_IDS) table[a][b] = routeDistanceFt(a, b, nearFixtures);
  }
  return table;
}

// Precomputed so the protocol generator can pick a "force movement" step without
// recomputing the route per draw.
export const BENCH_DIST_FT = buildDistTable(NEAR_FIXTURES);

// One precomputed distance table per possible trio anchor — only 3, so building
// all of them up front is cheap and lets the Lab Optimizer just look one up
// instead of rebuilding a table per candidate it evaluates.
export const DIST_TABLES_BY_ANCHOR = Object.fromEntries(
  Object.keys(TOUCHING_PAIRS).map((key) => [key, key === DEFAULT_TRIO_ANCHOR ? BENCH_DIST_FT : buildDistTable(nearFixturesForAnchor(key))]),
);

// Which edge of the back-walkway rail a station naturally approaches from —
// the far row (sink/glassware/consumables/refrigerator) sits below the rail
// (front faces up into it); everything else, a bench via its own walkway or
// the trio touching row 3, sits above it (front faces down into it, or is
// already right at that boundary). This is a property of the station itself,
// not of which side of a given pair it happens to be — two stations on the
// *same* side only ever need to walk along that one edge, right where they
// already are, never detouring to the opposite edge and back (see
// toRailPoints/fromRailPoints/routeWaypoints).
const railSideY = (id) => (isFarFixture(id) ? BACK_AISLE_BOTTOM : BACK_AISLE_TOP);
// The point where a station's own approach meets the back-walkway rail, at
// its own natural edge — for a bench that's its own walkway's centerline;
// for a fixture it's directly in line with its front (the back walkway is
// the only thing on the other side).
const railPoint = (id) => (isFixtureId(id) ? { x: front(id).x, y: railSideY(id) } : { x: walkwayCenterX(groupOf(id[0])), y: railSideY(id) });

// [front(id), ...intermediate points..., that station's own rail edge] — the
// walk from a station out to the back-walkway rail.
const toRailPoints = (id) => {
  const f = front(id);
  const rp = railPoint(id);
  if (isFixtureId(id)) return [f, rp];
  return [f, { x: rp.x, y: f.y }, rp];
};
// [that station's own rail edge, ...intermediate points..., front(id)] — the
// mirror image of toRailPoints, walking in from the rail to a station, ending
// at its front — never overlapping into the station's own box.
const fromRailPoints = (id) => {
  const f = front(id);
  const rp = railPoint(id);
  if (isFixtureId(id)) return [rp, f];
  return [rp, { x: rp.x, y: f.y }, f];
};

/* Pixel waypoints for drawing the same route on the SVG map — deliberately
   decoupled from routeDistanceFt's numbers (which keep scoring the full
   walkway/aisle rectangle a diagonal can use; see benchToBenchFt/
   benchToFarFt above), because a technician doesn't actually walk hugging a
   bench's exact edge or cutting a walkway at a raw angle. Every route starts
   and ends at a station's front, never its center — never overlapping the
   station's own box.

   Two benches sharing a walkway route directly, front to front, with no
   detour through the walkway's middle first — both "front" points already
   sit exactly on the walkway's own boundary, so the straight line between
   them never re-enters either column's width, safe for every combination of
   rows and columns (verified exhaustively, for every real bench pair, in
   data.test.js). One case still bows out through the walkway's own center
   first, though: two stations in the *same* column, two rows apart (row 1
   to row 3). Front to front there is still a safe line (it runs exactly
   along that column's own boundary, never crossing into it), but it's
   indistinguishable from hugging the middle bench's wall for the entire
   span — not how a technician actually walks past it — so that one case
   detours out to the walkway's center at the middle row's height before
   heading to the destination's front, the same "step off the wall into the
   open lane" motion a same-column adjacent-row move never needed in the
   first place (see routeWaypoints below).

   Everything else — different walkways, or anything touching a fixture,
   including the trio for simplicity — routes via the back-walkway rail
   (toRailPoints/fromRailPoints), each station entering at *its own* natural
   edge (railSideY). Two stations that share a side — the entire trio with
   each other, the entire sink/glassware/consumables/refrigerator row with
   each other, or a bench with the trio (which, per routeDistanceFt, never
   really crosses the rail's depth at all) — meet at that one shared edge, so
   the crossing between them is a single straight line, not a detour to the
   opposite edge and back. Only a pair that's genuinely on opposite sides (a
   bench or the trio against the far row) draws a real diagonal, entering the
   rail at one edge and leaving from the other, which is what makes that one
   case shorter than walking the two legs separately — while staying entirely
   inside the rail's own open rectangle throughout, since it never leaves the
   [BACK_AISLE_TOP, BACK_AISLE_BOTTOM] band.

   Returns the points *after* the start (the caller already has the previous
   station's front), so consecutive legs of a multi-step path concatenate
   directly into one continuous line. */
export function routeWaypoints(aId, bId) {
  if (!isFixtureId(aId) && !isFixtureId(bId)) {
    const gA = groupOf(aId[0]), gB = groupOf(bId[0]);
    if (gA === gB) {
      const fA = front(aId), fB = front(bId);
      if (aId[0] === bId[0] && Math.abs(rowOf(aId) - rowOf(bId)) === 2) {
        const mid = { x: walkwayCenterX(gA), y: center(`${aId[0]}2`).y };
        return [fA, mid, fB];
      }
      return [fA, fB];
    }
  }
  return [...toRailPoints(aId), ...fromRailPoints(bId)];
}
