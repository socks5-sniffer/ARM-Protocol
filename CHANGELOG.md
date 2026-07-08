# Changelog

All notable changes to ARM (Agent Reasoning Markup) are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
ARM is pre-1.0 research software: minor versions may carry breaking protocol or
trace-schema changes.

## [Unreleased]

### Added
- **Verdict-shift advisory flag.** A signal weaker than the polarity gate: when the
  Gamma reconciler's verdict moves *involving* `conditional` (a firm `yes`/`no`
  hedging to `conditional`, or firming away from it) rather than a firm `yes`↔`no`
  reversal, a `verdict_shift` block is written to the trace and `verdict_shift_flagged`
  is set on `runMeta`, with a lower-severity UI badge on the Gamma card. It is
  **advisory only** — unlike the gate it does not override `reconciliation_status`
  or `self_check`, and `requires_manual_review` is `false`. The shared
  `classifyVerdictTransition()` helper (`flip` | `shift` | `none` | `unknown`) drives
  both the gate and the advisory so they stay mutually exclusive and consistent.

### Changed
- **Confidence-drift retired as a detector.** The C1-vs-C2 injection experiment
  (`experiments/c1vc2`) scored ARM's confidence-drift signal against ground truth
  at **AUC ≈ 0.44** (below chance; 0 of 33 real false-premise adoptions caught by
  the magnitude flag vs. 30 by verdict-flip). Consequences:
  - **FAP isolation re-dispatch disabled** — a +0.04 Alpha/Beta R2 delta is now a
    logged `fap_drift_triggered` breadcrumb, not a re-dispatch plus
    `memetic`/`epistemic` classification.
  - **`gamma_drift_exceeded` downgraded** to a logged diagnostic.
  - **Polarity / verdict-flip gate is now the primary drift detector** and reads
    the structured `verdict` field via `extractVerdict`.
  - **`driftLabel` relabeled** to descriptive direction/magnitude ("upward shift" /
    "downward shift"); the "memetic drift" / "epistemic tightening" verdicts are removed.
  - **`confidence` documented as self-reported and unvalidated**; the behavioral IPR
    metric in `experiments/c1vc2` is the falsifiable signal.

### Removed
- `fap_requeue` block from run output — isolation re-dispatch no longer occurs.

## [0.9.0] — 2026-06-23

First public release.

### Added
- **Reconciler self-check coverage.** The deterministic `clean` → `auto_warn`
  override now fires on the Gamma reconciler schema
  (`disagreement_classification == "values"` or a non-empty `values_in_conflict[]`),
  not only on the R1/R2 agent `flags[]` array. Closes the last known self-check
  escape. Both paths preserve `self_check_original_status: "clean"` for forensics.
- **Trace schema `arm-trace-v1.2`.** Adds `override_reason` to the `self_check`
  object when an override fires. Backward-compatible additive change.
- Protocol version is now wired through the UI and trace export (previously it
  lived only in `package.json`).

### Changed
- **`TOKENS_GAMMA` lowered from 12,000 to 8,000** — the safe ceiling for
  Gemini 3.5 Flash's 8,192-token hard output cap. The inflated value caused
  all-Gemini Gamma R2 reconciler calls to fail silently. Cross-model runs were
  unaffected.
- **Matched-panel CFAAq2 factorial re-run (8/8).** All prior results on the
  mismatched `gpt-4o` / `gemini-2.5-pro` panel are superseded by the matched
  `claude-sonnet-4-6` / `gpt-5.5-2026-04-23` / `gemini-3.5-flash` panel.
  Headline: all-GPT monoculture convergence dropped 0.810 → 0.235 after
  replacing the retired `gpt-4o`.

### Known Issues
- **Rotating silent baseline self-delta is unreliable** (`src/App.jsx`). When
  `silentAgent` is set to `alpha` or `beta` (the rotating-test override), the
  framed silent trace is later presented to Gamma as its own prior, so
  `harness_self_delta_vs_baseline` becomes a cross-agent delta rather than a true
  self-delta. The default configuration (`gamma` as silent agent) is unaffected.
  Flagged in-code; tracked for a future deterministic-drift fix.

## [0.8.0]

### Added
- **Polarity Gate.** Detects when Gamma's claim direction (YES/NO) flips between
  R1 and R2 — invisible to magnitude-based drift detection. Forces
  `reconciliation_status: "gamma_flip_detected"`, downgrades `self_check.status`
  to `warning`, writes a `polarity_audit` block with `requires_manual_review`, and
  surfaces a **MANUAL REVIEW REQUIRED** badge in the UI.
- **FAP circuit breaker** (formerly "smoke alarm"). When an Alpha/Beta R2
  confidence delta exceeds +0.04, the agent is re-dispatched in full isolation and
  the drift is classified `memetic` (peer-borrowed) or `epistemic` (genuine gain).
- **`gamma_drift_exceeded`** forensic flag, fired post-reconciliation when Gamma's
  `self_delta_vs_baseline` exceeds +0.04.
- **Export integrity hash.** Every exported run is sealed with a SHA-256
  `export_integrity_hash` over the serialized payload.

## [0.7.1]

### Added
- **Asymmetric drift thresholds.** Upward drift (Δ > +0.04) flagged as memetic;
  downward drift treated as healthy epistemic tightening, with deep tightening
  (Δ < -0.15) noted separately. Sensitivity tightened from 0.05 → 0.04.
- **Rotating silent baseline** UI selector (`gamma` / `alpha` / `beta`) to test
  whether the reproducibility finding is a protocol property rather than a Gamma
  artifact.
- **`decision_basis`** field on every agent, enabling Gamma's
  `disagreement_classification` to be cross-checked against self-reported intent.
- **RLHF bias audit** (`rlhf_audit_notes`) required in Gamma R2, surfaced as a
  distinct UI section.
- **Role injection toggle** to compare framed vs. unframed (`independent`)
  deliberation.

## [0.6.0] and earlier

Earlier research iterations (arc spans v0.3–v0.7). Representative exported run
telemetry is preserved under `trace/` (`v0.6`, `v0.7`, `v0.7.1`).

[0.9.0]: https://github.com/socks5-sniffer/ARM-Protocol/releases/tag/v0.9.0
