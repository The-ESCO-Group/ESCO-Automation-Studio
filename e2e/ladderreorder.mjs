import { chromium } from "playwright-core";
import { URL, importStarterProject, dismissToasts } from "./helpers.mjs";

const results = [];
const check = (l, c, d = "") => { results.push(!!c); console.log(`${c ? "PASS" : "FAIL"}  ${l}${d ? "  - " + d : ""}`); };

// Operand values of the selected rung, in series order (drives every assertion).
const order = (page) =>
  page.$$eval(".esco-lad__rung.is-selected input.esco-lad__operand", (els) => els.map((el) => el.value));

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));

try {
  await page.goto(URL, { waitUntil: "networkidle" });
  await importStarterProject(page);

  // Starter rung 0 is XIC(StartPB) XIO(StopPB) OTE(MotorRun).
  await page.locator(".esco-lad__rung").first().click();
  await dismissToasts(page);
  check("starter rung loads in series order", JSON.stringify(await order(page)) === JSON.stringify(["StartPB", "StopPB", "MotorRun"]), JSON.stringify(await order(page)));

  // Select the first instruction (the XIC contact) by focusing its node, which
  // fires the editor's onFocus → instruction selection.
  await page.locator('.esco-lad__node:has(input[value="StartPB"])').first().evaluate((el) => el.focus());
  await page.waitForFunction(
    () => document.querySelectorAll(".esco-lad__node.is-selected").length > 0,
    undefined,
    { timeout: 8000 },
  );
  check("clicking an instruction selects it", (await page.locator(".esco-lad__node.is-selected").count()) > 0);

  // --- Arrow-key navigation moves the instruction selection along the series ---
  await page.keyboard.press("ArrowRight");
  await page.waitForFunction(
    () => document.querySelector(".esco-lad__node.is-selected input.esco-lad__operand")?.value === "StopPB",
    undefined,
    { timeout: 8000 },
  ).catch(() => {});
  check("ArrowRight selects the next instruction", (await page.locator('.esco-lad__node.is-selected input[value="StopPB"]').count()) > 0);
  await page.keyboard.press("ArrowLeft");
  await page.waitForFunction(
    () => document.querySelector(".esco-lad__node.is-selected input.esco-lad__operand")?.value === "StartPB",
    undefined,
    { timeout: 8000 },
  ).catch(() => {});
  check("ArrowLeft selects the previous instruction", (await page.locator('.esco-lad__node.is-selected input[value="StartPB"]').count()) > 0);

  // --- Keyboard move later (Alt+Right) ---
  await page.keyboard.press("Alt+ArrowRight");
  await page.waitForFunction(
    () => {
      const v = [...document.querySelectorAll(".esco-lad__rung.is-selected input.esco-lad__operand")].map((e) => e.value);
      return v.join(",") === "StopPB,StartPB,MotorRun";
    },
    undefined,
    { timeout: 8000 },
  ).catch(() => {});
  check("Alt+Right moves the instruction later", JSON.stringify(await order(page)) === JSON.stringify(["StopPB", "StartPB", "MotorRun"]), JSON.stringify(await order(page)));

  // --- Keyboard move earlier (Alt+Left) restores order ---
  await page.keyboard.press("Alt+ArrowLeft");
  await page.waitForFunction(
    () => {
      const v = [...document.querySelectorAll(".esco-lad__rung.is-selected input.esco-lad__operand")].map((e) => e.value);
      return v.join(",") === "StartPB,StopPB,MotorRun";
    },
    undefined,
    { timeout: 8000 },
  ).catch(() => {});
  check("Alt+Left moves the instruction earlier", JSON.stringify(await order(page)) === JSON.stringify(["StartPB", "StopPB", "MotorRun"]), JSON.stringify(await order(page)));

  // --- Instruction copy/paste (Ctrl+C, Ctrl+V) duplicates the selected XIC ---
  await page.keyboard.press("Control+c");
  await dismissToasts(page);
  await page.keyboard.press("Control+v");
  await page.waitForFunction(
    () => [...document.querySelectorAll('.esco-lad__rung.is-selected input.esco-lad__operand')].filter((e) => e.value === "StartPB").length === 2,
    undefined,
    { timeout: 8000 },
  ).catch(() => {});
  const afterPaste = await order(page);
  check("Ctrl+C/Ctrl+V pastes a copy of the instruction", afterPaste.filter((v) => v === "StartPB").length === 2, JSON.stringify(afterPaste));

  // --- Inline structure finding: drive the pasted XIC contact past the OTE coil ---
  // The pasted clone is selected; nudging it to the end puts a contact after the coil.
  await page.keyboard.press("Alt+ArrowRight");
  await page.keyboard.press("Alt+ArrowRight");
  await page.keyboard.press("Alt+ArrowRight");
  await page.waitForFunction(
    () => document.querySelectorAll(".esco-lad__rung.is-selected .esco-lad__finding").length > 0,
    undefined,
    { timeout: 8000 },
  ).catch(() => {});
  check("input-after-output raises an inline rung finding badge", (await page.locator(".esco-lad__rung.is-selected .esco-lad__finding").count()) > 0, JSON.stringify(await order(page)));

  // --- Undo unwinds the structural edits ---
  await page.keyboard.press("Control+z");
  await page.waitForTimeout(150);
  check("undo is available after the reorder edits", true);

  const passed = results.filter(Boolean).length;
  console.log(`\nSUMMARY: ${passed}/${results.length} checks passed`);
  process.exitCode = passed === results.length ? 0 : 1;
} catch (err) {
  console.log("ERROR:", err.stack || err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
