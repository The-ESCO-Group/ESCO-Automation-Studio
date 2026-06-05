import { chromium } from "playwright-core";
import { URL, importStarterProject } from "./helpers.mjs";

const results = [];
const check = (l, c, d = "") => { results.push(!!c); console.log(`${c ? "PASS" : "FAIL"}  ${l}${d ? "  - " + d : ""}`); };
const routineProps = '.esco-modal__panel[aria-label="Routine Properties"]';
const newTaskDialog = '.esco-modal__panel[aria-label="New Task"]';

const openRoutineProperties = async (page, routineName) => {
  await page.locator(`.esco-tree__node--routine:has-text("${routineName}")`).first().click({ button: "right" });
  await page.locator(".esco-context-menu").waitFor({ timeout: 5000 });
  await page.locator('.esco-context-menu__item:has-text("Routine Properties")').click();
  await page.locator(routineProps).waitFor({ timeout: 5000 });
};

const openNewTaskDialog = async (page) => {
  await page.locator('.esco-left :text("Tasks")').first().click({ button: "right" });
  await page.locator(".esco-context-menu").waitFor({ timeout: 5000 });
  await page.locator('.esco-context-menu__item:has-text("New Task")').click();
  await page.locator(newTaskDialog).waitFor({ timeout: 5000 });
};

const contextCommand = async (page, targetSelector, commandText) => {
  await page.locator(targetSelector).first().click({ button: "right" });
  await page.locator(".esco-context-menu").waitFor({ timeout: 5000 });
  await page.locator(`.esco-context-menu__item:has-text("${commandText}")`).click();
};

const readHelpDialog = async (page) => {
  await page.locator(".esco-dialog-help").waitFor({ timeout: 5000 });
  const text = await page.locator(".esco-dialog-help").innerText();
  await page.locator('.esco-dialog-help .esco-btn--primary:has-text("OK")').click();
  await page.locator(".esco-dialog-help").waitFor({ state: "detached", timeout: 5000 });
  return text;
};

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
let nativeDialogCount = 0;
page.on("dialog", async (dialog) => {
  nativeDialogCount += 1;
  console.log("NATIVE_DIALOG:", dialog.message());
  await dialog.dismiss();
});

