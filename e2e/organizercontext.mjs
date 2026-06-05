// E2E: Controller Organizer context-menu parity. Exercises the tree the way an
// engineer does: right-click nodes, invoke commands, and verify the IDE changes
// state instead of only showing menu labels.
import { chromium } from "playwright-core";
import { URL, acceptConfirmation, dismissToasts, importL5XText } from "./helpers.mjs";

const FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0" TargetName="OrgCtx" ContentType="Controller">
  <Controller Use="Target" Name="OrgCtx">
    <Modules>
      <Module Name="Local" CatalogNumber="1756-L83E" Slot="0"/>
      <Module Name="DI_01" CatalogNumber="1756-IB16" Slot="1" ParentModule="Local"/>
    </Modules>
    <Tags>
      <Tag Name="StartPB" TagType="Base" DataType="BOOL"/>
      <Tag Name="MotorRun" TagType="Base" DataType="BOOL"/>
    </Tags>
    <Programs>
      <Program Name="MainProgram" MainRoutineName="MainRoutine">
        <Tags>
          <Tag Name="LocalLatch" TagType="Base" DataType="BOOL"/>
        </Tags>
        <Routines>
          <Routine Name="MainRoutine" Type="RLL">
            <RLLContent>
              <Rung Number="0" Type="N"><Text><![CDATA[XIC(StartPB)OTE(MotorRun);]]></Text></Rung>
            </RLLContent>
          </Routine>
        </Routines>
      </Program>
    </Programs>
  </Controller>
</RSLogix5000Content>`;

const results = [];
const check = (label, cond, detail = "") => {
  results.push(!!cond);
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${detail ? "  - " + String(detail).replace(/\s+/g, " ").slice(0, 130) : ""}`);
};

const menu = (page) => page.locator(".esco-context-menu--organizer:not(.esco-context-menu--inline)").first();
const menuItem = (page, label) => page.locator(`.esco-context-menu__item:has-text("${label}")`).first();
const activeDockTab = (page) => page.locator(".esco-dock__tab.is-active").first().innerText({ timeout: 8000 });

async function openContext(page, locator) {
  await locator.first().scrollIntoViewIfNeeded();
  await locator.first().click({ button: "right" });
  await menu(page).waitFor({ timeout: 8000 });
  return menu(page).innerText();
}

async function openFirstContextMatching(page, candidates, expected) {
  const count = await candidates.count();
  for (let index = 0; index < count; index += 1) {
    await page.keyboard.press("Escape");
    const candidate = candidates.nth(index);
    if (!(await candidate.isVisible())) continue;
    await candidate.scrollIntoViewIfNeeded();
    await candidate.click({ button: "right" });
    try {
      await menu(page).waitFor({ timeout: 800 });
    } catch {
      continue;
    }
    const text = await menu(page).innerText();
    if (expected.test(text)) return text;
  }
  throw new Error(`Could not find organizer context menu matching ${expected}`);
}

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
page.on("pageerror", (error) => console.log("PAGEERROR:", error.message));
page.setDefaultTimeout(10000);

