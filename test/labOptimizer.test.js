import test from "node:test";
import assert from "node:assert/strict";
import { optimizeLayout } from "../src/labOptimizer.js";
import { parseLabTable } from "../src/labTable.js";
import { BENCH_NAMES, TOUCHING_PAIRS, BENCH_DIST_FT, PIPETTE_STATION_NAMES } from "../src/data.js";

const FAR_FIXTURE_NAMES = ["Sink", "Glassware", "Consumables 1", "Consumables 2", "4C Refrigerator"];

test("no equipment loaded returns a warning instead of a result", () => {
  const out = optimizeLayout({}, ["1. A\t1.1\tSomething"]);
  assert.equal(out.baseline, null);
  assert.equal(out.best, null);
  assert.ok(out.warnings.some((w) => /equipment/i.test(w)));
});

test("no protocols pasted returns a warning instead of a result", () => {
  const table = parseLabTable("Opentrons Flex Robot\tOpentrons").equipToStations;
  const out = optimizeLayout(table, ["", "   "]);
  assert.equal(out.baseline, null);
  assert.ok(out.warnings.some((w) => /protocol/i.test(w)));
});

const table = () => parseLabTable(`
Opentrons Flex Robot\tOpentrons
Gel Doc\tGel Imaging
NanoDrop 2000\tNanoDrop
Thermal Cycler\tPCR
Microscope\tResearch
Vortex Mixer\tImaging
Used Pipette Tips\tSharps Bin
Autoclave Bags\tBiohazard Waste
Glassware Cart\tGlassware
Consumables Restock 2\tConsumables 2
`.trim()).equipToStations;

// Opentrons (A3) and NanoDrop (C1) are on different walkway groups in the
// baseline layout, so bouncing between them repeatedly is expensive — an
// obviously improvable scenario to sanity-check the search actually works.
const bounceProtocol = () => `
1. Bounce\t1.1\tOpentrons Flex Robot
\t1.2\tNanoDrop 2000
\t1.3\tOpentrons Flex Robot
\t1.4\tNanoDrop 2000
\t1.5\tOpentrons Flex Robot
\t1.6\tNanoDrop 2000
`.trim();

test("finds a strictly better layout for an obviously improvable protocol", () => {
  const out = optimizeLayout(table(), [bounceProtocol()], { seed: 42 });
  assert.ok(out.best.totalTravelFt < out.baseline.totalTravelFt);
  assert.ok(out.improvementFt > 0);
  assert.equal(out.improvementFt, out.baseline.totalTravelFt - out.best.totalTravelFt);
});

test("never recommends a layout worse than the current one", () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const out = optimizeLayout(table(), [bounceProtocol()], { seed });
    assert.ok(out.best.totalTravelFt <= out.baseline.totalTravelFt, `seed ${seed} regressed`);
  }
});

test("same seed reproduces the same result", () => {
  const a = optimizeLayout(table(), [bounceProtocol()], { seed: 7 });
  const b = optimizeLayout(table(), [bounceProtocol()], { seed: 7 });
  assert.deepEqual(a, b);
});

test("best.benchOf is a true permutation of the 24 real bench ids", () => {
  const out = optimizeLayout(table(), [bounceProtocol()], { seed: 3 });
  const names = Object.keys(out.best.benchOf);
  const ids = Object.values(out.best.benchOf);
  assert.equal(names.length, 24);
  assert.deepEqual(new Set(names), new Set(Object.values(BENCH_NAMES)));
  assert.equal(new Set(ids).size, 24);
  assert.deepEqual(new Set(ids), new Set(Object.keys(BENCH_NAMES)));
});

test("the baseline layout matches the real, current one exactly (identity permutation, BC anchor)", () => {
  const out = optimizeLayout(table(), [bounceProtocol()], { seed: 1 });
  assert.equal(out.baseline.anchorKey, "BC");
  for (const [id, name] of Object.entries(BENCH_NAMES)) assert.equal(out.baseline.benchOf[name], id);
});

