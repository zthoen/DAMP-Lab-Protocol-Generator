/* Static lab floor geometry: the physical grid every station map is drawn onto,
   independent of whatever equipment/station table a user loads. Fixed at 8 columns
   (A-H) x 3 rows (1-3) = 24 benches, plus 5 fixed utility fixtures around the back
   wall (waste/sharps/recycling/sink/consumables — see FIXTURES below). Storage
   aisles from the original sim are otherwise out of scope for now. */

// Real-world reference measurements the protocol generator's "distance walked" is
// built from (see routeDistanceFt below) — approximate, as given by the lab:
// benches are ~7ft long (front-to-back) and ~3ft wide (side-to-side), walkways
// are ~6ft wide, and the walkway past row 3 is ~5ft wide.
export const BENCH_LEN_FT = 7;
export const BENCH_WIDTH_FT = 3;
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
   and C), exactly like a 4th row with nothing beyond it. The sink and
   consumables storage sit on the *far* side of the back walkway, directly across
   from that trio. Real dimensions (feet) are kept as "length" (the top-to-bottom
   extent, facing the wall) x "width" (the left-to-right extent), scaled up for
   map legibility since a couple of feet would otherwise round to an unreadable
   box. */
const FIXTURE_PX_PER_FT = 16;
const FIXTURE_GAP = 12;
const box = (lengthFt, widthFt) => ({ w: Math.round(widthFt * FIXTURE_PX_PER_FT), h: Math.round(lengthFt * FIXTURE_PX_PER_FT) });

const sharpsBox = box(2, 1), recycleBox = box(1.5, 3), wasteBox = box(2, 2);
const sinkBox = box(2, 4), consumBox = box(2, 6); // consumables widened +2ft over the sink's width

// The trio's top edge touches row 3's bottom edge directly (no gap), chained
// left to right and centered on the B-C walkway boundary they straddle.
const TRIO_TOP_Y = ROW_Y[3] + SLOT_H;
const trioWidth = sharpsBox.w + FIXTURE_GAP + recycleBox.w + FIXTURE_GAP + wasteBox.w;
const midBC = (COL_X.B + SLOT_W / 2 + COL_X.C + SLOT_W / 2) / 2;
const sharpsX = midBC - trioWidth / 2;
const recycleX = sharpsX + sharpsBox.w + FIXTURE_GAP;
const wasteX = recycleX + recycleBox.w + FIXTURE_GAP;

// The back walkway starts right where the trio ends (so the trio sits flush
// between row 3 above and the walkway below) and runs the full width of the
// floor, connecting all 4 vertical walkways into one continuous strip.
export const BACK_AISLE_Y = TRIO_TOP_Y + Math.max(sharpsBox.h, recycleBox.h, wasteBox.h) + 17;
export const BACK_AISLE_H = 34;
const BACK_AISLE_TOP = BACK_AISLE_Y - BACK_AISLE_H / 2;
const BACK_AISLE_BOTTOM = BACK_AISLE_Y + BACK_AISLE_H / 2;

// The sink/consumables pair sits below the back walkway (the far side from the
// trio), moved left so it's centered on the same B-C boundary — directly across
// the walkway from the sharps/recycling/biohazard group.
const FAR_TOP_Y = BACK_AISLE_BOTTOM + 22; // headroom for the ID label above the box
const farWidth = sinkBox.w + FIXTURE_GAP + consumBox.w;
const sinkX = midBC - farWidth / 2;
const consumX = sinkX + sinkBox.w + FIXTURE_GAP;

export const FIXTURES = {
  SHARPS: { name: "Sharps Bin", x: sharpsX, y: TRIO_TOP_Y, w: sharpsBox.w, h: sharpsBox.h },
  RECYCLE: { name: "Recycling Bin", x: recycleX, y: TRIO_TOP_Y, w: recycleBox.w, h: recycleBox.h },
  WASTE: { name: "Biohazard Waste", x: wasteX, y: TRIO_TOP_Y, w: wasteBox.w, h: wasteBox.h },
  SINK: { name: "Sink", x: sinkX, y: FAR_TOP_Y, w: sinkBox.w, h: sinkBox.h },
  CONSUM: { name: "Consumables Storage", x: consumX, y: FAR_TOP_Y, w: consumBox.w, h: consumBox.h },
};

