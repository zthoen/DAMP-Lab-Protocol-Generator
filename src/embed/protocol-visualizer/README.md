# Protocol Visualizer — embeddable substep navigator

A self-contained TypeScript/React port of one piece of the DAMP Lab Cirrus
Protocol Visualizer: a floor-plan map that shows where a technician is right
now and the route to the *next* station a protocol substep uses. It's
truncated on purpose — it never draws a whole step's or a whole protocol's
route, only ever one hop (current substep's station → next substep's
station). Advancing through a protocol means the host re-renders this
component with new `currentStation`/`nextStation` props, one substep
transition at a time.

This folder has no dependency on the rest of the `damp-lab-cirrus` app (no
`App.jsx`, tabs, or paste/persisted-state UI) — it's meant to be copied
wholesale into another React + TypeScript codebase.

## What's here

- `types.ts` — `StationId`/`BenchId`/`FixtureId` literal unions and small
  geometry types (`Point`, `Rect`, `FixtureRect`).
- `data.ts` — the fixed floor-plan geometry (24 benches + 8 fixtures) and
  routing (`routeWaypoints`) needed to draw a path between two stations.
  Trimmed from the source app's `data.js`: the feet-based distance model
  (used elsewhere for travel-time estimates and a layout optimizer) and
  alternate-anchor support (a layout-search feature) are both dropped —
  this component only ever draws the one real, fixed floor plan.
- `constants.ts` — the color palette, monospace font stack, and a small
  label-wrapping helper.
- `SubstepStationMap.tsx` — the component itself.
- `index.ts` — barrel export.

## Usage

```tsx
import { SubstepStationMap } from "./protocol-visualizer";

function SubstepRunner({ substep, next }: { substep: Substep; next: Substep | null }) {
  return (
    <SubstepStationMap
      currentStation={substep.stationId}       // e.g. "A1", "C3", "SHARPS"
      currentLabel={substep.equipmentName}      // optional
      nextStation={next?.stationId ?? null}
      nextLabel={next?.equipmentName}
      onArrive={() => advanceToNextSubstep()}   // optional
    />
  );
}
```

`currentStation`/`nextStation` must be one of the fixed station ids in
`StationId` (see `types.ts` for the full list, or import `STATION_IDS` /
`STATION_NAME` from `data.ts` to map an id to its real display name). The
host application owns resolving a substep's equipment to a station id —
this component never parses a protocol or looks up equipment itself, it
only draws two already-known stations and the route between them.

Leave `nextStation` unset (or `null`) on the last substep of a protocol —
the map then highlights only `currentStation`, with no route line, no
"NEXT" marker, and no Play button.

### Props

| Prop | Type | Required | Notes |
|---|---|---|---|
| `currentStation` | `StationId` | yes | Where the technician is right now. |
| `currentLabel` | `string` | no | Shown next to the current-station marker/legend line; falls back to the station's real name. |
| `nextStation` | `StationId \| null` | no | The next substep's station. Omit/null on the last substep. |
| `nextLabel` | `string` | no | Same fallback rule as `currentLabel`. |
| `onArrive` | `() => void` | no | Fires once when the walking-technician preview finishes arriving at `nextStation`. Never fires if there's no `nextStation`, or the preview is never played. |
| `className` / `style` | — | no | Passed through to the component's outer `<div>`. |

## Verifying it compiles

This folder has its own `package.json`/`tsconfig.json` so it can be
type-checked in isolation:

```sh
cd protocol-visualizer
npm install
npm run typecheck   # tsc --noEmit
npm run build       # tsc, emits dist/ with .d.ts files
```

`react`/`react-dom` are peer dependencies — the host application's own
copies are used; nothing here pins a specific version beyond `>=18`.

## Theming

The color palette lives in `constants.ts` (`C`) — it's the same dark palette
as the rest of DAMP Lab Cirrus, kept as a sensible default. Nothing about the
component is structurally tied to it; edit the values there (or fork the
file) to match a host application's own theme.

## What was intentionally left out

Compared to the source app's full `LabMap.jsx`, this component drops:

- **Multi-station routes.** No `highlightPath` equivalent — the whole point
  of this port is "one hop at a time," so there's nowhere for a longer path
  to plug in.
- **The heat map** (`heatCounts`) and the **dashed step-to-step hand-off
  overlay** (`stepLinks`) — both are whole-protocol/whole-step concepts.
- **Revisit badge-merging** — irrelevant when at most two stations are ever
  highlighted at once.
- **The equipment-list hover panel** — it needed a full station→equipment
  map (`stationEquip`); this component never receives one, only the two
  stations relevant to the current transition.
- **Paste-text parsing** (`parseProtocol` from `protocolImport.js`) — the
  host is assumed to already have structured substep data (e.g. from its own
  backend), not raw pasted spreadsheet text, so no parser was ported.
