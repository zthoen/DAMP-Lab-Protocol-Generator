import React from "react";
import { VIEW_W, VIEW_H, C, MONO, wrapLabel, mixHex } from "../constants.js";
import { SLOTS, FIXTURES, STATION_IDS, STATION_NAME, center, routeWaypoints, WALKWAY_PATH, isNearFixture, FIXTURE_PX_PER_FT } from "../data.js";

// A short ruler in an empty floor corner (below column A, which never has a
// fixture under it) — the one honest, literal scale reference on the map,
// since bench spacing itself is stylized for legibility rather than to scale.
const SCALE_FT = 5;
const SCALE_X = 30, SCALE_Y = 330;
const SCALE_LEN = SCALE_FT * FIXTURE_PX_PER_FT;

// Packs a station's visited-step numbers into as few comma-joined rows as fit
// within maxChars each, greedily — used to keep a busy badge's rows no wider
// than its neighbors' bench spacing regardless of how many times a station is
// revisited (see stepBadge below).
function wrapStepNums(nums, maxChars) {
  const rows = [];
  let row = "";
  for (const n of nums) {
    const next = row ? `${row},${n}` : `${n}`;
    if (next.length <= maxChars || !row) row = next;
    else { rows.push(row); row = `${n}`; }
  }
  if (row) rows.push(row);
  return rows;
}

// Shades a station by how many times it's visited relative to the busiest one
// — unvisited stays the same neutral "empty" gray as the non-heat-map view,
// climbing through a red gradient so the busiest station reads unmistakably
// hottest. A floor of 0.2 keeps even a single visit visibly distinct from zero.
function heatFill(count, maxCount) {
  if (!count) return C.slot;
  return mixHex(C.slot, C.red, 0.2 + 0.8 * Math.min(1, count / maxCount));
}

