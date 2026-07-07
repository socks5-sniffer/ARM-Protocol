// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest';
import { driftLabel, extractClaimDirection } from '../lib/analysis.js';
import {
  computeConvergence,
  computeTFIDFCosine,
  compressTrace,
  harnessDelta,
  deltaMismatch,
  annotateAgentDrift,
} from '../lib/trace.js';
import { DRIFT_UP_THRESHOLD, DRIFT_DOWN_THRESHOLD } from '../config.js';

// ─── driftLabel ───────────────────────────────────────────────────────────────
describe('driftLabel', () => {
  it('returns em-dash placeholder for missing delta', () => {
    expect(driftLabel(undefined).label).toBe('—');
    expect(driftLabel(null).label).toBe('—');
  });

  it('classifies the descriptive Δ bands exactly', () => {
    // Below DRIFT_DOWN_THRESHOLD → large downward shift
    expect(driftLabel(DRIFT_DOWN_THRESHOLD - 0.001).label).toBe('large downward shift');
    // Exactly at the down threshold is NOT large — n < threshold is strict
    expect(driftLabel(DRIFT_DOWN_THRESHOLD).label).toBe('downward shift');
    // Any non-positive delta reads as a downward shift
    expect(driftLabel(-0.05).label).toBe('downward shift');
    expect(driftLabel(0).label).toBe('downward shift');
    // (0, DRIFT_UP_THRESHOLD] → minor shift; exactly at threshold is still minor
    expect(driftLabel(0.01).label).toBe('minor shift');
    expect(driftLabel(DRIFT_UP_THRESHOLD).label).toBe('minor shift');
    // Above the up threshold → upward shift (descriptive, no longer a "memetic" verdict)
    expect(driftLabel(DRIFT_UP_THRESHOLD + 0.001).label).toBe('upward shift');
  });

  it('coerces numeric strings, normalizing Unicode minus signs', () => {
    expect(driftLabel('-0.05').label).toBe('downward shift');
    expect(driftLabel('−0.05').label).toBe('downward shift'); // U+2212 minus
    expect(driftLabel('–0.2').label).toBe('large downward shift');  // en-dash
    expect(driftLabel(' 0.1 ').label).toBe('upward shift');
  });

  it('never falls through non-numeric garbage to a drift verdict', () => {
    expect(driftLabel('abc').label).toBe('⚠ invalid delta');
    expect(driftLabel(NaN).label).toBe('⚠ invalid delta');
    expect(driftLabel(Infinity).label).toBe('⚠ invalid delta');
    expect(driftLabel({}).label).toBe('⚠ invalid delta');
  });
});

// ─── extractClaimDirection (polarity gate input) ──────────────────────────────
describe('extractClaimDirection', () => {
  it('reads explicit yes/no at the start of the claim', () => {
    expect(extractClaimDirection('No — the AI should sever the connection later.')).toBe('no');
    expect(extractClaimDirection('Yes, the AI should act immediately.')).toBe('yes');
  });

  it('reads implied NO from negation phrases anywhere', () => {
    expect(extractClaimDirection('The AI should not sever the network connection.')).toBe('no');
    expect(extractClaimDirection('The AI must not act without authorization.')).toBe('no');
    expect(extractClaimDirection('The system cannot ethically deploy the countermeasure.')).toBe('no');
    expect(extractClaimDirection('An AI should never self-authorize offensive action.')).toBe('no');
  });

  it('reads implied YES from "should" only when no "not" appears anywhere', () => {
    expect(extractClaimDirection('The AI should sever the network connection autonomously.')).toBe('yes');
    // "not" elsewhere in the claim blocks the implied-YES path → conservative unknown
    expect(extractClaimDirection('The AI should act, not wait for authorization.')).toBe('unknown');
  });

  it('does not false-positive on a bare "no" mid-claim (the removed \\bno\\b bug)', () => {
    // Regression guard for the documented false positive:
    // "should disclose — no patch available" must read YES, not NO.
    expect(extractClaimDirection('The AI should disclose — no patch available.')).toBe('yes');
  });

  it('returns unknown for empty, sentinel, and undecidable claims', () => {
    expect(extractClaimDirection('')).toBe('unknown');
    expect(extractClaimDirection(null)).toBe('unknown');
    expect(extractClaimDirection('[PARSE FAILED]')).toBe('unknown');
    expect(extractClaimDirection('[FAP — Gamma R2 aborted]')).toBe('unknown');
    // Lowercase parse-failure sentinel from safeParseTrace also lands on unknown
    // (via fallthrough — no directional tokens), never on a polarity verdict.
    expect(extractClaimDirection('[parse failed]')).toBe('unknown');
    expect(extractClaimDirection('The tradeoffs here are genuinely contested.')).toBe('unknown');
  });
});

