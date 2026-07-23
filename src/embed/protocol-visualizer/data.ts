/* Static lab floor geometry: the physical grid the map is drawn onto,
   independent of whatever protocol data a host application feeds in. Fixed
   at 8 columns (A-H) x 3 rows (1-3) = 24 benches, plus 8 fixed utility
   fixtures around the back wall.

   This is a trimmed port of the source app's data.js: everything needed to
   *draw* the floor and compute a route's pixel waypoints between exactly two
   stations is kept; the feet-based distance model (routeDistanceFt/
   BENCH_DIST_FT and everything only it needed — BENCH_LEN_FT/BACK_AISLE_FT/
   walkMinutesForFt/COL_ORDER/FAR_FEETX/...) and the Lab Optimizer's
   alternate-anchor support (TOUCHING_PAIRS/trioFixturesForAnchor/multiple
   near-fixture layouts) are both dropped — this component never scores a
   route in feet or renders anything but the one real, fixed floor plan. */

import type { BenchId, FixtureId, StationId, Point, Rect, FixtureRect } from "./types";

// Benches touch — there's no gap within a column (A1 touches A2 touches A3)
// or between the two columns of a touching pair (B touches C, D touches E,
// F touches G). The only open space on the floor is the 5 walkways: one
// between each of A|B, C|D, E|F, G|H, plus the back walkway past row 3. A
// bench can only be reached by walking to its front (the edge facing its
// walkway) and using that walkway — never by cutting through another bench.
const SLOT_W = 70;
const SLOT_H = 62;
const COL_X: Record<string, number> = { A: 40, B: 150, C: 220, D: 330, E: 400, F: 510, G: 580, H: 690 };
const ROW_Y: Record<number, number> = { 1: 30, 2: 30 + SLOT_H, 3: 30 + 2 * SLOT_H };

export const SLOTS = {} as Record<BenchId, Rect>;
for (const [c, x] of Object.entries(COL_X)) {
  for (const r of [1, 2, 3] as const) {
    SLOTS[(c + r) as BenchId] = { x, y: ROW_Y[r], w: SLOT_W, h: SLOT_H };
  }
}

// Each pair shares one walkway; the first column in a pair faces it on the
// right, the second faces it on the left (the pair's touching neighbor, if
// any, blocks the other side).
const WALKWAY_GROUPS = [["A", "B"], ["C", "D"], ["E", "F"], ["G", "H"]];
const groupOf = (col: string): number => WALKWAY_GROUPS.findIndex((g) => g.includes(col));
const frontSide = (col: string): "left" | "right" => (WALKWAY_GROUPS[groupOf(col)][0] === col ? "right" : "left");
const walkwayCenterX = (g: number): number => {
  const [l, r] = WALKWAY_GROUPS[g];
  return (COL_X[l] + SLOT_W + COL_X[r]) / 2;
};

/* Fixed utility fixtures — baselines that never move. The sharps bin,
   recycling bin, and biohazard box sit touching the bottom of row 3 (the end
   of columns B and C), exactly like a 4th row with nothing beyond it. The
   sink, glassware, and the two consumables stations sit in a row on the
   *far* side of the back walkway (left to right: sink, glassware,
   Consumables 1, Consumables 2), shifted right so the sink's left edge lines
   up with B3's left edge. The 4C refrigerator sits on that same far side,
   off on its own past the last column. Real dimensions (feet) are kept as
   "length" (top-to-bottom, facing the wall) x "width" (left-to-right),
   scaled up for map legibility since a couple of feet would otherwise round
   to an unreadable box. */
export const FIXTURE_PX_PER_FT = 16;
const FIXTURE_GAP = 12;
const box = (lengthFt: number, widthFt: number) => ({ w: Math.round(widthFt * FIXTURE_PX_PER_FT), h: Math.round(lengthFt * FIXTURE_PX_PER_FT) });

const sharpsBox = box(2, 1);
const recycleBox = box(1.5, 3);
const wasteBox = box(2, 2);
const sinkBox = box(2.5, 5);
const glasswareBox = box(2.25, 4);
const consum1Box = box(2.25, 4);
const consum2Box = box(2.25, 4);
const refrigeratorBox = box(2.5, 5);

