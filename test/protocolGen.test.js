import test from "node:test";
import assert from "node:assert/strict";
import { generateProtocols } from "../src/protocolGen.js";
import { parseLabTable } from "../src/labTable.js";
import { BENCH_DIST_FT } from "../src/data.js";

const table = () => parseLabTable(`
Opentrons Flex Robot\tOpentrons
Gel Doc\tGel Imaging
Thermal Cycler\tDNA Prep
Centrifuge\tPCR
Microscope\tResearch
Vortex Mixer\tImaging
`.trim());

test("the shared test fixture table parses with no errors", () => {
  const t = table();
  assert.equal(t.errors.length, 0);
});

test("same seed produces identical protocols (reproducible)", () => {
  const { equipToStations } = table();
  const a = generateProtocols(equipToStations, { count: 5, minSteps: 3, maxSteps: 6, seed: 42 });
  const b = generateProtocols(equipToStations, { count: 5, minSteps: 3, maxSteps: 6, seed: 42 });
  assert.deepEqual(a, b);
});

test("different seeds diverge", () => {
  const { equipToStations } = table();
  const a = generateProtocols(equipToStations, { count: 5, minSteps: 3, maxSteps: 6, seed: 1 });
  const b = generateProtocols(equipToStations, { count: 5, minSteps: 3, maxSteps: 6, seed: 2 });
  assert.notDeepEqual(a, b);
});

test("consecutive steps never sit at the same station when alternatives exist", () => {
  const { equipToStations } = table();
  const { protocols } = generateProtocols(equipToStations, { count: 20, minSteps: 6, maxSteps: 10, seed: 7 });
  for (const p of protocols) {
    for (let i = 1; i < p.steps.length; i++) {
      assert.notEqual(p.steps[i].station, p.steps[i - 1].station, `${p.id} step ${i} repeats a station`);
    }
  }
});

test("step count respects the configured min/max range", () => {
  const { equipToStations } = table();
  const { protocols } = generateProtocols(equipToStations, { count: 30, minSteps: 4, maxSteps: 4, seed: 3 });
  for (const p of protocols) assert.equal(p.steps.length, 4);
});

test("no equipment produces an empty result with a warning instead of throwing", () => {
  const out = generateProtocols({}, { count: 3 });
  assert.equal(out.protocols.length, 0);
  assert.ok(out.warnings.length > 0);
});

test("travelFt is the sum of the route distance (in feet) between consecutive steps", () => {
  const { equipToStations } = table();
  const { protocols } = generateProtocols(equipToStations, { count: 10, minSteps: 3, maxSteps: 8, seed: 11 });
  for (const p of protocols) {
    let expected = 0;
    for (let i = 1; i < p.steps.length; i++) expected += BENCH_DIST_FT[p.steps[i - 1].station][p.steps[i].station];
    assert.equal(p.travelFt, Math.round(expected));
  }
});

test("protocols are titled 'Protocol 1', 'Protocol 2', ...", () => {
  const { equipToStations } = table();
  const { protocols } = generateProtocols(equipToStations, { count: 4, minSteps: 3, maxSteps: 5, seed: 5 });
  protocols.forEach((p, i) => assert.equal(p.id, `Protocol ${i + 1}`));
});

test("equipToStations with no fixtures mapped at all adds no extra protocol beyond count", () => {
  // parseLabTable always injects the 5 baseline fixtures now, so this exercises
  // generateProtocols' own graceful-degradation path directly, bypassing that.
  const equipToStations = { Pipette: ["A1"], Centrifuge: ["D2"], Microscope: ["G1"] };
  const { protocols } = generateProtocols(equipToStations, { count: 5, minSteps: 3, maxSteps: 5, seed: 9 });
  assert.equal(protocols.length, 5);
});

test("every fixture with mapped equipment is visited by at least one protocol", () => {
  const fixtureTable = parseLabTable(`
Used Pipette Tips\tSharps Bin
Paper Waste\tRecycling Bin
Autoclave Bags\tBiohazard Waste
Glassware\tSink
Pipette Tips Restock\tConsumables Storage
`.trim());
  assert.equal(fixtureTable.errors.length, 0);
  const { protocols } = generateProtocols(fixtureTable.equipToStations, { count: 2, minSteps: 2, maxSteps: 2, seed: 1 });
  const visited = new Set(protocols.flatMap((p) => p.steps.map((s) => s.station)));
  for (const fixture of ["SHARPS", "RECYCLE", "WASTE", "SINK", "CONSUM"]) {
    assert.ok(visited.has(fixture), `${fixture} was never visited`);
  }
  // The coverage protocol (if any) still follows the naming scheme.
  protocols.forEach((p, i) => assert.equal(p.id, `Protocol ${i + 1}`));
});

