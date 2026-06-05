import { chromium } from "playwright-core";
import { URL, dismissToasts, importStarterProject } from "./helpers.mjs";

const results = [];
const check = (label, cond, detail = "") => {
  results.push(!!cond);
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${detail ? "  - " + String(detail).replace(/\s+/g, " ").slice(0, 100) : ""}`);
};
const menu = (page, name) => page.locator(`.esco-ribbon__tab:has-text("${name}")`).first();
const menuItem = (page, label) => page.locator(`.esco-ribbon-menu__item:has-text("${label}")`).first();
const button = (page, label) => page.locator(`.esco-ribbon__button[aria-label="${label}"]`).first();
const activeDockTab = (page, label) => page.locator(`.esco-dock__tab.is-active:has-text("${label}")`).first();
const activeMenuText = async (page) => (await page.locator(".esco-ribbon__tab.is-open").first().innerText()).trim();

const openMenu = async (page, name) => {
  await menu(page, name).click();
  await page.locator(".esco-ribbon-menu").waitFor({ timeout: 5000 });
};

const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
const page = await context.newPage();
page.on("pageerror", (error) => console.log("PAGEERROR:", error.message));

try {
  await page.goto(URL, { waitUntil: "networkidle" });
  await importStarterProject(page);

  const menus = await page.locator(".esco-ribbon__tab").evaluateAll((nodes) => nodes.map((node) => node.textContent?.trim()).join("|"));
  const toolbarText = await page.locator(".esco-ribbon").innerText();
  check("classic ribbon exposes reference menu row", menus === "File|Edit|View|Search|Logic|Communications|Tools|Window|Help", menus);
  check(
    "classic toolbar exposes standard, online, path, and instruction rows",
    (await page.locator('.esco-ribbon__toolbar-row--standard .esco-ribbon__rail-label:has-text("Standard toolbar")').count()) === 1 &&
      (await page.locator('.esco-ribbon__toolbar-row--standard .esco-ribbon__rail-label:has-text("Online toolbar")').count()) === 1 &&
      (await page.locator('.esco-ribbon__path-row .esco-ribbon__rail-label:has-text("Communication Path bar")').count()) === 1 &&
      (await page.locator('.esco-ribbon__toolbar-row--instruction .esco-ribbon__rail-label:has-text("Instruction toolbar")').count()) === 1 &&
      /Path:\s*(?:<none>|No hardware path selected)/.test(toolbarText) &&
      /Offline\s*No Forces\s*No Edits/.test(toolbarText) &&
      /Favorites/.test(toolbarText) &&
      (await page.locator(".esco-ribbon__category-option").count()) === 30,
    toolbarText,
  );
  check("standard toolbar exposes common command buttons", (await button(page, "Save As").count()) === 1 && (await button(page, "Find").count()) === 1 && (await button(page, "Close").count()) === 1);
  const classicToolbarMetrics = await page.evaluate(() => {
    const combo = document.querySelector(".esco-ribbon__standard-combo")?.getBoundingClientRect();
    const flags = Array.from(document.querySelectorAll(".esco-ribbon__controller-flags span")).map((node) => {
      const bounds = node.getBoundingClientRect();
      const styles = getComputedStyle(node);
      return {
        text: node.textContent?.trim(),
        height: Math.round(bounds.height),
        display: styles.display,
      };
    });
    return {
      combo: combo ? { width: Math.round(combo.width), height: Math.round(combo.height) } : null,
      utilityCount: document.querySelectorAll(".esco-ribbon__utility-btn").length,
      utilityLabels: Array.from(document.querySelectorAll(".esco-ribbon__utility-btn")).map((node) => node.getAttribute("aria-label")),
      flags,
    };
  });
  check(
    "standard toolbar matches classic combo/status details",
    classicToolbarMetrics.combo?.width === 178 &&
      classicToolbarMetrics.combo?.height === 22 &&
      classicToolbarMetrics.utilityCount === 5 &&
      classicToolbarMetrics.utilityLabels.includes("Simulation lab") &&
      classicToolbarMetrics.flags.length === 4 &&
      classicToolbarMetrics.flags.every((flag) => flag.height === 8 && flag.display === "grid"),
    JSON.stringify(classicToolbarMetrics),
  );
  check(
    "title bar exposes routed status command chips",
    (await page.locator('.esco-titlebar__command-chip:has-text("Offline Simulation")').count()) === 1 &&
      (await page.locator('.esco-titlebar__command-chip:has-text("Verification Passed")').count()) === 1 &&
      (await page.locator(".esco-titlebar__user-chip").count()) === 1,
  );
  await page.locator('.esco-titlebar__command-chip:has-text("Offline Simulation")').click();
  await activeDockTab(page, "Controller").waitFor({ timeout: 5000 });
  check("title bar connection chip opens controller dock", (await activeDockTab(page, "Controller").count()) === 1);
  await page.locator('.esco-titlebar__command-chip:has-text("Verification Passed")').click();
  await activeDockTab(page, "Errors").waitFor({ timeout: 5000 });
  check("title bar verification chip opens diagnostics dock", (await activeDockTab(page, "Errors").count()) === 1);

  await page.keyboard.press("Control+F");
  await activeDockTab(page, "Search Results").waitFor({ timeout: 5000 });
  check("Ctrl+F opens Search Results outside the routine editor", (await activeDockTab(page, "Search Results").count()) === 1);

  await page.locator('.esco-ribbon__mode-pills [aria-label="Request Program Mode"]').click();
  await activeDockTab(page, "Controller").waitFor({ timeout: 5000 });
  await page.locator(".esco-controller__audit tbody tr").first().waitFor({ timeout: 5000 });
  check(
    "controller mode pill records guarded Program Mode audit",
    /Blocked Program Mode/.test(await page.locator(".esco-controller__audit").innerText()),
  );
  await page.locator('.esco-ribbon__path-value[aria-label="Select controller communication path"]').click();
  await page.waitForFunction(() => /Blocked Select Recent Path/.test(document.querySelector(".esco-controller__audit")?.textContent ?? ""));
  check(
    "communication path field records guarded path-selection audit",
    /Blocked Select Recent Path/.test(await page.locator(".esco-controller__audit").innerText()),
  );
  const beforeBatteryAuditRows = await page.locator(".esco-controller__audit tbody tr").count();
  await page.locator('.esco-ribbon__controller-flags [aria-label="Battery diagnostics"]').click();
  await activeDockTab(page, "Controller").waitFor({ timeout: 5000 });
  await page.waitForFunction(
    (count) => document.querySelectorAll(".esco-controller__audit tbody tr").length > count,
    beforeBatteryAuditRows,
  );
  const batteryAuditText = await page.locator(".esco-controller__audit").innerText();
  check(
    "BAT indicator records guarded controller fault diagnostics",
    /Blocked Go To Faults/.test(batteryAuditText) && /verified ESCO controller transport/i.test(batteryAuditText),
    batteryAuditText,
  );
  await page.locator('.esco-ribbon__edit-state [aria-label="Open forces monitor"]').click();
  await activeDockTab(page, "Forces").waitFor({ timeout: 5000 });
  check("ribbon forces indicator opens Forces dock", (await activeDockTab(page, "Forces").count()) === 1);
  await page.locator('.esco-ribbon__edit-state [aria-label="Open online edit state"]').click();
  await activeDockTab(page, "Controller").waitFor({ timeout: 5000 });
  await page.locator('.esco-toast:has-text("No pending test edits")').waitFor({ timeout: 5000 });
  check(
    "No Edits indicator opens Controller dock and reports explicit clean edit state",
    (await activeDockTab(page, "Controller").count()) === 1 &&
      (await page.locator('.esco-toast:has-text("No pending test edits")').count()) === 1,
  );
  await dismissToasts(page);
  await page.locator('.esco-statusbar__connection').click();
  await activeDockTab(page, "Controller").waitFor({ timeout: 5000 });
  check("status bar connection segment opens controller dock", (await activeDockTab(page, "Controller").count()) === 1);
  await page.locator('.esco-statusbar__verify').click();
  await activeDockTab(page, "Errors").waitFor({ timeout: 5000 });
  check("status bar verification segment opens diagnostics dock", (await activeDockTab(page, "Errors").count()) === 1);
  await page.locator('.esco-statusbar__path').click();
  await activeDockTab(page, "Controller").waitFor({ timeout: 5000 });
  await page.waitForFunction(() => /Blocked Select Recent Path/.test(document.querySelector(".esco-controller__audit")?.textContent ?? ""));
  check("status bar path segment records guarded path-selection audit", /Blocked Select Recent Path/.test(await page.locator(".esco-controller__audit").innerText()));

  await openMenu(page, "File");
  check("File menu opens as active Windows menu", /File/.test(await activeMenuText(page)));
  check("File menu exposes project and controller properties", (await menuItem(page, "Project Properties").count()) === 1 && (await menuItem(page, "Controller Properties").count()) === 1);
  const fileMenuText = await page.locator(".esco-ribbon-menu").innerText();
  check(
    "File menu exposes ESCO SoftController software runtime actions",
    /Download Runtime to ESCO SoftController/.test(fileMenuText) && /Open ESCO SoftController Upload/.test(fileMenuText),
    fileMenuText,
  );

  await openMenu(page, "Edit");
  check("Edit menu activates", /Edit/.test(await activeMenuText(page)));
  const editMenuText = await page.locator(".esco-ribbon-menu").innerText();
  check("Edit menu exposes clipboard/search commands", /Undo/.test(editMenuText) && /Copy/.test(editMenuText) && /Paste/.test(editMenuText) && /Find/.test(editMenuText), editMenuText);

  await openMenu(page, "Search");
  check("Search menu activates", /Search/.test(await activeMenuText(page)));
  const searchMenuText = await page.locator(".esco-ribbon-menu").innerText();
  check("Search menu exposes find and cross-reference commands", /Find/.test(searchMenuText) && /Cross Reference/.test(searchMenuText), searchMenuText);

  await openMenu(page, "File");
  check("File menu remains active for project metadata", /File/.test(await activeMenuText(page)));
  await menuItem(page, "Project Properties").click();
  await page.locator(".esco-project-props").waitFor({ timeout: 5000 });
  const projectPropsText = await page.locator(".esco-project-props").innerText();
  const projectNameValue = await page.locator(".esco-project-props input").first().inputValue();
  check("Project Properties opens project metadata modal", /Project Properties/.test(projectPropsText) && projectNameValue === "E2E_Starter", projectPropsText);
  await page.locator('.esco-project-props button[aria-label="Close project properties"]').click();
  await page.locator(".esco-project-props").waitFor({ state: "detached", timeout: 5000 });

  await openMenu(page, "File");
  await menuItem(page, "Controller Properties").click();
  await page.locator(".esco-controller-props").waitFor({ timeout: 5000 });
  check("Controller Properties opens Studio property sheet", /Controller Properties/.test(await page.locator(".esco-controller-props").innerText()));
  await page.locator('.esco-controller-props .esco-icon-btn[aria-label="Close Controller Properties"]').click();
  await page.locator(".esco-controller-props").waitFor({ state: "detached", timeout: 5000 });

  await page.locator('.esco-tree__node--routine:has-text("MainRoutine")').click();
  await page.locator(".esco-lad__rung").first().waitFor({ timeout: 5000 });
  const startRungs = await page.locator(".esco-lad__rung").count();
  await openMenu(page, "Logic");
  check("Logic menu activates", /Logic/.test(await activeMenuText(page)));
  await menuItem(page, "Add Rung").click();
  await page.waitForFunction((count) => document.querySelectorAll(".esco-lad__rung").length === count + 1, startRungs);
  check("Logic > Add Rung works", (await page.locator(".esco-lad__rung").count()) === startRungs + 1);
  await button(page, "XIC").click();
  check("instruction toolbar button adds an instruction", (await page.locator(".esco-lad__rung.is-selected .esco-lad__operand").count()) >= 1);
  await page.locator(".esco-ribbon__category-trigger").click();
  await page.locator('.esco-ribbon__category-option:has-text("Timer/Counter")').click();
  const timerStripText = await page.locator(".esco-ribbon__button-strip--instructions").innerText();
  check(
    "instruction group picker swaps the visible toolbar buttons",
    /TON/.test(timerStripText) && /TOF/.test(timerStripText) && /RES/.test(timerStripText) && !/XIC/.test(timerStripText),
    timerStripText,
  );
  const beforeTimerInstructionCount = await page.locator(".esco-lad__rung.is-selected .esco-lad__box").count();
  await button(page, "TOF").click();
  await page.waitForFunction(
    (count) => document.querySelectorAll(".esco-lad__rung.is-selected .esco-lad__box").length > count,
    beforeTimerInstructionCount,
  );
  check("Timer/Counter toolbar button inserts through the ladder action layer", (await page.locator('.esco-lad__rung.is-selected .esco-lad__box:has-text("TOF")').count()) >= 1);

  await openMenu(page, "Communications");
  check("Communications menu activates", /Communications/.test(await activeMenuText(page)));
  check("online toolbar actions open guarded controller workflow", !(await button(page, "Go Online").isDisabled()) && !(await button(page, "Download").isDisabled()));
  const commsText = await page.locator(".esco-ribbon-menu").innerText();
  check(
    "Communications menu exposes mode/fault/path guarded commands",
    /Select Recent Path/.test(commsText) &&
      /Monitor/.test(commsText) &&
      /Run Mode/.test(commsText) &&
      /Program Mode/.test(commsText) &&
      /Clear Faults/.test(commsText) &&
      /Go To Faults/.test(commsText),
    commsText,
  );
  check(
    "Communications menu exposes explicit ESCO virtual/software actions beside guarded hardware",
    /Select Virtual Path/.test(commsText) &&
      /Go Online \(Virtual\)/.test(commsText) &&
      /Download to ESCO Virtual Controller/.test(commsText) &&
      /Upload from ESCO Virtual Controller/.test(commsText) &&
      /Run Mode \(Virtual\)/.test(commsText) &&
      /Clear Faults \(Virtual\)/.test(commsText),
    commsText,
  );
  await menuItem(page, "Select Virtual Path").click();
  await activeDockTab(page, "Controller").waitFor({ timeout: 5000 });
  await page.locator(".esco-vctrl__paths .esco-vctrl__pathpick").first().click();
  await page.locator('.esco-toast:has-text("Virtual path selected")').waitFor({ timeout: 5000 });
  await openMenu(page, "Communications");
  await menuItem(page, "Download to ESCO Virtual Controller").click();
  await page.locator('.esco-toast:has-text("Downloaded")').waitFor({ timeout: 5000 });
  await openMenu(page, "Communications");
  await menuItem(page, "Go Online (Virtual)").click();
  await page.locator('.esco-toast:has-text("Online (Virtual)")').waitFor({ timeout: 5000 });
  await openMenu(page, "Communications");
  await menuItem(page, "Monitor (Virtual)").click();
  await page.locator('.esco-toast:has-text("Monitoring (Virtual)")').waitFor({ timeout: 5000 });
  await openMenu(page, "Communications");
  await menuItem(page, "Run Mode (Virtual)").click();
  await page.locator('.esco-toast:has-text("destructive edits are guarded")').waitFor({ timeout: 5000 });
  await openMenu(page, "Communications");
  await menuItem(page, "Clear Faults (Virtual)").click();
  await page.locator(".esco-vctrl").waitFor({ timeout: 5000 });
  const virtualText = await page.locator(".esco-vctrl").innerText();
  check(
    "virtual/software controller actions from Communications update the ESCO Virtual Controller panel",
    /ESCO Virtual Controller/.test(virtualText) && /RUN|run/i.test(virtualText) && /Downloaded|download/i.test(virtualText),
    virtualText,
  );
  await openMenu(page, "Communications");
  const onlineEditMenu = await page.locator(".esco-ribbon-menu__item").evaluateAll((nodes) =>
    nodes
      .filter((node) => /Test Edits|Assemble Edits|Finalize All Edits|Cancel Edits/.test(node.textContent ?? ""))
      .map((node) => ({
        text: node.textContent?.trim().replace(/\s+\((Unsupported|Future|Virtual)\)/, ""),
        disabled: node.disabled,
      })),
  );
  check(
    "Communications menu exposes guarded online-edit workflow commands",
    onlineEditMenu.map((item) => item.text).join("|") === "Test Edits|Assemble Edits|Finalize All Edits|Cancel Edits" &&
      onlineEditMenu.every((item) => !item.disabled),
    JSON.stringify(onlineEditMenu),
  );
  await menuItem(page, "Go Online").click();
  await page.locator(".esco-controller").waitFor({ timeout: 5000 });
  check("Go Online opens the guarded controller dock", /no tested controller transport/i.test(await page.locator(".esco-controller").innerText()));
  await page.locator(".esco-controller__audit tbody tr").first().waitFor({ timeout: 5000 });
  const onlineAuditText = await page.locator(".esco-controller__audit").innerText();
  check(
    "Go Online records guarded lifecycle and command audit rows",
    /go-online/.test(onlineAuditText) && /command-blocked/.test(onlineAuditText) && /Go Online/.test(onlineAuditText),
    onlineAuditText,
  );
  for (const label of ["Test Edits", "Assemble Edits", "Finalize All Edits", "Cancel Edits"]) {
    const beforeEditAuditRows = await page.locator(".esco-controller__audit tbody tr").count();
    await openMenu(page, "Communications");
    await menuItem(page, label).click();
    await page.locator(`.esco-toast:has-text("${label} is blocked")`).waitFor({ timeout: 5000 });
    await page.waitForFunction(
      (count) => document.querySelectorAll(".esco-controller__audit tbody tr").length > count,
      beforeEditAuditRows,
    );
  }
  const editAuditText = await page.locator(".esco-controller__audit").innerText();
  check(
    "online edit commands record distinct blocked audit rows",
    /Blocked Test Edits/.test(editAuditText) &&
      /Blocked Assemble Edits/.test(editAuditText) &&
      /Blocked Finalize All Edits/.test(editAuditText) &&
      /Blocked Cancel Edits/.test(editAuditText),
    editAuditText,
  );
  await openMenu(page, "Communications");
  await page.locator(".esco-ribbon-menu__item").filter({ hasText: /^Go Offline$/ }).first().click();
  await page.locator('.esco-toast:has-text("Offline Simulation is active.")').waitFor({ timeout: 5000 });
  check("Go Offline reports offline simulation", /Offline Simulation/.test(await page.locator('.esco-toast:has-text("Offline Simulation is active.")').innerText()));
  await dismissToasts(page);

  await page.locator('.esco-left button[aria-label="Close Controller Organizer"]').click();
  await page.waitForFunction(() => /Controller Organizer is hidden/.test(document.querySelector(".esco-left")?.textContent ?? ""));
  await openMenu(page, "View");
  check("View menu utility items are live", !(await menuItem(page, "Controller Organizer").isDisabled()) && (await menuItem(page, "Task Monitor").count()) === 1 && (await menuItem(page, "Trend").count()) === 1);
  await menuItem(page, "Controller Organizer").click();
  await page.locator('.esco-toast:has-text("Controller Organizer restored.")').waitFor({ timeout: 5000 });
  await page.waitForFunction(() => !/Controller Organizer is hidden/.test(document.querySelector(".esco-left")?.textContent ?? ""));
  check(
    "View > Controller Organizer restores the left project tree when hidden",
    (await page.locator('.esco-left .esco-tree__node--controller, .esco-left .esco-tree__group--button').count()) > 0,
  );
  await dismissToasts(page);
  await openMenu(page, "View");
  await menuItem(page, "Task Monitor").click();
  await activeDockTab(page, "Task Monitor").waitFor({ timeout: 5000 });
  check("View > Task Monitor routes to task monitor dock", (await activeDockTab(page, "Task Monitor").count()) === 1);
  await openMenu(page, "View");
  await menuItem(page, "Trend").click();
  await activeDockTab(page, "Trend").waitFor({ timeout: 5000 });
  check("View > Trend routes to trend dock", (await activeDockTab(page, "Trend").count()) === 1);

  await openMenu(page, "View");
  await menuItem(page, "Project History").click();
  await page.locator(".esco-vcs").waitFor({ timeout: 5000 });
  check("View > Project History routes the center workspace away from the editor", (await page.locator(".esco-vcs").count()) === 1);

  await openMenu(page, "Window");
  check("Window menu exposes live dock/window routes", !(await menuItem(page, "Main Window").isDisabled()) && (await menuItem(page, "Controller Status").count()) === 1 && (await menuItem(page, "Forces").count()) === 1);
  await menuItem(page, "Main Window").click();
  await page.locator('.esco-toast:has-text("Main routine window focused.")').waitFor({ timeout: 5000 });
  await page.locator(".esco-editor").waitFor({ timeout: 5000 });
  await page.waitForFunction(() => document.querySelectorAll(".esco-vcs").length === 0);
  check(
    "Window > Main Window restores the active routine editor instead of only showing a toast",
    (await page.locator(".esco-editor").count()) === 1 &&
      (await page.locator(".esco-vcs").count()) === 0 &&
      (await page.locator('.esco-toast:has-text("Main routine window focused.")').count()) === 1,
  );
  await dismissToasts(page);

  await openMenu(page, "Tools");
  const toolsText = await page.locator(".esco-ribbon-menu").innerText();
  check(
    "Tools menu exposes tag import/export plus diagnostics/task/trend routes",
    /Cross Reference/.test(toolsText) &&
      /Export Tags/.test(toolsText) &&
      /Import Tags/.test(toolsText) &&
      /Diagnostics/.test(toolsText) &&
      /Task Monitor/.test(toolsText) &&
      /Trend/.test(toolsText),
    toolsText,
  );

  const passed = results.filter(Boolean).length;
  console.log(`\nSUMMARY: ${passed}/${results.length} checks passed`);
  process.exitCode = passed === results.length ? 0 : 1;
} catch (error) {
  console.log("ERROR:", error.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
