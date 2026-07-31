// ESCO IDE dialog and menu smoke: verifies the classic property-sheet
// surfaces that carry much of the IDE workflow. Honors E2E_URL.
import { chromium } from "playwright-core";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { clickFileMenuItem, createBlankProject, URL } from "./helpers.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const results = [];
const check = (label, cond, detail = "") => {
  results.push(!!cond);
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${detail ? "  - " + String(detail).replace(/\s+/g, " ").slice(0, 140) : ""}`);
};

const rect = async (page, selector) =>
  page.locator(selector).first().evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const styles = getComputedStyle(element);
    return {
      x: Math.round(bounds.x),
      y: Math.round(bounds.y),
      width: Math.round(bounds.width),
      height: Math.round(bounds.height),
      borderRadius: styles.borderRadius,
      backgroundColor: styles.backgroundColor,
      text: element.textContent?.replace(/\s+/g, " ").trim() ?? "",
    };
  });

const contextCommand = async (page, targetSelector, commandText) => {
  await page.locator(targetSelector).first().click({ button: "right" });
  await page.locator(".esco-context-menu--organizer").waitFor();
  await page.locator(`.esco-context-menu__item:has-text("${commandText}")`).click();
};

const closeDialog = async (page, selector) => {
  const panel = page.locator(selector).first();
  const close = panel.locator(".esco-icon-btn[aria-label^=\"Close\"]").first();
  if ((await close.count()) > 0) {
    await close.click();
  } else {
    await panel.locator('.esco-btn:has-text("Cancel")').first().click();
  }
  await page.locator(selector).waitFor({ state: "detached", timeout: 8000 });
};

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
page.setDefaultTimeout(10000);
page.on("pageerror", (error) => console.log("PAGEERROR:", error.message));
let nativeDialogCount = 0;
page.on("dialog", async (dialog) => {
  nativeDialogCount += 1;
  console.log("NATIVE_DIALOG:", dialog.message());
  await dialog.dismiss();
});

try {
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.locator(".esco-titlebar").waitFor();

  await page.locator('.esco-ribbon__tab:has-text("File")').click();
  const fileMenuSelector = '.esco-ribbon-menu[aria-label="File menu"]';
  await page.locator(fileMenuSelector).waitFor();
  const fileMenu = await rect(page, fileMenuSelector);
  const fileMenuRows = await page
    .locator(`${fileMenuSelector} > .esco-ribbon-menu__item:visible, ${fileMenuSelector} > .esco-ribbon-menu__submenu > .esco-ribbon-menu__submenu-trigger:visible`)
    .evaluateAll((items) =>
    items.map((item) => {
      const bounds = item.getBoundingClientRect();
      return { text: item.textContent?.replace(/\s+/g, " ").trim(), height: Math.round(bounds.height) };
    }),
  );
  check("File menu opens as a classic dropdown below the menu bar", fileMenu.x <= 10 && fileMenu.y >= 88 && fileMenu.y <= 94, JSON.stringify(fileMenu));
  check("File menu keeps dense Windows rows and shortcuts", fileMenuRows.length >= 8 && fileMenuRows.every((row) => row.height === 22), JSON.stringify(fileMenuRows));

  await page.keyboard.press("Escape");
  await page.locator('.esco-ribbon__toolbar-row--standard .esco-ribbon__button[aria-label="New"]').click();
  await page.locator(".esco-new-project").waitFor();
  const newProject = await rect(page, ".esco-new-project");
  const modal = await rect(page, ".esco-modal");
  const newProjectLabels = await page.locator(".esco-new-project .esco-field > span").evaluateAll((nodes) =>
    nodes.map((node) => node.textContent?.trim()).filter(Boolean),
  );
  check("New Project dialog uses square classic property-shell chrome", newProject.width === 720 && newProject.borderRadius === "0px", JSON.stringify(newProject));
  check("New Project dialog does not dim the Studio workbench", /rgba\(0,\s*0,\s*0,\s*0\)/.test(modal.backgroundColor), modal.backgroundColor);
  check("New Project shows controller catalog selector and ESCO path fields", /1756-L71/.test(newProject.text) && newProjectLabels.includes("Controller Name") && newProjectLabels.includes("Chassis Type"), newProject.text);
  const newProjectActions = await rect(page, ".esco-new-project .esco-modal__actions");
  check("New Project action buttons are right aligned", newProjectActions.x + newProjectActions.width > 980, JSON.stringify(newProjectActions));
  await page.screenshot({ path: join(here, "dialogs-new-project.png"), fullPage: false });

  await page.locator(".esco-new-project .esco-btn--primary").click();
  await page.locator(".esco-new-project").waitFor({ state: "detached" });
  await page.locator('.esco-titlebar__name:has-text("Untitled Project")').waitFor();

  await clickFileMenuItem(page, "Controller Properties");
  await page.locator(".esco-controller-props").waitFor();
  const controllerProps = await rect(page, ".esco-controller-props");
  const controllerTabs = await page.locator(".esco-controller-props__tabs button").evaluateAll((tabs) =>
    tabs.map((tab) => tab.textContent?.trim()).filter(Boolean),
  );
  check("Controller Properties opens as wide Studio property sheet", controllerProps.width === 900 && controllerProps.borderRadius === "0px", JSON.stringify(controllerProps));
  check("Controller Properties includes multi-row Studio tabs", controllerTabs.length >= 12 && controllerTabs.includes("Internet Protocol") && controllerTabs.includes("Port Configuration"), controllerTabs.join("|"));
  check("Controller Properties General page exposes controller identity/path", /Name.*Project.*Type.*Revision.*Chassis Type.*Slot.*Driver.*Path/.test(controllerProps.text), controllerProps.text);
  await page.screenshot({ path: join(here, "dialogs-controller-properties.png"), fullPage: false });
  await page.locator('.esco-controller-props .esco-icon-btn[aria-label="Close Controller Properties"]').click();
  await page.locator(".esco-controller-props").waitFor({ state: "detached" });

  await contextCommand(page, '.esco-left :text("Tasks")', "New Task");
  await page.locator('[aria-label="New Task"]').waitFor();
  const newTask = await rect(page, '[aria-label="New Task"]');
  const newTaskTabs = await page.locator('[aria-label="New Task"] .esco-controller-props__tabs button').evaluateAll((tabs) =>
    tabs.map((tab) => tab.textContent?.trim()).filter(Boolean),
  );
  check("New Task opens as compact Studio property sheet", newTask.width === 620 && newTask.height === 377 && newTask.borderRadius === "0px", JSON.stringify({ newTask, newTaskTabs }));
  check("New Task exposes Studio task type choices", /Continuous.*Periodic.*Event.*Inhibit Task/.test(newTask.text) && newTaskTabs.join("|") === "General|Configuration", newTask.text);
  await page.screenshot({ path: join(here, "dialogs-new-task.png"), fullPage: false });
  await closeDialog(page, '[aria-label="New Task"]');

  await contextCommand(page, '.esco-tree__node--task:has-text("MainTask")', "Properties");
  await page.locator('[aria-label="Task Properties"]').waitFor();
  const taskProps = await rect(page, '[aria-label="Task Properties"]');
  check("Task Properties uses square classic property-sheet chrome", taskProps.width === 620 && taskProps.height === 377 && taskProps.borderRadius === "0px", JSON.stringify(taskProps));
  check("Task Properties shows Studio task configuration fields", /Task.*Continuous.*Name.*Type.*Inhibit Task.*Disable Automatic Output Processing/.test(taskProps.text), taskProps.text);
  await page.screenshot({ path: join(here, "dialogs-task-properties.png"), fullPage: false });
  await closeDialog(page, '[aria-label="Task Properties"]');

  await contextCommand(page, '.esco-tree__node:has-text("MainProgram")', "Properties");
  await page.locator('[aria-label="Program Properties"]').waitFor();
  const programProps = await rect(page, '[aria-label="Program Properties"]');
  check("Program Properties uses square classic property-sheet chrome", programProps.width === 620 && programProps.height === 377 && programProps.borderRadius === "0px", JSON.stringify(programProps));
  check("Program Properties exposes general/configuration workflow", /Program.*Name.*Description.*Inhibit Program.*OK.*Cancel.*Apply/.test(programProps.text), programProps.text);
  await page.screenshot({ path: join(here, "dialogs-program-properties.png"), fullPage: false });
  await closeDialog(page, '[aria-label="Program Properties"]');

  await contextCommand(page, '.esco-left :text("Controller Tags")', "New Tag");
  await page.locator('[aria-label="New Tag"]').waitFor();
  const newTag = await rect(page, '[aria-label="New Tag"]');
  check("New Tag uses Studio-style tag creation sheet", newTag.width === 620 && newTag.height >= 500 && newTag.borderRadius === "0px", JSON.stringify(newTag));
  check("New Tag exposes ESCO tag fields and external access", /Name.*Usage.*Alias For.*Data Type.*Dimension.*Style.*Scope.*External Access.*Constant.*Open Configuration/.test(newTag.text), newTag.text);
  await page.screenshot({ path: join(here, "dialogs-new-tag.png"), fullPage: false });
  await closeDialog(page, '[aria-label="New Tag"]');

  await contextCommand(page, '.esco-tree__group--backplane:has-text("1756 Backplane")', "New Module");
  await page.locator('[aria-label="Select Module Type"]').waitFor();
  const newModule = await rect(page, '[aria-label="Select Module Type"]');
  check("Select Module Type uses upgraded ESCO module browser chrome", newModule.width >= 980 && newModule.height >= 590 && newModule.borderRadius === "0px", JSON.stringify(newModule));
  check(
    "Select Module Type exposes tabbed catalog, filters, favorites, and create workflow",
    /Catalog.*(?:Module Discovery|Offline Discovery).*Favorites.*Module Type Category Filters.*Module Type Vendor\/Family Filters.*Module Types Found.*Add to Favorites.*Revision.*Keying.*Create.*Close.*Help/.test(newModule.text),
    newModule.text,
  );
  await page.locator('[aria-label="Select Module Type"] input[placeholder^="Search catalog"]').fill("1756-IF8H");
  check("Select Module Type searches the XLSX-derived catalog", await page.locator('[aria-label="Select Module Type"] tr:has-text("1756-IF8H")').count() >= 1);
  await page.screenshot({ path: join(here, "dialogs-new-module.png"), fullPage: false });
  await page.locator('[aria-label="Select Module Type"] tr:has-text("1756-IF8H")').first().click();
  const moduleBrowserImageSrc = await page.locator('[aria-label="Select Module Type"] .esco-new-module__module-render').getAttribute("src");
  check(
    "Select Module Type renders workbook device thumbnails and preview imagery",
    (await page.locator('[aria-label="Select Module Type"] .esco-new-module__catalog-thumb').count()) >= 1 &&
      /analog_input|assets/.test(moduleBrowserImageSrc ?? ""),
    moduleBrowserImageSrc ?? "",
  );
  await page.locator('[aria-label="Select Module Type"] .esco-btn--primary:has-text("Create")').click();
  await page.locator('[aria-label="Device definition"]').waitFor();
  const deviceDefinition = await rect(page, '[aria-label="Device definition"]');
  check(
    "New Module opens Device definition step before module creation",
    deviceDefinition.width >= 600 &&
      /Device definition.*Device type.*Name:\*.*Revision.*Electronic keying.*Connection.*Input Data.*Coordinated System Time.*Data Format.*OK.*Cancel.*Help/.test(deviceDefinition.text),
    JSON.stringify(deviceDefinition),
  );
  await page.locator('[aria-label="Device definition"] label:has-text("Name:*") input').fill("Bad__Name");
  check(
    "Device definition validation blocks invalid module names",
    await page.locator('[aria-label="Device definition"] .esco-btn--primary:has-text("OK")').isDisabled() &&
      /consecutive underscores/i.test(await page.locator('[aria-label="Device definition"] [role="alert"]').innerText()),
  );
  await page.locator('[aria-label="Device definition"] .esco-btn:has-text("Help")').click();
  await page.locator(".esco-dialog-help").waitFor();
  const moduleHelp = await rect(page, ".esco-dialog-help");
  check(
    "Device definition Help opens ESCO in-app help without browser alerts",
    nativeDialogCount === 0 && /offline project metadata/i.test(moduleHelp.text),
    `${nativeDialogCount} native dialog(s); ${moduleHelp.text}`,
  );
  await page.locator('.esco-dialog-help .esco-btn--primary:has-text("OK")').click();
  await page.locator(".esco-dialog-help").waitFor({ state: "detached" });
  await page.locator('[aria-label="Device definition"] label:has-text("Name:*") input').fill("CancelledName");
  await page.locator('[aria-label="Device definition"] .esco-btn:has-text("Cancel")').click();
  await page.locator('[aria-label="Device definition"]').waitFor({ state: "detached" });
  const moduleAfterDefinitionCancel = await rect(page, '[aria-label="New Module"]');
  check(
    "Device definition Cancel discards staged field edits",
    !/CancelledName/.test(moduleAfterDefinitionCancel.text),
    moduleAfterDefinitionCancel.text,
  );
  await page.locator('[aria-label="New Module"] .esco-btn:has-text("Change Device Definition")').click();
  await page.locator('[aria-label="Device definition"]').waitFor();
  await page.locator('[aria-label="Device definition"] label:has-text("Name:*") input').fill("test");
  await page.screenshot({ path: join(here, "dialogs-new-module-definition.png"), fullPage: false });
  await page.locator('[aria-label="Device definition"] .esco-btn--primary:has-text("OK")').click();
  await page.locator('[aria-label="Device definition"]').waitFor({ state: "detached" });
  const newModuleOverview = await rect(page, '[aria-label="New Module"]');
  const moduleOverviewImageSrc = await page.locator('[aria-label="New Module"] .esco-new-module-overview__device').getAttribute("src");
  check(
    "New Module overview mirrors the Studio device configuration process with ESCO branding",
    newModuleOverview.width >= 1000 &&
      /1756-IF8H, test.*Controller connection: Creating.*Not Connected.*INFORMATION.*Overview\*.*Device Information.*CONFIGURATION.*Connection.*Channels.*Calibration.*ESCO Automation.*Definition.*Electronic keying.*OK.*Cancel.*Help/.test(newModuleOverview.text),
    newModuleOverview.text,
  );
  check("New Module overview uses the workbook device image", /analog_input|assets/.test(moduleOverviewImageSrc ?? ""), moduleOverviewImageSrc ?? "");
  const modulePalette = await page.evaluate(() => {
    const color = (selector, prop = "backgroundColor") => {
      const node = document.querySelector(selector);
      return node ? getComputedStyle(node)[prop] : "";
    };
    return {
      hero: color(".esco-new-module-stage__hero"),
      title: color(".esco-new-module-stage__hero h2", "color"),
      parentSlot: color(".esco-new-module-stage__hero span", "color"),
      close: color(".esco-new-module-stage__hero .esco-icon-btn", "color"),
      status: color(".esco-new-module-stage__status"),
      creating: color(".esco-new-module-stage__status span", "color"),
      notConnected: color(".esco-new-module-stage__status strong", "color"),
      nav: color(".esco-new-module-stage__nav"),
      navLabel: color(".esco-new-module-stage__nav span", "color"),
      active: color(".esco-new-module-stage__nav button.is-active"),
      main: color(".esco-new-module-stage__main"),
      card: color(".esco-new-module-overview"),
      heading: color(".esco-new-module-overview__definition h4", "color"),
      fieldLabel: color(".esco-new-module-overview__definition dt", "color"),
      fieldValue: color(".esco-new-module-overview__definition dd", "color"),
      footer: color(".esco-new-module-stage__footer"),
      ok: color(".esco-new-module-stage__footer .esco-btn--primary"),
      cancel: color(".esco-new-module-stage__footer .esco-btn:nth-child(2)"),
      help: color(".esco-new-module-stage__footer .esco-btn:nth-child(3)", "color"),
    };
  });
  check(
    "New Module creation stage uses the ESCO dark-blue palette",
    modulePalette.hero === "rgb(16, 36, 63)" &&
      modulePalette.title === "rgb(244, 248, 255)" &&
      modulePalette.parentSlot === "rgb(184, 199, 218)" &&
      modulePalette.close === "rgb(215, 226, 241)" &&
      modulePalette.status === "rgb(23, 37, 58)" &&
      modulePalette.creating === "rgb(56, 189, 248)" &&
      modulePalette.notConnected === "rgb(148, 163, 184)" &&
      modulePalette.nav === "rgb(11, 23, 40)" &&
      modulePalette.navLabel === "rgb(111, 130, 155)" &&
      modulePalette.active === "rgb(30, 136, 255)" &&
      modulePalette.main === "rgb(15, 27, 45)" &&
      modulePalette.card === "rgb(22, 36, 58)" &&
      modulePalette.heading === "rgb(77, 163, 255)" &&
      modulePalette.fieldLabel === "rgb(143, 163, 191)" &&
      modulePalette.fieldValue === "rgb(229, 237, 248)" &&
      modulePalette.footer === "rgb(11, 23, 40)" &&
      modulePalette.ok === "rgb(30, 136, 255)" &&
      modulePalette.cancel === "rgb(23, 37, 58)" &&
      modulePalette.help === "rgb(77, 163, 255)",
    JSON.stringify(modulePalette),
  );
  await page.screenshot({ path: join(here, "dialogs-new-module-overview.png"), fullPage: false });
  await page.locator('[aria-label="New Module"] .esco-new-module-stage__footer .esco-btn--primary:has-text("OK")').click();
  await page.locator('[aria-label="New Module"]').waitFor({ state: "detached" });
  check("New Module final OK adds the configured module to I/O", /1756-IF8H/.test(await page.locator(".esco-left").innerText()));

  await page.locator('.esco-tree__node--routine:has-text("MainRoutine")').click({ button: "right" });
  await page.locator(".esco-context-menu--organizer").waitFor();
  const contextMenu = await rect(page, ".esco-context-menu--organizer");
  const contextRows = await page.locator(".esco-context-menu--organizer .esco-context-menu__item").evaluateAll((items) =>
    items.map((item) => {
      const bounds = item.getBoundingClientRect();
      return { text: item.textContent?.replace(/\s+/g, " ").trim(), height: Math.round(bounds.height) };
    }),
  );
  check("Organizer context menu is compact Windows-style chrome", contextMenu.width === 220 && contextMenu.borderRadius === "0px", JSON.stringify(contextMenu));
  check("Routine context menu exposes Studio workflow commands", /Open/.test(contextRows[0]?.text ?? "") && contextRows.some((row) => /Routine Properties/.test(row.text ?? "")) && contextRows.every((row) => row.height === 23), JSON.stringify(contextRows));

  await page.locator('.esco-context-menu__item:has-text("Routine Properties")').click();
  await page.locator(".esco-routine-props").waitFor();
  const routineProps = await rect(page, ".esco-routine-props");
  const routineTabs = await page.locator(".esco-routine-props .esco-controller-props__tabs button").evaluateAll((tabs) =>
    tabs.map((tab) => tab.textContent?.trim()).filter(Boolean),
  );
  check("Routine Properties opens as classic tabbed sheet", routineProps.width === 600 && routineTabs.join("|") === "General|Configuration", JSON.stringify({ routineProps, routineTabs }));
  check("Routine Properties shows ladder language identity", /LD.*Ladder Diagram.*Name.*Type.*Program/.test(routineProps.text), routineProps.text);
  await page.screenshot({ path: join(here, "dialogs-routine-properties.png"), fullPage: false });

  const passed = results.filter(Boolean).length;
  console.log(`\nSUMMARY: ${passed}/${results.length} checks passed`);
  process.exitCode = passed === results.length ? 0 : 1;
} catch (error) {
  console.log("ERROR:", error.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
