# ARM — Slide-by-Slide Red Team

A self-administered adversarial review. Each "slide" is one claim ARM currently
makes, the attack a competent DEF CON AI Village audience will mount against it,
the severity, and the concrete fix that turns the weakness into a defensible
result.

Use this two ways: (1) as a defense-prep doc so no question catches you flat at
the poster, and (2) as a punch-list. A claim you can't yet defend is a claim you
either fix or delete before it goes on a 65" screen.

Severity legend: **FATAL** (sinks the project if unanswered) · **MAJOR**
(undermines a headline finding) · **MINOR** (credibility nick).

---

## Slide 0 — The framing problem (read this first)

**ARM currently claims:** a transparency protocol that makes multi-agent ethical
deliberation more calibrated and auditable.

**Attack:** This is an AI-safety/eval project wearing a security costume (CFAA
scenarios, OpenShift, an "integrity hash"). The AI Village theme is *adversarial
attacks against agents*. As pitched, ARM is off-theme and, worse, unfalsifiable —
it scores moral questions that have no ground truth.

**Severity:** FATAL (as currently framed).

**Fix:** Re-aim. The defensible project is *"Does sharing reasoning traces
amplify the propagation of injected false reasoning through a multi-agent
system?"* Same code, on-theme, falsifiable. Everything below assumes this pivot.
Details in `MAKING-ARM-FALSIFIABLE.md`.

---

## Slide 1 — "Deliberation produces more calibrated outputs"

**Claim:** 85% of agent-rounds show "epistemic tightening" (Δ confidence ≤ 0);
solo reasoning overestimates certainty, deliberation corrects it.

**Attack:** You wrote the result into the prompt. `prompts.js:94` and `:122`
instruct every R2 agent: *"A negative confidence_delta is healthy. A positive
delta > 0.04 requires explicit justification."* You told the subject the
hypothesis and the subject confirmed it. The 85% is a demand effect, not a
finding.

**Severity:** FATAL for this finding.

