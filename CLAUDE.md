# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

DAMP Lab Choreography Visualizer — a browser-based tool that turns a pasted equipment/bench
table into a visual lab floor map, generates fake protocols (variable-length step
sequences) engineered to force a lab technician to keep moving between benches instead
of camping at one station, can import a *real* protocol (pasted step/substep/
equipment data) to plot the actual route it walks, and can search for a station
layout that minimizes total travel distance across a set of real protocols. No
backend, no database, no simulation — a small Vite + React SPA. This repo is a
stripped-down fork of a larger discrete-event lab simulator; the simulation engine,
dispatch-policy comparisons, financials, and stats/experiments tooling were removed
because they're not needed for this tool's goal.

## Commands

- `npm run dev` — start the Vite dev server (port 3000, opens browser).
- `npm run build` — production build.
- `npm run preview` — preview the production build.
- `npm test` — run the pure-function test suite (Node's built-in `node --test`, zero
  dependencies; see `test/`). Covers table parsing (`labTable.js`), the routing/
  distance model (`data.js`), fake-protocol generation (`protocolGen.js`), real-
  protocol import (`protocolImport.js`), and the layout search (`labOptimizer.js`),
  including seeded reproducibility. `npm test -- test/protocolGen.test.js` runs a
  single file.

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

Distance is modeled on real measurements, not pixels: `BENCH_LEN_FT` (~6ft, the
vertical hop between rows within a walkway), `BENCH_WIDTH_FT` (~2.5ft, the lateral
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

**Fixed utility fixtures (`src/data.js` `FIXTURES`)** — 8 baseline destinations that
never move and are otherwise treated exactly like a bench, split across the back
walkway into two groups. The **trio** (sharps bin, recycling bin, biohazard box)
sits touching the bottom of row 3 — the sharps bin at the end of column B, the
biohazard box at the end of column C, recycling between them — with *no* gap, like
a 4th row with nothing beyond it. The **far row** sits on the opposite side of the
back walkway: sink, glassware, Consumables 1, and Consumables 2, chained left to
right and shifted right so the sink's left edge lines up with B3's left edge
(glassware sits directly right of the sink; Consumables 1 sits directly right of
glassware; Consumables 2 sits directly right of Consumables 1) — offset from the
trio rather than centered on the same boundary. The **4C refrigerator** is also
beyond the back walkway but off on its own, 5ft to the right of H3, past the last
column — same distance-model semantics as the far row, just positioned far to the
right instead of over by B-C. Real footprints (feet) are kept as
*length* (the top-to-bottom extent, facing the wall) × *width* (the left-to-right
extent) and scaled up for map legibility — a 1-2ft bin would otherwise round to an
unreadable box.

Every fixture is a full member of `STATION_IDS`, so it's a valid `Station Location`
in a pasted table and participates in `BENCH_DIST_FT`/`routeWaypoints` like any
bench. Distance-wise, the trio is *aliased* to its anchor column's row-3 bench —
`routeDistanceFt("B3", "SHARPS")` is 0, `routeDistanceFt("B1", "SHARPS")` is exactly
`routeDistanceFt("B1", "B3")` — recycling straddles both B and C, so it resolves to
whichever is closer (`NEAR_FIXTURES` lists each trio member's anchor column(s); the
alias resolution is the first branch of `routeDistanceFt`). B-C is the trio's real,
permanent anchor, but the alias logic is generalized to take an optional
`nearFixtures` argument (`routeDistanceFt(a, b, nearFixtures = NEAR_FIXTURES)`)
rather than hardcoding it, purely so the Lab Optimizer (below) can score a
candidate layout with the trio relocated to a different touching pair without
disturbing this default. `TOUCHING_PAIRS` (`{ BC, DE, FG }`) enumerates the 3
pairs the trio could ever anchor to — A and H each touch only one neighbor via a
walkway, never a touching pair, so they're not eligible — and
`nearFixturesForAnchor`/`trioFixturesForAnchor` build the alias map / pixel boxes
for a given one, always keeping the trio's own left-to-right order (sharps,
recycling, biohazard). Everything else
(the far row, plus the refrigerator) works like the far pair in earlier iterations
of this map: reaching one from a bench always costs one back-walkway crossing, and
two far fixtures are pure lateral distance apart (`FAR_FEETX` — purely a
distance-model coordinate, not derived from the pixel layout, though it's kept in
the same left-to-right order: sink, glassware, Consumables 1, Consumables 2, then
the refrigerator far off past column H). A trio member reaching a far fixture (or
vice versa) still crosses the back walkway once, same as any bench would.

