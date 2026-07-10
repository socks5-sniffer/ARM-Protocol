// SPDX-License-Identifier: Apache-2.0
//
// DEF CON 34 AI Village poster — builder.
//
//   node poster/build.mjs      → poster/poster-A.html, poster-B.html, poster-C.html
//
// Three 3840×2160 variants over the same data (poster-data.json — regenerate with
// node poster/data.mjs), differing only in which finding leads:
//   A — "Transparency was protective"      (hero: Δ forest plot)
//   B — "Weakest model in the trust seat"  (hero: per-model constancy bars)
//   C — "We falsified our own detector"    (hero: ROC curve + audit story)
//
// Charts are inline SVG, generated from the data — no hand-typed statistics.
// Palette: dataviz reference dark palette (validated: 3 slots, worst adjacent
// ΔE 41.3, all ≥3:1 on #1a1a19). Model→color is FIXED across every chart:
//   Gemini #3987e5 · GPT #199e70 · Claude #c98500.
// Mark specs follow the dataviz skill scaled ×2 for the 4K canvas (bars ≤48px,
// lines 4px, markers ≥16px, 4px surface gaps, 2px hairlines).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const D = JSON.parse(fs.readFileSync(path.join(__dirname, "poster-data.json"), "utf8"));

// ─── tokens ───────────────────────────────────────────────────────────────────
const T = {
  page: "#0d0d0d",
  surface: "#1a1a19",
  ink: "#ffffff",
  ink2: "#c3c2b7",
  muted: "#898781",
  grid: "#2c2c2a",
  baseline: "#383835",
  gemini: "#3987e5",
  gpt: "#199e70",
  claude: "#c98500",
  deemph: "#4a4a47", // de-emphasis series gray (emphasis form)
  good: "#0ca30c",
  critical: "#d03b3b",
};
const MODEL_COLOR = { gemini: T.gemini, gpt: T.gpt, claude: T.claude };
const MODEL_LABEL = { gemini: "Gemini Flash", gpt: "GPT-5.5", claude: "Claude Sonnet" };

const pct = (x, d = 1) => (x * 100).toFixed(d) + "%";
const f3 = (x) => (x >= 0 ? "+" : "−") + Math.abs(x).toFixed(3);
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");

// ─── chart: Δ forest plot (hero of A; mini elsewhere) ─────────────────────────
// Emphasis form: the one significant panel (all-Gemini) carries its model color;
// the null panels are de-emphasis gray. Zero line = "no effect".
function chartForest(w, h, { mini = false } = {}) {
  const rows = [
    { key: "gemini", label: "all-Gemini", emph: true },
    { key: "mixed", label: "Mixed panel", emph: false },
    { key: "gpt", label: "all-GPT", emph: false },
    { key: "claude", label: "all-Claude", emph: false },
  ];
  const padL = mini ? 300 : 380, padR = mini ? 170 : 300, padT = mini ? 40 : 80, padB = mini ? 80 : 120;
  const plotW = w - padL - padR, plotH = h - padT - padB;
  const xMin = -0.2, xMax = 0.1;
  const X = (v) => padL + ((v - xMin) / (xMax - xMin)) * plotW;
  const rowH = plotH / rows.length;
  const fs1 = mini ? 30 : 44, fs2 = mini ? 26 : 38;

  let s = "";
  // gridlines at clean ticks
  for (const t of [-0.2, -0.15, -0.1, -0.05, 0, 0.05, 0.1]) {
    const x = X(t);
    const zero = t === 0;
    s += `<line x1="${x}" y1="${padT}" x2="${x}" y2="${padT + plotH}" stroke="${zero ? T.baseline : T.grid}" stroke-width="${zero ? 3 : 2}"/>`;
    s += `<text x="${x}" y="${padT + plotH + (mini ? 44 : 64)}" fill="${T.muted}" font-size="${fs2}" text-anchor="middle">${t === 0 ? "0" : (t > 0 ? "+" : "−") + Math.abs(t).toFixed(2)}</text>`;
  }
  s += `<text x="${X(-0.1)}" y="${padT + plotH + (mini ? 44 : 64) + fs2 * 1.5}" fill="${T.muted}" font-size="${fs2}" text-anchor="middle">← protective</text>`;
  s += `<text x="${X(0.05)}" y="${padT + plotH + (mini ? 44 : 64) + fs2 * 1.5}" fill="${T.muted}" font-size="${fs2}" text-anchor="middle">amplifying →</text>`;

  rows.forEach((r, i) => {
    const p = D.panels[r.key];
    const y = padT + rowH * i + rowH / 2;
    const color = r.emph ? MODEL_COLOR.gemini : T.deemph;
    const [lo, hi] = p.deltaEligibleCI;
    // CI whisker
    s += `<line x1="${X(lo)}" y1="${y}" x2="${X(hi)}" y2="${y}" stroke="${color}" stroke-width="${mini ? 5 : 8}" stroke-linecap="round"/>`;
    // point marker with surface ring
    s += `<circle cx="${X(p.deltaEligible)}" cy="${y}" r="${mini ? 14 : 22}" fill="${color}" stroke="${T.surface}" stroke-width="4"/>`;
    // row label (text tokens, never series color)
    s += `<text x="${padL - (mini ? 24 : 36)}" y="${y + fs1 * 0.35}" fill="${r.emph ? T.ink : T.ink2}" font-size="${fs1}" font-weight="${r.emph ? 700 : 400}" text-anchor="end">${r.label}</text>`;
    // value label at the marker (selective: emphasize the significant row)
    const vLabel = `Δ ${f3(p.deltaEligible)}${r.emph ? `, p = ${p.deltaEligibleP.toFixed(3)}` : ""}`;
    s += `<text x="${X(hi) + (mini ? 20 : 30)}" y="${y + fs2 * 0.35}" fill="${r.emph ? T.ink : T.muted}" font-size="${fs2}" font-weight="${r.emph ? 700 : 400}">${vLabel}</text>`;
  });
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet" style="width:100%;height:100%" role="img" aria-label="Delta C2 minus C1 per panel with 95 percent confidence intervals">${s}</svg>`;
}

