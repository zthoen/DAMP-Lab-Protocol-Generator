import { BENCH_DIST_FT, PIPETTE_STATIONS } from "./data.js";
import { classifyStepType } from "./stepType.js";

// A step whose Equipment cell literally reads "Pipette" doesn't name a
// specific piece of equipment — it's resolved against PIPETTE_STATIONS (any
// bench with pipettes and bench space) instead of the pasted equipment list.
// Exported so the Lab Optimizer can recognize the same substeps while
// pre-parsing a protocol, without duplicating this pattern.
export const PIPETTE_LABEL = /^pipette$/i;

const splitRow = (line) => (line.includes("\t") ? line.split("\t") : line.split(","))
  .map((c) => c.trim());

// A Step cell reads "N. Name" (e.g. "1. Prepare Reagents") and only appears on
// the first row of that step's block — every later substep row leaves it blank,
// the way a merged spreadsheet cell pastes. A Substep cell is strictly "N.M"
// (e.g. "1.2"), never followed by a name, which is what tells the two apart.
const STEP_RE = /^(\d+)\.\s*(.+)$/;
const SUBSTEP_RE = /^(\d+)\.(\d+)$/;

// Of an equipment's known stations, the one closest to `from` — a real
// technician re-using a piece of equipment that lives in more than one place
// would walk to whichever instance is nearest, not the farthest (that's the
// opposite goal from protocolGen.js's fake-protocol generator, which picks the
// farthest station on purpose to force movement across an invented protocol;
// here we're plotting the route of a real one, so the realistic choice is
// "closest to where you already are").
function nearestStation(stations, from, distTable) {
  if (!from) return stations[0];
  return stations.reduce((best, s) => (distTable[from][s] < distTable[from][best] ? s : best), stations[0]);
}

function travelFtOf(stations, distTable) {
  let ft = 0;
  for (let i = 1; i < stations.length; i++) ft += distTable[stations[i - 1]][stations[i]];
  return Math.round(ft);
}

// A bare header row's first cell (no protocol name given) — kept out of `name`
// so a paste that skips straight to a header doesn't get labeled "Step".
const HEADER_WORD = /^step$/i;

/* Parses a real protocol pasted from a spreadsheet (tab-separated; falls back to
   comma-separated). The first line is the protocol's own name, a single title
   above the table (e.g. "Overnight Culture Prep") — unless it's already a valid
   data row (its Substep cell already looks like "N.M"), which keeps a paste that
   skips straight to data working unchanged. An optional header row (e.g. "Step
   \tSubstep\tEquipment") may follow; after that, columns are [Step, Substep,
   Equipment] — extra trailing columns (notes, durations, ...) are ignored.
   Equipment names are matched case-insensitively against `equipToStations` (the
   same equipment map the Equipment Input tab loads) to find where each substep
   happens; if an equipment name isn't a name loaded on the map, that substep is
   still kept (for the formatted view) but has no station and doesn't contribute
   to any path. When equipment lives at more than one station, the nearest one to
   the previous substep's station is used, so the plotted route stays a single
   continuous walk across the *whole* protocol, not just within one step. A step
   whose Equipment cell reads exactly "Pipette" is the one exception to "only
   equipment the pasted list explicitly maps" — it's resolved against the fixed
   `PIPETTE_STATIONS` pool (data.js) the same nearest-station way, since a pipette
   isn't one specific piece of equipment tied to one bench.

   Returns `name` (the protocol's title, or null if the paste didn't have one),
   `steps` (one entry per step number, in ascending order, each with its own
   `substeps`, `path` — the ordered, station-only list for that step's own
   route — `stationsVisited`, and `travelFt`), `fullPath` (every step's path
   concatenated, for the whole-protocol route), and `errors`.

   `distTable` and `pipetteStations` default to the real, current floor
   (BENCH_DIST_FT, PIPETTE_STATIONS) — the Lab Optimizer is the only caller
   that ever passes different ones, to score a candidate station layout
   (including where its 8 pipette-eligible benches ended up) without needing
   its own copy of this same nearest-station walking logic. */
export function parseProtocol(raw, equipToStations = {}, distTable = BENCH_DIST_FT, pipetteStations = PIPETTE_STATIONS) {
  // Unlike labTable.js's rows, a blank leading cell here is meaningful (it's how
  // a continued step's Step column is marked) — trimming a whole line would
  // strip that leading tab and shift every column over, so only fully-blank
  // lines are dropped; individual cells are trimmed after splitting instead.
  const lines = String(raw || "").split(/\r?\n/).filter((l) => l.trim() !== "");
  const errors = [];
  if (lines.length === 0) return { name: null, steps: [], fullPath: [], errors };

  const equipLookup = {};
  for (const eq of Object.keys(equipToStations)) equipLookup[eq.toLowerCase()] = eq;

  let rows = lines.map(splitRow);
  let name = null;
  let skipped = 0;

  if (!SUBSTEP_RE.test(rows[0][1] || "")) {
    const candidate = (rows[0][0] || "").trim();
    if (!HEADER_WORD.test(candidate)) name = candidate || null;
    rows = rows.slice(1);
    skipped++;
  }
  if (rows.length > 0 && !SUBSTEP_RE.test(rows[0][1] || "")) { rows = rows.slice(1); skipped++; } // header row

  const stepsByNumber = new Map();
  let lastStation = null;

  rows.forEach((cols, i) => {
    const lineNo = i + skipped + 1; // +1 for 1-indexing
    const stepCell = (cols[0] || "").trim();
    const substepCell = (cols[1] || "").trim();
    const equipment = (cols[2] || "").trim();

    const subMatch = SUBSTEP_RE.exec(substepCell);
    if (!subMatch) { errors.push(`Row ${lineNo}: "${substepCell}" is not a valid step.substep label`); return; }
    if (!equipment) { errors.push(`Row ${lineNo}: missing equipment`); return; }

    let station;
    if (PIPETTE_LABEL.test(equipment)) {
      station = nearestStation(pipetteStations, lastStation, distTable);
    } else {
      const canonical = equipLookup[equipment.toLowerCase()];
      const stations = canonical ? equipToStations[canonical] : null;
      if (!stations || stations.length === 0) {
        errors.push(`Row ${lineNo}: "${equipment}" isn't in the loaded equipment list`);
      }
      station = stations && stations.length ? nearestStation(stations, lastStation, distTable) : null;
    }
    if (station) lastStation = station;

    const stepNumber = Number(subMatch[1]);
    const stepMatch = STEP_RE.exec(stepCell);
    if (!stepsByNumber.has(stepNumber)) {
      stepsByNumber.set(stepNumber, { number: stepNumber, name: `Step ${stepNumber}`, substeps: [] });
    }
    const step = stepsByNumber.get(stepNumber);
    if (stepMatch) step.name = stepMatch[2];
    step.substeps.push({ label: substepCell, equipment, station, action: classifyStepType(equipment) });
  });

  const steps = [...stepsByNumber.values()].sort((a, b) => a.number - b.number).map((s) => {
    const path = s.substeps.map((sub) => sub.station).filter(Boolean);
    return { ...s, path, stationsVisited: new Set(path).size, travelFt: travelFtOf(path, distTable) };
  });

  // The whole protocol's travel distance is computed over the single
  // concatenated path, not summed from the per-step totals, so it also counts
  // the walk from one step's last station to the next step's first one.
  const fullPath = steps.flatMap((s) => s.path);
  const fullStationsVisited = new Set(fullPath).size;
  const fullTravelFt = travelFtOf(fullPath, distTable);
  return { name, steps, fullPath, fullStationsVisited, fullTravelFt, errors };
}
