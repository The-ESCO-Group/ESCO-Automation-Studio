import { chromium } from "playwright-core";
import { URL, importStarterProject } from "./helpers.mjs";

const results = [];
const check = (label, cond, detail = "") => {
  results.push(!!cond);
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${detail ? "  - " + String(detail).replace(/\s+/g, " ").slice(0, 160) : ""}`);
};

const text = async (page, selector) =>
  (await page.locator(selector).first().innerText({ timeout: 8000 })).replace(/\s+/g, " ").trim();

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
page.setDefaultTimeout(10000);

try {
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.locator(".esco-titlebar").waitFor();
  await importStarterProject(page);

  await page.locator('.esco-left :text("Tasks")').first().click({ button: "right" });
  await page.locator(".esco-context-menu--organizer").waitFor();
  await page.locator('.esco-context-menu__item:has-text("Monitor Tasks")').click();
  await page.locator('.esco-dock__tab.is-active:has-text("Task Monitor")').waitFor();

  const monitorText = await text(page, ".esco-task-monitor");
  check(
    "Monitor Tasks opens a real Task Monitor dock",
    /Task Monitor:/.test(monitorText) &&
      /Scan Once/.test(monitorText) &&
      /Run Offline Scan/.test(monitorText) &&
      /Verify Tasks/.test(monitorText) &&
      /Reset Task Stats/.test(monitorText),
    monitorText,
  );
  check(
    "Task Monitor shows scan counters and watchdog state",
    /Last scan: never/.test(monitorText) &&
      /Scans: 0/.test(monitorText) &&
      /Runtime: Stopped/.test(monitorText) &&
      /Watchdogs:/.test(monitorText) &&
      /Eligible:/.test(monitorText),
    monitorText,
  );
  check(
    "Task Monitor projects scheduled task backend status",
    /E2E_Starter/.test(monitorText) &&
      /MainTask/.test(monitorText) &&
      /MainProgram/.test(monitorText) &&
      /MainRoutine/.test(monitorText) &&
      /scan-eligible/.test(monitorText),
    monitorText,
  );

  await page.locator('.esco-task-monitor .esco-btn:has-text("Open Routine")').first().click();
  await page.locator('.esco-editor__tab.is-active:has-text("MainRoutine")').waitFor();
  check("Task Monitor Open Routine jumps to the scheduled routine", /MainRoutine/.test(await text(page, ".esco-editor__tabs")));

  await page.locator('.esco-dock__tab:has-text("Task Monitor")').click();
  await page.locator('.esco-task-monitor .esco-btn:has-text("Scan Once")').click();
  await page.locator('.esco-task-monitor:has-text("Scans: 1")').waitFor({ timeout: 5000 });
  const afterScanText = await text(page, ".esco-task-monitor");
  check(
    "Task Monitor Scan Once updates counters and keeps offline values available",
    /Scans: 1/.test(afterScanText) &&
      !/Last scan: never/.test(afterScanText) &&
      /StartPB/.test(afterScanText) &&
      /Task Monitor/.test(await text(page, ".esco-dock")),
    afterScanText,
  );

  await page.locator('.esco-task-monitor .esco-btn:has-text("Run Offline Scan")').click();
  await page.locator('.esco-task-monitor .esco-btn:has-text("Stop Offline Scan")').waitFor({ timeout: 5000 });
  await page.waitForFunction(() => {
    const text = document.querySelector(".esco-task-monitor")?.textContent ?? "";
    const match = text.match(/Scans:\s*(\d+)/);
    return match && Number(match[1]) >= 2;
  });
  const runningText = await text(page, ".esco-task-monitor");
  check(
    "Task Monitor Run Offline Scan visibly advances scan counters",
    /Runtime: Running every 250 ms/.test(runningText) && /Scans:\s*[2-9]\d*/.test(runningText),
    runningText,
  );
  await page.locator('.esco-task-monitor .esco-btn:has-text("Stop Offline Scan")').click();
  await page.locator('.esco-task-monitor .esco-btn:has-text("Run Offline Scan")').waitFor({ timeout: 5000 });
  check("Task Monitor Stop Offline Scan returns to stopped state", /Runtime: Stopped/.test(await text(page, ".esco-task-monitor")));

  await page.locator('.esco-task-monitor .esco-btn:has-text("Verify Tasks")').click();
  await page.locator(".esco-task-monitor__verify").waitFor({ timeout: 5000 });
  const verifyText = await text(page, ".esco-task-monitor__verify");
  check(
    "Task Monitor Verify Tasks shows per-task actionable rows in place",
    /Task Verification/.test(verifyText) &&
      /MainTask/.test(verifyText) &&
      /MainProgram/.test(verifyText) &&
      /MainRoutine/.test(verifyText) &&
      /Open Routine/.test(verifyText) &&
      (await page.locator('.esco-dock__tab.is-active:has-text("Task Monitor")').count()) === 1,
    verifyText,
  );

  await page.locator('.esco-task-monitor .esco-btn:has-text("Reset Task Stats")').click();
  await page.locator('.esco-task-monitor:has-text("Scans: 0")').waitFor({ timeout: 5000 });
  const resetText = await text(page, ".esco-task-monitor");
  check(
    "Task Monitor Reset Task Stats clears counters and values state",
    /Scans: 0/.test(resetText) && /Last scan: never/.test(resetText) && /Last reset:/.test(resetText),
    resetText,
  );

  const passed = results.filter(Boolean).length;
  console.log(`\nSUMMARY: ${passed}/${results.length} checks passed`);
  process.exitCode = passed === results.length ? 0 : 1;
} catch (error) {
  console.log("ERROR:", error.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
