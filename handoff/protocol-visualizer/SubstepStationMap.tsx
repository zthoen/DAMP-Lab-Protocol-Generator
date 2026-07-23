import React, { useEffect, useMemo, useRef, useState } from "react";
import { VIEW_W, VIEW_H, C, MONO, wrapLabel } from "./constants";
import {
  SLOTS, FIXTURES, STATION_NAME, WALKWAY_PATH,
  center, front, routeWaypoints, isNearFixture,
} from "./data";
import type { StationId, Point } from "./types";

/* A trimmed, single-hop port of the source app's LabMap.jsx, purpose-built
   for substep-by-substep navigation rather than showing an entire step's or
   protocol's route. Where LabMap takes an arbitrary-length `highlightPath`
   (a whole step, or the whole protocol, concatenated), this component only
   ever draws at most one leg: the current substep's station to the next
   substep's station. There is deliberately no prop that could grow that
   into a longer path — advancing through a protocol means the host renders
   this component again with new `currentStation`/`nextStation` props, one
   substep transition at a time. Everything LabMap needed for a multi-step
   view and isn't needed here was dropped rather than ported: the heat map,
   the dashed step-to-step "hand-off" overlay, revisit badge-merging, and
   the equipment-list hover panel (this component never receives a full
   station -> equipment map, only the two stations relevant to the current
   transition). */

// How the walking-technician preview moves: it pauses PAUSE_MS at the
// current station, walks to the next one at a fixed pixel speed, then
// pauses PAUSE_MS there too — mirrors LabMap.jsx's own pacing exactly, just
// over a path that's always length 1 or 2.
const PAUSE_MS = 2000;
const TRAVEL_PX_PER_SEC = 140;

interface PauseEvent {
  type: "pause";
  point: Point;
  duration: number;
}
interface TravelEvent {
  type: "travel";
  pts: Point[];
  length: number;
  duration: number;
}
type TimelineEvent = PauseEvent | TravelEvent;
interface Timeline {
  events: TimelineEvent[];
  totalMs: number;
}

function polylineLength(pts: Point[]): number {
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  return len;
}

function pointAtDistance(pts: Point[], dist: number): Point {
  let remaining = dist;
  for (let i = 1; i < pts.length; i++) {
    const segLen = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    if (remaining <= segLen || i === pts.length - 1) {
      const t = segLen === 0 ? 0 : Math.min(1, remaining / segLen);
      return { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t };
    }
    remaining -= segLen;
  }
  return pts[pts.length - 1];
}

function buildTimeline(path: StationId[]): Timeline {
  if (path.length === 0) return { events: [], totalMs: 0 };
  const events: TimelineEvent[] = [{ type: "pause", point: front(path[0]), duration: PAUSE_MS }];
  for (let i = 1; i < path.length; i++) {
    const legPts = [front(path[i - 1]), ...routeWaypoints(path[i - 1], path[i])];
    const length = polylineLength(legPts);
    events.push({ type: "travel", pts: legPts, length, duration: Math.max(200, (length / TRAVEL_PX_PER_SEC) * 1000) });
    events.push({ type: "pause", point: front(path[i]), duration: PAUSE_MS });
  }
  return { events, totalMs: events.reduce((s, e) => s + e.duration, 0) };
}

export interface SubstepStationMapProps {
  /** Station the technician is at right now. */
  currentStation: StationId;
  /** Label shown for the current-station marker and in the legend line below
   *  the map — falls back to the station's own real name (e.g. "NanoDrop")
   *  when omitted. Pass the current substep's own equipment/description if
   *  you want that instead (e.g. "Weigh Reagent"). */
  currentLabel?: string;
  /** Station the *next* substep uses, if there is one. Omit or pass null on
   *  the protocol's very last substep — the map then just highlights
   *  `currentStation`, with no route line, no next marker, and no Play
   *  button (there's nowhere to walk to). */
  nextStation?: StationId | null;
  /** Label for the next-station marker, same fallback rule as currentLabel. */
  nextLabel?: string;
  /** Fires once, after the walking-technician preview finishes arriving at
   *  and pausing on `nextStation` — a natural point for the host to advance
   *  to the next substep transition (new currentStation/nextStation props).
   *  Never fires when there's no nextStation, or the preview is never played. */
  onArrive?: () => void;
  className?: string;
  style?: React.CSSProperties;
}

