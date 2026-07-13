// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest';
import { driftLabel, extractClaimDirection, classifyVerdictTransition, classifyGammaPolarity } from '../lib/analysis.js';
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
    // Negative deltas read as a downward shift; exactly zero is not a shift at all
    expect(driftLabel(-0.05).label).toBe('downward shift');
    expect(driftLabel(0).label).toBe('no shift');
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

// ─── classifyGammaPolarity (consensus-baseline resolution for the gate) ────────
describe('classifyGammaPolarity', () => {
  it('gates against the consensus when both Gamma R1 draws agree', () => {
    const r = classifyGammaPolarity({ r1: 'no', silent: 'no', r2: 'yes', silentIsGamma: true });
    expect(r.mode).toBe('consensus');
    expect(r.baselinesAgree).toBe(true);
    expect(r.transition).toBe('flip'); // contradicts BOTH independent R1 draws
  });

  it('reports "none" when R2 holds the agreed prior', () => {
    const r = classifyGammaPolarity({ r1: 'no', silent: 'no', r2: 'no', silentIsGamma: true });
    expect(r.mode).toBe('consensus');
    expect(r.transition).toBe('none');
  });

  it('declares the baseline unstable when the two R1 draws disagree — gate not evaluated', () => {
    // The 8-of-19 historical case: R2 agrees with the silent anchor it was shown,
    // but the differently-sampled visible R1 said otherwise. Not a flip.
    const r = classifyGammaPolarity({ r1: 'no', silent: 'yes', r2: 'yes', silentIsGamma: true });
    expect(r.mode).toBe('unstable');
    expect(r.baselinesAgree).toBe(false);
    expect(r.transition).toBe('not_evaluated');
  });

  it('treats conditional-vs-firm disagreement between the draws as unstable too', () => {
    const r = classifyGammaPolarity({ r1: 'yes', silent: 'conditional', r2: 'no', silentIsGamma: true });
    expect(r.mode).toBe('unstable');
    expect(r.transition).toBe('not_evaluated');
  });

  it('falls back to visible-R1-only when the silent baseline is rotated to another agent', () => {
    const r = classifyGammaPolarity({ r1: 'no', silent: 'yes', r2: 'yes', silentIsGamma: false });
    expect(r.mode).toBe('visible_r1_only');
    expect(r.baselinesAgree).toBeNull();
    expect(r.transition).toBe('flip'); // legacy comparison, recorded as such
  });

  it('falls back to visible-R1-only when a baseline verdict is unparseable', () => {
    const r = classifyGammaPolarity({ r1: 'no', silent: 'unknown', r2: 'yes', silentIsGamma: true });
    expect(r.mode).toBe('visible_r1_only');
    expect(r.transition).toBe('flip');
    // and if the visible R1 itself is unknown, nothing can be asserted:
    const r2 = classifyGammaPolarity({ r1: 'unknown', silent: 'no', r2: 'yes', silentIsGamma: true });
    expect(r2.mode).toBe('visible_r1_only');
    expect(r2.transition).toBe('unknown');
  });

  it('classifies a consensus hedge to conditional as a shift, not a flip', () => {
    const r = classifyGammaPolarity({ r1: 'yes', silent: 'yes', r2: 'conditional', silentIsGamma: true });
    expect(r.mode).toBe('consensus');
    expect(r.transition).toBe('shift');
  });
});

// ─── classifyVerdictTransition (polarity gate vs. advisory flag) ───────────────
describe('classifyVerdictTransition', () => {
  it('flags only a firm yes<->no reversal as a gate "flip"', () => {
    expect(classifyVerdictTransition('yes', 'no')).toBe('flip');
    expect(classifyVerdictTransition('no', 'yes')).toBe('flip');
  });

  it('treats any change involving "conditional" as a softer "shift"', () => {
    expect(classifyVerdictTransition('yes', 'conditional')).toBe('shift');
    expect(classifyVerdictTransition('no', 'conditional')).toBe('shift');
    expect(classifyVerdictTransition('conditional', 'yes')).toBe('shift');
    expect(classifyVerdictTransition('conditional', 'no')).toBe('shift');
  });

  it('returns "none" when the verdict did not change', () => {
    expect(classifyVerdictTransition('yes', 'yes')).toBe('none');
    expect(classifyVerdictTransition('conditional', 'conditional')).toBe('none');
  });

  it('returns "unknown" when either verdict is missing/unparseable', () => {
    // A parse-failed reconciler yields "unknown" — nothing can be asserted,
    // so neither the gate nor the advisory should fire.
    expect(classifyVerdictTransition('yes', 'unknown')).toBe('unknown');
    expect(classifyVerdictTransition('unknown', 'no')).toBe('unknown');
    expect(classifyVerdictTransition(null, 'yes')).toBe('unknown');
    expect(classifyVerdictTransition('yes', undefined)).toBe('unknown');
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
    // Legacy lowercase sentinel (emitted by safeParseTrace before v1.3, present in
    // committed traces) also lands on unknown via fallthrough — no directional tokens.
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

  it('identical claims score 1 — smoothed IDF makes the metric a convergence alarm', () => {
    // v1.3 fix: idf = log(N/df) + 1, so universally shared terms keep weight 1.
    // Two identical docs → identical vectors → cosine 1 (was 0 under v1.2).
    expect(computeTFIDFCosine([t('sever the network now'), t('sever the network now')])).toBeCloseTo(1, 12);
  });

  it('matches a hand-computed N=2 case (nonzero under smoothing, unlike v1.2)', () => {
    // Tokens: [sever, network, connection] vs [sever, network, protection].
    // Shared terms (df=2): idf = ln(1)+1 = 1. Unique terms (df=1): idf = ln(2)+1.
    // cos = 2 / (2 + (ln2+1)²), uniform tf cancels.
    const conv = computeTFIDFCosine([t('sever network connection'), t('sever network protection')]);
    const u = Math.log(2) + 1;
    expect(conv).toBeCloseTo(2 / (2 + u ** 2), 12);
  });

  it('matches a hand-computed 3-doc case where a term is shared by exactly two docs', () => {
    // a = idf of a unique term, s = idf of "shared" (df=2), c = idf of "common" (df=3).
    const conv = computeTFIDFCosine([
      t('alpha shared common'),
      t('beta shared common'),
      t('gamma other common'),
    ]);
    const a = Math.log(3) + 1;
    const s = Math.log(3 / 2) + 1;
    const c = 1; // log(3/3) + 1
    const m12 = a ** 2 + s ** 2 + c ** 2; // |d1|² = |d2|²
    const m3 = 2 * a ** 2 + c ** 2;       // |d3|²
    const cos12 = (s ** 2 + c ** 2) / m12;
    const cos13 = c ** 2 / Math.sqrt(m12 * m3); // = cos23
    expect(conv).toBeCloseTo((cos12 + 2 * cos13) / 3, 12);
  });

  it('reproduces the legacy v1.2 formula under { smoothIdf: false }', () => {
    // The unsmoothed idf zeroes universally-shared terms: identical claims and any
    // 2-doc pair score 0. Kept so arm-trace-v1.2 published numbers stay reproducible.
    const legacy = { smoothIdf: false };
    expect(computeTFIDFCosine([t('sever the network now'), t('sever the network now')], legacy)).toBe(0);
    expect(computeTFIDFCosine([t('sever network connection'), t('sever network protection')], legacy)).toBe(0);
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
