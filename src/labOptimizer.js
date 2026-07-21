import { mulberry32 } from "./rng.js";
import { parseProtocol } from "./protocolImport.js";
import {
  BENCH_NAMES, STATION_NAME, FIXTURES, isFixtureId,
  TOUCHING_PAIRS, DEFAULT_TRIO_ANCHOR, trioFixturesForAnchor,
  DIST_TABLES_BY_ANCHOR, PIPETTE_STATION_NAMES,
} from "./data.js";

const randInt = (rng, min, max) => min + Math.floor(rng() * (max - min + 1));

// An identity permutation: every bench keeps the name it has today. This is
// always evaluated as a candidate (see optimizeLayout below), so the Lab
// Optimizer can never recommend something worse than the real, current floor.
function identityBenchOf() {
  const benchOf = {};
  for (const [id, name] of Object.entries(BENCH_NAMES)) benchOf[name] = id;
  return benchOf;
}

function shuffled(arr, rng) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function randomBenchOf(rng) {
  const names = Object.keys(identityBenchOf());
  const ids = shuffled(Object.keys(BENCH_NAMES), rng);
  const benchOf = {};
  names.forEach((name, i) => { benchOf[name] = ids[i]; });
  return benchOf;
}

// Constraint 1 (only the fixed A1-H3 grid) is structural: `benchOf` only ever
// holds ids drawn from BENCH_NAMES's own keys, so a candidate can't invent a
// new location. Constraint 2 (Sink/Glassware/Consumables 1&2/Refrigerator never
// move) is structural too — those 5 fixtures aren't bench names, so they're
// never part of `benchOf` and never touched by remapId below. Constraint 3
// (the sharps/recycling/biohazard trio can only relocate, as a group, to one of
// the 3 touching-pair anchors) is handled by DIST_TABLES_BY_ANCHOR /
// trioFixturesForAnchor, which already keep the trio's own fixed internal order.
function remapId(id, benchOf) {
  if (isFixtureId(id)) return id;
  return benchOf[STATION_NAME[id]];
}

function remapEquipToStations(equipToStations, benchOf) {
  const out = {};
  for (const [equip, ids] of Object.entries(equipToStations)) out[equip] = ids.map((id) => remapId(id, benchOf));
  return out;
}

function pipetteStationsFor(benchOf) {
  return PIPETTE_STATION_NAMES.map((name) => benchOf[name]);
}

// The score a candidate (benchOf, anchorKey) gets: total travel distance summed
// across every pasted protocol, resolved exactly the way the Protocol
// Visualizer resolves a real one (nearest-station walks via parseProtocol) —
// just fed a remapped equipment map and an anchor-specific distance table
// instead of the real, current ones.
function totalTravelFt(benchOf, anchorKey, equipToStations, protocolTexts) {
  const remapped = remapEquipToStations(equipToStations, benchOf);
  const distTable = DIST_TABLES_BY_ANCHOR[anchorKey];
  const pipetteStations = pipetteStationsFor(benchOf);
  let total = 0;
  for (const raw of protocolTexts) total += parseProtocol(raw, remapped, distTable, pipetteStations).fullTravelFt;
  return total;
}

// Randomized local search (simulated annealing over pairwise bench-name swaps):
// exact search is impossible (24! permutations), so this takes a fixed budget
// of swap attempts per restart, accepting worse swaps early on with a
// decreasing probability so it can climb out of local minima, and always
// remembers the best candidate seen. `startBenchOf` is evaluated as-is even if
// no swap ever improves on it, so a restart can never make things worse.
function hillClimb(startBenchOf, anchorKey, equipToStations, protocolTexts, rng, iterations) {
  const names = Object.keys(startBenchOf);
  let current = { ...startBenchOf };
  let currentFt = totalTravelFt(current, anchorKey, equipToStations, protocolTexts);
  let best = current, bestFt = currentFt;
  const t0 = Math.max(1, currentFt * 0.05);

  for (let iter = 0; iter < iterations; iter++) {
    const i = randInt(rng, 0, names.length - 1);
    let j = randInt(rng, 0, names.length - 1);
    while (j === i) j = randInt(rng, 0, names.length - 1);
    const candidate = { ...current };
    const ni = names[i], nj = names[j];
    [candidate[ni], candidate[nj]] = [candidate[nj], candidate[ni]];
    const candidateFt = totalTravelFt(candidate, anchorKey, equipToStations, protocolTexts);
    const delta = candidateFt - currentFt;
    const temp = Math.max(1e-6, t0 * (1 - iter / iterations));
    if (delta <= 0 || rng() < Math.exp(-delta / temp)) {
      current = candidate; currentFt = candidateFt;
      if (currentFt < bestFt) { best = current; bestFt = currentFt; }
    }
  }
  return { benchOf: best, totalFt: bestFt };
}