export default function SubstepStationMap({
  currentStation,
  currentLabel,
  nextStation,
  nextLabel,
  onArrive,
  className,
  style,
}: SubstepStationMapProps) {
  const hasNext = !!nextStation && nextStation !== currentStation;
  const path: StationId[] = hasNext ? [currentStation, nextStation as StationId] : [currentStation];

  const routedPts = useMemo<Point[]>(() => {
    if (!hasNext) return [];
    return [front(currentStation), ...routeWaypoints(currentStation, nextStation as StationId)];
  }, [currentStation, nextStation, hasNext]);

  // Keyed on the path's contents, not array identity — a host re-rendering
  // with the same current/next stations (e.g. on an unrelated state change)
  // shouldn't reset an in-progress animation.
  const pathKey = path.join("|");
  const timeline = useMemo(() => buildTimeline(path), [pathKey]);

  const [elapsed, setElapsed] = useState(0);
  const [playing, setPlaying] = useState(false);
  const rafRef = useRef<number | null>(null);
  const lastTsRef = useRef<number | null>(null);
  const lastKeyRef = useRef(pathKey);
  const completedKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!playing) return undefined;
    lastTsRef.current = null;
    const tick = (ts: number) => {
      if (lastTsRef.current == null) lastTsRef.current = ts;
      const dt = ts - lastTsRef.current;
      lastTsRef.current = ts;
      setElapsed((prev) => {
        const next = prev + dt;
        if (next >= timeline.totalMs) {
          setPlaying(false);
          return timeline.totalMs;
        }
        return next;
      });
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [playing, timeline]);

  // Reset-on-transition-change and the arrival check have to live in one
  // effect, not two — a host advancing to the next substep hands this
  // component a new pathKey while `elapsed` still holds its old value from
  // the *previous*, often longer, transition. Two separate effects both
  // watching pathKey would let the arrival check run on that same pass
  // against the stale `elapsed`, see it already exceeds the new (shorter)
  // timeline's totalMs, and immediately re-fire onArrive — before the new
  // transition's animation is ever actually shown. Folding both into one
  // effect means a pathKey change always resets and bails out *before* any
  // arrival check can run against stale state.
  useEffect(() => {
    if (lastKeyRef.current !== pathKey) {
      lastKeyRef.current = pathKey;
      setElapsed(0);
      setPlaying(false);
      return;
    }
    if (hasNext && timeline.totalMs > 0 && elapsed >= timeline.totalMs && completedKeyRef.current !== pathKey) {
      completedKeyRef.current = pathKey;
      onArrive?.();
    }
  }, [pathKey, elapsed, timeline.totalMs, hasNext]);

  const handlePlay = () => {
    if (timeline.totalMs === 0) return;
    if (elapsed >= timeline.totalMs) setElapsed(0);
    setPlaying(true);
  };
  const handlePause = () => setPlaying(false);

  let dotPoint: Point | null = null;
  if (timeline.events.length > 0) {
    let t = elapsed;
    for (const ev of timeline.events) {
      if (t <= ev.duration) {
        dotPoint = ev.type === "pause" ? ev.point : pointAtDistance(ev.pts, (t / ev.duration) * ev.length);
        break;
      }
      t -= ev.duration;
    }
    if (!dotPoint) {
      const last = timeline.events[timeline.events.length - 1];
      dotPoint = last.type === "pause" ? last.point : pointAtDistance(last.pts, last.length);
    }
  }

  const stationLabel = (id: StationId) => {
    const lines = wrapLabel(STATION_NAME[id], 12);
    return lines;
  };

  const benchBox = (id: StationId, r: { x: number; y: number; w: number; h: number }) => {
    const isCurrent = id === currentStation;
    const isNext = hasNext && id === nextStation;
    const fill = isCurrent ? "#3a2a10" : isNext ? "#0f2e2e" : C.slot;
    const stroke = isCurrent ? C.amber : isNext ? C.teal : C.slotLine;
    const strokeWidth = isCurrent || isNext ? 2.5 : 1.2;
    const lines = stationLabel(id);
    return (
      <g key={id}>
        <title>{STATION_NAME[id]}</title>
        <rect x={r.x} y={r.y} width={r.w} height={r.h} fill={fill} stroke={stroke} strokeWidth={strokeWidth} />
        <text x={r.x + r.w / 2} y={r.y + 16} textAnchor="middle" fontFamily={MONO} fontSize={13} fontWeight={700} fill="#88a0b6">{id}</text>
        {lines.map((ln, i) => (
          <text key={i} x={r.x + r.w / 2} y={r.y + 30 + i * 10} textAnchor="middle" fontFamily="system-ui" fontSize={8.5} fill="#5f7b8d">{ln}</text>
        ))}
      </g>
    );
  };

  const fixtureBox = (id: StationId, r: { x: number; y: number; w: number; h: number }) => {
    const isCurrent = id === currentStation;
    const isNext = hasNext && id === nextStation;
    const fill = isCurrent ? "#3a2a10" : isNext ? "#0f2e2e" : C.slot;
    const stroke = isCurrent ? C.amber : isNext ? C.teal : C.slotLine;
    const strokeWidth = isCurrent || isNext ? 2.5 : 1.2;
    const near = isNearFixture(id);
    const idLabelY = near ? r.y + r.h + 10 : r.y - 6;
    return (
      <g key={id}>
        <title>{STATION_NAME[id]}</title>
        <text x={r.x + r.w / 2} y={idLabelY} textAnchor="middle" fontFamily={MONO} fontSize={8} fontWeight={700} fill="#88a0b6">{id}</text>
        <rect x={r.x} y={r.y} width={r.w} height={r.h} fill={fill} stroke={stroke} strokeWidth={strokeWidth} />
      </g>
    );
  };

  // A small "HERE"/"NEXT" pill above a highlighted station's center — same
  // idea as LabMap's step-number badge, just always exactly one or two of
  // them and never merged/wrapped, since there's never more than one marker
  // per station in a single-hop view.
  const marker = (id: StationId, label: string, color: string) => {
    const p = center(id);
    const w = label.length * 6.2 + 12;
    const h = 16;
    const y = p.y - (Object.prototype.hasOwnProperty.call(FIXTURES, id) ? 34 : 42);
    return (
      <g key={`marker-${id}`}>
        <rect x={p.x - w / 2} y={y} width={w} height={h} rx={8} fill={C.floor} stroke={color} strokeWidth={1.5} />
        <text x={p.x} y={y + h / 2 + 3.5} textAnchor="middle" fontFamily={MONO} fontSize={9} fontWeight={700} fill={color}>{label}</text>
      </g>
    );
  };

  return (
    <div className={className} style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 12, padding: 12, position: "relative", ...style }}>
      {hasNext && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <button type="button" disabled={playing} onClick={handlePlay} style={playBtnStyle(playing)}>▶ Walk to next station</button>
          <button type="button" disabled={!playing} onClick={handlePause} style={pauseBtnStyle(!playing)}>⏸ Pause</button>
        </div>
      )}
      <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} style={{ width: "100%", display: "block" }}>
        <rect x={0} y={0} width={VIEW_W} height={VIEW_H} rx={10} fill={C.floor} />
        {/* Walkways drawn as one continuous open lane, unlabeled — the floor
            plan should read as "clear space you can walk," nothing more. */}
        <path d={WALKWAY_PATH} fill="#ffffff0d" stroke={C.slotLine} strokeDasharray="3 5" opacity={0.7} />

        {Object.entries(SLOTS).map(([id, r]) => benchBox(id as StationId, r))}
        {Object.entries(FIXTURES).map(([id, r]) => fixtureBox(id as StationId, r))}

        {routedPts.length > 1 && (
          <polyline points={routedPts.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" stroke={C.teal} strokeWidth={2.5} opacity={0.9} />
        )}
        {dotPoint && <circle cx={dotPoint.x} cy={dotPoint.y} r={7} fill={C.amber} stroke="#0a1017" strokeWidth={1.5} />}

        {marker(currentStation, "HERE", C.amber)}
        {hasNext && marker(nextStation as StationId, "NEXT", C.teal)}
      </svg>
      <div style={{ display: "flex", flexDirection: "column", gap: 3, marginTop: 8, fontSize: 11.5, fontFamily: MONO }}>
        <span style={{ display: "flex", alignItems: "center", gap: 6, color: C.text }}>
          <span style={{ display: "inline-block", width: 9, height: 9, borderRadius: 2, background: C.amber }} />
          You are here — {STATION_NAME[currentStation]}{currentLabel ? ` — ${currentLabel}` : ""}
        </span>
        {hasNext ? (
          <span style={{ display: "flex", alignItems: "center", gap: 6, color: C.muted }}>
            <span style={{ display: "inline-block", width: 9, height: 9, borderRadius: 2, background: C.teal }} />
            Next — {STATION_NAME[nextStation as StationId]}{nextLabel ? ` — ${nextLabel}` : ""}
          </span>
        ) : (
          <span style={{ color: C.muted }}>Last substep — no further station to walk to.</span>
        )}
      </div>
    </div>
  );
}

function playBtnStyle(disabled: boolean): React.CSSProperties {
  return {
    cursor: disabled ? "not-allowed" : "pointer", border: `1px solid ${C.teal}`, background: disabled ? C.panel2 : C.teal,
    color: disabled ? C.muted : "#04211d", padding: "7px 14px", borderRadius: 7, fontSize: 13, fontWeight: 600,
    opacity: disabled ? 0.5 : 1,
  };
}
function pauseBtnStyle(disabled: boolean): React.CSSProperties {
  return {
    cursor: disabled ? "not-allowed" : "pointer", border: `1px solid ${C.border}`, background: C.panel,
    color: C.text, padding: "7px 14px", borderRadius: 7, fontSize: 13, fontWeight: 600, opacity: disabled ? 0.5 : 1,
  };
}
