import { chromium } from "playwright-core";
const URL = "http://localhost:5173/";
const results = [];
const check = (l, c, d = "") => { results.push(!!c); console.log(`${c ? "PASS" : "FAIL"}  ${l}${d ? "  — " + d : ""}`); };
const rungCount = (page) => page.locator(".esco-lad__rung").count();
const banner = (page) => page.locator(".esco-recovery");

const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext({ viewport: { width: 1400, height: 950 } });
const page = await context.newPage();
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
page.on("dialog", (d) => d.accept().catch(() => {})); // accept any beforeunload prompt

try {
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });
  check("no recovery banner on a clean start", (await banner(page).count()) === 0);

  // Make an edit so the project is dirty, then let autosave fire (debounced ~1s).
  await page.locator('button:has-text("MainRoutine")').first().click();
  await page.locator('button:has-text("Add Rung")').waitFor({ timeout: 8000 });
  const start = await rungCount(page);
  await page.locator('button:has-text("Add Rung")').click();
  await page.waitForFunction((n) => document.querySelectorAll(".esco-lad__rung").length === n + 1, start);
  await page.waitForTimeout(1300); // allow the debounced autosave to persist

  // Reload — app resets to the default project, but the autosave is recoverable.
  await page.reload({ waitUntil: "networkidle" });
  await banner(page).waitFor({ timeout: 8000 });
  check("recovery banner appears after reload with unsaved work", (await banner(page).count()) === 1);

  // Restore brings the edited project back (extra rung) and marks it Unsaved.
  await page.locator('.esco-recovery button:has-text("Restore")').click();
  await page.waitForFunction((n) => document.querySelectorAll(".esco-lad__rung").length === n, start + 1);
  check("restore brings back the edited project", (await rungCount(page)) === start + 1);
  check("restored work is marked Unsaved", (await page.locator(".esco-titlebar__saved.is-dirty").count()) === 1);
  check("recovery banner is dismissed after restore", (await banner(page).count()) === 0);

  // Dismiss path: edit again, reload, dismiss -> banner gone, default project.
  await page.locator('button:has-text("Add Rung")').click();
  await page.waitForTimeout(1300);
  await page.reload({ waitUntil: "networkidle" });
  await banner(page).waitFor({ timeout: 8000 });
  await page.locator('.esco-recovery button:has-text("Dismiss")').click();
  check("dismiss removes the recovery banner", (await banner(page).count()) === 0);

  const passed = results.filter(Boolean).length;
  console.log(`\nSUMMARY: ${passed}/${results.length} checks passed`);
  process.exitCode = passed === results.length ? 0 : 1;
} catch (err) {
  console.log("ERROR:", err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