test("the sink/glassware/consumables 1&2/refrigerator never appear as a recommended move", () => {
  for (let seed = 0; seed < 8; seed++) {
    const out = optimizeLayout(table(), [bounceProtocol()], { seed });
    for (const m of out.moves) assert.ok(!FAR_FIXTURE_NAMES.includes(m.name), `${m.name} should never move`);
  }
});

test("best.anchorKey is always one of the 3 valid touching pairs", () => {
  for (let seed = 0; seed < 8; seed++) {
    const out = optimizeLayout(table(), [bounceProtocol()], { seed });
    assert.ok(Object.keys(TOUCHING_PAIRS).includes(out.best.anchorKey));
  }
});

// The sharps bin and the 4C refrigerator are both fixtures — one that can
// relocate (the trio), one that never moves — so bouncing between them is a
// clean, provably asymmetric case: with the refrigerator fixed off past
// column H, FG is genuinely closer to it than BC (25ft) or DE (20ft) is
// (15ft), regardless of how any bench equipment gets placed. No bench
// equipment is referenced at all, so this exercises the R=0 path too.
const trioTable = () => parseLabTable(`
Used Pipette Tips\tSharps Bin
Cold Reagent\t4C Refrigerator
`.trim()).equipToStations;

const trioProtocol = () => `
1. Loop\t1.1\tUsed Pipette Tips
\t1.2\tCold Reagent
\t1.3\tUsed Pipette Tips
\t1.4\tCold Reagent
`.trim();

test("can recommend relocating the sharps/recycling/biohazard trio as a group", () => {
  // This scenario's optimal anchor doesn't depend on equipment placement at
  // all (see comment above trioTable), so it's fully deterministic — no need
  // to search across seeds the way a heuristic-dependent case would.
  const out = optimizeLayout(trioTable(), [trioProtocol(), trioProtocol()], { seed: 1 });
  assert.equal(out.optimal, true);
  assert.equal(out.anchorChanged, true);
  assert.equal(out.best.anchorKey, "FG");
});

test("moves only lists benches whose position actually changed from baseline", () => {
  const out = optimizeLayout(table(), [bounceProtocol()], { seed: 42 });
  for (const m of out.moves) {
    assert.notEqual(m.from, m.to);
    assert.equal(out.best.benchOf[m.name], m.to);
  }
});

test("multiple protocols are all scored under the same candidate layout and summed", () => {
  const out = optimizeLayout(table(), [bounceProtocol(), bounceProtocol()], { seed: 9 });
  assert.equal(out.best.perProtocol.length, 2);
  const summed = out.best.perProtocol.reduce((s, p) => s + p.travelFt, 0);
  assert.equal(out.best.totalTravelFt, summed);
});

test("stationNames/fixtures/stationEquip are present and consistent on both baseline and best", () => {
  const out = optimizeLayout(table(), [bounceProtocol()], { seed: 5 });
  for (const layout of [out.baseline, out.best]) {
    assert.equal(Object.keys(layout.stationNames).length, 32);
    assert.ok(layout.fixtures.SHARPS && layout.fixtures.SINK);
    assert.equal(typeof layout.stationEquip, "object");
  }
});

test("no equipment/no protocols returns totalMoves 0 instead of throwing", () => {
  const out = optimizeLayout({}, []);
  assert.equal(out.totalMoves, 0);
});

test("totalMoves is moves.length, plus 3 when the trio relocated as a group", () => {
  for (let seed = 0; seed < 8; seed++) {
    const out = optimizeLayout(table(), [bounceProtocol()], { seed });
    assert.equal(out.totalMoves, out.moves.length + (out.anchorChanged ? 3 : 0), `seed ${seed}`);
  }
  // Cover the anchor-changed branch too, using the trio-favoring scenario.
  for (let seed = 0; seed < 10; seed++) {
    const out = optimizeLayout(trioTable(), [trioProtocol(), trioProtocol()], { seed });
    assert.equal(out.totalMoves, out.moves.length + (out.anchorChanged ? 3 : 0), `trio seed ${seed}`);
  }
});

