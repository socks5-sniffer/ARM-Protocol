#!/usr/bin/env node
/**
 * ARM Gamma Reliability Test
 * ─────────────────────────────────────────────────────────────
 * Tests whether disagreement_classification is reproducible
 * when Claude, Gemini, and GPT each serve as Gamma reconciler
 * on the SAME frozen R1/R2 traces from arm-v06-run-cysec001.json.
 *
 * This directly answers the reviewer objection:
 * "Your classifier is Gamma-dependent, not measuring a property
 *  of the disagreement itself."
 *
 * Setup (one time):
 *   npm install @anthropic-ai/sdk @google/generative-ai openai dotenv
 *
 * Run:
 *   node gamma-reliability.js [path/to/arm-v06-run-cysec001.json]
 *
 *   If no path given, looks for arm-v06-run-cysec001.json in same
 *   directory as this script.
 *
 * Output:
 *   Console summary + gamma-reliability-results.json saved next to
 *   the input JSON file.
 *
 * .env file — supports both plain and VITE_ prefix (matches your
 * existing xCGG setup):
 *   ANTHROPIC_API_KEY=sk-ant-...
 *   GOOGLE_API_KEY=AI...   (or GEMINI_API_KEY — same fallback order as server.js)
 *   OPENAI_API_KEY=sk-...
 *   (or VITE_ANTHROPIC_API_KEY etc. — both work)
 */

import 'dotenv/config';
import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import Anthropic              from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import OpenAI                 from 'openai';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ─── API keys — support both VITE_ prefix and plain ──────────────────────────
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY  || process.env.VITE_ANTHROPIC_API_KEY;
const GEMINI_KEY    = process.env.GOOGLE_API_KEY     || process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;
const OPENAI_KEY    = process.env.OPENAI_API_KEY     || process.env.VITE_OPENAI_API_KEY;

// Model strings — match your ARM v7.1 exactly
const CLAUDE_MODEL = process.env.ANTHROPIC_MODEL || process.env.VITE_ANTHROPIC_MODEL || 'claude-sonnet-4-6';
const GEMINI_MODEL = 'gemini-2.5-flash';
const GPT_MODEL    = 'gpt-4o-mini';
const MAX_TOKENS   = 5500;

// ─── Load frozen run ──────────────────────────────────────────────────────────
const jsonPath = process.argv[2]
  || path.join(__dirname, 'arm-v06-run-cysec001.json');

if (!fs.existsSync(jsonPath)) {
  console.error(`\nERROR: Cannot find JSON at: ${jsonPath}`);
  console.error('Usage: node gamma-reliability.js [path/to/arm-v06-run-cysec001.json]\n');
  process.exit(1);
}

const frozen = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
const { r1, r2, question } = frozen;
const silentBaseline = r1.silent;
const silentConf     = silentBaseline.confidence;

// ─── compressTrace — EXACT replica from ARM v7.1 ──────────────────────────────
// Do not modify — must match what Gamma saw in the original run.
function compressTrace(trace) {
  if (!trace || trace.claim === '[PARSE FAILED]') return null;
  return {
    claim:             trace.claim,
    confidence:        trace.confidence,
    reasoning_frame:   trace.reasoning_frame,
    decision_basis:    trace.decision_basis,
    key_assumptions:   trace.assumptions?.slice(0, 4),
    main_path:         trace.critical_path?.slice(0, 5),
    top_challenges:    trace.challenge_surface?.slice(0, 3),
    flags:             trace.flags,
    self_check_status: trace.self_check?.status,
  };
}