// The trio's top edge touches row 3's bottom edge directly (no gap), chained
// left to right and centered on the B-C boundary — the floor's one real,
// fixed anchor (the Lab Optimizer's alternate anchors aren't relevant here).
const TRIO_TOP_Y = ROW_Y[3] + SLOT_H;
const trioWidth = sharpsBox.w + FIXTURE_GAP + recycleBox.w + FIXTURE_GAP + wasteBox.w;
const trioMidX = (COL_X.B + SLOT_W / 2 + COL_X.C + SLOT_W / 2) / 2;
const sharpsX = trioMidX - trioWidth / 2;
const recycleX = sharpsX + sharpsBox.w + FIXTURE_GAP;
const wasteX = recycleX + recycleBox.w + FIXTURE_GAP;

// The back walkway starts right where the trio ends (so the trio sits flush
// between row 3 above and the walkway below) and runs the full width of the
// floor, connecting all 4 vertical walkways into one continuous strip.
const BACK_AISLE_Y = TRIO_TOP_Y + Math.max(sharpsBox.h, recycleBox.h, wasteBox.h) + 17;
const BACK_AISLE_H = 34;
const BACK_AISLE_TOP = BACK_AISLE_Y - BACK_AISLE_H / 2;
const BACK_AISLE_BOTTOM = BACK_AISLE_Y + BACK_AISLE_H / 2;

// The sink/glassware/Consumables-1/Consumables-2 row sits below the back
// walkway (the far side from the trio), shifted right so the sink's left
// edge lines up with B3's left edge — directly across the walkway from the
// sharps/recycling/biohazard group, but offset from it rather than centered
// on the same boundary.
const FAR_TOP_Y = BACK_AISLE_BOTTOM + 22; // headroom for the ID label above the box
const sinkX = COL_X.B;
const glasswareX = sinkX + sinkBox.w + FIXTURE_GAP;
const consum1X = glasswareX + glasswareBox.w + FIXTURE_GAP;
const consum2X = consum1X + consum1Box.w + FIXTURE_GAP;

// The refrigerator sits on the same far side, off past the last column — 5ft
// to the right of H3, across the walkway from it.
const refrigeratorX = COL_X.H + SLOT_W + 5 * FIXTURE_PX_PER_FT;

export const FIXTURES: Record<FixtureId, FixtureRect> = {
  SHARPS: { name: "Sharps Bin", x: sharpsX, y: TRIO_TOP_Y, w: sharpsBox.w, h: sharpsBox.h },
  RECYCLE: { name: "Recycling Bin", x: recycleX, y: TRIO_TOP_Y, w: recycleBox.w, h: recycleBox.h },
  WASTE: { name: "Biohazard Waste", x: wasteX, y: TRIO_TOP_Y, w: wasteBox.w, h: wasteBox.h },
  SINK: { name: "Sink", x: sinkX, y: FAR_TOP_Y, w: sinkBox.w, h: sinkBox.h },
  GLASSWARE: { name: "Glassware", x: glasswareX, y: FAR_TOP_Y, w: glasswareBox.w, h: glasswareBox.h },
  CONSUM1: { name: "Consumables 1", x: consum1X, y: FAR_TOP_Y, w: consum1Box.w, h: consum1Box.h },
  CONSUM2: { name: "Consumables 2", x: consum2X, y: FAR_TOP_Y, w: consum2Box.w, h: consum2Box.h },
  REFRIGERATOR: { name: "4C Refrigerator", x: refrigeratorX, y: FAR_TOP_Y, w: refrigeratorBox.w, h: refrigeratorBox.h },
};