test("visitCounts tallies total resolved station visits across all pasted protocols", () => {
  const out = optimizeLayout(table(), [bounceProtocol()], { seed: 5 });
  // bounceProtocol has 6 substeps and both pieces of equipment it uses are
  // mapped, so every substep resolves to a station under any layout.
  for (const layout of [out.baseline, out.best]) {
    const totalVisits = Object.values(layout.visitCounts).reduce((a, b) => a + b, 0);
    assert.equal(totalVisits, 6);
  }
});

test("visitCounts is empty (not present) for a station nothing ever visits", () => {
  const out = optimizeLayout(table(), [bounceProtocol()], { seed: 5 });
  assert.equal(out.best.visitCounts.REFRIGERATOR ?? 0, 0);
});

// --- Exactness: only the referenced stations matter, so the search should be
// able to prove a true global optimum for small cases, verified here by an
// independent brute force that doesn't call anything from labOptimizer.js. ---

test("a 2-station scenario is flagged optimal, with relevantStationCount matching, and hits the true minimum", () => {
  const twoTable = parseLabTable(`
Equip A\tOpentrons
Equip B\tNanoDrop
`.trim()).equipToStations;
  // 4 substeps alternating A/B -> 3 transitions, always between the same pair.
  const proto = `
1. Loop\t1.1\tEquip A
\t1.2\tEquip B
\t1.3\tEquip A
\t1.4\tEquip B
`.trim();

  const out = optimizeLayout(twoTable, [proto], { seed: 123 });
  assert.equal(out.optimal, true);
  assert.equal(out.relevantStationCount, 2);

  // The true minimum achievable: the smallest distance between any two
  // *distinct* bench positions anywhere on the whole 24-bench grid.
  const ids = Object.keys(BENCH_NAMES);
  let minDist = Infinity;
  for (const a of ids) for (const b of ids) if (a !== b) minDist = Math.min(minDist, BENCH_DIST_FT[a][b]);

  assert.equal(out.best.totalTravelFt, 3 * minDist);
});

test("a 3-station scenario hits the exhaustively-verified true minimum", () => {
  const threeTable = parseLabTable(`
Equip A\tOpentrons
Equip B\tNanoDrop
Equip C\tPCR
`.trim()).equipToStations;
  const proto = `
1. Loop\t1.1\tEquip A
\t1.2\tEquip B
\t1.3\tEquip C
\t1.4\tEquip A
\t1.5\tEquip B
\t1.6\tEquip C
`.trim();

  const out = optimizeLayout(threeTable, [proto], { seed: 456 });
  assert.equal(out.optimal, true);
  assert.equal(out.relevantStationCount, 3);

  // Exhaustively try every placement of 3 distinct benches (24*23*22 = 12,144
  // arrangements) against the same A-B-C-A-B-C transition pattern, using only
  // BENCH_DIST_FT directly — nothing from labOptimizer.js — as an independent
  // reference for the true minimum.
  const ids = Object.keys(BENCH_NAMES);
  const transitions = [["A", "B"], ["B", "C"], ["C", "A"], ["A", "B"], ["B", "C"]];
  let bestCost = Infinity;
  for (const a of ids) {
    for (const b of ids) {
      if (b === a) continue;
      for (const c of ids) {
        if (c === a || c === b) continue;
        const pos = { A: a, B: b, C: c };
        let cost = 0;
        for (const [x, y] of transitions) cost += BENCH_DIST_FT[pos[x]][pos[y]];
        if (cost < bestCost) bestCost = cost;
      }
    }
  }

  assert.equal(out.best.totalTravelFt, bestCost);
});

test("exact results are identical across every seed (the search is deterministic when optimal)", () => {
  const twoTable = parseLabTable(`
Equip A\tOpentrons
Equip B\tNanoDrop
`.trim()).equipToStations;
  const proto = "1. Loop\t1.1\tEquip A\n\t1.2\tEquip B\n\t1.3\tEquip A\n\t1.4\tEquip B";
  const results = [1, 2, 3, 4, 5].map((seed) => optimizeLayout(twoTable, [proto], { seed }));
  for (const r of results) assert.equal(r.optimal, true);
  for (const r of results.slice(1)) assert.deepEqual(r, results[0]);
});