// ─── computeConvergence (Jaccard) ─────────────────────────────────────────────
describe('computeConvergence', () => {
  const t = (claim) => ({ claim, _ok: true });

  it('returns null with fewer than two valid claims', () => {
    expect(computeConvergence([])).toBeNull();
    expect(computeConvergence([t('only one usable claim here')])).toBeNull();
    expect(computeConvergence([t('one claim'), { claim: '[parse failed]', _ok: false }])).toBeNull();
  });

  it('scores identical claims as 1 and disjoint claims as 0', () => {
    expect(computeConvergence([t('autonomous severance network'), t('autonomous severance network')])).toBe(1);
    expect(computeConvergence([t('alpha bravo charlie'), t('delta echoes foxtrot')])).toBe(0);
  });

  it('matches a hand-computed pairwise Jaccard', () => {
    // tokens >4 chars: {autonomous, severance, network} vs {autonomous, network, protection}
    // intersection 2, union 4 → 0.5
    const conv = computeConvergence([
      t('autonomous severance network'),
      t('autonomous network protection'),
    ]);
    expect(conv).toBeCloseTo(0.5, 12);
  });

  it('ignores short tokens (≤4 chars) entirely', () => {
    // All tokens length ≤ 4 → empty sets → union 0 → pair contributes 0
    expect(computeConvergence([t('the ai can act'), t('the ai can act')])).toBe(0);
  });

  it('averages across all pairs for three or more agents', () => {
    const conv = computeConvergence([
      t('autonomous severance network'),
      t('autonomous network protection'),
      t('unrelated wording entirely'),
    ]);
    // pairs: 0.5, 0, 0 → mean 1/6
    expect(conv).toBeCloseTo(0.5 / 3, 12);
  });

  it('filters failed traces and non-string claims instead of crashing', () => {
    const conv = computeConvergence([
      t('autonomous severance network'),
      { claim: null, _ok: true },
      { claim: '[parse failed]', _ok: false },
      t('autonomous network protection'),
    ]);
    expect(conv).toBeCloseTo(0.5, 12);
  });

  it('is case-insensitive', () => {
    expect(computeConvergence([t('AUTONOMOUS NETWORK'), t('autonomous network')])).toBe(1);
  });
});

// ─── computeTFIDFCosine ───────────────────────────────────────────────────────
describe('computeTFIDFCosine', () => {
  const t = (claim) => ({ claim, _ok: true });

  it('returns null with fewer than two valid claims', () => {
    expect(computeTFIDFCosine([t('single claim')])).toBeNull();
  });

  it('zeroes terms shared by ALL agents — identical claims score 0, not 1', () => {
    // Documented IDF property: universally shared terms carry no discriminating
    // signal (idf = log(N/N) = 0), so two identical docs have all-zero vectors.
    expect(computeTFIDFCosine([t('sever the network now'), t('sever the network now')])).toBe(0);
  });

  it('with N=2, any pair scores 0 (shared terms are always shared by all)', () => {
    expect(computeTFIDFCosine([t('sever network connection'), t('sever network protection')])).toBe(0);
  });

  it('matches a hand-computed 3-doc case where a term is shared by exactly two docs', () => {
    // d1/d2 share "shared" (df=2 → idf=log(3/2) > 0); "common" is in all (idf 0).
    const conv = computeTFIDFCosine([
      t('alpha shared common'),
      t('beta shared common'),
      t('gamma other common'),
    ]);
    const l15 = Math.log(3 / 2);
    const l3 = Math.log(3);
    // cos(d1,d2) = log(1.5)² / (log3² + log1.5²); other two pairs are 0
    const expected = (l15 ** 2 / (l3 ** 2 + l15 ** 2)) / 3;
    expect(conv).toBeCloseTo(expected, 12);
  });

  it('filters failed traces', () => {
    const conv = computeTFIDFCosine([
      t('alpha shared common'),
      { claim: 'ignored', _ok: false },
      t('beta shared common'),
      t('gamma other common'),
    ]);
    expect(conv).toBeGreaterThan(0);
  });
});

