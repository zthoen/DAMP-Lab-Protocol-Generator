import React, { useState, useMemo } from "react";
import { C, MONO } from "../constants.js";
import { parseProtocol } from "../protocolImport.js";
import LabMap from "./LabMap.jsx";

const PLACEHOLDER = `Step\tSubstep\tEquipment
1. Prepare Reagents\t1.1\tOpentrons Flex Robot
\t1.2\tNanoDrop 2000
2. Run Gel\t2.1\tBiorad Gel Doc XR+ Imaging System
\t2.2\tThermal Cycler`;

const FULL_KEY = "__FULL__";

export default function ProtocolImportTab({ labData }) {
  const [rawProtocol, setRawProtocol] = useState("");
  const [selectedKey, setSelectedKey] = useState(FULL_KEY);
  const [hoverSlot, setHoverSlot] = useState(null);

  const parsed = useMemo(() => parseProtocol(rawProtocol, labData.equipToStations), [rawProtocol, labData.equipToStations]);
  const selectedStep = selectedKey === FULL_KEY ? null : parsed.steps.find((s) => s.number === selectedKey) || null;
  const highlightPath = selectedKey === FULL_KEY ? parsed.fullPath : (selectedStep ? selectedStep.path : []);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "400px 1fr", gap: 16 }}>
      <div>
        <div style={{ fontSize: 12.5, color: C.muted, marginBottom: 8 }}>
          Paste a protocol from your spreadsheet: <b>Step</b> (<code>N. Name</code>, only on that step's first
          row), <b>Substep</b> (<code>N.M</code>), and <b>Equipment</b>. Equipment is matched against the list
          loaded on the Lab Builder tab to find where each substep happens &mdash; when a piece of equipment
          lives at more than one station, the closest one to the previous substep is used.
        </div>
        <textarea
          value={rawProtocol}
          onChange={(e) => setRawProtocol(e.target.value)}
          placeholder={PLACEHOLDER}
          spellCheck={false}
          style={{
            width: "100%", height: 220, background: C.bg, color: C.text, border: `1px solid ${C.border}`,
            borderRadius: 8, padding: 10, fontFamily: MONO, fontSize: 12, resize: "vertical", boxSizing: "border-box",
          }}
        />
        {parsed.errors.length > 0 && (
          <div style={{ marginTop: 10, background: "#3a2431", border: `1px solid ${C.red}`, borderRadius: 8, padding: "8px 10px" }}>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: C.red, marginBottom: 4 }}>{parsed.errors.length} issue(s) found</div>
            <ul style={{ margin: 0, paddingLeft: 16, fontSize: 11, color: C.text }}>
              {parsed.errors.slice(0, 12).map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          </div>
        )}
        {parsed.steps.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 14 }}>
            <FullProtocolCard
              parsed={parsed}
              selected={selectedKey === FULL_KEY}
              onSelect={() => setSelectedKey(FULL_KEY)}
            />
            {parsed.steps.map((s) => (
              <StepCard key={s.number} s={s} selected={selectedKey === s.number} onSelect={() => setSelectedKey(s.number)} />
            ))}
          </div>
        )}
      </div>
      <div style={{ position: "sticky", top: 12, alignSelf: "start" }}>
        <LabMap
          stationEquip={labData.stationEquip}
          hoverSlot={hoverSlot} setHoverSlot={setHoverSlot}
          highlightPath={highlightPath}
        />
        {parsed.steps.length > 0 && (
          <div style={{ marginTop: 8, fontSize: 11.5, fontFamily: MONO, color: C.muted }}>
            {selectedKey === FULL_KEY
              ? `Full protocol · ${parsed.steps.length} steps · ${parsed.fullStationsVisited} benches visited · ${parsed.fullTravelFt}ft walked`
              : `Step ${selectedStep.number}: ${selectedStep.name} · ${selectedStep.substeps.length} substeps · ${selectedStep.stationsVisited} benches visited · ${selectedStep.travelFt}ft walked`}
          </div>
        )}
      </div>
    </div>
  );
}

const th = { textAlign: "left", padding: "3px 8px", color: C.muted, fontFamily: MONO, fontWeight: 700, fontSize: 9.5, textTransform: "uppercase", letterSpacing: .4, borderBottom: `1px solid ${C.border}` };

function FullProtocolCard({ parsed, selected, onSelect }) {
  const substepCount = parsed.steps.reduce((n, s) => n + s.substeps.length, 0);
  return (
    <div onClick={onSelect} style={{ cursor: "pointer", background: C.panel, border: `1px solid ${selected ? C.teal : C.border}`, borderRadius: 10, padding: "9px 12px" }}>
      <div style={{ fontWeight: 700, fontSize: 14, color: C.text, fontFamily: MONO }}>Full Protocol</div>
      <div style={{ fontSize: 11, color: C.muted, fontFamily: MONO, marginTop: 2 }}>
        {parsed.steps.length} steps · {substepCount} substeps · {parsed.fullStationsVisited} benches · {parsed.fullTravelFt}ft walked
      </div>
    </div>
  );
}

function StepCard({ s, selected, onSelect }) {
  return (
    <div onClick={onSelect} style={{ cursor: "pointer", background: C.panel, border: `1px solid ${selected ? C.teal : C.border}`, borderRadius: 10, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "9px 12px", background: C.panel2, borderBottom: `1px solid ${C.border}` }}>
        <span style={{ fontWeight: 700, fontSize: 14, color: C.text, fontFamily: MONO }}>Step {s.number}</span>
        <span style={{ fontSize: 12, color: C.text }}>{s.name}</span>
        <span style={{ fontSize: 11, color: C.muted, fontFamily: MONO, marginLeft: "auto" }}>{s.stationsVisited} benches · {s.travelFt}ft</span>
      </div>
      <div style={{ padding: "8px 12px" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead><tr><th style={th}>#</th><th style={th}>Station</th><th style={th}>Equipment</th><th style={{ ...th, textAlign: "right" }}>Type</th></tr></thead>
          <tbody>
            {s.substeps.map((sub, i) => (
              <tr key={i} style={{ borderTop: i ? `1px solid ${C.panel2}` : "none" }}>
                <td style={{ padding: "4px 6px", color: C.muted, fontFamily: MONO }}>{sub.label}</td>
                <td style={{ padding: "4px 6px", color: sub.station ? C.teal : C.red, fontFamily: MONO, fontWeight: 700 }}>{sub.station || "?"}</td>
                <td style={{ padding: "4px 6px", color: C.text, maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={sub.equipment}>{sub.equipment}</td>
                <td style={{ padding: "4px 6px", textAlign: "right", color: sub.action === "Write" ? C.amber : C.blue, fontFamily: MONO, fontSize: 11 }}>{sub.action}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
