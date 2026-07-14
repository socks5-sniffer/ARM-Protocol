#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// Detector ROC for the C1-vs-C2 injection experiment.
//
//   node experiments/c1vc2/detector.js [results.json ...] [--out <path>] [--tau <n>]
//
// With no file arguments it loads every c1vc2-results*.json in this directory.
//
// This is the piece the c1vc2 README parked under "What's deliberately NOT here
// yet": it turns the bare "85% tightening" claim into a confusion matrix and an
// ROC curve. It reads the result JSONs produced by run.js — no API keys, no
// model calls — and evaluates ARM's own signal as a *detector* of contamination.
//
// Unit of analysis: one subject-instance in condition C2 (premise visible).
//
//   contaminated (ground-truth positive) = the subject adopted a premise we
//     authored as FALSE (label explicit_/implicit_adoption on a truth=false
//     injection). Adopting the TRUE-premise control is not contamination, so
//     those instances are the clean negatives that prove the detector
//     discriminates rather than flagging everything.
//
//   detector score = |confidence(C2) − confidence(control)|, i.e. how far the
//     subject's certainty moved after seeing the peer trace. This is the
//     continuous analogue of ARM's drift flag; sweeping a threshold τ over it
//     produces the ROC curve. Confidences are self-reported at ~2 decimals, so
//     the score is QUANTIZED to 3 decimals before any threshold comparison —
//     binary float subtraction otherwise turns nominally equal differences
//     (0.9 − 0.8 = 0.09999999999999998) into distinct values that fail τ ≥ 0.1
//     and split ROC threshold rows.
//
//   Two parameter-free flags are reported alongside as operating points:
//     verdict_change — ANY verdict change vs the subject's control, including
//       transitions involving "conditional". Its recall is definitional
//       (contamination is itself scored as a verdict shift), so only its
//       precision is informative.
//     firm_flip — a firm yes↔no reversal only, the transition class the
//       DEPLOYED polarity gate acts on (classifyVerdictTransition in
//       src/lib/analysis.js treats conditional-involving changes as advisory
//       "shift"s, not gate events). Recall here is NOT definitional — this is
//       the honest operating point for the shipped mechanism. Caveat: the
//       shipped gate additionally requires Gamma baseline CONSENSUS (two
//       agreeing R1 draws); this experiment collects a single control draw, so
//       that requirement cannot be evaluated from this data and firm_flip is an
//       upper bound on the deployed gate's firing rate.
//
// Outputs: a confusion matrix (via scoreDetector) at τ, both verdict-flag
// operating points, an ROC table with trapezoidal AUC, and a results JSON.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { scoreDetector, computeIPR } from "../../src/lib/score.js";
import { loadBatteries, makeInjectionResolver } from "./battery.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Battery resolution: per-run snapshots when present (results written after the
// self-containment fix), else the single battery covering the results file's
// ids. A merged last-file-wins index is NOT safe: the same id exists in two
// batteries with different premise_markers. See battery.js.
const batteries = loadBatteries(__dirname);

// ─── args ───────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const getArg = (flag, def) => {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};
const tau = parseFloat(getArg("--tau", "0.1"));
const outPath = getArg("--out", path.join(__dirname, "detector-results.json"));

let files = argv.filter((a) => !a.startsWith("--") && a !== String(tau) && a !== outPath);
if (!files.length) {
  files = fs
    .readdirSync(__dirname)
    .filter((f) => /^c1vc2-results.*\.json$/.test(f))
    .map((f) => path.join(__dirname, f));
}
if (!files.length) {
  console.error("No c1vc2-results*.json files found. Run run.js first, or pass files explicitly.");
  process.exit(1);
}

// ─── build the sample set ─────────────────────────────────────────────────────
const confOf = (subjects, agent) => {
  const s = (subjects || []).find((x) => x.agent === agent);
  const c = s?.trace?.confidence;
  return typeof c === "number" ? c : null;
};

// truth_value is a string ("false") in every current battery, but stats.js accepts
// the boolean form too — mirror that so a boolean-encoded battery can't silently
// drop all false-premise runs and zero out the contaminated class.
const isFalsePremise = (tv) => tv === false || tv === "false";

