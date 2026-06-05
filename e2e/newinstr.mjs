import { chromium } from "playwright-core";
import { URL, createBlankProject, openMainRoutine, openWatchPanel } from "./helpers.mjs";

const results = [];
const check = (l, c, d = "") => { results.push(!!c); console.log(`${c ? "PASS" : "FAIL"}  ${l}${d ? "  - " + d : ""}`); };
const selOperands = (page) => page.locator(".esco-lad__rung.is-selected input.esco-lad__operand");
const setOperand = async (input, text) => { await input.click(); await input.fill(""); await input.pressSequentially(text); };
const watchText = (page, tag) => page.locator(`.esco-watch tr:has-text("${tag}")`).first().innerText();
const ladderButton = (page, type) => page.locator(`.esco-ribbon__button[aria-label="${type}"]`).first();

async function createTag(page, name, dataType = "BOOL") {
  await page.locator('.esco-left :text("Controller Tags")').first().click({ button: "right" });
  await page.locator('.esco-context-menu__item:has-text("New Tag")').click();
  const dialog = page.locator('.esco-modal__panel[aria-label="New Tag"]');
  await dialog.waitFor({ timeout: 8000 });
  await dialog.locator('label:has-text("Name") input').fill(name);
  await dialog.locator('label:has-text("Data Type") select').selectOption(dataType);
  await dialog.locator('.esco-btn--primary:has-text("OK")').click();
  await dialog.waitFor({ state: "detached", timeout: 8000 });
}

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));

try {
  await page.goto(URL, { waitUntil: "networkidle" });
  await createBlankProject(page);
  await openMainRoutine(page);

  check("ONS in instruction toolbar", (await ladderButton(page, "ONS").count()) === 1);
  check("RTO in instruction toolbar", (await ladderButton(page, "RTO").count()) === 1);
  check("CTD in instruction toolbar", (await ladderButton(page, "CTD").count()) === 1);

  for (const [name, dataType] of [["Btn", "BOOL"], ["OneShot", "BOOL"], ["Counter1", "COUNTER"]]) {
    await createTag(page, name, dataType);
  }
  check("created BOOL and COUNTER tags through the Studio-style New Tag dialog", true);
  await openMainRoutine(page);

  // Build a one-shot counter rung through the instruction toolbar:
  // XIC(Btn) ONS(OneShot) CTU(Counter1, 5)
  await page.locator(".esco-lad__rung").first().click();
  await ladderButton(page, "XIC").click();
  await ladderButton(page, "ONS").click();
  await ladderButton(page, "CTU").click();
  await page.waitForFunction(() => document.querySelectorAll(".esco-lad__rung.is-selected .esco-lad__operand").length === 4);
  const ins = selOperands(page);
  await setOperand(ins.nth(0), "Btn");
  await setOperand(ins.nth(1), "OneShot");
  await setOperand(ins.nth(2), "Counter1");
  await setOperand(ins.nth(3), "5");
  check("built ONS/CTU rung with current instruction toolbar", true);

  await openWatchPanel(page);
  await page.waitForFunction(() => [...document.querySelectorAll(".esco-watch td")].some((td) => td.textContent === "Counter1"));

  await page.locator('.esco-watch tr:has-text("Btn") button:has-text("Toggle")').click();
  await page.locator('button:has-text("Scan Once")').click();
  await page.locator('button:has-text("Scan Once")').click();
  let counter = await watchText(page, "Counter1");
  check("held button counts once via ONS: ACC=1", /ACC=1\b/.test(counter), counter.replace(/\s+/g, " "));

  await page.locator('.esco-watch tr:has-text("Btn") button:has-text("Toggle")').click();
  await page.locator('button:has-text("Scan Once")').click();
  await page.locator('.esco-watch tr:has-text("Btn") button:has-text("Toggle")').click();
  await page.locator('button:has-text("Scan Once")').click();
  counter = await watchText(page, "Counter1");
  check("second press increments: ACC=2", /ACC=2\b/.test(counter), counter.replace(/\s+/g, " "));

  const selectedInstructionCount = async () =>
    page.locator(".esco-lad__rung.is-selected .esco-lad__node, .esco-lad__rung.is-selected .esco-lad__box").count();
  const beforeRemove = await selectedInstructionCount();
  await page.locator(".esco-lad__rung.is-selected .esco-lad__node, .esco-lad__rung.is-selected .esco-lad__box").first().click({ button: "right" });
  await page.locator('.esco-context-menu__item:has-text("Delete Instruction")').click();
  await page.waitForFunction(
    (count) =>
      document.querySelectorAll(".esco-lad__rung.is-selected .esco-lad__node, .esco-lad__rung.is-selected .esco-lad__box").length === count - 1,
    beforeRemove,
  );
  check("Instruction context menu deletes one ladder instruction", (await selectedInstructionCount()) === beforeRemove - 1);
  await ladderButton(page, "Undo").click();
  await page.waitForFunction(
    (count) =>
      document.querySelectorAll(".esco-lad__rung.is-selected .esco-lad__node, .esco-lad__rung.is-selected .esco-lad__box").length === count,
    beforeRemove,
  );
  check("Undo restores the removed ladder instruction", (await selectedInstructionCount()) === beforeRemove);

  const passed = results.filter(Boolean).length;
  console.log(`\nSUMMARY: ${passed}/${results.length} checks passed`);
  process.exitCode = passed === results.length ? 0 : 1;
} catch (err) {
  console.log("ERROR:", err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
