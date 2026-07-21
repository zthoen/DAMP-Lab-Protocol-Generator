import { mulberry32 } from "./rng.js";
import { parseProtocol, PIPETTE_LABEL } from "./protocolImport.js";
import {
  BENCH_NAMES, STATION_NAME, FIXTURES, isFixtureId,
  TOUCHING_PAIRS, DEFAULT_TRIO_ANCHOR, trioFixturesForAnchor,
  DIST_TABLES_BY_ANCHOR, PIPETTE_STATION_NAMES,
} from "./data.js";

const ALL_BENCH_NAMES = Object.values(BENCH_NAMES);
const ALL_BENCH_IDS = Object.keys(BENCH_NAMES);

const randInt = (rng, min, max) => min + Math.floor(rng() * (max - min + 1));

// How many arrangements x steps the exact search is willing to fully
// enumerate for a single anchor before falling back to the heuristic search.
// Benchmarked at ~30ns per arrangement-step against this codebase's
// resolveSequence, so 5*10^7 targets roughly a 1.5s worst case — long enough
// to cover most realistic protocol sets exactly, short enough that
// LabOptimizerTab's "Optimizing…" state (a deferred call, so the button can
// repaint first) covers the wait comfortably. Exposed as `opts.exactBudget`
// so it can be tuned/tested.
const DEFAULT_EXACT_BUDGET = 50_000_000;

