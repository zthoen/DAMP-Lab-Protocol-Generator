# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

DAMP Lab - Cirrus — a browser-based tool that turns a pasted equipment/bench
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
different walkways). `routeDistanceFt(a, b)` picks one of three shapes, walking
diagonally instead of in an L wherever a diagonal is provably safe (never crosses a
bench that isn't one of the route's own two endpoints) and always shorter
(`Math.hypot(v, l) <= v + l`):
- **Same walkway, same or adjacent row** (same column with `|rowA-rowB| <= 1`, or two
  different columns of a pair on any row): the vertical hop and the lateral crossing
  are walked as one diagonal — the whole rectangle between the two stations is open
  floor, so nothing blocks a direct line.
- **Same walkway, two rows apart** (row 1 to row 3): a bench sits directly between
  the two rows regardless of which column it's in — no gaps within a column — so a
  direct diagonal would clip it. This one case falls back to the old squared-off
  route (down/up plus at most one walkway-width crossing).
- **Different walkways**: descending/ascending each side's own walkway stays a
  straight vertical hop (cutting sideways before reaching the back walkway would clip
  whatever benches sit between the two walkways), but once you're at the back
  walkway — open along its *entire* width — its own crossing depth and however far
  laterally to the other walkway (counted in bench-*widths*, not bench-lengths) are
  walked as one diagonal too, the same reasoning as the same-walkway case, just
  applied to the aisle's rectangle instead of a walkway's.