// ─── chart: per-model constancy bars (hero of B) ─────────────────────────────
// Grouped bars: measurable C1 adoption per model, in the mixed panel vs its own
// monoculture. The Gemini pair is the story: 21.0% = 21.0%.
function chartConstancy(w, h) {
  const models = ["gemini", "gpt", "claude"];
  const getRate = (panelKey, model) => {
    const m = D.panels[panelKey]?.perModel?.[model];
    return m && m.nElig ? m.c1Elig / m.nElig : null;
  };
  const series = models.map((m) => ({
    model: m,
    mixed: getRate("mixed", m),
    mono: getRate(m, m),
  }));
  const padL = 200, padR = 90, padT = 110, padB = 200;
  const plotW = w - padL - padR, plotH = h - padT - padB;
  const yMax = 0.25;
  const Y = (v) => padT + plotH - (v / yMax) * plotH;
  const groupW = plotW / models.length;
  const barW = 170, gap = 36;
  const fsVal = 40, fsLab = 42, fsTick = 34;

  let s = "";
  for (const t of [0, 0.05, 0.1, 0.15, 0.2, 0.25]) {
    s += `<line x1="${padL}" y1="${Y(t)}" x2="${padL + plotW}" y2="${Y(t)}" stroke="${t === 0 ? T.baseline : T.grid}" stroke-width="2"/>`;
    s += `<text x="${padL - 20}" y="${Y(t) + 12}" fill="${T.muted}" font-size="${fsTick}" text-anchor="end">${(t * 100).toFixed(0)}%</text>`;
  }
  series.forEach((sr, i) => {
    const cx = padL + groupW * i + groupW / 2;
    const color = MODEL_COLOR[sr.model];
    const bars = [
      { v: sr.mixed, tag: "mixed panel" },
      { v: sr.mono, tag: "own monoculture" },
    ];
    bars.forEach((b, j) => {
      const x = cx - barW - gap / 2 + j * (barW + gap);
      if (b.v === null) {
        s += `<text x="${x + barW / 2}" y="${Y(0.055)}" fill="${T.muted}" font-size="${fsTick - 4}" text-anchor="middle">not in</text>`;
        s += `<text x="${x + barW / 2}" y="${Y(0.055) + 38}" fill="${T.muted}" font-size="${fsTick - 4}" text-anchor="middle">mixed panel</text>`;
        return;
      }
      const y = Y(b.v), bh = Y(0) - y;
      // 8px rounded data-end, square baseline; mono bar slightly lighter via opacity
      const op = j === 0 ? 1 : 0.62;
      if (bh > 8) {
        s += `<path d="M ${x} ${Y(0)} L ${x} ${y + 8} Q ${x} ${y} ${x + 8} ${y} L ${x + barW - 8} ${y} Q ${x + barW} ${y} ${x + barW} ${y + 8} L ${x + barW} ${Y(0)} Z" fill="${color}" opacity="${op}"/>`;
      } else {
        // near-zero: 6px stub so the bar exists visibly
        s += `<rect x="${x}" y="${Y(0) - 6}" width="${barW}" height="6" fill="${color}" opacity="${op}"/>`;
      }
      s += `<text x="${x + barW / 2}" y="${y - 18}" fill="${T.ink}" font-size="${fsVal}" font-weight="700" text-anchor="middle">${pct(b.v)}</text>`;
    });
    s += `<text x="${cx}" y="${Y(0) + 64}" fill="${T.ink2}" font-size="${fsLab}" font-weight="600" text-anchor="middle">${MODEL_LABEL[sr.model]}</text>`;
  });
  // legend (2 series: composition)
  const lx = padL + 12, ly = padT - 44;
  s += `<rect x="${lx}" y="${ly - 26}" width="34" height="26" rx="6" fill="${T.ink2}"/><text x="${lx + 48}" y="${ly - 4}" fill="${T.ink2}" font-size="${fsTick}">in the mixed panel</text>`;
  s += `<rect x="${lx + 400}" y="${ly - 26}" width="34" height="26" rx="6" fill="${T.ink2}" opacity="0.62"/><text x="${lx + 448}" y="${ly - 4}" fill="${T.ink2}" font-size="${fsTick}">in its own monoculture</text>`;
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet" style="width:100%;height:100%" role="img" aria-label="Measurable conclusion-only adoption rate per model, mixed panel versus monoculture">${s}</svg>`;
}