Because a fixture is only a couple of feet across, it can't hold an ID or name
inside its own box the way a bench does — `LabMap.jsx` prints its code outside the
box instead (below for the trio, since it touches row 3 with no room above; above
for the far pair, which has headroom) and leaves the full name to the hover panel.
`isNearFixture`/`isFixtureId` (exported from `data.js`) are what `LabMap.jsx` uses
to decide label placement and, for routing, to reuse the same "fixture-involving
paths go via the back-walkway rail" pixel logic for both groups.

Every station — all 24 benches plus the 8 fixtures — has exactly one fixed,
hardcoded name (`BENCH_NAMES` for the benches, merged with each fixture's own
`name` into `STATION_NAME`, keyed by station id). These are the lab's real
station names (e.g. `A3` is "Hamilton", `D3` is "PCR") and are never supplied by
a pasted table — `NAME_TO_STATION_ID` is the case-insensitive reverse lookup
`labTable.js` uses to resolve a pasted name back to its internal id. The A1-H3/
SHARPS-style ids stay purely internal, driving the geometry/distance model and
map layout; nothing user-facing needs to know them.

No fixture carries any built-in equipment — a fixture is a destination on the
map, exactly like a bench, until a pasted row on the Equipment Input tab
explicitly maps something to it. Earlier versions of this tool auto-installed
baseline equipment at 5 of the fixtures (so "retrieve from Consumables 2" or
"dispose of waste" would always be available); that's been removed on purpose
— a protocol can only ever use equipment the user's table actually lists, at a
bench or a fixture alike, never something implied by the map alone. See the
retrieve/dispose bookend below for how `protocolGen.js` degrades gracefully
(a warning, not a crash) when a table doesn't map anything to those stations.

The 4 vertical walkways and the back walkway render as **one continuous shaded
region** (`WALKWAY_PATH`, a single comb-shaped SVG path) rather than 5 separate
boxes — the vertical lanes are extended down to meet the back walkway with no gap,
so there's no seam where they join. The back walkway itself (`BACK_AISLE`) is wide
enough to reach past the refrigerator, so it reads as sitting on an extension of
the same walkway rather than floating past an unmarked gap.

**Table parsing (`src/labTable.js`)** — `parseLabTable(raw)` takes a pasted
spreadsheet table (tab-separated; falls back to comma-separated, though the comma
fallback can't disambiguate a multi-station cell from the row delimiter — tab-
separated paste is the reliable path) with columns `[Equipment, Station Name]`.
The Station Name cell may list more than one station for the same equipment row,
comma- or semicolon-separated (e.g. `GC-MS 1, GC-MS 2` — a shaker that lives at
two stations) — every name is matched case-insensitively against `NAME_TO_
STATION_ID` (data.js) and every valid one gets the equipment added to it; invalid
names are reported per-location without dropping the rest of that row. There is
no location-code column at all — a pasted table only ever names equipment and
the station it lives at, never an A1-H3/SHARPS-style id. Auto-detects and skips a
header row. A fixture station (e.g. "Biohazard Waste") is validated exactly like
a bench — only equipment a row explicitly maps there ever ends up in the result;
nothing is added on its own. Returns `equipToStations` (equipment → station ids),
`stationEquip` (station id → equipment list), and `errors` so bad paste data is
visible instead of silently dropped. Display names are never parsed from the
table — `STATION_NAME` in data.js is the single source of truth everywhere a
name is shown.

