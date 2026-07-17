import test from "node:test";
import assert from "node:assert/strict";
import { parseLabTable } from "../src/labTable.js";

test("parses a header row and tab-separated data", () => {
  const raw = "Equipment\tStation Name\tStation Location\nOpentrons Flex Robot\tAutomation Prep\tA1\nGel Doc\tGel Imaging\tC3";
  const t = parseLabTable(raw);
  assert.equal(t.errors.length, 0);
  assert.equal(t.rowCount, 2);
  assert.deepEqual(t.equipToStations["Opentrons Flex Robot"], ["A1"]);
  assert.deepEqual(t.stationEquip["C3"], ["Gel Doc"]);
  assert.deepEqual(t.stationNames["A1"], ["Automation Prep"]);
});

test("falls back to comma-separated rows and lowercases station locations get normalized", () => {
  const raw = "Pipette,Prep Bench,a1\nCentrifuge,DNA Prep,d2";
  const t = parseLabTable(raw);
  assert.equal(t.errors.length, 0);
  assert.deepEqual(t.equipToStations["Pipette"], ["A1"]);
  assert.deepEqual(t.equipToStations["Centrifuge"], ["D2"]);
});

test("one equipment can map to multiple stations across rows", () => {
  const raw = "Pipette\tPrep Bench\tA1\nPipette\tDry Chem\tB2";
  const t = parseLabTable(raw);
  assert.deepEqual(t.equipToStations["Pipette"], ["A1", "B2"]);
});

test("flags invalid station locations and missing equipment without throwing", () => {
  const raw = "Equipment\tStation Name\tStation Location\nGood Equip\tPrep\tA1\nBad Station\tPrep\tZ9\n\tPrep\tA2";
  const t = parseLabTable(raw);
  assert.equal(t.rowCount, 1);
  assert.equal(t.errors.length, 2);
  assert.match(t.errors[0], /Z9/);
});

test("handles a header-less table without dropping the first data row", () => {
  const raw = "Pipette\tPrep Bench\tA1";
  const t = parseLabTable(raw);
  assert.equal(t.rowCount, 1);
  assert.deepEqual(t.equipToStations["Pipette"], ["A1"]);
});

test("station name is optional", () => {
  const raw = "Pipette\t\tA1";
  const t = parseLabTable(raw);
  assert.equal(t.errors.length, 0);
  assert.deepEqual(t.equipToStations["Pipette"], ["A1"]);
  assert.equal(t.stationNames["A1"], undefined);
});

test("empty input parses cleanly", () => {
  const t = parseLabTable("");
  assert.equal(t.rowCount, 0);
  assert.equal(t.errors.length, 0);
});

test("one row can list multiple locations for one equipment, sharing a single station name", () => {
  const raw = "Incubator Shaker\tMED Prep\tF1, F2, F3";
  const t = parseLabTable(raw);
  assert.equal(t.errors.length, 0);
  assert.equal(t.rowCount, 1);
  assert.deepEqual(t.equipToStations["Incubator Shaker"], ["F1", "F2", "F3"]);
  assert.deepEqual(t.stationEquip["F2"], ["Incubator Shaker"]);
  assert.deepEqual(t.stationNames["F3"], ["MED Prep"]);
});

test("multiple locations pair up with multiple station names by position", () => {
  const raw = "Microscope\tSpectroscopy A; Spectroscopy B\tG1, G2";
  const t = parseLabTable(raw);
  assert.equal(t.errors.length, 0);
  assert.deepEqual(t.equipToStations["Microscope"], ["G1", "G2"]);
  assert.deepEqual(t.stationNames["G1"], ["Spectroscopy A"]);
  assert.deepEqual(t.stationNames["G2"], ["Spectroscopy B"]);
});

test("a bad location inside a multi-location cell is reported without dropping the valid ones", () => {
  const raw = "Shaker\tSpectroscopy\tG1, Z9, G3";
  const t = parseLabTable(raw);
  assert.equal(t.rowCount, 1);
  assert.equal(t.errors.length, 1);
  assert.match(t.errors[0], /Z9/);
  assert.deepEqual(t.equipToStations["Shaker"], ["G1", "G3"]);
});

test("the 5 baseline fixtures are valid station locations, same as a bench code", () => {
  const raw = "Autoclave Bags\tBiohazard Disposal\tWASTE\nUsed Tips\tSharps Disposal\tsharps";
  const t = parseLabTable(raw);
  assert.equal(t.errors.length, 0);
  assert.deepEqual(t.equipToStations["Autoclave Bags"], ["WASTE"]);
  assert.deepEqual(t.equipToStations["Used Tips"], ["SHARPS"]); // lowercase input normalizes to uppercase
});

test("the 5 fixtures are always present as their own baseline equipment, even on an empty paste", () => {
  const t = parseLabTable("");
  assert.deepEqual(t.equipToStations["Sharps"], ["SHARPS"]);
  assert.deepEqual(t.equipToStations["Recycle"], ["RECYCLE"]);
  assert.deepEqual(t.equipToStations["Biohazardous Waste"], ["WASTE"]);
  assert.deepEqual(t.equipToStations["Sink"], ["SINK"]);
  assert.deepEqual(t.equipToStations["Consumables"], ["CONSUM"]);
  for (const id of ["SHARPS", "RECYCLE", "WASTE", "SINK", "CONSUM"]) assert.equal(t.stationEquip[id].length, 1);
});

test("a pasted row at a fixture station adds alongside the baseline fixture equipment, not instead of it", () => {
  const raw = "Autoclave Bags\tBiohazard Disposal\tWASTE";
  const t = parseLabTable(raw);
  assert.deepEqual(t.stationEquip["WASTE"], ["Autoclave Bags", "Biohazardous Waste"]);
});
