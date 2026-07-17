import { mulberry32 } from "./rng.js";
import { BENCH_DIST_FT, STATION_IDS, isFixtureId } from "./data.js";
import { classifyStepType } from "./stepType.js";

const randInt = (rng, min, max) => min + Math.floor(rng() * (max - min + 1));
const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];
const FIXTURE_IDS = STATION_IDS.filter(isFixtureId);
const DOUBLE_DISPOSAL_CHANCE = 0.3; // how often a protocol disposes at *both* bins, not just one

// One equipment can live at several stations (EQUIP_LOCS-style); of its stations
// that aren't off-limits (see `avoid` below), return the one farthest from `from`
// (by the actual walking route, not a straight line — see routeDistanceFt in
// data.js) so picking that equipment actually forces a walk, not just a coin-flip.
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

// Which bin(s) close out a protocol: sharps, biohazard, or (occasionally, when both
// are available) one after the other. Only offers a station that actually has
// equipment mapped to it, so a table missing one bin still closes with the other.
function pickDisposalStations(rng, stationEquip) {
  const options = ["SHARPS", "WASTE"].filter((s) => stationEquip[s]?.length);
  if (options.length < 2) return options;
  if (rng() < DOUBLE_DISPOSAL_CHANCE) return rng() < 0.5 ? options : [...options].reverse();
  return [pick(rng, options)];
}

/* Generates `count` fake protocols, each a variable-length sequence of steps whose
   equipment is deliberately drawn from a *different* station than the previous step
   (and the farthest of that equipment's stations from the current one, when it has
   more than one) — so executing the protocol forces the technician to keep moving
   around the floor instead of camping at one bench. Each step's type (Read/Write) is
   determined by the equipment itself, not drawn at random — see stepType.js. Seeded
   so the same inputs always produce the same protocols.

   Every protocol opens with a retrieve-equipment step at consumables storage and
   closes with a dispose-of-waste step at the sharps bin, the biohazard box, or both
   in sequence (whichever has equipment mapped to it — a table missing one just uses
   the other, and a table missing both drops the requirement entirely rather than
   inventing a step with no real equipment behind it). Everything in between is the
   same random walk as before, so minSteps/maxSteps are honored inclusive of these
   bookend steps (bumped up when the range is too tight to fit them).

   The other 2 fixtures (recycling, sink) aren't bookend steps, but a random walk
   over a large equipment pool can still miss them across a small batch — so after
   the normal draw, any fixture with equipment mapped to it that no generated step
   visited gets one extra "coverage" protocol appended, walking to each missed
   fixture in turn.

   The random walk that fills the middle steers clear of consumables storage and
   whichever bin(s) close the protocol out — those are reserved for the bookend, so
   a step there always means the real retrieve/dispose, never an incidental repeat
   that could otherwise land right next to the bookend step at the same station. */
export function generateProtocols(equipToStations, opts = {}) {
  const { count = 10, minSteps = 4, maxSteps = 8, seed = 1234 } = opts;
  const equipment = Object.keys(equipToStations);
  if (equipment.length === 0) return { protocols: [], warnings: ["No equipment loaded — build the lab map first."] };

  const rng = mulberry32(seed);
  const warnings = [];
  const singleStationLab = equipment.every((e) => new Set(equipment.flatMap((x) => equipToStations[x])).size <= 1);
  if (singleStationLab) warnings.push("Every piece of equipment maps to the same station — protocols can't force movement.");

  const stationEquip = {};
  for (const e of equipment) for (const s of equipToStations[e]) (stationEquip[s] ??= []).push(e);
  const consumEquip = stationEquip.CONSUM || [];
  if (consumEquip.length === 0) warnings.push("No equipment mapped to Wellplates / Tubes storage — protocols won't open with a retrieval step.");
  if (!stationEquip.SHARPS?.length && !stationEquip.WASTE?.length) {
    warnings.push("No equipment mapped to the Sharps Bin or Biohazard Waste — protocols won't close with a disposal step.");
  }

  const protocols = [];
  for (let p = 0; p < count; p++) {
    const disposal = pickDisposalStations(rng, stationEquip);
    const opensWithRetrieve = consumEquip.length > 0;
    const bookendCount = (opensWithRetrieve ? 1 : 0) + disposal.length;
    const nSteps = Math.max(randInt(rng, minSteps, maxSteps), bookendCount || 1);

    const steps = [];
    let prevStation = null;
    let prevEquip = null;

    if (opensWithRetrieve) {
      const equip = pick(rng, consumEquip);
      steps.push({ equipment: equip, station: "CONSUM", action: classifyStepType(equip) });
      prevStation = "CONSUM";
      prevEquip = equip;
    }

    const reserved = new Set([...(opensWithRetrieve ? ["CONSUM"] : []), ...disposal]);
    const middleCount = nSteps - steps.length - disposal.length;
    for (let i = 0; i < middleCount; i++) {
      let candidates = equipment.filter((e) => e !== prevEquip && equipToStations[e].some((s) => s !== prevStation && !reserved.has(s)));
      if (candidates.length === 0) candidates = equipment.filter((e) => e !== prevEquip && equipToStations[e].some((s) => s !== prevStation));
      if (candidates.length === 0) candidates = equipment.filter((e) => e !== prevEquip);
      if (candidates.length === 0) candidates = equipment;

      const equip = pick(rng, candidates);
      const station = farthestStation(equipToStations[equip], prevStation, reserved);
      steps.push({ equipment: equip, station, action: classifyStepType(equip) });
      prevStation = station;
      prevEquip = equip;
    }

    for (const station of disposal) {
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