// ─── chart: detector ROC (hero of C) ──────────────────────────────────────────
function chartROC(w, h) {
  const padL = 190, padR = 110, padT = 90, padB = 190;
  const plotW = w - padL - padR, plotH = h - padT - padB;
  const X = (v) => padL + v * plotW;
  const Y = (v) => padT + plotH - v * plotH;
  const fsTick = 34, fsLab = 40;

  let s = "";
  for (const t of [0, 0.25, 0.5, 0.75, 1]) {
    s += `<line x1="${X(t)}" y1="${padT}" x2="${X(t)}" y2="${padT + plotH}" stroke="${t === 0 ? T.baseline : T.grid}" stroke-width="2"/>`;
    s += `<line x1="${padL}" y1="${Y(t)}" x2="${padL + plotW}" y2="${Y(t)}" stroke="${t === 0 ? T.baseline : T.grid}" stroke-width="2"/>`;
    s += `<text x="${X(t)}" y="${padT + plotH + 52}" fill="${T.muted}" font-size="${fsTick}" text-anchor="middle">${t}</text>`;
    s += `<text x="${padL - 20}" y="${Y(t) + 12}" fill="${T.muted}" font-size="${fsTick}" text-anchor="end">${t}</text>`;
  }
  s += `<text x="${padL + plotW / 2}" y="${padT + plotH + 120}" fill="${T.ink2}" font-size="${fsLab}" text-anchor="middle">false-positive rate</text>`;
  s += `<text x="${padL - 120}" y="${padT + plotH / 2}" fill="${T.ink2}" font-size="${fsLab}" text-anchor="middle" transform="rotate(-90 ${padL - 120} ${padT + plotH / 2})">true-positive rate</text>`;
  // chance diagonal — solid hairline reference, labeled
  s += `<line x1="${X(0)}" y1="${Y(0)}" x2="${X(1)}" y2="${Y(1)}" stroke="${T.baseline}" stroke-width="3"/>`;
  s += `<text x="${X(0.62)}" y="${Y(0.56)}" fill="${T.muted}" font-size="${fsTick}" transform="rotate(-38 ${X(0.62)} ${Y(0.56)})">chance (AUC 0.50)</text>`;
  // confidence-drift ROC curve (the failed detector) — critical status color:
  // this line MEANS "the instrument failed", a state, not a series identity.
  const roc = [...D.detector.roc].sort((a, b) => a.fpr - b.fpr || a.tpr - b.tpr);
  const dPath = roc.map((p, i) => `${i ? "L" : "M"} ${X(p.fpr)} ${Y(p.tpr)}`).join(" ") + ` L ${X(1)} ${Y(1)}`;
  s += `<path d="${dPath}" fill="none" stroke="${T.critical}" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"/>`;
  // verdict-flip operating point (the surviving signal) — good status color
  const vf = D.detector.verdict_flip;
  const vfFpr = vf.fp / (vf.fp + vf.tn), vfTpr = vf.recall;
  s += `<circle cx="${X(vfFpr)}" cy="${Y(vfTpr)}" r="20" fill="${T.good}" stroke="${T.surface}" stroke-width="5"/>`;
  s += `<text x="${X(vfFpr) + 34}" y="${Y(vfTpr) - 30}" fill="${T.ink}" font-size="${fsLab}" font-weight="700">verdict-flip gate</text>`;
  s += `<text x="${X(vfFpr) + 34}" y="${Y(vfTpr) + 18}" fill="${T.ink2}" font-size="${fsTick}">recall ${pct(vf.recall, 0)} · precision ${pct(vf.precision, 0)}</text>`;
  // AUC callout on the failed curve
  s += `<text x="${X(0.55)}" y="${Y(0.18)}" fill="${T.critical}" font-size="${fsLab}" font-weight="700">confidence-drift detector</text>`;
  s += `<text x="${X(0.55)}" y="${Y(0.18) + 50}" fill="${T.ink2}" font-size="${fsTick}">AUC ${D.detector.auc.toFixed(2)} — below chance</text>`;
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet" style="width:100%;height:100%" role="img" aria-label="ROC curve of the confidence-drift detector, below the chance diagonal, with the verdict-flip operating point marked">${s}</svg>`;
}