// Each fixture is also a piece of equipment in its own right, permanently
// "installed" at its own location — retrieving from consumables or disposing
// of waste is itself a protocol step, not just a destination. labTable.js adds
// these to every parsed table's equipToStations/stationEquip unconditionally,
// regardless of what the pasted data says, since they're baseline lab fixtures
// that are always physically present.
export const FIXTURE_EQUIPMENT = {
  SHARPS: "Sharps",
  RECYCLE: "Recycle",
  WASTE: "Biohazardous Waste",
  SINK: "Sink",
  CONSUM: "Consumables",
};

// The trio (touching row 3, reached via whichever of B's or C's own walkway is
// closer — never a separate back-walkway crossing) vs. the far pair (genuinely
// beyond the back walkway, like the fixtures in the previous layout).
const NEAR_FIXTURES = { SHARPS: ["B"], WASTE: ["C"], RECYCLE: ["B", "C"] };
const FAR_FEETX = { SINK: 4, CONSUM: 8 };
const isNearFixture = (id) => Object.prototype.hasOwnProperty.call(NEAR_FIXTURES, id);
const isFarFixture = (id) => Object.prototype.hasOwnProperty.call(FAR_FEETX, id);
export const isFixtureId = (id) => isNearFixture(id) || isFarFixture(id);
// Exposed so the map can label the trio below its box (it touches row 3 above,
// with no room for a label there) and the far pair above (which does have room).
export { isNearFixture };

// Vertical walkway rectangles extended down to meet the back walkway with no
// gap, plus the back walkway itself — together they render as one continuous
// shaded region (a comb shape) rather than 5 separate boxes.
export const WALKWAYS = WALKWAY_GROUPS.map(([l, r]) => ({
  x: COL_X[l] + SLOT_W,
  width: COL_X[r] - (COL_X[l] + SLOT_W),
  y: ROW_Y[1],
  height: BACK_AISLE_TOP - ROW_Y[1],
}));
export const BACK_AISLE = { x: 20, y: BACK_AISLE_TOP, width: 760, height: BACK_AISLE_H };

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
// route starts and ends here, never at a raw straight line between two centers.
// A bench's front faces its walkway; the trio's front is its bottom edge (facing
// the back walkway below it); the far pair's front is its top edge (facing the
// back walkway above it).
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

const rowOf = (id) => Number(id[1]);

function benchToBenchFt(aId, bId) {
  if (aId === bId) return 0;
  const colA = aId[0], colB = bId[0], rowA = rowOf(aId), rowB = rowOf(bId);
  const gA = groupOf(colA), gB = groupOf(colB);
  if (gA === gB) {
    const vertical = Math.abs(rowA - rowB) * BENCH_LEN_FT;
    const lateral = colA === colB ? 0 : WALKWAY_WIDTH_FT;
    return vertical + lateral;
  }
  const down = (3 - rowA) * BENCH_LEN_FT;
  const up = (3 - rowB) * BENCH_LEN_FT;
  const lateral = Math.abs(COL_ORDER.indexOf(colA) - COL_ORDER.indexOf(colB)) * BENCH_WIDTH_FT;
  return down + BACK_AISLE_FT + lateral + up;
}

function benchToFarFt(benchId, farId) {
  const down = (3 - rowOf(benchId)) * BENCH_LEN_FT;
  const lateral = Math.abs(COL_ORDER.indexOf(benchId[0]) * BENCH_WIDTH_FT - FAR_FEETX[farId]);
  return down + BACK_AISLE_FT + lateral;
}

/* A bench can only be reached through its walkway, so every bench-to-bench route
   is: front of the start bench -> down/up its walkway -> (if the destination is
   on a different walkway) across the back walkway -> down/up the destination's
   walkway -> front of the destination bench. Two benches sharing one walkway
   (same column, or the two columns of a touching pair) skip the back-walkway
   detour entirely.

   The sharps/recycling/biohazard trio sits touching row 3, so reaching one is
   *aliased* to reaching its anchor column's row-3 bench (recycling straddles
   both B and C, so it takes whichever is closer) — no separate back-walkway
   crossing beyond what reaching that bench already costs. The sink/consumables
   pair sits genuinely beyond the back walkway, so reaching one always costs one
   crossing plus the lateral walk to line up with it; two far fixtures are both
   already past that walkway, so moving between them is pure lateral distance. */
