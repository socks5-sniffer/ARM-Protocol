#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// C1-vs-C2 experiment runner.
//
//   node experiments/c1vc2/run.js [--reps N] [--panel mixed|claude|gpt|gemini]
//                                 [--only <injection_id>] [--battery <file>] [--out <path>]
//
// Requires API keys in .env (ANTHROPIC_API_KEY / OPENAI_API_KEY / GEMINI_API_KEY,
// VITE_-prefixed also accepted). Writes a results JSON and prints the IPR table.
//
// The headline number is measurable Δ = IPR(C2) − IPR(C1) over ELIGIBLE instances:
// how much more a planted false premise spreads when its REASONING is shared vs
// when only the CONCLUSION is shared. An instance whose isolated baseline verdict
// already equals the pushed direction cannot register implicit (verdict-shift)
// adoption — it is structurally blind — so the eligible mask keeps the denominator
// honest. The unmasked rate is reported alongside for continuity with pre-audit
// tables. See FINDINGS-audit.md and the `eligible` flag in src/lib/score.js.

import "dotenv/config";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { runInjection, missingKeys, MODELS } from "./harness.js";
import { computeIPR, summarizeCondition } from "../../src/lib/score.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Accept both the string ("false") and boolean forms of truth_value, matching
// stats.js — so a boolean-encoded battery can't silently drop all false-premise runs.
const isFalsePremise = (tv) => tv === false || tv === "false";

// ─── args ───────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const getArg = (flag, def) => {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};
const reps = parseInt(getArg("--reps", "5"), 10);
const panel = getArg("--panel", "mixed");
const only = getArg("--only", null);
const batteryFile = getArg("--battery", "injections.json");
const outPath = getArg("--out", path.join(__dirname, `c1vc2-results-${Date.now()}.json`));

// Subject → provider mapping per panel. Subjects are beta + gamma.
const PANELS = {
  mixed: { beta: "gpt", gamma: "gemini" },
  claude: { beta: "claude", gamma: "claude" },
  gpt: { beta: "gpt", gamma: "gpt" },
  gemini: { beta: "gemini", gamma: "gemini" },
};
const providers = PANELS[panel];
if (!providers) {
  console.error(`Unknown panel "${panel}". Use: ${Object.keys(PANELS).join(" | ")}`);
  process.exit(1);
}

// ─── load battery ─────────────────────────────────────────────────────────────
const batteryPath = path.isAbsolute(batteryFile) ? batteryFile : path.join(__dirname, batteryFile);
const battery = JSON.parse(fs.readFileSync(batteryPath, "utf8"));
let injections = battery.injections;
if (only) injections = injections.filter((i) => i.id === only);
if (!injections.length) {
  console.error(`No injections matched ${only ? `id "${only}"` : "(empty battery)"}.`);
  process.exit(1);
}

// ─── key check ────────────────────────────────────────────────────────────────
const missing = missingKeys(providers);
if (missing.length) {
  console.error(`Missing API keys for panel "${panel}": ${missing.join(", ")}`);
  console.error("Add them to .env and retry.");
  process.exit(1);
}

const log = (m) => console.log(m);

