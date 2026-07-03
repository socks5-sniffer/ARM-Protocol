// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Blob as NodeBlob } from 'node:buffer';
import { exportJSON } from '../lib/exportTrace.js';

// Reproduce the documented verification procedure from the README:
// remove export_integrity_hash, JSON.stringify(payload, null, 2), SHA-256 the result.
async function sha256Hex(str) {
  const buf = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

describe('exportJSON — integrity seal', () => {
  let capturedBlob;

  beforeEach(() => {
    capturedBlob = null;
    // jsdom's Blob has no .text() — use Node's, which does
    vi.stubGlobal('Blob', NodeBlob);
    // jsdom has no URL.createObjectURL — capture the blob instead of downloading
    vi.stubGlobal('URL', Object.assign(Object.create(URL), {
      createObjectURL: vi.fn((blob) => { capturedBlob = blob; return 'blob:test'; }),
      revokeObjectURL: vi.fn(),
    }));
    vi.spyOn(globalThis.HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  });

  afterEach(async () => {
    // exportJSON schedules revokeObjectURL on a 0ms timer — let it fire while the
    // URL stub is still in place, so it can't escape as an unhandled error.
    await new Promise((r) => setTimeout(r, 0));
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('seals the export with a SHA-256 hash verifiable by the documented procedure', async () => {
    const payload = { arm_version: '0.9', runMeta: { disagreement: 'values' }, convergence: 0.158 };
    await exportJSON(payload);

    expect(capturedBlob).not.toBeNull();
    const exported = JSON.parse(await capturedBlob.text());
    expect(exported.export_integrity_hash).toMatch(/^[0-9a-f]{64}$/);

    const { export_integrity_hash, ...rest } = exported;
    const expected = await sha256Hex(JSON.stringify(rest, null, 2));
    expect(export_integrity_hash).toBe(expected);
  });

  it('strips a pre-existing hash before hashing — no hash-of-a-hash on re-export', async () => {
    const payload = { arm_version: '0.9', convergence: 0.5 };
    await exportJSON({ export_integrity_hash: 'deadbeef'.repeat(8), ...payload });

    const exported = JSON.parse(await capturedBlob.text());
    const { export_integrity_hash, ...rest } = exported;
    // The stale seal must not appear in the hashed payload
    expect(JSON.stringify(rest)).not.toContain('deadbeef');
    const expected = await sha256Hex(JSON.stringify(rest, null, 2));
    expect(export_integrity_hash).toBe(expected);
  });

  it('places the hash as the first key so exports are visually verifiable', async () => {
    await exportJSON({ a: 1 });
    const text = await capturedBlob.text();
    expect(Object.keys(JSON.parse(text))[0]).toBe('export_integrity_hash');
  });
});