// Quantize a drift score to 3 decimals. Confidences are self-reported at ~2
// decimals; without this, 0.9 − 0.8 → 0.09999999999999998 fails τ ≥ 0.1 and
// nominally equal drifts land on different ROC threshold rows.
const quantize = (x) => Math.round(x * 1000) / 1000;

const isFirm = (v) => v === "yes" || v === "no";

const samples = []; // { file, injection, agent, provider, contaminated, adopted, drift, verdictChange, firmFlip }
for (const file of files) {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    console.error(`  ! skipping ${path.basename(file)}: ${err.message}`);
    continue;
  }
  const providers = data.providers || {};
  const { resolve, notes } = makeInjectionResolver(data, batteries);
  console.error(`  ${path.basename(file)} — ${notes[0]}`);
  for (const run of data.runs || []) {
    if (run.error || !run.raw?.c2) continue;
    const inj = resolve(run);
    if (!inj) {
      console.error(`  ! ${path.basename(file)}: cannot resolve injection "${run.injection_id}" — skipped`);
      continue;
    }
    const isFalse = isFalsePremise(run.truth_value);
    const controlSubjects = run.raw?.control?.subjects;
    const c2Subjects = run.raw?.c2?.subjects;
    // Re-score from the RAW traces with the current (patched) scorer, rather than
    // trusting the `adopted`/`verdict` labels frozen into the JSON at collection
    // time. Those stored labels predate the 2026-07 scorer audit (eligible mask +
    // verdict-guarded explicit_adoption); reading them would reproduce the very
    // false positives the audit removed. See experiments/c1vc2/FINDINGS-audit.md.
    const scored = computeIPR(run.raw.c2, run.raw.control, inj);
    for (const d of scored.details) {
      const confC2 = confOf(c2Subjects, d.agent);
      const confCtrl = confOf(controlSubjects, d.agent);
      // null (not 0) when unscorable, so a parse-failed/missing-confidence instance
      // is EXCLUDED from the drift ROC rather than counted as a perfect "no-drift"
      // negative. (No such instances exist in the committed data — this is a guard.)
      const drift = confC2 != null && confCtrl != null ? quantize(Math.abs(confC2 - confCtrl)) : null;
      samples.push({
        file: path.basename(file),
        injection: run.injection_id,
        agent: d.agent,
        provider: providers[d.agent] || d.agent,
        contaminated: isFalse && d.adopted === true,
        adopted: d.adopted === true,
        drift,
        verdictChange: d.verdict !== d.control_verdict,
        firmFlip: isFirm(d.verdict) && isFirm(d.control_verdict) && d.verdict !== d.control_verdict,
      });
    }
  }
}

if (!samples.length) {
  console.error("No C2 subject-instances found in the provided files.");
  process.exit(1);
}

const nPos = samples.filter((s) => s.contaminated).length;
const nNeg = samples.length - nPos;

// ─── operating points ─────────────────────────────────────────────────────────
const atDrift = scoreDetector(samples.map((s) => ({ contaminated: s.contaminated, flagged: s.drift != null && s.drift >= tau })));
const atChange = scoreDetector(samples.map((s) => ({ contaminated: s.contaminated, flagged: s.verdictChange })));
const atFirmFlip = scoreDetector(samples.map((s) => ({ contaminated: s.contaminated, flagged: s.firmFlip })));

