# ARM-v0.9 — Agent Reasoning Markup

**Transparent Reasoning Propagation in Multi-Agent AI Systems**

Current multi-agent AI systems operate on a "black-box" communication model: they pass outputs to one another like text messages, discarding the intricate cognitive pathways that produced those outputs.

**ARM (Agent Reasoning Markup)** is a multi-agent reasoning transparency protocol designed to solve this. Instead of merely passing conclusions, agents share their full internal chain of thought — their assumptions, critical paths, discarded alternatives, confidence levels, and decision basis. This allows downstream agents to explicitly audit, challenge, and reconcile underlying logic, replacing unearned consensus with verifiable epistemic tightening.

> **Current version:** `v0.9` · `src/App.jsx` · Models: `claude-sonnet-4-6` · `gpt-5.5-2026-04-23` · `gemini-3.5-flash` (any agent slot can be assigned to any provider)

-----

## 🧠 The Problem: Persuasion Duality

ARM research centers on a structural vulnerability in multi-agent AI: the **Persuasion Duality**. While sharing explicit reasoning makes a model's logic auditable and robust, it simultaneously amplifies that agent's persuasive power over its peers. Without a calibration anchor, shared reasoning traces can cause **memetic drift** — where a plausible-sounding but flawed assumption propagates and compounds across agents into baseless consensus.

ARM is designed to detect and measure this drift before it becomes invisible.

---

## 🏗️ Protocol Architecture

ARM runs every question through a structured four-agent cognitive mesh across two deliberation rounds.

### Round 1 — Isolation (Zero Cross-Visibility)

Agents are dispatched **sequentially** to prevent API rate-limit collisions. Each reasons independently with no knowledge of peers.

| Agent | Role | Frame |
|---|---|---|
| **Alpha** | Reasoning agent | Configurable: `deontological`, `consequentialist`, or `independent` |
| **Beta** | Epistemic regulator | Configurable: same options; default `consequentialist` to oppose Alpha's default |
| **Gamma** | Independent prior | Unframed — reasons from first principles |
| **γ-Silent** | Calibration anchor | Completely isolated; never sees peers; anchors all drift math |

The γ-Silent baseline is **not shared** with any peer agent. It exists solely as Gamma's personal anchor for Round 2 self-delta computation.

### Round 2 — Deliberation (Adversarial Pressure Active)

Each agent receives **compressed** R1 traces from peers (key fields only — prevents token overflow while preserving the reasoning signal). Agents may update their position, but are instructed to resist pure convergence pressure and must declare what specifically moved them.

| Agent | Sees | Produces |
|---|---|---|
| **Alpha R2** | All R1 compressed traces | Updated claim + `drift_score.confidence_delta` + `drift_note` |
| **Beta R2** | All R1 compressed traces | Same; instructed to challenge Alpha's weakest assumption |
| **Gamma R2** | Alpha R2 + Beta R2 + γ-Silent baseline | Reconciliation + disagreement classification + RLHF bias audit |

### Reconciliation & Scoring

Gamma R2 produces the master output:

- **`disagreement_classification`** — `none` | `information` | `reasoning` | `values`
- **`agent_decision_bases`** — `utilitarian` | `deontological` | `hybrid` | `uncertain` for each agent
- **`rlhf_audit_notes`** — explicit audit: are agents agreeing because the logic is sound, or because shared RLHF safety training penalizes the alternative?
- **`self_delta_vs_baseline`** — Gamma R2 confidence minus γ-Silent confidence; the core calibration signal

---

## 🚀 Getting Started

### Prerequisites
- Node.js
- An Anthropic API key (Claude) — required
- An OpenAI API key (`gpt-5.5-2026-04-23`) — optional, for cross-model runs
- A Google Gemini API key (Gemini 3.5 Flash) — optional, for cross-model runs

### Installation

```bash
git clone https://github.com/socks5-sniffer/ARM-Protocol.git
cd ARM-Protocol
npm install
```

Create a `.env` file from the provided template (see `SECURITY.md` for key handling guidelines):
```bash
cp .env.example .env
```