export function routeDistanceFt(aId, bId) {
  if (aId === bId) return 0;
  if (isNearFixture(aId)) return Math.min(...NEAR_FIXTURES[aId].map((c) => routeDistanceFt(`${c}3`, bId)));
  if (isNearFixture(bId)) return Math.min(...NEAR_FIXTURES[bId].map((c) => routeDistanceFt(aId, `${c}3`)));
  if (isFarFixture(aId) && isFarFixture(bId)) return Math.abs(FAR_FEETX[aId] - FAR_FEETX[bId]);
  if (isFarFixture(aId)) return benchToFarFt(bId, aId);
  if (isFarFixture(bId)) return benchToFarFt(aId, bId);
  return benchToBenchFt(aId, bId);
}

// Precomputed so the protocol generator can pick a "force movement" step without
// recomputing the route per draw.
export const BENCH_DIST_FT = {};
for (const a of STATION_IDS) {
  BENCH_DIST_FT[a] = {};
  for (const b of STATION_IDS) BENCH_DIST_FT[a][b] = routeDistanceFt(a, b);
}

// The point on the back-walkway travel line aligned with a station's x — for a
// bench that's its own walkway's centerline; for a fixture it's directly in
// line with its front (the back walkway is the only thing on the other side).
const railPoint = (id) => (isFixtureId(id) ? { x: front(id).x, y: BACK_AISLE_Y } : { x: walkwayCenterX(groupOf(id[0])), y: BACK_AISLE_Y });

// [front(id), ...intermediate points..., railPoint(id)] — the walk from a station
// out to the back-walkway rail.
const toRailPoints = (id) => {
  const f = front(id);
  if (isFixtureId(id)) return [f, railPoint(id)];
  return [f, { x: railPoint(id).x, y: f.y }, railPoint(id)];
};
// [railPoint(id), ...intermediate points..., front(id), center(id)] — the mirror
// image of toRailPoints, walking from the rail in to a station.
const fromRailPoints = (id) => {
  const f = front(id), c = center(id);
  if (isFixtureId(id)) return [railPoint(id), f, c];
  return [railPoint(id), { x: railPoint(id).x, y: f.y }, f, c];
};

/* Pixel waypoints for drawing the same route on the SVG map. Bench-to-bench
   mirrors routeDistanceFt's same-walkway/cross-walkway shapes exactly. Anything
   touching a fixture routes via the back-walkway rail — including the trio, for
   simplicity: even though reaching (say) B3 from SHARPS is numerically a
   same-column reach in feet, the drawn path still shows it crossing the rail,
   which stays visually consistent with every other fixture-involving route
   rather than special-casing one more shape. Returns the points *after* the
   start (the caller already has the previous station's center), so consecutive
   legs of a multi-step path concatenate directly into one continuous line. */
export function routeWaypoints(aId, bId) {
  const aFix = isFixtureId(aId), bFix = isFixtureId(bId);

  if (!aFix && !bFix) {
    const fA = front(aId), fB = front(bId), cB = center(bId);
    const gA = groupOf(aId[0]), gB = groupOf(bId[0]);
    if (gA === gB) {
      const wx = walkwayCenterX(gA);
      return [fA, { x: wx, y: fA.y }, { x: wx, y: fB.y }, fB, cB];
    }
    const wxA = walkwayCenterX(gA), wxB = walkwayCenterX(gB);
    return [
      fA, { x: wxA, y: fA.y }, { x: wxA, y: BACK_AISLE_Y },
      { x: wxB, y: BACK_AISLE_Y }, { x: wxB, y: fB.y }, fB, cB,
    ];
  }

  // At least one endpoint is a fixture: always route via the back-walkway rail —
  // toRailPoints(aId) ends exactly where fromRailPoints(bId) begins (both at
  // railPoint), so concatenating them traces the lateral rail segment for free.
  return [...toRailPoints(aId), ...fromRailPoints(bId)];
}
