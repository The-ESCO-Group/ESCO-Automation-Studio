import { chromium } from "playwright-core";
import { URL, clickFileMenuItem, dismissToasts, importStarterProject } from "./helpers.mjs";

const results = [];
const check = (label, cond, detail = "") => {
  results.push(!!cond);
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${detail ? "  - " + String(detail).replace(/\s+/g, " ").slice(0, 140) : ""}`);
};

const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, acceptDownloads: true });
const page = await context.newPage();
page.on("pageerror", (error) => console.log("PAGEERROR:", error.message));

try {
  await page.goto(URL, { waitUntil: "networkidle" });
  await importStarterProject(page);
  await dismissToasts(page);

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    clickFileMenuItem(page, "Export ESCO Package"),
  ]);
  const filename = download.suggestedFilename();
  await page.locator('.esco-dock__tab.is-active:has-text("Build")').waitFor({ timeout: 8000 });
  await page.locator(".esco-package-preview:not(.is-empty)").waitFor({ timeout: 8000 });
  const text = await page.locator(".esco-package-preview").innerText();

  check("Export ESCO Package still downloads an .easpkg artifact", /\.easpkg$/i.test(filename), filename);
  check("Build dock exposes ESCO package manifest preview", /ESCO Package Manifest/i.test(text), text);
  check("package preview names package checksum and entry counts", /Package checksum/i.test(text) && /Entries\s+2/i.test(text) && /Artifacts\s+2/i.test(text), text);
  check("package preview lists editable project and runtime entries", /\.easproj/i.test(text) && /\.easruntime/i.test(text), text);
  check("package preview lists entry checksums", /checksum\s+[0-9a-f]{16}\.\.\./i.test(text), text);
  check("package preview keeps native/offline boundary visible", /offline artifact bundle/i.test(text) && /does not contain proprietary binary project files/i.test(text) && /controller transfer/i.test(text), text);

  const passed = results.filter(Boolean).length;
  console.log(`\nSUMMARY: ${passed}/${results.length} checks passed`);
  process.exitCode = passed === results.length ? 0 : 1;
} catch (error) {
  console.log("ERROR:", error.message);
  process.exitCode = 1;
} finally {
  await context.close();
  await browser.close();
}
