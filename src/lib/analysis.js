// SPDX-License-Identifier: Apache-2.0
import { DRIFT_UP_THRESHOLD, DRIFT_DOWN_THRESHOLD } from "../config.js";

// ─── Drift label (ASYMMETRIC v0.7.1) ───────────────────────────────────────────
export function driftLabel(delta) {
  if (delta === undefined || delta === null) return { label: "—", color: "#5a6480" };
  // Accept only finite numbers. Coerce strings (normalizing Unicode minus/dashes to
  // ASCII) and reject anything non-numeric — never fall through to "memetic drift".
  const n = typeof delta === "number"
    ? delta
    : Number(String(delta).replace(/[−–—]/g, "-").trim());
  if (!Number.isFinite(n)) return { label: "⚠ invalid delta", color: "#e05252" };
  if (n < DRIFT_DOWN_THRESHOLD) return { label: "deep tightening", color: "#3dbf7a" };
  if (n <= 0) return { label: "epistemic tightening", color: "#3dbf7a" };
  if (n <= DRIFT_UP_THRESHOLD) return { label: "minor shift", color: "#5a6480" };
  return { label: "⚠ memetic drift", color: "#e05252" };
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
