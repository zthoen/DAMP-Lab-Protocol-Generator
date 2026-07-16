# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

DAMP Lab Protocol Builder — a browser-based tool that turns a pasted equipment/bench
table into a visual lab floor map, then generates fake protocols (variable-length step
sequences) engineered to force a lab technician to keep moving between benches instead
of camping at one station. No backend, no database, no simulation — a small Vite +
React SPA. This repo is a stripped-down fork of a larger discrete-event lab simulator;
the simulation engine, dispatch-policy comparisons, financials, and stats/experiments
tooling were removed because they're not needed for this tool's goal.

## Commands

- `npm run dev` — start the Vite dev server (port 3000, opens browser).
- `npm run build` — production build.
- `npm run preview` — preview the production build.
- `npm test` — run the pure-function test suite (Node's built-in `node --test`, zero
  dependencies; see `test/`). Covers table parsing (`labTable.js`), the routing/
  distance model (`data.js`), and protocol generation (`protocolGen.js`), including
  seeded reproducibility. `npm test -- test/protocolGen.test.js` runs a single file.

The repo is ESM (`"type": "module"`). There is no linter or type checker configured.

## Architecture

**Lab floor geometry (`src/data.js`)** — the physical grid every map is drawn onto:
8 columns (A–H) × 3 rows (1–3) = 24 fixed benches (`SLOTS`). Benches physically touch
— there's no gap within a column (A1/A2/A3 touch) or between the two columns of a
touching pair (B–C, D–E, F–G touch). The only open space on the floor is 5 walkways:
one vertical walkway between each of A|B, C|D, E|F, G|H (`WALKWAYS`, `COL_X` encodes
the touching/gapped pattern directly), plus the horizontal back walkway past row 3
(`BACK_AISLE_Y`/`BACK_AISLE_H`). A bench can only be reached via its own walkway —
never by cutting through a neighboring bench — so **A and B share a walkway (direct
crossing) but B and C, despite touching, don't** (B's walkway is A-B, C's is C-D; a
B↔C move still has to detour via the back walkway). `front(id)` returns the point on
a bench's edge that actually opens onto its walkway (used by both the distance and
pixel-path functions below, never a bench's raw center).