**Fix:** Delete the instruction. Re-run. If tightening survives a neutral prompt,
it's real and you can defend it. If it vanishes, you have an honest and
*publishable* negative result ("a common deliberation prompt induces the
calibration it claims to measure"). Either outcome is a poster. Pre-register
which you expect.

---

## Slide 2 — "Confidence" is the load-bearing number and it's uncalibrated

**Claim:** drift, self-delta, the 0.720 baseline, the whole scoring layer.

**Attack:** *"Show me the calibration plot. When an agent says 0.74, is it right
74% of the time?"* There is no calibration curve, no Brier score, no oracle
anywhere in the repo. You measure the drift of a number with no operational
meaning.

**Severity:** FATAL for any quantitative claim built on raw confidence.

**Fix:** Two options, do both. (a) Demote confidence from *the* metric to a
secondary signal; make the primary metric **behavioral — did the target agent
adopt the injected claim?** That's objectively scorable. (b) If you keep
confidence, validate it on a factual-QA set with known answers and publish the
reliability diagram. Calibrated → drift means something. Not calibrated → say so
and lean on behavioral metrics.

---

## Slide 3 — "Silent baseline reproduces 5/5 — a stable independent prior"

**Attack:** That's just deterministic decoding. Same prompt at low temperature
returns the same token, including "0.720." Three-significant-digit reproduction
is what greedy sampling *does*; it is not evidence of a deep epistemic property.

**Severity:** MAJOR (oversold finding).

**Fix:** Report the decoding temperature. Test the real version of the claim:
does the baseline reproduce **across paraphrases of the same question** and
**across temperatures > 0**? Reproduction under semantic-preserving perturbation
would be a genuine (and much stronger) result. Stop citing temp-0 determinism as
a discovery.

---

## Slide 4 — "Coherent moral distinction emerging independently across 3 model families"

**Claim:** the Q201/Q203 third-party-harm finding.

**Attack:** Claude, GPT, and Gemini share training corpora and RLHF norms. They
are *correlated* estimators, not independent witnesses. "Independently across
three families" could just be the same internet-scale moral consensus reflected
three times. Three mirrors aren't three witnesses — and this is the exact
monoculture failure ARM claims to detect.

**Severity:** MAJOR.

**Fix:** Drop "independent." You cannot establish independence and shouldn't
imply it. Reframe as a *correlation* finding ("three RLHF-trained families share
this boundary"), which is still interesting, or test it adversarially: inject the
*opposite* moral premise and measure whether all three resist equally. Shared
resistance to a planted counter-premise is far stronger evidence than shared
spontaneous agreement.

---

## Slide 5 — The RLHF audit

**Claim:** `rlhf_audit_notes` makes shared-training bias a first-class auditable
signal.

**Attack:** You're asking an RLHF-trained model to introspect on its own RLHF
conditioning — the fish describing water. Self-report of bias is not measurement
of bias. The frozen cysec trace proves it: *"primarily logic-driven but RLHF
amplification cannot be fully ruled out."* That's an unfalsifiable hedge in a
yellow box.

**Severity:** MAJOR (it's theater as currently built).

**Fix:** Replace introspection with a behavioral probe. RLHF bias is *measurable*
externally: present the same dilemma with the safety-coded option relabeled, or
A/B the conclusion's framing, and measure whether the verdict tracks the
safety-coding rather than the logic. That's an experiment, not a self-report.
Keep the field only if it's backed by a measurement.

---

## Slide 6 — The protocol manufactures the disagreement it measures

**Attack:** Your own `FINDINGS-q201-q203.md` admits the deontological role is a
"NO-generator" producing dissent *"the underlying model does not actually
endorse,"* which then pressures peers in R2. So you inject a strawman, watch it
persuade, and report it as Persuasion Duality. That's a confound you documented
as a feature.

**Severity:** MAJOR — but it's secretly the path to the fix.

**Fix:** Stop treating the injected position as a confound and start treating it
as **the independent variable**. A planted position whose ground-truth validity
you control *is* the experiment (Slide 9 / the falsifiability doc). You were
already doing injection; just make it deliberate, labeled, and scored.

---

## Slide 7 — Convergence = word overlap

**Attack:** `computeConvergence` is Jaccard over claim tokens >4 chars. Agents
can fully agree in different words (false "no convergence") or share boilerplate
while disagreeing on the verdict (false "convergence"). Your headline numbers
(0.402, 0.235, 0.810) use a metric your own README admits is inadequate
(embedding metric is on the roadmap).

**Severity:** MAJOR.

**Fix:** You already added `computeTFIDFCosine`; finish the job with an embedding
cosine over claims and, more importantly, **separate "agreement on the verdict"
from "similarity of wording."** Verdict agreement is a discrete label
(YES/NO/conditional) you can score directly — that's what actually matters and it
sidesteps the lexical-metric debate entirely.

---

## Slide 8 — The polarity gate is regex

**Attack:** `extractClaimDirection` decides YES/NO by string-matching `^no`,
`should not`, `should`. "Should not act unless X, in which case it should" breaks
it — and a brittle parse gates the `gamma_flip_detected` override that "can never
report success." Fragile foundation under an enforcement surface.

**Severity:** MINOR-to-MAJOR (it gates an enforcement path).

**Fix:** Replace the regex with a structured field: require every agent to emit
`verdict: "yes" | "no" | "conditional"` as a first-class schema field, separate
from the prose claim. Validate it. Now the gate keys on a declared value, not a
string match.

---

## Slide 9 — No control, no ablation: is the machinery earning its keep?

**Attack:** *"Does the 4-agent / 2-round mesh beat one model told to argue both
sides and then hedge?"* There's no comparison against (a) single-model
self-critique, (b) majority vote, (c) conclusion-only sharing. Without a control,
you can't show the apparatus contributes anything over "ask a good model to be
careful."

**Severity:** FATAL for any "ARM works" claim.

**Fix:** Build the ablation ladder explicitly (single model → self-critique →
conclusion-only sharing → full-trace sharing). The *difference between
conclusion-only and full-trace sharing is literally the Persuasion Duality
effect size.* That comparison is your single most important experiment and your
poster's money result.

---

## Slide 10 — The export integrity hash

**Attack:** SHA-256 over a payload the producer fully controls proves only that
the file wasn't edited *after* export. Zero provenance, zero protection against
fabrication by the party who made it. Marketed as "integrity"; it's a checksum.

**Severity:** MINOR (but a security crowd will pounce).

**Fix:** Call it what it is — a tamper-evidence checksum for archived runs — and
stop implying it's a trust primitive. If you want real provenance, sign with a
key the verifier trusts, or commit hashes to an append-only public log. Otherwise
downscope the claim.

---

## Slide 11 — Statistics

**Attack:** ~100 runs across versions v0.3–v0.8 with the **model panel changing
mid-study** (your README supersedes the entire CFAAq2 study). No significance
tests, no CIs, no held-out set, no inter-rater reliability on the disagreement
labels. "85% / 10% / 5%" with no error bars.

**Severity:** MAJOR.

**Fix:** Freeze the panel. Freeze the question set. Pre-register hypotheses.
Power-analyze n per cell. Report effect sizes with CIs and a permutation test for
between-condition differences. Automate the propagation/verdict scoring with a
rubric so it's reproducible, and report the rubric's agreement with a human spot
check.

---

## Slide 12 — Citations and forward-dated model IDs

**Attack:** Someone in the front row will pull up `arXiv:2509.21054` /
`arXiv:2509.17978` and the `gpt-5.5-2026-04-23` snapshot ID live. If a paper
doesn't say what you claim, or an ID doesn't resolve, credibility evaporates in
one slide.

**Severity:** MINOR but lethal if wrong.

**Fix:** Verify every citation actually exists and supports the specific sentence
that cites it. Pin exact model snapshot IDs you have actually run and can
reproduce. Put the exact model string next to every number.

---

## Slide 13 — What survives (lead with these, don't hide them)

These are genuinely defensible — anchor the poster on them:

- **`harness_confidence_delta` cross-check** vs the model's self-reported delta:
  real verification, not vibes.
- **Isolation → deliberation** structure: sound experimental scaffold.
- **Rotating silent baseline**: correct instinct for separating protocol-level
  from role-level effects.
- **Documented confounds**: the role-as-NO-generator admission is the kind of
  honesty weaker projects bury. It's also your experiment in disguise.

---

## The one question that does the most damage

> *"You never measure whether any answer is correct. You measure whether a
> self-reported confidence number — which you instructed the models to push
> downward — moves downward. What is the ground truth, and what would falsify the
> claim that deliberation improves reasoning?"*

Everything in this deck is downstream of that question. The falsifiability
redesign exists to give you an answer to it. Until you can answer it on stage,
that question ends the conversation.
