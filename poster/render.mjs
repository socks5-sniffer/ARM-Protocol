// SPDX-License-Identifier: Apache-2.0
//
// Render the poster HTML variants to 3840×2160 PNGs.
//   npm i --no-save playwright-core   (chromium itself is expected on the machine;
//                                      in the CC cloud env it's /opt/pw-browsers/chromium)
//   node poster/render.mjs [A B C] [--scale 0.25]
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const __dirname = path.dirname(fileURLToPathImport());
function fileURLToPathImport() {
  return fileURLToPath(import.meta.url);
}

const args = process.argv.slice(2);
const scaleIdx = args.indexOf("--scale");
const scale = scaleIdx >= 0 ? parseFloat(args[scaleIdx + 1]) : 1;
const variants = args.filter((a) => /^[ABC]$/.test(a));
const which = variants.length ? variants : ["A", "B", "C"];

const executablePath =
  process.env.CHROMIUM_PATH ||
  (fs.existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);

const browser = await chromium.launch({ executablePath, args: ["--no-sandbox", "--force-color-profile=srgb"] });
const page = await browser.newPage({
  viewport: { width: Math.round(3840 * scale), height: Math.round(2160 * scale) },
  deviceScaleFactor: 1,
});

for (const v of which) {
  const html = path.join(__dirname, `poster-${v}.html`);
  await page.goto("file://" + html);
  if (scale !== 1) {
    await page.addStyleTag({ content: `html { transform: scale(${scale}); transform-origin: top left; }` });
  }
  await page.waitForTimeout(300);
  const out = path.join(__dirname, scale === 1 ? `poster-${v}.png` : `poster-${v}-preview.png`);
  await page.screenshot({ path: out });
  console.log(`Rendered ${out}`);
}
await browser.close();
