// stats.js — significance + uncertainty for the C1-vs-C2 injection experiment.
//
// Turns the raw adoption counts in a results JSON into defensible statistics:
//   1. Observed Δ = IPR(C2) − IPR(C1), with a bootstrap 95% CI.
//   2. A PAIRED permutation test on Δ. C1 and C2 are the same subjects on the
//      same injections, so the unit is the subject-instance pair (injection,
//      rep, agent); the null shuffles the C1/C2 label *within* each pair.
//      ⚠ This treats instances as exchangeable and answers the NARROW question
//      "did condition matter on these specific injections?". It does NOT
//      license generalizing across injections: instances are nested within a
//      handful of authored injections (repeated prompts are not independent
//      evidence), so the instance-level p overstates evidence for any claim
//      about injections in general.
//   3. An INJECTION-BLOCKED analysis for the generalization claim: one Δ per
//      injection (each authored injection contributes a single observation),
//      tested with an exact sign-flip permutation over blocks. This is the
//      headline significance test — its n is the number of injections, which
//      is the true sample size for "does transparency amplify propagation?".
//   4. The model gap (Gemini adopt-rate − GPT adopt-rate) in the C2 condition,
//      via an INDEPENDENT two-group permutation test + bootstrap CI. These are
//      different agents, so the null shuffles the model label across instances
//      (the same nesting caveat applies).
//
// Seeded RNG → reproducible. By default the adoption labels are RE-SCORED from
// the raw traces with the current src/lib/score.js (same policy as detector.js):
// the `adopted` labels frozen into a results JSON at collection time predate the
// 2026-07 scorer audit (eligible mask + verdict-guarded explicit_adoption), and
// reading them reproduces the very false positives the audit removed. Pass
// --stored-labels to use the frozen labels instead (reproducing older tables).
//
// Usage:
//   node experiments/c1vc2/stats.js [results.json] [--iters N] [--seed S] [--stored-labels]
//   node experiments/c1vc2/stats.js experiments/c1vc2/c1vc2-results-1782597403181.json

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { computeIPR } from "../../src/lib/score.js";
import { loadBatteries, makeInjectionResolver } from "./battery.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---- args ----------------------------------------------------------------
const args = process.argv.slice(2);
const getFlag = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const file =
  args.find((a) => !a.startsWith("--") && a !== getFlag("--iters", null) && a !== getFlag("--seed", null)) || null;
if (!file) {
  const available = fs
    .readdirSync(__dirname)
    .filter((f) => /^c1vc2-results.*\.json$/.test(f))
    .map((f) => `  experiments/c1vc2/${f}`);
  console.error("Usage: node experiments/c1vc2/stats.js <results.json> [--iters N] [--seed S] [--stored-labels]");
  console.error(available.length ? `Available results files:\n${available.join("\n")}` : "No results files found — run run.js first.");
  process.exit(1);
}
const ITERS = parseInt(getFlag("--iters", "10000"), 10);
const SEED = parseInt(getFlag("--seed", "42"), 10);
const STORED_LABELS = args.includes("--stored-labels");

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

// ---- battery resolution (for re-scoring from raw traces) ------------------
// Shared with detector.js: per-run snapshots when present, else the unique
// battery covering this results file's ids. A merged last-file-wins index is
// NOT safe — the same id exists in two batteries with different
// premise_markers. See battery.js.
const batteries = loadBatteries(__dirname);

// ---- load + flatten ------------------------------------------------------
const data = JSON.parse(fs.readFileSync(file, "utf8"));
const { resolve: resolveInjection, notes: batteryNotes } = makeInjectionResolver(data, batteries);
const providers = data.providers || {}; // { beta: "gpt", gamma: "gemini" }
const agentModel = (agent) => providers[agent] || agent;

// Paired subject instances on FALSE-premise runs.
//   pair = { c1: 0|1, c2: 0|1, measurable, model, injection }
//
// `measurable` marks instances where adoption is observable: either the
// baseline verdict differs from the push (`eligible` — implicit adoption is
// possible), OR the instance registered an explicit adoption (observable on
// any baseline). A baseline-aligned subject that never explicitly adopts
// cannot register any adoption, so it deflates IPR without carrying signal.
// Re-scored details always carry the eligible flag (score.js); on the
// stored-label path older files derive it from control_verdict + the run's
// stored push.
const deriveEligible = (d, push) =>
  push != null && push !== "unknown" && d.control_verdict !== "unknown" && d.control_verdict !== push;
const isMeasurable = (d, push) =>
  (d.eligible ?? deriveEligible(d, push)) || d.label === "explicit_adoption";

