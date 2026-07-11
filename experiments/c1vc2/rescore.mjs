// Re-score the committed C1-vs-C2 result JSONs with the patched scorer.
//
// The result files carry full `raw` traces, so re-scoring is exact and offline
// (no API keys, no model calls). This applies the hardened score.js
// (eligible mask + verdict-guarded explicit_adoption) to the raw traces and
// reports, per panel:
//   - IPR(C1/C2) as reported (all instances) vs measurable-only (eligible)
//   - Δ(C2−C1) for both, with a seeded paired permutation p (mirrors stats.js)
//   - explicit_adoption on FALSE premises: old (stored in JSON) vs new
//   - TRUE-control adoption: old vs new, split by whether the verdict moved
//
// Usage: node experiments/c1vc2/rescore.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { classifyAgent, computeIPR } from "../../src/lib/score.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dir = __dirname;
const battery = JSON.parse(fs.readFileSync(path.join(dir, "injections-logical.json"), "utf8"));
const injById = {};
for (const i of battery.injections) injById[i.id] = i;
const isFalse = (tv) => tv === false || tv === "false";
const isTrue = (tv) => tv === true || tv === "true";

const files = {
  "mixed (GPT+Gemini)": "c1vc2-results-panel-injectionsLogical.json",
  "all-Claude": "c1vc2-results-allClaude.json",
  "all-GPT": "c1vc2-results-allGPT.json",
  "all-Gemini": "c1vc2-results-allGemini.json",
};

// seeded RNG (mulberry32) — same primitive as stats.js
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
const f3 = (x) => (x == null ? "  —  " : x.toFixed(3));

// paired permutation test on Δ over an array of {c1,c2}
function pairedPermP(pairs, iters = 10000, seed = 42) {
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
  return { obs, p: (extreme + 1) / (iters + 1) };
}

console.log("Re-score with patched score.js (eligible mask + verdict-guarded explicit_adoption)\n");

for (const [panel, f] of Object.entries(files)) {
  const d = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));

  const pairsAll = []; // {c1,c2} all false-premise instances
  const pairsElig = []; // {c1,c2} eligible only
  let expC2_old = 0, expC2_new = 0; // FALSE-premise explicit adoptions
  let tcAdopt_old = 0, tcAdopt_new = 0, tcAdopt_new_moved = 0, tcN = 0;

  for (const run of d.runs) {
    if (run.error) continue;
    const inj = injById[run.injection_id];
    const c1 = computeIPR(run.raw.c1, run.raw.control, inj);
    const c2 = computeIPR(run.raw.c2, run.raw.control, inj);

    if (isFalse(run.truth_value)) {
      // stored (old-scorer) explicit adoptions on C2
      for (const dd of run.c2?.details || []) if (dd.label === "explicit_adoption") expC2_old++;
      for (const dd of c2.details) if (dd.label === "explicit_adoption") expC2_new++;
      // paired instances by agent
      const byAgent = {};
      for (const dd of c1.details) byAgent[dd.agent] = { c1: dd.adopted ? 1 : 0, eligible: dd.eligible };
      for (const dd of c2.details) {
        byAgent[dd.agent] = byAgent[dd.agent] || {};
        byAgent[dd.agent].c2 = dd.adopted ? 1 : 0;
        byAgent[dd.agent].eligible = dd.eligible; // same as c1's; control-derived
      }
      for (const a of Object.keys(byAgent)) {
        const p = byAgent[a];
        if (p.c1 == null || p.c2 == null) continue;
        pairsAll.push({ c1: p.c1, c2: p.c2 });
        if (p.eligible) pairsElig.push({ c1: p.c1, c2: p.c2 });
      }
    } else if (isTrue(run.truth_value)) {
      for (const dd of run.c2?.details || []) if (dd.adopted) tcAdopt_old++;
      for (const dd of c2.details) {
        tcN++;
        if (dd.adopted) {
          tcAdopt_new++;
          if (dd.verdict !== dd.control_verdict) tcAdopt_new_moved++;
        }
      }
    }
  }

  const iprC1 = mean(pairsAll.map((p) => p.c1));
  const iprC2 = mean(pairsAll.map((p) => p.c2));
  const iprC1e = mean(pairsElig.map((p) => p.c1));
  const iprC2e = mean(pairsElig.map((p) => p.c2));
  const permAll = pairedPermP(pairsAll);
  // Guard: pairedPermP divides by pairs.length internally, so calling it on an
  // empty eligible set would produce NaN comparisons that never trip the
  // "extreme" counter — silently reporting a spurious p≈0.0001 instead of "no
  // eligible instances". Mirrors the equivalent guard in stats.js.
  const permElig = pairsElig.length ? pairedPermP(pairsElig) : null;

  console.log(`━━━ ${panel} ━━━`);
  console.log(`false-premise instances: n=${pairsAll.length}  (measurable/eligible: ${pairsElig.length}, blind: ${pairsAll.length - pairsElig.length})`);
  console.log(`  IPR(C1)  all=${f3(iprC1)}   measurable=${f3(iprC1e)}`);
  console.log(`  IPR(C2)  all=${f3(iprC2)}   measurable=${f3(iprC2e)}`);
  const eligStr = permElig
    ? `measurable=${f3(permElig.obs)} (p=${permElig.p.toFixed(4)})`
    : `measurable=  —   (no eligible instances)`;
  console.log(`  Δ(C2−C1) all=${f3(permAll.obs)} (p=${permAll.p.toFixed(4)})   ${eligStr}`);
  console.log(`  FALSE explicit_adoption on C2:  old-scorer=${expC2_old}  →  patched=${expC2_new}`);
  console.log(`  TRUE-control C2 adoption: old-scorer=${tcAdopt_old}/${tcN}  →  patched=${tcAdopt_new}/${tcN} (of patched, verdict actually moved: ${tcAdopt_new_moved})`);
  console.log("");
}
