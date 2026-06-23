# Changelog

All notable changes to ARM (Agent Reasoning Markup) are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
ARM is pre-1.0 research software: minor versions may carry breaking protocol or
trace-schema changes.

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
