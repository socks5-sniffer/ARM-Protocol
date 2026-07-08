// SPDX-License-Identifier: Apache-2.0
import { DRIFT_UP_THRESHOLD, DRIFT_DOWN_THRESHOLD } from "../config.js";

// ─── Confidence-Δ label (descriptive only) ─────────────────────────────────────
// Maps a confidence delta to a direction/magnitude label. These are DESCRIPTIVE,
// not epistemic verdicts: the confidence-drift signal was falsified as a
// contamination detector (experiments/c1vc2, AUC ≈ 0.44 — below chance), so the
// old "epistemic tightening" / "memetic drift" judgments are gone. The label
// reports which way and how far confidence moved; the polarity/verdict-flip gate
// is what actually flags a problematic run.
export function driftLabel(delta) {
  if (delta === undefined || delta === null) return { label: "—", color: "#5a6480" };
  // Accept only finite numbers. Coerce strings (normalizing Unicode minus/dashes to
  // ASCII) and reject anything non-numeric.
  const n = typeof delta === "number"
    ? delta
    : Number(String(delta).replace(/[−–—]/g, "-").trim());
  if (!Number.isFinite(n)) return { label: "⚠ invalid delta", color: "#e05252" };
  if (n < DRIFT_DOWN_THRESHOLD) return { label: "large downward shift", color: "#3dbf7a" };
  if (n <= 0) return { label: "downward shift", color: "#3dbf7a" };
  if (n <= DRIFT_UP_THRESHOLD) return { label: "minor shift", color: "#5a6480" };
  return { label: "upward shift", color: "#c9a227" };
}

// ─── Polarity Gate helper ─────────────────────────────────────────────────────
// Returns "yes", "no", or "unknown" from a claim string.
// Broad anywhere-word matches (\byes\b / \bno\b) were removed: they caused
// false positives on claims like "should disclose — no patch available" → "no".
export function extractClaimDirection(claim) {
  if (!claim || claim === "[PARSE FAILED]" || claim.startsWith("[FAP")) return "unknown";
  const text = claim.toLowerCase();
  // Explicit yes/no at start of claim (catches "No — ...", "Yes, ...")
  if (/^no\b/.test(text)) return "no";
  if (/^yes\b/.test(text)) return "yes";
  // Implied NO: negation phrases
  if (/\b(?:should not|must not|cannot|will not|should never|ought not)\b/.test(text)) return "no";
  // Implied YES: "should" with no negation anywhere in the claim
  if (!/\bnot\b/.test(text) && /\bshould\b/.test(text)) return "yes";
  return "unknown";
}

// ─── Verdict (prefers the structured field over claim parsing) ─────────────────
// The Slide 8 fix: agents now declare `verdict: yes|no|conditional` as a
// first-class field. Prefer it; fall back to extractClaimDirection for older
// traces that predate the field. Returns "yes" | "no" | "conditional" | "unknown".
export function extractVerdict(trace) {
  if (!trace) return "unknown";
  const v = typeof trace.verdict === "string" ? trace.verdict.trim().toLowerCase() : "";
  if (v === "yes" || v === "no" || v === "conditional") return v;
  return extractClaimDirection(trace.claim);
}

// ─── Verdict transition (Gamma R1 → R2) ────────────────────────────────────────
// Classifies how the reconciler's verdict moved, so two signals of different
// severity can key off one place:
//   "flip"    — a firm yes↔no reversal. This is what the Polarity Gate acts on
//               (overrides reconciliation_status, forces manual review).
//   "shift"   — a change that involves "conditional" (hedged to it, or firmed away
//               from it). Real but softer than a reversal — an advisory flag only,
//               NOT a gate action.
//   "none"    — verdict unchanged.
//   "unknown" — a verdict is missing/unparseable (e.g. a parse-failed reconciler);
//               nothing can be asserted.
export function classifyVerdictTransition(v1, v2) {
  const isFirm = (v) => v === "yes" || v === "no";
  if (v1 === "unknown" || v2 === "unknown" || v1 == null || v2 == null) return "unknown";
  if (v1 === v2) return "none";
  if (isFirm(v1) && isFirm(v2)) return "flip";
  return "shift"; // one side is "conditional"
}