Then fill in your keys:
```bash
ANTHROPIC_API_KEY=your_anthropic_key   # required
OPENAI_API_KEY=your_openai_key         # optional — needed for GPT agent role
GOOGLE_API_KEY=your_google_key          # optional — needed for Gemini agent role
```

Start the development server:
```bash
npm run dev
```

### Token Budget (current defaults)

| Stage | Budget | Rationale |
|---|---|---|
| R1 (all agents) | 5000t | Matched budgets for experimental consistency |
| R2 Alpha/Beta | 6500t | Full deliberation with drift note |
| Gamma R2 | 8000t | Safe ceiling for Gemini-3.5-flash's 8192 token hard output cap; requests above the cap fail silently rather than truncating |

All token budgets are configurable via environment variables (`VITE_TOKENS_R1`, `VITE_TOKENS_R2`, `VITE_TOKENS_GAMMA`).

### OpenShift Deployment

This repository includes production OpenShift artifacts:

- `Containerfile` — multi-stage image build (Node.js 20 UBI)
- `server.js` — production runtime serving `dist/` and proxying provider APIs
- `openshift/secret.example.yaml` — API key secret template
- `openshift/deployment.yaml` — app deployment
- `openshift/service.yaml` — internal service
- `openshift/route.yaml` — external HTTPS route

Build and push an image:

```bash
podman build -t quay.io/<org>/arm-protocol:latest -f Containerfile .
podman push quay.io/<org>/arm-protocol:latest
```

Update the image in `openshift/deployment.yaml`:

```yaml
image: quay.io/<org>/arm-protocol:latest
```

Deploy to OpenShift:

```bash
oc apply -f openshift/secret.example.yaml
oc apply -f openshift/deployment.yaml
oc apply -f openshift/service.yaml
oc apply -f openshift/route.yaml
```

Get the public URL:

```bash
oc get route arm-protocol
```

---

## 🖥️ UI Overview

The ARM interface is a dark-theme React app with monospace typography designed for trace inspection:

- **Question textarea** — editable at runtime, disabled during a run
- **Controls bar** — role injection toggle, Alpha/Beta frame selectors, rotating silent baseline selector
- **Real-time log** — timestamped sequential dispatch events
- **Round 1 grid** — 3-column AgentCard layout (Alpha, Beta, Gamma) + separate γ-Silent row
- **R1 convergence meter** — Jaccard lexical similarity; warns at > 0.4
- **Round 2 grid** — 2-column Alpha/Beta + full-width GammaCard
- **Drift Summary panel** — asymmetric threshold table for all agents + Gamma self-delta
- **Export JSON** — downloads full run telemetry as `arm-v0.9-run-{timestamp}.json`, sealed with a SHA-256 `export_integrity_hash`

Each AgentCard shows: claim, confidence %, drift direction + label, decision basis tag, flags, self-check status, and an expandable section for critical path, assumptions, challenge surface, challenged claims, and drift note.

The GammaCard prominently renders the RLHF bias audit in a distinct highlighted block.

---

## 📁 Repository Structure

```
/
├── .env.example               # Environment variable template
├── .github/workflows/         # CI + OWASP security scan workflows
├── CONTRIBUTING.md
├── LICENSE  ·  NOTICE
├── README.md
├── SECURITY.md
├── Containerfile              # Container image build
├── devfile.yaml               # Dev environment definition
├── index.html                 # Vite entry point
├── package.json
├── vite.config.js             # Dev server + provider proxy routes
├── server.js                  # Production Express proxy (keyed /api/*)
├── questions.json             # Question bank / presets
├── openshift/                 # OpenShift deployment manifests
├── gamma/                     # Gamma reliability test harness + data
├── src/                       # React app source
│   ├── App.jsx                # Protocol orchestrator — v0.9
│   ├── api.js                 # Provider transport (Claude / GPT / Gemini)
│   ├── config.js              # Models, token budgets, thresholds
│   ├── prompts.js             # Agent prompt builders
│   ├── main.jsx
│   ├── components/            # UI cards & section labels
│   ├── lib/                   # analysis, trace, sanitize, export helpers
│   └── test/                  # Vitest suite
└── trace/                     # Exported run telemetry (v0.6–v0.7.1 JSON + run write-ups)
```

