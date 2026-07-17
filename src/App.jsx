import React, { useState, useMemo, useEffect } from "react";
import { C, MONO } from "./constants.js";
import { parseLabTable } from "./labTable.js";
import LabBuilderTab from "./components/LabBuilderTab.jsx";
import ProtocolGeneratorTab from "./components/ProtocolGeneratorTab.jsx";
import ProtocolImportTab from "./components/ProtocolImportTab.jsx";

const TAB_BLURB = {
  builder: "Paste an equipment-to-bench table from your spreadsheet and see it laid out on the lab floor.",
  protocols: "Generate fake protocols with a variable number of steps, drawn so each one forces the technician onto a different bench than the last.",
  import: "Paste a real protocol and see its actual route on the lab floor, step by step or start to finish.",
};

// The last pasted equipment list is remembered across reloads — booting the
// app re-loads it automatically, and pasting a new one overwrites it (see the
// persisting effect below). Read failures (private browsing, storage disabled)
// just fall back to a blank table instead of crashing the app.
const STORAGE_KEY = "damp-lab-raw-table";
const loadStoredTable = () => {
  try { return localStorage.getItem(STORAGE_KEY) ?? ""; } catch { return ""; }
};

export default function LabWorkflowApp() {
  const [rawTable, setRawTable] = useState(loadStoredTable);
  const [tab, setTab] = useState("builder");
  const labData = useMemo(() => parseLabTable(rawTable), [rawTable]);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, rawTable); } catch { /* storage unavailable — nothing to persist to */ }
  }, [rawTable]);

  const tabBtn = (id, label) => (
    <button onClick={() => setTab(id)} style={{
      cursor: "pointer", border: "none", background: "transparent",
      color: tab === id ? C.teal : C.muted, borderBottom: `2px solid ${tab === id ? C.teal : "transparent"}`,
      padding: "9px 4px", fontSize: 14, fontWeight: 600,
    }}>{label}</button>
  );

  return (
    <div style={{ background: C.bg, color: C.text, fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif", padding: 16, minHeight: "100%", boxSizing: "border-box" }}>
      <style>{`
        .lbtn{cursor:pointer;border:1px solid ${C.border};background:${C.panel};color:${C.text};padding:7px 14px;border-radius:7px;font-size:13px;font-weight:600;transition:.12s}
        .lbtn:hover{border-color:${C.teal};color:${C.teal}} .lbtn:disabled{opacity:.4;cursor:not-allowed}
        .lbtn.primary{background:${C.teal};color:#04211d;border-color:${C.teal}} .lbtn.primary:hover{filter:brightness(1.08)}
      `}</style>
      <div style={{
        display: "flex", alignItems: "center", gap: 12, marginBottom: 10, padding: "10px 14px",
        borderRadius: 10, border: `1px solid ${C.border}`,
        background: `linear-gradient(90deg, ${C.panel} 0%, ${C.panel2} 60%, ${C.panel} 100%)`,
      }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: C.text }}>DAMP Lab <span style={{ color: C.teal }}>Protocol Builder</span></div>
        <div style={{ fontSize: 11, color: C.muted, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 20, padding: "2px 10px", fontFamily: MONO }}>lab map + fake protocol generator</div>
      </div>
      <div style={{ display: "flex", gap: 20, borderBottom: `1px solid ${C.border}`, marginBottom: 10 }}>
        {tabBtn("builder", "Lab Builder")}{tabBtn("protocols", "Protocol Generator")}{tabBtn("import", "Import Protocol")}
      </div>
      <div style={{ fontSize: 12, color: C.muted, marginBottom: 14, maxWidth: 720 }}>{TAB_BLURB[tab]}</div>
      {tab === "builder" && <LabBuilderTab rawTable={rawTable} setRawTable={setRawTable} labData={labData} />}
      {tab === "protocols" && <ProtocolGeneratorTab labData={labData} />}
      {tab === "import" && <ProtocolImportTab labData={labData} />}
    </div>
  );
}
