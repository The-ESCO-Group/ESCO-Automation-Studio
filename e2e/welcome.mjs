import { chromium } from "playwright-core";
const URL = "http://localhost:5173/";
const results = [];
const check = (l, c, d = "") => { results.push(!!c); console.log(`${c ? "PASS" : "FAIL"}  ${l}${d ? "  — " + d : ""}`); };

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
try {
  await page.goto(URL, { waitUntil: "networkidle" });
  check("app loads to Welcome dashboard", (await page.locator(".esco-welcome").count()) === 1);
  check("offline notice shown", /Offline simulation only/.test(await page.locator(".esco-welcome__notice").innerText()));
  check("titlebar offline badge", (await page.locator(".esco-badge--offline").count()) === 1);
  check("validation status badge", (await page.locator(".esco-titlebar__validation").count()) === 1);
  check("dashboard has action cards", (await page.locator(".esco-card").count()) >= 6);

  // Open Demo Routine card -> routine editor.
  await page.locator('.esco-card:has-text("Open Demo Routine")').click();
  await page.locator(".esco-lad__rung").first().waitFor({ timeout: 5000 });
  check("Open Demo Routine shows the ladder editor", (await page.locator(".esco-lad__rung").count()) >= 1);
  check("titlebar shows current routine", /MainRoutine/.test(await page.locator(".esco-titlebar__context").innerText()));

  // Dashboard button returns home.
  await page.locator('.esco-titlebar__actions button:has-text("Dashboard")').click();
  check("Dashboard button returns to welcome", (await page.locator(".esco-welcome").count()) === 1);

  const passed = results.filter(Boolean).length;
  console.log(`\nSUMMARY: ${passed}/${results.length} checks passed`);
  process.exitCode = passed === results.length ? 0 : 1;
} catch (err) {
  console.log("ERROR:", err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
