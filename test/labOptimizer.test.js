import test from "node:test";
import assert from "node:assert/strict";
import { optimizeLayout } from "../src/labOptimizer.js";
import { parseLabTable } from "../src/labTable.js";
import { BENCH_NAMES, TOUCHING_PAIRS } from "../src/data.js";

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

// Equipment clustered near columns F-H, but the sharps/waste trio the protocol
// leans on heavily stays anchored at B-C in the baseline — relocating the trio
// as a group should measurably help here.
const trioTable = () => parseLabTable(`
Instrument 1\tResearch
Instrument 2\tImaging
Instrument 3\tVacuum Oven
Instrument 4\tTransfyr
Used Pipette Tips\tSharps Bin
Autoclave Bags\tBiohazard Waste
`.trim()).equipToStations;

const trioProtocol = () => `
1. Loop\t1.1\tInstrument 1
\t1.2\tUsed Pipette Tips
\t1.3\tInstrument 2
\t1.4\tUsed Pipette Tips
\t1.5\tInstrument 3
\t1.6\tUsed Pipette Tips
\t1.7\tInstrument 4
\t1.8\tAutoclave Bags
`.trim();

test("can recommend relocating the sharps/recycling/biohazard trio as a group", () => {
  let sawAnchorChange = false;
  for (let seed = 0; seed < 10 && !sawAnchorChange; seed++) {
    const out = optimizeLayout(trioTable(), [trioProtocol(), trioProtocol()], { seed });
    if (out.anchorChanged) sawAnchorChange = true;
  }
  assert.ok(sawAnchorChange, "never saw the trio anchor change across 10 seeds for a protocol that should favor it");
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