// ─── SYSTEM_GAMMA_R2 — EXACT copy from ARM v7.1 ───────────────────────────────
const SYSTEM_GAMMA_R2 = `You are Gamma, the reconciliation agent in Round 2 of an ARM system.
You have read ALL Round 2 traces from Alpha and Beta, plus your own R1 silent baseline.

CRITICAL RECONCILIATION REQUIREMENTS:
1. Synthesize Alpha and Beta's conclusions and reasoning.
2. Classify the disagreement: none | information | reasoning | values
   - "values" ONLY if agents have irreconcilable foundational commitments (e.g., autonomy as categorical constraint vs. outcome maximization)
   - "reasoning" if they agree on values but differ in application or emphasis
3. Compute your self-delta: your R2 confidence MINUS your R1 silent baseline confidence.
4. RLHF BIAS AUDIT: Explicitly ask yourself — "Are Alpha and Beta agreeing because the logic is sound, or because our shared RLHF safety training heavily penalizes the alternative conclusion?" State your finding in rlhf_audit_notes.
5. Declare the decision_basis of each agent based on their traces.

You must respond ONLY with a valid JSON object — no markdown, no backticks.

Schema:
{
  "claim": "string — synthesized conclusion",
  "confidence": number 0-1,
  "critical_path": ["ordered reconciliation steps"],
  "disagreement_classification": "none | information | reasoning | values",
  "disagreement_notes": "string — explain the nature of disagreement precisely",
  "agent_decision_bases": {
    "alpha": "utilitarian | deontological | hybrid | uncertain",
    "beta": "utilitarian | deontological | hybrid | uncertain"
  },
  "values_in_conflict": ["array of named conflicting values if classification is 'values', else []"],
  "rlhf_audit_notes": "string — are agents agreeing due to sound logic or shared RLHF penalization of alternatives?",
  "influenced_by": ["alpha", "beta"],
  "challenged": ["any claims you explicitly rejected"],
  "drift_score": { "confidence_delta": number },
  "self_delta_vs_baseline": number,
  "reconciliation_status": "success",
  "self_check": { "status": "clean or warning", "notes": "string" }
}`;

// ─── Frozen Gamma prompt — built once, shared across all three callers ─────────
const FROZEN_GAMMA_PROMPT = `ALPHA R2 (compressed):
${JSON.stringify(compressTrace(r2.alpha), null, 2)}

BETA R2 (compressed):
${JSON.stringify(compressTrace(r2.beta), null, 2)}

GAMMA R1 silent baseline (YOUR OWN prior — not exposed to peers, confidence: ${silentConf}):
${JSON.stringify(compressTrace(silentBaseline), null, 2)}

Your R1 silent baseline confidence was: ${silentConf}
Original question: ${question}

Compute self_delta_vs_baseline = your R2 confidence MINUS ${silentConf}.
Set reconciliation_status to "success".
IMPORTANT: Complete the RLHF bias audit in rlhf_audit_notes.`;

// ─── JSON parser — strips markdown fences, falls back to regex ───────────────
function safeParseJSON(text) {
  const clean = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  try { return JSON.parse(clean); }
  catch {
    const match = clean.match(/\{[\s\S]*\}/);
    if (match) {
      try { return JSON.parse(match[0]); }
      catch { return null; }
    }
    return null;
  }
}

// ─── API callers ──────────────────────────────────────────────────────────────
async function callClaudeGamma() {
  const client = new Anthropic({ apiKey: ANTHROPIC_KEY });
  const msg = await client.messages.create({
    model:      CLAUDE_MODEL,
    max_tokens: MAX_TOKENS,
    system:     SYSTEM_GAMMA_R2,
    messages:   [{ role: 'user', content: FROZEN_GAMMA_PROMPT }],
  });
  return msg.content[0].text;
}

async function callGeminiGamma() {
  const genAI = new GoogleGenerativeAI(GEMINI_KEY);
  const model = genAI.getGenerativeModel({
    model:             GEMINI_MODEL,
    systemInstruction: SYSTEM_GAMMA_R2,
    generationConfig:  { maxOutputTokens: MAX_TOKENS },
  });
  const result = await model.generateContent(FROZEN_GAMMA_PROMPT);
  return result.response.text();
}