> **Note:** `versions/` (archived protocol files), `data/` (research documents), and `delta_drift.py` (drift utilities) exist locally and are intentionally excluded from the public repository via `.gitignore`.

---

## 🤝 Contributing

ARM is an open-source research initiative. Priority contribution areas:

- **Cross-model pool testing** — Run the protocol with mixed model APIs and document convergence behavior
- **Adversarial question design** — Design questions specifically engineered to surface `values`-level disagreement
- **Zulu layer implementation** — Build the cross-session temporal drift auditing layer
- **Semantic convergence metric** — Replace lexical Jaccard with embedding-based similarity for more accurate prior-sharing detection

Please read `CONTRIBUTING.md` for code of conduct and pull request process.

---

## 🛡️ Security

Please review `SECURITY.md` for API key handling guidelines and vulnerability reporting.

---

## 🔭 Research Connections

ARM's mechanisms align with active AI safety research:

- **Persuasion Duality (arXiv:2509.21054)** — *Disagreements in Reasoning: How a Model's Thinking Process Dictates Persuasion in Multi-Agent Systems.* Coins the "Persuasion Duality": sharing reasoning makes an agent both more auditable and more persuasive.
- **STAR-XAI (arXiv:2509.17978)** — *The STAR-XAI Protocol: A Framework for Inducing and Verifying Agency, Reasoning, and Reliability in AI Agents.* Structured, verifiable agent reasoning for explainability.

ARM's contribution is a **working protocol** that measures the specific mechanisms by which multi-agent deliberation either improves or degrades reasoning quality — through reproducible quantitative signals rather than qualitative assessment.

---

## 🗺️ Roadmap

