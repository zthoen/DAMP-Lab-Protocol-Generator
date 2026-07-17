import { STATION_IDS, FIXTURE_EQUIPMENT } from "./data.js";

export const isValidStationCode = (code) => STATION_IDS.includes(code);
const HEADER_WORDS = /^(equipment|instrument|device)$/i;

const splitRow = (line) => (line.includes("\t") ? line.split("\t") : line.split(","))
  .map((c) => c.trim());
// A single cell can list more than one station ("A1, A2, A3" or "A1; A2"), since one
// piece of equipment (an incubator shaker, a fridge, ...) commonly lives at several
// benches at once.
const splitMulti = (cell) => (cell || "").split(/[,;]/).map((c) => c.trim()).filter(Boolean);

/* Parses a table pasted from a spreadsheet (tab-separated; falls back to comma-
   separated) with columns [Equipment, Station Name, Station Location]. Station
   locations must land on the fixed A1-H3 bench grid or name one of the 5 baseline
   fixtures (see STATION_IDS in data.js). Either cell may list multiple stations for
   the same equipment row (comma/semicolon-separated) — every valid location gets
   the equipment added to it; station names pair up by position when both lists are
   the same length, otherwise the last given name is reused for any extra locations.
   Returns every lookup the Lab Builder / Protocol Generator need, plus row-level
   errors so bad paste data is visible instead of silently dropped. */
export function parseLabTable(raw) {
  const lines = String(raw || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const errors = [];
  if (lines.length === 0) return withFixtureEquipment({ equipToStations: {}, stationEquip: {}, stationNames: {}, rowCount: 0, errors });

  let rows = lines.map(splitRow);
  const [first] = rows;
  const firstLocs = splitMulti(first[2]);
  if (HEADER_WORDS.test(first[0] || "") || !firstLocs.some((l) => isValidStationCode(l.toUpperCase()))) {
    rows = rows.slice(1);
  }

  const equipToStations = {};
  const stationEquip = {};
  const stationNames = {};
  let rowCount = 0;

  rows.forEach((cols, i) => {
    const lineNo = i + 2; // +1 for header, +1 for 1-indexing
    const equipment = (cols[0] || "").trim();
    const names = splitMulti(cols[1]);
    const locs = splitMulti(cols[2]);
    if (!equipment) { errors.push(`Row ${lineNo}: missing equipment name`); return; }
    if (locs.length === 0) { errors.push(`Row ${lineNo}: missing station location`); return; }

    let addedAny = false;
    locs.forEach((raw, idx) => {
      const station = raw.toUpperCase();
      if (!isValidStationCode(station)) { errors.push(`Row ${lineNo}: "${raw}" is not a valid station location (expected A1-H3, or a fixture like SHARPS/RECYCLE/WASTE/SINK/CONSUM)`); return; }
      addedAny = true;
      (equipToStations[equipment] ??= new Set()).add(station);
      (stationEquip[station] ??= new Set()).add(equipment);
      const name = names[idx] ?? names[names.length - 1];
      if (name) (stationNames[station] ??= new Set()).add(name);
    });
    if (addedAny) rowCount++;
  });

  return withFixtureEquipment({
    equipToStations: mapValues(equipToStations, (s) => [...s].sort()),
    stationEquip: mapValues(stationEquip, (s) => [...s].sort()),
    stationNames: mapValues(stationNames, (s) => [...s]),
    rowCount,
    errors,
  });
}

function mapValues(obj, fn) {
  const out = {};
  for (const k in obj) out[k] = fn(obj[k]);
  return out;
}

// The 5 baseline fixtures are equipment at their own fixed location, present in
// every parsed table regardless of what was pasted — retrieving from
// consumables or disposing of waste is itself equipment to use, not just a
// destination on the map.
function withFixtureEquipment(result) {
  for (const [station, equipment] of Object.entries(FIXTURE_EQUIPMENT)) {
    const stations = new Set(result.equipToStations[equipment] || []);
    stations.add(station);
    result.equipToStations[equipment] = [...stations].sort();

    const equipHere = new Set(result.stationEquip[station] || []);
    equipHere.add(equipment);
    result.stationEquip[station] = [...equipHere].sort();
  }
  return result;
}
