// SPDX-License-Identifier: Apache-2.0
//
// Golden-trace regression suite.
//
// Every convergence number published in README.md and FINDINGS-q201-q203.md was
// computed by src/lib/analysis.js over the R1 alpha/beta/gamma claims. These tests
// recompute those metrics from the raw claims in every committed v0.9 trace and
// assert they still match the stored values. If a future change to the tokenizer,
// the pairwise averaging, or the filtering logic shifts any published number,
// this suite fails — the instruments can never silently drift from the findings.
//
// It also enforces the structural invariants the protocol guarantees at export:
// valid confidences, enum-valid classifications, forensically-preserved
// self_check overrides, and polarity-gate/reconciliation-status consistency.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeConvergence, computeTFIDFCosine } from '../lib/trace.js';
import { VALID_DISAGREEMENT } from '../config.js';

const TRACE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../trace/v0.9');

const traceFiles = fs.readdirSync(TRACE_DIR).filter((f) => f.endsWith('.json'));
const runs = traceFiles.map((f) => ({
  file: f,
  data: JSON.parse(fs.readFileSync(path.join(TRACE_DIR, f), 'utf8')),
}));

// The convergence inputs, exactly as App.jsx assembles them: R1 alpha/beta/gamma.
const r1Agents = (d) => ['alpha', 'beta', 'gamma'].map((a) => d.r1?.[a]).filter(Boolean);

const allAgentTraces = (d) => [
  ...['alpha', 'beta', 'gamma', 'silent'].map((a) => d.r1?.[a]),
  ...['alpha', 'beta', 'gamma'].map((a) => d.r2?.[a]),
].filter(Boolean);

describe('trace/v0.9 golden traces', () => {
  it('has the full matched-panel dataset committed', () => {
    expect(runs.length).toBeGreaterThanOrEqual(38);
  });

  describe.each(runs)('$file', ({ data }) => {
    it('stored Jaccard convergence reproduces from the R1 claims', () => {
      const recomputed = computeConvergence(r1Agents(data));
      if (data.convergence == null) {
        expect(recomputed).toBeNull();
      } else {
        expect(recomputed).toBeCloseTo(data.convergence, 12);
      }
    });

    it('stored TF-IDF convergence reproduces from the R1 claims', () => {
      if (data.tfidf_convergence == null) return; // not recorded on this run
      // arm-trace-v1.2 recorded the unsmoothed formula (idf = log(N/df), which
      // zeroes universally-shared terms); v1.3+ records the smoothed one. Recompute
      // each trace with the formula that produced it so published numbers stay pinned.
      const smoothIdf = data.schema_version !== 'arm-trace-v1.2';
      const recomputed = computeTFIDFCosine(r1Agents(data), { smoothIdf });
      expect(recomputed).toBeCloseTo(data.tfidf_convergence, 12);
    });

    it('carries the v0.9 schema and version stamps', () => {
      expect(data.arm_version).toBe('0.9');
      expect(data.schema_version).toBe('arm-trace-v1.2');
    });

    it('all parsed confidences are finite and within [0, 1]', () => {
      for (const t of allAgentTraces(data)) {
        if (t._ok === false || t.confidence == null) continue;
        expect(Number.isFinite(t.confidence)).toBe(true);
        expect(t.confidence).toBeGreaterThanOrEqual(0);
        expect(t.confidence).toBeLessThanOrEqual(1);
      }
    });

    it('disagreement_classification is enum-valid', () => {
      const dc = data.runMeta?.disagreement ?? data.r2?.gamma?.disagreement_classification;
      if (dc != null) expect(VALID_DISAGREEMENT).toContain(dc);
    });

    it('every auto_warn preserves the forensic override record', () => {
      for (const t of allAgentTraces(data)) {
        const sc = t.self_check;
        if (sc?.status !== 'auto_warn') continue;
        expect(sc.self_check_overridden).toBe(true);
        expect(sc.self_check_original_status).toBe('clean');
        expect(['values_tension_flag', 'reconciler_values_disagreement'])
          .toContain(sc.override_reason);
      }
    });

    it('no self_check escape: a clean status never coexists with values tension', () => {
      // This is the exact invariant the v0.8/v0.9 override exists to enforce.
      for (const t of allAgentTraces(data)) {
        if (t._ok === false || t.self_check?.status !== 'clean') continue;
        const flagsTension = Array.isArray(t.flags) &&
          t.flags.some((f) => f === 'values_conflict' || f === 'contested_domain');
        const reconcilerTension = t.disagreement_classification === 'values' ||
          (Array.isArray(t.values_in_conflict) && t.values_in_conflict.length > 0);
        expect(flagsTension || reconcilerTension).toBe(false);
      }
    });

    it('polarity gate state is consistent with reconciliation_status', () => {
      const gamma = data.r2?.gamma;
      if (!gamma || gamma._ok === false) return;
      const gateFired = data.runMeta?.polarity_gate_fired === true || gamma.polarity_gate_fired === true;
      if (gateFired) {
        expect(gamma.reconciliation_status).toBe('gamma_flip_detected');
        expect(gamma.polarity_audit?.requires_manual_review).toBe(true);
        expect(gamma.self_check?.status).toBe('warning');
      } else {
        expect(gamma.reconciliation_status).not.toBe('gamma_flip_detected');
      }
    });
  });
});