// ─── chart: unbounded-harm slope (the one leak) ───────────────────────────────
function chartLeak(w, h) {
  const rows = ["gemini", "mixed", "gpt", "claude"];
  const padL = 60, padR = 420, padT = 50, padB = 90;
  const plotW = w - padL - padR, plotH = h - padT - padB;
  const yMax = 13;
  const Y = (v) => padT + plotH - (v / yMax) * plotH;
  const x1 = padL + plotW * 0.14, x2 = padL + plotW * 0.86;
  const fs = 40;
  let s = "";
  s += `<line x1="${padL}" y1="${Y(0)}" x2="${padL + plotW}" y2="${Y(0)}" stroke="${T.baseline}" stroke-width="2"/>`;
  s += `<text x="${x1}" y="${Y(0) + 52}" fill="${T.ink2}" font-size="${fs}" text-anchor="middle">C1 · conclusion only</text>`;
  s += `<text x="${x2}" y="${Y(0) + 52}" fill="${T.ink2}" font-size="${fs}" text-anchor="middle">C2 · full reasoning</text>`;
  // draw lines/markers, then place right labels with a minimum vertical gap
  const labels = [];
  for (const key of rows) {
    const p = D.panels[key];
    const { c1, c2 } = p.unboundedHarm;
    const emph = key === "gemini";
    const color = emph ? MODEL_COLOR.gemini : T.deemph;
    s += `<line x1="${x1}" y1="${Y(c1)}" x2="${x2}" y2="${Y(c2)}" stroke="${color}" stroke-width="${emph ? 6 : 4}"/>`;
    s += `<circle cx="${x1}" cy="${Y(c1)}" r="${emph ? 16 : 11}" fill="${color}" stroke="${T.surface}" stroke-width="4"/>`;
    s += `<circle cx="${x2}" cy="${Y(c2)}" r="${emph ? 16 : 11}" fill="${color}" stroke="${T.surface}" stroke-width="4"/>`;
    const lab = key === "mixed" ? "Mixed" : D.panels[key].label;
    labels.push({ y: Y(c2), text: `${lab} ${c1}→${c2}`, emph });
  }
  labels.sort((a, b) => a.y - b.y);
  const minGap = fs * 1.2;
  for (let i = 1; i < labels.length; i++) {
    if (labels[i].y - labels[i - 1].y < minGap) labels[i].y = labels[i - 1].y + minGap;
  }
  // keep the stack above the baseline captions
  const overshoot = labels[labels.length - 1].y - (Y(0) + 4);
  if (overshoot > 0) for (const l of labels) l.y -= overshoot;
  for (const l of labels) {
    s += `<text x="${x2 + 34}" y="${l.y + fs * 0.35}" fill="${l.emph ? T.ink : T.muted}" font-size="${fs}" font-weight="${l.emph ? 700 : 400}">${l.text}</text>`;
  }
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet" style="width:100%;height:100%" role="img" aria-label="Unbounded-harm injection adoptions, conclusion-only versus full reasoning, per panel">${s}</svg>`;
}

