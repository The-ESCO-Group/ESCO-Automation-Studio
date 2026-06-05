import { chromium } from "playwright-core";
import { readFile } from "node:fs/promises";
import { URL, importStarterProject } from "./helpers.mjs";

// Roundtrip: export a Task component, then re-import the same `.esco-task.json`
// through the Tasks root organizer menu. Imported Tasks are intentionally left
// without scheduled Programs until an engineer assigns them offline.

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

const exactTaskCount = (page, name) =>
  page.evaluate((taskName) => {
    const names = Array.from(document.querySelectorAll("button.esco-tree__node--task"))
      .map((element) => (element.textContent ?? "").replace(/^▾/, "").trim());
    return names.filter((candidate) => candidate === taskName).length;
  }, name);

const scheduledProgramNamesForTask = (page, name) =>
  page.evaluate((taskName) => {
    const button = Array.from(document.querySelectorAll("button.esco-tree__node--task"))
      .find((element) => (element.textContent ?? "").replace(/^▾/, "").trim() === taskName);
    const list = button?.parentElement?.querySelector("ul.esco-tree--nested");
    return Array.from(list?.querySelectorAll("button.esco-tree__node") ?? [])
      .filter((element) => !Array.from(element.classList).some((className) => className.startsWith("esco-tree__node--")))
      .map((element) => (element.textContent ?? "").replace(/^▾/, "").trim());
  }, name);

const importTaskFile = async (page, file) => {
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    contextCommand(page, '.esco-tree__group--button:has-text("Tasks")', "Import Task"),
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
  await page.locator('.esco-tree__node--task:has-text("MainTask")').waitFor({ timeout: 8000 });
  check("Starter project has one MainTask", (await exactTaskCount(page, "MainTask")) === 1);

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    contextCommand(page, '.esco-tree__node--task:has-text("MainTask")', "Export Task"),
  ]);
  const exportPath = await download.path();
  const envelope = JSON.parse(exportPath ? await readFile(exportPath, "utf8") : "{}");
  check(
    "Export Task wrote a task component envelope",
    download.suggestedFilename() === "MainTask.esco-task.json" &&
      envelope.kind === "task" &&
      envelope.dependencies.routines.includes("MainRoutine"),
    JSON.stringify({ filename: download.suggestedFilename(), kind: envelope.kind, dependencies: envelope.dependencies }),
  );

  await importTaskFile(page, exportPath);
  check(
    "Re-importing MainTask opens a Controller-targeted conflict dialog",
    (await page.locator('.esco-modal__panel:has-text("Task import")').count()) === 1 &&
      (await page.locator('.esco-modal__panel:has-text("E2E_Starter")').count()) === 1 &&
      (await page.locator('.esco-tagcsv__row--rename:has-text("MainTask")').count()) === 1,
  );

  const resolution = page.locator('select[aria-label="Resolution for MainTask"]');
  const applyButton = page.locator('.esco-modal__footer .esco-btn--primary:has-text("Import components")');
  await resolution.selectOption("skip");
  check("Skipping the only Task disables Import", await applyButton.isDisabled());

  await resolution.selectOption("rename");
  await applyButton.click();
  await page.locator("#esco-import-title").waitFor({ state: "detached", timeout: 8000 });
  await page.locator('.esco-tree__node--task:has-text("MainTask_1")').waitFor({ timeout: 8000 });
  const scheduled = await scheduledProgramNamesForTask(page, "MainTask_1");
  check(
    "Rename imports MainTask_1 without scheduled Programs",
    (await exactTaskCount(page, "MainTask_1")) === 1 && scheduled.length === 0,
    scheduled.join(", "),
  );

  await importTaskFile(page, exportPath);
  await page.locator('select[aria-label="Resolution for MainTask"]').selectOption("overwrite");
  await page.locator('.esco-modal__footer .esco-btn--primary:has-text("Import components")').click();
  await page.locator("#esco-import-title").waitFor({ state: "detached", timeout: 8000 });
  check(
    "Overwrite replaces MainTask without adding MainTask_2",
    (await exactTaskCount(page, "MainTask")) === 1 &&
      (await exactTaskCount(page, "MainTask_1")) === 1 &&
      (await exactTaskCount(page, "MainTask_2")) === 0,
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