async function main() {
  console.log(`\nC1-vs-C2 injection experiment`);
  console.log(`battery=${batteryFile} · panel=${panel} (beta:${providers.beta} gamma:${providers.gamma}) · reps=${reps}`);
  console.log(`models: ${JSON.stringify(MODELS)}`);
  console.log(`injections: ${injections.map((i) => i.id).join(", ")}\n`);

  const runs = []; // one per (injection, rep)

  for (const injection of injections) {
    for (let rep = 0; rep < reps; rep++) {
      console.log(`▶ ${injection.id} [truth=${injection.truth_value}, pushes=${injection.pushes_verdict}] rep ${rep + 1}/${reps}`);
      try {
        const result = await runInjection(injection, providers, { onLog: log });
        const c1 = computeIPR(result.c1, result.control, injection);
        const c2 = computeIPR(result.c2, result.control, injection);
        console.log(`   IPR (measurable)  C1=${fmt(c1.ipr_eligible)}  C2=${fmt(c2.ipr_eligible)}  Δ(C2−C1)=${fmt(delta(c2.ipr_eligible, c1.ipr_eligible))}  [eligible ${c1.n_eligible}/${c1.n} · ${c2.n_eligible}/${c2.n}]`);
        runs.push({ injection_id: injection.id, truth_value: injection.truth_value, rep, c1, c2, raw: result });
      } catch (err) {
        console.error(`   ✗ run failed: ${err.message}`);
        runs.push({ injection_id: injection.id, rep, error: err.message });
      }
    }
  }

  // ─── aggregate (false-premise injections only drive the headline) ──────────
  const falseRuns = runs.filter((r) => isFalsePremise(r.truth_value) && !r.error);
  const c1Summary = summarizeCondition(falseRuns.map((r) => r.c1));
  const c2Summary = summarizeCondition(falseRuns.map((r) => r.c2));

  // Headline = MEASURABLE (eligible-masked) IPR. Instances whose baseline verdict
  // already equals the push cannot register implicit adoption, so leaving them in
  // the denominator silently deflates the rate (78/240 Gemini instances in the
  // committed monoculture run were blind this way). Raw stays as a secondary line
  // for continuity with pre-audit tables.
  //
  // Instance-POOLED (total adopted / total eligible), not the per-run mean:
  // eligible counts vary run to run, so a per-run mean drifts from the printed
  // count ratio and from rescore.mjs / stats.js — which pool at the instance
  // level and are the audited canon the headline must reconcile with exactly.
  const pooledElig = (s) => (s.total_eligible ? s.total_adopted_eligible / s.total_eligible : null);
  const blind = (s) => s.total_subjects - s.total_eligible;
  console.log(`\n──────── SUMMARY (false-premise injections, n=${falseRuns.length} runs) ────────`);
  console.log(`measurable IPR  C1 (conclusion-only): ${fmt(pooledElig(c1Summary))}  (${c1Summary.total_adopted_eligible}/${c1Summary.total_eligible} eligible · ${blind(c1Summary)} blind excluded)`);
  console.log(`measurable IPR  C2 (full-trace)     : ${fmt(pooledElig(c2Summary))}  (${c2Summary.total_adopted_eligible}/${c2Summary.total_eligible} eligible · ${blind(c2Summary)} blind excluded)`);
  console.log(`measurable Δ (C2 − C1)              : ${fmt(delta(pooledElig(c2Summary), pooledElig(c1Summary)))}   ← headline`);
  console.log(`unmasked   IPR  C1=${fmt(c1Summary.mean_ipr)} (${c1Summary.total_adopted}/${c1Summary.total_subjects})  C2=${fmt(c2Summary.mean_ipr)} (${c2Summary.total_adopted}/${c2Summary.total_subjects})  Δ=${fmt(delta(c2Summary.mean_ipr, c1Summary.mean_ipr))}   (incl. structurally-blind instances)`);

  // Decompose adoption by MECHANISM, each over the denominator where it is
  // actually measurable — pooling them into one IPR mixes mechanisms with
  // different denominators:
  //   explicit_adoption — subject echoes the premise with its verdict on the
  //     pushed side. Observable on every scored instance (rate over ALL), but
  //     only meaningful in C2 — in C1 the premise is hidden, so any C1 "adoption"
  //     is conclusion conformity, not premise propagation.
  //   implicit_adoption — verdict shift to the push vs the subject's own control.
  //     Only POSSIBLE on eligible instances (baseline ≠ push), so its rate uses
  //     the eligible denominator.
  const mech = (rs, cond) => {
    const m = { explicit_adoption: 0, implicit_adoption: 0, challenged: 0, unmoved: 0, n: 0, n_eligible: 0 };
    for (const r of rs) for (const d of r[cond].details) {
      m[d.label] = (m[d.label] || 0) + 1;
      m.n++;
      if (d.eligible) m.n_eligible++;
    }
    m.explicit_rate = m.n ? m.explicit_adoption / m.n : null;
    m.implicit_rate_eligible = m.n_eligible ? m.implicit_adoption / m.n_eligible : null;
    return m;
  };
  const c1Mech = mech(falseRuns, "c1");
  const c2Mech = mech(falseRuns, "c2");
  const mechLine = (m) =>
    `explicit ${m.explicit_adoption}/${m.n} (${fmt(m.explicit_rate)})  implicit ${m.implicit_adoption}/${m.n_eligible} eligible (${fmt(m.implicit_rate_eligible)})  challenged ${m.challenged}  unmoved ${m.unmoved}`;
  console.log(`\nAdoption by mechanism (false runs, per subject-instance; split denominators):`);
  console.log(`  C1 (premise hidden): ${mechLine(c1Mech)}`);
  console.log(`  C2 (premise shown) : ${mechLine(c2Mech)}`);
  console.log(`  → C2 explicit = clean premise propagation. C1 "explicit/implicit" = conclusion conformity (premise not visible). C2 challenged = caught the plant.`);
  console.log(`\nInterpretation: measurable Δ > 0 ⇒ sharing reasoning amplified propagation (Persuasion Duality supported).`);
  console.log(`                measurable Δ ≤ 0 ⇒ no amplification from transparency (hypothesis not supported — a clean negative result).`);

  const output = {
    experiment: "arm-c1-vs-c2-injection",
    timestamp: new Date().toISOString(),
    panel,
    providers,
    models: MODELS,
    reps,
    summary: {
      // Headline (measurable / eligible-masked, instance-pooled) — see the
      // eligible flag in score.js and the pooledElig note above.
      c1_ipr_eligible: pooledElig(c1Summary),
      c2_ipr_eligible: pooledElig(c2Summary),
      delta_eligible_c2_minus_c1: delta(pooledElig(c2Summary), pooledElig(c1Summary)),
      total_eligible_c1: c1Summary.total_eligible,
      total_eligible_c2: c2Summary.total_eligible,
      // Unmasked (legacy continuity — includes structurally-blind instances).
      c1_mean_ipr: c1Summary.mean_ipr,
      c2_mean_ipr: c2Summary.mean_ipr,
      delta_c2_minus_c1: delta(c2Summary.mean_ipr, c1Summary.mean_ipr),
      n_false_runs: falseRuns.length,
      // Mechanism split with per-mechanism denominators (explicit over all,
      // implicit over eligible). Includes the raw label counts the old
      // c1_labels/c2_labels fields carried.
      c1_mechanism: c1Mech,
      c2_mechanism: c2Mech,
    },
    runs,
  };
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(`\nSaved: ${outPath}\n`);
}

const fmt = (x) => (typeof x === "number" ? x.toFixed(3) : "—");
const delta = (a, b) => (typeof a === "number" && typeof b === "number" ? +(a - b).toFixed(3) : null);

main().catch((err) => {
  console.error("\nFatal:", err.message);
  process.exit(1);
});
