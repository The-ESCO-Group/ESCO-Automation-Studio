import { chromium } from "playwright-core";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  URL,
  STARTER_L5X,
  addRungViaProjectMenu,
  createBoolTag,
  dismissToasts,
  openMainRoutine,
  openWatchPanel,
  ribbonButton,
} from "./helpers.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const shot = (n) => join(here, n);
const exportPath = join(here, "exported.easproj");

const results = [];
function check(label, cond, detail = "") {
  results.push(!!cond);
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${detail ? "  — " + detail : ""}`);
}
const rungCount = (page) => page.locator(".esco-lad__rung").count();
const lampRows = (page) => page.locator('.esco-watch tr:has-text("Lamp")').count();
const ladderButton = (page, type) => page.locator(`.esco-ribbon__button[aria-label="${type}"]`).first();
const fileMenuItem = (page, label) => page.locator(`.esco-ribbon-menu__item:has-text("${label}")`).first();
async function clickFileMenuItem(page, label) {
  await page.locator('.esco-ribbon__tab:has-text("File")').click();
  await page.locator(".esco-ribbon-menu").waitFor({ timeout: 5000 });
  await fileMenuItem(page, label).click();
}
async function operandValues(scope) {
  return scope.locator("input.esco-lad__operand").evaluateAll((els) => els.map((e) => e.value));
}
async function setOperand(input, text) {
  await input.click();
  await input.fill("");
  await input.pressSequentially(text);
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
  const [l5xChooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    clickFileMenuItem(page, "Import L5X"),
  ]);
  await l5xChooser.setFiles({
    name: "starter.L5X",
    mimeType: "application/xml",
    buffer: Buffer.from(STARTER_L5X),
  });
  await openMainRoutine(page);
  await dismissToasts(page);
  check("File > Import L5X opens a controller project", /E2E_Starter/.test(await page.locator(".esco-titlebar__name").innerText()));

  // --- Edit: add a second rung XIC(StartPB) OTE(Lamp) and create the Lamp tag. ---
  await openMainRoutine(page);
  check("starts with the seal-in rung", (await rungCount(page)) === 1, `rungs=${await rungCount(page)}`);

  await createBoolTag(page, "Lamp");
  await openMainRoutine(page);
  await addRungViaProjectMenu(page);
  await page.waitForFunction(() => document.querySelectorAll(".esco-lad__rung").length === 2);
  const newRung = page.locator(".esco-lad__rung").nth(1);
  await newRung.click();
  await ladderButton(page, "XIC").click();
  await ladderButton(page, "OTE").click();
  await page.waitForFunction(
    () => document.querySelectorAll(".esco-lad__rung")[1].querySelectorAll("input.esco-lad__operand").length === 2,
  );
  const inputs = newRung.locator("input.esco-lad__operand");
  await setOperand(inputs.nth(0), "StartPB");
  await setOperand(inputs.nth(1), "Lamp");
  await openWatchPanel(page);
  await page.waitForFunction(() => [...document.querySelectorAll(".esco-watch td")].some((td) => td.textContent === "Lamp"));
  check("edited rung built with Lamp tag", (await lampRows(page)) >= 1, `lampRows=${await lampRows(page)}`);
  await page.screenshot({ path: shot("p1-edited.png") });

  // --- Export (browser download). ---
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    ribbonButton(page, "Save").click(),
  ]);
  await download.saveAs(exportPath);
  check("exported an ESCO .easproj", download.suggestedFilename().endsWith(".easproj"),
    download.suggestedFilename());

  const [l5xDownload] = await Promise.all([
    page.waitForEvent("download"),
    clickFileMenuItem(page, "Export L5X"),
  ]);
  check("File > Export L5X downloads an offline L5X", /\.L5X$/i.test(l5xDownload.suggestedFilename()), l5xDownload.suggestedFilename());

  // --- Refresh: the browser returns to the honest empty workstation. ---
  await page.reload({ waitUntil: "networkidle" });
  check("after refresh, no project is auto-loaded", /No controllers/i.test(await page.locator(".esco-left").innerText()));
  check("after refresh, Lamp tag is gone", (await lampRows(page)) === 0, `lampRows=${await lampRows(page)}`);

  // --- Import: click Open and choose the downloaded project file. ---
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    ribbonButton(page, "Open").click(),
  ]);
  await chooser.setFiles(exportPath);
  await openWatchPanel(page);
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
  await openWatchPanel(page);
  await page.locator('.esco-watch tr:has-text("StartPB") button:has-text("Toggle")').click();
  await page.locator('button:has-text("Scan Once")').click();
  await page.waitForTimeout(150);
  const motor = await valueOf(page, "MotorRun");
  const lamp = await valueOf(page, "Lamp");
  check("scan after import: MotorRun true", motor === "true", `MotorRun=${motor}`);
  check("scan after import: Lamp true", lamp === "true", `Lamp=${lamp}`);
  await page.screenshot({ path: shot("p3-scanned.png") });

  await ribbonButton(page, "Close").click();
  await page.waitForFunction(() => /No controllers/i.test(document.querySelector(".esco-left")?.textContent ?? ""));
  check("toolbar Close returns to the no-project workstation", (await page.locator(".esco-titlebar__name").innerText()).trim() === "ESCO Automation Studio");

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