Distance is modeled on real measurements, not pixels: `BENCH_LEN_FT` (~7ft, the
vertical hop between rows within a walkway), `WALKWAY_WIDTH_FT` (~6ft, the lateral
crossing when two columns share one walkway), `BACK_AISLE_FT` (~5ft, the back
walkway's one-time crossing when two stations are on different walkways).
`routeDistanceFt(a, b)` picks one of two shapes: same walkway (same column, or the
two columns of a pair) is just vertical bench-hops plus at most one walkway-width
crossing; different walkways pay to descend/ascend each side's walkway and cross the
back aisle in between. `BENCH_DIST_FT` precomputes this for every station pair (so
the protocol generator doesn't recompute a route per draw) and `routeWaypoints(a, b)`
returns the matching pixel path — front of the start bench, through the middle of
whatever walkway(s) it uses, to the front and then the center of the destination —
so the map's path overlay always reads as "walk to the aisle, use it, arrive," never
a line cutting through a bench.

**Table parsing (`src/labTable.js`)** — `parseLabTable(raw)` takes a pasted
spreadsheet table (tab-separated; falls back to comma-separated, though the comma
fallback can't disambiguate a multi-location cell from the row delimiter — tab-
separated paste is the reliable path) with columns `[Equipment, Station Name?,
Station Location]`. Either of the last two columns may list more than one station
for the same equipment row, comma- or semicolon-separated (e.g. `F1, F2, F3` — a
shaker that lives at three benches) — every valid location gets the equipment added
to it, and station names pair up with locations by position (or the single name is
reused across all locations if only one is given). Station locations must land on
the fixed A1–H3 grid; invalid ones are reported per-location without dropping the
rest of that row. Auto-detects and skips a header row. Returns `equipToStations`
(equipment → station codes), `stationEquip` (station → equipment list),
`stationNames` (station → display name(s)), and `errors` so bad paste data is
visible instead of silently dropped.

**Protocol generation (`src/protocolGen.js`)** — `generateProtocols(equipToStations,
opts)` builds `count` fake protocols, each a random-length (`minSteps`–`maxSteps`)
sequence of steps. The dispatch rule that forces movement: each step's equipment is
chosen from a candidate pool excluding the immediately-previous equipment and any
equipment whose *every* station equals the previous step's station; when the chosen
equipment has more than one station, the farthest one from the previous station (by
`BENCH_DIST_FT`, i.e. the real walking route, not a straight line) is used. Each
step's type (Read or Write) is deterministic, not random — `classifyStepType`
(`src/stepType.js`) keyword-matches the equipment name (readers/scopes/balances/etc.
→ Write, since there's a measurement to record; centrifuges/shakers/incubators/etc.
→ Read, since there's nothing to write down). Everything else is drawn from a
`mulberry32` seeded stream (`src/rng.js`) so the same inputs always reproduce the
same protocols. Each generated protocol carries its step list plus `stationsVisited`
and `travelFt` (summed `BENCH_DIST_FT` across the sequence, in feet) so "does this
actually force movement" is directly visible.

**UI (`src/`)** — two tabs driven by `App.jsx`, sharing one parsed `labData`
(`parseLabTable` over the raw pasted text, memoized in `App.jsx`):
- `LabBuilderTab.jsx`: the paste textarea, row-error list, and the `LabMap.jsx` render
  of the resulting station/equipment layout.
- `ProtocolGeneratorTab.jsx`: controls for protocol count / min-max steps / seed, a
  "Generate" button, and a column of cards per generated protocol (station/equipment/
  Read-or-Write type per step) beside a larger `LabMap.jsx` — the map is the point of
  the page, so it gets the majority of the width. Selecting a protocol highlights its
  routed bench-to-bench path via the `highlightPath` prop.
- `LabMap.jsx`: pure rendering component — takes `stationEquip`/`stationNames` (and
  optionally `highlightPath`, an ordered list of station codes) and draws the 24-bench
  SVG grid plus all 5 walkways as plain unlabeled open lanes. A multi-step
  `highlightPath` is expanded through `routeWaypoints` per consecutive pair into one
  continuous **solid** line (always touching the front of every bench it uses and the
  middle of every walkway it transits) — never a dashed line or one cutting through a
  bench. A station revisited by non-consecutive steps gets one merged "1,3"-style
  badge instead of a second marker silently overlapping the first. Has no simulation
  state; it only knows what's in the parsed table.
- `Controls.jsx`: shared widgets (`NumField`, `Dropdown`, `StatCard`, `InfoDot`,
  `Slider`, `Toggle`, `Section`, `Panel`) carried over from the original sim UI.

## Working in this codebase

- `labTable.js`, `data.js` (the routing model), `stepType.js`, and `protocolGen.js`
  are the places with actual logic; all have an `npm test` suite — run it after
  changing any of them. UI changes should also be verified with `npm run dev` (paste
  a table, confirm the map renders, generate protocols, confirm consecutive steps
  land on different benches and the highlighted path only ever travels through a
  walkway, never straight through a bench).
- Protocol generation is seeded (`mulberry32` in `src/rng.js`) so the same table +
  settings + seed always produce the same protocols — keep any new randomness routed
  through that seeded stream rather than `Math.random()`.
- The bench grid (`SLOTS` in `data.js`) is fixed at A1–H3; `labTable.js` validates
  pasted station codes against it. If the grid ever needs to grow (more rows/columns,
  storage aisles back in scope), it lives entirely in `data.js` — nothing else hardcodes
  bench positions. If the physical reference measurements change, they're the three
  `*_FT` constants at the top of `data.js` — `routeDistanceFt`/`routeWaypoints` derive
  everything else from them, so nothing else needs updating.
- The Read/Write keyword list in `stepType.js` is a heuristic, not a lookup table —
  if a new equipment name is consistently misclassified, add its keyword there rather
  than special-casing it in `protocolGen.js`.
