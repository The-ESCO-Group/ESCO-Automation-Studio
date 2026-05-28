import { chromium } from "playwright-core";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const URL = "http://localhost:5173/";
const exportPath = join(here, "dirtystate-export.plcproj.json");

const results = [];
const check = (l, c, d = "") => { results.push(!!c); console.log(`${c ? "PASS" : "FAIL"}  ${l}${d ? "  — " + d : ""}`); };
const isDirty = (page) => page.locator(".esco-titlebar__saved.is-dirty").count().then((n) => n === 1);
const isSaved = (page) => page.locator(".esco-titlebar__saved.is-saved").count().then((n) => n === 1);

const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext({ viewport: { width: 1400, height: 950 }, acceptDownloads: true });
const page = await context.newPage();
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
try {
  await page.goto(URL, { waitUntil: "networkidle" });
  check("fresh project shows Saved", await isSaved(page));

  await page.locator('button:has-text("MainRoutine")').first().click();
  await page.locator('button:has-text("Add Rung")').waitFor({ timeout: 8000 });

  // An edit marks the project dirty.
  await page.locator('button:has-text("Add Rung")').click();
  await page.waitForFunction(() => document.querySelector(".esco-titlebar__saved.is-dirty") !== null);
  check("an edit marks the project Unsaved", await isDirty(page));

  // Undo back to the saved baseline marks it clean again.
  await page.locator('.esco-titlebar__actions button:has-text("Undo")').click();
  await page.waitForFunction(() => document.querySelector(".esco-titlebar__saved.is-saved") !== null);
  check("undo back to baseline marks it Saved", await isSaved(page));

  // Redo -> dirty; export -> saved.
  await page.locator('.esco-titlebar__actions button:has-text("Redo")').click();
  await page.waitForFunction(() => document.querySelector(".esco-titlebar__saved.is-dirty") !== null);
  check("redo marks it Unsaved again", await isDirty(page));

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.locator('.esco-titlebar__actions button:has-text("Export Project")').click(),
  ]);
  await download.saveAs(exportPath);
  await page.waitForFunction(() => document.querySelector(".esco-titlebar__saved.is-saved") !== null);
  check("exporting marks the project Saved", await isSaved(page));

  const passed = results.filter(Boolean).length;
  console.log(`\nSUMMARY: ${passed}/${results.length} checks passed`);
  process.exitCode = passed === results.length ? 0 : 1;
} catch (err) {
  console.log("ERROR:", err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
