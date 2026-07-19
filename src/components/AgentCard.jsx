// SPDX-License-Identifier: Apache-2.0
import { useState } from "react";
import { C, f } from "../theme.js";
import { Tag } from "./Tag.jsx";
import { SectionLabel } from "./SectionLabel.jsx";
import { driftLabel } from "../lib/analysis.js";

export function AgentCard({ agentId, trace, round, isSilent }) {
  const [expanded, setExpanded] = useState(false);
  if (!trace) return (
    <div className="agent-card" style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: "6px", padding: "1rem" }}>
      <div style={{ fontSize: "0.6rem", color: C.muted, fontFamily: f.mono, letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: "0.5rem" }}>
        {agentId}{isSilent ? " · silent" : ` · r${round}`}
      </div>
      <div style={{ color: C.muted, fontSize: "0.72rem" }}>waiting...</div>
    </div>
  );

  const failed = trace._ok === false;
  const accentColor = agentId === "alpha" ? C.alpha : agentId === "beta" ? C.beta : isSilent ? C.silent : C.gamma;
  const conf = trace.confidence;
  const delta = trace.drift_score?.harness_confidence_delta; // harness-computed, not self-report
  const deltaMismatchFlag = trace.drift_score?.delta_mismatch === true;
  const { label: dLabel, color: dColor } = driftLabel(delta);
  const providerTag = trace._meta?.provider;
  const modelTag = trace._meta?.model;

  return (
    <div className="agent-card" style={{ background: C.surface, border: `1px solid ${failed ? C.error : C.border}`, borderRadius: "6px", padding: "1rem", position: "relative" }}>
      <div className="card-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
        <div style={{ fontSize: "0.6rem", color: accentColor, fontFamily: f.mono, letterSpacing: "0.15em", textTransform: "uppercase" }}>
          {agentId}{isSilent ? " · silent baseline" : ` · r${round}`}
        </div>
        {trace.reasoning_frame && <Tag color={accentColor}>{trace.reasoning_frame}</Tag>}
      </div>

      {(providerTag || modelTag) && (
        <div style={{ marginBottom: "0.45rem" }}>
          {providerTag && <Tag color={C.accent}>{providerTag}</Tag>}
          {modelTag && <Tag color={C.muted}>{modelTag}</Tag>}
        </div>
      )}

      {failed ? (
        <div style={{ background: "#1e0a0a", border: `1px solid ${C.error}40`, borderRadius: "4px", padding: "0.6rem", fontSize: "0.68rem", color: C.error }}>
          {trace.failure_reason}
          {trace.raw_reasoning_attempt && (
            <div style={{ color: C.muted, marginTop: "0.4rem", fontSize: "0.62rem" }}>{trace.raw_reasoning_attempt.slice(0, 300)}...</div>
          )}
        </div>
      ) : (
        <>
          <div style={{ fontSize: "0.76rem", color: C.text, lineHeight: 1.55, marginBottom: "0.6rem" }}>{trace.claim}</div>

          <div style={{ display: "flex", alignItems: "baseline", gap: "0.5rem", flexWrap: "wrap" }}>
            <span style={{ fontSize: "1.05rem", fontWeight: "bold", color: conf > 0.7 ? C.success : conf > 0.5 ? C.warn : C.error, fontFamily: f.mono }}>
              {conf !== null && conf !== undefined ? (conf * 100).toFixed(0) + "%" : "—"}
            </span>
            {delta !== undefined && delta !== null && (
              <span style={{ fontSize: "0.7rem", color: dColor, fontFamily: f.mono }}>
                {delta > 0 ? "▲" : delta < 0 ? "▼" : "—"}{Math.abs(delta).toFixed(3)} · {dLabel}
              </span>
            )}
            {deltaMismatchFlag && (
              <Tag color={C.warn}>⚠ self-report Δ mismatch</Tag>
            )}
          </div>

          {trace.decision_basis && (
            <div style={{ marginTop: "0.4rem" }}>
              <Tag color={C.accent}>basis: {trace.decision_basis}</Tag>
            </div>
          )}

          {trace.flags?.length > 0 && (
            <div style={{ marginTop: "0.4rem" }}>
              {trace.flags.map((flag, i) => <Tag key={i} color={C.warn}>{flag}</Tag>)}
            </div>
          )}

          {trace.self_check && (
            <div style={{ marginTop: "0.4rem" }}>
              <Tag color={trace.self_check.status === "clean" ? C.success : C.warn}>
                self-check: {trace.self_check.status}
                {trace.self_check.self_check_overridden ? " [overridden]" : ""}
              </Tag>
            </div>
          )}

          <button
            onClick={() => setExpanded(!expanded)}
            style={{ background: "none", border: `1px solid ${C.border}`, color: C.muted, cursor: "pointer", fontSize: "0.6rem", padding: "0.2rem 0.6rem", borderRadius: "2px", marginTop: "0.6rem", fontFamily: f.mono, letterSpacing: "0.08em" }}
          >
            {expanded ? "▲ collapse" : "▼ expand trace"}
          </button>

          {expanded && (
            <div style={{ marginTop: "0.75rem" }}>
              {trace.critical_path?.length > 0 && (
                <>
                  <SectionLabel>critical path</SectionLabel>
                  {trace.critical_path.map((s, i) => (
                    <div key={i} style={{ fontSize: "0.68rem", color: C.text, lineHeight: 1.5, marginBottom: "0.3rem", display: "flex", gap: "0.5rem" }}>
                      <span style={{ color: accentColor, fontSize: "0.6rem", minWidth: "1rem", fontFamily: f.mono }}>{i + 1}.</span>
                      <span>{s}</span>
                    </div>
                  ))}
                </>
              )}
              {trace.assumptions?.length > 0 && (
                <>
                  <SectionLabel>assumptions</SectionLabel>
                  {trace.assumptions.map((a, i) => (
                    <div key={i} style={{ fontSize: "0.67rem", color: C.muted, lineHeight: 1.4, marginBottom: "0.2rem" }}>· {a}</div>
                  ))}
                </>
              )}
              {trace.challenge_surface?.length > 0 && (
                <>
                  <SectionLabel>challenge surface</SectionLabel>
                  {trace.challenge_surface.map((c, i) => (
                    <div key={i} style={{ fontSize: "0.67rem", color: C.warn, lineHeight: 1.4, marginBottom: "0.2rem" }}>⚡ {c}</div>
                  ))}
                </>
              )}
              {trace.challenged?.length > 0 && (
                <>
                  <SectionLabel>challenged claims</SectionLabel>
                  {trace.challenged.map((c, i) => (
                    <div key={i} style={{ fontSize: "0.67rem", color: C.error, lineHeight: 1.4, marginBottom: "0.2rem" }}>✕ {c}</div>
                  ))}
                </>
              )}
              {trace.drift_note && (
                <>
                  <SectionLabel>drift note</SectionLabel>
                  <div style={{ fontSize: "0.67rem", color: C.muted, lineHeight: 1.5 }}>{trace.drift_note}</div>
                </>
              )}
              {trace.self_check?.notes && (
                <>
                  <SectionLabel>self-check notes</SectionLabel>
                  <div style={{ fontSize: "0.67rem", color: C.muted, lineHeight: 1.5 }}>{trace.self_check.notes}</div>
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
