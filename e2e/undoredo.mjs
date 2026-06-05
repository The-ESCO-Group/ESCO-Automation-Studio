import { chromium } from "playwright-core";
import { URL, createBlankProject } from "./helpers.mjs";
const results = [];
const check = (l, c, d = "") => { results.push(!!c); console.log(`${c ? "PASS" : "FAIL"}  ${l}${d ? "  — " + d : ""}`); };
const undoBtn = (page) => page.locator('.esco-ribbon__button[aria-label="Undo"]').first();
const redoBtn = (page) => page.locator('.esco-ribbon__button[aria-label="Redo"]').first();
const rungCount = (page) => page.locator(".esco-lad__rung").count();
const menuCommand = async (page, menu, command) => {
  await page.locator(`.esco-ribbon__tab:has-text("${menu}")`).click();
  await page.locator(`.esco-ribbon-menu__item:has-text("${command}")`).click();
};

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
try {
  await page.goto(URL, { waitUntil: "networkidle" });
  await createBlankProject(page);

  check("Undo disabled before any edit", await undoBtn(page).isDisabled());
  const start = await rungCount(page);

  // Edit through the Studio-style Logic menu: add a rung.
  await menuCommand(page, "Logic", "Add Rung");
  await page.waitForFunction((n) => document.querySelectorAll(".esco-lad__rung").length === n + 1, start);
  check("Add Rung adds a rung", (await rungCount(page)) === start + 1);
  check("Undo enabled after an edit", !(await undoBtn(page).isDisabled()));

  // Undo via button -> back to start.
  await undoBtn(page).click();
  await page.waitForFunction((n) => document.querySelectorAll(".esco-lad__rung").length === n, start);
  check("Undo reverts the added rung", (await rungCount(page)) === start);

  // Redo via button -> rung returns.
  await redoBtn(page).click();
  await page.waitForFunction((n) => document.querySelectorAll(".esco-lad__rung").length === n + 1, start);
  check("Redo re-applies the added rung", (await rungCount(page)) === start + 1);

  // Undo via keyboard (Ctrl+Z) -> back to start.
  await page.locator(".esco-editor__surface").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("Control+z");
  await page.waitForFunction((n) => document.querySelectorAll(".esco-lad__rung").length === n, start);
  check("Ctrl+Z undoes the edit", (await rungCount(page)) === start);

  const passed = results.filter(Boolean).length;
  console.log(`\nSUMMARY: ${passed}/${results.length} checks passed`);
  process.exitCode = passed === results.length ? 0 : 1;
} catch (err) {
  console.log("ERROR:", err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
