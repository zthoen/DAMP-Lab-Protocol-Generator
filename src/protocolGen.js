import { mulberry32 } from "./rng.js";
import { BENCH_DIST_FT, STATION_IDS, isFixtureId, PIPETTE_STATIONS } from "./data.js";
import { classifyStepType } from "./stepType.js";

const randInt = (rng, min, max) => min + Math.floor(rng() * (max - min + 1));
const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];
const FIXTURE_IDS = STATION_IDS.filter(isFixtureId);

// Every protocol opens with steps at some combination of these "prep" stations
// and closes with steps at some combination of these "cleanup" stations — see
// pickPoolSubset. Neither pool is ever touched by the random walk in between
// (see `reserved` below) — they're bookend-only territory.
const OPEN_POOL = ["GLASSWARE", "CONSUM1", "CONSUM2"];
const CLOSE_POOL = ["SINK", "WASTE", "SHARPS"];

// One equipment can live at several stations that aren't off-limits (see
// `avoid` below); return the one farthest from `from` (by the actual walking
// route, not a straight line — see routeDistanceFt in data.js) so picking that
// equipment actually forces a walk, not just a coin-flip.
function farthestStation(stations, from, avoid) {
  const usable = avoid ? stations.filter((s) => !avoid.has(s)) : stations;
  const pool = usable.length ? usable : stations;
  if (!from) return pool[0];
  return pool.reduce((best, s) => (BENCH_DIST_FT[from][s] > BENCH_DIST_FT[from][best] ? s : best), pool[0]);
}

function travelFtOf(steps) {
  let ft = 0;
  for (let i = 1; i < steps.length; i++) ft += BENCH_DIST_FT[steps[i - 1].station][steps[i].station];
  return Math.round(ft);
}

const asProtocol = (id, steps) => ({
  id, steps, stationsVisited: new Set(steps.map((s) => s.station)).size, travelFt: travelFtOf(steps),
});

// A random-length (1..N), random-order, no-repeat subset of `pool`, restricted
// to whichever members actually have equipment mapped to them — this is how
// an open/close bookend gets "any combination or number" of its pool's
// stations rather than a fixed single station or fixed pair. Every count from
// 1 to the number of available stations is equally likely, and every subset
// of that size is equally likely too (a prefix of a full shuffle).
function pickPoolSubset(rng, stationEquip, pool) {
  const available = pool.filter((s) => stationEquip[s]?.length);
  if (available.length === 0) return [];
  const shuffled = [...available];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, randInt(rng, 1, shuffled.length));
}

/* Generates `count` fake protocols, each a variable-length sequence of steps whose
   equipment is deliberately drawn from a *different* station than the previous step
   (and the farthest of that equipment's stations from the current one, when it has
   more than one) — so executing the protocol forces the technician to keep moving
   around the floor instead of camping at one bench. Each step's type (Read/Write) is
   determined by the equipment itself, not drawn at random — see stepType.js. Seeded
   so the same inputs always produce the same protocols.

   Every protocol opens with steps at some combination of Glassware/Consumables 1/
   Consumables 2 (`OPEN_POOL`) and closes with steps at some combination of Sink/
   Biohazard Waste/Sharps Bin (`CLOSE_POOL`) — `pickPoolSubset` draws a random-size,
   random-order subset of whichever pool members actually have equipment mapped to
   them, so a table missing some (or all) of a pool's stations just uses fewer of
   them (or none, dropping that bookend entirely) rather than inventing a step with
   no real equipment behind it. `minSteps`/`maxSteps` are honored inclusive of these
   bookend steps, bumped up automatically when the configured range is too tight to
   fit them. The random walk that fills the middle steers clear of both entire pools
   (`reserved`) regardless of which specific stations ended up chosen for this
   protocol's bookends — they're single, fixed locations with no alternate bench to
   reroute to, so letting the middle walk land on one would risk either an
   incidental same-station repeat right next to the real bookend step, or (now that
   a pipette step can force an extra closing station after the fact, see below)
   landing on a station that turns out to be needed for the close after all.

   A pipette isn't tied to one specific station — any bench with pipettes and bench
   space works — so a step whose equipment is "Pipette" is always a candidate here
   too, with the same odds of being picked as any real piece of equipment, resolved
   against the fixed `PIPETTE_STATIONS` pool (data.js) the same farthest-station way
   as any other multi-station equipment. If a pipette step ends up in the middle
   walk, the protocol is required to close with a Sharps Bin step as the *last* step
   (used pipette tips are sharps waste) — after the middle walk runs, "SHARPS" is
   moved to the end of `closeStations` (added there if it wasn't already part of the
   chosen close subset, or relocated there if `pickPoolSubset` had placed it earlier),
   as long as equipment is mapped there, even if that pushes the protocol one step
   past `maxSteps`.

   The other 2 fixtures (recycling, the 4C refrigerator) aren't bookend steps and
   aren't reserved, so they can appear anywhere in the middle walk if equipment is
   mapped there — but a random walk over a large equipment pool can still miss one
   across a small batch, so after the normal draw, `generateProtocols` checks
   whether every fixture with equipment mapped to it (bookend pools included) was
   actually visited by some step; if any weren't, one extra "coverage" protocol is
   appended that walks to each missed fixture in turn. This coverage protocol isn't
   held to the bookend rule (it's a single-purpose fixture-visit, not a simulated
   protocol). */
