import { chromium } from "playwright-core";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const shot = (n) => join(here, n);
const exportPath = join(here, "exported.plcproj.json");
const URL = "http://localhost:5173/";

const results = [];
function check(label, cond, detail = "") {
  results.push(!!cond);
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${detail ? "  — " + detail : ""}`);
}
const rungCount = (page) => page.locator(".esco-lad__rung").count();
const lampRows = (page) => page.locator('.esco-watch tr:has-text("Lamp")').count();
const palette = (page, type) => page.locator(".esco-palette").getByRole("button", { name: type, exact: true });
async function operandValues(scope) {
  return scope.locator("input.esco-lad__operand").evaluateAll((els) => els.map((e) => e.value));
}
async function setOperand(input, text) {
  await input.click();
  await input.fill("");
  await input.pressSequentially(text);
}
async function openMainRoutine(page) {
  await page.locator('button:has-text("MainRoutine")').first().click();
  await page.locator('button:has-text("Add Rung")').waitFor({ timeout: 8000 });
}
async function valueOf(page, tag) {
  return (
    await page.locator(`.esco-watch tr:has-text("${tag}") .esco-watch__value`).first().innerText()
  ).trim();
}

const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext({
  viewport: { width: 1400, height: 900 },
  acceptDownloads: true,
});
const page = await context.newPage();
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));

try {
  await page.goto(URL, { waitUntil: "networkidle" });

  // --- Edit: add a second rung XIC(StartPB) OTE(Lamp) and create the Lamp tag. ---
  await openMainRoutine(page);
  check("starts with the seal-in rung", (await rungCount(page)) === 1, `rungs=${await rungCount(page)}`);

  await page.locator('button:has-text("Add Rung")').click();
  await page.waitForFunction(() => document.querySelectorAll(".esco-lad__rung").length === 2);
  const newRung = page.locator(".esco-lad__rung").nth(1);
  // New rung is auto-selected on Add; grouped palette targets the selected rung.
  await palette(page, "XIC").click();
  await palette(page, "OTE").click();
  await page.waitForFunction(
    () => document.querySelectorAll(".esco-lad__rung")[1].querySelectorAll("input.esco-lad__operand").length === 2,
  );
  const inputs = newRung.locator("input.esco-lad__operand");
  await setOperand(inputs.nth(0), "StartPB");
  await setOperand(inputs.nth(1), "Lamp");
  await page.locator('button:has-text("Create BOOL")').click(); // create the new Lamp tag
  await page.waitForFunction(() => !!document.querySelector('.esco-watch tr td')
    && [...document.querySelectorAll(".esco-watch td")].some((td) => td.textContent === "Lamp"));
  check("edited rung built with Lamp tag", (await lampRows(page)) >= 1, `lampRows=${await lampRows(page)}`);
  await page.screenshot({ path: shot("p1-edited.png") });

  // --- Export (browser download). ---
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.locator('button:has-text("Export Project")').click(),
  ]);
  await download.saveAs(exportPath);
  check("exported a .plcproj.json", download.suggestedFilename().endsWith(".plcproj.json"),
    download.suggestedFilename());

  // --- Refresh: state returns to the default seal-in project. ---
  await page.reload({ waitUntil: "networkidle" });
  await openMainRoutine(page);
  check("after refresh, back to default (1 rung)", (await rungCount(page)) === 1, `rungs=${await rungCount(page)}`);
  check("after refresh, Lamp tag is gone", (await lampRows(page)) === 0, `lampRows=${await lampRows(page)}`);

  // --- Import: click "Import Project" and choose the downloaded file. ---
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.locator('button:has-text("Import Project")').click(),
  ]);
  await chooser.setFiles(exportPath);
  await page.waitForFunction(
    () => [...document.querySelectorAll(".esco-watch td")].some((td) => td.textContent === "Lamp"),
    null,
    { timeout: 8000 },
  );
  await openMainRoutine(page); // selection is reset on import; reopen to view
  await page.waitForFunction(() => document.querySelectorAll(".esco-lad__rung").length === 2);
  const vals = await operandValues(page);
  check("imported: edited rung returned (2 rungs)", (await rungCount(page)) === 2, `rungs=${await rungCount(page)}`);
  check("imported: Lamp operand restored", vals.includes("Lamp"), `operands=${JSON.stringify(vals)}`);
  check("imported: Lamp tag present in Watch", (await lampRows(page)) >= 1);
  await page.screenshot({ path: shot("p2-imported.png") });

  // --- Scan the imported routine. ---
  await page.locator('button:has-text("Watch (")').click();
  await page.locator('.esco-watch tr:has-text("StartPB") button:has-text("Toggle")').click();
  await page.locator('button:has-text("Scan Once")').click();
  await page.waitForTimeout(150);
  const motor = await valueOf(page, "MotorRun");
  const lamp = await valueOf(page, "Lamp");
  check("scan after import: MotorRun true", motor === "true", `MotorRun=${motor}`);
  check("scan after import: Lamp true", lamp === "true", `Lamp=${lamp}`);
  await page.screenshot({ path: shot("p3-scanned.png") });

  const passed = results.filter(Boolean).length;
  console.log(`\nSUMMARY: ${passed}/${results.length} checks passed`);
  process.exitCode = passed === results.length ? 0 : 1;
} catch (err) {
  console.log("ERROR:", err.message);
  await page.screenshot({ path: shot("p99-error.png") }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