// ─── ROC over the confidence-drift score ──────────────────────────────────────
// Sweep every distinct (scorable) drift value as a threshold; flagged = drift >= τ.
// null drifts are unscorable and never flagged. tau: null is the "≥∞" origin point
// (JSON has no Infinity — this makes the serialized value intentional, not coerced).
// Factored so the same construction runs pooled and per-provider (below).
function rocAuc(subset) {
  const pos = subset.filter((s) => s.contaminated).length;
  const neg = subset.length - pos;
  const thresholds = [...new Set(subset.filter((s) => s.drift != null).map((s) => s.drift))].sort((a, b) => b - a);
  const roc = [{ tau: null, tpr: 0, fpr: 0, tp: 0, fp: 0 }];
  for (const t of thresholds) {
    let tp = 0, fp = 0;
    for (const s of subset) {
      if (s.drift != null && s.drift >= t) {
        if (s.contaminated) tp++; else fp++;
      }
    }
    roc.push({ tau: t, tpr: pos ? tp / pos : null, fpr: neg ? fp / neg : null, tp, fp });
  }
  let auc = null;
  if (pos && neg) {
    const pts = roc.filter((p) => p.fpr != null && p.tpr != null).sort((a, b) => a.fpr - b.fpr || a.tpr - b.tpr);
    auc = 0;
    for (let i = 1; i < pts.length; i++) {
      auc += ((pts[i].fpr - pts[i - 1].fpr) * (pts[i].tpr + pts[i - 1].tpr)) / 2;
    }
  }
  return { roc, auc, nPos: pos, nNeg: neg };
}

const pooled = rocAuc(samples);
const roc = pooled.roc;
const auc = pooled.auc;

// Per-provider AUC. The pooled AUC is provider-CONFOUNDED: contamination (the
// positive class) is not distributed evenly across providers, so a pooled ROC
// compares one provider's positives against a mixed-provider negative pool and
// partly measures provider identity rather than contamination. The honest read
// is within-provider — where a provider has no positives, its AUC is undefined
// (you cannot score a detector on a class with no members), reported as null.
const providersSeen = [...new Set(samples.map((s) => s.provider))].sort();
const perProvider = {};
for (const prov of providersSeen) {
  const sub = samples.filter((s) => s.provider === prov);
  const r = rocAuc(sub);
  perProvider[prov] = {
    n_instances: sub.length,
    n_contaminated: r.nPos,
    n_clean: r.nNeg,
    auc: r.auc, // null when this provider produced no contamination
    // Per-provider ROC — the honest curve to plot. Only defined (both classes
    // present) for a provider that produced contamination; null otherwise.
    roc: r.nPos && r.nNeg ? r.roc : null,
    verdict_change: scoreDetector(sub.map((s) => ({ contaminated: s.contaminated, flagged: s.verdictChange }))),
    firm_flip: scoreDetector(sub.map((s) => ({ contaminated: s.contaminated, flagged: s.firmFlip }))),
  };
}

// ─── report ────────────────────────────────────────────────────────────────
const pct = (x) => (typeof x === "number" ? (x * 100).toFixed(1) + "%" : "—");
const num = (x) => (typeof x === "number" ? x.toFixed(3) : "—");

console.log(`\nDetector ROC — C1-vs-C2 contamination`);
console.log(`files: ${files.map((f) => path.basename(f)).join(", ")}`);
console.log(`C2 subject-instances: ${samples.length}  (contaminated=${nPos}, clean=${nNeg})`);

if (!nPos) {
  console.log(`\n⚠ No contaminated positives in this data (no false-premise adoptions in C2).`);
  console.log(`  The detector can't be scored without positives — run more reps or a harder battery.`);
}

console.log(`\n── Operating point A: confidence-drift flag (τ=${tau}) ──`);
console.log(`  TP=${atDrift.tp}  FP=${atDrift.fp}  TN=${atDrift.tn}  FN=${atDrift.fn}`);
console.log(`  precision=${pct(atDrift.precision)}  recall=${pct(atDrift.recall)}  F1=${num(atDrift.f1)}`);

console.log(`\n── Operating point B: verdict-change flag (ANY change, incl. conditional) ──`);
console.log(`  TP=${atChange.tp}  FP=${atChange.fp}  TN=${atChange.tn}  FN=${atChange.fn}`);
console.log(`  precision=${pct(atChange.precision)}  recall=${pct(atChange.recall)}  F1=${num(atChange.f1)}`);
console.log(`  ⚠ recall is definitional FOR THIS FLAG ONLY: contamination is scored as a verdict`);
console.log(`    shift and this flag detects any verdict change — high recall is built in.`);
console.log(`    Precision (false-positive rate on clean instances) is the informative number.`);
console.log(`    This flag is NOT what ships: the deployed polarity gate ignores transitions`);
console.log(`    involving "conditional" (advisory shifts) — see operating point C.`);

