import test from "node:test";
import assert from "node:assert/strict";
import { generateProtocols } from "../src/protocolGen.js";
import { parseLabTable } from "../src/labTable.js";
import { BENCH_DIST_FT, PIPETTE_STATIONS } from "../src/data.js";

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

const repeatTable = () => parseLabTable(`
Vortex Mixer\tImaging
`.trim());

test("equipment (and its station) can repeat on consecutive steps outside the pool stations, across enough seeds", () => {
  const { equipToStations } = repeatTable();
  let sawRepeat = false;
  for (let seed = 0; seed < 30 && !sawRepeat; seed++) {
    const { protocols } = generateProtocols(equipToStations, { count: 10, minSteps: 6, maxSteps: 6, seed });
    for (const p of protocols) {
      for (let i = 1; i < p.steps.length; i++) {
        if (p.steps[i].station === p.steps[i - 1].station) sawRepeat = true;
      }
    }
  }
  assert.ok(sawRepeat, "never saw a consecutive station repeat across 300 protocols with only one non-pipette equipment option");
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
Pipette Tips Restock\tConsumables 2
`.trim());
  assert.equal(fixtureTable.errors.length, 0);
  const { protocols } = generateProtocols(fixtureTable.equipToStations, { count: 2, minSteps: 2, maxSteps: 2, seed: 1 });
  const visited = new Set(protocols.flatMap((p) => p.steps.map((s) => s.station)));
  for (const fixture of ["SHARPS", "RECYCLE", "WASTE", "SINK", "CONSUM2"]) {
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
Pipette Tips Restock\tConsumables 2
`.trim());

test("the shared full-table test fixture parses with no errors", () => {
  const t = fullTable();
  assert.equal(t.errors.length, 0);
});

test("every protocol opens with a retrieval step at consumables", () => {
  const { equipToStations } = fullTable();
  const { protocols } = generateProtocols(equipToStations, { count: 15, minSteps: 4, maxSteps: 8, seed: 21 });
  for (const p of protocols) assert.equal(p.steps[0].station, "CONSUM2", `${p.id} didn't open at CONSUM2`);
});

test("every protocol closes with the Sharps Bin as its literal last step (every protocol uses a pipette)", () => {
  const { equipToStations } = fullTable();
  const { protocols } = generateProtocols(equipToStations, { count: 15, minSteps: 4, maxSteps: 8, seed: 21 });
  for (const p of protocols) {
    assert.equal(p.steps[p.steps.length - 1].station, "SHARPS", `${p.id} closed at ${p.steps[p.steps.length - 1].station}, not Sharps`);
  }
});

test("some protocols dispose at Biohazard Waste immediately before the (always-last) Sharps Bin step, across enough seeds", () => {
  const { equipToStations } = fullTable();
  let sawDouble = false;
  for (let seed = 0; seed < 30 && !sawDouble; seed++) {
    const { protocols } = generateProtocols(equipToStations, { count: 10, minSteps: 6, maxSteps: 8, seed });
    for (const p of protocols) {
      const [secondLast, last] = p.steps.slice(-2).map((s) => s.station);
      if (secondLast === "WASTE" && last === "SHARPS") sawDouble = true;
    }
  }
  assert.ok(sawDouble, "never saw a protocol dispose at Biohazard Waste right before Sharps across 300 protocols");
});

test("bookend steps are still forced even when minSteps/maxSteps is too tight to fit them", () => {
  const { equipToStations } = fullTable();
  const count = 5;
  const { protocols } = generateProtocols(equipToStations, { count, minSteps: 1, maxSteps: 1, seed: 4 });
  // Only the main batch (not any auto-appended coverage protocol, which is a
  // single-purpose fixture-visit and isn't held to the bookend rule) is checked.
  for (const p of protocols.slice(0, count)) {
    assert.ok(p.steps.length >= 2, `${p.id} should have at least a retrieve + disposal step`);
    assert.equal(p.steps[0].station, "CONSUM2");
  }
});

test("equipToStations without consumables/waste mapped warns and skips the bookend steps", () => {
  const equipToStations = { Pipette: ["A1"], Centrifuge: ["D2"], Microscope: ["G1"] };
  const out = generateProtocols(equipToStations, { count: 5, minSteps: 3, maxSteps: 5, seed: 9 });
  assert.ok(out.warnings.some((w) => /Consumables 2/.test(w)));
  assert.ok(out.warnings.some((w) => /Sharps|Biohazard/.test(w)));
  for (const p of out.protocols) assert.notEqual(p.steps[0].station, "CONSUM2");
});

test("a table parsed with no fixtures mentioned never opens/closes with a fixture — nothing is auto-installed there", () => {
  const { equipToStations } = table(); // none of these rows mention SHARPS/RECYCLE/WASTE/SINK/CONSUM1/CONSUM2
  const { protocols, warnings } = generateProtocols(equipToStations, { count: 8, minSteps: 4, maxSteps: 7, seed: 14 });
  assert.ok(warnings.some((w) => /Consumables 2/.test(w)));
  assert.ok(warnings.some((w) => /Sharps|Biohazard/.test(w)));
  const fixtureIds = new Set(["SHARPS", "RECYCLE", "WASTE", "SINK", "GLASSWARE", "CONSUM1", "CONSUM2", "REFRIGERATOR"]);
  for (const p of protocols) {
    for (const s of p.steps) assert.ok(!fixtureIds.has(s.station), `${p.id} visited fixture ${s.station}, which has no mapped equipment`);
  }
});

// Maps equipment to every OPEN_POOL/CLOSE_POOL station (Glassware, Consumables 1,
// Consumables 2, Sink, Biohazard Waste, Sharps Bin) plus a handful of ordinary
// benches for the middle random walk, so the open/close pool subset logic and the
// Pipette injection both have real equipment to exercise.
const poolTable = () => parseLabTable(`
Glassware Cart\tGlassware
Consumables Restock 1\tConsumables 1
Consumables Restock 2\tConsumables 2
Wash Station\tSink
Autoclave Bags\tBiohazard Waste
Used Pipette Tips\tSharps Bin
Opentrons Flex Robot\tOpentrons
Gel Doc\tGel Imaging
Thermal Cycler\tDNA Prep
Centrifuge\tPCR
Microscope\tResearch
Vortex Mixer\tImaging
`.trim());

const OPEN_POOL_IDS = new Set(["GLASSWARE", "CONSUM1", "CONSUM2"]);
const CLOSE_POOL_IDS = new Set(["SINK", "WASTE", "SHARPS"]);

test("the shared pool test fixture parses with no errors", () => {
  const t = poolTable();
  assert.equal(t.errors.length, 0);
});

test("open-pool stations only ever appear as a prefix, and close-pool stations only ever appear as a suffix", () => {
  const { equipToStations } = poolTable();
  for (let seed = 0; seed < 20; seed++) {
    const { protocols } = generateProtocols(equipToStations, { count: 10, minSteps: 4, maxSteps: 9, seed });
    for (const p of protocols) {
      let sawNonOpen = false;
      for (const s of p.steps) {
        if (OPEN_POOL_IDS.has(s.station)) {
          assert.ok(!sawNonOpen, `${p.id} (seed ${seed}) has an open-pool station after a non-open-pool step`);
        } else {
          sawNonOpen = true;
        }
      }
      let sawClose = false;
      for (const s of p.steps) {
        if (CLOSE_POOL_IDS.has(s.station)) {
          sawClose = true;
        } else {
          assert.ok(!sawClose, `${p.id} (seed ${seed}) has a non-close-pool station after a close-pool step`);
        }
      }
    }
  }
});

test("protocols can open with Glassware and Consumables 1, not just Consumables 2, across enough seeds", () => {
  const { equipToStations } = poolTable();
  const opened = new Set();
  for (let seed = 0; seed < 30; seed++) {
    const { protocols } = generateProtocols(equipToStations, { count: 10, minSteps: 4, maxSteps: 8, seed });
    for (const p of protocols) opened.add(p.steps[0].station);
  }
  assert.ok(opened.has("GLASSWARE"), "never saw a protocol open at Glassware");
  assert.ok(opened.has("CONSUM1"), "never saw a protocol open at Consumables 1");
  assert.ok(opened.has("CONSUM2"), "never saw a protocol open at Consumables 2");
});

test("protocols can close with the Sink, not just Sharps/Biohazard, across enough seeds", () => {
  const { equipToStations } = poolTable();
  let sawSink = false;
  for (let seed = 0; seed < 30 && !sawSink; seed++) {
    const { protocols } = generateProtocols(equipToStations, { count: 10, minSteps: 4, maxSteps: 8, seed });
    for (const p of protocols) {
      if (p.steps.some((s) => s.station === "SINK")) sawSink = true;
    }
  }
  assert.ok(sawSink, "never saw a protocol close with the Sink across 300 protocols");
});

test("every protocol includes at least one Pipette step", () => {
  const { equipToStations } = poolTable();
  for (let seed = 0; seed < 15; seed++) {
    const { protocols } = generateProtocols(equipToStations, { count: 10, minSteps: 4, maxSteps: 8, seed });
    for (const p of protocols) {
      assert.ok(p.steps.some((s) => s.equipment === "Pipette"), `${p.id} (seed ${seed}) has no Pipette step`);
    }
  }
});

test("a Pipette step is still guaranteed with minSteps/maxSteps of 1 and no bookend stations mapped at all", () => {
  const equipToStations = { Centrifuge: ["D2"], Microscope: ["G1"] };
  const { protocols } = generateProtocols(equipToStations, { count: 5, minSteps: 1, maxSteps: 1, seed: 2 });
  for (const p of protocols) {
    assert.ok(p.steps.some((s) => s.equipment === "Pipette"), `${p.id} has no Pipette step`);
  }
});

test("pool (consumables/waste) stations never repeat consecutively, even though other equipment can", () => {
  const { equipToStations } = poolTable();
  const poolIds = new Set([...OPEN_POOL_IDS, ...CLOSE_POOL_IDS]);
  for (let seed = 0; seed < 20; seed++) {
    const { protocols } = generateProtocols(equipToStations, { count: 10, minSteps: 4, maxSteps: 9, seed });
    for (const p of protocols) {
      for (let i = 1; i < p.steps.length; i++) {
        if (poolIds.has(p.steps[i].station)) {
          assert.notEqual(p.steps[i].station, p.steps[i - 1].station, `${p.id} (seed ${seed}) repeated a pool station consecutively`);
        }
      }
    }
  }
});

test("a Pipette step's station is always a member of PIPETTE_STATIONS", () => {
  const { equipToStations } = poolTable();
  for (let seed = 0; seed < 15; seed++) {
    const { protocols } = generateProtocols(equipToStations, { count: 10, minSteps: 4, maxSteps: 8, seed });
    for (const p of protocols) {
      for (const s of p.steps) {
        if (s.equipment === "Pipette") assert.ok(PIPETTE_STATIONS.includes(s.station), `${p.id} placed Pipette at ${s.station}, outside PIPETTE_STATIONS`);
      }
    }
  }
});

test("every protocol closes with the Sharps Bin as its literal last step, since every protocol uses a pipette", () => {
  const { equipToStations } = poolTable();
  for (let seed = 0; seed < 15; seed++) {
    const { protocols } = generateProtocols(equipToStations, { count: 10, minSteps: 4, maxSteps: 8, seed });
    for (const p of protocols) {
      assert.equal(p.steps[p.steps.length - 1].station, "SHARPS", `${p.id} (seed ${seed}) didn't close with Sharps`);
    }
  }
});