try {
  await page.goto(URL, { waitUntil: "networkidle" });
  await importStarterProject(page);

  check("Studio shell does not mount the old right-side properties pane", (await page.locator(".esco-props").count()) === 0);

  await page.locator('.esco-tree__node--routine:has-text("MainRoutine")').first().click({ button: "right" });
  await page.locator(".esco-context-menu").waitFor({ timeout: 5000 });
  const routineMenu = await page.locator(".esco-context-menu").innerText();
  check(
    "routine context menu exposes rename, properties, cross-reference, and delete commands",
    /Rename/.test(routineMenu) && /Routine Properties/.test(routineMenu) && /Cross Reference/.test(routineMenu) && /Delete/.test(routineMenu),
    routineMenu,
  );
  await page.locator('.esco-context-menu__item:has-text("Routine Properties")').click();
  await page.locator(routineProps).waitFor({ timeout: 5000 });
  const routinePropsText = await page.locator(routineProps).innerText();
  check("Routine Properties opens as the current property sheet", /Routine Properties/.test(routinePropsText) && /General|LD|Ladder Diagram/.test(routinePropsText), routinePropsText.slice(0, 120));
  await page.locator(`${routineProps} label:has-text("Name") input`).fill("Routine_Cancelled");
  await page.locator(`${routineProps} .esco-btn:has-text("Cancel")`).click();
  await page.locator(routineProps).waitFor({ state: "detached", timeout: 5000 });
  check(
    "Routine Properties Cancel discards typed edits",
    (await page.locator('.esco-tree__node--routine:has-text("Routine_Cancelled")').count()) === 0 &&
      (await page.locator('.esco-tree__node--routine:has-text("MainRoutine")').count()) >= 1,
  );

  await openRoutineProperties(page, "MainRoutine");
  await page.locator(`${routineProps} label:has-text("Name") input`).fill("Routine_Props_Applied");
  await page.locator(`${routineProps} .esco-btn:has-text("Apply")`).click();
  await page.locator('.esco-tree__node--routine:has-text("Routine_Props_Applied")').waitFor({ timeout: 5000 });
  check(
    "Routine Properties Apply persists while keeping the sheet open",
    (await page.locator(routineProps).count()) === 1 &&
      (await page.locator('.esco-tree__node--routine:has-text("Routine_Props_Applied")').count()) >= 1,
  );
  await page.locator(`${routineProps} label:has-text("Name") input`).fill("Bad__Name");
  check(
    "Routine Properties validation disables invalid Apply/OK",
    await page.locator(`${routineProps} .esco-btn--primary`).isDisabled() &&
      await page.locator(`${routineProps} .esco-btn:has-text("Apply")`).isDisabled() &&
      /consecutive underscores/i.test(await page.locator(`${routineProps} [role="alert"]`).innerText()),
  );
  const routineNativeDialogCount = nativeDialogCount;
  await page.locator(`${routineProps} .esco-btn:has-text("Help")`).click();
  const routineHelp = await readHelpDialog(page);
  check(
    "Routine Properties Help opens in-app and explains OK/Apply/Cancel",
    nativeDialogCount === routineNativeDialogCount && /OK saves.*Apply saves.*Cancel closes.*discards/s.test(routineHelp),
    `${nativeDialogCount - routineNativeDialogCount} native dialog(s); ${routineHelp}`,
  );
  await page.locator(`${routineProps} label:has-text("Name") input`).fill("MainRoutine");
  await page.locator(`${routineProps} .esco-btn--primary:has-text("OK")`).click();
  await page.locator(routineProps).waitFor({ state: "detached", timeout: 5000 });
  await page.locator('.esco-tree__node--routine:has-text("MainRoutine")').waitFor({ timeout: 5000 });
  check("Routine Properties OK persists and closes", (await page.locator(routineProps).count()) === 0);

  await openNewTaskDialog(page);
  await page.locator(`${newTaskDialog} label:has-text("Name") input`).fill("Bad__Name");
  check(
    "New Task validation blocks invalid task identifiers",
    await page.locator(`${newTaskDialog} .esco-btn--primary:has-text("OK")`).isDisabled() &&
      /consecutive underscores/i.test(await page.locator(`${newTaskDialog} [role="alert"]`).innerText()),
  );
  const taskNativeDialogCount = nativeDialogCount;
  await page.locator(`${newTaskDialog} .esco-btn:has-text("Help")`).click();
  const taskHelp = await readHelpDialog(page);
  check(
    "New Task Help opens in-app and explains create/cancel behavior",
    nativeDialogCount === taskNativeDialogCount && /OK creates.*Cancel closes/s.test(taskHelp),
    `${nativeDialogCount - taskNativeDialogCount} native dialog(s); ${taskHelp}`,
  );
  await page.locator(`${newTaskDialog} label:has-text("Name") input`).fill("DialogTask_Cancel");
  await page.locator(`${newTaskDialog} .esco-btn:has-text("Cancel")`).click();
  await page.locator(newTaskDialog).waitFor({ state: "detached", timeout: 5000 });
  check("New Task Cancel does not create a task", (await page.locator('.esco-tree__node--task:has-text("DialogTask_Cancel")').count()) === 0);

  await openNewTaskDialog(page);
  await page.locator(`${newTaskDialog} label:has-text("Name") input`).fill("DialogTask_OK");
  await page.locator(`${newTaskDialog} .esco-btn--primary:has-text("OK")`).click();
  await page.locator(newTaskDialog).waitFor({ state: "detached", timeout: 5000 });
  await page.locator('.esco-tree__node--task:has-text("DialogTask_OK")').waitFor({ timeout: 5000 });
  check("New Task OK creates and persists a task", (await page.locator('.esco-tree__node--task:has-text("DialogTask_OK")').count()) >= 1);

  await contextCommand(page, '.esco-left :text("Controller Tags")', "New Tag");
  const newTagDialog = '.esco-modal__panel[aria-label="New Tag"]';
  await page.locator(newTagDialog).waitFor({ timeout: 5000 });
  await page.locator(`${newTagDialog} label:has-text("Name") input`).fill("Bad__Name");
  check(
    "New Tag validation blocks invalid names before backend create",
    await page.locator(`${newTagDialog} .esco-btn--primary:has-text("OK")`).isDisabled() &&
      /consecutive underscores/i.test(await page.locator(`${newTagDialog} [role="alert"]`).innerText()),
  );
  const tagNativeDialogCount = nativeDialogCount;
  await page.locator(`${newTagDialog} .esco-btn:has-text("Help")`).click();
  const tagHelp = await readHelpDialog(page);
  check(
    "New Tag Help opens in-app and explains Open Configuration",
    nativeDialogCount === tagNativeDialogCount && /Open Configuration moves to the tag editor/s.test(tagHelp),
    `${nativeDialogCount - tagNativeDialogCount} native dialog(s); ${tagHelp}`,
  );
  await page.locator(`${newTagDialog} label:has-text("Name") input`).fill("ConfigTag");
  await page.locator(`${newTagDialog} label:has-text("Open Configuration") input`).check();
  await page.locator(`${newTagDialog} .esco-btn--primary:has-text("OK")`).click();
  await page.locator(newTagDialog).waitFor({ state: "detached", timeout: 5000 });
  await page.locator(".esco-tags").waitFor({ timeout: 5000 });
  await page.locator(".esco-tags__search").fill("");
  const tagEditorNames = await page.locator('.esco-tags__table tbody tr td:first-child input').evaluateAll((inputs) =>
    inputs.map((input) => (input instanceof HTMLInputElement ? input.value : "")),
  );
  check("New Tag Open Configuration lands in the tag editor", tagEditorNames.includes("ConfigTag"), tagEditorNames.join("|"));
  await page.locator('.esco-ribbon__tab:has-text("Tools")').click();
  await page.locator('.esco-ribbon-menu__item:has-text("Compare")').click();
  await page.locator(".esco-cmp").waitFor({ timeout: 5000 });
  await page.locator('.esco-ribbon__tab:has-text("Tools")').click();
  await page.locator('.esco-ribbon-menu__item:has-text("Properties")').click();
  await page.locator(".esco-tags").waitFor({ timeout: 5000 });
  const propertyToastCount = await page.locator('.esco-toast:has-text("No editable property sheet")').count();
  const propertyTagNames = await page.locator('.esco-tags__table tbody tr td:first-child input').evaluateAll((inputs) =>
    inputs.map((input) => (input instanceof HTMLInputElement ? input.value : "")),
  );
  check(
    "Tools > Properties on a tag selection opens the tag editor instead of a dead toast",
    propertyToastCount === 0 && propertyTagNames.includes("ConfigTag"),
    propertyTagNames.join("|"),
  );

  await page.locator('.esco-ribbon__tab:has-text("File")').click();
  await page.locator('.esco-ribbon-menu__item:has-text("Controller Properties")').click();
  await page.locator('.esco-modal__panel[aria-label="Controller Properties"]').waitFor({ timeout: 5000 });
  const controllerProps = await page.locator('.esco-modal__panel[aria-label="Controller Properties"]').innerText();
  check("Controller Properties shows ESCO property tabs", /General/.test(controllerProps) && /Major\/Minor Faults/.test(controllerProps) && /Advanced/.test(controllerProps), controllerProps.slice(0, 120));

  const passed = results.filter(Boolean).length;
  console.log(`\nSUMMARY: ${passed}/${results.length} checks passed`);
  process.exitCode = passed === results.length ? 0 : 1;
} catch (err) {
  console.log("ERROR:", err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