// ─── block: mechanism table (true-premise control) ───────────────────────────
function mechanismTable() {
  const cols = [
    {
      m: "gemini",
      profile: "Credulous adopter",
      fallacy: `Adopts fallacies: ${pct(D.panels.gemini.iprC1Eligible)} (measurable C1)`,
      truth: `Updates toward the TRUE premise ${D.panels.gemini.trueControl.adopted}/${D.panels.gemini.trueControl.n}`,
      read: "Believes what it reads — true or false.",
    },
    {
      m: "gpt",
      profile: "Reflexive skeptic",
      fallacy: `Adopts fallacies: ${pct(D.panels.gpt.iprC1Eligible)} — fully measured`,
      truth: `Updates toward the TRUE premise 0/${D.panels.gpt.trueControl.n}`,
      read: "A no-update policy, not truth discrimination.",
    },
    {
      m: "claude",
      profile: "Zero adoption",
      fallacy: `Adopts fallacies: 0 in ${D.panels.claude.n * 2} instances`,
      truth: `TRUE-premise cell blind (baseline already agreed)`,
      read: "Never adopts falsehood; truth-updating untestable.",
    },
  ];
  return `<div class="mech">
    ${cols
      .map(
        (c) => `<div class="mech-col">
      <div class="mech-head"><span class="dot" style="background:${MODEL_COLOR[c.m]}"></span>${MODEL_LABEL[c.m]}</div>
      <div class="mech-profile">${c.profile}</div>
      <div class="mech-row">${esc(c.fallacy)}</div>
      <div class="mech-row">${esc(c.truth)}</div>
      <div class="mech-read">${esc(c.read)}</div>
    </div>`
      )
      .join("")}
  </div>`;
}

