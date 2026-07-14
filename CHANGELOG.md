# Changelog

All notable changes to ARM (Agent Reasoning Markup) are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
ARM is pre-1.0 research software: minor versions may carry breaking protocol or
trace-schema changes.

## [Unreleased]

### Security
- **Untrusted-input envelope markers can no longer be forged.** `sanitizeText`
  now strips any literal `[BEGIN/END UNTRUSTED INPUT …]` marker from untrusted
  text (question + peer traces). Previously a payload containing the exact
  `[END UNTRUSTED INPUT]` string could fake the close of its own envelope, so the
  text after it read as trusted instructions to the model. Stripped after the
  zero-width/bidi pass so obfuscated variants are caught too.
- **Provider proxy routes now enforce a per-model allowlist.** `server.js`
  validates each request body's `model` against a per-provider allowlist on the
  Anthropic, OpenAI chat, and OpenAI embeddings routes — closing the
  denial-of-wallet gap where a caller holding the shared token could spend the
  operator's key on an arbitrarily expensive model. This matches the path/model
  pinning the Gemini route already had. Defaults track `src/config.js`; override
  via `ARM_ALLOWED_ANTHROPIC_MODELS` / `ARM_ALLOWED_OPENAI_MODELS` /
  `ARM_ALLOWED_OPENAI_EMBEDDING_MODELS`. Non-POST requests to keyed routes now
  return `405`.
- **Vite dev proxy can be authenticated and is no longer wide-open by default.**
  The dev proxy injects the operator's provider keys into `/api/*` requests; a new
  `devProxyAuth` guard requires `ARM_DEV_PROXY_TOKEN` (when set) as `x-arm-token`
  before proxying, running *before* the proxy so rejected requests never reach a
  provider with a key attached. `allowedHosts: "all"` (which disabled the host
  check that prevents DNS-rebinding against the proxy) is no longer hardcoded —
  it defaults to Vite's safe behavior and is opened only via `VITE_ALLOWED_HOSTS`.
- **Security CI now gates instead of only advising.** `npm audit` fails the build
  on high/critical advisories (moderate stays an advisory report); the ESLint
  security scan dropped its `|| true` so error-level rules (eval, unsafe-regex,
  no-unsanitized, …) fail the build, and the scan now also covers `server.js` (the
  key-injecting proxy). The config-validation job additionally asserts the proxy
  allowlists, the `/api` auth gate, and the dev-proxy hardening are present, so a
  future edit cannot silently remove them.

### Changed
- **Polarity gate now resolves its baseline against a Gamma R1 *consensus*.** The
  gate previously compared Gamma R2 against the visible R1 draw (`pG1`) alone —
  but R2 is prompted with the *silent* baseline as its prior, and the two draws
  are independent stochastic samples that disagree from ordinary generation
  noise. A new `classifyGammaPolarity()` helper (`src/lib/analysis.js`) splits on
  whether the two draws agree:
  - **Both agree** → gate compares R2 against that consensus; a flip contradicts
    *both* independent statements of Gamma's prior (the strong signal). Fires
    exactly as before (`polarity_audit`, manual review).
  - **They disagree** → the model's own prior is a coin flip on this question, so
    a "flip" is undefined. The gate is **not evaluated**; instead a
    `baseline_unstable` advisory is written (`requires_manual_review: false`) with
    an amber UI badge. No status override.
  - **Rotated silent baseline (`silentAgent ≠ gamma`) or an unparseable verdict**
    → consensus is undefined, so the gate falls back to the legacy
    visible-R1-only comparison and records `baseline_mode: "visible_r1_only"` in
    the audit (the pre-existing cross-agent-comparison caveat, B1, is unchanged
    and now explicitly labeled rather than silent).
  The `polarity_audit` block gains `baseline_mode`, `baselines_agree`, and
  `silent_agent`; `runMeta` gains `baseline_unstable`. On the committed traces
  this reclassifies the 9 rotated-baseline firings as legacy-fallback and leaves
  all 10 default-config firings (genuine consensus reversals) firing unchanged.
- **`verdict` is now schema-validated at parse time.** A missing or out-of-enum
  `verdict` is a non-fatal `schema_warnings` entry (`verdict_missing_or_invalid`)
  rather than passing silently — the field is load-bearing for the polarity gate,
  and without it `extractVerdict` degrades to brittle claim-text regex parsing.

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
  at **chance** (within-Gemini AUC ≈ 0.50 — the only provider with contamination;
  0 of 28 real false-premise adoptions caught by the magnitude flag). Consequences:
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
- **Rotating silent-baseline selector (resolves B1 by removal).** The v0.7.1
  `silentAgent` selector existed to test whether baseline-confidence
  reproducibility was a protocol property — a question retired now that
  confidence is descriptive-only. Its wiring was never forked from production:
  with `silentAgent: alpha|beta` the harness handed Gamma *another agent's
  framed trace* labeled "YOUR OWN prior" (the known B1 cross-wiring), which
  also corrupted the polarity gate's baseline (9 of the 19 historical gate
  firings were rotated-mode cross-agent comparisons). The silent baseline is
  now **always a second Gamma draw** — required, since the consensus polarity
  gate uses it as co-witness. Exported traces keep `silentAgent: "gamma"` for
  schema stability; `classifyGammaPolarity()` retains the `visible_r1_only`
  fallback so legacy rotated-mode traces remain analyzable. The second Gamma
  call is a deliberate cost paid for the baseline-(in)stability metric; if
  accumulated data shows instability is rare/uninformative, that call is the
  designated future cost cut (noted in-code).

