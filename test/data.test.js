import test from "node:test";
import assert from "node:assert/strict";
import {
  routeDistanceFt, routeWaypoints, BENCH_DIST_FT, STATION_IDS, STATION_NAME, NAME_TO_STATION_ID, center, front, FIXTURES,
  WALKWAY_WIDTH_FT, BACK_AISLE_FT, BENCH_LEN_FT, BENCH_WIDTH_FT, SLOTS, isFixtureId,
  TOUCHING_PAIRS, DEFAULT_TRIO_ANCHOR, nearFixturesForAnchor, trioFixturesForAnchor, buildDistTable, DIST_TABLES_BY_ANCHOR,
} from "../src/data.js";

// Liang-Barsky segment/AABB clipping — true only for a real, nonzero-length
// crossing through `rect`'s interior, not a segment that merely touches a
// corner or edge. Used below to independently prove the diagonal routes never
// cut through a bench that isn't one of the route's own two endpoints. The
// rect is shrunk inward by a hair first — a front-to-front route legitimately
// runs exactly along a bench's own edge (e.g. two same-column stations share
// that column's boundary with its walkway the whole way), which is walking
// the walkway's own open edge, not entering the bench, so it shouldn't count.
function segmentCrossesRect(p0, p1, rect) {
  const EPS = 0.5;
  const rx = rect.x + EPS, ry = rect.y + EPS, rw = rect.w - 2 * EPS, rh = rect.h - 2 * EPS;
  const dx = p1.x - p0.x, dy = p1.y - p0.y;
  let tmin = 0, tmax = 1;
  const clip = (p, q) => {
    if (p === 0) return q >= 0;
    const r = q / p;
    if (p < 0) { if (r > tmax) return false; if (r > tmin) tmin = r; }
    else { if (r < tmin) return false; if (r < tmax) tmax = r; }
    return true;
  };
  if (!clip(-dx, p0.x - rx)) return false;
  if (!clip(dx, rx + rw - p0.x)) return false;
  if (!clip(-dy, p0.y - ry)) return false;
  if (!clip(dy, ry + rh - p0.y)) return false;
  return tmin < tmax;
}

test("same station is zero distance", () => {
  assert.equal(routeDistanceFt("A1", "A1"), 0);
});

test("same-column moves cross bench lengths within their shared walkway, no back-aisle detour", () => {
  assert.equal(routeDistanceFt("A1", "A2"), BENCH_LEN_FT);
  assert.equal(routeDistanceFt("A1", "A3"), 2 * BENCH_LEN_FT);
  assert.equal(routeDistanceFt("A3", "A1"), 2 * BENCH_LEN_FT); // symmetric
});

test("columns sharing one walkway (A-B) cross it directly, no back-aisle detour", () => {
  // Same row: just the walkway width (no vertical component to diagonalize).
  assert.equal(routeDistanceFt("A1", "B1"), WALKWAY_WIDTH_FT);
  // Adjacent row: the bench-length drop and the walkway-width crossing are
  // walked as one diagonal (the whole walkway between them is open floor),
  // which is shorter than doing the two legs separately.
  assert.equal(routeDistanceFt("A1", "B2"), Math.hypot(BENCH_LEN_FT, WALKWAY_WIDTH_FT));
  // Two rows apart (row 1 to row 3): B2 sits directly in the way of a direct
  // line regardless of which side of the walkway it's on, so this one case
  // keeps the old squared-off route instead of a diagonal.
  assert.equal(routeDistanceFt("A1", "B3"), 2 * BENCH_LEN_FT + WALKWAY_WIDTH_FT);
});

test("a touching pair (B-C) can't cut through each other — still routes via the back aisle", () => {
  // B and C touch directly but don't share a walkway (B's walkway is A-B, C's is C-D),
  // so B1 -> C1 has to detour: down to B3, diagonally across the back aisle (one
  // bench-width apart), up to C1. Down/up stay pure vertical (a third column's
  // benches would otherwise get cut through), but the aisle crossing itself is a
  // diagonal, same as the shared-walkway case above.
  const expected = 2 * BENCH_LEN_FT + Math.hypot(BACK_AISLE_FT, BENCH_WIDTH_FT) + 2 * BENCH_LEN_FT;
  assert.equal(routeDistanceFt("B1", "C1"), expected);
});

