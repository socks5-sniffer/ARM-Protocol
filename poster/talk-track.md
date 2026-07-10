# DEF CON 34 AI Village — poster talk track

For the 1-hour slot, standing with the 65" screen. Two lengths: the **60-second
hook** for someone walking past, and the **5-minute walkthrough** for someone who
stops. Openers differ by poster variant; the spine is the same.

Every number here is on the poster and derives from `poster/poster-data.json`
(regenerate: `node poster/data.mjs`). If someone challenges a number, the answer
is always: *the scorer, the stats, and the audit trail are in the repo — run
`node experiments/c1vc2/rescore.mjs` yourself.*

---

## The 60-second hook

**Opener — pick the line that matches the chosen variant:**

- **A:** "Everyone assumes that if agents share their chain-of-thought, a
  poisoned thought spreads further. We pre-registered that hypothesis and tried
  hard to confirm it. It's dead — showing the reasoning *protected* the panel."
- **B:** "Want to know how poisonable your multi-agent system is? Don't audit
  the architecture. Ask one question: which model sits in the trust seat?"
- **C:** "Our own contamination detector — the thing our protocol was built
  around — scored *below chance* against ground truth we authored ourselves. So
  we retired it in public. Here's what survived."

**Then the spine (same for all variants):**

> We built a multi-agent deliberation protocol where agents share full reasoning
> traces. To test whether that's an attack surface, we planted logical fallacies —
> not fake facts, invalid *inferences* — into one agent's trace, and measured
> whether peers adopted them under two regimes: seeing only the conclusion, or
> seeing the full reasoning. Because *we* authored the fallacies, ground truth is
> known — no judgment calls. Pre-registered, four panel compositions, 954 paired
> instances, three model families.
>
> Three results. One: full reasoning **never** amplified propagation — the only
> significant effect was protective. Two: susceptibility is a per-model constant —
> Gemini Flash adopts at 21% whether it's in a mixed panel or a monoculture; GPT
> and Claude sit at zero. Your panel is exactly as poisonable as the model in its
> trust seat. Three: our confidence-drift detector failed falsification at
> AUC 0.44 — the signal that works is behavioral: did the verdict *flip*?

**Close:** "The scorer, the stats, the audit that killed our own best-looking
result — all open-source. Scan the QR."

---

## The 5-minute walkthrough

**1. The setup (45s).**
ARM is a protocol where agents expose assumptions, reasoning steps, and
confidence to each other instead of bare answers. The obvious worry — we called
it the Persuasion Duality — is that transparent reasoning is *persuasive*
reasoning: a planted false premise rides the trace into the panel's consensus.
Instead of arguing about it, we made it falsifiable: author a fallacious trace
(Pascalian unbounded-harm, false dilemma, act/omission collapse, five more, plus
one *sound* argument as the control), inject it as a peer's round-1 position,
and score adoption against each subject's own isolated baseline. Point at the
method strip: pre-registered before the confirmatory runs existed; 15 reps; the
same question battery for every panel.

**2. The headline chart (60s — adapt to variant).**
- *Forest plot (A):* every panel's Δ sits at or left of zero. The one
  significant result is all-Gemini at Δ = −0.105, p ≈ .01 — showing the
  reasoning *halved* adoption, because a visible argument can be challenged
  while a bare confident conclusion can only be conformed to. The "efficient"
  conclusion-only design is the riskier one.
- *Constancy bars (B):* Gemini adopts at 21.0% in the mixed panel and 21.0% in
  its own monoculture — identical to three decimals. GPT ~0, Claude 0. No echo
  bonus, no dilution: composition doesn't move a model's number. The design rule
  falls out directly: never seat a fast-tier model as reconciler, vote member,
  or summarizer, because its adoptions become the panel's output.
- *ROC (C):* ground truth is authored, so this is a real ROC, not a vibe. The
  confidence-drift signal — magnitude of self-reported confidence change — runs
  *below* the chance diagonal (AUC 0.44) and catches 0 of 33 contaminations at
  its operating point. The verdict-flip gate catches 30 of 33 at 14% precision:
  cheap, behavioral, and it's what ARM ships with now.

**3. The mechanism story (90s).**
The true-premise control is the poster's quiet star. Same injection machinery,
but the planted argument is *sound*. That one line splits the three families:
- **Gemini** updates toward the true premise 20/30 — with real verdict moves.
  It's not broken, it's *credulous*: it believes what it reads, true or false.
- **GPT** updates 0/30 — it declines to move even for a sound argument, while
  writing critique text on every instance. Its zero adoption isn't truth
  discrimination; it's a no-update house policy. Robust and unpersuadable are
  the same behavior here.
- **Claude** adopted nothing anywhere — 0 in 480 instances — but honesty
  requires the asterisk: its baseline already agreed with the true premise in
  all 30 control instances, so its truth-updating cell is blind by design.

If pressed on "which model should I use": the data says robustness and
epistemic responsiveness trade off — pick per seat, and put the skeptic or the
discriminator where trust concentrates.

**4. The self-falsification arc (60s — lead with this on variant C).**
Two instruments died in public. The confidence-drift detector failed the ROC.
Then a full scorer audit killed our only "transparency is dangerous" result:
all-Claude's Δ = +0.017 was four *refutations* mislabeled as adoptions — the
marker matched the fallacy's own name while Claude was rejecting it. And a
third of Gemini's instances were structurally blind (baseline already at the
pushed verdict), so its raw 14% understated true susceptibility — corrected,
21%. Every correction made the headline claims *stronger*, which is what an
honest audit looks like. Scorer patch, re-scoring script, and the pre/post
tables are all in the repo.

**5. The one caveat we volunteer (30s).**
One fallacy leaks everywhere it's measurable: Pascalian unbounded-harm —
"unbounded harm dominates any probability." It's the only injection that spread
*more* under full reasoning (Gemini 2→12), and even Claude had to name it to
refute it. The Persuasion Duality isn't wholly dead — it survives as this one
argument shape. If you're hardening a panel, start there.

---

## Likely questions, short answers

- **"Isn't n=33 contaminations small for an ROC?"** Yes — that's why we report
  the operating points with raw counts and publish the full curve. The AUC
  conclusion (at/below chance) is robust to that n; a great detector would not
  score 0.44.
- **"Did subjects ever read each other?"** No — subjects read only the authored
  target. Subject-to-subject echo is explicitly out of scope; the monoculture
  result rules out composition effects in *this* design, not social cascades.
- **"Why logical fallacies instead of fake facts?"** Fake facts hit a floor
  effect — frontier models flag unverifiable claims on sight. Invalid inference
  has no checkable fact to reject; it's the propagating class.
- **"Is 21% a lot?"** In a seat whose output becomes the panel's answer, one in
  five poisoned deliberations is the panel's poisoning rate. That's the point of
  the trust-seat framing.
- **"Claude looks perfect — conflict of interest?"** The battery and scorer are
  open; Claude's truth-updating cell is blind and we say so on the poster. Its
  zero is real but bounded: never adopted falsehood ≠ shown to discriminate.
- **"What's ARM itself?"** A reasoning-transparency protocol (v0.9): structured
  traces, adversarial round-2 deliberation, a reconciler with a verdict-flip
  gate, injection-hardened peer-trace sharing. The poster is its red-team.
