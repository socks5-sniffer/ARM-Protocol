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
// The headline number is IPR(C2) − IPR(C1): how much more a planted false premise
// spreads when its REASONING is shared vs when only the CONCLUSION is shared.

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
        console.log(`   IPR  C1=${fmt(c1.ipr)}  C2=${fmt(c2.ipr)}  Δ(C2−C1)=${fmt(delta(c2.ipr, c1.ipr))}`);
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

  console.log(`\n──────── SUMMARY (false-premise injections, n=${falseRuns.length} runs) ────────`);
  console.log(`mean IPR  C1 (conclusion-only): ${fmt(c1Summary.mean_ipr)}  (${c1Summary.total_adopted}/${c1Summary.total_subjects} subjects)`);
  console.log(`mean IPR  C2 (full-trace)     : ${fmt(c2Summary.mean_ipr)}  (${c2Summary.total_adopted}/${c2Summary.total_subjects} subjects)`);
  console.log(`Δ (C2 − C1)                   : ${fmt(delta(c2Summary.mean_ipr, c1Summary.mean_ipr))}`);

  // Decompose the muddied Δ: in C1 the premise is HIDDEN, so any "adoption" there is
  // conclusion conformity, not premise propagation. In C2 the premise is visible, so
  // explicit_adoption (subject echoes the premise) is the cleanest propagation signal.
  const tally = (rs, cond) => {
    const t = { explicit_adoption: 0, implicit_adoption: 0, challenged: 0, unmoved: 0 };
    for (const r of rs) for (const d of r[cond].details) t[d.label] = (t[d.label] || 0) + 1;
    return t;
  };
  const c1Labels = tally(falseRuns, "c1");
  const c2Labels = tally(falseRuns, "c2");
  console.log(`\nLabel breakdown (false runs, per subject-instance):`);
  console.log(`  C1 (premise hidden): ${JSON.stringify(c1Labels)}`);
  console.log(`  C2 (premise shown) : ${JSON.stringify(c2Labels)}`);
  console.log(`  → C2 explicit_adoption = clean premise propagation. C1 implicit_adoption = conclusion conformity (premise not visible). C2 challenged = caught the plant.`);
  console.log(`\nInterpretation: Δ > 0 ⇒ sharing reasoning amplified propagation (Persuasion Duality supported).`);
  console.log(`                Δ ≤ 0 ⇒ no amplification from transparency (hypothesis not supported — a clean negative result).`);

  const output = {
    experiment: "arm-c1-vs-c2-injection",
    timestamp: new Date().toISOString(),
    panel,
    providers,
    models: MODELS,
    reps,
    summary: {
      c1_mean_ipr: c1Summary.mean_ipr,
      c2_mean_ipr: c2Summary.mean_ipr,
      delta_c2_minus_c1: delta(c2Summary.mean_ipr, c1Summary.mean_ipr),
      n_false_runs: falseRuns.length,
      c1_labels: c1Labels,
      c2_labels: c2Labels,
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
