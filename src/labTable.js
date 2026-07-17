import { NAME_TO_STATION_ID } from "./data.js";

export const isValidStationName = (name) => Object.prototype.hasOwnProperty.call(NAME_TO_STATION_ID, name.toLowerCase());
const HEADER_WORDS = /^(equipment|instrument|device)$/i;

const splitRow = (line) => (line.includes("\t") ? line.split("\t") : line.split(","))
  .map((c) => c.trim());
// A single cell can list more than one station ("NanoDrop, PCR" or "NanoDrop; PCR"),
// since one piece of equipment (an incubator shaker, a fridge, ...) commonly lives at
// several stations at once.
const splitMulti = (cell) => (cell || "").split(/[,;]/).map((c) => c.trim()).filter(Boolean);

/* Parses a table pasted from a spreadsheet (tab-separated; falls back to comma-
   separated) with columns [Equipment, Station Name]. Station names must match one
   of the lab's fixed station names exactly (case-insensitively) — see STATION_NAME
   in data.js; the internal A1-H3/SHARPS-style ids are never something a pasted
   table needs to know about. A cell may list multiple station names for the same
   equipment row (comma/semicolon-separated) — every valid one gets the equipment
   added to it. Invalid names are reported per-location without dropping the rest of
   that row. Auto-detects and skips a header row. Every fixture (sharps bin, sink,
   consumables storage, ...) is just another valid station name — none of them come
   with any equipment built in; the only equipment that ever ends up in
   `equipToStations`/`stationEquip` is whatever the pasted table explicitly maps, at
   a bench or a fixture alike. Returns `equipToStations` (equipment → station ids),
   `stationEquip` (station id → equipment list), and `errors` so bad paste data is
   visible instead of silently dropped. */
export function parseLabTable(raw) {
  const lines = String(raw || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const errors = [];
  if (lines.length === 0) return { equipToStations: {}, stationEquip: {}, rowCount: 0, errors };

  let rows = lines.map(splitRow);
  const [first] = rows;
  const firstNames = splitMulti(first[1]);
  if (HEADER_WORDS.test(first[0] || "") || !firstNames.some(isValidStationName)) {
    rows = rows.slice(1);
  }

  const equipToStations = {};
  const stationEquip = {};
  let rowCount = 0;

  rows.forEach((cols, i) => {
    const lineNo = i + 2; // +1 for header, +1 for 1-indexing
    const equipment = (cols[0] || "").trim();
    const names = splitMulti(cols[1]);
    if (!equipment) { errors.push(`Row ${lineNo}: missing equipment name`); return; }
    if (names.length === 0) { errors.push(`Row ${lineNo}: missing station name`); return; }

    let addedAny = false;
    names.forEach((raw) => {
      if (!isValidStationName(raw)) { errors.push(`Row ${lineNo}: "${raw}" is not a valid station name`); return; }
      const station = NAME_TO_STATION_ID[raw.toLowerCase()];
      addedAny = true;
      (equipToStations[equipment] ??= new Set()).add(station);
      (stationEquip[station] ??= new Set()).add(equipment);
    });
    if (addedAny) rowCount++;
  });

  return {
    equipToStations: mapValues(equipToStations, (s) => [...s].sort()),
    stationEquip: mapValues(stationEquip, (s) => [...s].sort()),
    rowCount,
    errors,
  };
}

function mapValues(obj, fn) {
  const out = {};
  for (const k in obj) out[k] = fn(obj[k]);
  return out;
}
