// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest';
import { safeParseTrace } from '../lib/trace.js';

// Helper: wrap a raw model string in the transport result shape safeParseTrace expects.
const raw = (text, extra = {}) => ({
  raw: text,
  stopReason: 'end_turn',
  usage: { output_tokens: 100 },
  provider: 'claude',
  model: 'claude-sonnet-4-6',
  latencyMs: 1234,
  ...extra,
});

const validAgent = (overrides = {}) => JSON.stringify({
  claim: 'The AI should not act without authorization.',
  confidence: 0.72,
  reasoning_frame: 'deontological',
  decision_basis: 'deontological',
  flags: [],
  self_check: { status: 'warning', notes: 'tension noted' },
  ...overrides,
});

describe('safeParseTrace — parsing & normalization', () => {
  it('parses a clean JSON trace and attaches _meta / _ok', () => {
    const { ok, trace } = safeParseTrace(raw(validAgent()), 'alpha');
    expect(ok).toBe(true);
    expect(trace._ok).toBe(true);
    expect(trace.confidence).toBe(0.72);
    expect(trace._meta).toMatchObject({ provider: 'claude', model: 'claude-sonnet-4-6', latencyMs: 1234 });
  });

  it('strips markdown code fences before parsing', () => {
    const fenced = '```json\n' + validAgent() + '\n```';
    const { ok, trace } = safeParseTrace(raw(fenced), 'alpha');
    expect(ok).toBe(true);
    expect(trace.claim).toMatch(/should not act/);
  });

  it('repairs the Gemini stray-double-quote serialization bug', () => {
    // Gemini occasionally emits `""key":` — the harness normalizes it to `"key":`
    const buggy = validAgent().replace('"confidence":', '""confidence":');
    expect(() => JSON.parse(buggy)).toThrow(); // confirm the fixture is actually broken
    const { ok, trace } = safeParseTrace(raw(buggy), 'gamma');
    expect(ok).toBe(true);
    expect(trace.confidence).toBe(0.72);
  });
});

describe('safeParseTrace — schema validation (B3)', () => {
  it('rejects a trace with missing confidence as schema_validation_failure', () => {
    const noConf = JSON.stringify({ claim: 'x', self_check: { status: 'clean' } });
    const { ok, trace } = safeParseTrace(raw(noConf), 'alpha');
    expect(ok).toBe(false);
    expect(trace._ok).toBe(false);
    expect(trace.flags).toContain('schema_validation_failure');
    expect(trace.self_check.status).toBe('failed');
    expect(trace.self_check.notes).toBe('Schema validation failed.');
    expect(trace.reconciliation_status).toBe('failed');
  });

  it('rejects non-numeric confidence', () => {
    const { ok } = safeParseTrace(raw(validAgent({ confidence: 'high' })), 'alpha');
    expect(ok).toBe(false);
  });

  it('clamps out-of-range confidence and records a schema warning', () => {
    const high = safeParseTrace(raw(validAgent({ confidence: 1.4 })), 'alpha');
    expect(high.ok).toBe(true);
    expect(high.trace.confidence).toBe(1);
    expect(high.trace.schema_warnings).toContain('confidence_out_of_range:1.4');

    const low = safeParseTrace(raw(validAgent({ confidence: -0.2 })), 'alpha');
    expect(low.trace.confidence).toBe(0);
    expect(low.trace.schema_warnings).toContain('confidence_out_of_range:-0.2');
  });

  it('warns (non-fatally) on invalid drift delta, disagreement enum, and recon status', () => {
    const { ok, trace } = safeParseTrace(raw(validAgent({
      drift_score: { confidence_delta: 5 },
      disagreement_classification: 'vibes',
      reconciliation_status: 'maybe',
    })), 'gamma');
    expect(ok).toBe(true); // warnings, not rejections
    expect(trace.schema_warnings).toEqual(expect.arrayContaining([
      'drift_delta_invalid:5',
      'disagreement_classification_invalid:"vibes"',
      'reconciliation_status_invalid:"maybe"',
    ]));
  });

  it('accepts valid enum values without warnings', () => {
    const { trace } = safeParseTrace(raw(validAgent({
      drift_score: { confidence_delta: -0.04 },
      disagreement_classification: 'values',
      reconciliation_status: 'success',
      flags: ['incomplete_data'],
    })), 'gamma');
    expect(trace.schema_warnings).toBeUndefined();
  });
});