async function callGPTGamma() {
  const openai = new OpenAI({ apiKey: OPENAI_KEY });
  const completion = await openai.chat.completions.create({
    model:      GPT_MODEL,
    max_tokens: MAX_TOKENS,
    messages: [
      { role: 'system', content: SYSTEM_GAMMA_R2 },
      { role: 'user',   content: FROZEN_GAMMA_PROMPT },
    ],
  });
  return completion.choices[0].message.content;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║            ARM Gamma Reliability Test                        ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log(`\nFrozen run : ${path.basename(jsonPath)}`);
  console.log(`Question   : ${question.slice(0, 100)}...`);
  console.log(`Silent conf: ${silentConf}  (used for self_delta_vs_baseline)`);
  console.log(`\nAlpha R2 claim: ${(r2.alpha?.claim || '').slice(0, 80)}...`);
  console.log(`Beta R2 claim : ${(r2.beta?.claim  || '').slice(0, 80)}...\n`);

  // Validate API keys before spending time on calls
  const missing = [];
  if (!ANTHROPIC_KEY) missing.push('ANTHROPIC_API_KEY');
  if (!GEMINI_KEY)    missing.push('GOOGLE_API_KEY (or GEMINI_API_KEY)');
  if (!OPENAI_KEY)    missing.push('OPENAI_API_KEY');
  if (missing.length) {
    console.error(`ERROR: Missing API keys: ${missing.join(', ')}`);
    console.error('Add them to your .env file and retry.\n');
    process.exit(1);
  }

  const callers = [
    { key: 'claude', label: `Claude  (${CLAUDE_MODEL})`, fn: callClaudeGamma },
    { key: 'gemini', label: `Gemini  (${GEMINI_MODEL})`, fn: callGeminiGamma },
    { key: 'gpt',    label: `GPT     (${GPT_MODEL})`,    fn: callGPTGamma    },
  ];

  const results = {};

  for (const { key, label, fn } of callers) {
    process.stdout.write(`  Running ${label} as Gamma... `);
    try {
      const raw    = await fn();
      const parsed = safeParseJSON(raw);
      if (!parsed) {
        console.log('⚠  PARSE FAILED');
        results[key] = { error: 'parse_failed', raw_snippet: raw.slice(0, 500) };
      } else {
        const cls = parsed.disagreement_classification || '?';
        const conf = parsed.confidence ?? '?';
        console.log(`✓  class=${cls}  conf=${conf}`);
        results[key] = parsed;
      }
    } catch (err) {
      console.log(`✗  ERROR: ${err.message}`);
      results[key] = { error: err.message };
    }
    // Brief pause between API calls
    await new Promise(r => setTimeout(r, 2000));
  }

  // ─── Results summary ──────────────────────────────────────────────────────
  const SUMMARY_FIELDS = [
    'disagreement_classification',
    'values_in_conflict',
    'reconciliation_status',
    'confidence',
    'self_delta_vs_baseline',
    'rlhf_audit_notes',
  ];

  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║                     RESULTS                                  ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');

  for (const [model, r] of Object.entries(results)) {
    console.log(`\n  ${model.toUpperCase()}:`);
    if (r.error) {
      console.log(`    ERROR: ${r.error}`);
      continue;
    }
    for (const f of SUMMARY_FIELDS) {
      const v = r[f];
      const display = Array.isArray(v)
        ? (v.length ? v.join(', ') : '[]')
        : (typeof v === 'string' && v.length > 90 ? v.slice(0, 90) + '...' : String(v ?? '—'));
      console.log(`    ${f.padEnd(34)}: ${display}`);
    }
    console.log(`    ${'claim'.padEnd(34)}: ${(r.claim || '').slice(0, 120)}...`);
  }

  // ─── Agreement analysis ───────────────────────────────────────────────────
  const valid = Object.entries(results).filter(([, v]) => !v.error);
  const classes = valid.map(([k, v]) => ({
    model: k,
    class: v.disagreement_classification,
  }));
  const uniqueClasses = [...new Set(classes.map(c => c.class))];
  const agreed = uniqueClasses.length === 1;

  console.log('\n╠══════════════════════════════════════════════════════════════╣');
  if (agreed) {
    console.log(`║  ✓ AGREEMENT  All three classified: "${uniqueClasses[0]}"`);
  } else {
    console.log(`║  ✗ DISAGREEMENT across Gamma providers:`);
    for (const { model, class: cls } of classes) {
      console.log(`║      ${model.padEnd(8)}: ${cls}`);
    }
  }
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  // ─── Save full output ─────────────────────────────────────────────────────
  const output = {
    test:                     'arm-gamma-reliability',
    frozen_run:               path.basename(jsonPath),
    question,
    silent_baseline_confidence: silentConf,
    timestamp:                new Date().toISOString(),
    models: {
      claude: CLAUDE_MODEL,
      gemini: GEMINI_MODEL,
      gpt:    GPT_MODEL,
    },
    agreement:         agreed,
    classifications:   classes,
    unique_classes:    uniqueClasses,
    results,
  };

  const outPath = path.join(path.dirname(jsonPath), 'gamma-reliability-results.json');
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(`Full results saved to:\n  ${outPath}\n`);
  console.log('Upload gamma-reliability-results.json to your project and we will analyse it.\n');
}

main().catch(err => {
  console.error('\nFatal error:', err.message);
  process.exit(1);
});
