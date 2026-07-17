import React from "react";
import { VIEW_W, VIEW_H, C, MONO, wrapLabel } from "../constants.js";
import { SLOTS, FIXTURES, STATION_IDS, STATION_NAME, center, routeWaypoints, WALKWAY_PATH, isNearFixture, BENCH_LEN_FT, WALKWAY_WIDTH_FT, BACK_AISLE_FT } from "../data.js";

export default function LabMap({ stationEquip, hoverSlot, setHoverSlot, highlightPath }) {
  const hov = hoverSlot ? stationEquip[hoverSlot] : null;
  const filled = STATION_IDS.filter((id) => (stationEquip[id] || []).length > 0).length;

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
    const fill = equip.length === 0 ? C.slot : "#1d3a3a";
    const lines = wrapLabel(STATION_NAME[id], 12);
    return (
      <g key={id} onMouseEnter={() => setHoverSlot(id)}>
        <rect x={r.x} y={r.y} width={r.w} height={r.h} fill={fill} stroke={isHov ? C.teal : C.slotLine} strokeWidth={isHov ? 2 : 1.2} />
        <text x={r.x + r.w / 2} y={r.y + 16} textAnchor="middle" fontFamily={MONO} fontSize={13} fontWeight={700} fill="#88a0b6">{id}</text>
        {lines.map((ln, i) => <text key={i} x={r.x + r.w / 2} y={r.y + 30 + i * 10} textAnchor="middle" fontFamily="system-ui" fontSize={8.5} fill="#5f7b8d">{ln}</text>)}
        <text x={r.x + 5} y={r.y + r.h - 6} fontFamily={MONO} fontSize={9} fill={equip.length > 0 ? C.muted : "#3f5163"}>{equip.length} eq</text>
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
    const fill = equip.length === 0 ? C.slot : "#1d3a3a";
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
        {Object.entries(FIXTURES).map(([id, r]) => fixtureBox(id, r))}

        {routedPts.length > 1 && (
          <polyline points={routedPts.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" stroke={C.teal} strokeWidth={2} opacity={0.9} />
        )}
        {Object.entries(stepsByStation).map(([id, nums]) => {
          const p = center(id);
          // A heavily-revisited station (common for equipment like Consumables in a
          // long real protocol) would otherwise grow a badge wide enough to overlap
          // its neighbors' boxes — past SAFE_MAX_W, collapse to a compact "N×" count
          // instead of the full list, which always stays short. The full list is
          // still one hover away via the title tooltip.
          const full = nums.join(",");
          const SAFE_MAX_W = 44;
          const label = 10 + full.length * 6.5 <= SAFE_MAX_W ? full : `${nums.length}×`;
          const w = Math.max(18, Math.min(SAFE_MAX_W, 10 + label.length * 6.5));
          return (
            <g key={"path" + id}>
              <title>{`steps ${full}`}</title>
              <rect x={p.x - w / 2} y={p.y - 9} width={w} height={18} rx={9} fill={C.floor} stroke={C.teal} strokeWidth={1.5} />
              <text x={p.x} y={p.y + 3} textAnchor="middle" fontFamily={MONO} fontSize={9} fontWeight={700} fill={C.teal}>{label}</text>
            </g>
          );
        })}
      </svg>
      {hov && (
        <div style={{ position: "absolute", top: 14, right: 14, width: 240, background: "#0a1017f2", border: `1px solid ${C.teal}`, borderRadius: 9, padding: "10px 12px", pointerEvents: "none", backdropFilter: "blur(3px)", boxShadow: "0 8px 24px #0008" }}>
          <div style={{ fontFamily: MONO, fontWeight: 700, color: C.teal, fontSize: 13 }}>{hoverSlot}</div>
          <div style={{ color: C.muted, fontSize: 11.5, marginBottom: 6 }}>{hoverSlot ? STATION_NAME[hoverSlot] : ""}</div>
          {hov.length > 0
            ? <ul style={{ margin: 0, paddingLeft: 16, fontSize: 11 }}>{hov.map((e) => <li key={e} style={{ color: C.text }}>{e}</li>)}</ul>
            : <div style={{ fontSize: 11, color: C.muted }}>no equipment mapped here</div>}
        </div>
      )}
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 8, fontSize: 11, color: C.muted, fontFamily: MONO }}>
        <span><span style={{ display: "inline-block", width: 10, height: 10, background: C.slot, border: `1px solid ${C.slotLine}`, verticalAlign: -1 }} /> empty</span>
        <span><span style={{ display: "inline-block", width: 10, height: 10, background: "#1d3a3a", verticalAlign: -1 }} /> has equipment</span>
        <span style={{ marginLeft: "auto" }}>{filled}/{STATION_IDS.length} stations in use</span>
      </div>
      <div style={{ fontSize: 10.5, color: C.muted, fontFamily: MONO, marginTop: 4 }}>
        reference: bench spacing ~{BENCH_LEN_FT}ft · walkway width ~{WALKWAY_WIDTH_FT}ft · back walkway ~{BACK_AISLE_FT}ft
      </div>
    </div>
  );
}
