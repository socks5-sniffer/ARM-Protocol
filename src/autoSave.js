// SPDX-License-Identifier: Apache-2.0
// Auto-save helpers — called at run completion to write traces to trace/

export function buildFilename({ version, questionId, providers, roleInjection, silentAgent, status }) {
  const providerSet = [providers?.alpha, providers?.beta, providers?.gamma];
  const allSame = providerSet.every((p) => p === providerSet[0]);
  const configId = allSame
    ? `all${providerSet[0].charAt(0).toUpperCase() + providerSet[0].slice(1)}`
    : providerSet.map((p) => p?.[0]?.toUpperCase() ?? "?").join("");
  const roles = roleInjection ? "roles" : "noroles";
  const silent = silentAgent !== "gamma" ? `-${silentAgent}Silent` : "";
  const suffix = status === "done" ? "" : `-${status}`;
  const ts = Date.now();
  return `arm-v${version}-q${questionId}-${configId}-${roles}${silent}${suffix}-${ts}.json`;
}

export async function saveTrace(data, filename, accessToken) {
  try {
    const resp = await fetch("/api/save-trace", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-arm-token": accessToken || "",
      },
      body: JSON.stringify({ filename, trace: data }),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      console.warn("[ARM] auto-save failed:", err.error || resp.status);
    }
  } catch (err) {
    console.warn("[ARM] auto-save error:", err.message);
  }
}
