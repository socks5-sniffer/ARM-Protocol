// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, vi } from 'vitest';

// Prevent any real network calls during tests
vi.stubGlobal('fetch', vi.fn());

describe('ARMApp', () => {
  it('exports a default React component', async () => {
    const module = await import('../App.jsx');
    expect(typeof module.default).toBe('function');
  });
});
