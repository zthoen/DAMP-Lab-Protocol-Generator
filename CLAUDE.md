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
vertical hop between rows within a walkway), `BENCH_WIDTH_FT` (~3ft, the lateral
space one column takes up — used for every column-to-column distance), `WALKWAY_
WIDTH_FT` (~6ft, the lateral crossing when two columns share one walkway),
`BACK_AISLE_FT` (~5ft, the back walkway's one-time crossing when two stations are on
different walkways). `routeDistanceFt(a, b)` picks one of two shapes: same walkway
(same column, or the two columns of a pair) is just vertical bench-hops plus at most
one walkway-width crossing; different walkways pay to descend/ascend each side's
walkway and cross the back aisle in between (the lateral portion of that crossing is
counted in bench-*widths*, not bench-lengths — you're passing the side of each
column, not its depth). `BENCH_DIST_FT` precomputes this for every station pair (so
the protocol generator doesn't recompute a route per draw) and `routeWaypoints(a, b)`
returns the matching pixel path — front of the start bench, through the middle of
whatever walkway(s) it uses, to the front and then the center of the destination —
so the map's path overlay always reads as "walk to the aisle, use it, arrive," never
a line cutting through a bench.

**Fixed utility fixtures (`src/data.js` `FIXTURES`)** — 5 baseline destinations that
never move and are otherwise treated exactly like a bench, split across the back
walkway into two groups. The **trio** (sharps bin, recycling bin, biohazard box)
sits touching the bottom of row 3 — the sharps bin at the end of column B, the
biohazard box at the end of column C, recycling between them — with *no* gap, like
a 4th row with nothing beyond it. The **far pair** (sink, consumables storage) sits
on the opposite side of the back walkway, directly across from the trio. Real
footprints (feet) are kept as *length* (the top-to-bottom extent, facing the wall) ×
*width* (the left-to-right extent) and scaled up for map legibility — a 1-2ft bin
would otherwise round to an unreadable box.

Every fixture is a full member of `STATION_IDS`, so it's a valid `Station Location`
in a pasted table and participates in `BENCH_DIST_FT`/`routeWaypoints` like any
bench. Distance-wise, the trio is *aliased* to its anchor column's row-3 bench —
`routeDistanceFt("B3", "SHARPS")` is 0, `routeDistanceFt("B1", "SHARPS")` is exactly
`routeDistanceFt("B1", "B3")` — recycling straddles both B and C, so it resolves to
whichever is closer (`NEAR_FIXTURES` lists each trio member's anchor column(s); the
alias resolution is the first branch of `routeDistanceFt`). The far pair works like
the fixtures in earlier iterations of this map: reaching one from a bench always
costs one back-walkway crossing, and two far fixtures are pure lateral distance
apart (`FAR_FEETX`). A trio member reaching a far fixture (or vice versa) still
crosses the back walkway once, same as any bench would.

Because a fixture is only a couple of feet across, it can't hold an ID or name
inside its own box the way a bench does — `LabMap.jsx` prints its code outside the
box instead (below for the trio, since it touches row 3 with no room above; above
for the far pair, which has headroom) and leaves the full name to the hover panel.
`isNearFixture`/`isFixtureId` (exported from `data.js`) are what `LabMap.jsx` uses
to decide label placement and, for routing, to reuse the same "fixture-involving
paths go via the back-walkway rail" pixel logic for both groups.

Each fixture is also a piece of equipment in its own right, permanently
"installed" at its own station — `FIXTURE_EQUIPMENT` (`data.js`) names one
("Sharps", "Recycle", "Biohazardous Waste", "Sink", "Consumables") per fixture.
`parseLabTable` (`labTable.js`) injects these into every parsed table's
`equipToStations`/`stationEquip` unconditionally, even on an empty paste, since
they're baseline lab equipment that's always physically present regardless of
what a user's table says. Retrieving from consumables or disposing of waste is
therefore an ordinary equipment step like any other, not a special-cased
destination — see the retrieve/dispose bookend below, which relies on this to
always have equipment to work with.

The 4 vertical walkways and the back walkway render as **one continuous shaded
region** (`WALKWAY_PATH`, a single comb-shaped SVG path) rather than 5 separate
boxes — the vertical lanes are extended down to meet the back walkway with no gap,
so there's no seam where they join.

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
rest of that row. Auto-detects and skips a header row. Before returning,
`withFixtureEquipment` merges in the 5 baseline `FIXTURE_EQUIPMENT` entries (see
above) regardless of what was parsed — a pasted row that also maps real equipment
to a fixture station (e.g. "Autoclave Bags" at `WASTE`) adds alongside the
baseline entry rather than replacing it. Returns `equipToStations` (equipment →
station codes), `stationEquip` (station → equipment list), `stationNames`
(station → display name(s)), and `errors` so bad paste data is visible instead of
silently dropped.

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
actually force movement" is directly visible. Protocols are titled `Protocol 1`,
`Protocol 2`, etc. in generation order.

Every protocol is bookended: it opens with a retrieve-equipment step at consumables
storage and closes with a dispose-of-waste step at the sharps bin, the biohazard box,
or (`DOUBLE_DISPOSAL_CHANCE`, 30% of the time) both back to back in a random order —
`pickDisposalStations` picks from whichever of the two bins actually has equipment
mapped to it. In practice that's always true now that `FIXTURE_EQUIPMENT` guarantees
baseline equipment at every fixture (see above), but `generateProtocols` still
degrades gracefully — a warning, not a crash — for a raw `equipToStations` built
some other way that omits them (e.g. called directly, as the tests do, rather than
through `parseLabTable`). `minSteps`/`maxSteps` are honored inclusive of these
bookend steps, bumped up automatically when the configured range is too tight to fit
them. The random walk that fills the middle steers clear of consumables storage and
whichever bin(s) close the protocol out (the `reserved` set built from
`opensWithRetrieve`/`disposal` before the middle loop runs) — those stations are
single, fixed locations with no alternate bench to reroute to, so letting the middle
walk land on one right before the bookend uses the same station would create a
same-station repeat the "never camp two steps running" rule can't route around any
other way.

The other 2 fixtures (recycling, sink) aren't bookend steps and aren't reserved, so
they can appear anywhere in the middle walk — but a random walk over a large
equipment pool can still miss them across a small batch, so after the normal draw,
`generateProtocols` checks whether every fixture with equipment mapped to it was
actually visited by some step; if any weren't, one extra "coverage" protocol is
appended that walks to each missed fixture in turn. This coverage protocol isn't held
to the bookend rule (it's a single-purpose fixture-visit, not a simulated protocol).

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
- The bench grid (`SLOTS` in `data.js`) is fixed at A1–H3, plus the 5 fixed fixtures
  in `FIXTURES`; `labTable.js` validates pasted station codes against the combined
  `STATION_IDS` list. If the grid ever needs to grow (more rows/columns, storage
  aisles back in scope) or a fixture's dimensions/position change, it lives entirely
  in `data.js` — nothing else hardcodes bench or fixture positions. If the physical
  reference measurements change, they're the `*_FT` constants at the top of
  `data.js` — `routeDistanceFt`/`routeWaypoints` derive everything else from them, so
  nothing else needs updating.
- The Read/Write keyword list in `stepType.js` is a heuristic, not a lookup table —
  if a new equipment name is consistently misclassified, add its keyword there rather
  than special-casing it in `protocolGen.js`.
