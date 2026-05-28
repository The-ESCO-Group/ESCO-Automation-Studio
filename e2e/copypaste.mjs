import { chromium } from "playwright-core";
const URL = "http://localhost:5173/";
const results = [];
const check = (l, c, d = "") => { results.push(!!c); console.log(`${c ? "PASS" : "FAIL"}  ${l}${d ? "  — " + d : ""}`); };
const rungCount = (page) => page.locator(".esco-lad__rung").count();
const operandCount = (page) => page.locator("input.esco-lad__operand").count();
const pasteBtn = (page) => page.locator('.esco-editor__toolbar button:has-text("Paste Rung")');
const firstRung = (page) => page.locator(".esco-lad__rung").first();

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
try {
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.locator('button:has-text("MainRoutine")').first().click();
  await page.locator('button:has-text("Add Rung")').waitFor({ timeout: 8000 });

  const startRungs = await rungCount(page);
  const perRung = (await operandCount(page)) / startRungs; // operands in the seal-in rung
  check("Paste Rung disabled before copying", await pasteBtn(page).isDisabled());

  // Duplicate the first rung -> one more rung, operands doubled.
  await firstRung(page).locator('button:has-text("Duplicate")').click();
  await page.waitForFunction((n) => document.querySelectorAll(".esco-lad__rung").length === n + 1, startRungs);
  check("Duplicate adds a rung", (await rungCount(page)) === startRungs + 1);
  check("Duplicated rung clones the operands", (await operandCount(page)) === perRung * (startRungs + 1));

  // Copy the first rung, then Paste -> another rung.
  await firstRung(page).locator('button:has-text("Copy")').click();
  await page.waitForFunction(() => {
    const b = [...document.querySelectorAll(".esco-editor__toolbar button")].find((x) => x.textContent.includes("Paste Rung"));
    return b && !b.disabled;
  });
  check("Paste Rung enabled after Copy", !(await pasteBtn(page).isDisabled()));

  const beforePaste = await rungCount(page);
  await pasteBtn(page).click();
  await page.waitForFunction((n) => document.querySelectorAll(".esco-lad__rung").length === n + 1, beforePaste);
  check("Paste adds the copied rung", (await rungCount(page)) === beforePaste + 1);

  // Undo reverts the paste.
  await page.locator('.esco-titlebar__actions button:has-text("Undo")').click();
  await page.waitForFunction((n) => document.querySelectorAll(".esco-lad__rung").length === n, beforePaste);
  check("Undo reverts the paste", (await rungCount(page)) === beforePaste);

  const passed = results.filter(Boolean).length;
  console.log(`\nSUMMARY: ${passed}/${results.length} checks passed`);
  process.exitCode = passed === results.length ? 0 : 1;
} catch (err) {
  console.log("ERROR:", err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