`BENCH_DIST_FT` precomputes this for every station pair (so the protocol generator
doesn't recompute a route per draw) and `routeWaypoints(a, b)` returns the matching
pixel path — deliberately *decoupled* from the feet numbers above rather than
mirroring them exactly, because a technician doesn't actually walk hugging a bench's
raw edge or cutting a walkway at a raw angle. Every drawn route starts and ends at a
station's front, never its center (`front(id)`, exported for this), so the line
never overlaps into a station's own box. A route doesn't need to be funneled through
a walkway's exact middle, though — it isn't a floor-marked lane narrower than the
walkway itself:
- **Same walkway, two different columns of a pair** (any combination of rows): a
  direct line, front to front, with nothing in between — safe because both "front"
  points already sit exactly on the walkway's boundary, so the line between them
  never re-enters either column's width.
- **Same column, adjacent rows** (`|rowA-rowB| === 1`): also a direct front-to-front
  line — same safety argument, and there's no third bench in the way to begin with.
- **Same column, two rows apart** (row 1 to row 3): front to front here would run
  exactly along that column's own edge for the entire span — safe (it's the middle
  bench's boundary, never its interior), but indistinguishable from hugging that
  bench's wall the whole way rather than actually walking past it. This one case
  bows out to the walkway's own center (`walkwayCenterX`) at the middle row's height
  first, then in to the destination's front — two diagonal legs instead of a flush
  vertical line, still provably safe for the same reason (both legs stay within the
  walkway's rectangle, since x only ever moves from the column's edge outward toward
  the center, never past it).
- **Different walkways, or anything touching a fixture** (including the trio,
  aliased to its anchor column's row-3 bench for visual consistency even though
  that's numerically a same-column reach in feet) routes via the back-walkway rail
  (`toRailPoints`/`fromRailPoints`), but each station enters at *its own* natural
  edge (`railSideY`) — the far row (sink/glassware/consumables/refrigerator) sits
  below the rail, everything else (a bench via its own walkway, or the trio) sits
  above it — not always "enter top, leave bottom" regardless of which station is
  which. Two stations that share a side (the whole trio with each other, the whole
  far row with each other, or a bench with the trio, which per `routeDistanceFt`
  never really crosses the rail's depth at all) meet at that one shared edge, so the
  crossing is a single straight line along it — the entire rail reads as one
  continuous, directly-walkable pathway for same-side stations, never a detour to
  the opposite edge and back. Only a pair that's genuinely on opposite sides (a
  bench or the trio against the far row) draws a real diagonal, entering at one edge
  and leaving from the other, which is what makes *that* crossing shorter than
  walking the two legs separately — while staying entirely inside the rail's own
  open rectangle throughout.

`test/data.test.js` proves the safety property exhaustively — a Liang-Barsky
segment/AABB check confirms every same-walkway route, across all 24 real benches,
never crosses a third bench's box — rather than trusting the hand-argued geometry
alone. (This is also why front, not center, matters: a raw center-to-center diagonal
*isn't* safe two rows apart, since it has to travel some distance inside the start
and end benches' own boxes first, and that's exactly where it can drift into the row
between them — anchoring at the boundary instead removes that risk entirely.)

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

**Table parsing (`src/labTable.js`, `src/protocolImport.js`)** — both parsers paste
a spreadsheet table (tab-separated; falls back to comma-separated) and share one
line-splitting primitive, `splitRow` (`src/pastedTable.js`), so the two can't drift
out of sync on that basic tokenizing rule.

`parseLabTable(raw)` takes a pasted table (tab-separated; falls back to comma-
separated, though the comma fallback can't disambiguate a multi-station cell from
the row delimiter — tab-separated paste is the reliable path) with columns
`[Equipment, Station Name]`.
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
same inputs always reproduce the same protocols — and "same inputs" means the same
equipment-to-station *mapping*, not the same pasted row order: `equipment` (the
list every random pick indexes into) is `Object.keys(equipToStationsFull).sort()`,
not raw insertion order, specifically so two people pasting an equivalent table in
a different row order and using the same seed get back the identical list of
protocols — a shareable seed wouldn't mean much if it only reproduced for the
exact paste that generated it. Each generated protocol carries its step list plus
`stationsVisited` and `travelFt` (summed `BENCH_DIST_FT` across the sequence, in
feet) so "does this actually force movement" is directly visible. Protocols are
titled `Protocol 1`, `Protocol 2`, etc. in generation order.

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
first, not just the sum of each step's own smaller total), `stepLinks` (one
`[lastStationOfStepN, firstStationOfStepN+1]` pair per step boundary — a step
with no resolved stations at all can't anchor a link on either side of it — for
`LabMap.jsx` to draw the hand-off between steps as its own dashed overlay,
routed the same way as everything else but visually distinct from ordinary
within-step movement), and `errors`. `distTable`/`pipetteStations` default to
the real floor's own (`BENCH_DIST_FT`/`PIPETTE_STATIONS`) — the only caller
that ever passes different ones is the Lab Optimizer below, scoring a
candidate layout without needing its own copy of this nearest-station walking
logic.

**Lab Optimizer (`src/labOptimizer.js`)** — `optimizeLayout(equipToStations,
protocolTexts, opts)` searches for a station layout that minimizes total travel
distance across a set of pasted real protocols (same Step/Substep/Equipment
format `protocolImport.js` parses). A candidate layout is a `benchOf`
permutation (bench name → physical id, covering exactly the 24 real names from
`BENCH_NAMES`) plus an `anchorKey` (`"BC"`/`"DE"`/`"FG"`) for the sharps/
recycling/biohazard trio — together these encode the three constraints on what's
allowed to move: only the fixed A1-H3 grid exists (`benchOf` only ever draws
from `BENCH_NAMES`'s own ids); the Sink, Glassware, Consumables 1, Consumables
2, and 4C Refrigerator never move (they're fixtures, not bench names, so
`remapId` passes their id straight through untouched); and the trio can only
relocate as a group, to one of the 3 touching pairs, keeping its fixed
left-to-right order (`DIST_TABLES_BY_ANCHOR`/`trioFixturesForAnchor` in
data.js already enforce that).

Every one of the 24 bench names a pasted protocol set never actually
references costs the same wherever it sits — nothing ever looks its position
up — so the search only ever needs to decide where to put the ones that *are*
referenced. `planSteps` pre-parses each protocol once (reusing
`parseProtocol`'s own row/step/substep splitting, via a throwaway call with an
empty equipment map) into a layout-independent plan: for each substep, the
list of "identifiers" — bench *names* or fixture *ids* — its equipment could
resolve to, so no protocol text ever needs re-parsing while candidate layouts
are being tried. `relevantNamesFrom` unions those across every step of every
protocol to get the small set of bench names ("Pipette" pulls in all 8
`PIPETTE_STATION_NAMES` at once) the search actually has to place, and flags
whether the trio is referenced at all (skipping the other 2 anchors entirely
when it isn't). `resolveSequence` walks a plan under a candidate `benchOf`
with the same nearest-of-several-candidates logic as
`protocolImport.js`'s `nearestStation`/`travelFtOf` (verified equivalent to it
by the exactness tests below), just without allocating an intermediate
equipment map per call — `benchOf[identifier] ?? identifier` resolves a bench
name through the candidate layout or passes a fixture id straight through,
since fixture ids are never keys in `benchOf`.

Because only those relevant names matter, `exactSearch` can afford to
brute-force *every* way to place them across the 24 real ids (backtracking,
no pruning) whenever that arrangement count — `permutationCount(24, R)` times
the total step count, times how many anchors are worth trying — fits under
`opts.exactBudget` (`DEFAULT_EXACT_BUDGET`, tuned from benchmarking
`resolveSequence` at ~30ns per arrangement-step to target roughly a 1.5s worst
case). When it fits, the result is the *actual, provably optimal* layout for
these protocols, not a best guess, and it's completely deterministic — no
seed plays any part. Only when there are too many relevant names for that
budget does `optimizeLayout` fall back to `hillClimbRestricted`, a
simulated-annealing local search — still restricted to swapping only relevant
names into random positions (never wasting an iteration on two names whose
placement can't matter), so even the fallback explores a far smaller,
better-targeted space than an earlier version of this search that considered
all 24 names regardless of relevance did. Rather than trusting a single
seed's random walk, which can get stuck in a mediocre local optimum, the
fallback sweeps every value in `DEFAULT_SEEDS` (24 spread-out seeds)
independently and keeps the single best result across all of them — this is
what makes the fallback reliably strong without asking anyone to hand-pick a
seed; there's no seed control in the UI, `opts.seeds`/`opts.seed` exist only
as test hooks for a smaller, faster sweep.

Either way, `completeBenchOf` fills in every leftover bench name arbitrarily
(baseline order) to round the relevant-only assignment out into a full
24-name `benchOf`, and the raw result still goes through two safety steps
before being reported: a check against the slow, proven `totalTravelFt` (the
same `parseProtocol`-based path the Protocol Visualizer uses) that discards
the fast search's proposal outright if it's ever somehow worse than doing
nothing, and `minimizeMoves`, which greedily reverts one displaced bench at a
time back to its baseline position (swapping with whoever's squatting there)
whenever that doesn't increase the total, until nothing more can be undone —
turning "every name the search happened to touch" into "only the moves that
actually matter," which is what the UI shows as "recommended moves." Because
the final number always comes from that same proven `totalTravelFt`/
`describeLayout` path regardless of which search strategy proposed the
layout, a bug in the fast exact/heuristic engine could only ever cause a
missed improvement — never a wrong "optimized" figure shown to the user.

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
3 more `moves` rows), `anchorChanged`, `improvementFt`, `improvementPct`,
`optimal` (true when the result is the proven global optimum rather than a
best-effort search result — `LabOptimizerTab.jsx`'s banner reports this
directly), `relevantStationCount` (how many of the 24 benches the search
actually had to consider), and `warnings` (no equipment loaded / no protocols
pasted, mirroring the other generators' graceful-degradation style).

**Persisted paste state (`src/usePersistedState.js`)** — every "remember what was
pasted here" field in the app (the equipment table, the Protocol Visualizer's
paste, the Lab Optimizer's protocol textareas) is a `useState` that also reads
from and writes back to a `Storage` object (`localStorage`/`sessionStorage`)
under a fixed key, via the shared `usePersistedState(storage, key, defaultValue,
{ serialize, deserialize })` hook — every storage error (private browsing,
disabled storage, unexpected stored shape) is swallowed the same way: fall back
to `defaultValue` on read, silently skip persisting on write. `serialize`/
`deserialize` default to identity for a plain pasted string; the Lab Optimizer's
array of protocol texts is the one caller that passes `JSON.stringify`/a
shape-validating parse instead (see `LabOptimizerTab.jsx` below).

**UI (`src/`)** — four tabs driven by `App.jsx`, sharing one parsed `labData`
(`parseLabTable` over the raw pasted text, memoized in `App.jsx`):
- `App.jsx`: also owns the raw pasted equipment text's persistence, via
  `usePersistedState(localStorage, "damp-lab-raw-table", "")` — the last-used
  equipment list loads automatically on boot, and pasting a new table overwrites
  what's stored. This is deliberately `localStorage` (survives indefinitely,
  across browser restarts) since the equipment list is a standing fixture of the
  lab, unlike the pasted protocol on the Protocol Visualizer tab (see
  `ProtocolImportTab.jsx` below), which is intentionally session-scoped instead.
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
  single visit reads as visibly hotter than zero. Every station shows its own
  visit count in heat-map mode, benches and fixtures alike: a bench's corner
  label switches from "N eq" to "N visits" to match; a fixture (too small to
  hold text inside its own box) gets a second `"N visits"` line stacked next to
  its existing ID label — below the ID for the sharps/recycling/biohazard trio
  (which only has open floor below it, in the walkway) and below the box itself
  for the sink/glassware/consumables/refrigerator row (whose ID sits above,
  leaving the space below the box free). The bottom legend swaps its two-swatch
  key for a gradient bar between "0 visits" and the busiest station's count. A
  multi-step `highlightPath` starts at the first station's *front* (`front(path[0])`,
  never its center) and is expanded through `routeWaypoints` per consecutive pair into
  one continuous **solid** line — always front-to-front, direct wherever a walkway
  or rail crossing allows it, never funneled through the middle of one first —
  never a dashed line, never one overlapping into a station's own box. A station
  revisited by non-consecutive steps gets one merged "1,3"-style badge instead of a
  second marker silently overlapping the first. Whenever a non-empty `highlightPath`
  is passed, `LabMap.jsx` also renders a **walking-technician preview**: an animated
  dot plus Play/Pause buttons that walks the same route, pausing `PAUSE_MS` (2s) at
  every station visit (including revisits) and traveling between them at a fixed
  pixel speed (`TRAVEL_PX_PER_SEC`) so a longer walk animates for proportionally
  longer. Play resumes from wherever the dot currently sits (or restarts from
  station 1 if the animation already finished); Pause freezes it in place. The
  animation timeline is keyed off the path's *contents* (`path.join("|")`), not its
  array identity, since the parent tab passes a freshly-built array on every render
  (e.g. on hover) — keying on identity would otherwise reset playback constantly.
  A fifth optional prop, `stepLinks` (an array of `[a, b]` station-id pairs —
  `ProtocolImportTab.jsx` passes at most one, see below), draws each pair's
  `routeWaypoints` route as its own **dashed**, soft-green (`C.sage`) polyline
  layered on top of the main solid one — going only as far as that one pair,
  never extending past the destination station — so a step-to-step hand-off
  reads as visually distinct from ordinary within-step movement (the bottom
  legend labels the two "Path to Next Station" and "Path to Next Step"
  respectively, each only appearing once there's actually a line of that kind
  to explain). The technician dot isn't confined to the solid line, though —
  when `stepLinks` is showing, the animation timeline is built from `path`
  with the link's destination station appended (`routeWaypoints` connects
  them identically to how the dashed line itself is drawn, so the dot arrives
  exactly where the dashed line ends), meaning Play walks the dot straight
  off the end of the current step and on down the dashed hand-off. A sixth
  optional prop, `onStepComplete`, fires once when that extended run
  finishes, and *only* when it was actually extended (finishing a step with
  no link, or "Full Protocol", never fires it, since there's nowhere further
  to advance to); `ProtocolImportTab.jsx` implements it to select the next
  step, so the map and step list both update automatically and the user only
  has to hit Play again to keep walking through the protocol, one step at a
  time, without ever clicking back over to the step list themselves. The
  reset-on-path-change logic and this completion check have to live in the
  *same* effect, not two separate ones both watching `pathKey` — auto-
  advancing hands the component a new (often much shorter) pathKey while
  `elapsed` still holds its old value from the previous, often much longer,
  step; two effects would let the completion check run on that same pass
  against the stale `elapsed`, see it already exceeds the new timeline's
  (smaller) `totalMs`, and immediately re-fire `onStepComplete` — silently
  skipping the just-selected step before it's ever shown, faster than a
  render. Folding both checks into one effect means a `pathKey` change always
  resets and returns *before* any completion check runs, so it never sees
  stale `elapsed` paired with a fresh `timeline`. The Protocol Generator tab
  never passes `stepLinks`/`onStepComplete` at all, since its protocols are
  flat step lists with no step/substep grouping to have a boundary in the
  first place. This is the only state `LabMap.jsx` owns otherwise; it's a
  pure render of whatever's in the parsed table. A busy badge (many revisits, e.g.
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
  instead.
- `ProtocolImportTab.jsx` (tab label "Protocol Visualizer"): the paste textarea
  for a real protocol, an `ErrorList`, and a column of cards beside a `LabMap.jsx`
  — a summary card for the whole protocol (selected by default, titled from
  `parsed.name` — the protocol's own pasted name — falling back to "Full
  Protocol" only if the paste didn't have one) plus one card per step, each
  rendering its substeps through the shared `StepTable` (see `Controls.jsx`
  below) — an unresolved substep shows `?` in red instead of a name. Selecting a
  step highlights just that step's own `path`; the summary card highlights
  `fullPath`, the whole route start to finish. The dashed step-link overlay
  (see `LabMap.jsx` above) only ever appears while a single step is selected
  — never for "Full Protocol" — and only that one step's own link out
  (`parsed.stepLinks[selectedIndex]`, found by locating the selected step's
  position in `parsed.steps` since step *numbers* aren't reliably 0-based
  contiguous array indices), so it reads as "here's where this step hands off
  to," not a map-wide overlay of every boundary at once. `onStepComplete`
  (`handleStepComplete`) is `parsed.steps[selectedIndex + 1]`'s number, if one
  exists — selecting it is all it does; `LabMap.jsx`'s own path-key reset
  effect takes it from there, since the newly-selected step is a genuinely
  different `highlightPath`. The pasted protocol text itself
  is persisted via `usePersistedState(sessionStorage, "damp-lab-raw-protocol", "")`
  — deliberately `sessionStorage`, not `localStorage`: it should survive a
  reload within the same browser session but never resurface in a later one,
  unlike the equipment list.
- `LabOptimizerTab.jsx` (tab label "Lab Optimizer"): a `protocols` count field
  drives an array of textareas (one per protocol, same Step/Substep/Equipment
  paste format as `ProtocolImportTab.jsx`, persisted the same session-scoped way
  under a different key — `usePersistedState(sessionStorage,
  "damp-lab-optimizer-protocols", ["", ""], { serialize: JSON.stringify,
  deserialize: ... })`, since this one field is a structured array rather than a
  plain string) plus an "Optimize" button that calls `optimizeLayout`. The
  button defers that call a tick (`setTimeout(fn, 0)`, flipping an
  `isOptimizing` flag first) so it can repaint to "Optimizing…" before an
  exact search's worst-case second-or-two runs, rather than just looking
  unresponsive until it's done. The result renders as an `OptimalityBanner` —
  green ("Exact Search: Optimized layout found") using `result.optimal` when
  the search verified every arrangement, amber ("Best Effort Result: These
  protocols reference N stations -- too many for an exact search. This layout
  is improved but not optimized.", using `result.relevantStationCount`)
  otherwise — a stat row (current/optimized total ft, ft+% saved, and
  `totalMoves`), a side-by-side pair of heat-mapped `LabMap`s — "Improved
  Layout" first/left (the result the user is here for; deliberately not called
  "Optimized" since a best-effort result isn't one), "Current layout" second/right for
  comparison, each fed its own `stationNames`/`fixtures`/`stationEquip`/
  `heatCounts` (from `result.best`/`result.baseline`) via the override props
  above — and a "Recommended moves" table (`{ name, from, to }`, the From
  column in `C.red` and To in `C.green` so a move reads at a glance, plus a
  called-out line if the trio's anchor changed). This tab intentionally only
  *reports* the suggested layout; it doesn't rewrite `data.js`'s hardcoded
  `BENCH_NAMES` or affect any other tab, consistent with every other tab here
  being a read-only analysis view over the real, fixed floor plan.
- `Controls.jsx`: shared widgets, some carried over from the original sim UI,
  some pulled out of the tab components as duplication showed up between them —
  `NumField` (protocol count / min-max steps / seed inputs across the generator
  tabs), `ErrorList` (the "N issue(s) found" red-bordered box under a paste
  textarea — Equipment Input and Protocol Visualizer both report per-row parse
  errors the same way), and `StepTable` (the #/Station/Equipment/Type table
  inside every per-step or per-protocol card — Protocol Generator's and Protocol
  Visualizer's cards render the exact same shape of table over slightly
  different data, via `rows: { index, stationId, equipment, action }[]`, where
  `stationId` may be null/undefined for an equipment name that couldn't be
  resolved to a station). Every other original widget from the sim UI
  (`Dropdown`, `StatCard`, `InfoDot`, `Slider`, `Toggle`, `Section`, `Panel`)
  went unused once this repo was stripped down to its current scope and was
  removed.

## Working in this codebase

- `labTable.js`, `data.js` (the routing model), `stepType.js`, `protocolGen.js`,
  `protocolImport.js`, and `labOptimizer.js` are the places with actual logic; all
  have an `npm test` suite — run it after changing any of them. UI changes should
  also be verified with `npm run dev` (paste a table, confirm the map renders,
  generate protocols, confirm consecutive steps land on different benches, the
  highlighted path never cuts through a bench, and the walking-technician dot's
  Play/Pause buttons animate/freeze it correctly on both the Protocol Generator and
  Protocol Visualizer tabs; on the Lab Optimizer tab, confirm the "optimized" map's
  relabeled benches and (when it recommends one) relocated trio box actually match
  `moves`/`anchorChanged`).
- Protocol generation is seeded (`mulberry32` in `src/rng.js`, user-controlled via
  the Protocol Generator's `seed` field) so the same table + settings + seed
  always produce the same output. The Lab Optimizer's search also runs on
  `mulberry32`, but there's no seed field in its UI: `exactSearch` is fully
  deterministic (no RNG at all), and `hillClimbRestricted` sweeps
  `DEFAULT_SEEDS` internally rather than taking one from the user, so the same
  table + protocols always produce the same result without anyone hand-tuning a
  seed. Keep any new randomness routed through `mulberry32` rather than
  `Math.random()`; `rng.js` also exports `randInt(rng, min, max)`, shared by
  `protocolGen.js` and `labOptimizer.js` rather than each keeping its own copy.
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
