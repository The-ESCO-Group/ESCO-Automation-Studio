// E2E: ESCO Simulation Lab — onsite-grade screens full workflow.
// Open lab -> create Pump Station -> onsite screens -> start motor from the
// Process Overview -> confirm I/O LEDs + tags update -> inject overload ->
// confirm device detail / alarm console / trend / timeline update -> run FAT
// scenario -> generate report -> confirm offline boundary.
import { chromium } from "playwright-core";
import { URL } from "./helpers.mjs";

const results = [];
const check = (label, condition, detail = "") => {
  results.push(!!condition);
  console.log(`${condition ? "PASS" : "FAIL"}  ${label}${detail ? "  — " + String(detail).replace(/\s+/g, " ").slice(0, 150) : ""}`);
};

const tid = (page, id) => page.locator(`[data-testid="${id}"]`);
const nav = async (page, screen) => { await tid(page, `onsite-nav-${screen}`).click(); await tid(page, `screen-${screen}`).waitFor({ timeout: 8000 }); };

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 980 } });
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));

try {
  await page.goto(URL, { waitUntil: "networkidle" });

  // 1. Open the Simulation Lab from the View menu.
  await page.locator('.esco-ribbon__tab:has-text("View")').click();
  await page.locator('.esco-ribbon-menu__item:has-text("ESCO Simulation Lab")').click();
  await page.locator(".esco-simlab").waitFor({ timeout: 8000 });
  check("Simulation Lab opens", (await page.locator(".esco-simlab").count()) > 0);

  // 2. Create a Pump Station simulation.
  await page.locator(".esco-simlab__panel select").first().selectOption("pump-station");
  await page.locator('.esco-simlab button:has-text("Create Project")').click();
  await page.waitForTimeout(200);

  // 3. Open the onsite screens.
  await page.locator('.esco-simlab__tab:has-text("Onsite")').click();
  await tid(page, "simlab-onsite").waitFor({ timeout: 8000 });
  await tid(page, "screen-overview").waitFor({ timeout: 8000 });
  check("Onsite Process Overview renders animated equipment", (await page.locator(".sim2-equip").count()) > 0, `${await page.locator(".sim2-equip").count()} equipment`);

  // 4. Start a motor from the Process Overview.
  await tid(page, "overview-start-M101").click();
  await page.waitForTimeout(150);
  const motorState = await tid(page, "overview-equip-M101").getAttribute("data-state");
  check("Motor starts from Process Overview (virtual state mutated)", motorState === "running", `state=${motorState}`);

  // 5. Confirm I/O LEDs + tags update in the cabinet.
  await nav(page, "cabinet");
  const ledsOn = await page.locator(".sim2-chan-led.is-on").count();
  check("I/O cabinet LEDs reflect virtual tags", ledsOn > 0, `${ledsOn} channel LEDs on`);
  // Click the Digital Output module to open its channel detail (RunCmd lives here).
  await page.locator('[data-testid^="cabinet-module-DO-"]').first().click();
  const cabText = await tid(page, "cabinet-channels").innerText();
  check("Clicking a module opens channel details with tags", /M101_RunCmd/.test(cabText));

  // 6. Inject an overload fault from the overview.
  await nav(page, "overview");
  await tid(page, "overview-fault-M101-overload").click();
  await page.waitForTimeout(150);

  // 7. Device detail reflects the fault.
  await nav(page, "device");
  await tid(page, "device-select").selectOption({ label: /M101/ }).catch(async () => {
    // fall back: choose by value of first option containing M101
    const opt = await page.locator('[data-testid="device-select"] option').filter({ hasText: "M101" }).first().getAttribute("value");
    if (opt) await tid(page, "device-select").selectOption(opt);
  });
  const devText = await tid(page, "screen-device").innerText();
  check("Device detail shows the injected fault", /overload/i.test(devText));

  // 8a. Alarm console reflects the alarm.
  await nav(page, "alarms");
  const alarmText = await tid(page, "screen-alarms").innerText();
  check("Alarm console shows the overload alarm", /Overload/.test(alarmText) && /active/i.test(alarmText));

  // 8b. Trend/historian captured data + markers.
  await nav(page, "trends");
  const legendRows = await page.locator('[data-testid="trend-legend"] tbody tr').count();
  check("Trend/historian captured simulated trends", legendRows > 0, `${legendRows} pens`);

  // 8c. Logic debug reflects scan-cycle results.
  await nav(page, "logic");
  check("Logic debug shows live rung status", (await page.locator('[data-testid^="logic-rung-"]').count()) > 0);

  // 9. Run a FAT scenario.
  await nav(page, "fat");
  await tid(page, "fat-add-trip-overload").click();
  await page.waitForTimeout(100);
  await tid(page, "fat-run-all").click();
  await page.waitForTimeout(400);
  const fatText = await tid(page, "screen-fat").innerText();
  check("FAT scenario produces a pass/fail verdict", /\b(PASS|FAIL)\b/.test(fatText), fatText.match(/\b(PASS|FAIL)\b/)?.[0] ?? "");

  // 10. Generate the report.
  await nav(page, "report");
  await tid(page, "report-generate").click();
  await page.waitForTimeout(200);
  await tid(page, "report-doc").waitFor({ timeout: 8000 });
  const repText = await tid(page, "report-doc").innerText();
  check("Report generates with coverage", /I\/O channels tested/i.test(repText) && /Devices tested/i.test(repText));

  // 11. Offline-only boundary is visible.
  check("Offline-only boundary is visible on the report", /offline/i.test(await tid(page, "report-boundary").innerText()));

  const passed = results.filter(Boolean).length;
  console.log(`\nSUMMARY: ${passed}/${results.length} checks passed`);
  process.exitCode = passed === results.length ? 0 : 1;
} catch (error) {
  console.log("ERROR:", error.message);
  await page.screenshot({ path: new globalThis.URL("./simlab-onsite-error.png", import.meta.url).pathname }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