// An identity permutation: every bench keeps the name it has today. This is
// always evaluated as a candidate (see optimizeLayout below), so the Lab
// Optimizer can never recommend something worse than the real, current floor.
function identityBenchOf() {
  const benchOf = {};
  for (const [id, name] of Object.entries(BENCH_NAMES)) benchOf[name] = id;
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

// The score a candidate (benchOf, anchorKey) gets, computed the slow-but-
// proven way: resolved exactly the way the Protocol Visualizer resolves a
// real protocol (nearest-station walks via parseProtocol), just fed a
// remapped equipment map and an anchor-specific distance table instead of
// the real, current ones. This re-parses every protocol's text on every
// call, so the search below only calls it a handful of times (as a final
// safety-net check and inside minimizeMoves) — never inside the hot search
// loop, which uses the much cheaper resolveSequence/totalCostAll instead.
function totalTravelFt(benchOf, anchorKey, equipToStations, protocolTexts) {
  const remapped = remapEquipToStations(equipToStations, benchOf);
  const distTable = DIST_TABLES_BY_ANCHOR[anchorKey];
  const pipetteStations = pipetteStationsFor(benchOf);
  let total = 0;
  for (const raw of protocolTexts) total += parseProtocol(raw, remapped, distTable, pipetteStations).fullTravelFt;
  return total;
}

/* --- Fast, layout-independent search engine ---

   The search below never re-parses protocol text and never touches a bench
   name the pasted protocols don't actually reference — see planSteps/
   relevantNamesFrom/resolveSequence. Its result always gets double-checked
   against the slow, proven totalTravelFt above before being reported (see
   optimizeLayout), so a bug in this engine can only ever cause a missed
   improvement, never a wrong "optimized" number. */

// A step's resolution doesn't depend on layout at all except for *which*
// physical id each of its candidate stations ends up at — so parsing only
// needs to happen once per protocol, up front, rather than once per
// candidate layout evaluated. Each entry in the returned plan is the ordered
// list of "identifiers" (bench names, resolved later through a candidate
// benchOf, or fixture ids, which never move) that substep's equipment could
// land on; an unmapped substep (not in equipToStations, not "Pipette")
// becomes an empty list, matching parseProtocol's own "no station" handling.
function planSteps(raw, equipToStations) {
  const { steps } = parseProtocol(raw, {}); // structure-only: splits rows into steps/substeps; station resolution is ignored below.
  const equipLookup = {};
  for (const eq of Object.keys(equipToStations)) equipLookup[eq.toLowerCase()] = eq;
  const plan = [];
  for (const s of steps) {
    for (const sub of s.substeps) plan.push(candidatesFor(sub.equipment, equipToStations, equipLookup));
  }
  return plan;
}

function candidatesFor(equipment, equipToStations, equipLookup) {
  if (PIPETTE_LABEL.test(equipment)) return PIPETTE_STATION_NAMES;
  const canonical = equipLookup[equipment.toLowerCase()];
  const ids = canonical ? equipToStations[canonical] : null;
  if (!ids || ids.length === 0) return [];
  return ids.map((id) => (isFixtureId(id) ? id : STATION_NAME[id]));
}

// The bench names any pasted protocol could ever resolve to — every OTHER
// bench name's placement literally cannot change any protocol's distance
// (nothing ever looks it up), so the search only ever needs to place these.
// Also flags whether the sharps/recycling/biohazard trio is referenced at
// all, so the search can skip trying alternate anchors when it can't matter.
function relevantNamesFrom(plans) {
  const set = new Set();
  let trioRelevant = false;
  for (const plan of plans) {
    for (const candidates of plan) {
      for (const c of candidates) {
        if (c === "SHARPS" || c === "RECYCLE" || c === "WASTE") trioRelevant = true;
        else if (!isFixtureId(c)) set.add(c);
      }
    }
  }
  return { relevantNames: [...set], trioRelevant };
}

// Resolves one protocol's plan under a candidate layout and returns its
// travel distance — the same nearest-of-several-candidates logic as
// protocolImport.js's nearestStation/travelFtOf (verified equivalent to it
// in labOptimizer.test.js), just without any text parsing or intermediate
// equipment-map object per call: `benchOf[identifier] ?? identifier` resolves
// a bench name through the candidate layout, or passes a fixture id straight
// through (fixture ids are never keys in `benchOf`).
function resolveSequence(plan, benchOf, distTable) {
  let prev = null;
  let totalFt = 0;
  for (const candidates of plan) {
    if (candidates.length === 0) continue; // unresolved substep — contributes nothing, same as parseProtocol's null-filtered path
    let chosen = benchOf[candidates[0]] ?? candidates[0];
    if (prev !== null) {
      let bestD = distTable[prev][chosen];
      for (let i = 1; i < candidates.length; i++) {
        const id = benchOf[candidates[i]] ?? candidates[i];
        const d = distTable[prev][id];
        if (d < bestD) { bestD = d; chosen = id; }
      }
      totalFt += bestD;
    }
    prev = chosen;
  }
  return totalFt;
}

function totalCostAll(benchOf, plans, distTable) {
  let total = 0;
  for (const plan of plans) total += resolveSequence(plan, benchOf, distTable);
  return total;
}

function permutationCount(n, r) {
  let result = 1;
  for (let i = 0; i < r; i++) result *= n - i;
  return result;
}

// Swaps `name` into `targetId`, displacing whoever currently holds it into
// `name`'s old slot — the one primitive both the exact search's enumeration
// and the heuristic fallback's mutations are built from, guaranteeing every
// intermediate `benchOf` stays a valid bijection.
function swapNameToId(benchOf, name, targetId) {
  if (benchOf[name] === targetId) return benchOf;
  const otherName = Object.keys(benchOf).find((n) => benchOf[n] === targetId);
  const next = { ...benchOf };
  next[name] = targetId;
  if (otherName) next[otherName] = benchOf[name];
  return next;
}

// Exhaustively tries every way to place `relevantNames` across the 24 real
// bench ids and keeps the best — since no other bench's placement can affect
// the score (see relevantNamesFrom), this *is* the global optimum, not a
// heuristic, whenever optimizeLayout decides the arrangement count is small
// enough to be worth calling (see DEFAULT_EXACT_BUDGET).
function exactSearch(relevantNames, plans, distTable) {
  const R = relevantNames.length;
  const usedIds = new Array(24).fill(false);
  const benchOfPartial = {};
  for (const name of relevantNames) benchOfPartial[name] = null;
  let bestCost = Infinity;
  let bestAssignment = null;

  function backtrack(idx) {
    if (idx === R) {
      const cost = totalCostAll(benchOfPartial, plans, distTable);
      if (cost < bestCost) { bestCost = cost; bestAssignment = { ...benchOfPartial }; }
      return;
    }
    const name = relevantNames[idx];
    for (let i = 0; i < 24; i++) {
      if (usedIds[i]) continue;
      benchOfPartial[name] = ALL_BENCH_IDS[i];
      usedIds[i] = true;
      backtrack(idx + 1);
      usedIds[i] = false;
    }
  }
  backtrack(0);
  return { benchOf: bestAssignment, cost: bestCost };
}

// A relevant-names-only starting point for the heuristic fallback: a handful
// of random swaps from baseline, each moving one relevant name to a random
// id (and displacing whoever was there) — cheap, and always a valid bijection.
function randomRestart(baselineBenchOf, relevantNames, rng) {
  let benchOf = baselineBenchOf;
  for (const name of relevantNames) benchOf = swapNameToId(benchOf, name, ALL_BENCH_IDS[randInt(rng, 0, 23)]);
  return benchOf;
}

// Simulated annealing restricted to relevant names: every mutation swaps one
// relevant name to a random id, so the search never wastes an iteration
// shuffling two names whose placement can't possibly change the score, and
// never has to consider all 24 names as swap candidates the way the old,
// unrestricted search did. Falling back to this only happens when
// exactSearch's arrangement count is too large for the budget (see
// optimizeLayout); it still explores the full 24-position range for each
// relevant name, just doesn't exhaustively enumerate every combination.
function hillClimbRestricted(startBenchOf, relevantNames, plans, distTable, rng, iterations) {
  let current = startBenchOf;
  let currentFt = totalCostAll(current, plans, distTable);
  let best = current;
  let bestFt = currentFt;
  const t0 = Math.max(1, currentFt * 0.05);

  for (let iter = 0; iter < iterations; iter++) {
    const name = relevantNames[randInt(rng, 0, relevantNames.length - 1)];
    const targetId = ALL_BENCH_IDS[randInt(rng, 0, 23)];
    const candidate = swapNameToId(current, name, targetId);
    const candidateFt = totalCostAll(candidate, plans, distTable);
    const delta = candidateFt - currentFt;
    const temp = Math.max(1e-6, t0 * (1 - iter / iterations));
    if (delta <= 0 || rng() < Math.exp(-delta / temp)) {
      current = candidate; currentFt = candidateFt;
      if (currentFt < bestFt) { best = current; bestFt = currentFt; }
    }
  }
  return { benchOf: best, cost: bestFt };
}

// Completes a relevant-names-only assignment into a full 24-name benchOf by
// filling every other name into whichever ids are left over, in a fixed
// (baseline) order — deterministic, and correct regardless of the order
// chosen, since none of those placements affect the score either way.
function completeBenchOf(partial, relevantNames) {
  const usedIds = new Set(relevantNames.map((n) => partial[n]));
  const leftoverIds = ALL_BENCH_IDS.filter((id) => !usedIds.has(id));
  const leftoverNames = ALL_BENCH_NAMES.filter((n) => !relevantNames.includes(n));
  const benchOf = { ...partial };
  leftoverNames.forEach((name, i) => { benchOf[name] = leftoverIds[i]; });
  return benchOf;
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
      location (`identityBenchOf`/`remapId`/`completeBenchOf` only ever draw
      from BENCH_NAMES's own ids).
   2) The Sink, Glassware, Consumables 1, Consumables 2, and the 4C Refrigerator
      never move — they're fixtures, not bench names, so they're never part of
      `benchOf` and `remapId` passes their id straight through untouched.
   3) The sharps bin, recycling bin, and biohazard waste keep their fixed
      relative order (sharps, then recycling, then biohazard, left to right) but
      can relocate together to any of the 3 touching column-pairs (B-C, D-E,
      F-G — see TOUCHING_PAIRS in data.js); `anchorKey` picks which one, and
      DIST_TABLES_BY_ANCHOR/trioFixturesForAnchor already keep that order fixed.

   Trying all 24! bench permutations is impossible, but almost none of those
   24 names ever affect a given set of protocols — a station nothing ever
   visits costs the same wherever it sits (see relevantNamesFrom), so the
   search only ever considers placements for the bench names the protocols
   actually reference. When that reduced problem is small enough to fully
   enumerate within `opts.exactBudget` arrangements (`exactSearch`, tried
   independently for every anchor the trio's relevance makes worth trying),
   the result is the *actual, provably optimal* layout for these protocols —
   not a best guess — and is completely deterministic (the seed plays no
   part). Only when the relevant-name count is too large for that budget does
   it fall back to a seeded local search (`hillClimbRestricted`) — still
   restricted to just the relevant names, so even the fallback explores a far
   smaller and more targeted space than the old all-24-names search did, and
   should converge to the same answer far more consistently across seeds.
   Either way, the raw result can still differ from the real layout in places
   that don't actually affect any pasted protocol, so `minimizeMoves` reverts
   every displaced bench it can put back without losing any of the
   improvement found, leaving only the moves that matter — and a final check
   against the slow, proven `totalTravelFt` (the same function
   `protocolImport.js`'s Protocol Visualizer uses) guarantees the reported
   result is never worse than doing nothing, regardless of what the fast
   search above found.

   Returns `baseline` and `best` (each `{ anchorKey, benchOf, totalTravelFt,
   perProtocol, stationNames, fixtures, stationEquip, visitCounts }` —
   `stationNames`/`fixtures`/`stationEquip`/`visitCounts` are ready to hand
   straight to LabMap's props, `visitCounts` being the per-station tally
   powering its heat map), `moves` (bench names whose position changed,
   `{ name, from, to }`), `totalMoves` (`moves.length`, plus 3 if the trio
   relocated — it's a group of 3 real stations even though it's reported as
   one `anchorChanged` flag rather than 3 more `moves` rows), `anchorChanged`,
   `improvementFt`, `improvementPct`, `optimal` (true if the result is the
   proven global optimum rather than a best-effort search result),
   `relevantStationCount` (how many of the 24 benches the search actually had
   to consider), and `warnings`. */
export function optimizeLayout(equipToStations, protocolTexts, opts = {}) {
  const { seed = 1234, restarts = 3, iterationsPerRestart = 150, exactBudget = DEFAULT_EXACT_BUDGET } = opts;
  const cleanTexts = (protocolTexts || []).map((t) => t || "").filter((t) => t.trim());

  const warnings = [];
  if (Object.keys(equipToStations || {}).length === 0) warnings.push("No equipment loaded — build the lab map first.");
  if (cleanTexts.length === 0) warnings.push("No protocols pasted — nothing to optimize against.");
  if (warnings.length > 0) {
    return {
      baseline: null, best: null, moves: [], totalMoves: 0, anchorChanged: false,
      improvementFt: 0, improvementPct: 0, optimal: false, relevantStationCount: 0, warnings,
    };
  }

  const baselineBenchOf = identityBenchOf();
  const plans = cleanTexts.map((raw) => planSteps(raw, equipToStations));
  const totalSteps = plans.reduce((sum, p) => sum + p.length, 0);
  const { relevantNames, trioRelevant } = relevantNamesFrom(plans);
  const R = relevantNames.length;

  const anchorsToTry = trioRelevant ? Object.keys(TOUCHING_PAIRS) : [DEFAULT_TRIO_ANCHOR];
  const arrangementsPerAnchor = R > 0 ? permutationCount(24, R) : 0;
  const useExact = R === 0 || arrangementsPerAnchor * totalSteps * anchorsToTry.length <= exactBudget;

  const rng = mulberry32(seed);
  let bestPartial = {};
  let bestAnchorKey = DEFAULT_TRIO_ANCHOR;
  let bestCost = Infinity;

  for (const anchorKey of anchorsToTry) {
    const distTable = DIST_TABLES_BY_ANCHOR[anchorKey];
    let candidatePartial, candidateCost;
    if (R === 0) {
      candidatePartial = {};
      candidateCost = totalCostAll(candidatePartial, plans, distTable);
    } else if (useExact) {
      ({ benchOf: candidatePartial, cost: candidateCost } = exactSearch(relevantNames, plans, distTable));
    } else {
      const restrictedBaseline = Object.fromEntries(relevantNames.map((n) => [n, baselineBenchOf[n]]));
      const starts = [
        restrictedBaseline,
        ...Array.from({ length: Math.max(0, restarts - 1) }, () => randomRestart(baselineBenchOf, relevantNames, rng)),
      ];
      candidateCost = Infinity;
      for (const start of starts) {
        const { benchOf, cost } = hillClimbRestricted(start, relevantNames, plans, distTable, rng, iterationsPerRestart);
        if (cost < candidateCost) { candidateCost = cost; candidatePartial = benchOf; }
      }
    }
    if (candidateCost < bestCost) { bestCost = candidateCost; bestPartial = candidatePartial; bestAnchorKey = anchorKey; }
  }

  let bestBenchOf = completeBenchOf(bestPartial, relevantNames);

  // Safety net: re-score the fast search's proposal (and the baseline) with
  // the slow, proven parseProtocol-based function, and never report anything
  // the fast engine got wrong or that's actually worse than doing nothing.
  const baselineFt = totalTravelFt(baselineBenchOf, DEFAULT_TRIO_ANCHOR, equipToStations, cleanTexts);
  let bestFt = totalTravelFt(bestBenchOf, bestAnchorKey, equipToStations, cleanTexts);
  if (bestFt > baselineFt) { bestBenchOf = baselineBenchOf; bestAnchorKey = DEFAULT_TRIO_ANCHOR; bestFt = baselineFt; }

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

  return {
    baseline, best, moves, totalMoves, anchorChanged, improvementFt, improvementPct,
    optimal: useExact, relevantStationCount: R, warnings,
  };
}
