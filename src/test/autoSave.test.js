// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildFilename, saveTrace } from '../autoSave.js';

describe('buildFilename', () => {
  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(1782000000000);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const base = {
    version: '0.9',
    questionId: '200',
    providers: { alpha: 'claude', beta: 'claude', gamma: 'claude' },
    roleInjection: true,
    silentAgent: 'gamma',
    status: 'done',
  };

  it('names monoculture runs allProvider', () => {
    expect(buildFilename(base)).toBe('arm-v0.9-q200-allClaude-roles-1782000000000.json');
  });

  it('names mixed panels by provider initials in agent order', () => {
    const f = buildFilename({ ...base, providers: { alpha: 'claude', beta: 'gpt', gamma: 'gemini' } });
    expect(f).toBe('arm-v0.9-q200-CGG-roles-1782000000000.json');
  });

  it('encodes the no-roles condition', () => {
    const f = buildFilename({ ...base, roleInjection: false });
    expect(f).toBe('arm-v0.9-q200-allClaude-noroles-1782000000000.json');
  });

  it('suffixes rotated silent baselines but not the default gamma', () => {
    expect(buildFilename({ ...base, silentAgent: 'alpha' }))
      .toBe('arm-v0.9-q200-allClaude-roles-alphaSilent-1782000000000.json');
    expect(buildFilename({ ...base, silentAgent: 'beta' }))
      .toBe('arm-v0.9-q200-allClaude-roles-betaSilent-1782000000000.json');
    expect(buildFilename({ ...base, silentAgent: 'gamma' })).not.toContain('Silent');
  });

  it('suffixes non-done statuses but not "done"', () => {
    expect(buildFilename({ ...base, status: 'partial' }))
      .toBe('arm-v0.9-q200-allClaude-roles-partial-1782000000000.json');
    expect(buildFilename({ ...base, status: 'done' })).not.toContain('-done-');
  });

  it('falls back to ? initials when providers are missing', () => {
    const f = buildFilename({ ...base, providers: undefined });
    expect(f).toBe('arm-v0.9-q200-???-roles-1782000000000.json');
  });
});

describe('saveTrace', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('POSTs the trace with the access token and returns true on success', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    const ok = await saveTrace({ arm_version: '0.9' }, 'file.json', 'tok123');
    expect(ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith('/api/save-trace', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ 'x-arm-token': 'tok123' }),
    }));
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toEqual({ filename: 'file.json', trace: { arm_version: '0.9' } });
  });

  it('returns false (no throw) on a non-OK response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: 'bad token' }),
    }));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(saveTrace({}, 'f.json', '')).resolves.toBe(false);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('returns false (no throw) when fetch itself rejects', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(saveTrace({}, 'f.json', 'tok')).resolves.toBe(false);
    warn.mockRestore();
  });
});