export default function LabMap({ stationEquip, hoverSlot, setHoverSlot, highlightPath, stationNames = STATION_NAME, fixtures = FIXTURES, heatCounts }) {
  const hov = hoverSlot ? stationEquip[hoverSlot] : null;
  const filled = STATION_IDS.filter((id) => (stationEquip[id] || []).length > 0).length;
  const visited = heatCounts ? STATION_IDS.filter((id) => heatCounts[id] > 0).length : filled;
  const maxHeat = heatCounts ? Math.max(1, ...Object.values(heatCounts)) : 0;

  const path = highlightPath || [];
  const routedPts = [];
  if (path.length > 0) {
    routedPts.push(center(path[0]));
    for (let i = 1; i < path.length; i++) routedPts.push(...routeWaypoints(path[i - 1], path[i]));
  }
  // A protocol can revisit a station (just never on consecutive steps) — group step
  // numbers by station so a revisit gets one "1,3"-style badge instead of a second
  // marker silently painted over the first.
  const stepsByStation = {};
  path.forEach((id, i) => (stepsByStation[id] ??= []).push(i + 1));

  const benchBox = (id, r) => {
    const equip = stationEquip[id] || [];
    const isHov = hoverSlot === id;
    const count = heatCounts ? (heatCounts[id] || 0) : null;
    const fill = heatCounts ? heatFill(count, maxHeat) : (equip.length === 0 ? C.slot : "#1d3a3a");
    const lines = wrapLabel(stationNames[id], 12);
    return (
      <g key={id} onMouseEnter={() => setHoverSlot(id)}>
        <rect x={r.x} y={r.y} width={r.w} height={r.h} fill={fill} stroke={isHov ? C.teal : C.slotLine} strokeWidth={isHov ? 2 : 1.2} />
        <text x={r.x + r.w / 2} y={r.y + 16} textAnchor="middle" fontFamily={MONO} fontSize={13} fontWeight={700} fill="#88a0b6">{id}</text>
        {lines.map((ln, i) => <text key={i} x={r.x + r.w / 2} y={r.y + 30 + i * 10} textAnchor="middle" fontFamily="system-ui" fontSize={8.5} fill="#5f7b8d">{ln}</text>)}
        {heatCounts
          ? <text x={r.x + 5} y={r.y + r.h - 6} fontFamily={MONO} fontSize={9} fill={count > 0 ? C.text : "#3f5163"}>{count} visit{count === 1 ? "" : "s"}</text>
          : <text x={r.x + 5} y={r.y + r.h - 6} fontFamily={MONO} fontSize={9} fill={equip.length > 0 ? C.muted : "#3f5163"}>{equip.length} eq</text>}
      </g>
    );
  };

  // Fixtures are far too small (a couple of feet) to hold their ID or name inside
  // the box the way a bench does — the code goes outside it instead, and the full
  // name/equipment list lives in the hover panel. The sharps/recycling/biohazard
  // trio touches row 3 with no gap, so its label goes below (there's no room
  // above without colliding with the bench's own "N eq" text); the sink/
  // consumables pair has headroom above it instead.
  const fixtureBox = (id, r) => {
    const equip = stationEquip[id] || [];
    const isHov = hoverSlot === id;
    const fill = heatCounts ? heatFill(heatCounts[id] || 0, maxHeat) : (equip.length === 0 ? C.slot : "#1d3a3a");
    const labelY = isNearFixture(id) ? r.y + r.h + 10 : r.y - 6;
    return (
      <g key={id} onMouseEnter={() => setHoverSlot(id)}>
        <text x={r.x + r.w / 2} y={labelY} textAnchor="middle" fontFamily={MONO} fontSize={8} fontWeight={700} fill="#88a0b6">{id}</text>
        <rect x={r.x} y={r.y} width={r.w} height={r.h} fill={fill} stroke={isHov ? C.teal : C.slotLine} strokeWidth={isHov ? 2 : 1.2} />
      </g>
    );
  };

  return (
    <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 12, padding: 12, position: "relative" }}>
      <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} style={{ width: "100%", display: "block" }} onMouseLeave={() => setHoverSlot(null)}>
        <rect x={0} y={0} width={VIEW_W} height={VIEW_H} rx={10} fill={C.floor} />
        {/* Walkways are drawn as one continuous open lane, unlabeled — the floor plan
            should read as "clear space you can walk" without spelling out what each
            part is, and without seams between the vertical lanes and the back aisle
            they all feed into. */}
        <path d={WALKWAY_PATH} fill="#ffffff0d" stroke={C.slotLine} strokeDasharray="3 5" opacity={0.7} />

        {Object.entries(SLOTS).map(([id, r]) => benchBox(id, r))}
        {Object.entries(fixtures).map(([id, r]) => fixtureBox(id, r))}

        <g>
          <line x1={SCALE_X} y1={SCALE_Y} x2={SCALE_X + SCALE_LEN} y2={SCALE_Y} stroke={C.muted} strokeWidth={1.5} />
          <line x1={SCALE_X} y1={SCALE_Y - 5} x2={SCALE_X} y2={SCALE_Y + 5} stroke={C.muted} strokeWidth={1.5} />
          <line x1={SCALE_X + SCALE_LEN} y1={SCALE_Y - 5} x2={SCALE_X + SCALE_LEN} y2={SCALE_Y + 5} stroke={C.muted} strokeWidth={1.5} />
          <text x={SCALE_X + SCALE_LEN / 2} y={SCALE_Y + 16} textAnchor="middle" fontFamily={MONO} fontSize={9.5} fill={C.muted}>{SCALE_FT} ft</text>
        </g>

        {routedPts.length > 1 && (
          <polyline points={routedPts.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" stroke={C.teal} strokeWidth={2} opacity={0.9} />
        )}
        {Object.entries(stepsByStation).map(([id, nums]) => {
          const p = center(id);
          // A heavily-revisited station (common for equipment like Consumables 2 in a
          // long real protocol) would otherwise grow one wide badge that overlaps
          // its neighbors' boxes — instead, the font shrinks a step as the count
          // grows, and the numbers wrap onto as many rows as needed, so every badge
          // stays about as wide as a single visit's badge while still showing every
          // step number in full.
          const fontSize = nums.length <= 3 ? 9 : nums.length <= 6 ? 8 : 7;
          const charW = fontSize * 0.62;
          const maxRowChars = Math.max(3, Math.floor(42 / charW));
          const rows = wrapStepNums(nums, maxRowChars);
          const rowH = fontSize + 3;
          const w = Math.max(18, Math.min(52, 10 + Math.max(...rows.map((r) => r.length)) * charW));
          const h = 8 + rows.length * rowH;
          return (
            <g key={"path" + id}>
              <title>{`steps ${nums.join(",")}`}</title>
              <rect x={p.x - w / 2} y={p.y - h / 2} width={w} height={h} rx={Math.min(9, h / 2)} fill={C.floor} stroke={C.teal} strokeWidth={1.5} />
              {rows.map((row, i) => (
                <text key={i} x={p.x} y={p.y - h / 2 + rowH * (i + 1) - 3} textAnchor="middle" fontFamily={MONO} fontSize={fontSize} fontWeight={700} fill={C.teal}>{row}</text>
              ))}
            </g>
          );
        })}
      </svg>
      {hov && (
        <div style={{ position: "absolute", top: 14, right: 14, width: 240, background: "#0a1017f2", border: `1px solid ${C.teal}`, borderRadius: 9, padding: "10px 12px", pointerEvents: "none", backdropFilter: "blur(3px)", boxShadow: "0 8px 24px #0008" }}>
          <div style={{ fontFamily: MONO, fontWeight: 700, color: C.teal, fontSize: 13 }}>{hoverSlot}</div>
          <div style={{ color: C.muted, fontSize: 11.5, marginBottom: 6 }}>{hoverSlot ? stationNames[hoverSlot] : ""}</div>
          {hov.length > 0
            ? <ul style={{ margin: 0, paddingLeft: 16, fontSize: 11 }}>{hov.map((e) => <li key={e} style={{ color: C.text }}>{e}</li>)}</ul>
            : <div style={{ fontSize: 11, color: C.muted }}>no equipment mapped here</div>}
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", marginTop: 8, fontSize: 11, color: C.muted, fontFamily: MONO }}>
        {heatCounts ? (
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
            0 visits
            <span style={{ display: "inline-block", width: 70, height: 10, borderRadius: 3, background: `linear-gradient(to right, ${C.slot}, ${C.red})`, border: `1px solid ${C.slotLine}` }} />
            {maxHeat} visits
          </span>
        ) : (
          <>
            <span><span style={{ display: "inline-block", width: 10, height: 10, background: C.slot, border: `1px solid ${C.slotLine}`, verticalAlign: -1 }} /> empty</span>
            <span><span style={{ display: "inline-block", width: 10, height: 10, background: "#1d3a3a", verticalAlign: -1 }} /> has equipment</span>
          </>
        )}
        <span style={{ marginLeft: "auto" }}>{visited}/{STATION_IDS.length} stations {heatCounts ? "visited" : "in use"}</span>
      </div>
    </div>
  );
}
