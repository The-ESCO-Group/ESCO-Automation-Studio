import { chromium } from "playwright-core";
import { readFile } from "node:fs/promises";
import { URL, importStarterProject } from "./helpers.mjs";

// Roundtrip: export a Program component, then re-import the same
// `.esco-program.json` file into a Controller through the offline conflict dialog.

const results = [];
const check = (label, condition, detail = "") => {
  results.push(!!condition);
  console.log(`${condition ? "PASS" : "FAIL"}  ${label}${detail ? "  - " + String(detail).replace(/\s+/g, " ").slice(0, 160) : ""}`);
};

const contextCommand = async (page, targetSelector, commandText) => {
  await page.locator(targetSelector).first().click({ button: "right" });
  await page.locator(".esco-context-menu--organizer").waitFor({ timeout: 5000 });
  await page.locator(`.esco-context-menu__item:has-text("${commandText}")`).click();
};

const exactProgramCount = (page, name) =>
  page.evaluate((programName) => {
    const names = Array.from(document.querySelectorAll("button.esco-tree__node"))
      .filter((element) => !Array.from(element.classList).some((className) => className.startsWith("esco-tree__node--")))
      .map((element) => (element.textContent ?? "").replace(/^▾/, "").trim());
    return names.filter((candidate) => candidate === programName).length;
  }, name);

const unscheduledProgramNames = (page) =>
  page.evaluate(() => {
    const groups = Array.from(document.querySelectorAll(".esco-tree__group"));
    const group = groups.find((element) => element.textContent?.includes("Unscheduled"));
    const container = group?.parentElement;
    return Array.from((container ?? document).querySelectorAll("button.esco-tree__node"))
      .filter((element) => !Array.from(element.classList).some((className) => className.startsWith("esco-tree__node--")))
      .map((element) => (element.textContent ?? "").replace(/^▾/, "").trim());
  });

const importProgramFile = async (page, file) => {
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    contextCommand(page, '.esco-tree__node--controller:has-text("E2E_Starter")', "Import Program"),
  ]);
  await chooser.setFiles(file);
  await page.locator("#esco-import-title").waitFor({ timeout: 8000 });
};

const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext({ viewport: { width: 1400, height: 950 }, acceptDownloads: true });
const page = await context.newPage();
page.on("pageerror", (error) => console.log("PAGEERROR:", error.message));

try {
  await page.goto(URL, { waitUntil: "networkidle" });
  await importStarterProject(page);
  await page.locator('.esco-tree__node:has-text("MainProgram")').waitFor({ timeout: 8000 });
  check("Starter project has one MainProgram", (await exactProgramCount(page, "MainProgram")) === 1);

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    contextCommand(page, '.esco-tree__node:has-text("MainProgram")', "Export Program"),
  ]);
  const exportPath = await download.path();
  const envelope = JSON.parse(exportPath ? await readFile(exportPath, "utf8") : "{}");
  check(
    "Export Program wrote a program component envelope",
    download.suggestedFilename() === "MainProgram.esco-program.json" &&
      envelope.kind === "program" &&
      envelope.dependencies.routines.includes("MainRoutine"),
    JSON.stringify({ filename: download.suggestedFilename(), kind: envelope.kind, dependencies: envelope.dependencies }),
  );

  await importProgramFile(page, exportPath);
  check(
    "Re-importing MainProgram opens a Controller-targeted conflict dialog",
    (await page.locator('.esco-modal__panel:has-text("Program import")').count()) === 1 &&
      (await page.locator('.esco-modal__panel:has-text("E2E_Starter")').count()) === 1 &&
      (await page.locator('.esco-tagcsv__row--rename:has-text("MainProgram")').count()) === 1,
  );

  const resolution = page.locator('select[aria-label="Resolution for MainProgram"]');
  const applyButton = page.locator('.esco-modal__footer .esco-btn--primary:has-text("Import components")');
  await resolution.selectOption("skip");
  check("Skipping the only Program disables Import", await applyButton.isDisabled());

  await resolution.selectOption("rename");
  await applyButton.click();
  await page.locator("#esco-import-title").waitFor({ state: "detached", timeout: 8000 });
  await page.locator('.esco-tree__node:has-text("MainProgram_1")').waitFor({ timeout: 8000 });
  const unscheduled = await unscheduledProgramNames(page);
  check(
    "Rename imports MainProgram_1 into the Unscheduled bucket",
    (await exactProgramCount(page, "MainProgram_1")) === 1 && unscheduled.includes("MainProgram_1"),
    unscheduled.join(", "),
  );

  await importProgramFile(page, exportPath);
  await page.locator('select[aria-label="Resolution for MainProgram"]').selectOption("overwrite");
  await page.locator('.esco-modal__footer .esco-btn--primary:has-text("Import components")').click();
  await page.locator("#esco-import-title").waitFor({ state: "detached", timeout: 8000 });
  check(
    "Overwrite replaces MainProgram without adding MainProgram_2",
    (await exactProgramCount(page, "MainProgram")) === 1 &&
      (await exactProgramCount(page, "MainProgram_1")) === 1 &&
      (await exactProgramCount(page, "MainProgram_2")) === 0,
  );

  const passed = results.filter(Boolean).length;
  console.log(`\nSUMMARY: ${passed}/${results.length} checks passed`);
  process.exitCode = passed === results.length ? 0 : 1;
} catch (error) {
  console.log("ERROR:", error.message);
  process.exitCode = 1;
} finally {
  await context.close();
  await browser.close();
}