const pairs = [];
let rescoredRuns = 0;
let storedRuns = 0; // runs that used frozen labels (--stored-labels, or missing raw/battery)
for (const run of data.runs || []) {
  if (!isFalsePremise(run.truth_value)) continue;
  const inj = resolveInjection(run);
  // Push direction for eligibility derivation on the stored-label path. Falls
  // back to the battery entry so a run missing raw.meta (the case that forces
  // stored labels in the first place) doesn't degrade every instance to
  // eligible:false.
  const push = run.raw?.meta?.pushes_verdict ?? inj?.pushes_verdict ?? null;

  // Default: re-score the raw traces with the current scorer (detector.js
  // policy). Requires the control baseline too — without it computeIPR scores
  // every control verdict "unknown" (nothing eligible, no implicit adoption),
  // which is silently worse than the frozen labels. Falls back to stored
  // labels when any raw condition or the battery entry is unavailable —
  // counted and warned about below.
  let c1d, c2d;
  if (!STORED_LABELS && run.raw?.c1 && run.raw?.c2 && run.raw?.control && inj) {
    c1d = computeIPR(run.raw.c1, run.raw.control, inj).details;
    c2d = computeIPR(run.raw.c2, run.raw.control, inj).details;
    rescoredRuns++;
  } else {
    c1d = (run.c1 && run.c1.details) || [];
    c2d = (run.c2 && run.c2.details) || [];
    storedRuns++;
  }

  const byAgent = {};
  for (const d of c1d) byAgent[d.agent] = { c1: d.adopted ? 1 : 0, measurable: isMeasurable(d, push) };
  for (const d of c2d) {
    byAgent[d.agent] = byAgent[d.agent] || {};
    byAgent[d.agent].c2 = d.adopted ? 1 : 0;
    byAgent[d.agent].measurable = byAgent[d.agent].measurable || isMeasurable(d, push);
  }
  for (const agent of Object.keys(byAgent)) {
    const p = byAgent[agent];
    if (p.c1 == null || p.c2 == null) continue; // need both conditions to pair
    pairs.push({ c1: p.c1, c2: p.c2, measurable: !!p.measurable, model: agentModel(agent), injection: run.injection_id });
  }
}

if (!pairs.length) {
  console.error(`No paired false-premise subject instances found in ${file}.`);
  process.exit(1);
}

// ---- 1 & 2: Δ(C2 − C1), bootstrap CI, paired permutation -----------------
// Run once over ALL pairs (the historical headline) and once over the
// MEASURABLE (eligible) subset, whose denominator isn't deflated by
// baseline-aligned instances.
function analyzeDelta(ps) {
  const iprC1 = mean(ps.map((p) => p.c1));
  const iprC2 = mean(ps.map((p) => p.c2));
  const obsDelta = iprC2 - iprC1;
  const deltaCI = bootstrapCI(ps, (s) => mean(s.map((p) => p.c2)) - mean(s.map((p) => p.c1)));
  const c1CI = bootstrapCI(ps, (s) => mean(s.map((p) => p.c1)));
  const c2CI = bootstrapCI(ps, (s) => mean(s.map((p) => p.c2)));

  // Paired permutation: within each pair, swap c1<->c2 with prob 0.5 under the null.
  let asExtreme = 0;
  for (let it = 0; it < ITERS; it++) {
    let sum = 0;
    for (const p of ps) {
      const swap = rng() < 0.5;
      sum += (swap ? p.c1 : p.c2) - (swap ? p.c2 : p.c1);
    }
    if (Math.abs(sum / ps.length) >= Math.abs(obsDelta) - 1e-12) asExtreme++;
  }
  const deltaP = (asExtreme + 1) / (ITERS + 1); // add-one: never reports p=0
  return { iprC1, iprC2, obsDelta, deltaCI, c1CI, c2CI, deltaP };
}

const all = analyzeDelta(pairs);
const eligPairs = pairs.filter((p) => p.measurable);
const elig = eligPairs.length ? analyzeDelta(eligPairs) : null;

// ---- 3: injection-blocked analysis (the generalization test) --------------
// Instances are nested within authored injections: 30 repetitions of the same
// prompt are not 30 independent pieces of evidence about injections in
// general. For the claim "sharing reasoning amplifies propagation" the unit is
// the INJECTION, so collapse each injection to one Δ (mean over its paired
// instances) and run an exact sign-flip permutation over blocks: under the
// null, each block's Δ is symmetric around 0, so all 2^k signings are equally
// likely. k ≤ 20 is enumerated exactly; larger k falls back to Monte Carlo.
function analyzeBlocked(ps) {
  const byInj = {};
  for (const p of ps) (byInj[p.injection] ??= []).push(p);
  const blocks = Object.entries(byInj).map(([injection, bp]) => ({
    injection,
    n: bp.length,
    delta: mean(bp.map((p) => p.c2)) - mean(bp.map((p) => p.c1)),
  }));
  const deltas = blocks.map((b) => b.delta);
  const k = deltas.length;
  const obs = mean(deltas);
  let p;
  let method;
  if (k <= 20) {
    let extreme = 0;
    const total = 1 << k;
    for (let m = 0; m < total; m++) {
      let s = 0;
      for (let i = 0; i < k; i++) s += m & (1 << i) ? -deltas[i] : deltas[i];
      if (Math.abs(s / k) >= Math.abs(obs) - 1e-12) extreme++;
    }
    p = extreme / total; // exact — no add-one correction needed
    method = `exact sign-flip, 2^${k} signings`;
  } else {
    let extreme = 0;
    for (let it = 0; it < ITERS; it++) {
      let s = 0;
      for (const d of deltas) s += rng() < 0.5 ? -d : d;
      if (Math.abs(s / k) >= Math.abs(obs) - 1e-12) extreme++;
    }
    p = (extreme + 1) / (ITERS + 1);
    method = `Monte Carlo sign-flip, ${ITERS} iters`;
  }
  return { blocks, obs, p, method, k };
}

