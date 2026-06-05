import { chromium } from "playwright-core";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";
import { URL, addRungViaProjectMenu, importStarterProject, ribbonButton } from "./helpers.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const exportPath = join(here, "compare-original.plcproj.json");
const csvPath = join(here, "compare-report.csv");

const results = [];
const check = (l, c, d = "") => { results.push(!!c); console.log(`${c ? "PASS" : "FAIL"}  ${l}${d ? "  — " + d : ""}`); };

const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext({ viewport: { width: 1400, height: 950 }, acceptDownloads: true });
const page = await context.newPage();
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
try {
  await page.goto(URL, { waitUntil: "networkidle" });
  await importStarterProject(page);

  // Export the current (original) project to use as the comparison file.
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    ribbonButton(page, "Save").click(),
  ]);
  await download.saveAs(exportPath);
  check("exported the current project for comparison", true);

  // Edit the live project so it differs from the exported copy: add a rung.
  await page.locator('.esco-tree__node--routine:has-text("MainRoutine")').first().click();
  await addRungViaProjectMenu(page);
  await page.waitForFunction(() => document.querySelectorAll(".esco-lad__rung").length === 2);

  // Open the Compare view — empty until a file is chosen.
  await page.locator('.esco-ribbon__tab:has-text("View")').click();
  await page.locator('.esco-ribbon-menu__item:has-text("Compare")').click();
  await page.locator(".esco-cmp").waitFor({ timeout: 8000 });
  check("compare view shows an empty state before a file is chosen", (await page.locator(".esco-cmp__empty").count()) === 1);

  // Load the exported original as the comparison file.
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.locator('.esco-cmp button:has-text("Choose comparison file")').click(),
  ]);
  await chooser.setFiles(exportPath);
  await page.locator(".esco-cmp__bar").waitFor({ timeout: 8000 });
  check("comparison summary bar appears", true);

  // MainRoutine now differs (extra rung) -> exactly one changed routine.
  const changedChip = await page.locator(".esco-cmp__chip--changed").innerText();
  check("reports 1 changed routine", /\b1\b/.test(changedChip), changedChip.trim());
  const matchChip = await page.locator(".esco-cmp__chip--match").innerText();
  check("reports 0 identical routines", /\b0\b/.test(matchChip), matchChip.trim());

  // Expand the changed row -> side-by-side normalized rung text.
  await page.locator(".esco-cmp__item--changed .esco-cmp__row").first().click();
  await page.locator(".esco-cmp__sidebyside").waitFor({ timeout: 5000 });
  check("changed row expands to a side-by-side diff", true);

  // Export the compare report as CSV.
  const [csvDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.locator('.esco-cmp__actions button:has-text("Export CSV")').click(),
  ]);
  await csvDownload.saveAs(csvPath);
  const csv = readFileSync(csvPath, "utf-8");
  check(
    "CSV report downloads with the expected header",
    /^Status,Left routine,Right routine,Match type,Difference summary/.test(csv),
    csvDownload.suggestedFilename(),
  );

  await page.locator('.esco-cmp__detail-actions button:has-text("Open current routine")').first().click();
  await page.locator(".esco-editor__tab.is-active").waitFor({ timeout: 5000 });
  check(
    "compare changed hit opens the current routine",
    /MainRoutine/.test(await page.locator(".esco-editor__tab.is-active").innerText()),
  );

  const passed = results.filter(Boolean).length;
  console.log(`\nSUMMARY: ${passed}/${results.length} checks passed`);
  process.exitCode = passed === results.length ? 0 : 1;
} catch (err) {
  console.log("ERROR:", err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
