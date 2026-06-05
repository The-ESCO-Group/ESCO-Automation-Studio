// E2E: ESCO-native Runtime (.easruntime) workflow. Build → Export → re-Import the
// ESCO-owned compiled runtime artifact through the File menu, verify the file is
// a self-describing, checksummed, ESCO-native JSON artifact, and confirm the
// re-imported runtime loads as read-only "ESCO Runtime" provenance. ESCO branding
// only — the runtime workflow never mentions other controller-file formats.
import { chromium } from "playwright-core";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";
import { URL, STARTER_L5X } from "./helpers.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const runtimePath = join(here, "exported-runtime.easruntime");

const results = [];
const check = (l, c, d = "") => {
  results.push(!!c);
  console.log(`${c ? "PASS" : "FAIL"}  ${l}${d ? "  — " + String(d).replace(/\s+/g, " ").slice(0, 160) : ""}`);
};

const fileMenuItem = (page, label) => page.locator(`.esco-ribbon-menu__item:has-text("${label}")`).first();
async function clickFileMenuItem(page, label) {
  await page.locator('.esco-ribbon__tab:has-text("File")').click();
  await page.locator(".esco-ribbon-menu").waitFor({ timeout: 5000 });
  await fileMenuItem(page, label).click();
}
const toast = (page, text) => page.locator(`.esco-toast:has-text("${text}")`).first();
async function dismissToasts(page) {
  while ((await page.locator(".esco-toast__close").count()) > 0) {
    await page.locator(".esco-toast__close").first().click();
  }
}

const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext({ viewport: { width: 1400, height: 950 }, acceptDownloads: true });
const page = await context.newPage();
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));

try {
  await page.goto(URL, { waitUntil: "networkidle" });

  // Setup: load a populated project so there is something to compile.
  const [setupChooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    clickFileMenuItem(page, "Import L5X"),
  ]);
  await setupChooser.setFiles({ name: "starter.L5X", mimeType: "application/xml", buffer: Buffer.from(STARTER_L5X) });
  await page.locator(".esco-tree__node--routine, .esco-tree__node--controller").first().waitFor({ timeout: 8000 });
  await dismissToasts(page);

  // 1) Build ESCO Runtime.
  await clickFileMenuItem(page, "Build ESCO Runtime");
  await toast(page, "Built ESCO Runtime").waitFor({ timeout: 8000 });
  check("File > Build ESCO Runtime reports a successful build", true);
  await dismissToasts(page);

  // 2) Export ESCO Runtime (browser download).
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    clickFileMenuItem(page, "Export ESCO Runtime"),
  ]);
  const suggested = download.suggestedFilename();
  check("Export ESCO Runtime downloads a .easruntime file", /\.easruntime$/i.test(suggested), suggested);
  await download.saveAs(runtimePath);

  // 3) The artifact is a self-describing, checksummed, ESCO-native JSON file.
  const file = JSON.parse(readFileSync(runtimePath, "utf8"));
  check("artifact declares the ESCO Runtime format", file.formatName === "ESCO Automation Studio Runtime", file.formatName);
  check("artifact uses the .easruntime extension", file.extension === ".easruntime", file.extension);
  check("artifact carries a sha256 integrity checksum", /^[0-9a-f]{64}$/.test(file.checksum?.value ?? ""), file.checksum?.value);
  check("artifact provenance is ESCO-native", file.runtime?.provenance?.source === "esco-native", JSON.stringify(file.runtime?.provenance));
  check("artifact has a compiled execution order", Array.isArray(file.runtime?.build?.executionOrder));
  check("artifact records initial tag values", file.runtime?.initialValues && typeof file.runtime.initialValues === "object");

  await dismissToasts(page);

  // 4) Re-import the ESCO Runtime and confirm it loads as read-only runtime source.
  const [importChooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    clickFileMenuItem(page, "Import ESCO Runtime"),
  ]);
  await importChooser.setFiles(runtimePath);
  await toast(page, "Imported ESCO Runtime").waitFor({ timeout: 8000 });
  const importText = await toast(page, "Imported ESCO Runtime").innerText();
  check("Import ESCO Runtime loads the artifact", true);
  check("import reports verified integrity", /Integrity verified/i.test(importText), importText);
  await dismissToasts(page);

  // 5) Provenance marks it clearly as compiled, read-only ESCO Runtime.
  await clickFileMenuItem(page, "Project Properties");
  await page.locator(".esco-project-props").waitFor({ timeout: 8000 });
  await page.locator('.esco-controller-props__tabs button:has-text("Source")').click();
  const sourceText = await page.locator(".esco-project-props__body").innerText();
  check("Project Properties marks the source as ESCO Runtime", /ESCO Runtime/i.test(sourceText), sourceText);

  const passed = results.filter(Boolean).length;
  console.log(`\nSUMMARY: ${passed}/${results.length} checks passed`);
  process.exitCode = passed === results.length ? 0 : 1;
} catch (err) {
  console.log("ERROR:", err.message);
  await page.screenshot({ path: join(here, "easrt-error.png") }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