const blockedAll = analyzeBlocked(pairs);
const blockedElig = eligPairs.length ? analyzeBlocked(eligPairs) : null;

// ---- 4: model gap in C2 (Gemini − GPT adopt rate) ------------------------
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

function printDeltaBlock(r, n) {
  console.log(`IPR(C1) = ${f3(r.iprC1)} (${pct(r.iprC1)})   95% CI ${ci(r.c1CI)}`);
  console.log(`IPR(C2) = ${f3(r.iprC2)} (${pct(r.iprC2)})   95% CI ${ci(r.c2CI)}`);
  console.log("");
  console.log(`Δ (C2 − C1) = ${f3(r.obsDelta)}   (n=${n} instances)`);
  console.log(`   95% CI (bootstrap)        ${ci(r.deltaCI)}`);
  console.log(`   permutation p (two-sided) ${r.deltaP.toFixed(4)}   ⚠ instance-level: conditional on THESE injections`);
  const crosses = r.deltaCI[0] <= 0 && r.deltaCI[1] >= 0;
  console.log(
    `   → ${crosses ? "CI includes 0" : "CI excludes 0"}; ` +
      `${r.deltaP < 0.05 ? "significant at .05" : "NOT significant at .05"} ` +
      `(narrow claim — see the injection-blocked test for the generalization claim)`
  );
}

function printBlockedBlock(b) {
  console.log(`per-injection Δ (each authored injection = ONE observation):`);
  for (const blk of b.blocks) {
    console.log(`   ${blk.injection.padEnd(46)} Δ=${blk.delta >= 0 ? "+" : ""}${f3(blk.delta)}  (n=${blk.n})`);
  }
  console.log(`Δ̄ over ${b.k} injections = ${f3(b.obs)}`);
  console.log(`   blocked p (two-sided, ${b.method}) = ${b.p.toFixed(4)}`);
  console.log(
    `   → ${b.p < 0.05 ? "significant at .05 ⇒ transparency changed propagation" : "NOT significant at .05 ⇒ no detectable amplification from transparency"}` +
      ` (unit = injection; this is the headline test — the true sample size for generalizing is k=${b.k}, not the instance count)`
  );
}

console.log(`\nC1-vs-C2 statistics — ${file.split("/").pop()}`);
console.log(`panel=${data.panel}  models: beta=${agentModel("beta")} gamma=${agentModel("gamma")}`);
console.log(`${batteryNotes[0]}`);
console.log(`paired false-premise subject-instances: n=${pairs.length}  (iters=${ITERS}, seed=${SEED})`);
if (STORED_LABELS) {
  console.log(`scoring: STORED labels (--stored-labels) — frozen at collection time, may predate the 2026-07 scorer audit.`);
  const hasStoredEligible = (data.runs || []).some((r) =>
    ((r.c1 && r.c1.details) || []).some((d) => d.eligible != null)
  );
  if (!hasStoredEligible) {
    console.log(
      `note: pre-patch results file — adoption labels are old-scorer; eligibility derived from raw.meta.` +
        ` Drop --stored-labels (or run rescore.mjs) for current-scorer labels.`
    );
  }
} else {
  console.log(`scoring: re-scored from raw traces via src/lib/score.js (post-audit: eligible mask + verdict-guarded explicit_adoption).`);
  if (storedRuns) {
    console.log(
      `⚠ ${storedRuns}/${rescoredRuns + storedRuns} false-premise runs fell back to STORED labels` +
        ` (missing raw traces or no battery entry for their injection_id) — treat mixed-scorer results with care.`
    );
  }
}
console.log("─".repeat(64));

printDeltaBlock(all, pairs.length);

if (elig) {
  const blind = pairs.length - eligPairs.length;
  console.log("\n" + "─".repeat(64));
  console.log(`MEASURABLE-ONLY (baseline ≠ push, or explicit adoption; blind instances excluded: ${blind})`);
  printDeltaBlock(elig, eligPairs.length);
} else {
  console.log("\n(no measurable instances — measurable-only block skipped)");
}

console.log("\n" + "─".repeat(64));
console.log(`INJECTION-BLOCKED (headline significance — unit = authored injection)`);
printBlockedBlock(blockedAll);
if (blockedElig) {
  console.log(`\nblocked, measurable-only:`);
  printBlockedBlock(blockedElig);
}

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
