import test from "node:test";
import assert from "node:assert/strict";
import { parseLabTable } from "../src/labTable.js";

test("parses a header row and tab-separated data", () => {
  const raw = "Equipment\tStation Name\nOpentrons Flex Robot\tHamilton\nGel Doc\tGel Imaging";
  const t = parseLabTable(raw);
  assert.equal(t.errors.length, 0);
  assert.equal(t.rowCount, 2);
  assert.deepEqual(t.equipToStations["Opentrons Flex Robot"], ["A3"]);
  assert.deepEqual(t.stationEquip["C3"], ["Gel Doc"]);
});

test("falls back to comma-separated rows and matches station names case-insensitively", () => {
  const raw = "Pipette,hamilton\nCentrifuge,pcr";
  const t = parseLabTable(raw);
  assert.equal(t.errors.length, 0);
  assert.deepEqual(t.equipToStations["Pipette"], ["A3"]);
  assert.deepEqual(t.equipToStations["Centrifuge"], ["D3"]);
});

test("one equipment can map to multiple stations across rows", () => {
  const raw = "Pipette\tHamilton\nPipette\tDry Chemical Prep";
  const t = parseLabTable(raw);
  assert.deepEqual(t.equipToStations["Pipette"], ["A3", "B2"]);
});

test("flags invalid station names and missing equipment without throwing", () => {
  const raw = "Equipment\tStation Name\nGood Equip\tHamilton\nBad Station\tNot A Real Station\n\tPCR";
  const t = parseLabTable(raw);
  assert.equal(t.rowCount, 1);
  assert.equal(t.errors.length, 2);
  assert.match(t.errors[0], /Not A Real Station/);
});

test("handles a header-less table without dropping the first data row", () => {
  const raw = "Pipette\tHamilton";
  const t = parseLabTable(raw);
  assert.equal(t.rowCount, 1);
  assert.deepEqual(t.equipToStations["Pipette"], ["A3"]);
});

test("empty input parses cleanly", () => {
  const t = parseLabTable("");
  assert.equal(t.rowCount, 0);
  assert.equal(t.errors.length, 0);
});

test("one row can list multiple station names for one equipment", () => {
  const raw = "Incubator Shaker\tGC-MS 1, GC-MS 2, Microbial Incubators";
  const t = parseLabTable(raw);
  assert.equal(t.errors.length, 0);
  assert.equal(t.rowCount, 1);
  assert.deepEqual(t.equipToStations["Incubator Shaker"], ["E2", "F2", "F3"]);
  assert.deepEqual(t.stationEquip["F2"], ["Incubator Shaker"]);
});

test("a bad name inside a multi-station cell is reported without dropping the valid ones", () => {
  const raw = "Shaker\tResearch, Not A Real Station, Small Equipment";
  const t = parseLabTable(raw);
  assert.equal(t.rowCount, 1);
  assert.equal(t.errors.length, 1);
  assert.match(t.errors[0], /Not A Real Station/);
  assert.deepEqual(t.equipToStations["Shaker"], ["G1", "H1"]);
});

test("the 5 fixtures are valid station names, matched by their display name", () => {
  const raw = "Autoclave Bags\tBiohazard Waste\nUsed Tips\tsharps bin";
  const t = parseLabTable(raw);
  assert.equal(t.errors.length, 0);
  assert.deepEqual(t.equipToStations["Autoclave Bags"], ["WASTE"]);
  assert.deepEqual(t.equipToStations["Used Tips"], ["SHARPS"]); // case-insensitive
});

test("the 3 new destination fixtures are valid station names too", () => {
  const raw = "Beakers\tGlassware\nTip Boxes\tConsumables 1\nFrozen Reagents\t4C Refrigerator";
  const t = parseLabTable(raw);
  assert.equal(t.errors.length, 0);
  assert.deepEqual(t.equipToStations["Beakers"], ["GLASSWARE"]);
  assert.deepEqual(t.equipToStations["Tip Boxes"], ["CONSUM1"]);
  assert.deepEqual(t.equipToStations["Frozen Reagents"], ["REFRIGERATOR"]);
});

test("no fixture carries any built-in equipment — an empty paste maps nothing at all", () => {
  const t = parseLabTable("");
  assert.deepEqual(t.equipToStations, {});
  for (const id of ["SHARPS", "RECYCLE", "WASTE", "SINK", "GLASSWARE", "CONSUM1", "CONSUM2", "REFRIGERATOR"]) {
    assert.equal(t.stationEquip[id], undefined);
  }
});

test("a pasted row at a fixture station is the only equipment mapped there", () => {
  const raw = "Autoclave Bags\tBiohazard Waste";
  const t = parseLabTable(raw);
  assert.deepEqual(t.stationEquip["WASTE"], ["Autoclave Bags"]);
});
