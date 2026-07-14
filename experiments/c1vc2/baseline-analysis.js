#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// Spontaneous-flip correction for implicit adoption.
//
//   node experiments/c1vc2/baseline-analysis.js <c1vc2-results.json>
//        [--baseline <control-baseline.json>] [--iters N] [--seed S] [--out <path>]
//
// The problem (2026-07-14 methodology review): implicit adoption is scored as
// "verdict == push AND that rep's single control draw != push". A model whose
// verdict is simply UNSTABLE on a question produces exactly that pattern with
// no peer influence: if its isolated draws land on the push with probability
// p, then under the null (peer context changes nothing) an eligible instance
// "adopts" with probability p. Measured adoption therefore mixes genuine
// premise uptake with baseline instability, and is an upper bound.
//
// This script estimates p per (injection, subject) from repeated NO-PEER
// draws and asks: does measured eligible adoption exceed what instability
// alone predicts?
//
//   E[adoptions | null] = Σ over eligible cells p(cell)
//   p-value = P(K* >= K_observed), K* = Σ Bernoulli(p(cell)),
//   Monte Carlo with a seeded RNG (mulberry32, same primitive as stats.js).
//   A second, uncertainty-integrated p-value re-samples each p from a
//   Jeffreys posterior Beta(k+1/2, m−k+1/2) every iteration, so a p̂ estimated
//   from only ~15 draws isn't treated as exact.
//
// Where the no-peer draws come from:
//   --baseline <file>  a dedicated control-baseline.js run (independent
//                      sample — the preferred source).
//   (omitted)          harvested from the results file itself: run.js draws a
//                      fresh isolated R1 every rep, so a 15-rep results file
//                      already contains 15 independent no-peer draws per
//                      (injection, agent). Expectations then use LEAVE-ONE-OUT
//                      (the conditioning rep's own draw is excluded from its
//                      p̂) to avoid conditioning bias.
//
// The true-premise control injection is reported in its own section: the same
// correction applies to the "updates toward truth" claim.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { computeIPR, extractVerdict, normalizeVerdict } from "../../src/lib/score.js";
import { loadBatteries, makeInjectionResolver } from "./battery.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── args ───────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const getFlag = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const flagVals = new Set(["--baseline", "--iters", "--seed", "--out"].map((f) => getFlag(f, null)).filter(Boolean));
const file = args.find((a) => !a.startsWith("--") && !flagVals.has(a)) || null;
if (!file) {
  console.error("Usage: node experiments/c1vc2/baseline-analysis.js <c1vc2-results.json> [--baseline <control-baseline.json>] [--iters N] [--seed S] [--out <path>]");
  process.exit(1);
}
const baselineFile = getFlag("--baseline", null);
const ITERS = parseInt(getFlag("--iters", "10000"), 10);
const SEED = parseInt(getFlag("--seed", "42"), 10);
const outPath = getFlag("--out", path.join(__dirname, "baseline-analysis-results.json"));

// ─── seeded RNG (mulberry32, same as stats.js) ───────────────────────────────
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
const rng = makeRng(SEED);

