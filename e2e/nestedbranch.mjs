import { chromium } from "playwright-core";
const URL = "http://localhost:5173/";
const results = [];
const check = (l, c, d = "") => { results.push(!!c); console.log(`${c ? "PASS" : "FAIL"}  ${l}${d ? "  — " + d : ""}`); };
const leg = (page, i) => page.locator(".esco-branch-leg").nth(i);
const legCount = (page) => page.locator(".esco-branch-leg").count();
const operandCount = (page) => page.locator(".esco-lad__rung.is-selected .esco-lad__operand").count();

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
try {
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.locator('button:has-text("MainRoutine")').first().click();
  await page.locator('button:has-text("Add Rung")').waitFor({ timeout: 8000 });

  await page.locator('button:has-text("Add Rung")').click();
  await page.locator(".esco-branch-edit").waitFor({ timeout: 8000 });
  check("branch editor shows the main line", (await legCount(page)) === 1);

  // Parallel off the main line -> 2 rows (main + leg).
  await leg(page, 0).locator('button:has-text("Parallel")').click();
  await page.waitForFunction(() => document.querySelectorAll(".esco-branch-leg").length === 2);
  check("parallel branch -> main + 1 leg", (await legCount(page)) === 2);

  // Nested parallel inside the leg -> 3 rows (main + leg + nested leg).
  await leg(page, 1).locator('button:has-text("Parallel")').click();
  await page.waitForFunction(() => document.querySelectorAll(".esco-branch-leg").length === 3);
  check("nested parallel inside the leg -> 3 rows", (await legCount(page)) === 3);

  // Add an instruction into the deeply-nested leg.
  await leg(page, 2).locator('button:has-text("XIC")').click();
  await page.waitForFunction(
    () => document.querySelectorAll(".esco-lad__rung.is-selected .esco-lad__operand").length === 1,
  );
  check("instruction added inside the nested leg", (await operandCount(page)) === 1);

  // Empty nested leg can be removed (add a sibling empty leg, remove it).
  await leg(page, 1).locator('button:has-text("Leg")').click();
  await page.waitForFunction(() => document.querySelectorAll(".esco-branch-leg").length === 4);
  // Remove the last (empty) nested leg.
  await leg(page, 3).locator('button:has-text("Remove")').click();
  await page.waitForFunction(() => document.querySelectorAll(".esco-branch-leg").length === 3);
  check("empty nested leg removed", (await legCount(page)) === 3);

  const passed = results.filter(Boolean).length;
  console.log(`\nSUMMARY: ${passed}/${results.length} checks passed`);
  process.exitCode = passed === results.length ? 0 : 1;
} catch (err) {
  console.log("ERROR:", err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
