import { chromium } from "playwright-core";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { URL, addPaletteInstruction, importStarterProject } from "./helpers.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const results = [];
const check = (label, cond, detail = "") => { results.push(!!cond); console.log(`${cond ? "PASS" : "FAIL"}  ${label}${detail ? "  — " + detail : ""}`); };
const rungCount = (page) => page.locator(".esco-lad__rung").count();
const setOperand = async (input, text) => { await input.click(); await input.fill(""); await input.pressSequentially(text); };

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
try {
  await page.goto(URL, { waitUntil: "networkidle" });
  await importStarterProject(page);
  check("MainRoutine opens with the seal-in rung", (await rungCount(page)) === 1);

  // Add a rung (auto-selected), then delete the seal-in rung so only the new one remains.
  await page.locator('button:has-text("Add Rung")').click();
  await page.waitForFunction(() => document.querySelectorAll(".esco-lad__rung").length === 2);
  check("Add Rung adds a rung", (await rungCount(page)) === 2);

  await page.locator(".esco-lad__rung").first().locator('button:has-text("Delete Rung")').click();
  await page.waitForFunction(() => document.querySelectorAll(".esco-lad__rung").length === 1);
  check("Delete Rung removes the seal-in rung", (await rungCount(page)) === 1);

  // Build XIC(StartPB) XIO(StopPB) OTE(MotorRun) via the grouped palette (targets selected rung).
  await addPaletteInstruction(page, "XIC");
  await addPaletteInstruction(page, "XIO");
  await addPaletteInstruction(page, "OTE");
  await page.waitForFunction(() => document.querySelectorAll(".esco-lad__operand").length === 3);
  const inputs = page.locator(".esco-lad__operand");
  await setOperand(inputs.nth(0), "StartPB");
  await setOperand(inputs.nth(1), "StopPB");
  await setOperand(inputs.nth(2), "MotorRun");
  const vals = await inputs.evaluateAll((els) => els.map((e) => e.value));
  check("Adds XIC + XIO + OTE with editable operands", JSON.stringify(vals) === JSON.stringify(["StartPB", "StopPB", "MotorRun"]), JSON.stringify(vals));
  await page.screenshot({ path: join(here, "01-open.png") });

  // Scan: StartPB on, StopPB off -> MotorRun true.
  await page.locator('.esco-dock__tab:has-text("Watch")').click();
  await page.locator('.esco-watch tr:has-text("StartPB") button:has-text("Toggle")').click();
  await page.locator('button:has-text("Scan Once")').click();
  await page.waitForTimeout(80);
  const motor = await page.locator('.esco-watch tr:has-text("MotorRun") .esco-watch__value').first().innerText();
  check("Start on + Scan Once -> MotorRun true", /\btrue\b/.test(motor), motor.trim());

  const passed = results.filter(Boolean).length;
  console.log(`\nSUMMARY: ${passed}/${results.length} checks passed`);
  process.exitCode = passed === results.length ? 0 : 1;
} catch (err) {
  console.log("ERROR:", err.message);
  await page.screenshot({ path: join(here, "99-error.png") }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