// The annealing search happily wanders across benches whose arrangement makes
// no difference to the pasted protocols (any station never visited costs the
// same wherever it sits), so its raw output can differ from the baseline in
// places that don't matter. This greedily un-does one displaced name at a time
// — swapping it back to its baseline position, together with whoever's
// currently squatting there — keeping the swap whenever it doesn't make the
// total any worse, until no more reverts help. What's left is the smallest set
// of moves that still achieves the best score found, which is what actually
// belongs in a "recommended moves" list.
function minimizeMoves(benchOf, anchorKey, equipToStations, protocolTexts, baselineBenchOf, startFt) {
  let current = { ...benchOf };
  let currentFt = startFt;
  let improved = true;
  while (improved) {
    improved = false;
    for (const name of Object.keys(current)) {
      if (current[name] === baselineBenchOf[name]) continue;
      const targetId = baselineBenchOf[name];
      const otherName = Object.keys(current).find((n) => current[n] === targetId);
      if (!otherName) continue;
      const candidate = { ...current };
      [candidate[name], candidate[otherName]] = [candidate[otherName], candidate[name]];
      const candidateFt = totalTravelFt(candidate, anchorKey, equipToStations, protocolTexts);
      if (candidateFt <= currentFt) {
        current = candidate; currentFt = candidateFt; improved = true;
      }
    }
  }
  return { benchOf: current, totalFt: currentFt };
}

function stationNamesForLayout(benchOf) {
  const out = { ...STATION_NAME };
  for (const [name, id] of Object.entries(benchOf)) out[id] = name;
  return out;
}

function fixturesForLayout(anchorKey) {
  return anchorKey === DEFAULT_TRIO_ANCHOR ? FIXTURES : { ...FIXTURES, ...trioFixturesForAnchor(anchorKey) };
}

// station id -> equipment list under this layout, the same shape labTable.js's
// stationEquip has — ready to hand straight to LabMap's stationEquip prop so a
// hovered position on the optimized map shows what's actually there now.
function stationEquipForLayout(remapped) {
  const stationEquip = {};
  for (const [equip, ids] of Object.entries(remapped)) {
    for (const id of ids) (stationEquip[id] ??= []).push(equip);
  }
  for (const id in stationEquip) stationEquip[id].sort();
  return stationEquip;
}

function describeLayout(benchOf, anchorKey, equipToStations, protocolTexts) {
  const remapped = remapEquipToStations(equipToStations, benchOf);
  const distTable = DIST_TABLES_BY_ANCHOR[anchorKey];
  const pipetteStations = pipetteStationsFor(benchOf);
  // How many times each station is actually stepped on across every pasted
  // protocol, under this layout — the heat map's data, tallied for free off
  // the same parse each protocol already needs for its travelFt/errors.
  const visitCounts = {};
  const perProtocol = protocolTexts.map((raw, i) => {
    const parsed = parseProtocol(raw, remapped, distTable, pipetteStations);
    for (const id of parsed.fullPath) visitCounts[id] = (visitCounts[id] || 0) + 1;
    return {
      index: i, name: parsed.name || `Protocol ${i + 1}`,
      travelFt: parsed.fullTravelFt, stationsVisited: parsed.fullStationsVisited, errors: parsed.errors,
    };
  });
  return {
    anchorKey, benchOf,
    totalTravelFt: perProtocol.reduce((sum, p) => sum + p.travelFt, 0),
    perProtocol,
    stationNames: stationNamesForLayout(benchOf),
    fixtures: fixturesForLayout(anchorKey),
    stationEquip: stationEquipForLayout(remapped),
    visitCounts,
  };
}

