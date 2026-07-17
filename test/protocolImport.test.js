import test from "node:test";
import assert from "node:assert/strict";
import { parseProtocol } from "../src/protocolImport.js";
import { parseLabTable } from "../src/labTable.js";
import { BENCH_DIST_FT } from "../src/data.js";

const equipToStations = () => parseLabTable(`
Opentrons Flex Robot\tHamilton
Biorad Gel Doc XR+ Imaging System\tGel Imaging
NanoDrop 2000\tNanoDrop
Thermal Cycler\tPCR
Incubator Shaker\tMicrobial Culture Processing, Microbial Incubators
`.trim()).equipToStations;

test("groups substeps under their step number and keeps the step name from the first row", () => {
  const raw = `
1. Prepare Reagents\t1.1\tOpentrons Flex Robot
\t1.2\tNanoDrop 2000
2. Run Gel\t2.1\tBiorad Gel Doc XR+ Imaging System
`.trim();
  const { steps, errors } = parseProtocol(raw, equipToStations());
  assert.equal(errors.length, 0);
  assert.equal(steps.length, 2);
  assert.equal(steps[0].number, 1);
  assert.equal(steps[0].name, "Prepare Reagents");
  assert.equal(steps[0].substeps.length, 2);
  assert.equal(steps[0].substeps[0].label, "1.1");
  assert.equal(steps[0].substeps[0].station, "A3"); // Hamilton
  assert.equal(steps[1].number, 2);
  assert.equal(steps[1].name, "Run Gel");
});

test("detects and skips a header row", () => {
  const raw = `
Step\tSubstep\tEquipment
1. Prepare Reagents\t1.1\tOpentrons Flex Robot
`.trim();
  const { steps, errors } = parseProtocol(raw, equipToStations());
  assert.equal(errors.length, 0);
  assert.equal(steps.length, 1);
  assert.equal(steps[0].substeps.length, 1);
});

test("equipment not in the loaded equipment list is kept but has no station, and is reported", () => {
  const raw = `1. Prepare Reagents\t1.1\tMystery Machine`.trim();
  const { steps, errors } = parseProtocol(raw, equipToStations());
  assert.equal(steps[0].substeps[0].station, null);
  assert.ok(errors.some((e) => /Mystery Machine/.test(e)));
});

test("an invalid substep label is reported and the row is dropped", () => {
  const raw = `
1. Prepare Reagents\t1.1\tOpentrons Flex Robot
\tnot-a-label\tNanoDrop 2000
`.trim();
  const { steps, errors } = parseProtocol(raw, equipToStations());
  assert.equal(steps[0].substeps.length, 1);
  assert.match(errors[0], /not-a-label/);
});

test("multi-station equipment resolves to whichever station is nearest the previous one", () => {
  const raw = `
1. Culture\t1.1\tThermal Cycler
\t1.2\tIncubator Shaker
`.trim();
  const { steps } = parseProtocol(raw, equipToStations());
  // Incubator Shaker lives at Microbial Culture Processing (F1) and Microbial
  // Incubators (E2); coming from PCR (D3), E2 should be closer than F1.
  const fromD3 = { E2: BENCH_DIST_FT.D3.E2, F1: BENCH_DIST_FT.D3.F1 };
  const nearer = fromD3.E2 < fromD3.F1 ? "E2" : "F1";
  assert.equal(steps[0].substeps[1].station, nearer);
});

test("travelFt and path are computed per step, and fullPath concatenates every step in order", () => {
  const raw = `
1. A\t1.1\tOpentrons Flex Robot
\t1.2\tNanoDrop 2000
2. B\t2.1\tBiorad Gel Doc XR+ Imaging System
`.trim();
  const { steps, fullPath, fullTravelFt, fullStationsVisited } = parseProtocol(raw, equipToStations());
  assert.deepEqual(steps[0].path, ["A3", "C1"]);
  assert.equal(steps[0].travelFt, Math.round(BENCH_DIST_FT.A3.C1));
  assert.deepEqual(fullPath, ["A3", "C1", "C3"]);
  // The whole-protocol total includes the A3->C1->C3 walk across both steps,
  // not just the sum of each step's own (smaller) internal total.
  assert.equal(fullTravelFt, Math.round(BENCH_DIST_FT.A3.C1 + BENCH_DIST_FT.C1.C3));
  assert.equal(fullStationsVisited, 3);
});

test("empty input parses cleanly", () => {
  const { steps, fullPath, errors } = parseProtocol("", equipToStations());
  assert.deepEqual(steps, []);
  assert.deepEqual(fullPath, []);
  assert.deepEqual(errors, []);
});

test("equipment matching is case-insensitive", () => {
  const raw = `1. A\t1.1\tOPENTRONS FLEX ROBOT`.trim();
  const { steps } = parseProtocol(raw, equipToStations());
  assert.equal(steps[0].substeps[0].station, "A3");
});

test("a leading name line (no header) is captured as the protocol name", () => {
  const raw = `
Overnight Culture Prep
1. Prepare Reagents\t1.1\tOpentrons Flex Robot
`.trim();
  const { name, steps, errors } = parseProtocol(raw, equipToStations());
  assert.equal(errors.length, 0);
  assert.equal(name, "Overnight Culture Prep");
  assert.equal(steps[0].substeps[0].station, "A3");
});

test("a leading name line followed by a header row is captured, and the header is still skipped", () => {
  const raw = `
Overnight Culture Prep
Step\tSubstep\tEquipment
1. Prepare Reagents\t1.1\tOpentrons Flex Robot
`.trim();
  const { name, steps, errors } = parseProtocol(raw, equipToStations());
  assert.equal(errors.length, 0);
  assert.equal(name, "Overnight Culture Prep");
  assert.equal(steps.length, 1);
  assert.equal(steps[0].substeps.length, 1);
});

test("a paste with no name line (data starts immediately) leaves name null", () => {
  const raw = `1. Prepare Reagents\t1.1\tOpentrons Flex Robot`.trim();
  const { name } = parseProtocol(raw, equipToStations());
  assert.equal(name, null);
});

test("a bare header row with no name line leaves name null instead of capturing 'Step'", () => {
  const raw = `
Step\tSubstep\tEquipment
1. Prepare Reagents\t1.1\tOpentrons Flex Robot
`.trim();
  const { name } = parseProtocol(raw, equipToStations());
  assert.equal(name, null);
});

test("error line numbers still point at the original pasted line when a name and header row are skipped", () => {
  const raw = `
Overnight Culture Prep
Step\tSubstep\tEquipment
1. Prepare Reagents\t1.1\tOpentrons Flex Robot
\tnot-a-label\tNanoDrop 2000
`.trim();
  const { errors } = parseProtocol(raw, equipToStations());
  assert.match(errors[0], /^Row 4:/);
});