test("different walkway groups route down, diagonally across the back aisle (by bench width), and up", () => {
  // A (group AB) -> D (group CD): down 2 rows, diagonally across 3 bench-widths
  // (columns A,B,C,D are indices 0..3 apart) plus the aisle's own depth, up 2 rows.
  const expected = 2 * BENCH_LEN_FT + Math.hypot(BACK_AISLE_FT, 3 * BENCH_WIDTH_FT) + 2 * BENCH_LEN_FT;
  assert.equal(routeDistanceFt("A1", "D1"), expected);
});

test("row-3-to-row-3 cross-group move still pays the back-aisle crossing once", () => {
  assert.equal(routeDistanceFt("A3", "H3"), Math.hypot(BACK_AISLE_FT, 7 * BENCH_WIDTH_FT));
});

// --- Diagonal walking paths ---

test("a same-walkway diagonal is strictly shorter than the old squared-off route would have been", () => {
  const vertical = BENCH_LEN_FT;
  const squaredOff = vertical + WALKWAY_WIDTH_FT;
  assert.ok(routeDistanceFt("A1", "B2") < squaredOff, "diagonal should beat the old vertical-then-lateral sum");
});

test("a cross-walkway back-aisle crossing is strictly shorter than the old squared-off route would have been", () => {
  const down = 2 * BENCH_LEN_FT, up = 2 * BENCH_LEN_FT, lateral = 3 * BENCH_WIDTH_FT;
  const squaredOff = down + BACK_AISLE_FT + lateral + up;
  assert.ok(routeDistanceFt("A1", "D1") < squaredOff, "diagonal aisle crossing should beat the old sum");
});

test("a same-column move never gets a diagonal shortcut — a bench sits directly between non-adjacent rows", () => {
  // A2 physically blocks any straight line from A1 to A3, so this has to stay
  // the full vertical distance, not some shorter diagonal.
  assert.equal(routeDistanceFt("A1", "A3"), 2 * BENCH_LEN_FT);
});

test("a same-walkway pair two rows apart never gets a diagonal shortcut either — the middle row blocks it on both sides", () => {
  assert.equal(routeDistanceFt("A1", "B3"), 2 * BENCH_LEN_FT + WALKWAY_WIDTH_FT);
  assert.equal(routeDistanceFt("B3", "A1"), 2 * BENCH_LEN_FT + WALKWAY_WIDTH_FT); // symmetric
});

test("routeWaypoints starts and ends every same-walkway route at the two stations' fronts, never their centers", () => {
  for (const [aId, bId] of [["A1", "B2"], ["A1", "B3"], ["A1", "A3"], ["A1", "B1"]]) {
    const pts = routeWaypoints(aId, bId);
    assert.deepEqual(pts[0], front(aId), `${aId} -> ${bId} should start at ${aId}'s front`);
    assert.deepEqual(pts[pts.length - 1], front(bId), `${aId} -> ${bId} should end at ${bId}'s front`);
    assert.notDeepEqual(pts[pts.length - 1], center(bId), `${aId} -> ${bId} shouldn't overlap into ${bId}'s box`);
  }
});

test("routeWaypoints routes a same-walkway pair directly front to front, no detour through the walkway's middle", () => {
  // Just the two fronts — no intermediate lane-entry/exit points.
  const pts = routeWaypoints("A1", "B2");
  assert.deepEqual(pts, [front("A1"), front("B2")]);
});

test("routeWaypoints keeps a same-column adjacent-row move a direct line between the two fronts", () => {
  const pts = routeWaypoints("A1", "A2");
  assert.deepEqual(pts, [front("A1"), front("A2")]);
  assert.equal(pts[0].x, pts[1].x);
});

test("routeWaypoints bows a same-column two-rows-apart move out to the walkway's center first", () => {
  const pts = routeWaypoints("A1", "A3");
  assert.equal(pts.length, 3, "front -> walkway-center waypoint -> front");
  assert.deepEqual(pts[0], front("A1"));
  assert.deepEqual(pts[2], front("A3"));
  const mid = pts[1];
  assert.notEqual(mid.x, front("A1").x, "should step off the column's own edge, not hug it the whole way");
  assert.equal(mid.y, center("A2").y, "should pass through the middle row's own height");
  // Symmetric: the same detour applies walking the other direction too.
  const reversePts = routeWaypoints("A3", "A1");
  assert.equal(reversePts.length, 3);
  assert.equal(reversePts[1].x, mid.x);
});

