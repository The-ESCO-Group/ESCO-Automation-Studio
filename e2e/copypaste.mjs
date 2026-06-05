import { chromium } from "playwright-core";
import { URL, importStarterProject } from "./helpers.mjs";

const results = [];
const check = (label, cond, detail = "") => {
  results.push(!!cond);
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${detail ? "  - " + String(detail).replace(/\s+/g, " ").slice(0, 100) : ""}`);
};
const RUNG_SELECTOR = ".esco-lad__rung:not(.esco-lad__rung--empty)";
const rungCount = (page) => page.locator(RUNG_SELECTOR).count();
const operandCount = (page) => page.locator("input.esco-lad__operand").count();
const ribbonButton = (page, label) => page.locator(`.esco-ribbon__button[aria-label="${label}"]`).first();
const localButton = (page, label) => page.locator(`.esco-editor__local-toolbar button[aria-label="${label}"]`).first();
const firstRung = (page) => page.locator(RUNG_SELECTOR).first();

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
page.on("pageerror", (error) => console.log("PAGEERROR:", error.message));

try {
  await page.goto(URL, { waitUntil: "networkidle" });
  await importStarterProject(page);

  const startRungs = await rungCount(page);
  const perRung = (await operandCount(page)) / startRungs;
  check("Paste disabled before copying", await ribbonButton(page, "Paste").isDisabled());

  await firstRung(page).click();
  check("Copy enabled after selecting a rung", !(await ribbonButton(page, "Copy").isDisabled()));
  await ribbonButton(page, "Copy").click();
  check("Paste enabled after Copy", !(await ribbonButton(page, "Paste").isDisabled()));

  await ribbonButton(page, "Paste").click();
  await page.waitForFunction((count) => document.querySelectorAll(".esco-lad__rung:not(.esco-lad__rung--empty)").length === count + 1, startRungs);
  check("Paste adds the copied rung", (await rungCount(page)) === startRungs + 1);
  check("Pasted rung clones operands", (await operandCount(page)) === perRung * (startRungs + 1));

  await ribbonButton(page, "Undo").click();
  await page.waitForFunction((count) => document.querySelectorAll(".esco-lad__rung:not(.esco-lad__rung--empty)").length === count, startRungs);
  check("Undo reverts the paste", (await rungCount(page)) === startRungs);

  await firstRung(page).click();
  await ribbonButton(page, "Cut").click();
  await page.waitForFunction((count) => document.querySelectorAll(".esco-lad__rung:not(.esco-lad__rung--empty)").length === count - 1, startRungs);
  check("Cut removes the selected rung", (await rungCount(page)) === startRungs - 1);
  check("Copy disables after cutting the last rung", await ribbonButton(page, "Copy").isDisabled());
  check("Paste stays enabled after Cut", !(await ribbonButton(page, "Paste").isDisabled()));

  await ribbonButton(page, "Paste").click();
  await page.waitForFunction((count) => document.querySelectorAll(".esco-lad__rung:not(.esco-lad__rung--empty)").length === count, startRungs);
  check("Paste restores the cut rung from the clipboard", (await rungCount(page)) === startRungs);
  check("Restored rung keeps operands", (await operandCount(page)) === perRung * startRungs);

  await firstRung(page).click({ button: "right" });
  await page.locator('.esco-context-menu__item:has-text("Edit Rung Comment")').waitFor({ timeout: 8000 });
  await page.locator('.esco-context-menu__item:has-text("Edit Rung Comment")').click();
  await page.locator('.esco-routine-command textarea[aria-label="Rung comment"]').fill("Pump start latch");
  await page.locator('.esco-routine-command button:has-text("Apply")').click();
  await page.locator('.esco-lad__rung-comment:has-text("Pump start latch")').waitFor({ timeout: 8000 });
  check("Rung comment command writes the comment through the in-app command bar", (await page.locator('.esco-lad__rung-comment:has-text("Pump start latch")').count()) === 1);

  await localButton(page, "Find in routine").click();
  await page.locator('.esco-routine-command input[aria-label="Find text"]').fill("MotorRun");
  await page.locator('.esco-routine-command button:has-text("Find Next")').click();
  await page.locator(".esco-routine-command").waitFor({ state: "detached", timeout: 5000 });
  check("Routine toolbar Find selects a matching rung without a browser prompt", (await page.locator(`${RUNG_SELECTOR}.is-selected`).count()) === 1);

  await localButton(page, "Go to rung").click();
  await page.locator('.esco-routine-command input[aria-label="Rung number"]').fill("9999");
  await page.locator('.esco-routine-command button:has-text("Go")').click();
  check("Routine toolbar Go to rung reports misses inline", /Rung 9999 was not found/.test(await page.locator(".esco-routine-command").innerText()));
  await page.locator('.esco-routine-command input[aria-label="Rung number"]').fill("0");
  await page.locator('.esco-routine-command button:has-text("Go")').click();
  await page.locator(".esco-routine-command").waitFor({ state: "detached", timeout: 5000 });
  check("Routine toolbar Go to rung selects a rung without a browser prompt", (await page.locator(`${RUNG_SELECTOR}.is-selected`).count()) === 1);

  const beforeAdd = await rungCount(page);
  await localButton(page, "Add rung").click();
  await page.waitForFunction((count) => document.querySelectorAll(".esco-lad__rung:not(.esco-lad__rung--empty)").length === count + 1, beforeAdd);
  check("Routine toolbar Add rung creates a rung", (await rungCount(page)) === beforeAdd + 1);
  await localButton(page, "Delete rung").click();
  await page.waitForFunction((count) => document.querySelectorAll(".esco-lad__rung:not(.esco-lad__rung--empty)").length === count, beforeAdd);
  check("Routine toolbar Delete rung removes the selected rung", (await rungCount(page)) === beforeAdd);

  const beforeDup = await rungCount(page);
  await firstRung(page).click();
  await localButton(page, "Duplicate rung").click();
  await page.waitForFunction((count) => document.querySelectorAll(".esco-lad__rung:not(.esco-lad__rung--empty)").length === count + 1, beforeDup);
  check("Routine toolbar Duplicate rung clones the selected rung", (await rungCount(page)) === beforeDup + 1);
  check("Duplicated rung clones operands", (await operandCount(page)) === perRung * (beforeDup + 1));

  // Routine toolbar Cut + Paste roundtrip (mirrors the ribbon but local to the editor).
  const beforeCut = await rungCount(page);
  await firstRung(page).click();
  check("Routine toolbar Paste rung enabled (clipboard primed earlier)", !(await localButton(page, "Paste rung").isDisabled()));
  await localButton(page, "Cut rung").click();
  await page.waitForFunction((count) => document.querySelectorAll(".esco-lad__rung:not(.esco-lad__rung--empty)").length === count - 1, beforeCut);
  check("Routine toolbar Cut rung removes the selected rung", (await rungCount(page)) === beforeCut - 1);
  await localButton(page, "Paste rung").click();
  await page.waitForFunction((count) => document.querySelectorAll(".esco-lad__rung:not(.esco-lad__rung--empty)").length === count, beforeCut);
  check("Routine toolbar Paste rung restores the cut rung", (await rungCount(page)) === beforeCut);

  // Context-menu Paste Rung pastes the current clipboard rung below the target.
  const beforeCtxPaste = await rungCount(page);
  await firstRung(page).click();
  await localButton(page, "Copy rung").click();
  await firstRung(page).click({ button: "right" });
  // Exact match: the menu now also offers "Paste Rung Above"/"Paste Rung Below".
  await page.locator('.esco-context-menu__item:text-is("Paste Rung")').waitFor({ timeout: 8000 });
  await page.locator('.esco-context-menu__item:text-is("Paste Rung")').click();
  await page.waitForFunction((count) => document.querySelectorAll(".esco-lad__rung:not(.esco-lad__rung--empty)").length === count + 1, beforeCtxPaste);
  check("Context menu Paste Rung adds the copied rung", (await rungCount(page)) === beforeCtxPaste + 1);

  // Keyboard rung clipboard shortcuts (Ctrl+C / Ctrl+V / Ctrl+X), Studio 5000 parity.
  const beforeKbd = await rungCount(page);
  await firstRung(page).click();
  await page.keyboard.press("Control+c");
  await page.keyboard.press("Control+v");
  await page.waitForFunction((count) => document.querySelectorAll(".esco-lad__rung:not(.esco-lad__rung--empty)").length === count + 1, beforeKbd);
  check("Ctrl+C then Ctrl+V pastes a rung", (await rungCount(page)) === beforeKbd + 1);
  await firstRung(page).click();
  await page.keyboard.press("Control+x");
  await page.waitForFunction((count) => document.querySelectorAll(".esco-lad__rung:not(.esco-lad__rung--empty)").length === count, beforeKbd);
  check("Ctrl+X cuts the selected rung", (await rungCount(page)) === beforeKbd);

  const passed = results.filter(Boolean).length;
  console.log(`\nSUMMARY: ${passed}/${results.length} checks passed`);
  process.exitCode = passed === results.length ? 0 : 1;
} catch (error) {
  console.log("ERROR:", error.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
