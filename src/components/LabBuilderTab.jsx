import React, { useState } from "react";
import { C, MONO } from "../constants.js";
import { STATION_IDS } from "../data.js";
import LabMap from "./LabMap.jsx";

const PLACEHOLDER = `Equipment\tStation Name
Opentrons Flex Robot\tAutomation Prep 1
Biorad Gel Doc XR+ Imaging System\tGel Imaging
New Brunswick Innova Incubator Shaker\tMicrobial Culture Processing, Microbial Incubators
Applied Biosystems 2720 Thermal Cycler\tPCR`;

export default function LabBuilderTab({ rawTable, setRawTable, labData }) {
  const [hoverSlot, setHoverSlot] = useState(null);
  const equipCount = Object.keys(labData.equipToStations).length;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "360px 1fr", gap: 16 }}>
      <div>
        <div style={{ fontSize: 12.5, color: C.muted, marginBottom: 8 }}>
          Paste a table from your spreadsheet: <b>Equipment</b> and <b>Station Name</b>. Station names must
          match one of the lab's fixed stations exactly (hover a bench on the map to see its name). If one
          piece of equipment lives at several stations, list them on one row separated by commas (
          <code>Microbial Culture Processing, Microbial Incubators</code>) or give it its own row per station. This list
          is saved automatically and reloaded next time you open the app &mdash; paste a new one anytime to
          replace it.
        </div>
        <textarea
          value={rawTable}
          onChange={(e) => setRawTable(e.target.value)}
          placeholder={PLACEHOLDER}
          spellCheck={false}
          style={{
            width: "100%", height: 300, background: C.bg, color: C.text, border: `1px solid ${C.border}`,
            borderRadius: 8, padding: 10, fontFamily: MONO, fontSize: 12, resize: "vertical", boxSizing: "border-box",
          }}
        />
        <div style={{ display: "flex", gap: 12, marginTop: 8, fontSize: 11.5, fontFamily: MONO, color: C.muted }}>
          <span>{equipCount} equipment</span>
          <span>{Object.keys(labData.stationEquip).length}/{STATION_IDS.length} stations mapped</span>
        </div>
        {labData.errors.length > 0 && (
          <div style={{ marginTop: 10, background: "#3a2431", border: `1px solid ${C.red}`, borderRadius: 8, padding: "8px 10px" }}>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: C.red, marginBottom: 4 }}>{labData.errors.length} issue(s) found</div>
            <ul style={{ margin: 0, paddingLeft: 16, fontSize: 11, color: C.text }}>
              {labData.errors.slice(0, 12).map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          </div>
        )}
      </div>
      <LabMap stationEquip={labData.stationEquip} hoverSlot={hoverSlot} setHoverSlot={setHoverSlot} />
    </div>
  );
}