test("every same-walkway route (any two columns, any two rows) avoids every other bench's box", () => {
  // Front-to-front, funneled through the lane, is safe for every combination
  // — including two rows apart, which a raw center-to-center diagonal is not
  // (see the routing model's own comments) — because the whole line from one
  // front to the other never re-enters either column's width.
  const WALKWAY_GROUPS = [["A", "B"], ["C", "D"], ["E", "F"], ["G", "H"]];
  const groupOf = (col) => WALKWAY_GROUPS.findIndex((g) => g.includes(col));

  for (const aId of Object.keys(SLOTS)) {
    for (const bId of Object.keys(SLOTS)) {
      if (aId === bId || groupOf(aId[0]) !== groupOf(bId[0])) continue; // different walkways route via the back aisle instead
      const pts = routeWaypoints(aId, bId);
      for (let i = 1; i < pts.length; i++) {
        const segment = [pts[i - 1], pts[i]];
        for (const [otherId, rect] of Object.entries(SLOTS)) {
          if (otherId === aId || otherId === bId) continue;
          assert.ok(
            !segmentCrossesRect(segment[0], segment[1], rect),
            `${aId} -> ${bId} leg ${i} cuts through ${otherId}`,
          );
        }
      }
    }
  }
});

test("BENCH_DIST_FT lookup matches routeDistanceFt for every pair", () => {
  const ids = Object.keys(BENCH_DIST_FT);
  for (const a of ids) for (const b of ids) assert.equal(BENCH_DIST_FT[a][b], routeDistanceFt(a, b));
});

test("the 8 fixtures are valid stations alongside the 24 benches", () => {
  assert.equal(STATION_IDS.length, 32);
  for (const id of ["SHARPS", "RECYCLE", "WASTE", "SINK", "GLASSWARE", "CONSUM1", "CONSUM2", "REFRIGERATOR"]) {
    assert.ok(STATION_IDS.includes(id));
  }
});

test("every station has a fixed name, and every name resolves back to its station", () => {
  assert.equal(Object.keys(STATION_NAME).length, STATION_IDS.length);
  for (const id of STATION_IDS) {
    assert.ok(STATION_NAME[id], `${id} has no name`);
    assert.equal(NAME_TO_STATION_ID[STATION_NAME[id].toLowerCase()], id);
  }
});

test("station names match the hardcoded row/column layout", () => {
  assert.equal(STATION_NAME.A1, "Opentrons");
  assert.equal(STATION_NAME.H1, "Small Equipment");
  assert.equal(STATION_NAME.A3, "Hamilton");
  assert.equal(STATION_NAME.D3, "PCR");
  assert.equal(STATION_NAME.H3, "Prototyping");
});

test("the sharps/recycling/biohazard trio is aliased to its anchor column's row-3 bench", () => {
  // Touching row 3 directly means reaching one from its own anchor column's row 3
  // bench is free, and from elsewhere in that column is the normal same-column hop.
  assert.equal(routeDistanceFt("B3", "SHARPS"), 0);
  assert.equal(routeDistanceFt("B1", "SHARPS"), 2 * BENCH_LEN_FT);
  assert.equal(routeDistanceFt("C3", "WASTE"), 0);
  // From a different walkway group it's exactly like reaching the anchor's row 3.
  assert.equal(routeDistanceFt("A1", "SHARPS"), routeDistanceFt("A1", "B3"));
  assert.equal(routeDistanceFt("D1", "SHARPS"), routeDistanceFt("D1", "B3"));
  // Recycling straddles both B and C — reachable via whichever is closer.
  assert.equal(routeDistanceFt("B1", "RECYCLE"), Math.min(routeDistanceFt("B1", "B3"), routeDistanceFt("B1", "C3")));
});

test("two trio members resolve through their two anchor columns", () => {
  // SHARPS (anchor B) <-> WASTE (anchor C) is exactly a B3<->C3 trip.
  assert.equal(routeDistanceFt("SHARPS", "WASTE"), routeDistanceFt("B3", "C3"));
});

test("the sink/consumables pair sits beyond the back walkway — pure lateral between them", () => {
  const d = routeDistanceFt("SINK", "CONSUM2");
  assert.ok(d > 0);
  assert.equal(routeDistanceFt("SINK", "SINK"), 0);
});

test("reaching the far pair from a bench always crosses the back aisle once", () => {
  const fromRow1 = routeDistanceFt("A1", "SINK");
  const fromRow3 = routeDistanceFt("C3", "SINK");
  assert.ok(fromRow1 > fromRow3, "row 1 should be farther from the back aisle than row 3");
});

