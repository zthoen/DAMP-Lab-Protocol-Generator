import React, { useState, useMemo } from "react";
import { C, MONO } from "../constants.js";
import { parseProtocol } from "../protocolImport.js";
import { usePersistedState } from "../usePersistedState.js";
import LabMap from "./LabMap.jsx";
import { ErrorList, StepTable } from "./Controls.jsx";

const PLACEHOLDER = `Overnight Culture Prep
Step\tSubstep\tEquipment
1. Prepare Reagents\t1.1\tOpentrons Flex Robot
\t1.2\tNanoDrop 2000
2. Run Gel\t2.1\tBiorad Gel Doc XR+ Imaging System
\t2.2\tThermal Cycler`;

const FULL_KEY = "__FULL__";

// The pasted protocol is remembered only for this browser session — it's kept
// in sessionStorage, not localStorage, so it survives a reload/tab-switch
// within the current session but never leaks into a future one (unlike the
// equipment list on the Equipment Input tab, which is meant to persist
// indefinitely).
const SESSION_KEY = "damp-lab-raw-protocol";

export default function ProtocolImportTab({ labData }) {
  const [rawProtocol, setRawProtocol] = usePersistedState(sessionStorage, SESSION_KEY, "");
  const [selectedKey, setSelectedKey] = useState(FULL_KEY);
  const [hoverSlot, setHoverSlot] = useState(null);

  const parsed = useMemo(() => parseProtocol(rawProtocol, labData.equipToStations), [rawProtocol, labData.equipToStations]);
  const selectedStep = selectedKey === FULL_KEY ? null : parsed.steps.find((s) => s.number === selectedKey) || null;
  const highlightPath = selectedKey === FULL_KEY ? parsed.fullPath : (selectedStep ? selectedStep.path : []);
  const fullLabel = parsed.name || "Full Protocol";

  return (
    <div style={{ display: "grid", gridTemplateColumns: "400px 1fr", gap: 16 }}>
      <div>
        <div style={{ fontSize: 12.5, color: C.muted, marginBottom: 8 }}>
          Paste a protocol from your spreadsheet: the protocol's <b>name</b> on its own line, then <b>Step</b>
          (<code>N. Name</code>, only on that step's first row), <b>Substep</b> (<code>N.M</code>), and
          <b> Equipment</b>. Equipment is matched against the list loaded on the Equipment Input tab to find
          where each substep happens &mdash; when a piece of equipment lives at more than one station, the
          closest one to the previous substep is used. This paste is remembered for the current session only.
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
        <ErrorList errors={parsed.errors} />
        {parsed.steps.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 14 }}>
            <FullProtocolCard
              parsed={parsed}
              label={fullLabel}
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
          stepLinks={parsed.stepLinks}
        />
        {parsed.steps.length > 0 && (
          <div style={{ marginTop: 8, fontSize: 11.5, fontFamily: MONO, color: C.muted }}>
            {selectedKey === FULL_KEY
              ? `${fullLabel} · ${parsed.steps.length} steps · ${parsed.fullStationsVisited} benches visited · ${parsed.fullTravelFt}ft walked`
              : `Step ${selectedStep.number}: ${selectedStep.name} · ${selectedStep.substeps.length} substeps · ${selectedStep.stationsVisited} benches visited · ${selectedStep.travelFt}ft walked`}
          </div>
        )}
      </div>
    </div>
  );
}

function FullProtocolCard({ parsed, label, selected, onSelect }) {
  const substepCount = parsed.steps.reduce((n, s) => n + s.substeps.length, 0);
  return (
    <div onClick={onSelect} style={{ cursor: "pointer", background: C.panel, border: `1px solid ${selected ? C.teal : C.border}`, borderRadius: 10, padding: "9px 12px" }}>
      <div style={{ fontWeight: 700, fontSize: 14, color: C.text, fontFamily: MONO }}>{label}</div>
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
        <StepTable rows={s.substeps.map((sub) => ({ index: sub.label, stationId: sub.station, equipment: sub.equipment, action: sub.action }))} />
      </div>
    </div>
  );
}
