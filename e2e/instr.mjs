import { chromium } from "playwright-core";
import { URL, importStarterProject } from "./helpers.mjs";
const results = [];
const check = (l, c, d = "") => { results.push(!!c); console.log(`${c ? "PASS" : "FAIL"}  ${l}${d ? "  — " + d : ""}`); };
const palette = (page, type) => page.locator(".esco-palette").getByRole("button", { name: type, exact: true });
const selOperands = (page) => page.locator(".esco-lad__rung.is-selected input.esco-lad__operand");
const setOperand = async (input, text) => { await input.click(); await input.fill(""); await input.pressSequentially(text); };
const watchText = (page, tag) => page.locator(`.esco-watch tr:has-text("${tag}")`).first().innerText();

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
try {
  await page.goto(URL, { waitUntil: "networkidle" });
  await importStarterProject(page);

  // Rung: XIC(StartPB) MOV(123, SomeDint)
  await page.locator('button:has-text("Add Rung")').click();
  await palette(page, "XIC").click();
  await palette(page, "MOV").click();
  await page.waitForFunction(() => document.querySelectorAll(".esco-lad__rung.is-selected .esco-lad__operand").length === 3);
  let ins = selOperands(page);
  await setOperand(ins.nth(0), "StartPB");
  await setOperand(ins.nth(1), "123");
  await setOperand(ins.nth(2), "SomeDint");
  await page.locator('button:has-text("Create DINT")').click();
  await page.waitForFunction(() => [...document.querySelectorAll(".esco-watch td")].some((td) => td.textContent === "SomeDint"));
  check("built MOV rung; SomeDint created (DINT)", true);

  // Rung: XIC(StartPB) TON(Timer1, 1000)
  await page.locator('button:has-text("Add Rung")').click();
  await palette(page, "XIC").click();
  await palette(page, "TON").click();
  await page.waitForFunction(() => document.querySelectorAll(".esco-lad__rung.is-selected .esco-lad__operand").length === 3);
  ins = selOperands(page);
  await setOperand(ins.nth(0), "StartPB");
  await setOperand(ins.nth(1), "Timer1");
  await setOperand(ins.nth(2), "1000");
  await page.locator('button:has-text("Create TIMER")').click();
  await page.waitForFunction(() => [...document.querySelectorAll(".esco-watch td")].some((td) => td.textContent === "Timer1"));
  check("built TON rung; Timer1 created (TIMER)", true);

  // Drive.
  await page.locator('.esco-watch tr:has-text("StartPB") button:has-text("Toggle")').click();
  for (let i = 0; i < 4; i++) { await page.locator('button:has-text("Scan Once")').click(); await page.waitForTimeout(50); }
  check("MOV simulates: SomeDint=123", /\b123\b/.test(await watchText(page, "SomeDint")));
  check("TON simulates: Timer1 DN=true", /DN=true/.test(await watchText(page, "Timer1")));
  check("seal-in still drives MotorRun=true", /\btrue\b/.test(await watchText(page, "MotorRun")));

  const passed = results.filter(Boolean).length;
  console.log(`\nSUMMARY: ${passed}/${results.length} checks passed`);
  process.exitCode = passed === results.length ? 0 : 1;
} catch (err) {
  console.log("ERROR:", err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
