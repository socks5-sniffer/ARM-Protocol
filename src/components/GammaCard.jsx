// SPDX-License-Identifier: Apache-2.0
import { useState } from "react";
import { C, f } from "../theme.js";
import { Tag } from "./Tag.jsx";
import { SectionLabel } from "./SectionLabel.jsx";

export function GammaCard({ trace }) {
  const [expanded, setExpanded] = useState(true);
  if (!trace) return null;
  const failed = trace._ok === false;
  const disClass = trace.disagreement_classification;
  const disColor = disClass === "values" ? C.error : disClass === "reasoning" ? C.warn : disClass === "information" ? C.accent : C.success;
  const providerTag = trace._meta?.provider;
  const modelTag = trace._meta?.model;

  return (
    <div style={{ background: C.surface2, border: `2px solid ${C.gamma}30`, borderRadius: "6px", padding: "1.25rem", marginTop: "1rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
        <div style={{ fontSize: "0.6rem", color: C.gamma, fontFamily: f.mono, letterSpacing: "0.15em", textTransform: "uppercase" }}>
          gamma · reconciler · r2
        </div>
        {disClass && (
          <Tag color={disColor} bg={disColor + "20"}>disagreement: {disClass}</Tag>
        )}
        {trace.reconciliation_status && (
          <Tag color={trace.reconciliation_status === "gamma_flip_detected" ? C.warn : C.success}>{trace.reconciliation_status}</Tag>
        )}
        {trace.polarity_audit?.requires_manual_review === true && (
          <Tag color={C.warn} bg={C.warn + "20"}>MANUAL REVIEW REQUIRED</Tag>
        )}
      </div>

      {(providerTag || modelTag) && (
        <div style={{ marginBottom: "0.45rem" }}>
          {providerTag && <Tag color={C.accent}>{providerTag}</Tag>}
          {modelTag && <Tag color={C.muted}>{modelTag}</Tag>}
        </div>
      )}

      {!failed && (
        <>
          <div style={{ fontSize: "0.8rem", color: C.text, lineHeight: 1.6, marginBottom: "0.75rem" }}>{trace.claim}</div>

          <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ fontSize: "1.1rem", fontWeight: "bold", color: trace.confidence > 0.7 ? C.success : C.warn, fontFamily: f.mono }}>
              {trace.confidence !== null && trace.confidence !== undefined ? (trace.confidence * 100).toFixed(0) + "%" : "—"}
            </span>
            {Number.isFinite(trace.harness_self_delta_vs_baseline) && (
              <span style={{ fontSize: "0.72rem", color: C.silent, fontFamily: f.mono }}>
                self-Δ vs silent: {trace.harness_self_delta_vs_baseline > 0 ? "+" : ""}{Number(trace.harness_self_delta_vs_baseline).toFixed(3)}
              </span>
            )}
            {trace.self_delta_mismatch === true && (
              <Tag color={C.warn}>⚠ self-report Δ mismatch</Tag>
            )}
          </div>

          {trace.agent_decision_bases && (
            <div style={{ marginTop: "0.6rem" }}>
              <SectionLabel>declared decision bases</SectionLabel>
              {Object.entries(trace.agent_decision_bases).map(([agent, basis]) => (
                <span key={agent} style={{ marginRight: "0.5rem" }}>
                  <Tag color={agent === "alpha" ? C.alpha : C.beta}>{agent}: {basis}</Tag>
                </span>
              ))}
            </div>
          )}

          {trace.values_in_conflict?.length > 0 && (
            <div style={{ marginTop: "0.6rem" }}>
              <SectionLabel>values in conflict</SectionLabel>
              {trace.values_in_conflict.map((v, i) => (
                <div key={i} style={{ fontSize: "0.68rem", color: C.error, lineHeight: 1.4, marginBottom: "0.2rem" }}>⟁ {v}</div>
              ))}
            </div>
          )}

          <button
            onClick={() => setExpanded(!expanded)}
            style={{ background: "none", border: `1px solid ${C.border}`, color: C.muted, cursor: "pointer", fontSize: "0.6rem", padding: "0.2rem 0.6rem", borderRadius: "2px", marginTop: "0.6rem", fontFamily: f.mono, letterSpacing: "0.08em" }}
          >
            {expanded ? "▲ collapse" : "▼ expand reconciliation"}
          </button>

          {expanded && (
            <div style={{ marginTop: "0.75rem" }}>
              {trace.disagreement_notes && (
                <>
                  <SectionLabel>disagreement analysis</SectionLabel>
                  <div style={{ fontSize: "0.69rem", color: C.text, lineHeight: 1.6 }}>{trace.disagreement_notes}</div>
                </>
              )}
              {trace.rlhf_audit_notes && (
                <>
                  <SectionLabel>⚙ rlhf bias audit (v0.7.1)</SectionLabel>
                  <div style={{ fontSize: "0.69rem", color: C.warn, lineHeight: 1.6, background: "#1e1a0a", border: `1px solid ${C.warn}30`, borderRadius: "4px", padding: "0.6rem" }}>
                    {trace.rlhf_audit_notes}
                  </div>
                </>
              )}
              {trace.critical_path?.length > 0 && (
                <>
                  <SectionLabel>reconciliation path</SectionLabel>
                  {trace.critical_path.map((s, i) => (
                    <div key={i} style={{ fontSize: "0.68rem", color: C.text, lineHeight: 1.5, marginBottom: "0.3rem", display: "flex", gap: "0.5rem" }}>
                      <span style={{ color: C.gamma, fontSize: "0.6rem", minWidth: "1rem", fontFamily: f.mono }}>{i + 1}.</span>
                      <span>{s}</span>
                    </div>
                  ))}
                </>
              )}
              {trace.challenged?.length > 0 && (
                <>
                  <SectionLabel>challenged claims</SectionLabel>
                  {trace.challenged.map((c, i) => (
                    <div key={i} style={{ fontSize: "0.68rem", color: C.error, lineHeight: 1.4, marginBottom: "0.2rem" }}>✕ {c}</div>
                  ))}
                </>
              )}
              {trace.self_check?.notes && (
                <>
                  <SectionLabel>self-check</SectionLabel>
                  <div style={{ fontSize: "0.68rem", color: C.muted, lineHeight: 1.5 }}>{trace.self_check.notes}</div>
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