test("relevantStationCount is 0 and optimal is true when the protocol never references a movable bench", () => {
  const fixtureOnlyTable = parseLabTable(`
Glassware Cart\tGlassware
Used Pipette Tips\tSharps Bin
`.trim()).equipToStations;
  const proto = "1. Cleanup\t1.1\tGlassware Cart\n\t1.2\tUsed Pipette Tips";
  const out = optimizeLayout(fixtureOnlyTable, [proto], { seed: 1 });
  assert.equal(out.relevantStationCount, 0);
  assert.equal(out.optimal, true);
  assert.equal(out.moves.length, 0);
});

test("a large relevant-station-count scenario (heavy Pipette usage) falls back to the heuristic search and still never regresses", () => {
  // Pipette alone pulls in all 8 PIPETTE_STATION_NAMES; combined with several
  // more single-station equipment, this pushes relevantStationCount past what
  // exact search can budget for, exercising the heuristic fallback path.
  const bigTable = parseLabTable(`
Opentrons Flex Robot\tOpentrons
Gel Doc\tGel Imaging
Thermal Cycler\tPCR
Centrifuge\tDNA Prep
Microscope\tResearch
Vortex Mixer\tImaging
Incubator\tMicrobial Incubators
Balance\tDry Chemical Weighing
`.trim()).equipToStations;
  const proto = `
1. Loop\t1.1\tOpentrons Flex Robot
\t1.2\tPipette
\t1.3\tGel Doc
\t1.4\tPipette
\t1.5\tThermal Cycler
\t1.6\tPipette
\t1.7\tCentrifuge
\t1.8\tPipette
\t1.9\tMicroscope
\t1.10\tPipette
\t1.11\tVortex Mixer
\t1.12\tPipette
\t1.13\tIncubator
\t1.14\tPipette
\t1.15\tBalance
`.trim();

  const out = optimizeLayout(bigTable, [proto], { seed: 11 });
  assert.equal(out.optimal, false);
  assert.ok(out.relevantStationCount >= PIPETTE_STATION_NAMES.length);
  assert.ok(out.best.totalTravelFt <= out.baseline.totalTravelFt);
});

test("sweeping the default seed list never does worse than any single seed in it", () => {
  // Same heavy-Pipette scenario as above, large enough to force the heuristic
  // fallback. A single seed's random walk can land in a mediocre local
  // optimum; the default sweep tries every DEFAULT_SEEDS value and keeps the
  // best, so it should never be beaten by any one of them run alone.
  const bigTable = parseLabTable(`
Opentrons Flex Robot\tOpentrons
Gel Doc\tGel Imaging
Thermal Cycler\tPCR
Centrifuge\tDNA Prep
Microscope\tResearch
Vortex Mixer\tImaging
Incubator\tMicrobial Incubators
Balance\tDry Chemical Weighing
`.trim()).equipToStations;
  const proto = `
1. Loop\t1.1\tOpentrons Flex Robot
\t1.2\tPipette
\t1.3\tGel Doc
\t1.4\tPipette
\t1.5\tThermal Cycler
\t1.6\tPipette
\t1.7\tCentrifuge
\t1.8\tPipette
\t1.9\tMicroscope
\t1.10\tPipette
\t1.11\tVortex Mixer
\t1.12\tPipette
\t1.13\tIncubator
\t1.14\tPipette
\t1.15\tBalance
`.trim();

  const swept = optimizeLayout(bigTable, [proto]);
  assert.equal(swept.optimal, false);
  for (const seed of [1, 11, 101, 401, 1301]) {
    const single = optimizeLayout(bigTable, [proto], { seed });
    assert.ok(swept.best.totalTravelFt <= single.best.totalTravelFt);
  }
});
