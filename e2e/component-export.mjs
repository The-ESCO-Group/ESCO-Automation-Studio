import { chromium } from "playwright-core";
import { readFile } from "node:fs/promises";
import { URL, importStarterProject } from "./helpers.mjs";

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

const downloadComponent = async (page, targetSelector, commandText) => {
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    contextCommand(page, targetSelector, commandText),
  ]);
  const path = await download.path();
  const text = path ? await readFile(path, "utf8") : "";
  return { filename: download.suggestedFilename(), envelope: JSON.parse(text), path };
};

const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext({ viewport: { width: 1400, height: 950 }, acceptDownloads: true });
const page = await context.newPage();
page.on("pageerror", (error) => console.log("PAGEERROR:", error.message));

try {
  await page.goto(URL, { waitUntil: "networkidle" });
  await importStarterProject(page);

  const controller = await downloadComponent(page, '.esco-tree__node--controller:has-text("E2E_Starter")', "Export Controller");
  check(
    "Controller context menu exports a full ESCO controller component",
    controller.filename === "E2E_Starter.esco-controller.json" &&
      controller.envelope.kind === "controller" &&
      controller.envelope.dependencies.tags.includes("MotorRun") &&
      controller.envelope.dependencies.routines.includes("MainRoutine") &&
      Array.isArray(controller.envelope.payload.programs),
    JSON.stringify({
      filename: controller.filename,
      kind: controller.envelope.kind,
      dependencies: controller.envelope.dependencies,
      programs: controller.envelope.payload.programs?.length,
    }),
  );
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    contextCommand(page, '.esco-tree__node--controller:has-text("E2E_Starter")', "Import Controller"),
  ]);
  await chooser.setFiles(controller.path);
  await page.locator("#esco-import-title").waitFor({ timeout: 8000 });
  const dialogText = await page.locator(".esco-modal__panel").innerText();
  check(
    "Controller import opens a conflict-aware preview for a duplicate controller",
    /Controller import/i.test(dialogText) && /E2E_Starter/.test(dialogText) && /E2E_Starter_1/.test(dialogText),
    dialogText,
  );
  await page.locator('.esco-modal__footer .esco-btn--primary:has-text("Import components")').click();
  await page.locator("#esco-import-title").waitFor({ state: "detached", timeout: 8000 });
  await page.locator('.esco-tree__node--controller:has-text("E2E_Starter_1")').waitFor({ timeout: 8000 });
  check(
    "Controller import adds a renamed full controller copy",
    (await page.locator('.esco-tree__node--controller:has-text("E2E_Starter")').count()) >= 1 &&
      (await page.locator('.esco-tree__node--controller:has-text("E2E_Starter_1")').count()) === 1,
  );

  const routine = await downloadComponent(page, '.esco-tree__node--routine:has-text("MainRoutine")', "Export Routine");
  check(
    "Routine context menu exports an ESCO component JSON envelope",
    routine.filename === "MainRoutine.esco-routine.json" &&
      routine.envelope.kind === "routine" &&
      routine.envelope.dependencies.tags.includes("StartPB"),
    JSON.stringify({ filename: routine.filename, kind: routine.envelope.kind, dependencies: routine.envelope.dependencies }),
  );

  const program = await downloadComponent(page, '.esco-tree__node:has-text("MainProgram")', "Export Program");
  check(
    "Program context menu exports routines and tags",
    program.filename === "MainProgram.esco-program.json" &&
      program.envelope.kind === "program" &&
      program.envelope.dependencies.routines.includes("MainRoutine"),
    JSON.stringify({ filename: program.filename, kind: program.envelope.kind, dependencies: program.envelope.dependencies }),
  );

  const task = await downloadComponent(page, '.esco-tree__node--task:has-text("MainTask")', "Export Task");
  check(
    "Task context menu exports scheduled routine summary",
    task.filename === "MainTask.esco-task.json" &&
      task.envelope.kind === "task" &&
      task.envelope.dependencies.routines.includes("MainRoutine"),
    JSON.stringify({ filename: task.filename, kind: task.envelope.kind, dependencies: task.envelope.dependencies }),
  );

  const devices = await downloadComponent(page, '.esco-tree__group--backplane:has-text("1756 Backplane")', "Export Device Tree");
  check(
    "Backplane context menu exports the device tree component",
    /Device_Tree\.esco-devices\.json$/.test(devices.filename) &&
      devices.envelope.kind === "device-tree" &&
      Array.isArray(devices.envelope.payload.modules),
    JSON.stringify({ filename: devices.filename, kind: devices.envelope.kind, modules: devices.envelope.payload.modules.length }),
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
