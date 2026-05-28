import { chromium } from "playwright-core";
const URL = "http://localhost:5173/";
const results = [];
const check = (l, c, d = "") => { results.push(!!c); console.log(`${c ? "PASS" : "FAIL"}  ${l}${d ? "  — " + d : ""}`); };
const palette = (page, type) => page.locator(".esco-palette").getByRole("button", { name: type, exact: true });
const selOperands = (page) => page.locator(".esco-lad__rung.is-selected input.esco-lad__operand");
const setOperand = async (input, text) => { await input.click(); await input.fill(""); await input.pressSequentially(text); };
const watchText = (page, tag) => page.locator(`.esco-watch tr:has-text("${tag}")`).first().innerText();
const leg = (page, i) => page.locator(".esco-branch-leg").nth(i);

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
try {
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.locator('button:has-text("MainRoutine")').first().click();
  await page.locator('button:has-text("Add Rung")').waitFor({ timeout: 8000 });

  // Add a fresh rung (auto-selected) — the branch editor strip appears for it.
  await page.locator('button:has-text("Add Rung")').click();
  await page.locator(".esco-branch-edit").waitFor({ timeout: 8000 });
  check("branch editor appears for the selected rung", true);

  // Create a parallel branch -> two legs (main + alternate).
  await page.locator('.esco-branch-edit button:has-text("Parallel Branch")').click();
  await page.waitForFunction(() => document.querySelectorAll(".esco-branch-leg").length === 2);
  check("add parallel branch -> 2 legs", true);
  check("empty legs show the placeholder", (await page.locator(".esco-branch-leg__empty").count()) >= 1);

  // Leg 1: XIC(StartPB);  Leg 2: XIC(MotorRun) (the seal-in contact).
  await leg(page, 0).locator('button:has-text("XIC")').click();
  await leg(page, 1).locator('button:has-text("XIC")').click();
  // Downstream after the merge: XIO(StopPB) OTE(MotorRun) via the main palette.
  await palette(page, "XIO").click();
  await palette(page, "OTE").click();
  await page.waitForFunction(() => document.querySelectorAll(".esco-lad__rung.is-selected .esco-lad__operand").length === 4);

  const ins = selOperands(page);
  await setOperand(ins.nth(0), "StartPB");  // leg 1
  await setOperand(ins.nth(1), "MotorRun"); // leg 2 (seal)
  await setOperand(ins.nth(2), "StopPB");   // downstream
  await setOperand(ins.nth(3), "MotorRun"); // coil
  while ((await page.locator(".esco-undef .esco-btn--create").count()) > 0) {
    await page.locator(".esco-undef .esco-btn--create").first().click();
  }
  await page.waitForFunction(() => [...document.querySelectorAll(".esco-watch td")].some((td) => td.textContent === "MotorRun"));
  check("hand-built seal-in rung created with tags", true);

  // Simulate: Start -> latches; release Start -> stays on; Stop -> drops.
  await page.locator('.esco-watch tr:has-text("StartPB") button:has-text("Toggle")').click();
  await page.locator('button:has-text("Scan Once")').click();
  check("Start pressed latches MotorRun=true", /\btrue\b/.test(await watchText(page, "MotorRun")));

  await page.locator('.esco-watch tr:has-text("StartPB") button:has-text("Toggle")').click(); // release
  await page.locator('button:has-text("Scan Once")').click();
  check("seal-in holds MotorRun=true after Start released", /\btrue\b/.test(await watchText(page, "MotorRun")));

  await page.locator('.esco-watch tr:has-text("StopPB") button:has-text("Toggle")').click();
  await page.locator('button:has-text("Scan Once")').click();
  check("Stop breaks the seal: MotorRun=false", /\bfalse\b/.test(await watchText(page, "MotorRun")));

  const passed = results.filter(Boolean).length;
  console.log(`\nSUMMARY: ${passed}/${results.length} checks passed`);
  process.exitCode = passed === results.length ? 0 : 1;
} catch (err) {
  console.log("ERROR:", err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