test("the trio and the far pair are on opposite sides of the same walkway", () => {
  // Going from a trio member to a far fixture still has to cross the back aisle,
  // same as bench-to-far, but skips the "down to row 3" portion since the trio is
  // already sitting right at that boundary.
  assert.equal(routeDistanceFt("SHARPS", "SINK"), routeDistanceFt("B3", "SINK"));
});

test("the far row orders sink, glassware, Consumables 1, Consumables 2 left to right", () => {
  assert.ok(routeDistanceFt("SINK", "GLASSWARE") < routeDistanceFt("SINK", "CONSUM1"));
  assert.ok(routeDistanceFt("SINK", "CONSUM1") < routeDistanceFt("SINK", "CONSUM2"));
});

test("the refrigerator is a far fixture, reachable like any other far fixture", () => {
  assert.ok(routeDistanceFt("A1", "REFRIGERATOR") > 0);
  assert.equal(routeDistanceFt("REFRIGERATOR", "REFRIGERATOR"), 0);
  // Far from column H, since it sits just past it.
  assert.ok(routeDistanceFt("H3", "REFRIGERATOR") < routeDistanceFt("A3", "REFRIGERATOR"));
});

test("routeWaypoints for a fixture ends at its own front, not its center, and starts at a real point", () => {
  for (const id of ["SHARPS", "RECYCLE", "WASTE", "SINK", "GLASSWARE", "CONSUM1", "CONSUM2", "REFRIGERATOR"]) {
    const pts = routeWaypoints("A1", id);
    assert.deepEqual(pts[pts.length - 1], front(id), `${id} path should end at its front`);
    assert.notDeepEqual(pts[pts.length - 1], center(id), `${id} path shouldn't overlap into its own box`);
    assert.equal(typeof pts[0].x, "number");
    assert.equal(typeof pts[0].y, "number");
  }
});

test("routeWaypoints for a cross-walkway bench pair also ends at the destination's front, not its center", () => {
  const pts = routeWaypoints("A1", "D1");
  assert.deepEqual(pts[pts.length - 1], front("D1"));
  assert.notDeepEqual(pts[pts.length - 1], center("D1"));
});

// --- The back-walkway rail: same-side pairs are direct, only opposite-side
// pairs cross it diagonally ---

// Precisely isolates the two rail-crossing points from a routeWaypoints
// result: toRailPoints(a) contributes 2 points for a fixture or 3 for a
// bench (front, [align], rail-entry), so the entry point's index is known
// exactly — no guessing from y-values, which can coincide with a station's
// own front by construction (e.g. the sharps/biohazard boxes' front already
// sits exactly on the rail's top edge).
function railCrossingYs(a, b) {
  const pts = routeWaypoints(a, b);
  const entryIdx = (isFixtureId(a) ? 2 : 3) - 1;
  return [pts[entryIdx].y, pts[entryIdx + 1].y];
}

test("two far-row fixtures route directly along the rail's bottom edge, no detour to its top edge", () => {
  // Sink/Glassware/Consumables 1&2/Refrigerator are all on the far (bottom)
  // side of the back walkway — moving between any two of them should never
  // detour up to the rail's far/top edge and back.
  for (const [a, b] of [["SINK", "GLASSWARE"], ["GLASSWARE", "CONSUM1"], ["CONSUM1", "CONSUM2"], ["CONSUM2", "REFRIGERATOR"], ["SINK", "REFRIGERATOR"]]) {
    const [entryY, exitY] = railCrossingYs(a, b);
    assert.equal(entryY, exitY, `${a} -> ${b} should cross the rail at one flat y, got ${entryY}, ${exitY}`);
  }
});

test("the sharps/recycling/biohazard trio routes directly along the rail's top edge with each other and with a bench", () => {
  // The trio touches row 3 from above (routeDistanceFt aliases reaching one
  // to reaching its anchor's row-3 bench, with no separate rail crossing) —
  // so both trio-to-trio and bench-to-trio moves should stay flat, at the
  // rail's near/top edge, never dipping to the far/bottom edge.
  for (const [a, b] of [["SHARPS", "RECYCLE"], ["RECYCLE", "WASTE"], ["SHARPS", "WASTE"], ["A1", "SHARPS"], ["D1", "WASTE"]]) {
    const [entryY, exitY] = railCrossingYs(a, b);
    assert.equal(entryY, exitY, `${a} -> ${b} should cross the rail at one flat y, got ${entryY}, ${exitY}`);
  }
});