// ─── compressTrace ────────────────────────────────────────────────────────────
describe('compressTrace', () => {
  it('returns null for missing or failed traces', () => {
    expect(compressTrace(null)).toBeNull();
    expect(compressTrace({ claim: '[parse failed]', _ok: false })).toBeNull();
  });

  it('keeps key fields and caps list lengths (4 assumptions / 5 path / 3 challenges)', () => {
    const full = {
      claim: 'c',
      confidence: 0.7,
      reasoning_frame: 'deontological',
      decision_basis: 'hybrid',
      assumptions: ['a1', 'a2', 'a3', 'a4', 'a5', 'a6'],
      critical_path: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'],
      challenge_surface: ['x1', 'x2', 'x3', 'x4'],
      flags: ['values_conflict'],
      self_check: { status: 'warning', notes: 'n' },
      discarded_paths: [{ path: 'should not leak', reason: 'r' }],
      _ok: true,
    };
    const c = compressTrace(full);
    expect(c.key_assumptions).toHaveLength(4);
    expect(c.main_path).toHaveLength(5);
    expect(c.top_challenges).toHaveLength(3);
    expect(c.self_check_status).toBe('warning');
    expect(c.flags).toEqual(['values_conflict']);
    // Fields not in the compressed schema must not leak into peer context
    expect(c).not.toHaveProperty('discarded_paths');
    expect(c).not.toHaveProperty('self_check');
    expect(c).not.toHaveProperty('_meta');
  });

  it('tolerates absent optional arrays', () => {
    const c = compressTrace({ claim: 'c', confidence: 0.5, _ok: true });
    expect(c.key_assumptions).toBeUndefined();
    expect(c.claim).toBe('c');
  });
});

// ─── harness-computed drift (A1/A2) ───────────────────────────────────────────
describe('harnessDelta / deltaMismatch / annotateAgentDrift', () => {
  it('harnessDelta subtracts when both finite, else null', () => {
    expect(harnessDelta(0.68, 0.72)).toBeCloseTo(-0.04, 12);
    expect(harnessDelta(0.68, null)).toBeNull();
    expect(harnessDelta(undefined, 0.72)).toBeNull();
    expect(harnessDelta(NaN, 0.72)).toBeNull();
  });

  it('deltaMismatch flags only beyond DELTA_MISMATCH_EPS (0.02), never on missing data', () => {
    expect(deltaMismatch(-0.04, -0.04)).toBe(false);
    expect(deltaMismatch(-0.04, -0.06)).toBe(false);  // |diff| = 0.02 exactly → not flagged
    expect(deltaMismatch(-0.04, -0.065)).toBe(true);  // beyond eps
    expect(deltaMismatch(null, -0.04)).toBe(false);
    expect(deltaMismatch(-0.04, null)).toBe(false);
  });

  it('annotateAgentDrift computes the harness delta and preserves the model self-report', () => {
    const r2 = { confidence: 0.9, drift_score: { confidence_delta: 0.02 }, _ok: true };
    annotateAgentDrift(r2, { confidence: 0.7 });
    expect(r2.drift_score.harness_confidence_delta).toBeCloseTo(0.2, 12);
    expect(r2.drift_score.confidence_delta).toBe(0.02); // self-report intact
    expect(r2.drift_score.delta_mismatch).toBe(true);   // model claims +0.02, harness sees +0.20
  });

  it('annotateAgentDrift is a no-op on failed traces and safe with a missing R1', () => {
    const failed = { _ok: false };
    annotateAgentDrift(failed, { confidence: 0.7 });
    expect(failed.drift_score).toBeUndefined();

    const r2 = { confidence: 0.9, _ok: true };
    annotateAgentDrift(r2, undefined);
    expect(r2.drift_score.harness_confidence_delta).toBeNull();
    expect(r2.drift_score.delta_mismatch).toBe(false);
  });
});
