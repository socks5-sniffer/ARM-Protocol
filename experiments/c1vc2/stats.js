// stats.js — significance + uncertainty for the C1-vs-C2 injection experiment.
//
// Turns the raw adoption counts in a results JSON into defensible statistics:
//   1. Observed Δ = IPR(C2) − IPR(C1), with a bootstrap 95% CI.
//   2. A PAIRED permutation test on Δ. C1 and C2 are the same subjects on the
//      same injections, so the unit is the subject-instance pair (injection,
//      rep, agent); the null shuffles the C1/C2 label *within* each pair.
//   3. The model gap (Gemini adopt-rate − GPT adopt-rate) in the C2 condition,
//      via an INDEPENDENT two-group permutation test + bootstrap CI. These are
//      different agents, so the null shuffles the model label across instances.
//
// Dependency-free on purpose (mirrors score.js). Seeded RNG → reproducible.
//
// Usage:
//   node experiments/c1vc2/stats.js [results.json] [--iters N] [--seed S]
//   node experiments/c1vc2/stats.js experiments/c1vc2/c1vc2-results-1782597403181.json

import fs from "node:fs";

// ---- args ----------------------------------------------------------------
const args = process.argv.slice(2);
const getFlag = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const file =
  args.find((a) => !a.startsWith("--") && a !== getFlag("--iters", null) && a !== getFlag("--seed", null)) ||
  "experiments/c1vc2/c1vc2-results-1782597403181.json";
const ITERS = parseInt(getFlag("--iters", "10000"), 10);
const SEED = parseInt(getFlag("--seed", "42"), 10);

// ---- seeded RNG (mulberry32) so reported p-values/CIs are reproducible ----
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

// ---- helpers -------------------------------------------------------------
const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
const isFalsePremise = (tv) => tv === false || tv === "false";

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

// Bootstrap a 95% CI for a statistic computed over an array of items.
function bootstrapCI(items, statFn, iters = ITERS) {
  const dist = [];
  const n = items.length;
  for (let b = 0; b < iters; b++) {
    const sample = new Array(n);
    for (let i = 0; i < n; i++) sample[i] = items[(rng() * n) | 0];
    dist.push(statFn(sample));
  }
  dist.sort((a, b) => a - b);
  return [percentile(dist, 0.025), percentile(dist, 0.975)];
}

// ---- load + flatten ------------------------------------------------------
const data = JSON.parse(fs.readFileSync(file, "utf8"));
const providers = data.providers || {}; // { beta: "gpt", gamma: "gemini" }
const agentModel = (agent) => providers[agent] || agent;

// Paired subject instances on FALSE-premise runs.
//   pair = { c1: 0|1, c2: 0|1, model, injection }
const pairs = [];
for (const run of data.runs || []) {
  if (!isFalsePremise(run.truth_value)) continue;
  const c1d = (run.c1 && run.c1.details) || [];
  const c2d = (run.c2 && run.c2.details) || [];
  const byAgent = {};
  for (const d of c1d) byAgent[d.agent] = { c1: d.adopted ? 1 : 0 };
  for (const d of c2d) {
    byAgent[d.agent] = byAgent[d.agent] || {};
    byAgent[d.agent].c2 = d.adopted ? 1 : 0;
  }
  for (const agent of Object.keys(byAgent)) {
    const p = byAgent[agent];
    if (p.c1 == null || p.c2 == null) continue; // need both conditions to pair
    pairs.push({ c1: p.c1, c2: p.c2, model: agentModel(agent), injection: run.injection_id });
  }
}

if (!pairs.length) {
  console.error(`No paired false-premise subject instances found in ${file}.`);
  process.exit(1);
}

// ---- 1 & 2: Δ(C2 − C1), bootstrap CI, paired permutation -----------------
const c1Vals = pairs.map((p) => p.c1);
const c2Vals = pairs.map((p) => p.c2);
const iprC1 = mean(c1Vals);
const iprC2 = mean(c2Vals);
const obsDelta = iprC2 - iprC1;

const deltaCI = bootstrapCI(pairs, (s) => mean(s.map((p) => p.c2)) - mean(s.map((p) => p.c1)));
const c1CI = bootstrapCI(pairs, (s) => mean(s.map((p) => p.c1)));
const c2CI = bootstrapCI(pairs, (s) => mean(s.map((p) => p.c2)));

// Paired permutation: within each pair, swap c1<->c2 with prob 0.5 under the null.
let asExtreme = 0;
for (let it = 0; it < ITERS; it++) {
  let sum = 0;
  for (const p of pairs) {
    const swap = rng() < 0.5;
    sum += (swap ? p.c1 : p.c2) - (swap ? p.c2 : p.c1);
  }
  if (Math.abs(sum / pairs.length) >= Math.abs(obsDelta) - 1e-12) asExtreme++;
}
const deltaP = (asExtreme + 1) / (ITERS + 1); // add-one: never reports p=0