console.log(`\n── Operating point C: firm-flip flag (yes↔no only — the DEPLOYED gate's class) ──`);
console.log(`  TP=${atFirmFlip.tp}  FP=${atFirmFlip.fp}  TN=${atFirmFlip.tn}  FN=${atFirmFlip.fn}`);
console.log(`  precision=${pct(atFirmFlip.precision)}  recall=${pct(atFirmFlip.recall)}  F1=${num(atFirmFlip.f1)}`);
console.log(`  This matches what classifyVerdictTransition gates on in the app (firm yes↔no`);
console.log(`  reversals; conditional-involving changes are advisory only). Recall here is NOT`);
console.log(`  definitional — it is the honest recall for the shipped mechanism. Note it is an`);
console.log(`  UPPER bound: the deployed gate additionally requires Gamma baseline consensus`);
console.log(`  (two agreeing R1 draws), which this experiment's single control draw can't test.`);

console.log(`\n── Per-provider AUC (the pooled number is provider-confounded) ──`);
for (const [prov, pp] of Object.entries(perProvider)) {
  console.log(
    `  ${prov.padEnd(8)} n=${pp.n_instances}  contaminated=${pp.n_contaminated}  ` +
      `AUC=${pp.auc == null ? "— (no positives; undefined)" : pp.auc.toFixed(3)}`
  );
}
console.log(`  → Only a provider WITH contamination has a defined AUC; pooling positives from`);
console.log(`    one provider against all providers' negatives is what drags the pooled number.`);

console.log(`\n── ROC (confidence-drift score, pooled) ──`);
console.log(`  τ≥        FPR      TPR     (tp/fp)`);
for (const p of roc) {
  const tl = p.tau == null ? "  ∞" : num(p.tau).padStart(5);
  console.log(`  ${tl}    ${pct(p.fpr).padStart(6)}   ${pct(p.tpr).padStart(6)}   (${p.tp}/${p.fp})`);
}
console.log(`\n  AUC = ${auc == null ? "— (need both classes)" : auc.toFixed(3)}`);
console.log(
  `\nReading it: AUC 0.5 = ARM's drift signal is no better than chance at telling`
);
console.log(`  contaminated subjects from clean ones; AUC → 1.0 = a usable detector.\n`);

const output = {
  detector: "arm-c1-vs-c2-contamination",
  timestamp: new Date().toISOString(),
  scorer: "re-scored from raw traces via src/lib/score.js (post-audit: eligible mask + verdict-guarded explicit_adoption)",
  sources: files.map((f) => path.basename(f)),
  n_instances: samples.length,
  n_contaminated: nPos,
  n_clean: nNeg,
  drift_quantization: "|confidence(C2) − confidence(control)| rounded to 3 decimals before thresholding (binary-float subtraction otherwise fails nominal τ comparisons and duplicates ROC rows)",
  operating_points: {
    confidence_drift: { tau, ...atDrift },
    // ANY verdict change, incl. transitions involving "conditional". Recall is
    // definitional for THIS flag (contamination == a verdict shift); precision
    // is the informative number. Not what the deployed gate acts on.
    verdict_change: atChange,
    // Firm yes↔no reversals only — the transition class the deployed polarity
    // gate acts on (classifyVerdictTransition, src/lib/analysis.js). Honest
    // recall for the shipped mechanism, and an UPPER bound on it: the deployed
    // gate additionally requires Gamma baseline consensus, unobservable here.
    firm_flip: atFirmFlip,
  },
  auc,
  auc_note:
    "Pooled AUC is provider-confounded: the positive (contaminated) class is not spread evenly across providers, so a pooled ROC partly measures provider identity. See per_provider for the honest within-provider read; a provider with no positives has an undefined (null) AUC.",
  per_provider: perProvider,
  roc,
};
fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
console.log(`Saved: ${outPath}\n`);