test("a station on the near (top) side of the rail and one on the far (bottom) side still cross it diagonally", () => {
  // Only a genuine top-side/bottom-side pair — a bench or the trio against
  // the sink/glassware/consumables/refrigerator row — needs to actually
  // cross the rail's depth, so only these draw a real diagonal.
  for (const [a, b] of [["A1", "SINK"], ["SHARPS", "SINK"], ["D1", "REFRIGERATOR"]]) {
    const [entryY, exitY] = railCrossingYs(a, b);
    assert.notEqual(entryY, exitY, `${a} -> ${b} should cross the rail diagonally (different y's), got ${entryY}, ${exitY}`);
  }
});

// --- Lab Optimizer support: alternate trio anchors ---

test("the 3 touching pairs are exactly B-C, D-E, F-G, and the default anchor is B-C", () => {
  assert.deepEqual(TOUCHING_PAIRS, { BC: ["B", "C"], DE: ["D", "E"], FG: ["F", "G"] });
  assert.equal(DEFAULT_TRIO_ANCHOR, "BC");
});

test("nearFixturesForAnchor keeps sharps-left/waste-right/recycle-both for every anchor", () => {
  assert.deepEqual(nearFixturesForAnchor("BC"), { SHARPS: ["B"], WASTE: ["C"], RECYCLE: ["B", "C"] });
  assert.deepEqual(nearFixturesForAnchor("DE"), { SHARPS: ["D"], WASTE: ["E"], RECYCLE: ["D", "E"] });
  assert.deepEqual(nearFixturesForAnchor("FG"), { SHARPS: ["F"], WASTE: ["G"], RECYCLE: ["F", "G"] });
});

test("routeDistanceFt aliases a custom anchor's trio to that anchor's own row-3 benches", () => {
  const de = nearFixturesForAnchor("DE");
  assert.equal(routeDistanceFt("D3", "SHARPS", de), 0);
  assert.equal(routeDistanceFt("E3", "WASTE", de), 0);
  // Same-anchor cross-member trip is exactly a D3<->E3 trip, mirroring the
  // default anchor's SHARPS<->WASTE = B3<->C3 relationship.
  assert.equal(routeDistanceFt("SHARPS", "WASTE", de), routeDistanceFt("D3", "E3"));
  // The real (BC) anchor is unaffected by passing a different one elsewhere.
  assert.equal(routeDistanceFt("B3", "SHARPS"), 0);
});

test("trioFixturesForAnchor keeps the trio's left-to-right order (sharps, recycling, biohazard) at every anchor", () => {
  for (const key of Object.keys(TOUCHING_PAIRS)) {
    const boxes = trioFixturesForAnchor(key);
    assert.ok(boxes.SHARPS.x < boxes.RECYCLE.x, `${key}: sharps should be left of recycling`);
    assert.ok(boxes.RECYCLE.x < boxes.WASTE.x, `${key}: recycling should be left of biohazard`);
  }
  // The default anchor's box matches the real, hardcoded FIXTURES positions.
  assert.deepEqual(trioFixturesForAnchor(DEFAULT_TRIO_ANCHOR).SHARPS, FIXTURES.SHARPS);
  assert.deepEqual(trioFixturesForAnchor(DEFAULT_TRIO_ANCHOR).WASTE, FIXTURES.WASTE);
});

test("buildDistTable for the default anchor matches BENCH_DIST_FT exactly", () => {
  const table = buildDistTable(nearFixturesForAnchor(DEFAULT_TRIO_ANCHOR));
  assert.deepEqual(table, BENCH_DIST_FT);
});

test("DIST_TABLES_BY_ANCHOR has one table per anchor, BC identical to BENCH_DIST_FT", () => {
  assert.deepEqual(Object.keys(DIST_TABLES_BY_ANCHOR).sort(), ["BC", "DE", "FG"]);
  assert.equal(DIST_TABLES_BY_ANCHOR.BC, BENCH_DIST_FT);
  // A DE-anchored table disagrees with the real one specifically on trio distances.
  assert.notEqual(DIST_TABLES_BY_ANCHOR.DE.SHARPS.A1, BENCH_DIST_FT.SHARPS.A1);
  // ...but agrees everywhere that has nothing to do with the trio.
  assert.equal(DIST_TABLES_BY_ANCHOR.DE.A1.H3, BENCH_DIST_FT.A1.H3);
});
