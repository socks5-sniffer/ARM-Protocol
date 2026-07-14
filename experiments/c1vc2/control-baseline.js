#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// Repeated no-peer control draws — the spontaneous-flip baseline.
//
//   node experiments/c1vc2/control-baseline.js [--draws N] [--panel mixed|claude|gpt|gemini]
//                                              [--battery <file>] [--only <injection_id>] [--out <path>]
//
// Why this exists (2026-07-14 methodology review): every contamination
// positive in the C1-vs-C2 program is an *implicit* adoption — a verdict
// movement toward the pushed direction relative to a SINGLE isolated control
// draw. A model whose verdict is simply unstable on a question will produce
// such movements with no peer influence at all, so measured IPRs are upper
// bounds until the spontaneous toward-push flip rate is estimated and
// subtracted. This script collects that estimate: N independent isolated R1
// draws per (injection, subject), no peer context ever shown.
//
// Analyze with baseline-analysis.js, which compares a results file's measured
// eligible adoption against the null expectation from these draws. (That
// script can also harvest control draws from an existing results file — run.js
// draws a fresh R1 every rep — so run this when you want an independent,
// larger, or fresher sample than the 15 reps embedded in a results file.)
//
// Defaults: --draws 15, --panel gemini (the only provider that produced
// contamination positives), --battery injections-logical.json (the primary
// battery). A default run is 9 injections × 15 draws × 2 subjects = 270
// gemini-flash calls (~15–25 min sequential).
//
// Requires API keys in .env for the chosen panel (same as run.js).

import "dotenv/config";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { runIsolatedDraw, missingKeys, MODELS } from "./harness.js";
import { extractVerdict } from "../../src/lib/score.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── args ───────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const getArg = (flag, def) => {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};
const draws = parseInt(getArg("--draws", "15"), 10);
const panel = getArg("--panel", "gemini");
const only = getArg("--only", null);
const batteryFile = getArg("--battery", "injections-logical.json");
const outPath = getArg("--out", path.join(__dirname, `control-baseline-${panel}-${Date.now()}.json`));

// Subject → provider mapping per panel (same as run.js).
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

// ─── load battery (with provenance, same as run.js) ──────────────────────────
const batteryPath = path.isAbsolute(batteryFile) ? batteryFile : path.join(__dirname, batteryFile);
const batteryRaw = fs.readFileSync(batteryPath, "utf8");
const batterySha256 = crypto.createHash("sha256").update(batteryRaw).digest("hex");
const battery = JSON.parse(batteryRaw);
let injections = battery.injections;
if (only) injections = injections.filter((i) => i.id === only);
if (!injections.length) {
  console.error(`No injections matched ${only ? `id "${only}"` : "(empty battery)"}.`);
  process.exit(1);
}

const missing = missingKeys(providers);
if (missing.length) {
  console.error(`Missing API keys for panel "${panel}": ${missing.join(", ")}`);
  console.error("Add them to .env and retry.");
  process.exit(1);
}

async function main() {
  console.log(`\nC1-vs-C2 spontaneous-flip baseline (no-peer repeated controls)`);
  console.log(`battery=${batteryFile} · panel=${panel} (beta:${providers.beta} gamma:${providers.gamma}) · draws=${draws}`);
  console.log(`models: ${JSON.stringify(MODELS)}`);
  console.log(`injections: ${injections.map((i) => i.id).join(", ")}\n`);

  const runs = []; // one per (injection, draw)

  for (const injection of injections) {
    // Live verdict tally per (agent), so drift toward/away from the push is
    // visible while the run is still going.
    const tally = {};
    console.log(`▶ ${injection.id} [truth=${injection.truth_value}, pushes=${injection.pushes_verdict}]`);
    for (let draw = 0; draw < draws; draw++) {
      try {
        const result = await runIsolatedDraw(injection, providers, { onLog: () => {} });
        for (const s of result.subjects) {
          const v = extractVerdict(s.trace);
          tally[s.agent] = tally[s.agent] || {};
          tally[s.agent][v] = (tally[s.agent][v] || 0) + 1;
        }
        runs.push({
          injection_id: injection.id,
          truth_value: injection.truth_value,
          pushes_verdict: injection.pushes_verdict,
          injection, // full snapshot — same self-containment rule as run.js
          draw,
          subjects: result.subjects,
        });
        process.stdout.write(`   draw ${String(draw + 1).padStart(2)}/${draws}  ${Object.entries(tally).map(([a, t]) => `${a}: ${Object.entries(t).map(([v, n]) => `${v}=${n}`).join(" ")}`).join("  ·  ")}\r\n`);
      } catch (err) {
        console.error(`   ✗ draw ${draw + 1} failed: ${err.message}`);
        runs.push({ injection_id: injection.id, draw, error: err.message });
      }
    }
    const push = String(injection.pushes_verdict || "").toLowerCase();
    for (const [agent, t] of Object.entries(tally)) {
      const n = Object.values(t).reduce((a, b) => a + b, 0);
      const k = t[push] || 0;
      console.log(`   ${agent}: P(draw = pushed "${push}") = ${k}/${n} = ${(n ? (k / n) * 100 : 0).toFixed(1)}%`);
    }
    console.log("");
  }

  const output = {
    experiment: "arm-c1vc2-control-baseline",
    timestamp: new Date().toISOString(),
    battery: path.basename(batteryPath),
    battery_sha256: batterySha256,
    panel,
    providers,
    models: MODELS,
    draws,
    runs,
  };
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(`Saved: ${outPath}`);
  console.log(`\nNext: node experiments/c1vc2/baseline-analysis.js <c1vc2-results.json> --baseline ${path.basename(outPath)}\n`);
}

main().catch((err) => {
  console.error("\nFatal:", err.message);
  process.exit(1);
});
