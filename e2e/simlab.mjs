// E2E: ESCO Simulation Lab full workflow —
// open lab -> create simulation project -> add device -> add logic ->
// add + run scenario -> step the simulation/timeline -> generate report.
import { chromium } from "playwright-core";
import { URL } from "./helpers.mjs";

const results = [];
const check = (label, condition, detail = "") => {
  results.push(!!condition);
  console.log(`${condition ? "PASS" : "FAIL"}  ${label}${detail ? "  — " + String(detail).replace(/\s+/g, " ").slice(0, 160) : ""}`);
};

const lab = (page) => page.locator(".esco-simlab");
const labBtn = (page, text) => page.locator(`.esco-simlab button:has-text("${text}")`).first();
const labTab = (page, text) => page.locator(`.esco-simlab__tab:has-text("${text}")`).first();

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 980 } });
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));

try {
  await page.goto(URL, { waitUntil: "networkidle" });

  // 1. Confirm both workbench entry points exist, then open from the direct toolbar command.
  await page.locator('.esco-ribbon__tab:has-text("View")').click();
  check(
    "Simulation Lab is exposed from the View menu",
    (await page.locator('.esco-ribbon-menu__item:has-text("ESCO Simulation Lab")').count()) === 1,
  );
  await page.keyboard.press("Escape");
  await page.locator('.esco-ribbon__utility-btn[aria-label="Simulation lab"]').click();
  await lab(page).waitFor({ timeout: 8000 });
  check("Simulation Lab opens from the standard toolbar", (await lab(page).count()) > 0);

  const boundary = await lab(page).innerText();
  check("Offline-only boundary is shown", /offline/i.test(boundary), boundary.slice(0, 80));

  // 2. Create a simulation project.
  await labBtn(page, "Create Project").click();
  await labTab(page, "Devices").waitFor({ timeout: 8000 });
  check("Create project moves to the Devices stage", (await page.locator(".esco-simlab__tab.is-active:has-text('Devices')").count()) > 0);

  // 3. Virtual tags are generated and visible.
  const tagRows = await page.locator(".esco-simlab__panel:has-text('Virtual Tags') tbody tr").count();
  check("Virtual tags are generated and visible", tagRows > 0, `${tagRows} tag rows`);

  // 4. Add a device (mutates real project state).
  const devicesBefore = await page.locator(".esco-simlab__list .esco-simlab__row").count();
  await labBtn(page, "Add Device").click();
  const devicesAfter = await page.locator(".esco-simlab__list .esco-simlab__row").count();
  check("Adding a device updates the device map", devicesAfter >= devicesBefore + 1, `${devicesBefore} -> ${devicesAfter}`);

  // 5. Add logic that runs against virtual tags.
  await labTab(page, "Logic").click();
  await labBtn(page, "Add Logic").click();
  const logicRows = await page.locator(".esco-simlab__panel:has-text('Generated Logic') .esco-simlab__row").count();
  check("Logic templates can be added", logicRows > 0, `${logicRows} logic block(s)`);

  // 6. Add and run a FAT/SAT scenario.
  await labTab(page, "Run").click();
  await labBtn(page, "Add Scenario").click();
  await labBtn(page, "Run All").click();
  await page.waitForTimeout(300);
  const runText = await lab(page).innerText();
  check("Scenario runner produces a pass/fail verdict", /\b(PASS|FAIL)\b/.test(runText), runText.match(/\b(PASS|FAIL)\b[^\n]*/)?.[0] ?? "");

  // 7. Build + step the interactive simulation, view live activity (timeline).
  await labBtn(page, "Build").click();
  await labBtn(page, "Step").click();
  await labBtn(page, "Run 10").click();
  await page.waitForTimeout(200);
  const liveRows = await page.locator(".esco-simlab__panel:has-text('Live Controller') tbody tr").count();
  check("Live simulation tags/timeline populate after stepping", liveRows > 0, `${liveRows} live tag rows`);

  // 8. Generate the ESCO-native test report.
  await labTab(page, "Reports").click();
  await labBtn(page, "Generate Report").click();
  await page.waitForTimeout(200);
  const reportText = await page.locator(".esco-simlab__report").first().innerText();
  check("Report generation works", /Status:\s*(PASS|FAIL|ERROR)/i.test(reportText), reportText.slice(0, 120));

  // 9. Real PLC operations remain blocked and documented.
  await labTab(page, "Boundaries").click();
  const blockedText = await lab(page).innerText();
  check("Real-controller operations remain blocked/documented", /Blocked/i.test(blockedText) && /Go Online|Download/i.test(blockedText));

  const passed = results.filter(Boolean).length;
  console.log(`\nSUMMARY: ${passed}/${results.length} checks passed`);
  process.exitCode = passed === results.length ? 0 : 1;
} catch (error) {
  console.log("ERROR:", error.message);
  await page.screenshot({ path: new globalThis.URL("./simlab-error.png", import.meta.url).pathname }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
