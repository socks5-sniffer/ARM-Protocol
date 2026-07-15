# Pre-registration — C1-vs-C2 monoculture confirmatory runs

**Registered:** 2026-07-03 (the git commit that adds this file is the immutable timestamp).
**Registered by:** Erik Roed.
**Status:** written and committed **before** the all-GPT / all-Gemini / all-Claude runs.

This pins down the hypotheses, predictions, fixed parameters, and decision rules
*before* the data exists, so the monoculture runs are **confirmatory**, not exploratory.
The mixed-panel run (`c1vc2-results-1782597403181.json`) already exists and is treated
here as prior/pilot evidence, not as part of this confirmatory set.

---

## Hypotheses

**H1 — Persuasion Duality.** Sharing an agent's full reasoning propagates a planted
*false* premise to its peers more than sharing only its conclusion.
Operationally: **Δ = IPR(C2) − IPR(C1) > 0.**
- Prior (mixed panel): **not supported** — Δ = −0.03, permutation p = 0.19, 95% CI [−0.068, +0.009].

**H4 — Monoculture poisonability.** A same-family panel is easier to poison than a mixed
panel: an injected false premise achieves a higher adoption rate when both subjects share
the target's training/alignment lineage.
Operationally: **IPR(monoculture) > IPR(mixed)** for at least one same-family panel.

---

## Pre-committed predictions (directional, locked before running)

| Panel | Predicted IPR (false premises) | Predicted Δ (C2−C1) | Predicted challenge behavior | Confidence |
|---|---|---|---|---|
| **all-GPT** | ≈ 0 (near-floor) | ≈ 0 or slightly negative | High — actively rebuts fallacies | High |
| **all-Gemini** | High (clearly > mixed) | ≈ 0 (adopts regardless of condition) | ≈ 0 challenges | High |
| **all-Claude** | **Open question.** Tentative: auditor-like, closer to GPT than Gemini (low adoption, some challenges) | ≈ 0 or negative | Some challenges | **Low — this is the genuinely untested panel** |

Rationale for the locked predictions: in the mixed panel GPT-5.5 adopted 0/117 false
premises and challenged actively, while Gemini-Flash adopted the propagating fallacies and
challenged nothing (0). If robustness is model-specific (the mixed-panel finding), the
monocultures should inherit each model's behavior. Claude has never been a subject, so its
prediction is explicitly low-confidence and is the primary new information from this set.

---

## Fixed parameters (identical across the three runs)

- **Battery:** `injections-logical.json` — 9 injections = **8 invalid-inference fallacies
  (false) + 1 true-premise control.** (NOT the default `injections.json`.)
- **Reps:** 15 per injection.
- **Panels:** `gpt`, `gemini`, `claude` (both subjects = the named provider; the injection
  target is a static authored trace, not a model call).
- **Models:** `claude-sonnet-4-6` · `gpt-5.5-2026-04-23` · `gemini-3.5-flash`.
- **Expected n per panel:** 8 false injections × 15 reps × 2 subjects = **240 false
  subject-instances** (+ 30 true-control), minus any API errors.
- **Scorer:** `src/lib/score.js` (IPR classification, unchanged).
- **Statistics:** `stats.js`, seed 42, 10 000 iterations (bootstrap 95% CI + paired
  permutation test on Δ).

Run commands (for the record):
```
node experiments/c1vc2/run.js --panel gpt    --reps 15 --battery injections-logical.json --out experiments/c1vc2/c1vc2-results-allGPT.json
node experiments/c1vc2/run.js --panel gemini --reps 15 --battery injections-logical.json --out experiments/c1vc2/c1vc2-results-allGemini.json
node experiments/c1vc2/run.js --panel claude --reps 15 --battery injections-logical.json --out experiments/c1vc2/c1vc2-results-allClaude.json
```

---

## Decision rules (set in advance)

**On H1 (per panel and pooled):**
- **Supported** if Δ > 0 with permutation p < 0.05.
- **Null / not supported** if the Δ 95% CI includes 0.
- A **negative** significant Δ is reported as "transparency was protective," not spun as H1.

**On H4:**
- **Supported** if any same-family panel's false-premise IPR is higher than the mixed
  panel's with a non-overlapping (or clearly separated) 95% CI — strongest expected case:
  all-Gemini.
- **Not supported** if no monoculture exceeds mixed beyond CI overlap.

**Primary endpoint:** false-premise IPR per panel and Δ(C2−C1) per panel.
**Model-behavior endpoint:** adoption count and challenge count per panel (the "auditor vs
adopter" signature).

---

## Declared exploratory (NOT confirmatory — will be labeled as such in any write-up)

- Per-injection breakdowns (n ≈ 30/injection is too small to trust individually).
- Any follow-up on the `cyber-unbounded-harm` amplifier specifically.
- Cross-panel comparisons not named above.
- Confidence/calibration numbers (IPR is behavioral by design; confidence remains unvalidated).

---

## Known limitations acknowledged up front

- Single run per panel (no monoculture test-retest yet); reps average within a run but the
  run itself is not replicated.
- No formal power analysis; n is fixed at 15 reps for parity with the mixed pilot, not
  chosen to hit a target power. Δ near zero at this n should be read as "no detectable
  effect," not "proven zero."
- The injection battery's false premises are **fabricated payloads** (invented statutes/
  rules used only as bait) and must never be cited as real.

*Amendments after this point must be dated and appended below, not edited in place.*

---

## Amendment (2026-07-14) — analysis deviation: injection-blocked significance

The pre-registered analysis plan specified instance-level permutation tests.
An external methodology review (post-data, pre-publication) identified that
subject-instances are nested within 8 authored injections, so instance-level
p-values overstate evidence for any claim that generalizes across injections.
DEVIATION: `stats.js` now additionally reports an injection-blocked exact
sign-flip test (one Δ per injection) and this blocked test is treated as the
headline significance criterion. Applied retroactively to all four completed
panels: no Δ is significant under blocking (all-Gemini p = 0.5625 vs the
instance-level 0.009 that the locked decision rule above would have called
"transparency was protective"). Because this deviation was adopted AFTER
seeing the data, it is flagged as such; it is conservative (it weakens the
program's only significant result), but any future battery should pre-register
the blocked test as primary and size k (injections, not reps) by power
analysis. Instance-level results remain reported for continuity.
