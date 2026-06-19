// SPDX-License-Identifier: Apache-2.0
import { useState } from "react";

import {
  PROVIDER_LABEL,
  PROVIDER_MODEL,
  TOKENS_R1,
  TOKENS_R2,
  TOKENS_GAMMA,
  DRIFT_UP_THRESHOLD,
  DRIFT_DOWN_THRESHOLD,
  DEFAULT_QUESTION,
  ARM_VERSION,
} from "./config.js";
import {
  buildAlphaR1,
  buildBetaR1,
  buildSilentBaselinePrompt,
  buildAlphaR2,
  buildBetaR2,
  GAMMA_R1_SYSTEM,
  SYSTEM_GAMMA_R2,
} from "./prompts.js";
import { callProvider, computeEmbeddingCosine } from "./api.js";
import {
  safeParseTrace,
  computeConvergence,
  computeTFIDFCosine,
  compressTrace,
  annotateAgentDrift,
  harnessDelta,
  deltaMismatch,
} from "./lib/trace.js";
import { sanitizeDeep, PEER_GUARD, questionBlock } from "./lib/sanitize.js";
import { driftLabel, extractClaimDirection } from "./lib/analysis.js";
import { C, f } from "./theme.js";
import { AgentCard } from "./components/AgentCard.jsx";
import { GammaCard } from "./components/GammaCard.jsx";
import { exportJSON, EXPORT_SCHEMA_VERSION } from "./lib/exportTrace.js";
import { buildFilename, saveTrace } from "./autoSave.js";

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function ARM() {
  const [question, setQuestion]             = useState(DEFAULT_QUESTION);
  const [questionId, setQuestionId]         = useState("200");
  const [roleInjection, setRoleInjection]   = useState(true);
  const [silentAgent, setSilentAgent]       = useState("gamma"); // rotating baseline
  const [alphaFrame, setAlphaFrame]         = useState("deontological");
  const [betaFrame, setBetaFrame]           = useState("consequentialist");
  const [alphaProvider, setAlphaProvider]   = useState("claude");
  const [betaProvider, setBetaProvider]     = useState("gpt");
  const [gammaProvider, setGammaProvider]   = useState("gemini");
  const [status, setStatus]                 = useState("idle");
  const [log, setLog]                       = useState([]);
  const [r1, setR1]   = useState({ alpha: null, beta: null, gamma: null, silent: null });
  const [r2, setR2]   = useState({ alpha: null, beta: null, gamma: null });
  const [convergence, setConvergence]           = useState(null);
  const [tfidfConvergence, setTfidfConvergence] = useState(null);
  const [embedConvergence, setEmbedConvergence] = useState(null);
  const [runMeta, setRunMeta]                   = useState(null);
  const [accessToken, setAccessToken] = useState(() => {
    try {
      return (typeof localStorage !== "undefined" && localStorage.getItem("arm_access_token")) || "";
    } catch {
      return "";
    }
  });

  const updateAccessToken = (val) => {
    setAccessToken(val);
    try {
      if (typeof localStorage !== "undefined") localStorage.setItem("arm_access_token", val);
    } catch {
      /* localStorage unavailable — token stays in memory for this session only */
    }
  };

  const addLog = (msg) => setLog((l) => [...l, `[${new Date().toLocaleTimeString()}] ${msg}`]);

  const run = async () => {
    setStatus("running");
    setLog([]);
    setR1({ alpha: null, beta: null, gamma: null, silent: null });
    setR2({ alpha: null, beta: null, gamma: null });
    setConvergence(null);
    setTfidfConvergence(null);
    setEmbedConvergence(null);
    setRunMeta(null);

    try {

    const startTime = Date.now();
    const frames = roleInjection
      ? { alpha: alphaFrame, beta: betaFrame }
      : { alpha: "independent", beta: "independent" };
    const providers = {
      alpha: alphaProvider,
      beta:  betaProvider,
      gamma: gammaProvider,
    };
    const silentProvider = providers[silentAgent];
    // Provider keys are validated server-side; a missing key surfaces as an API
    // error on the first call rather than a client-side pre-flight check.

    addLog(`ARM v${ARM_VERSION} · role_injection:${roleInjection} · silent_baseline:${silentAgent}`);
    addLog(`Providers · alpha:${providers.alpha} beta:${providers.beta} gamma:${providers.gamma}`);
    addLog(`Question: "${question.slice(0, 80)}..."`);
    addLog("R1 — sequential isolation (zero cross-visibility)");

    // ── R1: Alpha ─────────────────────────────────────────────────────────────
    addLog(`  → dispatching Alpha R1 [${frames.alpha}] via ${PROVIDER_LABEL[providers.alpha]}...`);
    const resA1 = await callProvider(providers.alpha, buildAlphaR1(frames.alpha), questionBlock(question), TOKENS_R1);
    const pA1 = safeParseTrace(resA1, "alpha");
    setR1((prev) => ({ ...prev, alpha: pA1.trace }));
    addLog(`  → Alpha R1: ${pA1.ok ? "ok" : "FAIL"} · ${pA1.trace._meta?.provider || "?"}/${pA1.trace._meta?.model || "?"} · confidence: ${pA1.trace.confidence ?? "?"} · basis: ${pA1.trace.decision_basis ?? "?"}`);

    // ── R1: Beta ──────────────────────────────────────────────────────────────
    addLog(`  → dispatching Beta R1 [${frames.beta}] via ${PROVIDER_LABEL[providers.beta]}...`);
    const resB1 = await callProvider(providers.beta, buildBetaR1(frames.beta), questionBlock(question), TOKENS_R1);
    const pB1 = safeParseTrace(resB1, "beta");
    setR1((prev) => ({ ...prev, beta: pB1.trace }));
    addLog(`  → Beta R1: ${pB1.ok ? "ok" : "FAIL"} · ${pB1.trace._meta?.provider || "?"}/${pB1.trace._meta?.model || "?"} · confidence: ${pB1.trace.confidence ?? "?"} · basis: ${pB1.trace.decision_basis ?? "?"}`);

    // ── R1: Gamma (visible) ───────────────────────────────────────────────────
    addLog(`  → dispatching Gamma R1 [independent] via ${PROVIDER_LABEL[providers.gamma]}...`);
    const resG1 = await callProvider(
      providers.gamma,
      GAMMA_R1_SYSTEM,
      questionBlock(question),
      TOKENS_R1
    );
    const pG1 = safeParseTrace(resG1, "gamma");
    setR1((prev) => ({ ...prev, gamma: pG1.trace }));
    addLog(`  → Gamma R1: ${pG1.ok ? "ok" : "FAIL"} · ${pG1.trace._meta?.provider || "?"}/${pG1.trace._meta?.model || "?"} · confidence: ${pG1.trace.confidence ?? "?"}`);

    // ── R1: Silent Baseline (rotating) ────────────────────────────────────────
    // TODO(B1): when silentAgent is alpha/beta, this framed silent trace is later
    // presented to Gamma as "YOUR OWN prior", so harness_self_delta_vs_baseline
    // becomes a cross-agent delta rather than a true self-delta. Known bug — out of
    // scope for this PR (deterministic-drift). Do not rely on rotated self-delta.
    addLog(`  → dispatching Silent Baseline [${silentAgent}] via ${PROVIDER_LABEL[silentProvider]} (no peer exposure)...`);
    const silentQ = questionBlock(question);
    const silentFrame = silentAgent === "alpha" ? frames.alpha : silentAgent === "beta" ? frames.beta : "independent";
    const resSilent = await callProvider(silentProvider, buildSilentBaselinePrompt(silentAgent, silentFrame), silentQ, TOKENS_R1);
    const pSilent = safeParseTrace(resSilent, "silent");
    const silentBaselineFailed = !pSilent.ok || pSilent.trace.confidence == null;
    setR1((prev) => ({ ...prev, silent: pSilent.trace }));
    addLog(`  → Silent Baseline (${silentAgent}): ${pSilent.ok ? "ok" : "FAIL"} · ${pSilent.trace._meta?.provider || "?"}/${pSilent.trace._meta?.model || "?"} · confidence: ${pSilent.trace.confidence ?? "?"}`);
    if (silentBaselineFailed) addLog("⚠ Silent baseline parse failed — self_delta computation will be unavailable; Gamma R2 aborted.");

    // ── R1 convergence (three-layer) ─────────────────────────────────────────
    const r1Agents = [pA1.trace, pB1.trace, pG1.trace];
    const conv     = computeConvergence(r1Agents);
    const tfidfConv = computeTFIDFCosine(r1Agents);
    setConvergence(conv);
    setTfidfConvergence(tfidfConv);

    let embedConv = null;
    try {
      const validClaims = r1Agents
        .filter((t) => t && t._ok !== false && typeof t.claim === "string" && t.claim)
        .map((t) => t.claim);
      if (validClaims.length >= 2) {
        addLog("  → computing embedding cosine (text-embedding-3-small)...");
        embedConv = await computeEmbeddingCosine(validClaims);
        setEmbedConvergence(embedConv);
      }
    } catch (e) {
      addLog(`  ⚠ embedding convergence unavailable: ${e.message}`);
    }

    // Cross-agent self_check divergence: any mix of clean + warn signals provider
    // style differences rather than genuine epistemic alignment.
    const warnStatuses = new Set(["warning", "auto_warn", "failed"]);
    const r1Checks = r1Agents
      .filter((t) => t && t._ok !== false)
      .map((t) => t.self_check?.status);
    const selfCheckDivergence =
      r1Checks.some((s) => warnStatuses.has(s)) &&
      r1Checks.some((s) => s === "clean");

    if (conv !== null) {
      addLog(
        `R1 convergence · jaccard:${conv.toFixed(3)} tfidf-cos:${tfidfConv !== null ? tfidfConv.toFixed(3) : "—"} embed-cos:${embedConv !== null ? embedConv.toFixed(3) : "—"}` +
        ` ${conv > 0.4 ? "⚠ shared priors" : "(healthy independence)"}`
      );
    }
    if (selfCheckDivergence) {
      addLog("  ⚠ self_check divergence: mixed clean/warn across agents — likely provider style, not epistemic state");
    }
    addLog(`Gamma silent baseline confidence: ${pSilent.trace.confidence ?? "?"}`);

    // ── R2 ────────────────────────────────────────────────────────────────────
    addLog("R2 — deliberation, compressed trace exposure");

    const peerCtx = `${PEER_GUARD}

<arm:peer_traces>
ALPHA R1 (compressed):
${JSON.stringify(sanitizeDeep(compressTrace(pA1.trace)), null, 2)}

BETA R1 (compressed):
${JSON.stringify(sanitizeDeep(compressTrace(pB1.trace)), null, 2)}

GAMMA R1 (compressed):
${JSON.stringify(sanitizeDeep(compressTrace(pG1.trace)), null, 2)}
</arm:peer_traces>

${questionBlock(question)}
`;

    addLog(`  → dispatching Alpha R2 via ${PROVIDER_LABEL[providers.alpha]}...`);
    const resA2 = await callProvider(
      providers.alpha,
      buildAlphaR2(frames.alpha),
      peerCtx + `\nYour R1 confidence was: ${pA1.trace.confidence ?? "unknown"}`,
      TOKENS_R2
    );
    const pA2 = safeParseTrace(resA2, "alpha");
    annotateAgentDrift(pA2.trace, pA1.trace); // A1: harness-computed C_R2 − C_R1
    setR2((prev) => ({ ...prev, alpha: pA2.trace }));
    addLog(`  → Alpha R2: ${pA2.ok ? "ok" : "FAIL"} · harness Δ: ${pA2.trace.drift_score?.harness_confidence_delta ?? "?"} (model self-report: ${pA2.trace.drift_score?.confidence_delta ?? "?"})${pA2.trace.drift_score?.delta_mismatch ? " ⚠ mismatch" : ""}`);

    addLog(`  → dispatching Beta R2 via ${PROVIDER_LABEL[providers.beta]}...`);
    const resB2 = await callProvider(
      providers.beta,
      buildBetaR2(frames.beta),
      peerCtx + `\nYour R1 confidence was: ${pB1.trace.confidence ?? "unknown"}`,
      TOKENS_R2
    );
    const pB2 = safeParseTrace(resB2, "beta");
    annotateAgentDrift(pB2.trace, pB1.trace); // A1: harness-computed C_R2 − C_R1
    setR2((prev) => ({ ...prev, beta: pB2.trace }));
    addLog(`  → Beta R2: ${pB2.ok ? "ok" : "FAIL"} · harness Δ: ${pB2.trace.drift_score?.harness_confidence_delta ?? "?"} (model self-report: ${pB2.trace.drift_score?.confidence_delta ?? "?"})${pB2.trace.drift_score?.delta_mismatch ? " ⚠ mismatch" : ""}`);

    // FAP: fire and dispatch isolation requeue when any agent's delta exceeds DRIFT_UP_THRESHOLD
    const alphaFAPDrift = typeof pA2.trace.drift_score?.confidence_delta === "number" && pA2.trace.drift_score.confidence_delta > DRIFT_UP_THRESHOLD;
    const betaFAPDrift  = typeof pB2.trace.drift_score?.confidence_delta === "number" && pB2.trace.drift_score.confidence_delta > DRIFT_UP_THRESHOLD;
    const fapRequeueResults = [];

    if (alphaFAPDrift || betaFAPDrift) {
      const driftAgents = [
        alphaFAPDrift && `alpha (Δ+${pA2.trace.drift_score.confidence_delta.toFixed(3)})`,
        betaFAPDrift  && `beta (Δ+${pB2.trace.drift_score.confidence_delta.toFixed(3)})`,
      ].filter(Boolean).join(", ");
      addLog(`⚠ FAP re-queue: excessive upward drift Δ > +${DRIFT_UP_THRESHOLD} in ${driftAgents} — dispatching isolation requeue`);

      // Re-dispatch each drifted agent with peer traces masked.
      // The agent sees only the original question and its own R1 reasoning.
      // Memetic drift resolves in isolation; epistemic drift holds.
      const buildRequeueMsg = (r1Trace, r1Confidence) =>
        `REQUEUE — FAP ISOLATION MODE: Your R2 confidence exceeded the upward drift threshold (+${DRIFT_UP_THRESHOLD}). ` +
        `Peer traces are masked. Re-evaluate the original question using only your own R1 reasoning — no peer context.\n\n` +
        `${questionBlock(question)}\n\n` +
        `Your R1 confidence was: ${r1Confidence ?? "unknown"}\n` +
        `Your R1 reasoning (your own prior — peer-isolated):\n` +
        `${JSON.stringify(sanitizeDeep(compressTrace(r1Trace)), null, 2)}`;

      if (alphaFAPDrift) {
        addLog(`  → FAP requeue: re-dispatching Alpha in isolation via ${PROVIDER_LABEL[providers.alpha]}...`);
        const resARequeue = await callProvider(
          providers.alpha,
          buildAlphaR2(frames.alpha),
          buildRequeueMsg(pA1.trace, pA1.trace.confidence),
          TOKENS_R2
        );
        const pARequeue = safeParseTrace(resARequeue, "alpha-requeue");
        const preConf  = pA2.trace.confidence ?? null;
        const postConf = pARequeue.trace.confidence ?? null;
        const requeueDelta   = preConf !== null && postConf !== null ? +(postConf - preConf).toFixed(3) : null;
        const deltaResolved  = requeueDelta !== null && requeueDelta < -0.02;
        fapRequeueResults.push({
          agent: "alpha",
          pre_requeue_confidence:  preConf,
          post_requeue_confidence: postConf,
          requeue_confidence_delta: requeueDelta,
          delta_resolved:   deltaResolved,
          classification:   deltaResolved ? "memetic" : "epistemic",
          trace: pARequeue.trace,
        });
        addLog(`  → Alpha requeue: ${pARequeue.ok ? "ok" : "FAIL"} · pre: ${preConf ?? "?"} → post: ${postConf ?? "?"} · ${deltaResolved ? "⚠ memetic drift confirmed" : "epistemic (held in isolation)"}`);
      }

      if (betaFAPDrift) {
        addLog(`  → FAP requeue: re-dispatching Beta in isolation via ${PROVIDER_LABEL[providers.beta]}...`);
        const resBRequeue = await callProvider(
          providers.beta,
          buildBetaR2(frames.beta),
          buildRequeueMsg(pB1.trace, pB1.trace.confidence),
          TOKENS_R2
        );
        const pBRequeue = safeParseTrace(resBRequeue, "beta-requeue");
        const preConf  = pB2.trace.confidence ?? null;
        const postConf = pBRequeue.trace.confidence ?? null;
        const requeueDelta  = preConf !== null && postConf !== null ? +(postConf - preConf).toFixed(3) : null;
        const deltaResolved = requeueDelta !== null && requeueDelta < -0.02;
        fapRequeueResults.push({
          agent: "beta",
          pre_requeue_confidence:  preConf,
          post_requeue_confidence: postConf,
          requeue_confidence_delta: requeueDelta,
          delta_resolved:  deltaResolved,
          classification:  deltaResolved ? "memetic" : "epistemic",
          trace: pBRequeue.trace,
        });
        addLog(`  → Beta requeue: ${pBRequeue.ok ? "ok" : "FAIL"} · pre: ${preConf ?? "?"} → post: ${postConf ?? "?"} · ${deltaResolved ? "⚠ memetic drift confirmed" : "epistemic (held in isolation)"}`);
      }
    }

    // ── Gamma R2: Reconciliation ──────────────────────────────────────────────
    addLog("R2 Gamma — reconciliation (with silent baseline)");

    const gammaPrompt = `${PEER_GUARD}

<arm:peer_traces>
ALPHA R2 (compressed):
${JSON.stringify(sanitizeDeep(compressTrace(pA2.trace)), null, 2)}

BETA R2 (compressed):
${JSON.stringify(sanitizeDeep(compressTrace(pB2.trace)), null, 2)}

GAMMA R1 silent baseline (YOUR OWN prior — not exposed to peers, confidence: ${pSilent.trace.confidence ?? "unknown"}):
${JSON.stringify(sanitizeDeep(compressTrace(pSilent.trace)), null, 2)}
</arm:peer_traces>

${questionBlock(question)}

Your R1 silent baseline confidence was: ${pSilent.trace.confidence ?? "unknown"}

Compute self_delta_vs_baseline = your R2 confidence MINUS ${pSilent.trace.confidence ?? "unknown"}.
Set reconciliation_status to "success".
IMPORTANT: Complete the RLHF bias audit in rlhf_audit_notes.`;

    if (silentBaselineFailed) {
      addLog("⚠ Gamma R2 aborted — FAP triggered: no valid silent baseline anchor");
      const pG2 = {
        ok: false,
        trace: {
          claim: "[FAP — Gamma R2 aborted]",
          confidence: null,
          reconciliation_status: "failed",
          failure_reason: "silent baseline parse failure — no valid anchor for self_delta computation",
          disagreement_classification: null,
          self_delta_vs_baseline: null,
          harness_self_delta_vs_baseline: null,
          self_delta_mismatch: false,
          flags: ["silent_baseline_failed", "fap_triggered", "self_delta_unavailable"],
          rlhf_audit_notes: "Audit skipped — no valid silent baseline.",
          self_check: { status: "failed", notes: "Gamma R2 aborted before dispatch; silent baseline was missing or unparseable." },
          _meta: { stopReason: "aborted", provider: providers.gamma, model: PROVIDER_MODEL[providers.gamma] },
          _ok: false,
        },
        raw: null,
      };
      setR2((prev) => ({ ...prev, gamma: pG2.trace }));
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      setRunMeta({
        schema_version: EXPORT_SCHEMA_VERSION,
        duration: elapsed,
        roleInjection,
        silentAgent,
        frames,
        providers,
        silentConfidence: null,
        silentBaselineFailed: true,
        fap_drift_triggered: alphaFAPDrift || betaFAPDrift,
        fap_requeue: fapRequeueResults.length > 0 ? fapRequeueResults : undefined,
        disagreement: null,
        convergence: conv,
        tfidf_convergence: tfidfConv,
        embedding_convergence: embedConv,
        self_check_divergence: selfCheckDivergence,
      });
      setStatus("done");
      addLog(`Run complete (partial — FAP) in ${elapsed}s`);
      return;
    }

    const resG2 = await callProvider(providers.gamma, SYSTEM_GAMMA_R2, gammaPrompt, TOKENS_GAMMA);
    const pG2 = safeParseTrace(resG2, "gamma");

    if (!pG2.ok) {
      addLog("⚠ Gamma parse failed — fallback captured");
      pG2.trace.reconciliation_status = "failed";
    } else {
      // A2: harness-computed self-delta = C_gamma_R2 − C_silent_baseline.
      const harnessSelfDelta = harnessDelta(pG2.trace.confidence, pSilent.trace.confidence);
      pG2.trace.harness_self_delta_vs_baseline = harnessSelfDelta;
      pG2.trace.self_delta_mismatch = deltaMismatch(pG2.trace.self_delta_vs_baseline, harnessSelfDelta);

      const disClass = pG2.trace.disagreement_classification;
      addLog(`Gamma reconciliation: ${pG2.trace.reconciliation_status || "success"} · disagreement: ${disClass}`);
      if (disClass === "values") addLog("🎯 VALUES classification triggered!");
      addLog(`Gamma harness self-Δ vs silent: ${harnessSelfDelta ?? "?"} (model self-report: ${pG2.trace.self_delta_vs_baseline ?? "?"})${pG2.trace.self_delta_mismatch ? " ⚠ mismatch" : ""}`);
    }

    // Polarity Gate: detect claim direction flip between Gamma R1 and R2
    if (pG2.ok) {
      const r1Dir = extractClaimDirection(pG1.trace.claim);
      const r2Dir = extractClaimDirection(pG2.trace.claim);
      if (r1Dir !== "unknown" && r2Dir !== "unknown" && r1Dir !== r2Dir) {
        pG2.trace.reconciliation_status = "gamma_flip_detected";
        pG2.trace.polarity_gate_fired = true;
        // Self-documenting audit block: the flip explains itself downstream.
        // confidence_delta_blindspot — true when the flip was invisible to magnitude
        // detectors (|Δ| within DRIFT_UP_THRESHOLD); false when FAP/gamma_drift also caught it.
        const gammaDelta = typeof pG2.trace.self_delta_vs_baseline === "number"
          ? pG2.trace.self_delta_vs_baseline
          : (typeof pG2.trace.drift_score?.confidence_delta === "number" ? pG2.trace.drift_score.confidence_delta : null);
        pG2.trace.polarity_audit = {
          gamma_r1_polarity:      r1Dir,
          gamma_silent_polarity:  extractClaimDirection(pSilent.trace.claim),
          gamma_r2_polarity:      r2Dir,
          polarity_changed:       true,
          confidence_delta_blindspot: gammaDelta !== null && Math.abs(gammaDelta) <= DRIFT_UP_THRESHOLD,
          gate_action:            "block_clean_success",
          requires_manual_review: true,
        };
        // Override self_check but preserve Gamma's original report — forensic record,
        // not replacement. A trace can never report "clean" while the gate is fired.
        const originalStatus = pG2.trace.self_check?.status ?? "unreported";
        const originalNotes  = pG2.trace.self_check?.notes ?? "";
        pG2.trace.self_check = {
          status: "warning",
          notes: `[POLARITY GATE OVERRIDE] Claim direction flipped ${r1Dir.toUpperCase()}→${r2Dir.toUpperCase()} between R1 and R2. Gamma self-reported status "${originalStatus}" — overridden by gate. Original notes: ${originalNotes}`,
        };
        addLog(`⚠ POLARITY GATE: Gamma flipped ${r1Dir.toUpperCase()}→${r2Dir.toUpperCase()} between R1 and R2 — reconciliation_status overridden`);
      }
      // Gamma drift forensic flag — separate from FAP (which gates Alpha/Beta pre-reconciliation)
      if (typeof pG2.trace.self_delta_vs_baseline === "number" && pG2.trace.self_delta_vs_baseline > DRIFT_UP_THRESHOLD) {
        addLog(`⚠ Gamma drift exceeded threshold: self_delta_vs_baseline Δ +${pG2.trace.self_delta_vs_baseline.toFixed(3)}`);
      }
    }

    setR2((prev) => ({ ...prev, gamma: pG2.trace }));

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    setRunMeta({
      schema_version: EXPORT_SCHEMA_VERSION,
      duration: elapsed,
      roleInjection,
      silentAgent,
      frames,
      providers,
      silentConfidence: pSilent.trace.confidence,
      fap_drift_triggered: alphaFAPDrift || betaFAPDrift,
      fap_requeue: fapRequeueResults.length > 0 ? fapRequeueResults : undefined,
      polarity_gate_fired: pG2.trace.polarity_gate_fired ?? false,
      gamma_drift_exceeded: pG2.ok && typeof pG2.trace.self_delta_vs_baseline === "number" && pG2.trace.self_delta_vs_baseline > DRIFT_UP_THRESHOLD,
      disagreement: pG2.trace.disagreement_classification,
      convergence: conv,
      tfidf_convergence: tfidfConv,
      embedding_convergence: embedConv,
      self_check_divergence: selfCheckDivergence,
    });
    // Auto-save trace to /trace on the server
    const autoSaveFilename = buildFilename({
      version: ARM_VERSION,
      questionId,
      providers,
      roleInjection,
      silentAgent,
      status: "done",
    });
    const autoSavePayload = {
      arm_version: ARM_VERSION,
      schema_version: EXPORT_SCHEMA_VERSION,
      r1: { alpha: pA1.trace, beta: pB1.trace, gamma: pG1.trace, silent: pSilent.trace },
      r2: { alpha: pA2.trace, beta: pB2.trace, gamma: pG2.trace },
      convergence: conv,
      tfidf_convergence: tfidfConv,
      embedding_convergence: embedConv,
      runMeta: {
        schema_version: EXPORT_SCHEMA_VERSION,
        duration: elapsed,
        roleInjection,
        silentAgent,
        frames,
        providers,
        silentConfidence: pSilent.trace.confidence,
        fap_drift_triggered: alphaFAPDrift || betaFAPDrift,
        fap_requeue: fapRequeueResults.length > 0 ? fapRequeueResults : undefined,
        polarity_gate_fired: pG2.trace.polarity_gate_fired ?? false,
        gamma_drift_exceeded: pG2.ok && typeof pG2.trace.self_delta_vs_baseline === "number" && pG2.trace.self_delta_vs_baseline > DRIFT_UP_THRESHOLD,
        disagreement: pG2.trace.disagreement_classification,
        convergence: conv,
        tfidf_convergence: tfidfConv,
        embedding_convergence: embedConv,
        self_check_divergence: selfCheckDivergence,
      },
      question,
      providers,
    };
    const saved = await saveTrace(autoSavePayload, autoSaveFilename, accessToken);
    addLog(saved ? `Auto-saved: ${autoSaveFilename}` : `Auto-save failed (server unreachable?) — use Export to save manually`);

    setStatus("done");
    addLog(`Run complete in ${elapsed}s`);
    } catch (err) {
      setStatus("idle");
      addLog(`Run failed: ${err.message || "unknown error"}`);
    }
  };

  const isRunning = status === "running";

  // Drift summary (asymmetric) — harness-computed deltas, not model self-reports
  const driftSummary = ["alpha", "beta"].map((id) => {
    const ds = r2[id]?.drift_score;
    const delta = ds?.harness_confidence_delta;
    const mismatch = ds?.delta_mismatch === true;
    const { label, color } = driftLabel(delta);
    return { id, delta, label, color, mismatch };
  });

  return (
    <div style={{ background: C.bg, minHeight: "100vh", fontFamily: f.mono, color: C.text, padding: "1.5rem", maxWidth: "960px", margin: "0 auto" }}>

      {/* Header */}
      <div style={{ borderBottom: `1px solid ${C.border}`, paddingBottom: "1rem", marginBottom: "1.5rem" }}>
        <div style={{ fontSize: "1rem", color: C.accent, letterSpacing: "0.2em", textTransform: "uppercase", margin: 0 }}>
          ARM · Agent Reasoning Markup
        </div>
        <div style={{ fontSize: "0.66rem", color: C.text, marginTop: "0.25rem" }}>
          v{ARM_VERSION} · polarity gate · FAP circuit breaker · asymmetric drift · rotating silent baseline · RLHF audit
        </div>
        <div style={{ fontSize: "0.62rem", color: C.text, marginTop: "0.2rem" }}>
          Models: α {PROVIDER_MODEL[alphaProvider]} · β {PROVIDER_MODEL[betaProvider]} · γ {PROVIDER_MODEL[gammaProvider]}
        </div>
        <div style={{ fontSize: "0.62rem", color: C.text, marginTop: "0.1rem" }}>
          Tokens: R1 {TOKENS_R1} · R2 {TOKENS_R2} · γR2 {TOKENS_GAMMA}
        </div>
        <div style={{ fontSize: "0.62rem", color: C.text, marginTop: "0.1rem" }}>
          Drift flags: up &gt; {DRIFT_UP_THRESHOLD} · down &lt; {DRIFT_DOWN_THRESHOLD}
        </div>
      </div>

      {/* Question */}
      <div style={{ display: "flex", gap: "0.5rem", alignItems: "flex-start", marginBottom: "1rem" }}>
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          disabled={isRunning}
          style={{ flex: 1, background: C.surface, border: `1px solid ${C.border}`, color: C.text, padding: "0.75rem", borderRadius: "4px", fontSize: "0.78rem", fontFamily: f.mono, resize: "vertical", minHeight: "90px", boxSizing: "border-box" }}
        />
        <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
          <label style={{ fontSize: "0.6rem", color: C.muted, whiteSpace: "nowrap" }}>question id</label>
          <input
            type="text"
            value={questionId}
            onChange={(e) => setQuestionId(e.target.value.replace(/[^a-zA-Z0-9]/g, ""))}
            disabled={isRunning}
            style={{ width: "60px", background: C.surface, border: `1px solid ${C.border}`, color: C.text, padding: "0.4rem", borderRadius: "4px", fontSize: "0.78rem", fontFamily: f.mono, textAlign: "center" }}
          />
        </div>
      </div>

      {/* Controls */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem", alignItems: "center", marginBottom: "1rem" }}>
        {/* Role injection toggle */}
        <label style={{ fontSize: "0.68rem", color: C.muted, cursor: "pointer", display: "flex", alignItems: "center", gap: "0.35rem" }}>
          <input type="checkbox" checked={roleInjection} onChange={(e) => setRoleInjection(e.target.checked)} disabled={isRunning} />
          role injection
        </label>

        {/* Frame selectors */}
        {roleInjection && (
          <>
            <div style={{ fontSize: "0.65rem", color: C.muted }}>
              Alpha:
              <select value={alphaFrame} onChange={(e) => setAlphaFrame(e.target.value)} disabled={isRunning}
                style={{ background: C.surface, color: C.text, border: `1px solid ${C.border}`, marginLeft: "0.35rem", fontSize: "0.65rem", fontFamily: f.mono, padding: "0.1rem 0.3rem" }}>
                <option value="deontological">deontological</option>
                <option value="consequentialist">consequentialist</option>
                <option value="independent">independent</option>
              </select>
            </div>
            <div style={{ fontSize: "0.65rem", color: C.muted }}>
              Beta:
              <select value={betaFrame} onChange={(e) => setBetaFrame(e.target.value)} disabled={isRunning}
                style={{ background: C.surface, color: C.text, border: `1px solid ${C.border}`, marginLeft: "0.35rem", fontSize: "0.65rem", fontFamily: f.mono, padding: "0.1rem 0.3rem" }}>
                <option value="consequentialist">consequentialist</option>
                <option value="deontological">deontological</option>
                <option value="independent">independent</option>
              </select>
            </div>
          </>
        )}

        {/* Provider selectors */}
        <div style={{ fontSize: "0.65rem", color: C.alpha }}>
          Alpha provider:
          <select value={alphaProvider} onChange={(e) => setAlphaProvider(e.target.value)} disabled={isRunning}
            style={{ background: C.surface, color: C.text, border: `1px solid ${C.border}`, marginLeft: "0.35rem", fontSize: "0.65rem", fontFamily: f.mono, padding: "0.1rem 0.3rem" }}>
            <option value="claude">Claude</option>
            <option value="gpt">GPT</option>
            <option value="gemini">Gemini</option>
          </select>
        </div>
        <div style={{ fontSize: "0.65rem", color: C.beta }}>
          Beta provider:
          <select value={betaProvider} onChange={(e) => setBetaProvider(e.target.value)} disabled={isRunning}
            style={{ background: C.surface, color: C.text, border: `1px solid ${C.border}`, marginLeft: "0.35rem", fontSize: "0.65rem", fontFamily: f.mono, padding: "0.1rem 0.3rem" }}>
            <option value="claude">Claude</option>
            <option value="gpt">GPT</option>
            <option value="gemini">Gemini</option>
          </select>
        </div>
        <div style={{ fontSize: "0.65rem", color: C.gamma }}>
          Gamma provider:
          <select value={gammaProvider} onChange={(e) => setGammaProvider(e.target.value)} disabled={isRunning}
            style={{ background: C.surface, color: C.text, border: `1px solid ${C.border}`, marginLeft: "0.35rem", fontSize: "0.65rem", fontFamily: f.mono, padding: "0.1rem 0.3rem" }}>
            <option value="claude">Claude</option>
            <option value="gpt">GPT</option>
            <option value="gemini">Gemini</option>
          </select>
        </div>

        {/* Silent baseline selector (rotating) */}
        <div style={{ fontSize: "0.65rem", color: C.silent }}>
          Silent baseline:
          <select value={silentAgent} onChange={(e) => setSilentAgent(e.target.value)} disabled={isRunning}
            style={{ background: C.surface, color: C.text, border: `1px solid ${C.silent}60`, marginLeft: "0.35rem", fontSize: "0.65rem", fontFamily: f.mono, padding: "0.1rem 0.3rem" }}>
            <option value="gamma">gamma (default)</option>
            <option value="alpha">alpha (rotating test)</option>
            <option value="beta">beta (rotating test)</option>
          </select>
        </div>

        {/* Proxy access token — gates the production /api proxy (server.js).
            Stored in localStorage, sent as x-arm-token; never baked into the bundle. */}
        <div style={{ fontSize: "0.65rem", color: C.muted }}>
          access token:
          <input
            type="password"
            value={accessToken}
            onChange={(e) => updateAccessToken(e.target.value)}
            disabled={isRunning}
            placeholder="proxy token"
            autoComplete="off"
            style={{ background: C.surface, color: C.text, border: `1px solid ${C.border}`, marginLeft: "0.35rem", fontSize: "0.65rem", fontFamily: f.mono, padding: "0.1rem 0.3rem", width: "9rem" }}
          />
        </div>
      </div>

      <div style={{ display: "flex", gap: "0.75rem", marginBottom: "1.5rem" }}>
        <button
          onClick={run} disabled={isRunning}
          style={{ background: C.accentDim, color: C.accent, border: `1px solid ${C.accent}`, padding: "0.55rem 1.4rem", borderRadius: "3px", cursor: isRunning ? "not-allowed" : "pointer", fontSize: "0.75rem", letterSpacing: "0.1em", textTransform: "uppercase", fontFamily: f.mono }}
        >
          {isRunning ? "running..." : "▶ run experiment"}
        </button>
        {status === "done" && (
          <button
            onClick={() => exportJSON({ arm_version: ARM_VERSION, schema_version: EXPORT_SCHEMA_VERSION, r1, r2, convergence, tfidf_convergence: tfidfConvergence, embedding_convergence: embedConvergence, runMeta, question, providers: runMeta?.providers }).catch(err => alert(err.message))}
            style={{ background: "none", color: C.muted, border: `1px solid ${C.border}`, padding: "0.55rem 1rem", borderRadius: "3px", cursor: "pointer", fontSize: "0.72rem", fontFamily: f.mono }}
          >
            ↓ export JSON
          </button>
        )}
      </div>

      {/* Log */}
      {log.length > 0 && (
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: "4px", padding: "0.6rem 0.75rem", fontSize: "0.65rem", color: C.muted, marginBottom: "1.5rem", lineHeight: 1.7 }}>
          {log.map((l, i) => <div key={i}>{l}</div>)}
        </div>
      )}

      {/* R1 */}
      {(r1.alpha || r1.beta || r1.gamma) && (
        <>
          <div style={{ fontSize: "0.58rem", letterSpacing: "0.2em", color: C.muted, textTransform: "uppercase", marginBottom: "0.5rem" }}>
            Round 1 — Isolation · Zero Cross-Visibility · Sequential Dispatch
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "0.75rem", marginBottom: "0.75rem" }}>
            <AgentCard agentId="alpha" trace={r1.alpha} round={1} />
            <AgentCard agentId="beta"  trace={r1.beta}  round={1} />
            <AgentCard agentId="gamma" trace={r1.gamma} round={1} />
          </div>
          {r1.silent && (
            <div style={{ marginBottom: "1rem" }}>
              <div style={{ fontSize: "0.58rem", letterSpacing: "0.15em", color: C.silent, textTransform: "uppercase", marginBottom: "0.4rem" }}>
                γ-silent · {silentAgent} baseline (no peer exposure · anchors Gamma self-Δ in R2)
              </div>
              <AgentCard agentId={silentAgent} trace={r1.silent} round={1} isSilent />
            </div>
          )}
          {convergence !== null && (
            <div style={{ fontSize: "0.65rem", marginBottom: "1rem", display: "flex", flexDirection: "column", gap: "0.2rem" }}>
              <span style={{ color: convergence > 0.4 ? C.warn : C.success }}>
                R1 jaccard: {convergence.toFixed(3)} — {convergence > 0.4 ? "⚠ shared priors" : "healthy independence"}
              </span>
              {tfidfConvergence !== null && (
                <span style={{ color: tfidfConvergence > 0.4 ? C.warn : C.success }}>
                  R1 tfidf-cos: {tfidfConvergence.toFixed(3)} — {tfidfConvergence > 0.4 ? "⚠ weighted lexical overlap" : "healthy independence"}
                </span>
              )}
              {embedConvergence !== null && (
                <span style={{ color: embedConvergence > 0.85 ? C.warn : C.success }}>
                  R1 embed-cos: {embedConvergence.toFixed(3)} — {embedConvergence > 0.85 ? "⚠ semantic convergence" : "semantic independence"}
                </span>
              )}
            </div>
          )}
        </>
      )}

      {/* R2 */}
      {(r2.alpha || r2.beta) && (
        <>
          <div style={{ fontSize: "0.58rem", letterSpacing: "0.2em", color: C.muted, textTransform: "uppercase", marginBottom: "0.5rem", marginTop: "1rem" }}>
            Round 2 — Deliberation · Adversarial Pressure Active
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem", marginBottom: "0.75rem" }}>
            <AgentCard agentId="alpha" trace={r2.alpha} round={2} />
            <AgentCard agentId="beta"  trace={r2.beta}  round={2} />
          </div>
          {r2.gamma && <GammaCard trace={r2.gamma} />}
        </>
      )}

      {/* Drift Summary */}
      {status === "done" && (
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: "4px", padding: "1rem", marginTop: "1.5rem" }}>
          <div style={{ fontSize: "0.58rem", letterSpacing: "0.2em", color: C.muted, textTransform: "uppercase", marginBottom: "0.6rem" }}>
            Drift Summary · v{ARM_VERSION} Asymmetric Thresholds
          </div>
          {driftSummary.map(({ id, delta, label, color, mismatch }) => (
            <div key={id} style={{ display: "flex", justifyContent: "space-between", padding: "0.35rem 0", borderBottom: `1px solid ${C.border}` }}>
              <span style={{ color: id === "alpha" ? C.alpha : C.beta, textTransform: "uppercase", fontSize: "0.68rem" }}>{id}</span>
              <span style={{ color: C.muted, fontFamily: f.mono, fontSize: "0.68rem" }}>{delta !== null && delta !== undefined ? (delta > 0 ? "+" : "") + delta.toFixed(3) : "—"}</span>
              <span style={{ color, fontSize: "0.68rem" }}>{label}{mismatch ? " · ⚠ self-report Δ mismatch" : ""}</span>
            </div>
          ))}
          {r2.gamma && (
            <div style={{ display: "flex", justifyContent: "space-between", padding: "0.35rem 0", borderBottom: `1px solid ${C.border}` }}>
              <span style={{ color: C.gamma, textTransform: "uppercase", fontSize: "0.68rem" }}>gamma self-Δ</span>
              <span style={{ color: C.muted, fontFamily: f.mono, fontSize: "0.68rem" }}>
                {Number.isFinite(r2.gamma.harness_self_delta_vs_baseline) ? (r2.gamma.harness_self_delta_vs_baseline > 0 ? "+" : "") + Number(r2.gamma.harness_self_delta_vs_baseline).toFixed(3) : "—"}
              </span>
              <span style={{ color: C.silent, fontSize: "0.68rem" }}>vs silent baseline ({silentAgent}){r2.gamma.self_delta_mismatch ? " · ⚠ mismatch" : ""}</span>
            </div>
          )}
          {convergence !== null && (
            <div style={{ display: "flex", justifyContent: "space-between", padding: "0.35rem 0", borderBottom: `1px solid ${C.border}` }}>
              <span style={{ color: C.text, fontSize: "0.68rem" }}>R1 jaccard</span>
              <span style={{ color: convergence > 0.4 ? C.warn : C.success, fontFamily: f.mono, fontSize: "0.68rem" }}>{convergence.toFixed(3)}</span>
              <span style={{ color: convergence > 0.4 ? C.warn : C.muted, fontSize: "0.68rem" }}>{convergence > 0.4 ? "⚠ shared priors" : "healthy"}</span>
            </div>
          )}
          {tfidfConvergence !== null && (
            <div style={{ display: "flex", justifyContent: "space-between", padding: "0.35rem 0", borderBottom: `1px solid ${C.border}` }}>
              <span style={{ color: C.text, fontSize: "0.68rem" }}>R1 tfidf-cos</span>
              <span style={{ color: tfidfConvergence > 0.4 ? C.warn : C.success, fontFamily: f.mono, fontSize: "0.68rem" }}>{tfidfConvergence.toFixed(3)}</span>
              <span style={{ color: tfidfConvergence > 0.4 ? C.warn : C.muted, fontSize: "0.68rem" }}>{tfidfConvergence > 0.4 ? "⚠ weighted lexical overlap" : "healthy"}</span>
            </div>
          )}
          {embedConvergence !== null && (
            <div style={{ display: "flex", justifyContent: "space-between", padding: "0.35rem 0", borderBottom: `1px solid ${C.border}` }}>
              <span style={{ color: C.text, fontSize: "0.68rem" }}>R1 embed-cos</span>
              <span style={{ color: embedConvergence > 0.85 ? C.warn : C.success, fontFamily: f.mono, fontSize: "0.68rem" }}>{embedConvergence.toFixed(3)}</span>
              <span style={{ color: embedConvergence > 0.85 ? C.warn : C.muted, fontSize: "0.68rem" }}>{embedConvergence > 0.85 ? "⚠ semantic convergence" : "semantic ok"}</span>
            </div>
          )}
          {runMeta && (
            <div style={{ display: "flex", justifyContent: "space-between", padding: "0.35rem 0" }}>
              <span style={{ color: C.muted, fontSize: "0.65rem" }}>silent_baseline_role</span>
              <span style={{ color: C.silent, fontSize: "0.65rem" }}>{runMeta.silentAgent}</span>
              <span style={{ color: C.muted, fontSize: "0.65rem" }}>duration: {runMeta.duration}s</span>
            </div>
          )}
          <div style={{ fontSize: "0.6rem", color: C.muted, marginTop: "0.6rem", lineHeight: 1.7 }}>
            v{ARM_VERSION}: Δ &gt; +{DRIFT_UP_THRESHOLD} = memetic drift (tightened) · Δ &lt; {DRIFT_DOWN_THRESHOLD} = deep tightening · Δ ≤ 0 = epistemic tightening (healthy)<br/>
            Gamma Δ measured vs {silentAgent} silent baseline · rotate baseline to validate reproducibility<br/>
            decision_basis declared by all agents · rlhf_audit_notes in Gamma R2
          </div>
        </div>
      )}
    </div>
  );
}
