// SPDX-License-Identifier: Apache-2.0
//
// DEF CON 34 AI Village poster — data layer.
//
// Every number printed on the poster is derived HERE, directly from the committed
// result JSONs, using the same scorer the experiments use (src/lib/score.js after
// the 2026-07-10 audit patch). Nothing on the poster is hand-typed.
//
//   node poster/data.mjs        → writes poster/poster-data.json
//
// Sources:
//   experiments/c1vc2/c1vc2-results-*.json        (four panels, raw traces)
//   experiments/c1vc2/injections-logical.json     (battery, truth values, pushes)
//   experiments/c1vc2/detector-results.json       (ROC / AUC, computed by detector.js)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { classifyAgent, computeIPR } from "../src/lib/score.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXP = path.join(__dirname, "../experiments/c1vc2");

const battery = JSON.parse(fs.readFileSync(path.join(EXP, "injections-logical.json"), "utf8"));
const injById = {};
for (const i of battery.injections) injById[i.id] = i;
const isFalse = (tv) => tv === false || tv === "false";
const isTrue = (tv) => tv === true || tv === "true";

const PANELS = {
  mixed: { file: "c1vc2-results-panel-injectionsLogical.json", label: "Mixed (GPT + Gemini)" },
  gemini: { file: "c1vc2-results-allGemini.json", label: "all-Gemini" },
  gpt: { file: "c1vc2-results-allGPT.json", label: "all-GPT" },
  claude: { file: "c1vc2-results-allClaude.json", label: "all-Claude" },
};

// ─── seeded RNG + paired permutation p (mirrors stats.js, seed 42) ───────────
function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);

function pairedPermutation(pairs, iters = 10000, seed = 42) {
  const rng = makeRng(seed);
  const obs = mean(pairs.map((p) => p.c2)) - mean(pairs.map((p) => p.c1));
  let extreme = 0;
  for (let it = 0; it < iters; it++) {
    let sum = 0;
    for (const p of pairs) {
      const swap = rng() < 0.5;
      sum += (swap ? p.c1 : p.c2) - (swap ? p.c2 : p.c1);
    }
    if (Math.abs(sum / pairs.length) >= Math.abs(obs) - 1e-12) extreme++;
  }
  return { delta: obs, p: (extreme + 1) / (iters + 1) };
}

function bootstrapCI(pairs, iters = 10000, seed = 42) {
  const rng = makeRng(seed);
  const n = pairs.length;
  const dist = [];
  for (let b = 0; b < iters; b++) {
    const s = new Array(n);
    for (let i = 0; i < n; i++) s[i] = pairs[(rng() * n) | 0];
    dist.push(mean(s.map((p) => p.c2)) - mean(s.map((p) => p.c1)));
  }
  dist.sort((a, b) => a - b);
  const pct = (p) => {
    const idx = (dist.length - 1) * p;
    const lo = Math.floor(idx), hi = Math.ceil(idx);
    return lo === hi ? dist[lo] : dist[lo] + (dist[hi] - dist[lo]) * (idx - lo);
  };
  return [pct(0.025), pct(0.975)];
}

// ─── per-panel scoring ────────────────────────────────────────────────────────
const panels = {};
let totalPairedInstances = 0;

