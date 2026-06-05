import { chromium } from "playwright-core";
import { createBlankProject, URL } from "./helpers.mjs";

const results = [];
const check = (label, cond, detail = "") => {
  results.push(!!cond);
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${detail ? "  - " + String(detail).replace(/\s+/g, " ").slice(0, 120) : ""}`);
};
const txt = async (page, selector) =>
  (await page.locator(selector).first().innerText({ timeout: 5000 })).replace(/\s+/g, " ").trim();

const openMenuCommand = async (page, menu, command) => {
  await page.locator(`.esco-ribbon__tab:has-text("${menu}")`).click();
  await page.locator(`.esco-ribbon-menu__item:has-text("${command}")`).click();
};

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
page.setDefaultTimeout(10000);
page.on("pageerror", (error) => console.log("PAGEERROR:", error.message));

try {
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.locator(".esco-titlebar").waitFor();

  const defaultTitle = await txt(page, ".esco-titlebar");
  const defaultRibbon = await txt(page, ".esco-ribbon");
  const defaultOrganizer = await txt(page, ".esco-left");
  const defaultStatus = await txt(page, ".esco-statusbar");
  const defaultMetrics = await page.evaluate(() => {
    const sample = (selector) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const bounds = element.getBoundingClientRect();
      const styles = getComputedStyle(element);
      return {
        width: Math.round(bounds.width),
        height: Math.round(bounds.height),
        backgroundColor: styles.backgroundColor,
        borderRadius: styles.borderRadius,
        fontSize: styles.fontSize,
      };
    };
    return {
      titlebar: sample(".esco-titlebar"),
      ribbon: sample(".esco-ribbon"),
      left: sample(".esco-left"),
      statusbar: sample(".esco-statusbar"),
      tabstrip: sample(".esco-titlebar__tabstrip"),
      caption: sample(".esco-titlebar__caption"),
      editorSurfaceCount: document.querySelectorAll(".esco-editor__surface").length,
      welcomeCount: document.querySelectorAll(".esco-welcome").length,
      menus: Array.from(document.querySelectorAll(".esco-ribbon__tab")).map((node) => node.textContent?.trim()).join("|"),
      shellTabs: Array.from(document.querySelectorAll(".esco-shell-tab")).map((node) => node.textContent?.trim()).join("|"),
    };
  });

  check("default shell opens as ESCO Automation Studio", /ESCO Automation Studio/.test(defaultTitle) && !/Untitled Project/.test(defaultTitle), defaultTitle);
  check(
    "default shell has ESCO-style top document tabs",
    defaultMetrics.titlebar?.height === 67 &&
      defaultMetrics.tabstrip?.height === 43 &&
      defaultMetrics.caption?.height === 24 &&
      defaultMetrics.shellTabs === "Home|ESCO Automation Studio",
    JSON.stringify(defaultMetrics),
  );
  check("default shell exposes ESCO menu row", defaultMetrics.menus === "File|Edit|View|Search|Logic|Communications|Tools|Window|Help", defaultMetrics.menus);
  check(
    "default shell exposes standard, online, path, and instruction toolbars",
    (await page.locator('.esco-ribbon__toolbar-row--standard .esco-ribbon__rail-label:has-text("Standard toolbar")').count()) === 1 &&
      (await page.locator('.esco-ribbon__toolbar-row--standard .esco-ribbon__rail-label:has-text("Online toolbar")').count()) === 1 &&
      (await page.locator('.esco-ribbon__path-row .esco-ribbon__rail-label:has-text("Communication Path bar")').count()) === 1 &&
      (await page.locator('.esco-ribbon__toolbar-row--instruction .esco-ribbon__rail-label:has-text("Instruction toolbar")').count()) === 1 &&
      /RUN\s*PROG\s*REM/.test(defaultRibbon) &&
      /Path:\s*(?:<none>|No hardware path selected)/.test(defaultRibbon) &&
      /Offline\s*No Forces\s*No Edits/.test(defaultRibbon) &&
      /Favorites/.test(defaultRibbon) &&
      (await page.locator(".esco-ribbon__category-option").count()) === 30,
    defaultRibbon,
  );
  check("default shell shows empty Controller Organizer", /No controllers added/.test(defaultOrganizer) && /No I\/O configured/.test(defaultOrganizer), defaultOrganizer);
  check("default shell status bar is offline and segmented", /(?:Offline Simulation|No Project)/.test(defaultStatus) && /Controller Mode: --/.test(defaultStatus) && defaultMetrics.statusbar?.height === 22, defaultStatus);
  check("default shell keeps the blank editor workspace", defaultMetrics.editorSurfaceCount === 0 && defaultMetrics.welcomeCount === 1, JSON.stringify(defaultMetrics));

  await createBlankProject(page);
  const projectTitle = await txt(page, ".esco-titlebar");
  const projectOrganizer = await txt(page, ".esco-left");
  const blankRungChrome = await page.evaluate(() => {
    const diagram = document.querySelector(".esco-lad__diagram--blank");
    const rungHead = document.querySelector(".esco-lad__rung:has(.esco-lad__diagram--blank) .esco-lad__rung-head");
    const header = document.querySelector(".esco-left .esco-panel__header");
    return {
      redLine: diagram ? getComputedStyle(diagram, "::before").borderTopColor : "",
      redIcon: rungHead ? getComputedStyle(rungHead, "::after").backgroundColor : "",
      endLabel: rungHead ? getComputedStyle(rungHead, "::before").content : "",
      organizerHeaderImage: header ? getComputedStyle(header).backgroundImage : "",
    };
  });
  check("New Project opens a Studio-style controller tree", /Untitled Project/.test(projectTitle) && /Controller_1/.test(projectOrganizer) && /MainTask/.test(projectOrganizer), projectTitle);
  check("New Project opens starter ladder routine", (await page.locator(".esco-editor__surface").count()) === 1 && (await page.locator(".esco-lad__rung").count()) === 1);
  check("New Project exposes ESCO I/O configuration nodes", /I\/O Configuration/.test(projectOrganizer) && /1756 Backplane/.test(projectOrganizer) && /Slot 0/.test(projectOrganizer), projectOrganizer);
  check(
    "New Project skeleton uses yellow organizer header and red active blank rung",
    /linear-gradient/.test(blankRungChrome.organizerHeaderImage) &&
      blankRungChrome.organizerHeaderImage.includes("255, 234, 112") &&
      blankRungChrome.redLine === "rgb(255, 0, 0)" &&
      blankRungChrome.redIcon === "rgb(255, 0, 0)" &&
      blankRungChrome.endLabel === "\"(End)\"",
    JSON.stringify(blankRungChrome),
  );

  await openMenuCommand(page, "File", "Project Properties");
  await page.locator(".esco-project-props").waitFor();
  await page.locator(".esco-project-props input").first().fill("Line 1 Project");
  await page.locator(".esco-project-props textarea").fill("Created by the project properties dialog.");
  await page.locator('.esco-project-props button:has-text("Apply")').click();
  await page.waitForFunction(() => document.querySelector(".esco-titlebar")?.textContent?.includes("Line 1 Project"));
  check("Project Properties rename updates the active project", /Line 1 Project/.test(await txt(page, ".esco-titlebar")));

  const passed = results.filter(Boolean).length;
  console.log(`\nSUMMARY: ${passed}/${results.length} checks passed`);
  process.exitCode = passed === results.length ? 0 : 1;
} catch (error) {
  console.log("ERROR:", error.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