**Protocol generation (`src/protocolGen.js`)** — `generateProtocols(equipToStations,
opts)` builds `count` fake protocols, each a random-length (`minSteps`–`maxSteps`)
sequence of steps. Each step's type (Read or Write) is deterministic, not random —
`classifyStepType` (`src/stepType.js`) keyword-matches the equipment name
(readers/scopes/balances/etc. → Write, since there's a measurement to record;
centrifuges/shakers/incubators/etc. → Read, since there's nothing to write down).
Everything else is drawn from a `mulberry32` seeded stream (`src/rng.js`) so the
same inputs always reproduce the same protocols. Each generated protocol carries
its step list plus `stationsVisited` and `travelFt` (summed `BENCH_DIST_FT` across
the sequence, in feet) so "does this actually force movement" is directly visible.
Protocols are titled `Protocol 1`, `Protocol 2`, etc. in generation order.

Every protocol is bookended *if the loaded equipment supports it*: it opens with
some combination of Glassware/Consumables 1/Consumables 2 steps (`OPEN_POOL`) and
closes with some combination of Sink/Biohazard Waste/Sharps Bin steps
(`CLOSE_POOL`). `pickPoolSubset` draws a random-size (1..N), random-order,
no-repeat subset of whichever pool members actually have equipment mapped to
them — every count and every specific subset is equally likely (it's a
random-length prefix of a Fisher-Yates shuffle) — so a table missing some (or
all) of a pool's stations just uses fewer of them, or drops that bookend
entirely, rather than inventing a step with no real equipment behind it. Within
a bookend, equipment never repeats back-to-back (and `pickPoolSubset` never picks
the same station twice), so a consumable/waste step never immediately follows an
identical one. `minSteps`/`maxSteps` are honored inclusive of the bookend steps
and the guaranteed pipette step below, bumped up automatically when the
configured range is too tight to fit them. The random walk that fills the middle
steers clear of *both entire pools* (the `reserved` set is `OPEN_POOL ∪
CLOSE_POOL`, all 6 station ids, regardless of which specific subset this
protocol's bookends ended up using) — they're single, fixed locations with no
alternate bench to reroute to, so letting the middle walk land on one would risk
a repeat right next to the real bookend step, or (see below) landing on a station
the pipette rule later turns out to need for the close.

Unlike the bookends, the middle walk *does* allow the same equipment — and, for
single-station equipment, the literal same bench — to repeat on consecutive
steps; the "keep moving" rule now only still applies to the six pool stations,
which the middle walk can never reach at all regardless of what's mapped there.
Multi-station equipment is still resolved via `farthestStation`, so reusing it in
practice still tends to route to a different bench, but that's now an emergent
effect of the distance model rather than an enforced rule.

A pipette isn't tied to one specific station — any bench with pipettes and bench
space works — so on top of the real equipment loaded from the table, a step
whose equipment is `"Pipette"` is a candidate in the middle walk, resolved
against the fixed `PIPETTE_STATIONS` pool (`data.js`) the same farthest-station
way as any other multi-station equipment (`generateProtocols` builds this by
merging a synthetic `Pipette: PIPETTE_STATIONS` entry into the equipment map
before generation, not by touching the pasted table). Every protocol is
guaranteed at least one pipette step — one middle-walk slot is pre-assigned to
`"Pipette"` before the walk runs (`nSteps` is bumped up to guarantee that slot
exists even when the bookends alone would already fill the configured
`minSteps`/`maxSteps`), and any of the walk's other, ordinary draws can also
land on `"Pipette"` by chance. Because every protocol therefore uses a pipette,
every protocol is also required to close with a Sharps Bin step as its literal
*last* step (used pipette tips are sharps waste) — after the middle walk runs,
`SHARPS` is moved to the end of the close bookend (added there if the close
subset didn't already include it, or relocated there if `pickPoolSubset` had put
it earlier in the subset), as long as equipment is mapped to the Sharps Bin,
even if that pushes the protocol one step past `maxSteps`.

The other 2 fixtures (the recycling bin, the 4C refrigerator) aren't bookend
steps and aren't reserved — they can appear anywhere in the middle walk if
equipment is mapped there. A random walk over a large equipment pool can still
miss a fixture across a small batch, so after the normal draw,
`generateProtocols` checks whether every fixture *with equipment mapped to it*
(bookend pools included) was actually visited by some step; if any weren't, one
extra "coverage" protocol is appended that walks to each missed fixture in turn.
This coverage protocol isn't held to the bookend rule (it's a single-purpose
fixture-visit, not a simulated protocol). A table that never maps equipment to a
given fixture never visits it at all — the map's fixtures are only ever
reachable through equipment the user's table put there (Pipette, resolved
against its own hardcoded pool, is the one deliberate exception, same as in
`protocolImport.js` below).

