// SPDX-License-Identifier: Apache-2.0
import { EXPORT_SCHEMA_VERSION, ARM_VERSION } from "../config.js";

// ─── Export helper ────────────────────────────────────────────────────────────
// Strips any pre-existing export_integrity_hash before hashing so a re-export
// cannot overwrite the seal with a hash of a hash-bearing payload.
export async function exportJSON(data) {
  const { export_integrity_hash: _ignored, ...payload } = data || {};
  const jsonStr = JSON.stringify(payload, null, 2);
  if (!globalThis.crypto?.subtle) throw new Error("WebCrypto unavailable — cannot compute export_integrity_hash");
  const hashBuffer = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(jsonStr));
  const hashHex = Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, "0")).join("");
  const final = JSON.stringify({ export_integrity_hash: hashHex, ...payload }, null, 2);
  const blob = new Blob([final], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `arm-v${ARM_VERSION}-run-${Date.now()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export { EXPORT_SCHEMA_VERSION };