/* Searches for a station layout that minimizes total travel distance across a set
   of pasted protocols (same Step/Substep/Equipment format as the Protocol
   Visualizer), subject to 3 constraints on what's allowed to move:

   1) Only the fixed A1-H3 grid exists — a candidate layout is a permutation of
      the 24 real bench names across the 24 real bench positions, never a new
      location (`identityBenchOf`/`randomBenchOf`/`remapId` only ever draw from
      BENCH_NAMES's own ids).
   2) The Sink, Glassware, Consumables 1, Consumables 2, and the 4C Refrigerator
      never move — they're fixtures, not bench names, so they're never part of
      `benchOf` and `remapId` passes their id straight through untouched.
   3) The sharps bin, recycling bin, and biohazard waste keep their fixed
      relative order (sharps, then recycling, then biohazard, left to right) but
      can relocate together to any of the 3 touching column-pairs (B-C, D-E,
      F-G — see TOUCHING_PAIRS in data.js); `anchorKey` picks which one, and
      DIST_TABLES_BY_ANCHOR/trioFixturesForAnchor already keep that order fixed.

   Since exhaustively trying all 24! bench permutations (x3 anchors) is
   impossible, this runs a seeded randomized local search per anchor (see
   hillClimb) — several restarts (one always the real, current layout, so the
   result is never worse than doing nothing) doing simulated-annealing swaps —
   and keeps the best of everything it tried. That raw result can still differ
   from the real layout in places that don't actually affect any pasted
   protocol (the search has no reason to prefer the baseline among equally-good
   options), so `minimizeMoves` then reverts every displaced bench it can put
   back without losing any of the improvement found, leaving only the moves
   that matter. Neither step claims a provably optimal layout, just the best
   (and smallest) one this search happened to find.

   Returns `baseline` and `best` (each `{ anchorKey, benchOf, totalTravelFt,
   perProtocol, stationNames, fixtures, stationEquip, visitCounts }` —
   `stationNames`/`fixtures`/`stationEquip`/`visitCounts` are ready to hand
   straight to LabMap's props, `visitCounts` being the per-station tally
   powering its heat map), `moves` (bench names whose position changed,
   `{ name, from, to }`), `totalMoves` (`moves.length`, plus 3 if the trio
   relocated — it's a group of 3 real stations even though it's reported as
   one `anchorChanged` flag rather than 3 more `moves` rows), `anchorChanged`,
   `improvementFt`, `improvementPct`, and `warnings`. */
export function optimizeLayout(equipToStations, protocolTexts, opts = {}) {
  const { seed = 1234, restarts = 3, iterationsPerRestart = 150 } = opts;
  const cleanTexts = (protocolTexts || []).map((t) => t || "").filter((t) => t.trim());

  const warnings = [];
  if (Object.keys(equipToStations || {}).length === 0) warnings.push("No equipment loaded — build the lab map first.");
  if (cleanTexts.length === 0) warnings.push("No protocols pasted — nothing to optimize against.");
  if (warnings.length > 0) {
    return { baseline: null, best: null, moves: [], totalMoves: 0, anchorChanged: false, improvementFt: 0, improvementPct: 0, warnings };
  }

  const rng = mulberry32(seed);
  const baselineBenchOf = identityBenchOf();
  let bestBenchOf = baselineBenchOf, bestAnchorKey = DEFAULT_TRIO_ANCHOR;
  let bestFt = totalTravelFt(baselineBenchOf, DEFAULT_TRIO_ANCHOR, equipToStations, cleanTexts);

  for (const anchorKey of Object.keys(TOUCHING_PAIRS)) {
    const starts = [identityBenchOf(), ...Array.from({ length: Math.max(0, restarts - 1) }, () => randomBenchOf(rng))];
    for (const start of starts) {
      const { benchOf, totalFt } = hillClimb(start, anchorKey, equipToStations, cleanTexts, rng, iterationsPerRestart);
      if (totalFt < bestFt) { bestFt = totalFt; bestBenchOf = benchOf; bestAnchorKey = anchorKey; }
    }
  }

  ({ benchOf: bestBenchOf, totalFt: bestFt } = minimizeMoves(bestBenchOf, bestAnchorKey, equipToStations, cleanTexts, baselineBenchOf, bestFt));

  const baseline = describeLayout(baselineBenchOf, DEFAULT_TRIO_ANCHOR, equipToStations, cleanTexts);
  const best = describeLayout(bestBenchOf, bestAnchorKey, equipToStations, cleanTexts);

  const moves = [];
  for (const [name, id] of Object.entries(best.benchOf)) {
    if (id !== baseline.benchOf[name]) moves.push({ name, from: baseline.benchOf[name], to: id });
  }
  const anchorChanged = best.anchorKey !== baseline.anchorKey;
  const totalMoves = moves.length + (anchorChanged ? 3 : 0); // the trio is 3 real stations moving together
  const improvementFt = baseline.totalTravelFt - best.totalTravelFt;
  const improvementPct = baseline.totalTravelFt > 0 ? Math.round((improvementFt / baseline.totalTravelFt) * 1000) / 10 : 0;

  return { baseline, best, moves, totalMoves, anchorChanged, improvementFt, improvementPct, warnings };
}