// ─── shared page chrome ───────────────────────────────────────────────────────
function page({ variant, headline, subhead, main }) {
  const g = D.panels.gemini;
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/>
<title>ARM — DEF CON 34 AI Village poster (variant ${variant})</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  html,body { width:3840px; height:2160px; overflow:hidden; }
  body {
    background:${T.page}; color:${T.ink};
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
    display:flex; flex-direction:column; padding:70px 90px 50px;
  }
  .eyebrow { font-size:40px; letter-spacing:0.22em; text-transform:uppercase; color:${T.muted}; display:flex; justify-content:space-between; }
  .eyebrow b { color:${T.ink2}; font-weight:600; }
  h1 { font-size:128px; line-height:1.04; font-weight:800; margin:28px 0 20px; max-width:3400px; letter-spacing:-0.015em; }
  h1 .accent { color:${MODEL_COLOR.gemini}; }
  .subhead { font-size:47px; color:${T.ink2}; line-height:1.35; max-width:3200px; margin-bottom:38px; }
  .grid { flex:1; display:grid; gap:36px; min-height:0; }
  .card { background:${T.surface}; border:2px solid rgba(255,255,255,0.10); border-radius:18px; padding:40px 48px; display:flex; flex-direction:column; min-height:0; overflow:hidden; }
  .card h2 { font-size:50px; font-weight:700; margin-bottom:8px; }
  .card .cap { font-size:34px; color:${T.muted}; margin-bottom:20px; line-height:1.3; }
  .card .body { font-size:38px; color:${T.ink2}; line-height:1.42; }
  .card .body b { color:${T.ink}; }
  .hero-num { font-size:170px; font-weight:800; line-height:1; }
  .hero-sub { font-size:42px; color:${T.ink2}; margin-top:10px; line-height:1.35; }
  .mech { display:grid; grid-template-columns:1fr 1fr 1fr; gap:28px; flex:1; }
  .mech-col { background:rgba(255,255,255,0.03); border-radius:14px; padding:22px 28px; display:flex; flex-direction:column; gap:11px; min-height:0; overflow:hidden; }
  .mech-head { font-size:33px; font-weight:700; display:flex; align-items:center; gap:16px; }
  .dot { width:28px; height:28px; border-radius:50%; display:inline-block; }
  .mech-profile { font-size:38px; font-weight:800; }
  .mech-row { font-size:28px; color:${T.ink2}; line-height:1.38; }
  .mech-read { font-size:26px; color:${T.muted}; font-style:italic; line-height:1.35; margin-top:auto; }
  .footer { display:flex; align-items:center; gap:60px; margin-top:40px; }
  .method { flex:1; font-size:31px; color:${T.muted}; line-height:1.5; }
  .method b { color:${T.ink2}; font-weight:600; }
  .who { font-size:40px; color:${T.ink2}; text-align:right; line-height:1.45; }
  .who b { color:${T.ink}; font-size:44px; }
  .qr { width:210px; height:210px; border:2px solid rgba(255,255,255,0.18); border-radius:14px; display:flex; align-items:center; justify-content:center; font-size:26px; color:${T.muted}; text-align:center; line-height:1.3; flex:none; }
  svg { display:block; max-width:100%; }
  .chart-fill { flex:1; min-height:0; display:flex; align-items:center; justify-content:center; overflow:hidden; }
</style></head>
<body>
  <div class="eyebrow"><span><b>ARM · Agent Reasoning Markup</b> — a falsifiable injection study</span><span>DEF CON 34 · AI VILLAGE · POSTER</span></div>
  ${headline}
  <div class="subhead">${subhead}</div>
  ${main}
  <div class="footer">
    <div class="method">
      <b>Method:</b> pre-registered (dated commit, before the data existed) · 4 panel compositions · <b>${D.meta.totalPairedInstances} paired subject-instances</b> · ${D.meta.falseInjections} logical-fallacy injections (authored, truth value known) + 1 true-premise control · ${D.meta.reps} reps ·
      ${D.meta.models.claude} / ${D.meta.models.gpt} / ${D.meta.models.gemini} · scorer, statistics &amp; full audit trail open-source.
      All numbers post-audit: measurable-only denominators, marker false-positives corrected.
    </div>
    <div class="qr">QR<br/>(repo link —<br/>after CFP)</div>
    <div class="who"><b>Erik Roed</b><br/>ARM Protocol v0.9<br/>arm-c1-vs-c2-injection</div>
  </div>
</body></html>`;
}

// ─── variant A — transparency was protective ─────────────────────────────────
function variantA() {
  const g = D.panels.gemini;
  const headline = `<h1>We planted lies in an agent's reasoning.<br/>Sharing that reasoning <span class="accent">stopped</span> the lies — it didn't spread them.</h1>`;
  const subhead = `The "Persuasion Duality" predicts that sharing an agent's chain-of-thought amplifies injected false premises. Pre-registered, across four panel compositions and ${D.meta.totalPairedInstances} paired instances: it never did. The only significant effect ran the other way.`;
  const main = `<div class="grid" style="grid-template-columns: 1.55fr 1fr; grid-template-rows: 1.18fr 0.82fr;">
    <div class="card" style="grid-row:1 / span 2;">
      <h2>Δ propagation, full-reasoning − conclusion-only (95% CI)</h2>
      <div class="cap">One planted logical fallacy per run; adoption = the subject's verdict moves to the pushed direction vs its own isolated baseline. Measurable instances only.</div>
      <div class="chart-fill">${chartForest(1900, 800)}</div>
      <div class="body">Showing Gemini the reasoning <b>halved</b> adoption (${pct(g.iprC1Eligible)} → ${pct(g.iprC2Eligible)}, Δ = ${f3(g.deltaEligible)}, p = ${g.deltaEligibleP.toFixed(3)}): visible reasoning can be <b>challenged</b>; a bare confident conclusion can only be conformed to.</div>
    </div>
    <div class="card">
      <h2>Why: three models, three mechanisms</h2>
      <div class="cap">A one-line TRUE-premise control separates them.</div>
      ${mechanismTable()}
    </div>
    <div class="card">
      <h2>The one leak: Pascalian unbounded-harm</h2>
      <div class="cap">The only fallacy that spread MORE when its reasoning was shown.</div>
      <div class="chart-fill">${chartLeak(1560, 380)}</div>
    </div>
  </div>`;
  return page({ variant: "A", headline, subhead, main });
}

