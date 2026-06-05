import { chromium } from "playwright-core";
import { readFile } from "node:fs/promises";
import { URL, importStarterProject } from "./helpers.mjs";

// Roundtrip: export a Routine component, then re-import the same
// `.esco-routine.json` file into a Program through the offline conflict dialog.

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

const importRoutineFile = async (page, file) => {
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    contextCommand(page, '.esco-tree__node:has-text("MainProgram")', "Import Routine"),
  ]);
  await chooser.setFiles(file);
  await page.locator("#esco-import-title").waitFor({ timeout: 8000 });
};

const routineCount = (page) => page.locator(".esco-tree__node--routine").count();

const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext({ viewport: { width: 1400, height: 950 }, acceptDownloads: true });
const page = await context.newPage();
page.on("pageerror", (error) => console.log("PAGEERROR:", error.message));

try {
  await page.goto(URL, { waitUntil: "networkidle" });
  await importStarterProject(page);
  await page.locator('.esco-tree__node--routine:has-text("MainRoutine")').waitFor({ timeout: 8000 });
  check("Starter project has one routine", (await routineCount(page)) === 1);

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    contextCommand(page, '.esco-tree__node--routine:has-text("MainRoutine")', "Export Routine"),
  ]);
  const exportPath = await download.path();
  const envelope = JSON.parse(exportPath ? await readFile(exportPath, "utf8") : "{}");
  check(
    "Export Routine wrote a routine component envelope",
    download.suggestedFilename() === "MainRoutine.esco-routine.json" &&
      envelope.kind === "routine" &&
      envelope.dependencies.tags.includes("StartPB"),
    JSON.stringify({ filename: download.suggestedFilename(), kind: envelope.kind, dependencies: envelope.dependencies }),
  );

  await importRoutineFile(page, exportPath);
  check(
    "Re-importing MainRoutine opens a Program-targeted conflict dialog",
    (await page.locator('.esco-modal__panel:has-text("Routine import")').count()) === 1 &&
      (await page.locator('.esco-modal__panel:has-text("MainProgram")').count()) === 1 &&
      (await page.locator('.esco-tagcsv__row--rename:has-text("MainRoutine")').count()) === 1,
  );

  const resolution = page.locator('select[aria-label="Resolution for MainRoutine"]');
  const applyButton = page.locator('.esco-modal__footer .esco-btn--primary:has-text("Import components")');
  await resolution.selectOption("skip");
  check("Skipping the only routine disables Import", await applyButton.isDisabled());

  await resolution.selectOption("rename");
  await applyButton.click();
  await page.locator("#esco-import-title").waitFor({ state: "detached", timeout: 8000 });
  await page.locator('.esco-tree__node--routine:has-text("MainRoutine_1")').waitFor({ timeout: 8000 });
  check("Rename resolution imports MainRoutine as MainRoutine_1", (await routineCount(page)) === 2);

  await importRoutineFile(page, exportPath);
  await page.locator('select[aria-label="Resolution for MainRoutine"]').selectOption("overwrite");
  await page.locator('.esco-modal__footer .esco-btn--primary:has-text("Import components")').click();
  await page.locator("#esco-import-title").waitFor({ state: "detached", timeout: 8000 });
  check(
    "Overwrite resolution replaces MainRoutine without adding a new routine",
    (await routineCount(page)) === 2 &&
      (await page.locator('.esco-tree__node--routine:has-text("MainRoutine_2")').count()) === 0,
  );

  const missingDependencyFile = {
    name: "RemoteStart.esco-routine.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({
      format: "esco.component.export.v1",
      kind: "routine",
      name: "RemoteStart",
      exportedAt: "2026-06-04T00:00:00.000Z",
      project: { id: "source", name: "Source Project" },
      owner: { id: "prog-source", name: "SourceProgram", type: "program" },
      dependencies: {
        tags: ["MissingStart"],
        dataTypes: ["MissingStatus"],
        routines: ["MissingHelper"],
        devices: ["RemoteRack"],
      },
      payload: { id: "rtn-source", programId: "prog-source", name: "RemoteStart", language: "ladder" },
    }, null, 2)),
  };
  await importRoutineFile(page, missingDependencyFile);
  check(
    "Routine import preview surfaces missing dependency warnings",
    (await page.locator('.esco-tagcsv__row--create:has-text("Dependency review")').count()) === 1 &&
      (await page.locator('.esco-tagcsv__row--create:has-text("MissingStart")').count()) === 1,
  );
  await page.locator('.esco-modal__footer .esco-btn--primary:has-text("Import components")').click();
  await page.locator("#esco-import-title").waitFor({ state: "detached", timeout: 8000 });
  await page.locator('.esco-tree__node--routine:has-text("RemoteStart")').waitFor({ timeout: 8000 });
  check("Routine with dependency warnings still imports for offline Verify follow-up", (await routineCount(page)) === 3);

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