### Fixed
- **Detector analysis re-scores from raw traces + per-provider AUC**
  (`experiments/c1vc2/detector.js`). It previously read the `adopted`/`verdict`
  labels frozen into the result JSONs, which predate the scorer audit — so its
  `detector-results.json` reproduced the removed false positives (33 contaminated
  → **28** once re-scored; pooled AUC 0.439 → 0.381). More importantly, the
  pooled AUC is **provider-confounded**: all 28 contaminated instances are
  Gemini, so a pooled ROC compares one provider's positives against a
  mixed-provider negative pool. `detector.js` now re-scores from raw via
  `computeIPR` and reports a per-provider breakdown. The honest read is
  **within-Gemini AUC ≈ 0.50 (chance)**; GPT and Claude produced no contamination
  so their AUC is undefined. Also documents that the verdict-flip flag's ~100%
  recall is **definitional** (contamination is scored as a verdict shift) — its
  ~13% precision is the informative number. Conclusion (confidence drift is not a
  usable detector) is unchanged; the "below chance across models" framing was an
  artifact and is corrected in the README.
- **C1-vs-C2 scorer audit** (`src/lib/score.js`). Two artifacts found in the
  experiment's own scorer, not the protocol: (1) implicit adoption is
  structurally unmeasurable when a subject's baseline already equals the push
  direction — those instances were counted as non-adoptions, deflating IPR (33%
  of all-Gemini's instances affected; corrected measurable IPR 21.0%/10.5% vs.
  the previously reported 14.2%/7.1%); (2) marker-matching scored a subject as
  "adopting" a fallacy when it named the fallacy's marker phrase in the act of
  *refuting* it. Together these produced the program's only positive Δ
  (all-Claude, +0.017, built from 4 refutations) and GPT's reported 6/30
  true-premise "adoptions" (0 genuine). Both now correctly read 0. **H1 fails in
  every panel with zero exceptions post-fix.** `classifyAgent` now exposes an
  `eligible` flag; `computeIPR`/`summarizeCondition` report `ipr_eligible`
  alongside the raw rate. `stats.js` reports the measurable-only block. Battery
  markers (`injections-logical.json`) tightened to distinctive verbatim phrases.
  Full trail: `experiments/c1vc2/FINDINGS-audit.md`, `experiments/c1vc2/rescore.mjs`.
- **GPT truncation detection.** OpenAI's `finish_reason: "length"` is now mapped
  to the provider-neutral `"max_tokens"` value `safeParseTrace` checks (Gemini's
  equivalent was already mapped; Claude reports it natively). A truncated GPT
  response no longer misreports as a generic JSON parse error.
- **TF-IDF convergence smoothing.** `computeTFIDFCosine` used an unsmoothed IDF
  that zeroed terms shared by every agent, so identical R1 claims scored 0.0
  similarity instead of 1.0. Fixed to `log(N/df) + 1`; the pre-fix formula is
  preserved behind `{ smoothIdf: false }` so `arm-trace-v1.2` exports still
  reproduce exactly. **Schema bumped to `arm-trace-v1.3`.**
- **`GammaCard` rendered a failed reconciliation as success-green** with no
  failure detail. Now shows the same red failure panel `AgentCard` uses.
- **FAP-aborted runs (silent-baseline parse failure) were never auto-saved.**
  Now auto-save with a `-fap` filename suffix.
- **Polarity-gate audit now keys off the harness-computed delta**, not the
  model's self-report, for `confidence_delta_blindspot`. Self-report is kept
  alongside for comparison but no longer drives the flag.
- Removed the `VITE_ARM_ACCESS_TOKEN` build-time fallback in `src/api.js` —
  `VITE_`-prefixed vars are inlined into the static bundle, making this a latent
  token-leak risk. The proxy token now comes only from the UI field / `localStorage`.
- Minor: parse-failure sentinel unified to `"[PARSE FAILED]"`; non-JSON proxy
  error bodies no longer misreport as retryable network errors; `capLen` hard
  bound when the cap is smaller than its truncation marker; export blob URL
  revocation delayed to avoid a theoretical download race.

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
