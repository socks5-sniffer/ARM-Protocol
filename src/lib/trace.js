// SPDX-License-Identifier: Apache-2.0
import {
  VALID_DISAGREEMENT,
  VALID_RECON_STATUS,
  DELTA_MISMATCH_EPS,
} from "../config.js";

// Flags that signal values tension — when present alongside a "clean" self_check,
// the clean is provider house-style, not a genuine epistemic assessment.
const VALUES_TENSION_FLAGS = new Set(["values_conflict", "contested_domain"]);

// ─── Safe JSON parse ──────────────────────────────────────────────────────────
export function safeParseTrace(rawResult, agentId) {
  const { raw, stopReason, usage, provider, model, latencyMs } = rawResult;
  const truncated = stopReason === "max_tokens";
  const _meta = { stopReason, usage, provider, model, latencyMs };
  try {
    // Strip ONLY leading/trailing markdown fences — a global replace would mangle
    // legitimate backticks inside JSON string values. Mid-prose fences fall through
    // to JSON.parse failure and are handled by the caller's fallback.
    let cleaned = String(raw || "")
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```\s*$/, "")
      .trim();
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

    // verdict: the structured field the polarity gate keys on. A missing or
    // out-of-enum verdict is non-fatal (extractVerdict falls back to parsing the
    // claim text) but it degrades the PRIMARY detector to brittle regex guessing,
    // so it is surfaced as a schema warning rather than passing silently.
    const vd = parsed.verdict;
    if (typeof vd !== "string" || !["yes", "no", "conditional"].includes(vd.trim().toLowerCase())) {
      schema_warnings.push(`verdict_missing_or_invalid:${JSON.stringify(vd)}`);
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

    // Self-check deterministic override: when the trace itself testifies to values
    // tension, a "clean" self_check is provider house-style, not epistemic state.
    // Two schema shapes carry that testimony:
    //   • Round-1/2 agents expose a flags[] array (values_conflict / contested_domain).
    //   • The Gamma reconciler has no flags[]; it declares the tension structurally via
    //     disagreement_classification:"values" and/or a non-empty values_in_conflict[].
    // Either signal, alongside a "clean" self_check, triggers the override to "auto_warn".
    const flagsTension =
      Array.isArray(trace.flags) &&
      trace.flags.some((fl) => VALUES_TENSION_FLAGS.has(fl));
    const reconcilerTension =
      trace.disagreement_classification === "values" ||
      (Array.isArray(trace.values_in_conflict) && trace.values_in_conflict.length > 0);

    if (trace.self_check?.status === "clean" && (flagsTension || reconcilerTension)) {
      trace.self_check = {
        status: "auto_warn",
        notes: trace.self_check.notes || "",
        self_check_overridden: true,
        self_check_original_status: "clean",
        override_reason: flagsTension ? "values_tension_flag" : "reconciler_values_disagreement",
      };
    }

    return { ok: true, trace, raw };
  } catch (e) {
    const schemaReject = e && e.schemaReject === true;
    const flags = [schemaReject ? "schema_validation_failure" : "serialization_failure"];
    if (truncated) flags.push("truncation_detected");
    return {
      ok: false,
      // Failure is signalled out of band via _ok:false; the claim text is a
      // display placeholder. Uppercase to match the "[PARSE FAILED]" sentinel
      // guarded in analysis.js/score.js and emitted by the c1vc2 harness.
      trace: {
        claim: "[PARSE FAILED]",
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

// ─── TF-IDF cosine convergence ────────────────────────────────────────────────
// Smoothed IDF (log(N/df) + 1): terms shared by all agents keep weight 1 instead
// of being zeroed, so the score behaves as a convergence alarm — identical claims
// score 1, and the > 0.4 warn threshold is reachable. The unsmoothed v1.2 formula
// (log(N/df), which zeroes universally-shared terms and makes any 2-doc pair — and
// even identical claims — score 0) is kept behind { smoothIdf: false } so numbers
// published from arm-trace-v1.2 exports remain reproducible (goldenTraces.test.js).
export function computeTFIDFCosine(traces, { smoothIdf = true } = {}) {
  const claims = traces
    .filter((t) => t && t._ok !== false && typeof t.claim === "string" && t.claim)
    .map((t) => t.claim.toLowerCase());
  if (claims.length < 2) return null;

  const tokenize = (s) => s.split(/\W+/).filter((w) => w.length > 2);
  const docs = claims.map(tokenize);
  const N = docs.length;

  const df = new Map();
  for (const terms of docs) {
    for (const term of new Set(terms)) df.set(term, (df.get(term) || 0) + 1);
  }

  const vectors = docs.map((terms) => {
    if (!terms.length) return new Map();
    const tf = new Map();
    for (const t of terms) tf.set(t, (tf.get(t) || 0) + 1);
    const vec = new Map();
    for (const [term, count] of tf) {
      const idf = Math.log(N / df.get(term)) + (smoothIdf ? 1 : 0);
      vec.set(term, (count / terms.length) * idf);
    }
    return vec;
  });

  function cosineSim(a, b) {
    let dot = 0;
    for (const [term, val] of a) { if (b.has(term)) dot += val * b.get(term); }
    const mag = (v) => Math.sqrt([...v.values()].reduce((s, x) => s + x * x, 0));
    const mA = mag(a), mB = mag(b);
    return mA && mB ? dot / (mA * mB) : 0;
  }

  let total = 0, pairs = 0;
  for (let i = 0; i < vectors.length; i++) {
    for (let j = i + 1; j < vectors.length; j++) {
      total += cosineSim(vectors[i], vectors[j]);
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