// The trio (touching row 3) sits above the back-walkway rail; the far row
// (sink/glassware/consumables/refrigerator) sits below it. Nothing here
// scores a route in feet — only which "side" a station approaches the rail
// from matters for drawing (see railSideY/railPoint below).
const NEAR_FIXTURE_IDS = new Set<FixtureId>(["SHARPS", "RECYCLE", "WASTE"]);
const FAR_FIXTURE_IDS = new Set<FixtureId>(["SINK", "GLASSWARE", "CONSUM1", "CONSUM2", "REFRIGERATOR"]);
// Deliberately not `id is FixtureId` type predicates — each only covers a
// *subset* of FixtureId, and TypeScript would narrow the non-matching branch
// down to `never` rather than "the other subset." Callers cast explicitly
// (`FIXTURES[id as FixtureId]`) wherever they need the narrower type; only
// `isFixtureId` below (near ∪ far = the *entire* FixtureId union) is safe to
// express as a real predicate.
export const isNearFixture = (id: StationId): boolean => NEAR_FIXTURE_IDS.has(id as FixtureId);
const isFarFixture = (id: StationId): boolean => FAR_FIXTURE_IDS.has(id as FixtureId);
export const isFixtureId = (id: StationId): id is FixtureId => isNearFixture(id) || isFarFixture(id);

// Vertical walkway rectangles extended down to meet the back walkway with no
// gap, plus the back walkway itself — together they render as one
// continuous shaded region (a comb shape) rather than 5 separate boxes.
const WALKWAYS = WALKWAY_GROUPS.map(([l, r]) => ({
  x: COL_X[l] + SLOT_W,
  width: COL_X[r] - (COL_X[l] + SLOT_W),
  y: ROW_Y[1],
  height: BACK_AISLE_TOP - ROW_Y[1],
}));
const FLOOR_X = 20;
const floorRightEdge = refrigeratorX + refrigeratorBox.w + FLOOR_X;
const BACK_AISLE = { x: FLOOR_X, width: floorRightEdge - FLOOR_X };