const fullTable = () => parseLabTable(`
Opentrons Flex Robot\tOpentrons
Gel Doc\tGel Imaging
Microscope\tResearch
Used Pipette Tips\tSharps Bin
Autoclave Bags\tBiohazard Waste
Pipette Tips Restock\tConsumables Storage
`.trim());

test("the shared full-table test fixture parses with no errors", () => {
  const t = fullTable();
  assert.equal(t.errors.length, 0);
});

test("every protocol opens with a retrieval step at consumables", () => {
  const { equipToStations } = fullTable();
  const { protocols } = generateProtocols(equipToStations, { count: 15, minSteps: 4, maxSteps: 8, seed: 21 });
  for (const p of protocols) assert.equal(p.steps[0].station, "CONSUM", `${p.id} didn't open at CONSUM`);
});

test("every protocol closes with a disposal step at sharps and/or biohazard waste", () => {
  const { equipToStations } = fullTable();
  const { protocols } = generateProtocols(equipToStations, { count: 15, minSteps: 4, maxSteps: 8, seed: 21 });
  for (const p of protocols) {
    const last = p.steps[p.steps.length - 1].station;
    assert.ok(last === "SHARPS" || last === "WASTE", `${p.id} closed at ${last}, not a disposal bin`);
  }
});

test("some protocols dispose at both bins back to back, across enough seeds", () => {
  const { equipToStations } = fullTable();
  let sawDouble = false;
  for (let seed = 0; seed < 30 && !sawDouble; seed++) {
    const { protocols } = generateProtocols(equipToStations, { count: 10, minSteps: 6, maxSteps: 8, seed });
    for (const p of protocols) {
      const [secondLast, last] = p.steps.slice(-2).map((s) => s.station);
      if ((secondLast === "SHARPS" && last === "WASTE") || (secondLast === "WASTE" && last === "SHARPS")) sawDouble = true;
    }
  }
  assert.ok(sawDouble, "never saw a protocol dispose at both bins across 300 protocols");
});

test("bookend steps are still forced even when minSteps/maxSteps is too tight to fit them", () => {
  const { equipToStations } = fullTable();
  const count = 5;
  const { protocols } = generateProtocols(equipToStations, { count, minSteps: 1, maxSteps: 1, seed: 4 });
  // Only the main batch (not any auto-appended coverage protocol, which is a
  // single-purpose fixture-visit and isn't held to the bookend rule) is checked.
  for (const p of protocols.slice(0, count)) {
    assert.ok(p.steps.length >= 2, `${p.id} should have at least a retrieve + disposal step`);
    assert.equal(p.steps[0].station, "CONSUM");
  }
});

test("equipToStations without consumables/waste mapped warns and skips the bookend steps", () => {
  // parseLabTable always injects the 5 baseline fixtures now, so this exercises
  // generateProtocols' own graceful-degradation path directly, bypassing that.
  const equipToStations = { Pipette: ["A1"], Centrifuge: ["D2"], Microscope: ["G1"] };
  const out = generateProtocols(equipToStations, { count: 5, minSteps: 3, maxSteps: 5, seed: 9 });
  assert.ok(out.warnings.some((w) => /Consumables/.test(w)));
  assert.ok(out.warnings.some((w) => /Sharps|Biohazard/.test(w)));
  for (const p of out.protocols) assert.notEqual(p.steps[0].station, "CONSUM");
});

test("a table parsed with no fixtures mentioned still opens/closes with the baseline fixture equipment", () => {
  const { equipToStations } = table(); // none of these rows mention SHARPS/RECYCLE/WASTE/SINK/CONSUM
  const count = 8;
  const { protocols } = generateProtocols(equipToStations, { count, minSteps: 4, maxSteps: 7, seed: 14 });
  // Only the main batch — an auto-appended coverage protocol (for a fixture like
  // RECYCLE/SINK that the random walk happened to miss) isn't held to the bookend rule.
  for (const p of protocols.slice(0, count)) {
    assert.equal(p.steps[0].station, "CONSUM", `${p.id} didn't open at CONSUM`);
    assert.equal(p.steps[0].equipment, "Consumables");
    const last = p.steps[p.steps.length - 1];
    assert.ok(last.station === "SHARPS" || last.station === "WASTE", `${p.id} closed at ${last.station}, not a disposal bin`);
    assert.ok(last.equipment === "Sharps" || last.equipment === "Biohazardous Waste");
  }
});
