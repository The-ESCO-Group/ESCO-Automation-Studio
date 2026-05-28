import { chromium } from "playwright-core";
import { URL, createBlankProject } from "./helpers.mjs";
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
  await createBlankProject(page);

  // New instructions appear in the palette.
  check("ONS in palette", (await palette(page, "ONS").count()) === 1);
  check("RTO in palette", (await palette(page, "RTO").count()) === 1);
  check("CTD in palette", (await palette(page, "CTD").count()) === 1);

  // Build a one-shot counter rung: XIC(Btn) ONS(OneShot) CTU(Counter1, 5)
  await page.locator('button:has-text("Add Rung")').click();
  await palette(page, "XIC").click();
  await palette(page, "ONS").click();
  await palette(page, "CTU").click();
  await page.waitForFunction(() => document.querySelectorAll(".esco-lad__rung.is-selected .esco-lad__operand").length === 4);
  const ins = selOperands(page);
  await setOperand(ins.nth(0), "Btn");
  await setOperand(ins.nth(1), "OneShot");
  await setOperand(ins.nth(2), "Counter1");
  await setOperand(ins.nth(3), "5");

  // Create every undefined tag the rung introduced (Btn, OneShot, Counter1).
  while ((await page.locator(".esco-undef .esco-btn--create").count()) > 0) {
    await page.locator(".esco-undef .esco-btn--create").first().click();
  }
  await page.waitForFunction(() => [...document.querySelectorAll(".esco-watch td")].some((td) => td.textContent === "Counter1"));
  check("built ONS/CTU rung; Counter1 (COUNTER) created", true);

  // Hold the button and scan a few times -> counts exactly once (the ONS edge).
  await page.locator('.esco-watch tr:has-text("Btn") button:has-text("Toggle")').click();
  await page.locator('button:has-text("Scan Once")').click();
  await page.locator('button:has-text("Scan Once")').click();
  let counter = await watchText(page, "Counter1");
  check("held button counts once via ONS: ACC=1", /ACC=1\b/.test(counter), counter.replace(/\s+/g, " "));

  // Release and press again -> a second count.
  await page.locator('.esco-watch tr:has-text("Btn") button:has-text("Toggle")').click(); // off
  await page.locator('button:has-text("Scan Once")').click();
  await page.locator('.esco-watch tr:has-text("Btn") button:has-text("Toggle")').click(); // on
  await page.locator('button:has-text("Scan Once")').click();
  counter = await watchText(page, "Counter1");
  check("second press increments: ACC=2", /ACC=2\b/.test(counter), counter.replace(/\s+/g, " "));

  const passed = results.filter(Boolean).length;
  console.log(`\nSUMMARY: ${passed}/${results.length} checks passed`);
  process.exitCode = passed === results.length ? 0 : 1;
} catch (err) {
  console.log("ERROR:", err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