// A single outline tracing the 4 prongs + the back-aisle bar as one
// comb-shaped polygon, so the map can fill/stroke it as one continuous
// region instead of 5 separate rectangles with visible seams between them.
export const WALKWAY_PATH: string = (() => {
  const pts: [number, number][] = [[BACK_AISLE.x, BACK_AISLE_TOP]];
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
const CENTER_CACHE = {} as Record<StationId, Point>;
for (const id of Object.keys(SLOTS) as BenchId[]) {
  const r = SLOTS[id];
  CENTER_CACHE[id] = { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}
for (const id of Object.keys(FIXTURES) as FixtureId[]) {
  const r = FIXTURES[id];
  CENTER_CACHE[id] = { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}
export const center = (id: StationId): Point => CENTER_CACHE[id];

// The point on a station's edge that actually opens onto its walkway —
// every route starts and ends here, never overlapping into the station's
// own box. A bench's front faces its walkway; the trio's front is its
// bottom edge (facing the back walkway below it); the far pair's front is
// its top edge (facing the back walkway above it).
export function front(id: StationId): Point {
  if (isNearFixture(id)) {
    const f = FIXTURES[id as FixtureId];
    return { x: f.x + f.w / 2, y: f.y + f.h };
  }
  if (isFarFixture(id)) {
    const f = FIXTURES[id as FixtureId];
    return { x: f.x + f.w / 2, y: f.y };
  }
  const r = SLOTS[id as BenchId];
  const c = center(id);
  return frontSide((id as BenchId)[0]) === "right" ? { x: r.x + r.w, y: c.y } : { x: r.x, y: c.y };
}

export const STATION_IDS: StationId[] = [...(Object.keys(SLOTS) as BenchId[]), ...(Object.keys(FIXTURES) as FixtureId[])];

// Every bench has a fixed, hardcoded name — the physical lab's real station
// names, not something a host application supplies. Row 1 is nearest the
// front of the room, row 3 nearest the back wall/fixtures; columns run A-H
// left to right.
export const BENCH_NAMES: Record<BenchId, string> = {
  A1: "Opentrons", B1: "Dry Chemical Weighing", C1: "NanoDrop", D1: "DNA/RNA Prep",
  E1: "Microbial Culture Prep", F1: "Microbial Culture Processing", G1: "Research", H1: "Small Equipment",
  A2: "Automation Prep 1", B2: "Dry Chemical Prep", C2: "Gel Electrophoresis", D2: "DNA Prep",
  E2: "Microbial Incubators", F2: "GC-MS 1", G2: "Imaging", H2: "Transfyr",
  A3: "Hamilton", B3: "Automation Prep 2", C3: "Gel Imaging", D3: "PCR",
  E3: "Cell Culture Plate Reader", F3: "GC-MS 2", G3: "Vacuum Oven", H3: "Prototyping",
};

// Every station (bench or fixture) has exactly one fixed name.
export const STATION_NAME: Record<StationId, string> = { ...BENCH_NAMES } as Record<StationId, string>;
for (const [id, f] of Object.entries(FIXTURES)) STATION_NAME[id as FixtureId] = f.name;

// Reverse lookup — a station name back to its internal id, case-insensitive.
export const NAME_TO_STATION_ID: Record<string, StationId> = {};
for (const [id, name] of Object.entries(STATION_NAME)) NAME_TO_STATION_ID[name.toLowerCase()] = id as StationId;

const rowOf = (id: BenchId): number => Number(id[1]);

// Which edge of the back-walkway rail a station naturally approaches from —
// the far row sits below the rail (front faces up into it); everything
// else (a bench via its own walkway, or the trio touching row 3) sits above
// it. This is a property of the station itself, not of which side of a
// given pair it happens to be — two stations on the *same* side only ever
// need to walk along that one edge, right where they already are, never
// detouring to the opposite edge and back.
const railSideY = (id: StationId): number => (isFarFixture(id) ? BACK_AISLE_BOTTOM : BACK_AISLE_TOP);

// The point where a station's own approach meets the back-walkway rail, at
// its own natural edge — for a bench that's its own walkway's centerline;
// for a fixture it's directly in line with its front (the back walkway is
// the only thing on the other side).
const railPoint = (id: StationId): Point =>
  isFixtureId(id) ? { x: front(id).x, y: railSideY(id) } : { x: walkwayCenterX(groupOf((id as BenchId)[0])), y: railSideY(id) };

// [front(id), ...intermediate points..., that station's own rail edge] — the
// walk from a station out to the back-walkway rail.
function toRailPoints(id: StationId): Point[] {
  const f = front(id);
  const rp = railPoint(id);
  if (isFixtureId(id)) return [f, rp];
  return [f, { x: rp.x, y: f.y }, rp];
}
// [that station's own rail edge, ...intermediate points..., front(id)] — the
// mirror image of toRailPoints, walking in from the rail to a station,
// ending at its front — never overlapping into the station's own box.
function fromRailPoints(id: StationId): Point[] {
  const f = front(id);
  const rp = railPoint(id);
  if (isFixtureId(id)) return [rp, f];
  return [rp, { x: rp.x, y: f.y }, f];
}

/* Pixel waypoints for drawing a route between exactly two stations on the
   SVG map. Two benches sharing a walkway route directly, front to front,
   with no detour through the walkway's middle first. One case still bows
   out through the walkway's own center first, though: two stations in the
   *same* column, two rows apart (row 1 to row 3) — front to front there
   would run exactly along that column's own boundary the entire span, which
   reads as hugging the middle bench's wall rather than actually walking
   past it, so that one case detours out to the walkway's center at the
   middle row's height before heading to the destination's front.

   Everything else — different walkways, or anything touching a fixture,
   including the trio — routes via the back-walkway rail (toRailPoints/
   fromRailPoints), each station entering at *its own* natural edge
   (railSideY).

   Returns the points *after* the start (the caller already has the
   previous station's front), matching the source app's own convention so a
   multi-leg path there concatenates directly — this map only ever draws one
   leg (current station to next station), but the function is left exactly
   as composable. */
export function routeWaypoints(aId: StationId, bId: StationId): Point[] {
  if (!isFixtureId(aId) && !isFixtureId(bId)) {
    const gA = groupOf((aId as BenchId)[0]);
    const gB = groupOf((bId as BenchId)[0]);
    if (gA === gB) {
      const fA = front(aId);
      const fB = front(bId);
      if ((aId as BenchId)[0] === (bId as BenchId)[0] && Math.abs(rowOf(aId as BenchId) - rowOf(bId as BenchId)) === 2) {
        const mid = { x: walkwayCenterX(gA), y: center(`${(aId as BenchId)[0]}2` as BenchId).y };
        return [fA, mid, fB];
      }
      return [fA, fB];
    }
  }
  return [...toRailPoints(aId), ...fromRailPoints(bId)];
}
