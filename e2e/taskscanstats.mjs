// E2E (Lane B, per-task scan statistics): the Task Monitor's per-task table must
// show a "Scans" count and "Last Scan" time that change when the task scans, and
// reset to zero/never on Reset Task Stats. This is backed by the
// recordOfflineScan/resetTaskScanStats action layer, not a toast.
import { chromium } from "playwright-core";
import { URL, importStarterProject } from "./helpers.mjs";

const results = [];
const check = (label, cond, detail = "") => {
  results.push(!!cond);
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${detail ? "  - " + String(detail).replace(/\s+/g, " ").slice(0, 140) : ""}`);
};

// The first scan-eligible task row's "Scans" cell carries data-scan-count.
const scanCell = (page) => page.locator(".esco-task-monitor__table tbody tr .esco-task-monitor__scans").first();
const scanCount = async (page) => Number(await scanCell(page).getAttribute("data-scan-count"));
const lastScanCellText = async (page) =>
  (await page.locator(".esco-task-monitor__table tbody tr td").nth(9).innerText()).trim();

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(10000);
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));

try {
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.locator(".esco-titlebar").waitFor();
  await importStarterProject(page);

  await page.locator('.esco-left :text("Tasks")').first().click({ button: "right" });
  await page.locator(".esco-context-menu--organizer").waitFor();
  await page.locator('.esco-context-menu__item:has-text("Monitor Tasks")').click();
  await page.locator('.esco-dock__tab.is-active:has-text("Task Monitor")').waitFor();
  await scanCell(page).waitFor();

  check("per-task table exposes a Scans column", (await page.locator('.esco-task-monitor__table th:has-text("Scans")').count()) === 1);
  check("per-task table exposes a Last Scan column", (await page.locator('.esco-task-monitor__table th:has-text("Last Scan")').count()) === 1);
  check("per-task scan count starts at zero", (await scanCount(page)) === 0);
  check("per-task last scan starts as never", /never/i.test(await lastScanCellText(page)));

  // Scan Once increments the per-task counter and stamps a last-scan time.
  await page.locator('.esco-task-monitor .esco-btn:has-text("Scan Once")').click();
  await page.waitForFunction(
    () => Number(document.querySelector(".esco-task-monitor__table tbody tr .esco-task-monitor__scans")?.getAttribute("data-scan-count")) === 1,
  );
  check("Scan Once advances the per-task scan count to 1", (await scanCount(page)) === 1);
  check("Scan Once stamps a per-task last-scan time", !/never/i.test(await lastScanCellText(page)), await lastScanCellText(page));

  // A second Scan Once advances it again.
  await page.locator('.esco-task-monitor .esco-btn:has-text("Scan Once")').click();
  await page.waitForFunction(
    () => Number(document.querySelector(".esco-task-monitor__table tbody tr .esco-task-monitor__scans")?.getAttribute("data-scan-count")) === 2,
  );
  check("a second Scan Once advances the per-task scan count to 2", (await scanCount(page)) === 2);

  // Reset Task Stats clears the per-task counters and last-scan time.
  await page.locator('.esco-task-monitor .esco-btn:has-text("Reset Task Stats")').click();
  await page.waitForFunction(
    () => Number(document.querySelector(".esco-task-monitor__table tbody tr .esco-task-monitor__scans")?.getAttribute("data-scan-count")) === 0,
  );
  check("Reset Task Stats clears the per-task scan count", (await scanCount(page)) === 0);
  check("Reset Task Stats clears the per-task last-scan time", /never/i.test(await lastScanCellText(page)));

  const passed = results.filter(Boolean).length;
  console.log(`\nSUMMARY: ${passed}/${results.length} checks passed`);
  process.exitCode = passed === results.length ? 0 : 1;
} catch (error) {
  console.log("ERROR:", error.message);
  await page.screenshot({ path: "e2e/taskscanstats-error.png" }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
