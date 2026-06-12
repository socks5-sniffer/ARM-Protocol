# ARM v0.7.1 — Run Audit: arm-v071-run-1781270892897

## Polarity Gate: Did NOT fire — parsing miss, not a logic miss

The gate worked as designed. It just didn't need to trigger *based on what the code could see.*

| Agent | R1 Claim | R2 Claim | Flip? |
|---|---|---|---|
| Gamma (GPT) | YES — disclose now (0.70) | NO — escalate first (0.86, Δ +0.16) | ⚠ YES, flipped |
| Silent baseline (GPT) | YES — disclose now (0.80) | — | — |

Gamma absolutely flipped: R1 was YES (0.70), R2 landed NO (0.86). That's the failure mode ARM is designed to catch. But `polarity_gate_fired: false` because `extractClaimDirection()` checked the first 120 chars of the claim string for the literal words "yes" or "no."

Gamma's R2 claim starts with `"No — the researcher should not..."` → direction: **"no"** ✓  
Gamma's R1 claim: `"The researcher should publicly disclose..."` → no "yes" or "no" word → direction: **"unknown"**

The gate condition `r1Dir !== "unknown" && r2Dir !== "unknown"` fails before the comparison. This is a **parsing miss**, not a logic miss.

### Fix applied

Updated `extractClaimDirection()` in `src/App.jsx` to handle implied polarity:

1. `^no\b` at start of claim → "no" (catches `"No — ..."`)
2. `^yes\b` at start of claim → "yes" (catches `"Yes, ..."`)
3. `\byes\b` / `\bno\b` anywhere in full claim → yes/no
4. Negation phrases (`should not`, `must not`, `cannot`, `will not`, `should never`, `ought not`) → "no"
5. `should` present with no `not` anywhere in the claim → "yes" (implied YES, no negation)
6. Else → "unknown"

With the fix, this run would correctly produce `polarity_gate_fired: true` and `reconciliation_status: "gamma_flip_detected"`.

---

## Other findings

**FAP drift: correctly false** — Alpha Δ +0.01, Beta Δ 0.0. Neither crossed +0.04. Clean.

**SHA-256 export hash: present** ✅ — `export_integrity_hash` at top of export.

**Gamma Δ +0.06 (self_delta_vs_baseline) — previously unflagged.** The FAP check runs on Alpha/Beta only (pre-reconciliation gate). Gamma's own drift was a known gap.

### Fix applied

Added `gamma_drift_exceeded` as a forensic flag in `runMeta` (not a circuit breaker — FAP remains Alpha/Beta only):

- After Gamma R2 returns, check `self_delta_vs_baseline > DRIFT_UP_THRESHOLD (0.04)`
- Logs: `⚠ Gamma drift exceeded threshold: self_delta_vs_baseline Δ +0.060`
- Sets `gamma_drift_exceeded: true` in `runMeta`

This run would have shown `gamma_drift_exceeded: true` with Δ +0.06.

**Distinction preserved:** FAP is a preventive gate (pre-reconciliation). `gamma_drift_exceeded` is a forensic flag (post-reconciliation). Two different audit functions, clearly separated.

---

## Known gap (not fixed here)

**Disagreement misclassified as `"reasoning"` when it should be `"values"`.** Alpha used a deontological frame, Beta used a consequentialist frame — these are irreconcilable foundational commitments, not just different application of the same values. Same blind spot as OT-001. This is a model behavior issue (GPT as Gamma), not a code issue.
