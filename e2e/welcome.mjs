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
  check("titlebar shows no project open", /No project open/.test(await page.locator(".esco-titlebar__context").innerText()));
  check("titlebar offline badge", (await page.locator(".esco-badge--offline").count()) === 1);
  check("empty explorer shows no controllers", /No controllers added/.test(await page.locator(".esco-left").innerText()));
  check("welcome canvas shows no routine open", /No routine open/.test(await page.locator(".esco-welcome").innerText()));

  // Create New Routine -> blank routine editor.
  await page.locator('button:has-text("Create New Routine")').click();
  await page.locator('button:has-text("Add Rung")').waitFor({ timeout: 5000 });
  check("Create New Routine opens a blank ladder editor", (await page.locator(".esco-lad__rung").count()) === 0);
  check("created project has no tags", (await page.locator(".esco-tree__node--tag").count()) === 0);
  check("titlebar shows current routine", /MainRoutine/.test(await page.locator(".esco-titlebar__context").innerText()));

  const passed = results.filter(Boolean).length;
  console.log(`\nSUMMARY: ${passed}/${results.length} checks passed`);
  process.exitCode = passed === results.length ? 0 : 1;
} catch (err) {
  console.log("ERROR:", err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
