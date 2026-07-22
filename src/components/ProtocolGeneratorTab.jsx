import React, { useState } from "react";
import { C, MONO } from "../constants.js";
import { NumField, StepTable } from "./Controls.jsx";
import { generateProtocols } from "../protocolGen.js";
import LabMap from "./LabMap.jsx";

export default function ProtocolGeneratorTab({ labData }) {
  const [count, setCount] = useState(8);
  const [minSteps, setMinSteps] = useState(10);
  const [maxSteps, setMaxSteps] = useState(30);
  const [seed, setSeed] = useState(1234);
  const [result, setResult] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [hoverSlot, setHoverSlot] = useState(null);

  const equipCount = Object.keys(labData.equipToStations).length;
  const generate = () => {
    const out = generateProtocols(labData.equipToStations, { count, minSteps: Math.min(minSteps, maxSteps), maxSteps, seed });
    setResult(out);
    setSelectedId(out.protocols[0]?.id ?? null);
  };

  const selected = result?.protocols.find((p) => p.id === selectedId) || null;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", marginBottom: 14 }}>
        <NumField label="protocols" value={count} min={1} max={50} onChange={setCount} width={54} />
        <NumField label="min steps" value={minSteps} min={2} max={30} onChange={setMinSteps} width={54} />
        <NumField label="max steps" value={maxSteps} min={2} max={30} onChange={setMaxSteps} width={54} />
        <NumField label="seed" value={seed} min={0} max={999999} onChange={setSeed} width={80} />
        <button className="lbtn primary" disabled={equipCount === 0} onClick={generate}>Generate</button>
        {equipCount === 0 && <span style={{ fontSize: 11.5, color: C.amber }}>Load equipment on the Lab Builder tab first.</span>}
      </div>

      {result && result.warnings.length > 0 && (
        <div style={{ marginBottom: 14, fontSize: 11.5, color: C.amber }}>{result.warnings.join(" ")}</div>
      )}

      {result && (
        <div style={{ display: "grid", gridTemplateColumns: "360px 1fr", gap: 16 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {result.protocols.map((p) => (
              <ProtocolCard key={p.id} p={p} selected={p.id === selectedId} onSelect={() => setSelectedId(p.id)} />
            ))}
          </div>
          <div style={{ position: "sticky", top: 12, alignSelf: "start" }}>
            <LabMap
              stationEquip={labData.stationEquip}
              hoverSlot={hoverSlot} setHoverSlot={setHoverSlot}
              highlightPath={selected ? selected.steps.map((s) => s.station) : []}
            />
            {selected && (
              <div style={{ marginTop: 8, fontSize: 11.5, fontFamily: MONO, color: C.muted }}>
                {selected.id} · {selected.steps.length} steps · {selected.stationsVisited} benches visited · {selected.travelFt}ft walked
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ProtocolCard({ p, selected, onSelect }) {
  return (
    <div onClick={onSelect} style={{ cursor: "pointer", background: C.panel, border: `1px solid ${selected ? C.teal : C.border}`, borderRadius: 10, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "9px 12px", background: C.panel2, borderBottom: `1px solid ${C.border}` }}>
        <span style={{ fontWeight: 700, fontSize: 14, color: C.text, fontFamily: MONO }}>{p.id}</span>
        <span style={{ fontSize: 11, color: C.muted, fontFamily: MONO }}>{p.steps.length} steps · {p.stationsVisited} benches · {p.travelFt}ft walked</span>
      </div>
      <div style={{ padding: "8px 12px" }}>
        <StepTable rows={p.steps.map((s, i) => ({ index: i + 1, stationId: s.station, equipment: s.equipment, action: s.action }))} />
      </div>
    </div>
  );
}
