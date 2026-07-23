/* Fixed physical identifiers for the DAMP Lab floor: 24 benches (8 columns
   A-H x 3 rows) plus 8 utility fixtures. These are literal unions (not just
   `string`) so a host application gets compile-time protection against a
   typo'd or stale station id anywhere it constructs SubstepStationMap props.

   They must stay in sync with the ids data.ts actually builds (SLOTS/
   FIXTURES) — there's no runtime check tying this union to that generated
   object, the same trade-off the source app makes with its own hardcoded
   BENCH_NAMES map. If the physical floor plan ever changes shape (more
   columns/rows, a fixture added or removed), update both together. */
export type BenchId =
  | "A1" | "A2" | "A3"
  | "B1" | "B2" | "B3"
  | "C1" | "C2" | "C3"
  | "D1" | "D2" | "D3"
  | "E1" | "E2" | "E3"
  | "F1" | "F2" | "F3"
  | "G1" | "G2" | "G3"
  | "H1" | "H2" | "H3";

export type FixtureId =
  | "SHARPS"
  | "RECYCLE"
  | "WASTE"
  | "SINK"
  | "GLASSWARE"
  | "CONSUM1"
  | "CONSUM2"
  | "REFRIGERATOR";

/** Any valid destination on the floor plan — a bench or a fixture. */
export type StationId = BenchId | FixtureId;

export interface Point {
  x: number;
  y: number;
}

export interface Rect extends Point {
  w: number;
  h: number;
}

/** A fixture's box also carries its own display name (a bench's name comes
 *  from the separate BENCH_NAMES/STATION_NAME map instead — see data.ts). */
export interface FixtureRect extends Rect {
  name: string;
}