for (const [key, { file, label }] of Object.entries(PANELS)) {
  const d = JSON.parse(fs.readFileSync(path.join(EXP, file), "utf8"));
  const providerOf = d.providers || {}; // agent seat → model provider
  const pairsAll = [];
  const pairsElig = [];
  const trueControl = { n: 0, adopted: 0, adoptedWithMove: 0 };
  const perInjection = {};
  // Per-model rates within this panel (Variant B: susceptibility travels with the
  // model, not the seat — compare a model's rate in mixed vs its monoculture).
  const perModel = {};

  for (const run of d.runs) {
    if (run.error) continue;
    const inj = injById[run.injection_id];
    const c1 = computeIPR(run.raw.c1, run.raw.control, inj);
    const c2 = computeIPR(run.raw.c2, run.raw.control, inj);

    if (isFalse(run.truth_value)) {
      perInjection[run.injection_id] = perInjection[run.injection_id] || { c1: 0, c2: 0 };
      perInjection[run.injection_id].c1 += c1.adopted;
      perInjection[run.injection_id].c2 += c2.adopted;
      const byAgent = {};
      for (const dd of c1.details) byAgent[dd.agent] = { c1: dd.adopted ? 1 : 0, eligible: dd.eligible };
      for (const dd of c2.details) {
        byAgent[dd.agent] = byAgent[dd.agent] || {};
        byAgent[dd.agent].c2 = dd.adopted ? 1 : 0;
        byAgent[dd.agent].eligible = dd.eligible;
      }
      for (const a of Object.keys(byAgent)) {
        const p = byAgent[a];
        if (p.c1 == null || p.c2 == null) continue;
        pairsAll.push({ c1: p.c1, c2: p.c2 });
        if (p.eligible) pairsElig.push({ c1: p.c1, c2: p.c2 });
        const model = providerOf[a] || a;
        perModel[model] = perModel[model] || { n: 0, nElig: 0, c1: 0, c2: 0, c1Elig: 0, c2Elig: 0 };
        const m = perModel[model];
        m.n++;
        m.c1 += p.c1;
        m.c2 += p.c2;
        if (p.eligible) {
          m.nElig++;
          m.c1Elig += p.c1;
          m.c2Elig += p.c2;
        }
      }
    } else if (isTrue(run.truth_value)) {
      for (const dd of c2.details) {
        trueControl.n++;
        if (dd.adopted) {
          trueControl.adopted++;
          if (dd.verdict !== dd.control_verdict) trueControl.adoptedWithMove++;
        }
      }
    }
  }

  totalPairedInstances += pairsAll.length;
  const permAll = pairedPermutation(pairsAll);
  const permElig = pairedPermutation(pairsElig);
  panels[key] = {
    label,
    n: pairsAll.length,
    blind: pairsAll.length - pairsElig.length,
    nEligible: pairsElig.length,
    iprC1: mean(pairsAll.map((p) => p.c1)),
    iprC2: mean(pairsAll.map((p) => p.c2)),
    iprC1Eligible: mean(pairsElig.map((p) => p.c1)),
    iprC2Eligible: mean(pairsElig.map((p) => p.c2)),
    delta: permAll.delta,
    deltaP: permAll.p,
    deltaEligible: permElig.delta,
    deltaEligibleP: permElig.p,
    deltaEligibleCI: bootstrapCI(pairsElig),
    trueControl,
    perModel,
    unboundedHarm: perInjection["cyber-fallacy-unbounded-harm"] || { c1: 0, c2: 0 },
    slipperySlope: perInjection["cyber-fallacy-slippery-slope-pushes-no"] || { c1: 0, c2: 0 },
  };
}

// ─── detector ROC (already computed by detector.js from the same runs) ───────
const det = JSON.parse(fs.readFileSync(path.join(EXP, "detector-results.json"), "utf8"));

// ─── assemble ────────────────────────────────────────────────────────────────
const out = {
  generated: new Date().toISOString(),
  sources: Object.values(PANELS).map((p) => p.file).concat(["detector-results.json"]),
  scorer: "src/lib/score.js (post-audit: eligible mask + verdict-guarded explicit adoption)",
  meta: {
    totalPairedInstances,
    injections: battery.injections.length,
    falseInjections: battery.injections.filter((i) => isFalse(i.truth_value)).length,
    reps: 15,
    models: {
      claude: "claude-sonnet-4-6",
      gpt: "gpt-5.5-2026-04-23",
      gemini: "gemini-3.5-flash",
    },
    preregistered: "PREREG.md, committed 2026-07-03 (before the monoculture data existed)",
  },
  panels,
  detector: {
    auc: det.auc,
    roc: det.roc,
    confidence_drift: det.operating_points?.confidence_drift,
    verdict_flip: det.operating_points?.verdict_flip,
    n_instances: det.n_instances,
    n_contaminated: det.n_contaminated,
    n_clean: det.n_clean,
  },
};

const outPath = path.join(__dirname, "poster-data.json");
fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log(`Wrote ${outPath}`);
console.log(`panels: ${Object.keys(panels).join(", ")} · total paired false-premise instances: ${totalPairedInstances}`);
for (const [k, p] of Object.entries(panels)) {
  console.log(
    `  ${k.padEnd(7)} n=${p.n} blind=${p.blind} | IPR C1 ${p.iprC1.toFixed(3)}→${p.iprC1Eligible.toFixed(3)} C2 ${p.iprC2.toFixed(3)}→${p.iprC2Eligible.toFixed(3)} | Δmeas ${p.deltaEligible.toFixed(3)} (p=${p.deltaEligibleP.toFixed(4)}) | true-ctrl ${p.trueControl.adopted}/${p.trueControl.n} (${p.trueControl.adoptedWithMove} moved) | unbounded ${p.unboundedHarm.c1}→${p.unboundedHarm.c2}`
  );
}
console.log(`detector: AUC=${out.detector.auc} vflip P=${(out.detector.verdict_flip?.precision??0).toFixed(3)} R=${(out.detector.verdict_flip?.recall??0).toFixed(3)}`);
