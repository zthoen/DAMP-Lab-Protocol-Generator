import test from "node:test";
import assert from "node:assert/strict";
import {
  routeDistanceFt, routeWaypoints, BENCH_DIST_FT, STATION_IDS, STATION_NAME, NAME_TO_STATION_ID, center, FIXTURES,
  WALKWAY_WIDTH_FT, BACK_AISLE_FT, BENCH_LEN_FT, BENCH_WIDTH_FT,
  TOUCHING_PAIRS, DEFAULT_TRIO_ANCHOR, nearFixturesForAnchor, trioFixturesForAnchor, buildDistTable, DIST_TABLES_BY_ANCHOR,
} from "../src/data.js";

test("same station is zero distance", () => {
  assert.equal(routeDistanceFt("A1", "A1"), 0);
});

test("same-column moves cross bench lengths within their shared walkway, no back-aisle detour", () => {
  assert.equal(routeDistanceFt("A1", "A2"), BENCH_LEN_FT);
  assert.equal(routeDistanceFt("A1", "A3"), 2 * BENCH_LEN_FT);
  assert.equal(routeDistanceFt("A3", "A1"), 2 * BENCH_LEN_FT); // symmetric
});

test("columns sharing one walkway (A-B) cross it directly, no back-aisle detour", () => {
  // Same row: just the walkway width.
  assert.equal(routeDistanceFt("A1", "B1"), WALKWAY_WIDTH_FT);
  // Different row: bench-length hops plus one walkway-width crossing.
  assert.equal(routeDistanceFt("A1", "B3"), 2 * BENCH_LEN_FT + WALKWAY_WIDTH_FT);
});

test("a touching pair (B-C) can't cut through each other — still routes via the back aisle", () => {
  // B and C touch directly but don't share a walkway (B's walkway is A-B, C's is C-D),
  // so B1 -> C1 has to detour: down to B3, across the back aisle (one bench-width
  // apart), up to C1.
  const expected = 2 * BENCH_LEN_FT + BACK_AISLE_FT + BENCH_WIDTH_FT + 2 * BENCH_LEN_FT;
  assert.equal(routeDistanceFt("B1", "C1"), expected);
});

test("different walkway groups route down, across the back aisle (by bench width), and up", () => {
  // A (group AB) -> D (group CD): down 2 rows, across 3 bench-widths (columns
  // A,B,C,D are indices 0..3 apart), up 2 rows.
  const expected = 2 * BENCH_LEN_FT + BACK_AISLE_FT + 3 * BENCH_WIDTH_FT + 2 * BENCH_LEN_FT;
  assert.equal(routeDistanceFt("A1", "D1"), expected);
});

test("row-3-to-row-3 cross-group move still pays the back-aisle crossing once", () => {
  assert.equal(routeDistanceFt("A3", "H3"), BACK_AISLE_FT + 7 * BENCH_WIDTH_FT);
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

test("routeWaypoints for a fixture ends at its own center and starts at a real point", () => {
  for (const id of ["SHARPS", "RECYCLE", "WASTE", "SINK", "GLASSWARE", "CONSUM1", "CONSUM2", "REFRIGERATOR"]) {
    const pts = routeWaypoints("A1", id);
    assert.deepEqual(pts[pts.length - 1], center(id), `${id} path should end at its center`);
    assert.equal(typeof pts[0].x, "number");
    assert.equal(typeof pts[0].y, "number");
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
