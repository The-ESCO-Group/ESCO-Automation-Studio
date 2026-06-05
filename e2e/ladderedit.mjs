import { chromium } from "playwright-core";
import { URL, createBlankProject, openMainRoutine, dismissToasts } from "./helpers.mjs";

const results = [];
const check = (l, c, d = "") => { results.push(!!c); console.log(`${c ? "PASS" : "FAIL"}  ${l}${d ? "  - " + d : ""}`); };
const selOperands = (page) => page.locator(".esco-lad__rung.is-selected input.esco-lad__operand");
const setOperand = async (input, text) => { await input.click(); await input.fill(""); await input.pressSequentially(text); };

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));

try {
  await page.goto(URL, { waitUntil: "networkidle" });
  await createBlankProject(page);
  await openMainRoutine(page);

  // --- Phase 5: Add Ladder Element picker via Alt+Insert inserts a real instruction ---
  await page.locator(".esco-lad__rung").first().click();
  const boxesBefore = await page.locator(".esco-lad__rung.is-selected .esco-lad__box").count();

  await page.keyboard.press("Alt+Insert");
  await page.locator(".esco-instr-picker").waitFor({ timeout: 8000 });
  check("Alt+Insert opens the Add Ladder Element picker", (await page.locator(".esco-instr-picker").count()) === 1);
  check("picker lists instructions from the registry", (await page.locator(".esco-instr-picker__item").count()) > 20);

  const allItems = await page.locator(".esco-instr-picker__item").count();
  await page.locator('.esco-instr-picker__input').fill("Timer On Delay");
  await page.waitForFunction((n) => document.querySelectorAll(".esco-instr-picker__item").length < n, allItems);
  check("search narrows the instruction list", (await page.locator(".esco-instr-picker__item").count()) < allItems);
  const tonItem = page.locator('.esco-instr-picker__item', { has: page.locator('.esco-instr-picker__mnemonic:text-is("TON")') });
  await tonItem.first().waitFor({ timeout: 8000 });
  check("search surfaces the TON instruction", (await tonItem.count()) >= 1);

  // Select the TON row and insert it through the real project-action layer.
  await tonItem.first().click();
  await page.locator('.esco-instr-picker .esco-btn--primary:has-text("Insert")').click();
  await page.locator(".esco-instr-picker").waitFor({ state: "detached", timeout: 8000 });
  await page.waitForFunction((n) => document.querySelectorAll(".esco-lad__rung.is-selected .esco-lad__box").length === n + 1, boxesBefore);
  check("Enter inserts a real TON box on the selected rung", (await page.locator('.esco-lad__rung.is-selected .esco-lad__box:has-text("TON")').count()) === 1);

  // --- Phase 4: Create Tag from a missing operand, with inferred TIMER type ---
  // The newly inserted TON has an empty timer operand (its first operand).
  const tonTimerOperand = page.locator('.esco-lad__box:has-text("TON") input.esco-lad__operand').first();
  await tonTimerOperand.waitFor({ timeout: 8000 });
  await setOperand(tonTimerOperand, "DwellTimer");
  await page.waitForFunction(
    () => document.querySelector('input.esco-lad__operand[value="DwellTimer"]')?.classList.contains("is-undefined") === true,
  );
  check("typed timer operand is flagged as an undefined tag", true);

  const tonPresetOperand = page.locator('.esco-lad__box:has-text("TON") input.esco-lad__operand').nth(1);
  await setOperand(tonPresetOperand, "DwellPreset");
  await page.keyboard.press("Shift+F10");
  const keyboardMenu = page.locator(".esco-context-menu");
  await keyboardMenu.waitFor({ timeout: 8000 });
  const keyboardMenuLabel = await keyboardMenu.getAttribute("aria-label");
  check("keyboard context menu follows the focused operand", keyboardMenuLabel === "TON DwellPreset", keyboardMenuLabel ?? "");
  await page.keyboard.press("Escape");
  await keyboardMenu.waitFor({ state: "detached", timeout: 8000 });
  const restoredOperandValue = await page.evaluate(() => {
    const active = document.activeElement;
    return active instanceof HTMLInputElement ? active.value : "";
  });
  check("closing the keyboard context menu restores operand focus", restoredOperandValue === "DwellPreset", restoredOperandValue);

  await page.locator('.esco-lad__rung.is-selected .esco-lad__box:has-text("TON")').click({ button: "right" });
  await page.locator('.esco-context-menu__item:has-text("Create Tag")').waitFor({ timeout: 8000 });
  check("operand context menu offers Create Tag for the missing tag", (await page.locator('.esco-context-menu__item:has-text("Create Tag")').count()) === 1);
  await page.locator('.esco-context-menu__item:has-text("Create Tag")').click();

  const dialog = page.locator('.esco-modal__panel[aria-label="New Tag"]');
  await dialog.waitFor({ timeout: 8000 });
  const prefillName = await dialog.locator('label:has-text("Name") input').inputValue();
  const prefillType = await dialog.locator('label:has-text("Data Type") select').inputValue();
  check("New Tag dialog prefills the operand base name", prefillName === "DwellTimer", prefillName);
  check("New Tag dialog infers TIMER from the TON operand", prefillType === "TIMER", prefillType);

  await dialog.locator('.esco-btn--primary:has-text("OK")').click();
  await dialog.waitFor({ state: "detached", timeout: 8000 });
  await dismissToasts(page);
  await page.waitForFunction(
    () => {
      const el = document.querySelector('input.esco-lad__operand[value="DwellTimer"]');
      return !!el && el.classList.contains("is-undefined") === false;
    },
  );
  check("created tag clears the undefined-operand diagnostic", true);

  const passed = results.filter(Boolean).length;
  console.log(`\nSUMMARY: ${passed}/${results.length} checks passed`);
  process.exitCode = passed === results.length ? 0 : 1;
} catch (err) {
  console.log("ERROR:", err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