describe('safeParseTrace — deterministic self_check override (v0.8/v0.9)', () => {
  it('shape 1: clean + values_conflict flag → auto_warn (values_tension_flag)', () => {
    const { trace } = safeParseTrace(raw(validAgent({
      flags: ['values_conflict'],
      self_check: { status: 'clean', notes: 'all good' },
    })), 'alpha');
    expect(trace.self_check.status).toBe('auto_warn');
    expect(trace.self_check.self_check_overridden).toBe(true);
    expect(trace.self_check.self_check_original_status).toBe('clean');
    expect(trace.self_check.override_reason).toBe('values_tension_flag');
    expect(trace.self_check.notes).toBe('all good'); // original notes preserved
  });

  it('shape 1: contested_domain also triggers the flags path', () => {
    const { trace } = safeParseTrace(raw(validAgent({
      flags: ['contested_domain'],
      self_check: { status: 'clean', notes: '' },
    })), 'beta');
    expect(trace.self_check.status).toBe('auto_warn');
    expect(trace.self_check.override_reason).toBe('values_tension_flag');
  });

  it('shape 2: reconciler clean + disagreement_classification "values" → auto_warn (v0.9 fix)', () => {
    // The exact escape found in the matched-panel re-run: reconciler has no flags[],
    // declares tension via disagreement_classification instead.
    const { trace } = safeParseTrace(raw(validAgent({
      disagreement_classification: 'values',
      values_in_conflict: [],
      self_check: { status: 'clean', notes: 'reconciled' },
    })), 'gamma');
    expect(trace.self_check.status).toBe('auto_warn');
    expect(trace.self_check.override_reason).toBe('reconciler_values_disagreement');
    expect(trace.self_check.self_check_original_status).toBe('clean');
  });

  it('shape 2: non-empty values_in_conflict alone also triggers the reconciler path', () => {
    const { trace } = safeParseTrace(raw(validAgent({
      disagreement_classification: 'reasoning',
      values_in_conflict: ['human oversight', 'harm prevention'],
      self_check: { status: 'clean', notes: '' },
    })), 'gamma');
    expect(trace.self_check.status).toBe('auto_warn');
    expect(trace.self_check.override_reason).toBe('reconciler_values_disagreement');
  });

  it('when both shapes fire, the flags path wins the override_reason', () => {
    const { trace } = safeParseTrace(raw(validAgent({
      flags: ['values_conflict'],
      disagreement_classification: 'values',
      self_check: { status: 'clean', notes: '' },
    })), 'gamma');
    expect(trace.self_check.override_reason).toBe('values_tension_flag');
  });

  it('does NOT override a self-reported "warning" — only "clean" escapes are patched', () => {
    const { trace } = safeParseTrace(raw(validAgent({
      flags: ['values_conflict'],
      self_check: { status: 'warning', notes: 'honest tension' },
    })), 'alpha');
    expect(trace.self_check.status).toBe('warning');
    expect(trace.self_check.self_check_overridden).toBeUndefined();
  });

  it('does NOT override clean when only benign flags are present', () => {
    const { trace } = safeParseTrace(raw(validAgent({
      flags: ['incomplete_data', 'assumption_heavy'],
      self_check: { status: 'clean', notes: '' },
    })), 'alpha');
    expect(trace.self_check.status).toBe('clean');
  });

  it('does NOT override clean with empty flags and no reconciler tension', () => {
    const { trace } = safeParseTrace(raw(validAgent({
      flags: [],
      self_check: { status: 'clean', notes: '' },
    })), 'alpha');
    expect(trace.self_check.status).toBe('clean');
  });
});

describe('safeParseTrace — failure capture', () => {
  it('captures unparseable output as serialization_failure with the raw preserved', () => {
    const { ok, trace, error } = safeParseTrace(raw('I refuse to answer in JSON.'), 'alpha');
    expect(ok).toBe(false);
    expect(trace._ok).toBe(false);
    expect(trace.claim).toBe('[parse failed]');
    expect(trace.confidence).toBeNull();
    expect(trace.flags).toContain('serialization_failure');
    expect(trace.raw_reasoning_attempt).toBe('I refuse to answer in JSON.');
    expect(trace.self_check.status).toBe('failed');
    expect(error).toBeTruthy();
  });

  it('flags truncation when the stop reason is max_tokens', () => {
    const { trace } = safeParseTrace(
      raw('{"claim": "cut off mid-', { stopReason: 'max_tokens', usage: { output_tokens: 5000 } }),
      'gamma'
    );
    expect(trace.flags).toEqual(expect.arrayContaining(['serialization_failure', 'truncation_detected']));
    expect(trace.failure_reason).toMatch(/Truncated at max_tokens \(5000\)/);
    expect(trace.self_check.notes).toBe('Token budget exceeded.');
    expect(trace._meta.truncated).toBe(true);
  });

  it('handles null/empty raw without throwing', () => {
    const { ok, trace } = safeParseTrace(raw(''), 'alpha');
    expect(ok).toBe(false);
    expect(trace._ok).toBe(false);
    const nullRaw = safeParseTrace(raw(null), 'alpha');
    expect(nullRaw.ok).toBe(false);
  });
});