try {
  await page.goto(URL, { waitUntil: "networkidle" });
  await importL5XText(page, FIXTURE, "organizer-context.L5X");
  await dismissToasts(page);

  const controllerRoot = page.locator('.esco-tree__node--controller:has-text("OrgCtx")');
  const controllerMenu = await openContext(page, controllerRoot);
  check(
    "controller root context menu exposes real controller commands",
    /Controller Properties/.test(controllerMenu) &&
      /New Tag/.test(controllerMenu) &&
      /Verify Controller/.test(controllerMenu) &&
      /Go Online/.test(controllerMenu) &&
      /Upload/.test(controllerMenu) &&
      /Download/.test(controllerMenu) &&
      /Set Path/.test(controllerMenu),
    controllerMenu,
  );

  await menuItem(page, "Verify Controller").click();
  await page.locator(".esco-build__output").waitFor({ timeout: 8000 });
  const verifyTab = (await activeDockTab(page)).trim();
  const verifyLog = await page.locator(".esco-build__output").innerText();
  check("Verify Controller from the tree focuses Build output", /Build/i.test(verifyTab), verifyTab);
  check("Verify Controller from the tree writes an output log", /Verifying controller 'OrgCtx'|Complete -/.test(verifyLog), verifyLog);
  await dismissToasts(page);

  await openContext(page, page.locator('.esco-left :text("Controller Tags")'));
  await menuItem(page, "Monitor Tags").click();
  await page.locator(".esco-watch").waitFor({ timeout: 8000 });
  check("Controller Tags > Monitor Tags opens the Watch dock", /Watch/i.test((await activeDockTab(page)).trim()));
  await dismissToasts(page);

  await openContext(page, page.locator('.esco-left :text("Parameters and Local Tags")'));
  await menuItem(page, "New Tag").click();
  const newTagDialog = page.locator('.esco-modal__panel[aria-label="New Tag"]').first();
  await newTagDialog.waitFor({ timeout: 8000 });
  const scopeField = newTagDialog.locator("label.esco-field").filter({ hasText: /^Scope/ }).first();
  const programField = newTagDialog.locator("label.esco-field").filter({ hasText: /^Program/ }).first();
  const scopeValue = await scopeField.locator("select").inputValue();
  const programText = await programField.locator("select option:checked").innerText();
  check("Program Tags > New Tag opens scoped to the owning program", scopeValue === "program" && /MainProgram/.test(programText), `${scopeValue} / ${programText}`);
  await newTagDialog.locator('.esco-btn:has-text("Cancel")').click();
  await newTagDialog.waitFor({ state: "detached", timeout: 8000 });

  await openContext(page, controllerRoot);
  await menuItem(page, "New Program").click();
  const newProgramDialog = page.locator('.esco-modal__panel[aria-label="New Program"]').first();
  await newProgramDialog.waitFor({ timeout: 8000 });
  await newProgramDialog.locator("label.esco-field").filter({ hasText: /^Name/ }).locator("input").fill("SpareProgram");
  await newProgramDialog.locator('button[role="tab"]:has-text("Configuration")').click();
  const scheduleCheckbox = newProgramDialog.locator('label:has-text("Schedule Program") input[type="checkbox"]').first();
  if (await scheduleCheckbox.isChecked()) await scheduleCheckbox.uncheck();
  await newProgramDialog.locator('.esco-btn--primary:has-text("OK")').click();
  await page.locator(".esco-toast__message").filter({ hasText: 'Program "SpareProgram" created' }).waitFor({ timeout: 8000 });
  await dismissToasts(page);

  const taskNode = page.locator('.esco-tree__node--task:has-text("MainTask")');
  const taskMenu = await openContext(page, taskNode);
  check(
    "task context menu exposes scheduling actions",
    /Add > New Program/.test(taskMenu) && /Add > Existing Program/.test(taskMenu) && /Inhibit Task/.test(taskMenu),
    taskMenu,
  );
  await menuItem(page, "Add > Existing Program").click();
  const addExistingDialog = page.locator('.esco-modal__panel[aria-label="Add Existing Program"]').first();
  await addExistingDialog.waitFor({ timeout: 8000 });
  check(
    "Add > Existing Program opens the scheduling dialog",
    /SpareProgram/.test(await addExistingDialog.innerText()),
    await addExistingDialog.innerText(),
  );
  await addExistingDialog.locator("select").selectOption({ label: "SpareProgram" });
  await addExistingDialog.locator('.esco-btn--primary:has-text("Add")').click();
  await page.locator('.esco-toast__message:has-text("Scheduled existing program SpareProgram in MainTask")').waitFor({ timeout: 8000 });
  await page.locator('.esco-detail__title:has-text("Task · MainTask")').waitFor({ timeout: 8000 });
  const taskDetailAfterSchedule = await page.locator(".esco-detail").innerText();
  check(
    "Add > Existing Program schedules the selected program in the task",
    /scheduled programs \(\d+\)/i.test(taskDetailAfterSchedule) && /SpareProgram/.test(taskDetailAfterSchedule),
    taskDetailAfterSchedule,
  );
  await dismissToasts(page);
  await openContext(page, taskNode);
  await menuItem(page, "Inhibit Task").click();
  await dismissToasts(page);
  const inhibitedMenu = await openContext(page, taskNode);
  check("Inhibit Task updates task state and menu label", /Uninhibit Task/.test(inhibitedMenu), inhibitedMenu);
  await page.keyboard.press("Escape");

  const trendsRootCandidates = page.locator(".esco-left .esco-tree__group").filter({ hasText: /\bTrends\b/ });
  const trendsMenu = await openFirstContextMatching(page, trendsRootCandidates, /New Trend/);
  check("Trends context menu exposes create/import/export actions", /New Trend/.test(trendsMenu) && /Export Trends/.test(trendsMenu), trendsMenu);
  await menuItem(page, "New Trend").click();
  const createdTrendNode = page.locator('.esco-tree__node--trend:has-text("Trend_1")');
  await createdTrendNode.waitFor({ timeout: 8000 });
  await page.locator('.esco-toast__message:has-text("Created controller trend Trend_1")').waitFor({ timeout: 8000 });
  check("Trends > New Trend creates an offline controller trend", await createdTrendNode.isVisible());
  await dismissToasts(page);

  const trendMenu = await openContext(page, createdTrendNode);
  check("Trend context menu exposes properties, export, and delete", /Trend Properties/.test(trendMenu) && /Export Trend/.test(trendMenu) && /Delete/.test(trendMenu), trendMenu);
  await menuItem(page, "Delete").click();
  await acceptConfirmation(page);
  await page.locator('.esco-toast__message:has-text("Deleted trend Trend_1")').waitFor({ timeout: 8000 });
  await createdTrendNode.waitFor({ state: "detached", timeout: 8000 });
  check("Trend > Delete removes only the local trend metadata", (await createdTrendNode.count()) === 0);
  await dismissToasts(page);

  const programNode = page.locator('.esco-tree__node:has-text("MainProgram")').first();
  const programMenu = await openContext(page, programNode);
  check(
    "program context menu exposes local tags, routine, verify, and export actions",
    /New Tag \/ Parameters and Local Tags/.test(programMenu) &&
      /Add > New Routine/.test(programMenu) &&
      /Verify Program/.test(programMenu) &&
      /Export Program/.test(programMenu),
    programMenu,
  );
  await menuItem(page, "Verify Program").click();
  await page.locator(".esco-dock__tab.is-active").waitFor({ timeout: 8000 });
  check("Verify Program from the tree focuses the Build dock", /Build/i.test((await activeDockTab(page)).trim()));
  await dismissToasts(page);

  const ioMenu = await openContext(page, page.locator('.esco-tree__group--button:has-text("I/O Configuration")'));
  check("I/O Configuration context menu exposes New Module and Properties", /New Module/.test(ioMenu) && /Properties/.test(ioMenu), ioMenu);
  await menuItem(page, "Properties").click();
  await page.locator('.esco-detail [aria-label="I/O configuration overview"]').waitFor({ timeout: 8000 });
  check("I/O Configuration > Properties opens the clean I/O detail view", (await page.locator('.esco-detail [aria-label="I/O configuration overview"]').count()) === 1);

  const moduleNode = page.locator('.esco-tree__node--module:has-text("Slot 1: 1756-IB16")');
  const moduleMenu = await openContext(page, moduleNode);
  check(
    "module context menu exposes properties, diagnostics, change, inhibit, and delete",
    /Properties/.test(moduleMenu) &&
      /Diagnostics \/ Fault Info/.test(moduleMenu) &&
      /Change Module/.test(moduleMenu) &&
      /Inhibit Module/.test(moduleMenu) &&
      /Delete/.test(moduleMenu),
    moduleMenu,
  );
  await menuItem(page, "Diagnostics / Fault Info").click();
  await page.locator(".esco-diagnostics").waitFor({ timeout: 8000 });
  check("Module Diagnostics / Fault Info opens the Errors/Diagnostics dock", /Errors/i.test((await activeDockTab(page)).trim()));

  const inhibitPage = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  inhibitPage.on("pageerror", (error) => console.log("PAGEERROR:", error.message));
  inhibitPage.setDefaultTimeout(10000);
  await inhibitPage.goto(URL, { waitUntil: "networkidle" });
  await importL5XText(inhibitPage, FIXTURE, "organizer-context-inhibit.L5X");
  await dismissToasts(inhibitPage);
  const inhibitModuleNode = inhibitPage.locator('.esco-tree__node--module:has-text("Slot 1: 1756-IB16")');
  await openContext(inhibitPage, inhibitModuleNode);
  await menuItem(inhibitPage, "Inhibit Module").click();
  await inhibitPage.locator('.esco-toast__message:has-text("DI_01 inhibited")').waitFor({ timeout: 8000 });
  check("Module > Inhibit Module fires the real module inhibit handler", true);
  await inhibitPage.close();

  const passed = results.filter(Boolean).length;
  console.log(`\nSUMMARY: ${passed}/${results.length} checks passed`);
  process.exitCode = passed === results.length ? 0 : 1;
} catch (error) {
  check("organizer context driver completed without throwing", false, error?.message ?? String(error));
  process.exitCode = 1;
} finally {
  await browser.close();
}