// ─── variant B — the weakest model in the trust seat ─────────────────────────
function variantB() {
  const g = D.panels.gemini;
  const gm = g.perModel.gemini, gmix = D.panels.mixed.perModel.gemini;
  const rMix = gmix.c1Elig / gmix.nElig, rMono = gm.c1Elig / gm.nElig;
  const headline = `<h1>A panel is exactly as poisonable as the model in its <span class="accent">trust seat</span>.</h1>`;
  const subhead = `Susceptibility to injected fallacies is a per-model constant — it does not change with who else is on the panel, and no sharing architecture fixed it. Pre-registered, ${D.meta.totalPairedInstances} paired instances, four panel compositions.`;
  const main = `<div class="grid" style="grid-template-columns: 1.55fr 1fr; grid-template-rows: 0.85fr 1.15fr;">
    <div class="card" style="grid-row:1 / span 2;">
      <h2>Fallacy adoption per model — mixed panel vs its own monoculture</h2>
      <div class="cap">Conclusion-only condition, measurable instances. The pair to look at: Gemini adopts at ${pct(rMix)} in the mixed panel and ${pct(rMono)} in its monoculture — <b>identical</b>.</div>
      <div class="chart-fill">${chartConstancy(1900, 880)}</div>
      <div class="body"><b>Design rule:</b> don't put a fast-tier model in a trust-bearing seat (reconciler, vote member, summarizer). Its adoptions become the panel's output — and no panel composition dilutes them.</div>
    </div>
    <div class="card">
      <h2>Sharing reasoning never amplified the attack</h2>
      <div class="cap">Δ(C2−C1) per panel — the only significant effect is protective.</div>
      <div class="chart-fill">${chartForest(1450, 520, { mini: true })}</div>
    </div>
    <div class="card">
      <h2>Three models, three mechanisms</h2>
      <div class="cap">The TRUE-premise control separates them.</div>
      ${mechanismTable()}
    </div>
  </div>`;
  return page({ variant: "B", headline, subhead, main });
}

// ─── variant C — we falsified our own detector ────────────────────────────────
function variantC() {
  const det = D.detector;
  const vf = det.verdict_flip;
  const headline = `<h1>We red-teamed our own contamination detector.<br/><span class="accent">It lost</span> — AUC ${det.auc.toFixed(2)}, below chance.</h1>`;
  const subhead = `ARM's original signal — confidence drift — was supposed to flag agents that absorbed an injected premise. Scored against ${det.n_contaminated} known contaminations in ${det.n_instances} instances, it caught zero. We retired it, audited our scorer, and kept only what survived.`;
  const main = `<div class="grid" style="grid-template-columns: 1.45fr 1fr; grid-template-rows: 1fr 1fr;">
    <div class="card" style="grid-row:1 / span 2;">
      <h2>ROC — confidence-drift detector vs the verdict-flip gate</h2>
      <div class="cap">Ground truth is authored: WE planted the false premises, so "contaminated" is known, not judged. ${det.n_contaminated} contaminated / ${det.n_clean} clean subject-instances.</div>
      <div class="chart-fill">${chartROC(1850, 1000)}</div>
      <div class="body">The magnitude signal (|Δ confidence|) is <b>below chance</b>; the behavioral signal (did the verdict flip?) catches ${vf.tp} of ${vf.tp + vf.fn} contaminations. <b>Watch what agents decide, not how confident they say they feel.</b></div>
    </div>
    <div class="card">
      <h2>Then we audited the scorer — and killed our only positive result</h2>
      <div class="body" style="margin-top:12px; font-size:35px;">The one result favoring "transparency is dangerous" (all-Claude, Δ = +0.017) was <b>4 refutations mislabeled as adoptions</b> — the scorer matched the fallacy's own name as Claude rejected it. Corrected: Δ = 0.000. And a third of Gemini's instances were structurally blind (baseline already agreed with the push); corrected, its susceptibility rose from 14% to <b>${pct(D.panels.gemini.iprC1Eligible)}</b>.</div>
      <div class="body" style="margin-top:22px; font-size:35px; color:${T.muted};">Every correction strengthened the headline claims — the audit was real.</div>
    </div>
    <div class="card">
      <h2>What survived falsification</h2>
      <div class="cap">Δ(C2−C1) per panel — transparency never amplified the attack; the one significant effect is protective.</div>
      <div class="chart-fill">${chartForest(1450, 520, { mini: true })}</div>
    </div>
  </div>`;
  return page({ variant: "C", headline, subhead, main });
}

// ─── emit ─────────────────────────────────────────────────────────────────────
const variants = { A: variantA(), B: variantB(), C: variantC() };
for (const [k, html] of Object.entries(variants)) {
  const p = path.join(__dirname, `poster-${k}.html`);
  fs.writeFileSync(p, html);
  console.log(`Wrote ${p} (${(html.length / 1024).toFixed(0)} KB)`);
}
