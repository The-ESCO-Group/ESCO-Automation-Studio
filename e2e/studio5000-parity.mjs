import { chromium } from "playwright-core";
import { clickFileMenuItem, createBlankProject, dismissToasts, URL } from "./helpers.mjs";

const results = [];
const check = (label, cond, detail = "") => {
  results.push(!!cond);
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${detail ? "  - " + String(detail).replace(/\s+/g, " ").slice(0, 140) : ""}`);
};

const activeDockTab = (page, label) => page.locator(`.esco-dock__tab.is-active:has-text("${label}")`).first();
const ribbonButton = (page, label) => page.locator(`.esco-ribbon__button[aria-label="${label}"]`).first();

const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, acceptDownloads: true });
const page = await context.newPage();
page.on("pageerror", (error) => console.log("PAGEERROR:", error.message));

try {
  await page.goto(URL, { waitUntil: "networkidle" });
  await createBlankProject(page);

  const menus = await page.locator(".esco-ribbon__tab").evaluateAll((nodes) =>
    nodes.map((node) => node.textContent?.trim()).join("|"),
  );
  const ribbonText = await page.locator(".esco-ribbon").innerText();
  check("Studio 5000-style menu row is complete", menus === "File|Edit|View|Search|Logic|Communications|Tools|Window|Help", menus);
  check(
    "offline cockpit exposes standard, online, path, and instruction rails",
    (await page.locator('.esco-ribbon__rail-label:has-text("Standard toolbar")').count()) === 1 &&
      (await page.locator('.esco-ribbon__rail-label:has-text("Online toolbar")').count()) === 1 &&
      (await page.locator('.esco-ribbon__rail-label:has-text("Communication Path bar")').count()) === 1 &&
      (await page.locator('.esco-ribbon__rail-label:has-text("Instruction toolbar")').count()) === 1 &&
      /Offline\s*No Forces\s*No Edits/.test(ribbonText),
    ribbonText,
  );
  check(
    "real-controller transfer buttons remain guarded",
    (await ribbonButton(page, "Download").isDisabled()) &&
      !(await ribbonButton(page, "Go Online").isDisabled()) &&
      /No hardware path selected|Offline/.test(ribbonText),
    ribbonText,
  );

  await page.locator('.esco-ribbon__tab:has-text("File")').click();
  await page.locator('.esco-ribbon-menu[aria-label="File menu"]').waitFor({ timeout: 5000 });
  const fileRows = await page
    .locator(
      '.esco-ribbon-menu[aria-label="File menu"] > .esco-ribbon-menu__item:visible, .esco-ribbon-menu[aria-label="File menu"] > .esco-ribbon-menu__submenu > .esco-ribbon-menu__submenu-trigger:visible',
    )
    .evaluateAll((nodes) => nodes.map((node) => node.textContent?.trim().replace(/\s+/g, " ")));
  check(
    "File menu keeps compact top-level nested groups",
    fileRows.length <= 8 &&
      fileRows.includes("Import / Export>") &&
      fileRows.includes("Runtime / SoftController>") &&
      fileRows.includes("Properties>") &&
      !fileRows.some((row) => /Cloud Projects|Download Runtime/.test(row)),
    fileRows.join("|"),
  );
  await page.locator(".esco-ribbon-menu__submenu-trigger:visible").filter({ hasText: "Import / Export" }).first().hover();
  const interchangeText = await page.locator('.esco-ribbon-menu--nested[aria-label="Import / Export submenu"]').innerText();
  check("Import / Export submenu contains cloud, L5X, receipt, snapshot, and package paths", /Cloud Projects/.test(interchangeText) && /Import L5X/.test(interchangeText) && /Export L5X/.test(interchangeText) && /L5X Handoff Receipt/.test(interchangeText) && /Export ESCO Package/.test(interchangeText), interchangeText);

  const organizerText = await page.locator(".esco-left").innerText();
  check(
    "Controller Organizer covers controller, tasks, programs, routines, tags, AOIs, data types, and I/O",
    /Controller_1/.test(organizerText) &&
      /Controller Tags/.test(organizerText) &&
      /MainTask/.test(organizerText) &&
      /MainProgram/.test(organizerText) &&
      /MainRoutine/.test(organizerText) &&
      /Add-On Instructions/.test(organizerText) &&
      /Data Types/.test(organizerText) &&
      /I\/O Configuration/.test(organizerText) &&
      /Slot 0/.test(organizerText),
    organizerText,
  );

  await clickFileMenuItem(page, "Controller Properties");
  await page.locator(".esco-controller-props").waitFor({ timeout: 5000 });
  const controllerPropsText = await page.locator(".esco-controller-props").innerText();
  check(
    "Controller Properties exposes Studio-style review tabs",
    /General/.test(controllerPropsText) &&
      /Date\/Time/.test(controllerPropsText) &&
      /Redundancy/.test(controllerPropsText) &&
      /Port Configuration/.test(controllerPropsText) &&
      /Security/.test(controllerPropsText) &&
      /Alarm Log/.test(controllerPropsText),
    controllerPropsText,
  );
  await page.locator('.esco-controller-props .esco-icon-btn[aria-label="Close Controller Properties"]').click();
  await page.locator(".esco-controller-props").waitFor({ state: "detached", timeout: 5000 });

  await page.locator(".esco-lad__rung").first().click();
  const boxesBefore = await page.locator(".esco-lad__rung.is-selected .esco-lad__box").count();
  await page.keyboard.press("Alt+Insert");
  await page.locator(".esco-instr-picker").waitFor({ timeout: 8000 });
  await page.locator(".esco-instr-picker__input").fill("Timer On Delay");
  const tonItem = page.locator(".esco-instr-picker__item", { has: page.locator('.esco-instr-picker__mnemonic:text-is("TON")') }).first();
  await tonItem.click();
  await page.locator('.esco-instr-picker .esco-btn--primary:has-text("Insert")').click();
  await page.locator(".esco-instr-picker").waitFor({ state: "detached", timeout: 8000 });
  await page.waitForFunction((count) => document.querySelectorAll(".esco-lad__rung.is-selected .esco-lad__box").length > count, boxesBefore);
  check("Instruction search inserts a TON through the offline action layer", (await page.locator('.esco-lad__rung.is-selected .esco-lad__box:has-text("TON")').count()) === 1);

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    clickFileMenuItem(page, "Export L5X"),
  ]);
  check("nested File > Export L5X completes as review-only L5X", /\.L5X$/i.test(download.suggestedFilename()), download.suggestedFilename());

  await page.locator('.esco-ribbon__mode-pills [aria-label="Request Run Mode"]').click();
  await activeDockTab(page, "Controller").waitFor({ timeout: 5000 });
  await page.locator(".esco-controller__audit tbody tr").first().waitFor({ timeout: 5000 });
  const auditText = await page.locator(".esco-controller__audit").innerText();
  check("Run Mode request is visibly blocked instead of faked online", /Blocked Run Mode/.test(auditText), auditText);

  await page.locator('.esco-ribbon__edit-state [aria-label="Open forces monitor"]').click();
  await activeDockTab(page, "Forces").waitFor({ timeout: 5000 });
  check("Forces UI is reviewable without physical force operations", (await activeDockTab(page, "Forces").count()) === 1);
  await dismissToasts(page);

  const passed = results.filter(Boolean).length;
  console.log(`\nSUMMARY: ${passed}/${results.length} checks passed`);
  process.exitCode = passed === results.length ? 0 : 1;
} catch (error) {
  console.log("ERROR:", error.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