**Protocol import (`src/protocolImport.js`)** —
`parseProtocol(raw, equipToStations, distTable = BENCH_DIST_FT, pipetteStations = PIPETTE_STATIONS)`
is the counterpart to `protocolGen.js` for a *real* protocol pasted from a
spreadsheet, rather than a generated fake one. The first pasted line is the
protocol's own name — a single title above the table (e.g. "Overnight Culture
Prep") — captured into the returned `name`, unless that line already looks like
a valid data row (its second cell already matches the Substep pattern below),
which keeps a paste that skips straight to data working unchanged; a bare
`"Step"` header cell with no name given is also recognized and left out of
`name` rather than being captured verbatim. An optional header row (e.g. "Step
\tSubstep\tEquipment") may follow the name line and is skipped the same way.
After that, columns are `[Step, Substep, Equipment]` (extra trailing columns
are ignored): a Step cell reads `"N. Name"` and — because it comes from a
merged spreadsheet cell — only appears on that step's first row, every later
substep row leaving it blank; a Substep cell is strictly `"N.M"` (e.g.
`"1.2"`), which is what tells the two apart and is also the grouping key (the
Step cell is only ever used for its name text, never cross-checked against the
substep's own step number). Because a blank leading cell is meaningful here,
lines are only trimmed for the blank-line check, never for content — trimming
a whole line would strip the leading tab that marks a continued step and shift
every column over. Error messages' row numbers account for however many
leading lines (name, header) were skipped, so they still point at the actual
pasted line.

Each substep's Equipment cell is matched case-insensitively against
`equipToStations` (the same map `parseLabTable` builds, loaded from whatever's
on the Equipment Input tab) to find its station. Equipment not found on the loaded
map still gets a substep entry (so the formatted view shows it, with `station:
null`) and is reported in `errors`, but never contributes to a path. When
equipment lives at more than one station, `nearestStation` picks whichever is
*closest* to the previous substep's station — the opposite of `protocolGen.js`'s
`farthestStation`, deliberately: that function is forcing artificial movement
across an invented protocol, this one is plotting the realistic route of a real
one, where a technician would use the nearest instance of a thing, not detour to
the far one. That "previous station" tracking runs across the *whole* protocol,
not reset per step, so the plotted route is one continuous walk even across step
boundaries.

One exception to "only equipment the pasted list explicitly maps ever gets a
station" (see the fixtures discussion above): a substep whose Equipment cell
reads exactly `"Pipette"` (case-insensitive, not a substring match — "Pipette
Tips Restock" still goes through the normal `equipToStations` lookup) is
resolved against `PIPETTE_STATIONS` (`data.js`), a hardcoded pool of 8 station
names with pipettes and bench space, via the same nearest-to-`lastStation`
logic — a pipette isn't one specific piece of equipment tied to one bench, so
it's never reported as missing from the equipment list the way a real
instrument name would be.

Returns `name` (the protocol's title, or `null` if the paste didn't have one),
`steps` (ascending by number, each with its own `substeps`, `path` — the
station-only, null-filtered list for that step's own route — `stationsVisited`,
and `travelFt`), plus whole-protocol `fullPath`/`fullStationsVisited`/
`fullTravelFt` computed over the single concatenated path (so the whole-protocol
total also counts the walk from one step's last station to the next step's
first, not just the sum of each step's own smaller total), and `errors`.
`distTable`/`pipetteStations` default to the real floor's own
(`BENCH_DIST_FT`/`PIPETTE_STATIONS`) — the only caller that ever passes
different ones is the Lab Optimizer below, scoring a candidate layout without
needing its own copy of this nearest-station walking logic.

**Lab Optimizer (`src/labOptimizer.js`)** — `optimizeLayout(equipToStations,
protocolTexts, opts)` searches for a station layout that minimizes total travel
distance across a set of pasted real protocols (same Step/Substep/Equipment
format `protocolImport.js` parses), sharing that exact parsing/nearest-station
logic rather than duplicating it. A candidate layout is a `benchOf` permutation
(bench name → physical id, covering exactly the 24 real names from
`BENCH_NAMES`) plus an `anchorKey` (`"BC"`/`"DE"`/`"FG"`) for the sharps/
recycling/biohazard trio — together these encode the three constraints on what's
allowed to move: only the fixed A1-H3 grid exists (`benchOf` only ever draws
from `BENCH_NAMES`'s own ids); the Sink, Glassware, Consumables 1, Consumables
2, and 4C Refrigerator never move (they're fixtures, not bench names, so
`remapId` passes their id straight through untouched); and the trio can only
relocate as a group, to one of the 3 touching pairs, keeping its fixed
left-to-right order (`DIST_TABLES_BY_ANCHOR`/`trioFixturesForAnchor` in
data.js already enforce that). `remapEquipToStations` turns the real,
current `equipToStations` (equipment → physical ids) into a candidate one by
converting each id to its real station *name* (`STATION_NAME[id]`, layout-
invariant) and back through the candidate's own `benchOf` — the same trick
handles "Pipette" steps, by remapping `PIPETTE_STATION_NAMES` through
`benchOf` before handing it to `parseProtocol` as `pipetteStations`, so a
pipette-capable bench that got moved is still found where it actually is now.

Since exhaustively trying all 24! bench permutations (times 3 anchors) is
impossible, `hillClimb` runs a seeded simulated-annealing local search per
anchor — several restarts (one always the identity permutation, so a restart
can never make its own anchor's result worse than doing nothing) doing random
pairwise bench-name swaps, accepting worse ones early on with a decaying
probability so it can climb out of local minima, and remembering the best
`benchOf` any restart ever reached. The overall best across all anchors then
goes through `minimizeMoves` — annealing has no reason to prefer the baseline
among stations whose arrangement makes no difference to the pasted protocols,
so its raw output can carry along pointless swaps; `minimizeMoves` greedily
reverts one displaced bench at a time (swapping it back to its baseline
position together with whoever's squatting there) whenever that doesn't
increase the total, until nothing more can be undone. What's left is the
smallest set of moves that still achieves the best score found — this, not the
raw search output, is what the UI shows as "recommended moves". Neither step
claims a provably optimal layout, and the baseline (today's real layout) is
always evaluated as a candidate too, so the result is never worse than doing
nothing.

Returns `baseline` and `best`, each `{ anchorKey, benchOf, totalTravelFt,
perProtocol, stationNames, fixtures, stationEquip, visitCounts }` —
`stationNames`/`fixtures`/`stationEquip`/`visitCounts` are pre-built in the
exact shape `LabMap.jsx`'s override props expect, so the tab can render either
layout (heat map included) without its own remapping code. `visitCounts`
(station id → how many times it's stepped on, summed across every pasted
protocol under that layout) is tallied for free off the same per-protocol
`parseProtocol` call `perProtocol` already needs. Also returns `moves`
(`{ name, from, to }` for every bench that actually moved), `totalMoves`
(`moves.length`, plus 3 if the trio relocated — it's 3 real stations moving
together even though that's reported as one `anchorChanged` flag rather than
3 more `moves` rows), `anchorChanged`, `improvementFt`, `improvementPct`, and
`warnings` (no equipment loaded / no protocols pasted, mirroring the other
generators' graceful-degradation style).

**UI (`src/`)** — four tabs driven by `App.jsx`, sharing one parsed `labData`
(`parseLabTable` over the raw pasted text, memoized in `App.jsx`):
- `App.jsx`: also owns the raw pasted equipment text's persistence — it's read
  from `localStorage` (`damp-lab-raw-table` key) on boot via `loadStoredTable`, so
  the last-used equipment list loads automatically, and a `useEffect` writes it
  back on every change, so pasting a new table over it overwrites what's stored.
  This is deliberately `localStorage` (survives indefinitely, across browser
  restarts) since the equipment list is a standing fixture of the lab, unlike the
  pasted protocol on the Protocol Visualizer tab (see `ProtocolImportTab.jsx`
  below), which is intentionally session-scoped instead. Storage errors (private
  browsing, disabled storage) are swallowed — the app just falls back to a blank
  table rather than crashing.
- `LabBuilderTab.jsx` (tab label "Equipment Input"): the paste textarea, row-error
  list, and the `LabMap.jsx` render of the resulting station/equipment layout.
- `ProtocolGeneratorTab.jsx` (tab label "Protocol Generator"): controls for protocol count / min-max steps / seed, a
  "Generate" button, and a column of cards per generated protocol (station/equipment/
  Read-or-Write type per step) beside a larger `LabMap.jsx` — the map is the point of
  the page, so it gets the majority of the width. Each step's Station column shows
  `STATION_NAME[s.station]` (with the full name as a `title` tooltip if it's
  truncated) rather than the internal id — a technician reading the card should
  never need to know a bench is "A3" to recognize it's "Hamilton". Selecting a
  protocol highlights its routed bench-to-bench path via the `highlightPath` prop.
- `LabMap.jsx`: pure rendering component — takes `stationEquip` (and optionally
  `highlightPath`, an ordered list of station ids) and draws the 24-bench SVG grid
  plus all 5 walkways as plain unlabeled open lanes. Every bench/fixture label comes
  from `STATION_NAME`/`FIXTURES` in data.js by default, but two optional props —
  `stationNames` (id → name) and `fixtures` (id → pixel box) — can override either,
  which is how `LabOptimizerTab.jsx` renders a candidate layout (relabeled benches,
  a relocated trio box) without the component needing any layout-specific logic of
  its own; every other tab just omits them and gets the real, current map. A third
  optional prop, `heatCounts` (station id → visit count), switches every box's fill
  from the plain empty/has-equipment coloring to a heat map: `heatFill` mixes
  `C.slot` (unvisited, the same neutral gray as "empty") toward `C.red` by
  `count / maxCount` (via `mixHex` in constants.js), with a 0.2 floor so even a
  single visit reads as visibly hotter than zero; each box's corner label switches
  from "N eq" to "N visits" to match, and the bottom legend swaps its two-swatch
  key for a gradient bar between "0 visits" and the busiest station's count. A
  multi-step `highlightPath` is expanded through
  `routeWaypoints` per consecutive pair into one continuous **solid** line (always
  touching the front of every bench it uses and the middle of every walkway it
  transits) — never a dashed line or one cutting through a bench. A station revisited
  by non-consecutive steps gets one merged "1,3"-style badge instead of a second
  marker silently overlapping the first. A busy badge (many revisits, e.g.
  Consumables in a long real protocol) would otherwise grow one wide pill that
  overlaps its neighbors — instead `wrapStepNums` packs the step numbers into as
  few comma-joined rows as fit a safe per-row width (font size also steps down as
  the count grows: 9px for up to 3 numbers, 8px up to 6, 7px beyond that), so the
  badge grows taller rather than wider and every number is still shown, never
  collapsed to a count. A small ruler (`SCALE_FT`/`SCALE_LEN`, drawn with the
  exported `FIXTURE_PX_PER_FT`) sits in the empty floor corner below column A as
  the map's one literal, pixel-accurate distance reference — bench spacing itself
  is stylized for legibility, not drawn to that same scale, so a text line
  spelling out several "~Nft" figures for different parts of the floor would
  overstate how precise any of it is; one honest "5 ft" tick mark is what's here
  instead. Has no simulation state; it only knows what's in the parsed table.
- `ProtocolImportTab.jsx` (tab label "Protocol Visualizer"): the paste textarea
  for a real protocol, an error list, and a column of cards beside a `LabMap.jsx`
  — a summary card for the whole protocol (selected by default, titled from
  `parsed.name` — the protocol's own pasted name — falling back to "Full
  Protocol" only if the paste didn't have one) plus one card per step, each with
  its own substep table (station/equipment/Read-or-Write, mirroring
  `ProtocolGeneratorTab`'s card layout and its Station-shows-the-name treatment);
  an unresolved substep shows `?` in red instead of a name. Selecting a step highlights just that step's
  own `path`; the summary card highlights `fullPath`, the whole route start to
  finish. The pasted protocol text itself is persisted to `sessionStorage`
  (`damp-lab-raw-protocol` key, read on mount / written on every change,
  mirroring `App.jsx`'s equipment-list persistence) — deliberately
  `sessionStorage`, not `localStorage`: it should survive a reload within the
  same browser session but never resurface in a later one, unlike the equipment
  list.
- `LabOptimizerTab.jsx` (tab label "Lab Optimizer"): a `protocols` count field
  drives an array of textareas (one per protocol, same Step/Substep/Equipment
  paste format as `ProtocolImportTab.jsx`, session-persisted the same way under
  a different key) plus an "Optimize" button that calls `optimizeLayout`. The
  result renders as a stat row (current/optimized total ft, ft+% saved, and
  `totalMoves`), a side-by-side pair of heat-mapped `LabMap`s — "Optimized
  layout" first/left (the result the user is here for), "Current layout"
  second/right for comparison, each fed its own `stationNames`/`fixtures`/
  `stationEquip`/`heatCounts` (from `result.best`/`result.baseline`) via the
  override props above — and a "Recommended moves" table (`{ name, from, to }`,
  the From column in `C.red` and To in `C.green` so a move reads at a glance,
  plus a called-out line if the trio's anchor changed). This tab intentionally
  only *reports* the suggested layout; it doesn't rewrite `data.js`'s hardcoded
  `BENCH_NAMES` or affect any other tab, consistent with every other tab here
  being a read-only analysis view over the real, fixed floor plan.
- `Controls.jsx`: shared widgets carried over from the original sim UI — trimmed
  down to just `NumField` (protocol count / min-max steps / seed inputs across
  the generator tabs); every other original widget (`Dropdown`, `StatCard`,
  `InfoDot`, `Slider`, `Toggle`, `Section`, `Panel`) went unused once this repo
  was stripped down to its current scope and was removed.

## Working in this codebase

- `labTable.js`, `data.js` (the routing model), `stepType.js`, `protocolGen.js`,
  `protocolImport.js`, and `labOptimizer.js` are the places with actual logic; all
  have an `npm test` suite — run it after changing any of them. UI changes should
  also be verified with `npm run dev` (paste a table, confirm the map renders,
  generate protocols, confirm consecutive steps land on different benches and the
  highlighted path only ever travels through a walkway, never straight through a
  bench; on the Lab Optimizer tab, confirm the "optimized" map's relabeled benches
  and (when it recommends one) relocated trio box actually match `moves`/
  `anchorChanged`).
- Protocol generation and the Lab Optimizer's search are both seeded (`mulberry32`
  in `src/rng.js`) so the same table + settings + seed always produce the same
  output — keep any new randomness routed through that seeded stream rather than
  `Math.random()`.
- The bench grid (`SLOTS` in `data.js`) is fixed at A1–H3, plus the 8 fixed fixtures
  in `FIXTURES`, and every one of those 32 stations has a fixed name in
  `BENCH_NAMES`/`STATION_NAME`; `labTable.js` validates pasted station names against
  `NAME_TO_STATION_ID`, not the ids directly. If the grid ever needs to grow (more
  rows/columns, storage aisles back in scope), a fixture's dimensions/position
  change, or a station's real-world name changes, it all lives in `data.js` —
  nothing else hardcodes bench/fixture positions or names. If the physical
  reference measurements change, they're the `*_FT` constants at the top of
  `data.js` — `routeDistanceFt`/`routeWaypoints` derive everything else from them, so
  nothing else needs updating.
- The Read/Write keyword list in `stepType.js` is a heuristic, not a lookup table —
  if a new equipment name is consistently misclassified, add its keyword there rather
  than special-casing it in `protocolGen.js`.