// ---- 3: model gap in C2 (Gemini − GPT adopt rate) ------------------------
const models = [...new Set(pairs.map((p) => p.model))];
let modelBlock = null;
if (models.length === 2) {
  // Order so the higher-adoption model is reported first (gap is signed accordingly).
  const rate = (m) => mean(pairs.filter((p) => p.model === m).map((p) => p.c2));
  const [mHi, mLo] = rate(models[0]) >= rate(models[1]) ? [models[0], models[1]] : [models[1], models[0]];
  const instances = pairs.map((p) => ({ model: p.model, c2: p.c2 }));
  const gapStat = (s) =>
    mean(s.filter((p) => p.model === mHi).map((p) => p.c2)) -
    mean(s.filter((p) => p.model === mLo).map((p) => p.c2));
  const obsGap = gapStat(instances);
  const gapCI = bootstrapCI(instances, gapStat);

  // Independent permutation: shuffle model labels across instances.
  const labels = instances.map((p) => p.model);
  let gapExtreme = 0;
  for (let it = 0; it < ITERS; it++) {
    // Fisher–Yates shuffle of labels
    for (let i = labels.length - 1; i > 0; i--) {
      const j = (rng() * (i + 1)) | 0;
      [labels[i], labels[j]] = [labels[j], labels[i]];
    }
    let hiSum = 0, hiN = 0, loSum = 0, loN = 0;
    for (let i = 0; i < instances.length; i++) {
      if (labels[i] === mHi) { hiSum += instances[i].c2; hiN++; }
      else { loSum += instances[i].c2; loN++; }
    }
    const g = (hiN ? hiSum / hiN : 0) - (loN ? loSum / loN : 0);
    if (Math.abs(g) >= Math.abs(obsGap) - 1e-12) gapExtreme++;
  }
  modelBlock = {
    mHi, mLo,
    rateHi: rate(mHi), rateLo: rate(mLo),
    obsGap, gapCI,
    p: (gapExtreme + 1) / (ITERS + 1),
    nHi: pairs.filter((p) => p.model === mHi).length,
    nLo: pairs.filter((p) => p.model === mLo).length,
  };
}

// ---- report --------------------------------------------------------------
const pct = (x) => (x * 100).toFixed(1) + "%";
const f3 = (x) => x.toFixed(3);
const ci = ([lo, hi]) => `[${f3(lo)}, ${f3(hi)}]`;

console.log(`\nC1-vs-C2 statistics — ${file.split("/").pop()}`);
console.log(`panel=${data.panel}  models: beta=${agentModel("beta")} gamma=${agentModel("gamma")}`);
console.log(`paired false-premise subject-instances: n=${pairs.length}  (iters=${ITERS}, seed=${SEED})`);
console.log("─".repeat(64));

console.log(`IPR(C1) = ${f3(iprC1)} (${pct(iprC1)})   95% CI ${ci(c1CI)}`);
console.log(`IPR(C2) = ${f3(iprC2)} (${pct(iprC2)})   95% CI ${ci(c2CI)}`);
console.log("");
console.log(`Δ (C2 − C1) = ${f3(obsDelta)}`);
console.log(`   95% CI (bootstrap)        ${ci(deltaCI)}`);
console.log(`   permutation p (two-sided) ${deltaP.toFixed(4)}`);
const crosses = deltaCI[0] <= 0 && deltaCI[1] >= 0;
console.log(
  `   → ${crosses ? "CI includes 0" : "CI excludes 0"}; ` +
    `${deltaP < 0.05 ? "significant at .05" : "NOT significant at .05"} ` +
    `⇒ ${deltaP < 0.05 ? "transparency changed propagation" : "no detectable amplification from transparency"}`
);

if (modelBlock) {
  const m = modelBlock;
  console.log("\n" + "─".repeat(64));
  console.log(`Model gap in C2 (false premises): ${m.mHi} − ${m.mLo}`);
  console.log(`   ${m.mHi} adopt-rate = ${f3(m.rateHi)} (n=${m.nHi})`);
  console.log(`   ${m.mLo} adopt-rate = ${f3(m.rateLo)} (n=${m.nLo})`);
  console.log(`   gap = ${f3(m.obsGap)}   95% CI ${ci(m.gapCI)}   permutation p = ${m.p.toFixed(4)}`);
  console.log(
    `   → ${m.gapCI[0] > 0 || m.gapCI[1] < 0 ? "CI excludes 0" : "CI includes 0"}; ` +
      `${m.p < 0.05 ? "significant" : "not significant"} model-level difference`
  );
}
console.log("");