- ~~**Cross-model agent pools**~~ — **Implemented.** Per-agent provider selection (Claude / GPT-5.5 / Gemini 3.5 Flash) is live. Cross-model traces confirm the protocol functions correctly across all three providers.
- ~~**Self-check reconciler coverage**~~ — **Implemented (v0.9).** Deterministic override now covers both R1/R2 agent schema (`flags[]`) and the Gamma reconciler schema (`disagreement_classification` / `values_in_conflict`). No known self_check escapes remain.
- ~~**Matched-panel CFAAq2 factorial**~~ — **Completed (v0.9, 8/8 runs).** Full re-run on `claude-sonnet-4-6` / `gpt-5.5-2026-04-23` / `gemini-3.5-flash`. Results in `trace/v0.8/v0.8-CFAAq2-cross-provider-analysis.md`.
- **Adversarial question design** — Expanding the test battery to questions with genuinely irreconcilable positions; design questions specifically to force `disagreement_classification: values`
- **Zulu layer** — Cross-session temporal drift auditing (comparing the same question's outputs across separate sessions over time)
- **Phase 3 Re-Queue loop** — Automated correction flag written back into trace store when drift exceeds threshold
- **Formal publication / open-source release**

---

## 📄 License

This project is licensed under the Apache License, Version 2.0 — see `LICENSE` for details and `NOTICE` for attribution.

---

## 📊 Key Empirical Findings

Findings from ~100 runs across the full research arc (v0.3–v0.8); a representative subset is documented in `/trace`:

> **Model note (recent):** the cross-model agents now run a **matched mid/fast tier** panel — `claude-sonnet-4-6` · `gpt-5.5-2026-04-23` · `gemini-3.5-flash` — each provider's current fast default tier. This replaces the earlier `gpt-4o` / `gemini-2.5-pro` pairing, which mixed a retired non-reasoning OpenAI model with a one-generation-old Gemini and was **not tier-matched**; trace depth from those `gpt-4o` runs was capability-limited rather than provider-characteristic. Findings produced on the older models (including the CFAAq2 cross-provider study) should be treated as **pending re-run** on the matched panel before they are cited as tier-controlled. The trace files in `/trace` record the exact model used for each run.

### Epistemic Tightening is the Dominant Pattern

Across all clean runs (agents successfully parsed, no rate-limit failures):

| Pattern | Frequency | Interpretation |
|---|---|---|
| Epistemic tightening (Δ ≤ 0) | ~85% of agent-rounds | Peer exposure made agents more careful |
| Memetic drift (Δ > +0.04) | ~10% of agent-rounds | Flagged — peer pressure drove up confidence |
| No change | ~5% | Stable independent position |

Deliberation consistently produces more calibrated (lower confidence) outputs, not more confident ones. This is the intended behavior.

### Silent Baseline Reproducibility

The γ-Silent agent produces **identical confidence scores** across repeated runs on the same question:

| Question | Silent baseline confidence |
|---|---|
| AI lying (can AI lie to prevent harm?) | 0.720 — reproduced 5/5 runs |
| Autonomous vehicle trolley problem | 0.710 — reproduced 2/2 runs |
| Defense contractor whistleblower | 0.820 |
| Open-source AI frontier model release | 0.620 |

This reproducibility is a non-trivial finding for an LLM-based system. The silent baseline is a stable independent prior.

### Gamma Self-Delta by Question Type

| Question | γ-Silent confidence | Gamma self-delta | Interpretation |
|---|---|---|---|
| AI lying | 0.720 | -0.04 to -0.07 | Strong independent prior, modest correction |
| Whistleblower | 0.820 | -0.100 | Overconfident — over-weighted clear legal protection |
| Trolley problem | 0.710 | -0.100 to -0.160 | Largest correction — sensor reliability reclassified as defeater |
| Open-source AI | 0.620 | -0.100 | Empirically uncertain — deliberation surface adds genuinely new considerations |

Solo reasoning systematically overestimates certainty. Deliberation corrects it.

### Disagreement Classification Patterns

| Question type | Classification | Notes |
|---|---|---|
| Clear moral direction (whistleblower, cancer researcher) | `none` | Converged because the answer is clear, not because of bias |
| AI lying (genuine philosophical split) | `reasoning` | Deontological absolute vs. consequentialist exception |
| Open-source AI (empirically underdetermined) | `information` | Agents shared values but lacked empirical data |
| Adversarial role injection (Runs 12–13, AI deception question) | `values` | Triggered by hard-coded adversarial frames; cross-model pools expected to surface this more frequently |

The classifier correctly distinguishes *consensus because the answer is clear* from *consensus because agents share training priors*.

### Memetic Drift Examples

Detected and flagged in ~10% of agent-rounds:

- **Run 1, Alpha:** +0.060 — moved from cautious non-binary position to categorical prohibition after reading Beta/Gamma
- **Run 2, Beta:** +0.060 — entered with permissive framing, jumped after seeing Gamma's harder line
- **Run 4, Beta:** +0.060 — same mechanism, explicitly acknowledged convergence in drift_note

The drift target rotates across runs (different agents drift on different sessions), but the mechanism is consistent. The system correctly flags it each time.

### Rate-Limit Failure Diagnosis (v0.5 → Fixed)

Early runs dispatched all 4 R1 agents concurrently, causing HTTP 429 rate-limit failures (~1 agent/run). The silent failure was **masking the true convergence signal** — failed agents have no R1 position to defend in R2, causing them to anchor to peers (epistemic contamination). **Fix:** Sequential R1 dispatch. First fully clean run produced convergence = 0.402 — higher than any prior partial run, confirming that prior convergence numbers were systematically underestimating shared-priors signal.

---

## 🗂️ JSON Trace Schema

Every agent in every round produces a structured JSON trace:

```jsonc
{
  "claim": "core conclusion",
  "confidence": 0.0–1.0,
  "reasoning_frame": "deontological | consequentialist | independent",
  "decision_basis": "utilitarian | deontological | hybrid | uncertain",
  "assumptions": ["explicit list"],
  "critical_path": ["ordered reasoning steps"],
  "discarded_paths": [{ "path": "string", "reason": "string" }],
  "challenge_surface": ["things that could invalidate this conclusion"],
  "flags": ["values_conflict | contested_domain | incomplete_data | assumption_heavy"],
  "self_check": {
    "status": "clean | warning | auto_warn",
    "notes": "string",
    // When status was overridden by the harness (clean → auto_warn):
    "self_check_overridden": true,
    "self_check_original_status": "clean",
    "override_reason": "values_tension_flag | reconciler_values_disagreement"
  },
  // R2 agents also include:
  "influenced_by": ["agent ids that changed reasoning"],
  "challenged": ["specific claims explicitly rejected"],
  "drift_note": "what changed from R1 and why",
  "drift_score": { "confidence_delta": number }
}
```

Gamma R2 adds:
```jsonc
{
  "disagreement_classification": "none | information | reasoning | values",
  "disagreement_notes": "string",
  "agent_decision_bases": { "alpha": "...", "beta": "..." },
  "values_in_conflict": ["named values if classification is values"],
  "rlhf_audit_notes": "string",
  "self_delta_vs_baseline": number,
  "reconciliation_status": "success | failed",
  // schema_version: "arm-trace-v1.2" (written to runMeta.schema_version)
}
```

---

## 📜 Version History

### v0.9 — Reconciler Coverage & Matched-Panel Validation

#### 1. Self-Check Override Extended to Reconciler Schema

The deterministic `clean` → `auto_warn` override previously keyed on the agent's `flags[]` array (carrying `values_conflict` / `contested_domain`). The Gamma reconciler has no `flags[]` field — it declares values tension structurally via `disagreement_classification: "values"` and `values_in_conflict: [...]`. A reconciler could self-report `clean` while simultaneously publishing a values disagreement, leaving the escape invisible to the existing override.

v0.9 closes this. The override now fires on either schema shape:

| Shape | Carried by | Trigger |
|---|---|---|
| `flags[]` contains `values_conflict` / `contested_domain` | R1/R2 agents | `override_reason: "values_tension_flag"` |
| `disagreement_classification == "values"` **or** non-empty `values_in_conflict[]` | Gamma reconciler | `override_reason: "reconciler_values_disagreement"` |

Both paths preserve `self_check_original_status: "clean"` for forensic tracing. This closes the last known self_check escape.

#### 2. Trace Schema `arm-trace-v1.2`

`override_reason` is added to the self_check object when the override fires. Backward-compatible additive change. Schema version bumped from `arm-trace-v1.1` → `arm-trace-v1.2`.

#### 3. TOKENS_GAMMA Corrected to Safe Flash Ceiling

`TOKENS_GAMMA` reduced from 12,000 to **8,000** — the safe ceiling for Gemini-3.5-flash's 8,192 token hard output cap. The inflated value caused Gemini monoculture Gamma R2 reconciler calls to fail silently (Gemini rejects requests exceeding its output cap rather than truncating). Cross-model runs were unaffected because Gemini Gamma R2 outputs in those configurations stayed well below 8,000 tokens.

#### 4. CFAAq2 Matched-Panel Factorial Completed (8/8 runs)

The full CFAAq2 factorial has been re-run on the matched mid/fast tier panel. All prior results on the mismatched panel (`gpt-4o` / `gemini-2.5-pro`) are superseded. See `trace/v0.8/v0.8-CFAAq2-cross-provider-analysis.md` for the complete comparison. Headline finding: `gpt-5.5-2026-04-23` produces dramatically more deliberative output than the retired `gpt-4o` it replaced — the all-GPT monoculture convergence dropped from 0.810 to 0.235.

---

### v0.8 — Enforcement Surfaces

v0.8 closes the gap the white paper identified: reconciliation success no longer automatically means genuine reconciliation. Detection signals became enforcement surfaces, validated against known-positive runs.

#### 1. Polarity Gate
Detects when Gamma's claim *direction* (YES/NO) flips between R1 and R2. Magnitude-based drift detection can't see this: a run can hold identical confidence across baseline and R2 while fully reversing its conclusion. When the gate fires:

- `reconciliation_status` is overridden to `"gamma_flip_detected"` — a flipped run can never report success
- `self_check.status` is forced to `"warning"`, preserving Gamma's original self-report verbatim as a forensic record
- A `polarity_audit` block is written to the trace, including `confidence_delta_blindspot` (true when the flip was invisible to every magnitude detector) and `requires_manual_review: true` — a machine-readable signal that downstream automation must not consume the reconciliation as authoritative
- The UI surfaces an amber **MANUAL REVIEW REQUIRED** badge on the Gamma card

#### 2. FAP Circuit Breaker (was: smoke alarm)
The Fallback Audit Protocol now acts pre-reconciliation. When Alpha or Beta's R2 confidence delta exceeds +0.04, the agent is re-dispatched in **full isolation** (peer traces masked, only its own R1 prior visible). The requeue result classifies the drift:

- Confidence drops > 0.02 in isolation → `"memetic"` — the R2 position was peer-borrowed
- Confidence holds → `"epistemic"` — genuine information gain

Validated: an agent that flipped YES→NO under peer pressure reverted to YES in isolation — full claim reversal plus confidence drop, classified memetic.

#### 3. Gamma Drift Forensic Flag
`gamma_drift_exceeded` fires post-reconciliation when Gamma's `self_delta_vs_baseline` exceeds +0.04. Distinct from FAP (preventive, Alpha/Beta) — this is a forensic flag on the reconciler itself.

#### 4. Export Integrity Hash
Every exported run is sealed with a SHA-256 `export_integrity_hash` computed over the payload. To verify independently: remove the `export_integrity_hash` field, serialize the remaining object with `JSON.stringify(payload, null, 2)` (2-space indent, UTF-8), and SHA-256 hash the result. The implementation hashes exactly this representation, so verification must replicate the same serialization.

---

### v0.7.1 (Run 16)

`src/App.jsx` introduces five protocol upgrades informed by cross-model review (Gemini + GPT recommendations):

#### 1. Asymmetric Drift Thresholds
Previous versions used a symmetric ±0.05 memetic drift flag. v0.7.1 splits this:

| Threshold | Direction | Label | Interpretation |
|---|---|---|---|
| Δ > **+0.04** | Up | ⚠ memetic drift | Confidence increased from peer pressure — flagged |
| **0 ≥ Δ > -0.15** | Down | epistemic tightening | Healthy calibration |
| Δ < **-0.15** | Deep down | deep tightening | Extreme calibration — noted separately |

Tightening (downward drift) is healthy; only upward drift is the threat. The threshold was tightened from 0.05 → 0.04 to be more sensitive.

#### 2. Rotating Silent Baseline
Previously γ-Silent was always Gamma. v0.7.1 adds a UI selector:

```
Silent baseline: [ gamma (default) | alpha (rotating test) | beta (rotating test) ]
```

This validates that the 0.720 reproducibility finding is a **protocol property**, not a Gamma artifact. If Alpha or Beta running silent produces the same baseline confidence, the signal is model-level, not agent-role-level.

#### 3. `decision_basis` Field on All Agents
Every agent (Alpha, Beta, Gamma, γ-Silent) now explicitly declares:
```
"decision_basis": "utilitarian | deontological | hybrid | uncertain"
```
This enables direct validation of Gamma's `disagreement_classification`. Previously Gamma inferred decision basis from reasoning traces; now agents self-report, allowing the classification to be cross-checked against declared intent.

#### 4. RLHF Bias Audit in Gamma R2
Gamma R2 now contains a required `rlhf_audit_notes` field with an explicit structured question:

> *"Are Alpha and Beta agreeing because the logic is sound, or because our shared RLHF safety training heavily penalizes the alternative conclusion?"*

This is rendered as a distinct yellow-highlighted section in the UI, making shared-training bias a first-class auditable signal rather than an implicit concern.

#### 5. Role Injection Toggle
A UI checkbox enables/disables ethical frame injection for Alpha and Beta. When disabled, both agents reason `independent` — useful for comparing framed vs. unframed deliberation to isolate how much of the final output is driven by the assigned framework versus the model's base priors.

---

*ARM v0.9 · Protocol designed and tested by a self-taught developer.*  
*~100 experimental runs across the research arc · Current panel: claude-sonnet-4-6 / gpt-5.5-2026-04-23 / gemini-3.5-flash · Earlier runs used gpt-4o / gemini-2.5-pro (mismatched tier — see CFAAq2 analysis) · Research ongoing.*