// Jeffreys-posterior sample via two gamma draws (Marsaglia–Tsang would be
// overkill; sum-of-exponentials works for shape >= 0.5 poorly, so use the
// simple rejection-free Cheng BB/BC is also overkill — for our small shapes a
// ratio of gamma draws via Ahrens–Dieter is unnecessary precision. Instead use
// the inverse-CDF-free trick: Beta(a,b) ~ Ga/(Ga+Gb) with Marsaglia–Tsang for
// shape >= 1 after boosting, standard and compact.)
function sampleGamma(shape, rnd) {
  if (shape < 1) {
    // boost: Ga(a) = Ga(a+1) * U^(1/a)
    const u = rnd();
    return sampleGamma(shape + 1, rnd) * Math.pow(u, 1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x, v;
    do {
      // Box–Muller normal from two uniforms
      const u1 = rnd() || 1e-12;
      const u2 = rnd();
      x = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = rnd();
    if (u < 1 - 0.0331 * x * x * x * x) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}
function sampleBeta(a, b, rnd) {
  const x = sampleGamma(a, rnd);
  const y = sampleGamma(b, rnd);
  return x / (x + y);
}

// ─── load ────────────────────────────────────────────────────────────────────
const isFalsePremise = (tv) => tv === false || tv === "false";
const batteries = loadBatteries(__dirname);
const data = JSON.parse(fs.readFileSync(file, "utf8"));
const { resolve: resolveInjection, notes: batteryNotes } = makeInjectionResolver(data, batteries);
const providers = data.providers || {};
const modelOf = (agent) => providers[agent] || agent;

// ─── no-peer draw collection ─────────────────────────────────────────────────
// drawsBy[injId][agent] = { verdicts: [ "yes"|"no"|"conditional"|"unknown", ... ], source }
const drawsBy = {};
function addDraw(injId, agent, verdict) {
  drawsBy[injId] = drawsBy[injId] || {};
  drawsBy[injId][agent] = drawsBy[injId][agent] || [];
  drawsBy[injId][agent].push(verdict);
}

let baselineMeta = null;
if (baselineFile) {
  const bl = JSON.parse(fs.readFileSync(baselineFile, "utf8"));
  if (bl.experiment !== "arm-c1vc2-control-baseline") {
    console.error(`--baseline file is not a control-baseline.js output (experiment=${bl.experiment}).`);
    process.exit(1);
  }
  // Guard against apples-to-oranges: the baseline must cover the same models.
  for (const [agent, prov] of Object.entries(providers)) {
    if (bl.providers?.[agent] && bl.providers[agent] !== prov) {
      console.error(`⚠ provider mismatch for ${agent}: results=${prov}, baseline=${bl.providers[agent]} — the null rates would describe a different model. Aborting.`);
      process.exit(1);
    }
  }
  for (const run of bl.runs || []) {
    if (run.error) continue;
    for (const s of run.subjects || []) addDraw(run.injection_id, s.agent, extractVerdict(s.trace));
  }
  baselineMeta = { file: path.basename(baselineFile), battery: bl.battery, draws: bl.draws, timestamp: bl.timestamp };
} else {
  // Harvest from the results file's own per-rep control draws.
  for (const run of data.runs || []) {
    if (run.error || !run.raw?.control) continue;
    for (const s of run.raw.control.subjects || []) addDraw(run.injection_id, s.agent, extractVerdict(s.trace));
  }
}

// ─── per-(injection, agent) null rates ───────────────────────────────────────
// stat = { m: known draws, k: draws on the push, unknown }
function drawStats(injId, agent, push) {
  const list = drawsBy[injId]?.[agent] || [];
  const known = list.filter((v) => v !== "unknown");
  return { m: known.length, k: known.filter((v) => v === push).length, unknown: list.length - known.length };
}

// ─── measured eligible adoption vs null expectation ──────────────────────────
// One cell per (run rep, condition, agent) that is ELIGIBLE (its own control
// draw != push). Under the null, the cell adopts with probability p:
//   external baseline:  p = k/m            (independent sample)
//   own-file (LOO):     p = k/(m−1)        (this rep's own draw — known and
//                       != push, so it contributed to m but not to k — is
//                       excluded from its own expectation)
const LOO = !baselineFile;
const cells = []; // { inj, agent, model, cond, truth, adopted, p, pBeta: {a,b} }
const skipped = [];
for (const run of data.runs || []) {
  if (run.error || !run.raw?.control) continue;
  const inj = resolveInjection(run);
  if (!inj) {
    skipped.push(`${run.injection_id} (no battery entry)`);
    continue;
  }
  const push = normalizeVerdict(inj.pushes_verdict);
  if (push === "unknown") continue;
  const truth = isFalsePremise(run.truth_value) ? "false" : "true";
  for (const cond of ["c1", "c2"]) {
    if (!run.raw[cond]) continue;
    const scored = computeIPR(run.raw[cond], run.raw.control, inj);
    for (const d of scored.details) {
      if (!d.eligible) continue; // implicit adoption is only defined on eligible cells
      const { m, k } = drawStats(run.injection_id, d.agent, push);
      const denom = LOO ? m - 1 : m;
      if (denom < 1) {
        skipped.push(`${run.injection_id}/${d.agent} (only ${m} known draw${m === 1 ? "" : "s"})`);
        continue;
      }
      cells.push({
        inj: run.injection_id,
        agent: d.agent,
        model: modelOf(d.agent),
        cond,
        truth,
        adopted: d.adopted ? 1 : 0,
        p: k / denom,
        // Jeffreys posterior over the underlying rate (uses the full m,k —
        // the LOO adjustment matters for the point expectation, not for the
        // posterior of the rate itself).
        beta: { a: k + 0.5, b: m - k + 0.5 },
      });
    }
  }
}

if (!cells.length) {
  console.error("No eligible cells found — nothing to analyze.");
  process.exit(1);
}

// ─── draw-to-draw instability (descriptive) ──────────────────────────────────
// Pairwise disagreement rate across a cell group's no-peer draws: the
// probability two independent draws of the same model on the same question
// disagree. High values mean "this question is a coin flip for this model" —
// the condition under which single-draw implicit adoption is least meaningful.
function pairwiseDisagreement(list) {
  const known = list.filter((v) => v !== "unknown");
  const n = known.length;
  if (n < 2) return null;
  const counts = {};
  for (const v of known) counts[v] = (counts[v] || 0) + 1;
  const same = Object.values(counts).reduce((s, c) => s + (c * (c - 1)) / 2, 0);
  return 1 - same / ((n * (n - 1)) / 2);
}

// ─── pooled Monte Carlo test per (model, truth, cond) ────────────────────────
function mcTest(group) {
  const K = group.reduce((s, c) => s + c.adopted, 0);
  const E = group.reduce((s, c) => s + c.p, 0);
  // fixed-p̂ MC
  let ge = 0;
  for (let it = 0; it < ITERS; it++) {
    let sum = 0;
    for (const c of group) if (rng() < c.p) sum++;
    if (sum >= K) ge++;
  }
  // uncertainty-integrated MC: one Beta sample per (inj, agent) per iteration,
  // shared across that group's cells (the same underlying rate generated them).
  let geBeta = 0;
  for (let it = 0; it < ITERS; it++) {
    const pSample = {};
    let sum = 0;
    for (const c of group) {
      const key = `${c.inj}|${c.agent}`;
      if (pSample[key] == null) pSample[key] = sampleBeta(c.beta.a, c.beta.b, rng);
      if (rng() < pSample[key]) sum++;
    }
    if (sum >= K) geBeta++;
  }
  return {
    n_eligible: group.length,
    observed: K,
    expected: E,
    excess: K - E,
    p_mc: (ge + 1) / (ITERS + 1),
    p_mc_beta: (geBeta + 1) / (ITERS + 1),
  };
}

// ─── report ──────────────────────────────────────────────────────────────────
const f3 = (x) => (x == null ? "  —  " : x.toFixed(3));
const f1p = (x) => (x == null ? "—" : (x * 100).toFixed(1) + "%");

console.log(`\nSpontaneous-flip baseline analysis — ${path.basename(file)}`);
console.log(batteryNotes[0]);
console.log(
  baselineMeta
    ? `no-peer draws: EXTERNAL baseline ${baselineMeta.file} (battery=${baselineMeta.battery}, draws=${baselineMeta.draws}, ${baselineMeta.timestamp})`
    : `no-peer draws: harvested from this results file's own per-rep controls (leave-one-out expectations)`
);
console.log(`iters=${ITERS} seed=${SEED}`);
if (skipped.length) console.log(`⚠ skipped: ${[...new Set(skipped)].join("; ")}`);
console.log("─".repeat(72));

const models = [...new Set(cells.map((c) => c.model))].sort();
const injIds = [...new Set(cells.map((c) => c.inj))];
const output = { analysis: "arm-c1vc2-spontaneous-flip-correction", timestamp: new Date().toISOString(), source: path.basename(file), baseline: baselineMeta, loo: LOO, iters: ITERS, seed: SEED, per_injection: [], pooled: [] };

for (const truth of ["false", "true"]) {
  const tCells = cells.filter((c) => c.truth === truth);
  if (!tCells.length) continue;
  console.log(`\n══ ${truth === "false" ? "FALSE premises (contamination)" : "TRUE-premise control (updating toward truth)"} ══`);

  // per-injection descriptive table
  console.log(`\nper-injection (p̂ = spontaneous P(no-peer draw lands on the push)):`);
  for (const inj of injIds) {
    const iCells = tCells.filter((c) => c.inj === inj);
    if (!iCells.length) continue;
    for (const model of models) {
      const g = iCells.filter((c) => c.model === model);
      if (!g.length) continue;
      const agents = [...new Set(g.map((c) => c.agent))];
      const byCondTxt = ["c1", "c2"]
        .map((cond) => {
          const cc = g.filter((c) => c.cond === cond);
          if (!cc.length) return `${cond.toUpperCase()}: —`;
          const K = cc.reduce((s, c) => s + c.adopted, 0);
          const E = cc.reduce((s, c) => s + c.p, 0);
          return `${cond.toUpperCase()}: ${K} obs / ${E.toFixed(1)} exp (n=${cc.length})`;
        })
        .join("   ");
      const pAvg = g.reduce((s, c) => s + c.p, 0) / g.length;
      const disagree = pairwiseDisagreement(agents.flatMap((a) => drawsBy[inj]?.[a] || []));
      console.log(`  ${inj.padEnd(46)} ${model.padEnd(7)} p̂≈${f1p(pAvg)} flip₂=${f1p(disagree)}  ${byCondTxt}`);
      output.per_injection.push({ injection: inj, model, truth, p_hat_mean: pAvg, pairwise_disagreement: disagree });
    }
  }

  // pooled tests
  console.log(`\npooled (Monte Carlo, one-sided: is observed adoption ABOVE the spontaneous-flip null?):`);
  for (const model of models) {
    for (const cond of ["c1", "c2"]) {
      const g = tCells.filter((c) => c.model === model && c.cond === cond);
      if (!g.length) continue;
      const r = mcTest(g);
      console.log(
        `  ${model.padEnd(7)} ${cond.toUpperCase()}  observed=${r.observed}  expected(spontaneous)=${r.expected.toFixed(1)}  excess=${r.excess >= 0 ? "+" : ""}${r.excess.toFixed(1)}  p=${r.p_mc.toFixed(4)}  p(β-integrated)=${r.p_mc_beta.toFixed(4)}  (n=${r.n_eligible})`
      );
      output.pooled.push({ model, cond, truth, ...r });
    }
  }
}

console.log(`\nReading it:`);
console.log(`  excess ≈ 0 / p large  → measured "adoption" is what baseline instability alone predicts;`);
console.log(`                          no evidence of premise uptake beyond noise.`);
console.log(`  excess > 0 / p small  → adoption above the spontaneous-flip rate; genuine peer influence.`);
console.log(`  flip₂ = P(two independent no-peer draws disagree) — where it is high, single-draw`);
console.log(`  implicit adoption is least meaningful and this correction matters most.`);
if (LOO) {
  console.log(`\n⚠ own-file mode: null rates come from the SAME session as the measurements (leave-one-out`);
  console.log(`  removes conditioning bias but not session-level drift). For publication, prefer an`);
  console.log(`  independent sample: node experiments/c1vc2/control-baseline.js`);
}

fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
console.log(`\nSaved: ${outPath}\n`);
