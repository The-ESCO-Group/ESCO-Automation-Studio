import { chromium } from "playwright-core";
import { URL, createBlankProject, createBoolTag, openMainRoutine, openWatchPanel } from "./helpers.mjs";
const results = [];
const check = (l, c, d = "") => { results.push(!!c); console.log(`${c ? "PASS" : "FAIL"}  ${l}${d ? "  — " + d : ""}`); };
const selOperands = (page) => page.locator(".esco-lad__rung.is-selected input.esco-lad__operand");
const setOperand = async (input, text) => { await input.click(); await input.fill(""); await input.pressSequentially(text); };
const watchText = (page, tag) => page.locator(`.esco-watch tr:has-text("${tag}")`).first().innerText();
const ladderButton = (page, type) => page.locator(`.esco-ribbon__button[aria-label="${type}"]`).first();
const pickBranchInstruction = async (page, type) => {
  await page.locator(".esco-lad__branch-target").first().click();
  await page.locator(".esco-instr-picker__input").fill(type);
  await page.keyboard.press("Enter");
  await page.locator(".esco-instr-picker").waitFor({ state: "detached", timeout: 8000 });
};

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
try {
  await page.goto(URL, { waitUntil: "networkidle" });
  await createBlankProject(page);
  for (const tag of ["StartPB", "StopPB", "MotorRun"]) await createBoolTag(page, tag);
  await openMainRoutine(page);

  // Build a seal-in rung through the Studio-style instruction toolbar.
  await page.locator(".esco-lad__rung").first().click();
  check(
    "instruction toolbar exposes Studio-style branch buttons",
    (await ladderButton(page, "BST").count()) === 1 &&
      (await ladderButton(page, "NXB").count()) === 1 &&
      (await ladderButton(page, "BND").count()) === 1,
  );
  await ladderButton(page, "XIC").click();
  await ladderButton(page, "BST").click();
  await page.locator(".esco-lad__branch-target").first().waitFor({ timeout: 8000 });
  check("empty parallel leg exposes a branch insertion target", (await page.locator(".esco-lad__parallel .esco-lad__branch-target").count()) >= 1);
  await ladderButton(page, "NXB").click();
  check("NXB adds another empty branch leg", (await page.locator(".esco-lad__parallel .esco-lad__branch-target").count()) >= 2);

  await page.locator(".esco-lad__branch-target").first().click();
  check("branch insertion target opens the instruction picker", (await page.locator(".esco-instr-picker h2:has-text('branch leg')").count()) === 1);
  await page.locator(".esco-instr-picker__input").fill("XIC");
  await page.keyboard.press("Enter");
  await page.locator(".esco-instr-picker").waitFor({ state: "detached", timeout: 8000 });
  await pickBranchInstruction(page, "XIC");
  check("branch insertion target adds alternate XIC legs through the picker", (await page.locator(".esco-lad__parallel .esco-lad__node--contact-closed").count()) === 3);
  await ladderButton(page, "XIO").click();
  await ladderButton(page, "OTE").click();
  await page.waitForFunction(() => document.querySelectorAll(".esco-lad__rung.is-selected .esco-lad__operand").length === 5);

  const ins = selOperands(page);
  await setOperand(ins.nth(0), "StartPB");  // leg 1
  await setOperand(ins.nth(1), "MotorRun"); // leg 2 (seal)
  await setOperand(ins.nth(2), "StartPB");  // leg 3
  await setOperand(ins.nth(3), "StopPB");   // downstream
  await setOperand(ins.nth(4), "MotorRun"); // coil
  await openWatchPanel(page);
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