export function generateProtocols(equipToStations, opts = {}) {
  const { count = 10, minSteps = 4, maxSteps = 8, seed = 1234 } = opts;
  const realEquipment = Object.keys(equipToStations);
  if (realEquipment.length === 0) return { protocols: [], warnings: ["No equipment loaded — build the lab map first."] };

  const rng = mulberry32(seed);
  const warnings = [];

  // Pipette is injected as a normal candidate below — it never counts toward
  // "is any equipment loaded at all" above, since an empty lab shouldn't
  // generate pipette-only protocols just because the pool is always available.
  const equipToStationsFull = { ...equipToStations, Pipette: PIPETTE_STATIONS };
  const equipment = Object.keys(equipToStationsFull);

  const singleStationLab = equipment.every((e) => new Set(equipment.flatMap((x) => equipToStationsFull[x])).size <= 1);
  if (singleStationLab) warnings.push("Every piece of equipment maps to the same station — protocols can't force movement.");

  const stationEquip = {};
  for (const e of equipment) for (const s of equipToStationsFull[e]) (stationEquip[s] ??= []).push(e);
  if (!OPEN_POOL.some((s) => stationEquip[s]?.length)) {
    warnings.push("No equipment mapped to Glassware, Consumables 1, or Consumables 2 — protocols won't open with a prep step.");
  }
  if (!CLOSE_POOL.some((s) => stationEquip[s]?.length)) {
    warnings.push("No equipment mapped to the Sink, Biohazard Waste, or Sharps Bin — protocols won't close with a disposal step.");
  }
  if (!stationEquip.SHARPS?.length) {
    warnings.push("No equipment mapped to the Sharps Bin — a protocol that uses a pipette won't be able to add the required disposal step.");
  }

  const reserved = new Set([...OPEN_POOL, ...CLOSE_POOL]);

  const protocols = [];
  for (let p = 0; p < count; p++) {
    const openStations = pickPoolSubset(rng, stationEquip, OPEN_POOL);
    let closeStations = pickPoolSubset(rng, stationEquip, CLOSE_POOL);
    const bookendCount = openStations.length + closeStations.length;
    const nSteps = Math.max(randInt(rng, minSteps, maxSteps), bookendCount || 1);

    const steps = [];
    let prevStation = null;
    let prevEquip = null;

    for (const station of openStations) {
      let candidates = stationEquip[station].filter((e) => e !== prevEquip);
      if (candidates.length === 0) candidates = stationEquip[station];
      const equip = pick(rng, candidates);
      steps.push({ equipment: equip, station, action: classifyStepType(equip) });
      prevStation = station;
      prevEquip = equip;
    }

    const middleCount = nSteps - openStations.length - closeStations.length;
    let usedPipette = false;
    for (let i = 0; i < middleCount; i++) {
      let candidates = equipment.filter((e) => e !== prevEquip && equipToStationsFull[e].some((s) => s !== prevStation && !reserved.has(s)));
      if (candidates.length === 0) candidates = equipment.filter((e) => e !== prevEquip && equipToStationsFull[e].some((s) => s !== prevStation));
      if (candidates.length === 0) candidates = equipment.filter((e) => e !== prevEquip);
      if (candidates.length === 0) candidates = equipment;

      const equip = pick(rng, candidates);
      if (equip === "Pipette") usedPipette = true;
      const station = farthestStation(equipToStationsFull[equip], prevStation, reserved);
      steps.push({ equipment: equip, station, action: classifyStepType(equip) });
      prevStation = station;
      prevEquip = equip;
    }

    if (usedPipette && stationEquip.SHARPS?.length) {
      closeStations = closeStations.filter((s) => s !== "SHARPS");
      closeStations.push("SHARPS");
    }

    for (const station of closeStations) {
      let candidates = stationEquip[station].filter((e) => e !== prevEquip);
      if (candidates.length === 0) candidates = stationEquip[station];
      const equip = pick(rng, candidates);
      steps.push({ equipment: equip, station, action: classifyStepType(equip) });
      prevStation = station;
      prevEquip = equip;
    }

    protocols.push(asProtocol(`Protocol ${p + 1}`, steps));
  }

  const visited = new Set(protocols.flatMap((p) => p.steps.map((s) => s.station)));
  const missedFixtures = FIXTURE_IDS.filter((f) => stationEquip[f]?.length && !visited.has(f));
  if (missedFixtures.length > 0) {
    const steps = missedFixtures.map((station) => {
      const equip = stationEquip[station][0];
      return { equipment: equip, station, action: classifyStepType(equip) };
    });
    protocols.push(asProtocol(`Protocol ${protocols.length + 1}`, steps));
  }

  return { protocols, warnings };
}
