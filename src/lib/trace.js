// SPDX-License-Identifier: Apache-2.0
import {
  VALID_DISAGREEMENT,
  VALID_RECON_STATUS,
  DELTA_MISMATCH_EPS,
} from "../config.js";

// ─── Safe JSON parse ──────────────────────────────────────────────────────────
export function safeParseTrace(rawResult, agentId) {
  const { raw, stopReason, usage, provider, model, latencyMs } = rawResult;
  const truncated = stopReason === "max_tokens";
  const _meta = { stopReason, usage, provider, model, latencyMs };
  try {
    let cleaned = (raw || "").replace(/```json|```/g, "").trim();
    // Fix Gemini serialization bug: strip stray double-quote before property keys
    cleaned = cleaned.replace(/""([^"]+)":/g, '"$1":');
    const parsed = JSON.parse(cleaned);

    // ── B3: schema / range validation ────────────────────────────────────────
    const schema_warnings = [];

    // confidence: required, finite number in [0,1]. Missing/non-numeric → reject.
    const conf = parsed.confidence;
    if (conf === null || conf === undefined || typeof conf !== "number" || !Number.isFinite(conf)) {
      const err = new Error(`confidence missing or non-numeric (got ${JSON.stringify(conf)})`);
      err.schemaReject = true;
      throw err;
    }
    if (conf < 0 || conf > 1) {
      parsed.confidence = Math.min(1, Math.max(0, conf)); // clamp + flag
      schema_warnings.push(`confidence_out_of_range:${conf}`);
    }

    // drift_score.confidence_delta: when present, finite in [-1,1] (non-fatal warning).
    const cd = parsed.drift_score?.confidence_delta;
    if (cd !== undefined && cd !== null &&
        (typeof cd !== "number" || !Number.isFinite(cd) || cd < -1 || cd > 1)) {
      schema_warnings.push(`drift_delta_invalid:${JSON.stringify(cd)}`);
    }

    // disagreement_classification: when present, must be in the enum.
    const dc = parsed.disagreement_classification;
    if (dc !== undefined && dc !== null && !VALID_DISAGREEMENT.includes(dc)) {
      schema_warnings.push(`disagreement_classification_invalid:${JSON.stringify(dc)}`);
    }

    // reconciliation_status: when present, success | failed.
    const rs = parsed.reconciliation_status;
    if (rs !== undefined && rs !== null && !VALID_RECON_STATUS.includes(rs)) {
      schema_warnings.push(`reconciliation_status_invalid:${JSON.stringify(rs)}`);
    }

    const trace = { ...parsed, _meta, _ok: true };
    if (schema_warnings.length) trace.schema_warnings = schema_warnings;
    return { ok: true, trace, raw };
  } catch (e) {
    const schemaReject = e && e.schemaReject === true;
    const flags = [schemaReject ? "schema_validation_failure" : "serialization_failure"];
    if (truncated) flags.push("truncation_detected");
    return {
      ok: false,
      // No magic-string sentinel — failure is signalled out of band via _ok:false.
      trace: {
        claim: "[parse failed]",
        confidence: null,
        reconciliation_status: "failed",
        failure_reason: truncated
          ? `Truncated at max_tokens (${usage?.output_tokens}). Raise token budget.`
          : e.message,
        raw_reasoning_attempt: raw,
        flags,
        self_check: {
          status: "failed",
          notes: truncated
            ? "Token budget exceeded."
            : schemaReject
            ? "Schema validation failed."
            : "JSON parse error.",
        },
        _meta: { ..._meta, truncated },
        _ok: false,
      },
      raw,
      error: e.message,
    };
  }
}

// ─── Jaccard convergence ──────────────────────────────────────────────────────
export function computeConvergence(traces) {
  const claims = traces
    .filter((t) => t && t._ok !== false && typeof t.claim === "string" && t.claim)
    .map((t) => t.claim.toLowerCase());
  if (claims.length < 2) return null;
  const tokenize = (s) => new Set(s.split(/\W+/).filter((w) => w.length > 4));
  const sets = claims.map(tokenize);
  let total = 0, pairs = 0;
  for (let i = 0; i < sets.length; i++) {
    for (let j = i + 1; j < sets.length; j++) {
      const intersection = [...sets[i]].filter((x) => sets[j].has(x)).length;
      const union = new Set([...sets[i], ...sets[j]]).size;
      total += union > 0 ? intersection / union : 0;
      pairs++;
    }
  }
  return pairs > 0 ? total / pairs : null;
}

// ─── Compress trace ───────────────────────────────────────────────────────────
export function compressTrace(trace) {
  if (!trace || trace._ok === false) return null;
  return {
    claim: trace.claim,
    confidence: trace.confidence,
    reasoning_frame: trace.reasoning_frame,
    decision_basis: trace.decision_basis,
    key_assumptions: trace.assumptions?.slice(0, 4),
    main_path: trace.critical_path?.slice(0, 5),
    top_challenges: trace.challenge_surface?.slice(0, 3),
    flags: trace.flags,
    self_check_status: trace.self_check?.status,
  };
}

// ─── Harness-computed drift (A1/A2) ─────────────────────────────────────────────
// The load-bearing drift signals are computed here from the two confidence numbers
// the harness already holds — not taken from the model's self-report. The model's
// self-reported delta is preserved separately and cross-checked against this value.
export function harnessDelta(after, before) {
  return Number.isFinite(after) && Number.isFinite(before) ? after - before : null;
}

export function deltaMismatch(modelVal, harnessVal) {
  return Number.isFinite(modelVal) && Number.isFinite(harnessVal)
    ? Math.abs(modelVal - harnessVal) > DELTA_MISMATCH_EPS
    : false;
}

// Annotate an R2 agent trace with harness_confidence_delta (= C_R2 − C_R1), keeping
// the model's drift_score.confidence_delta intact and flagging any mismatch.
export function annotateAgentDrift(r2trace, r1trace) {
  if (!r2trace || r2trace._ok === false) return;
  const hd = harnessDelta(r2trace.confidence, r1trace?.confidence);
  const model = r2trace.drift_score?.confidence_delta;
  r2trace.drift_score = {
    ...(r2trace.drift_score || {}),
    harness_confidence_delta: hd,
    delta_mismatch: deltaMismatch(model, hd),
  };
}
