// SPDX-License-Identifier: Apache-2.0
//
// Injection-battery resolution shared by detector.js / stats.js / rescore.mjs.
//
// Re-scoring a results file needs each injection's metadata (premise_markers,
// pushes_verdict, truth_value). Naively merging every injections*.json into one
// id→injection map silently corrupts re-scores: the same id can exist in two
// batteries with DIFFERENT content (cyber-true-control-attribution has different
// premise_markers in injections-hard.json vs injections-logical.json), and
// last-file-wins resolution scores one battery's traces against the other's
// markers.
//
// Resolution order, per results file:
//   1. A per-run `injection` snapshot embedded in the results JSON (written by
//      run.js since the 2026-07 self-containment fix) — always authoritative;
//      immune to later battery edits.
//   2. The battery named in the results file's top-level `battery` field.
//   3. The unique battery whose id set covers every injection_id in the results
//      file (all committed legacy files resolve unambiguously this way).
//   4. The merged index — but resolving a CONFLICTED id (same id, different
//      content across batteries) this way is an error, reported to the caller.

import fs from "fs";
import path from "path";

// Key-order-independent canonical form, so cosmetic reordering between battery
// files doesn't read as a content conflict.
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

// Load every injections*.json in `dir`.
// Returns { byFile: { file → { id → injection } }, merged: { id → injection },
//           conflicts: Set<id> } where `conflicts` holds ids whose content
// differs across batteries (unsafe to resolve from `merged`).
export function loadBatteries(dir) {
  const byFile = {};
  const merged = {};
  const conflicts = new Set();
  const seen = {}; // id → canonical content of first sighting
  for (const bf of fs
    .readdirSync(dir)
    .filter((f) => /^injections.*\.json$/.test(f))
    .sort()) {
    let battery;
    try {
      battery = JSON.parse(fs.readFileSync(path.join(dir, bf), "utf8"));
    } catch {
      continue; // skip an unparseable battery
    }
    const map = {};
    for (const inj of battery.injections || []) {
      if (!inj.id) continue;
      map[inj.id] = inj;
      const c = canonical(inj);
      if (seen[inj.id] != null && seen[inj.id] !== c) conflicts.add(inj.id);
      if (seen[inj.id] == null) seen[inj.id] = c;
      merged[inj.id] = inj;
    }
    byFile[bf] = map;
  }
  return { byFile, merged, conflicts };
}

// Pick the battery for one results file: the file named in `data.battery` if
// present, else the unique battery covering every injection_id in the runs.
// Returns { file, map } or null when no single battery covers the ids.
export function chooseBattery(data, batteries) {
  if (data.battery && batteries.byFile[data.battery]) {
    return { file: data.battery, map: batteries.byFile[data.battery] };
  }
  const ids = [...new Set((data.runs || []).map((r) => r.injection_id).filter(Boolean))];
  const covering = Object.entries(batteries.byFile).filter(([, map]) =>
    ids.every((id) => map[id])
  );
  if (covering.length === 1) {
    return { file: covering[0][0], map: covering[0][1] };
  }
  // 0 (nothing covers) or >1 (ambiguous — only possible if a battery's id set
  // is a subset of another's): no safe single choice.
  return null;
}

// Build a resolver for one results file. Returns { resolve(run), notes } where
// resolve(run) → injection|null and notes[] describes how resolution happened
// (for the caller to print once per file).
export function makeInjectionResolver(data, batteries) {
  const chosen = chooseBattery(data, batteries);
  const notes = [];
  if (chosen) {
    notes.push(`battery: ${chosen.file}${data.battery ? " (recorded in results file)" : " (inferred: unique covering battery)"}`);
  } else {
    notes.push(
      "battery: UNRESOLVED — falling back to the merged index; ids duplicated across batteries with differing content cannot be safely re-scored"
    );
  }
  const resolve = (run) => {
    // 1. Embedded snapshot — authoritative.
    if (run.injection && run.injection.id === run.injection_id) return run.injection;
    // 2/3. The chosen battery.
    if (chosen) return chosen.map[run.injection_id] || null;
    // 4. Merged index, refusing conflicted ids.
    if (batteries.conflicts.has(run.injection_id)) {
      notes.push(
        `id "${run.injection_id}" is defined differently in multiple batteries — skipped (pass a snapshot-bearing results file or add a "battery" field)`
      );
      return null;
    }
    return batteries.merged[run.injection_id] || null;
  };
  return { resolve, notes };
}
