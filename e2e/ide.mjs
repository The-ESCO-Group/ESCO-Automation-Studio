// Current IDE shell smoke: ESCO-branded classic chrome, organizer, ladder canvas,
// core edit commands, dock panels, and close-to-empty behavior. Honors E2E_URL.
import { chromium } from "playwright-core";
import { importL5XText, openWatchPanel } from "./helpers.mjs";

const URL = process.env.E2E_URL || "http://localhost:5173/";
const results = [];
const check = (label, cond, detail = "") => {
  results.push(!!cond);
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${detail ? "  - " + String(detail).replace(/\s+/g, " ").slice(0, 120) : ""}`);
};
const txt = async (page, selector) => {
  try {
    return (await page.locator(selector).first().innerText({ timeout: 5000 })).replace(/\s+/g, " ").trim();
  } catch {
    return "";
  }
};
const cnt = async (page, selector) => {
  try {
    return await page.locator(selector).count();
  } catch {
    return -1;
  }
};
const ribbonButton = (page, label) => page.locator(`.esco-ribbon__button[aria-label="${label}"]`).first();
const menuCommand = async (page, menu, label) => {
  await page.locator(`.esco-ribbon__tab:has-text("${menu}")`).click();
  await page.locator(`.esco-ribbon-menu__item:has-text("${label}")`).click();
};

const L5X = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0" TargetName="AuditCtrl" ContentType="Controller">
  <Controller Use="Target" Name="AuditCtrl" ProcessorType="1756-L71">
    <Tags>
      <Tag Name="StartPB" TagType="Base" DataType="BOOL"/>
      <Tag Name="StopPB" TagType="Base" DataType="BOOL"/>
      <Tag Name="MotorRun" TagType="Base" DataType="BOOL"/>
      <Tag Name="Timer1" TagType="Base" DataType="TIMER"/>
    </Tags>
    <Programs>
      <Program Name="MainProgram" TestEdits="true" MainRoutineName="MainRoutine">
        <Routines>
          <Routine Name="MainRoutine" Type="RLL">
            <RLLContent>
              <Rung Number="0" Type="N"><Text><![CDATA[XIC(StartPB)XIO(StopPB)OTE(MotorRun);]]></Text></Rung>
              <Rung Number="1" Type="N"><Text><![CDATA[[XIC(StartPB),XIC(MotorRun)]XIO(StopPB)OTE(MotorRun);]]></Text></Rung>
              <Rung Number="2" Type="N"><Text><![CDATA[XIC(StartPB)TON(Timer1,1000);]]></Text></Rung>
            </RLLContent>
          </Routine>
        </Routines>
      </Program>
    </Programs>
    <Tasks><Task Name="MainTask" Type="CONTINUOUS"><ScheduledPrograms><ScheduledProgram Name="MainProgram"/></ScheduledPrograms></Task></Tasks>
  </Controller>
</RSLogix5000Content>`;

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
page.setDefaultTimeout(10000);
page.on("pageerror", (error) => console.log("PAGEERROR:", error.message));
page.on("dialog", (dialog) => dialog.accept().catch(() => undefined));

try {
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.locator(".esco-titlebar").waitFor();

  const shellChrome = await page.evaluate(() => {
    const sample = (selector) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const bounds = element.getBoundingClientRect();
      const styles = getComputedStyle(element);
      return {
        width: Math.round(bounds.width),
        height: Math.round(bounds.height),
        backgroundColor: styles.backgroundColor,
      };
    };
    return {
      titlebar: sample(".esco-titlebar"),
      tabstrip: sample(".esco-titlebar__tabstrip"),
      caption: sample(".esco-titlebar__caption"),
      tabTexts: Array.from(document.querySelectorAll(".esco-shell-tab")).map((node) => node.textContent?.trim()).join("|"),
    };
  });
  check(
    "top chrome matches ESCO document-tab skeleton",
    shellChrome.titlebar?.height === 67 &&
      shellChrome.tabstrip?.height === 43 &&
      shellChrome.caption?.height === 24 &&
      shellChrome.tabTexts === "Home|ESCO Automation Studio",
    JSON.stringify(shellChrome),
  );

  const menus = await page.locator(".esco-ribbon__tab").evaluateAll((nodes) => nodes.map((node) => node.textContent?.trim()));
  check("menu row matches ESCO shell", menus.join("|") === "File|Edit|View|Search|Logic|Communications|Tools|Window|Help", menus.join("|"));
  const titlebarControls = await page.locator(".esco-window-control").evaluateAll((nodes) =>
    nodes.map((node) => {
      const bounds = node.getBoundingClientRect();
      const styles = getComputedStyle(node);
      return {
        width: Math.round(bounds.width),
        height: Math.round(bounds.height),
        borderRadius: styles.borderRadius,
      };
    }),
  );
  check(
    "IDE titlebar keeps native Windows caption button proportions",
    titlebarControls.length === 3 &&
      titlebarControls.every((control) => control.width === 46 && control.height === 24 && control.borderRadius === "0px"),
    JSON.stringify(titlebarControls),
  );
  check("standard toolbar row is visible", (await cnt(page, '.esco-ribbon__toolbar-row--standard .esco-ribbon__rail-label:has-text("Standard toolbar")')) === 1);
  const toolbarRailLabels = await page.locator(".esco-ribbon__rail-label").evaluateAll((nodes) =>
    nodes.map((node) => {
      const bounds = node.getBoundingClientRect();
      const styles = getComputedStyle(node);
      return {
        text: node.textContent?.trim(),
        width: Math.round(bounds.width),
        height: Math.round(bounds.height),
        display: styles.display,
      };
    }),
  );
  check(
    "toolbar rail labels are visibly painted like the reference skeleton",
    ["Standard toolbar", "Online toolbar", "Communication Path bar", "Instruction toolbar"].every((label) =>
      toolbarRailLabels.some(
        (row) => row.text === label && row.width > 0 && row.height >= 20 && (row.display === "flex" || row.display === "inline-flex"),
      ),
    ),
    JSON.stringify(toolbarRailLabels),
  );
  const standardToolbarChrome = await page.evaluate(() => {
    const sample = (selector) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const bounds = element.getBoundingClientRect();
      const styles = getComputedStyle(element);
      return {
        width: Math.round(bounds.width),
        height: Math.round(bounds.height),
        backgroundColor: styles.backgroundColor,
        borderColor: styles.borderColor,
      };
    };
    return {
      row: sample(".esco-ribbon__toolbar-row--standard"),
      combo: sample(".esco-ribbon__standard-combo"),
      utilities: Array.from(document.querySelectorAll(".esco-ribbon__utility-btn")).map((node) => {
        const bounds = node.getBoundingClientRect();
        return {
          label: node.getAttribute("aria-label"),
          width: Math.round(bounds.width),
          height: Math.round(bounds.height),
          disabled: node.disabled,
        };
      }),
    };
  });
  check(
    "standard toolbar includes classic combo well and utility glyphs",
    standardToolbarChrome.row?.height === 31 &&
      standardToolbarChrome.combo?.width === 178 &&
      standardToolbarChrome.combo?.height === 22 &&
      standardToolbarChrome.combo?.backgroundColor === "rgb(255, 255, 255)" &&
      standardToolbarChrome.utilities.length === 5 &&
      standardToolbarChrome.utilities.some((button) => button.label === "Simulation lab") &&
      standardToolbarChrome.utilities.every((button) => button.width === 23 && button.height === 23),
    JSON.stringify(standardToolbarChrome),
  );
  const skeletonPathText = await txt(page, ".esco-ribbon__path-row");
  check(
    "communication path/status row matches ESCO offline skeleton",
    /Path:\s*(?:<none>|No hardware path selected)/.test(skeletonPathText) && /Offline\s*No Forces\s*No Edits/.test(skeletonPathText),
    skeletonPathText,
  );
  const flagChrome = await page.locator(".esco-ribbon__controller-flags span").evaluateAll((nodes) =>
    nodes.map((node) => {
      const bounds = node.getBoundingClientRect();
      const styles = getComputedStyle(node);
      return {
        text: node.textContent?.trim(),
        width: Math.round(bounds.width),
        height: Math.round(bounds.height),
        display: styles.display,
        lineHeight: styles.lineHeight,
      };
    }),
  );
  check(
    "controller health flags render as four legible rows",
    flagChrome.length === 4 &&
      flagChrome.map((row) => row.text).join("|") === "RUN|OK|BAT|I/O" &&
      flagChrome.every((row) => row.height === 8 && row.display === "grid" && row.lineHeight === "8px"),
    JSON.stringify(flagChrome),
  );
  check(
    "instruction toolbar has ladder instructions and a searchable category picker",
    (await cnt(page, ".esco-ribbon__button--ladder")) >= 11 &&
      (await cnt(page, ".esco-ribbon__category-option")) === 30 &&
      /Favorites/.test(await txt(page, ".esco-ribbon__category-trigger")),
  );
  const modeDots = await page.locator(".esco-ribbon__mode-pills span").evaluateAll((nodes) =>
    nodes.map((node) => ({
      text: node.textContent?.trim() ?? "",
      dot: getComputedStyle(node, "::before").backgroundColor,
    })),
  );
  check(
    "mode selector uses ESCO RUN green, PROG blue, REM gray dots",
    JSON.stringify(modeDots) ===
      JSON.stringify([
        { text: "RUN", dot: "rgb(26, 173, 72)" },
        { text: "PROG", dot: "rgb(47, 124, 197)" },
        { text: "REM", dot: "rgb(142, 142, 142)" },
      ]),
    JSON.stringify(modeDots),
  );
  check("empty organizer is honest", /No controllers added/.test(await txt(page, ".esco-left")));

  await importL5XText(page, L5X, "audit.L5X");
  await page.locator('.esco-titlebar__name:has-text("AuditCtrl")').waitFor();
  await page.locator('.esco-tree__node--routine:has-text("MainRoutine")').click();
  await page.waitForFunction(() => document.querySelectorAll(".esco-lad__rung").length === 3);

  const organizerText = await txt(page, ".esco-left");
  check("organizer shows imported controller structure", /AuditCtrl/.test(organizerText) && /MainTask/.test(organizerText) && /MainProgram/.test(organizerText) && /MainRoutine/.test(organizerText));
  const importedPathText = await txt(page, ".esco-ribbon__path-row");
  const editStateChrome = await page.evaluate(() => {
    const spans = Array.from(document.querySelectorAll(".esco-ribbon__edit-state span"));
    return spans.map((node) => ({
      text: node.textContent?.trim(),
      className: node.className,
      backgroundColor: getComputedStyle(node).backgroundColor,
      fontWeight: getComputedStyle(node).fontWeight,
    }));
  });
  const programEditMarker = await page.locator('.esco-tree__node:has-text("MainProgram") .esco-tree__edit-marker').first().evaluate((node) => {
    const bounds = node.getBoundingClientRect();
    const styles = getComputedStyle(node);
    return {
      text: node.textContent?.trim(),
      width: Math.round(bounds.width),
      height: Math.round(bounds.height),
      fontStyle: styles.fontStyle,
      fontWeight: styles.fontWeight,
    };
  }).catch(() => null);
  check(
    "path bar surfaces imported pending test edits",
    /Offline\s*No Forces\s*Test Edits/.test(importedPathText) &&
      editStateChrome.some((span) => span.text === "Test Edits" && span.className === "is-warning" && span.backgroundColor === "rgb(255, 232, 117)") &&
      programEditMarker?.text === "e" &&
      programEditMarker?.fontStyle === "italic",
    JSON.stringify({ importedPathText, editStateChrome, programEditMarker }),
  );
  const toastChrome = await page.locator(".esco-toast").first().evaluate((node) => {
    const bounds = node.getBoundingClientRect();
    const styles = getComputedStyle(node);
    return {
      width: Math.round(bounds.width),
      height: Math.round(bounds.height),
      left: Math.round(bounds.left),
      borderRadius: styles.borderRadius,
      backgroundColor: styles.backgroundColor,
      whiteSpace: getComputedStyle(node.querySelector(".esco-toast__message") ?? node).whiteSpace,
    };
  }).catch(() => null);
  check(
    "import notification uses compact classic message strip",
    toastChrome &&
      toastChrome.left === 334 &&
      toastChrome.width <= 720 &&
      toastChrome.height <= 25 &&
      toastChrome.borderRadius === "0px" &&
      toastChrome.backgroundColor === "rgb(247, 247, 247)" &&
      toastChrome.whiteSpace === "nowrap",
    JSON.stringify(toastChrome),
  );
  check(
    "organizer shows Studio-like persistent project containers",
    /Unscheduled/.test(organizerText) &&
      /Motion Groups/.test(organizerText) &&
      /Ungrouped Axes/.test(organizerText) &&
      /Assets/.test(organizerText) &&
      /Add-On Instructions/.test(organizerText) &&
      /Data Types/.test(organizerText) &&
      /User-Defined/.test(organizerText) &&
      /Strings/.test(organizerText) &&
      /Add-On-Defined/.test(organizerText) &&
      /Predefined/.test(organizerText) &&
      /Module-Defined/.test(organizerText) &&
      /Trends/.test(organizerText) &&
      /Logical Model/.test(organizerText),
    organizerText,
  );
  check("organizer derives a Slot 0 processor row when imported modules omit it", /Slot 0: 1756-L71 Processor/.test(organizerText), organizerText);
  const organizerChrome = await page.evaluate(() => {
    const sample = (target, pseudo) => {
      const element = typeof target === "string" ? document.querySelector(target) : target;
      if (!element) return null;
      const bounds = element.getBoundingClientRect();
      const styles = getComputedStyle(element, pseudo);
      return {
        width: Math.round(bounds.width),
        height: Math.round(bounds.height),
        cssWidth: styles.width,
        backgroundColor: styles.backgroundColor,
        backgroundImage: styles.backgroundImage,
        borderLeftStyle: styles.borderLeftStyle,
        borderLeftColor: styles.borderLeftColor,
        borderTopStyle: styles.borderTopStyle,
        color: styles.color,
        display: styles.display,
        fontSize: styles.fontSize,
        gap: styles.gap,
        outline: styles.outline,
        whiteSpace: styles.whiteSpace,
      };
    };
    const longOrganizerLabel = Array.from(
      document.querySelectorAll(".esco-left .esco-tree__group, .esco-left .esco-tree__node, .esco-left .esco-tree__leaf"),
    ).find((node) => /Parameters and Local Tags/.test(node.textContent ?? ""));
    return {
      header: sample(".esco-left .esco-panel__header"),
      selected: sample(".esco-left .esco-tree__node.is-selected"),
      selectedIcon: sample(".esco-left .esco-tree__node.is-selected .esco-tree__icon"),
      selectedIconBefore: sample(".esco-left .esco-tree__node.is-selected .esco-tree__icon", "::before"),
      nested: sample(".esco-left .esco-tree--nested"),
      branchStub: sample(".esco-left .esco-tree--nested > li", "::before"),
      backplane: sample(".esco-left .esco-tree__group--backplane"),
      longLabel: sample(longOrganizerLabel),
      headerActions: Array.from(document.querySelectorAll(".esco-left .esco-panel__actions button")).map((node) => {
        const bounds = node.getBoundingClientRect();
        return {
          label: node.getAttribute("aria-label") || node.getAttribute("title"),
          width: Math.round(bounds.width),
          height: Math.round(bounds.height),
        };
      }),
      splitter: sample(".esco-body", "::after"),
    };
  });
  check(
    "organizer header keeps ESCO gradient strip",
    organizerChrome.header?.height === 26 &&
      /linear-gradient/.test(organizerChrome.header?.backgroundImage ?? "") &&
      organizerChrome.header?.fontSize === "12px",
    JSON.stringify(organizerChrome.header),
  );
  check(
    "organizer header exposes classic drop pin close controls",
    organizerChrome.headerActions.length === 3 &&
      organizerChrome.headerActions.map((action) => action.label).join("|") ===
        "Controller Organizer menu|Pin Controller Organizer|Close Controller Organizer" &&
      organizerChrome.headerActions.every((action) => action.width === 18 && action.height === 18) &&
      organizerChrome.splitter?.cssWidth === "4px" &&
      /radial-gradient/.test(organizerChrome.splitter?.backgroundImage ?? ""),
    JSON.stringify({ actions: organizerChrome.headerActions, splitter: organizerChrome.splitter }),
  );
  await page.locator(".esco-left .esco-panel__drop-btn").click();
  const organizerMenuText = await txt(page, ".esco-context-menu--inline");
  check(
    "organizer header menu has real view and panel commands",
    /Controller Tree/.test(organizerMenuText) &&
      /HMI Project/.test(organizerMenuText) &&
      /Pin Organizer/.test(organizerMenuText) &&
      /Hide Organizer/.test(organizerMenuText) &&
      /Reset Organizer View/.test(organizerMenuText),
    organizerMenuText,
  );
  await page.locator('.esco-context-menu--inline .esco-context-menu__item:has-text("Pin Organizer")').click();
  const pinnedAfterMenuToggle = await page.locator('.esco-left .esco-panel__actions button[aria-label="Pin Controller Organizer"]').getAttribute("aria-pressed");
  check("organizer menu toggles pinned state", pinnedAfterMenuToggle === "false", pinnedAfterMenuToggle ?? "missing");
  await page.locator('.esco-left .esco-panel__actions button[aria-label="Pin Controller Organizer"]').click();
  const pinnedAfterHeaderToggle = await page.locator('.esco-left .esco-panel__actions button[aria-label="Pin Controller Organizer"]').getAttribute("aria-pressed");
  check("organizer pin control restores pinned state", pinnedAfterHeaderToggle === "true", pinnedAfterHeaderToggle ?? "missing");
  await page.locator('.esco-left .esco-panel__actions button[aria-label="Close Controller Organizer"]').click();
  check("organizer close control hides tree without losing restore", /Controller Organizer is hidden/.test(await txt(page, ".esco-left")));
  await page.locator('.esco-left button:has-text("Show Controller Organizer")').click();
  check("organizer restore control brings tree back", /MainRoutine/.test(await txt(page, ".esco-left")));
  check(
    "organizer tree uses dense gray shrink-wrap selection",
    organizerChrome.selected?.height === 18 &&
      organizerChrome.selected?.width < 120 &&
      organizerChrome.selected?.backgroundColor === "rgb(214, 214, 214)" &&
      /dotted 1px/.test(organizerChrome.selected?.outline ?? ""),
    JSON.stringify(organizerChrome.selected),
  );
  check(
    "organizer tree keeps classic dotted guides and small icons",
    organizerChrome.nested?.borderLeftStyle === "dotted" &&
      organizerChrome.branchStub?.borderTopStyle === "dotted" &&
      organizerChrome.selectedIcon?.width === 16 &&
      organizerChrome.selectedIcon?.height === 16 &&
      organizerChrome.selectedIcon?.color === "rgb(17, 17, 17)" &&
      organizerChrome.selectedIconBefore?.borderLeftStyle === "solid",
    JSON.stringify(organizerChrome),
  );
  check(
    "organizer I/O rows stay compact in the ESCO shell",
    organizerChrome.backplane?.height === 18 && organizerChrome.backplane?.gap === "2px",
    JSON.stringify(organizerChrome.backplane),
  );
  check(
    "organizer keeps long project tree labels single-line",
    organizerChrome.longLabel?.height === 18 &&
      organizerChrome.longLabel?.whiteSpace === "nowrap" &&
      (organizerChrome.longLabel?.width ?? 0) > 120,
    JSON.stringify(organizerChrome.longLabel),
  );
  const routineTabChrome = await page.evaluate(() => {
    const strip = document.querySelector(".esco-editor__tabs");
    const active = document.querySelector(".esco-editor__tab.is-active");
    const icon = document.querySelector(".esco-editor__tab.is-active .esco-editor__tab-icon");
    const controls = Array.from(document.querySelectorAll(".esco-editor__tab-control")).map((node) => {
      const bounds = node.getBoundingClientRect();
      const styles = getComputedStyle(node);
      return {
        x: Math.round(bounds.x),
        width: Math.round(bounds.width),
        height: Math.round(bounds.height),
        backgroundImage: styles.backgroundImage,
        borderRightColor: styles.borderRightColor,
      };
    });
    const stripBounds = strip?.getBoundingClientRect();
    const activeBounds = active?.getBoundingClientRect();
    const iconBounds = icon?.getBoundingClientRect();
    const stripStyles = strip ? getComputedStyle(strip) : null;
    const activeStyles = active ? getComputedStyle(active) : null;
    const iconStyles = icon ? getComputedStyle(icon) : null;
    return {
      strip: stripBounds ? {
        x: Math.round(stripBounds.x),
        width: Math.round(stripBounds.width),
        height: Math.round(stripBounds.height),
        backgroundColor: stripStyles?.backgroundColor,
      } : null,
      active: activeBounds ? {
        width: Math.round(activeBounds.width),
        height: Math.round(activeBounds.height),
        backgroundColor: activeStyles?.backgroundColor,
      } : null,
      icon: iconBounds ? {
        width: Math.round(iconBounds.width),
        height: Math.round(iconBounds.height),
        borderColor: iconStyles?.borderTopColor,
      } : null,
      controls,
    };
  });
  check(
    "routine tab strip keeps dark MDI strip and right-side window controls",
    routineTabChrome.strip?.height === 28 &&
      routineTabChrome.strip?.backgroundColor === "rgb(36, 58, 87)" &&
      routineTabChrome.active?.height === 28 &&
      routineTabChrome.active?.backgroundColor === "rgb(255, 255, 255)" &&
      routineTabChrome.icon?.width === 14 &&
      routineTabChrome.icon?.height === 14 &&
      routineTabChrome.controls.length === 2 &&
      routineTabChrome.controls.every((control) => control.width === 22 && control.height === 27 && /linear-gradient/.test(control.backgroundImage)) &&
      routineTabChrome.controls[1]?.x + routineTabChrome.controls[1]?.width === (routineTabChrome.strip?.x ?? 0) + (routineTabChrome.strip?.width ?? 0),
    JSON.stringify(routineTabChrome),
  );
  const routineLocalToolbarChrome = await page.evaluate(() => {
    const toolbar = document.querySelector(".esco-editor__local-toolbar");
    const activeTab = document.querySelector(".esco-editor__tab.is-active");
    const sample = (element) => {
      if (!element) return null;
      const bounds = element.getBoundingClientRect();
      const styles = getComputedStyle(element);
      return {
        x: Math.round(bounds.x),
        y: Math.round(bounds.y),
        width: Math.round(bounds.width),
        height: Math.round(bounds.height),
        backgroundColor: styles.backgroundColor,
        borderBottomColor: styles.borderBottomColor,
      };
    };
    const buttons = Array.from(document.querySelectorAll(".esco-editor__local-toolbar button")).map((node) => ({
      label: node.getAttribute("aria-label"),
      width: Math.round(node.getBoundingClientRect().width),
      height: Math.round(node.getBoundingClientRect().height),
      disabled: node.disabled,
      backgroundColor: getComputedStyle(node).backgroundColor,
    }));
    return {
      toolbar: sample(toolbar),
      activeTab: sample(activeTab),
      groupCount: document.querySelectorAll(".esco-editor__tool-group").length,
      pressed: sample(document.querySelector(".esco-editor__tool-btn.is-pressed")),
      buttons,
    };
  });
  check(
    "routine local toolbar sits below active routine tab",
    routineLocalToolbarChrome.toolbar?.height === 27 &&
      routineLocalToolbarChrome.activeTab &&
      Math.abs(routineLocalToolbarChrome.toolbar.y - (routineLocalToolbarChrome.activeTab.y + routineLocalToolbarChrome.activeTab.height)) <= 1 &&
      routineLocalToolbarChrome.groupCount === 4 &&
      routineLocalToolbarChrome.buttons.length >= 12 &&
      routineLocalToolbarChrome.buttons.every((button) => button.width === 22 && button.height === 22) &&
      routineLocalToolbarChrome.buttons.some((button) => button.label === "Add rung" && !button.disabled) &&
      routineLocalToolbarChrome.buttons.some((button) => button.label === "Delete rung" && !button.disabled) &&
      routineLocalToolbarChrome.buttons.some((button) => button.disabled) &&
      routineLocalToolbarChrome.pressed?.backgroundColor === "rgb(255, 240, 166)",
    JSON.stringify(routineLocalToolbarChrome),
  );
  check(
    "status bar matches Studio-like offline simulation state",
    /Offline(?: Simulation)?/.test(await txt(page, ".esco-statusbar")) && /Controller Mode: Offline/.test(await txt(page, ".esco-statusbar")),
  );
  const statusChrome = await page.evaluate(() => {
    const bar = document.querySelector(".esco-statusbar");
    const sample = (element) => {
      if (!element) return null;
      const bounds = element.getBoundingClientRect();
      const styles = getComputedStyle(element);
      return {
        x: Math.round(bounds.x),
        width: Math.round(bounds.width),
        height: Math.round(bounds.height),
        backgroundColor: styles.backgroundColor,
        borderTopColor: styles.borderTopColor,
        borderTopStyle: styles.borderTopStyle,
        borderRightColor: styles.borderRightColor,
        borderRightStyle: styles.borderRightStyle,
        overflow: styles.overflow,
        whiteSpace: styles.whiteSpace,
      };
    };
    const items = Array.from(document.querySelectorAll(".esco-statusbar > span")).map((element) => ({
      text: element.textContent?.replace(/\s+/g, " ").trim() ?? "",
      ...sample(element),
    }));
    return { bar: sample(bar), items };
  });
  const controllerMode = statusChrome.items.find((item) => item.text.startsWith("Controller Mode"));
  const language = statusChrome.items.find((item) => item.text.startsWith("Language"));
  const pathSegment = statusChrome.items.find((item) => item.text.startsWith("Path:"));
  check(
    "status bar uses flat ESCO segment chrome",
    statusChrome.bar?.height === 22 &&
      statusChrome.bar?.backgroundColor === "rgb(238, 238, 238)" &&
      statusChrome.bar?.borderTopStyle === "solid" &&
      statusChrome.items[0]?.borderRightColor === "rgb(188, 188, 188)",
    JSON.stringify(statusChrome),
  );
  check(
    "status bar segment layout matches Studio footer grouping",
    controllerMode?.x >= 520 &&
      controllerMode?.width === 146 &&
      language?.width >= 180 &&
      pathSegment?.overflow === "hidden" &&
      statusChrome.items.every((item) => item.whiteSpace === "nowrap"),
    JSON.stringify(statusChrome.items),
  );
  check("ladder renders imported rungs", (await cnt(page, ".esco-lad__rung")) === 3);
  check("ladder canvas has left and right power rails", (await cnt(page, ".esco-lad__rail--left")) >= 3 && (await cnt(page, ".esco-lad__rail--right")) >= 3);
  const rungHeights = await page.locator(".esco-lad__rung").evaluateAll((nodes) =>
    nodes.map((node) => ({
      height: Math.round(node.getBoundingClientRect().height),
      hasParallel: !!node.querySelector(".esco-lad__parallel"),
    })),
  );
  check(
    "rung rows keep Studio baseline height and expand only for branch layout",
    rungHeights.every((row) => (row.hasParallel ? row.height >= 154 : row.height === 154)) &&
      rungHeights.some((row) => row.hasParallel && row.height > 154),
    JSON.stringify(rungHeights),
  );
  const ladderTypography = await page.evaluate(() => {
    const sample = (selector) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const styles = getComputedStyle(element);
      return {
        fontFamily: styles.fontFamily,
        fontSize: styles.fontSize,
        fontWeight: styles.fontWeight,
      };
    };
    return {
      rungNumber: sample(".esco-lad__rung-no"),
      mnemonic: sample(".esco-lad__mnemonic"),
      operand: sample(".esco-lad__operand"),
      box: sample(".esco-lad__box"),
      boxOperand: sample(".esco-lad__box .esco-lad__operand"),
    };
  });
  check(
    "ladder instructions use regular Studio-style text weight",
    ladderTypography.mnemonic?.fontWeight === "400" &&
      ladderTypography.operand?.fontWeight === "400" &&
      ladderTypography.box?.fontWeight === "400" &&
      ladderTypography.boxOperand?.fontWeight === "400" &&
      ladderTypography.rungNumber?.fontWeight === "700",
    JSON.stringify(ladderTypography),
  );

  const beforeAdd = await cnt(page, ".esco-lad__rung");
  await menuCommand(page, "Logic", "Add Rung");
  await page.waitForFunction((count) => document.querySelectorAll(".esco-lad__rung").length === count + 1, beforeAdd);
  check("Logic > Add Rung adds a ladder rung", (await cnt(page, ".esco-lad__rung")) === beforeAdd + 1);
  await ribbonButton(page, "XIC").click();
  check("instruction toolbar inserts an instruction into the selected rung", (await cnt(page, ".esco-lad__rung.is-selected .esco-lad__node")) >= 1);
  const selectedRungChrome = await page.locator(".esco-lad__rung.is-selected").first().evaluate((rung) => {
    const head = rung.querySelector(".esco-lad__rung-head");
    const rungNo = rung.querySelector(".esco-lad__rung-no");
    const diagram = rung.querySelector(".esco-lad__diagram:not(.esco-lad__diagram--blank)");
    const headStyles = head ? getComputedStyle(head) : null;
    const rungNoStyles = rungNo ? getComputedStyle(rungNo) : null;
    const diagramAfter = diagram ? getComputedStyle(diagram, "::after") : null;
    return {
      headBackgroundColor: headStyles?.backgroundColor,
      headBackgroundImage: headStyles?.backgroundImage,
      rungNoOutline: rungNoStyles?.outline,
      diagramAfterContent: diagramAfter?.content,
      diagramAfterBackground: diagramAfter?.backgroundColor,
      diagramAfterWidth: diagramAfter?.width,
      diagramAfterHeight: diagramAfter?.height,
    };
  });
  check(
    "selected rung uses thin Studio-style focus without a filled blue block",
    selectedRungChrome.headBackgroundColor === "rgba(0, 0, 0, 0)" &&
      selectedRungChrome.headBackgroundImage === "none" &&
      /dotted 1px/.test(selectedRungChrome.rungNoOutline ?? "") &&
      selectedRungChrome.diagramAfterContent === "none",
    JSON.stringify(selectedRungChrome),
  );
  await page.locator(".esco-lad__rung.is-selected .esco-lad__node").first().click();
  const selectedInstructionChrome = await page.locator(".esco-lad__node.is-selected").first().evaluate((node) => {
    const styles = getComputedStyle(node);
    return {
      backgroundColor: styles.backgroundColor,
      borderRadius: styles.borderRadius,
      outline: styles.outline,
      boxShadow: styles.boxShadow,
    };
  });
  check(
    "selected ladder instruction uses Studio-style dotted focus without fill",
    selectedInstructionChrome.backgroundColor === "rgb(255, 255, 255)" &&
      selectedInstructionChrome.borderRadius === "0px" &&
      /dotted 1px/.test(selectedInstructionChrome.outline) &&
      selectedInstructionChrome.boxShadow === "none",
    JSON.stringify(selectedInstructionChrome),
  );

  await page.locator(".esco-lad__rung").first().click();
  check("Copy is enabled after selecting a rung", !(await ribbonButton(page, "Copy").isDisabled()));
  await ribbonButton(page, "Copy").click();
  check("Paste is enabled after copy", !(await ribbonButton(page, "Paste").isDisabled()));

  await ribbonButton(page, "Find").click();
  await page.locator('.esco-search input[type="search"]').fill("MotorRun");
  await page.waitForTimeout(200);
  check("Find opens Search Results for ladder text", (await cnt(page, ".esco-search table tbody tr")) >= 1);
  const searchChrome = await page.evaluate(() => {
    const sample = (selector) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const bounds = element.getBoundingClientRect();
      const styles = getComputedStyle(element);
      return {
        height: Math.round(bounds.height),
        borderRadius: styles.borderRadius,
        backgroundColor: styles.backgroundColor,
        borderColor: styles.borderColor,
        display: styles.display,
      };
    };
    return {
      bar: sample(".esco-search__bar"),
      input: sample('.esco-search input[type="search"]'),
      button: sample(".esco-search .esco-btn"),
      tableHead: sample(".esco-search th"),
      tableCell: sample(".esco-search td"),
    };
  });
  check(
    "Search dock uses Studio-style square input toolbar",
    searchChrome.bar?.display === "grid" &&
      searchChrome.input?.height === 22 &&
      searchChrome.input?.borderRadius === "0px" &&
      searchChrome.button?.height === 23 &&
      searchChrome.button?.backgroundColor === "rgb(238, 238, 238)",
    JSON.stringify(searchChrome),
  );
  check(
    "Search results table uses gray Studio-style grid cells",
    searchChrome.tableHead?.backgroundColor === "rgb(233, 233, 233)" &&
      searchChrome.tableHead?.borderColor === "rgb(200, 200, 200)" &&
      searchChrome.tableCell?.borderColor === "rgb(200, 200, 200)",
    JSON.stringify(searchChrome),
  );

  await page.locator('.esco-dock__tab:has-text("Build")').click();
  await page.locator(".esco-build__table").waitFor();
  const buildText = await txt(page, ".esco-build");
  const buildChrome = await page.evaluate(() => {
    const sample = (selector) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const bounds = element.getBoundingClientRect();
      const styles = getComputedStyle(element);
      return {
        height: Math.round(bounds.height),
        borderRadius: styles.borderRadius,
        backgroundColor: styles.backgroundColor,
        borderColor: styles.borderColor,
        display: styles.display,
      };
    };
    return {
      bar: sample(".esco-build__bar"),
      button: sample(".esco-build__bar .esco-btn"),
      tableHead: sample(".esco-build__table th"),
      tableCell: sample(".esco-build__table td"),
    };
  });
  check(
    "Build dock renders classic verification output grid",
    /Offline build output/.test(buildText) &&
      /Project:?\s+AuditCtrl\s+Ready/.test(buildText) &&
      /Controller:?\s+AuditCtrl/.test(buildText) &&
      buildChrome.bar?.height === 33 &&
      buildChrome.button?.height === 23 &&
      buildChrome.button?.borderRadius === "0px" &&
      buildChrome.tableHead?.backgroundColor === "rgb(233, 233, 233)" &&
      buildChrome.tableCell?.borderColor === "rgb(200, 200, 200)",
    JSON.stringify({ buildText, buildChrome }),
  );

  await page.locator('.esco-lad__operand[title="StartPB"]').first().click({ button: "right" });
  await page.locator(".esco-context-menu").waitFor();
  await page.locator('.esco-context-menu__item:has-text("Cross Reference")').click();
  await page.locator('.esco-dock__tab.is-active:has-text("Cross Reference")').waitFor();
  await page.locator(".esco-xref__row").first().waitFor();
  const xrefChrome = await page.evaluate(() => {
    const sample = (selector) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const bounds = element.getBoundingClientRect();
      const styles = getComputedStyle(element);
      return {
        height: Math.round(bounds.height),
        borderRadius: styles.borderRadius,
        backgroundColor: styles.backgroundColor,
        borderColor: styles.borderColor,
        display: styles.display,
        fontWeight: styles.fontWeight,
        textTransform: styles.textTransform,
      };
    };
    return {
      head: sample(".esco-xref__head"),
      tableHead: sample(".esco-xref th"),
      tableCell: sample(".esco-xref td"),
      direction: sample(".esco-xref__dir"),
    };
  });
  check(
    "Cross Reference dock uses Studio-style table chrome",
    xrefChrome.head?.backgroundColor === "rgb(240, 240, 240)" &&
      xrefChrome.tableHead?.backgroundColor === "rgb(233, 233, 233)" &&
      xrefChrome.tableCell?.borderColor === "rgb(200, 200, 200)",
    JSON.stringify(xrefChrome),
  );
  check(
    "Cross Reference direction is plain grid text",
    xrefChrome.direction?.display === "table-cell" &&
      xrefChrome.direction?.borderRadius === "0px" &&
      xrefChrome.direction?.textTransform === "uppercase" &&
      xrefChrome.direction?.fontWeight === "400",
    JSON.stringify(xrefChrome.direction),
  );

  await openWatchPanel(page);
  check("Watch panel opens through current Studio-style chrome", /MotorRun/.test(await txt(page, ".esco-watch")));
  const watchChrome = await page.evaluate(() => {
    const sample = (selector) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const bounds = element.getBoundingClientRect();
      const styles = getComputedStyle(element);
      return {
        height: Math.round(bounds.height),
        borderRadius: styles.borderRadius,
        backgroundColor: styles.backgroundColor,
        borderColor: styles.borderColor,
      };
    };
    return {
      scanButton: sample(".esco-simbar .esco-btn--primary"),
      tableHead: sample(".esco-watch th"),
      tableCell: sample(".esco-watch td"),
    };
  });
  check(
    "Watch dock buttons use square Studio-style chrome",
    watchChrome.scanButton?.borderRadius === "0px" &&
      watchChrome.scanButton?.backgroundColor === "rgb(238, 238, 238)" &&
      watchChrome.scanButton?.height === 23,
    JSON.stringify(watchChrome.scanButton),
  );
  check(
    "Watch table uses gray Studio-style grid cells",
    watchChrome.tableHead?.backgroundColor === "rgb(233, 233, 233)" &&
      watchChrome.tableHead?.borderColor === "rgb(200, 200, 200)" &&
      watchChrome.tableCell?.borderColor === "rgb(200, 200, 200)",
    JSON.stringify(watchChrome),
  );
  await page.locator('.esco-watch tr:has-text("StartPB") button:has-text("Toggle")').click();
  await page.locator('button:has-text("Scan Once")').click();
  check("Scan Once updates imported ladder logic", /\btrue\b/.test(await txt(page, '.esco-watch tr:has-text("MotorRun")')));
  await page.locator('.esco-watch tr:has-text("MotorRun") button:has-text("Force")').click();
  const forcedPathText = await txt(page, ".esco-ribbon__path-row");
  check(
    "path bar surfaces active offline forces",
    /Offline\s*1 Force\s*Test Edits/.test(forcedPathText),
    forcedPathText,
  );

  await page.locator('.esco-dock__tab:has-text("Trend")').click();
  await page.locator('.esco-dock__tab.is-active:has-text("Trend")').waitFor();
  const trendChrome = await page.evaluate(() => {
    const sample = (selector) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const bounds = element.getBoundingClientRect();
      const styles = getComputedStyle(element);
      return {
        height: Math.round(bounds.height),
        borderRadius: styles.borderRadius,
        backgroundColor: styles.backgroundColor,
        borderBottomColor: styles.borderBottomColor,
      };
    };
    return {
      bar: sample(".esco-dockbar"),
      button: sample(".esco-dockbar .esco-btn"),
      tableHead: sample(".esco-trend .esco-watch th"),
    };
  });
  check(
    "Trend dock keeps flat Studio-style command strip",
    trendChrome.bar?.borderRadius === "0px" &&
      trendChrome.bar?.backgroundColor === "rgb(240, 240, 240)" &&
      trendChrome.bar?.borderBottomColor === "rgb(188, 188, 188)" &&
      trendChrome.button?.height === 23 &&
      trendChrome.button?.borderRadius === "0px",
    JSON.stringify(trendChrome),
  );

  await page.locator('.esco-dock__tab:has-text("Forces")').click();
  await page.locator('.esco-dock__tab.is-active:has-text("Forces")').waitFor();
  const forcesChrome = await page.evaluate(() => {
    const sample = (selector) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const styles = getComputedStyle(element);
      return {
        borderRadius: styles.borderRadius,
        backgroundColor: styles.backgroundColor,
        borderBottomColor: styles.borderBottomColor,
        color: styles.color,
      };
    };
    return {
      bar: sample(".esco-forces__bar"),
      note: sample(".esco-forces__note"),
      empty: sample(".esco-forces .esco-empty"),
    };
  });
  check(
    "Forces dock keeps flat Studio-style message strip",
    forcesChrome.bar?.borderRadius === "0px" &&
      forcesChrome.bar?.backgroundColor === "rgb(240, 240, 240)" &&
      forcesChrome.bar?.borderBottomColor === "rgb(188, 188, 188)" &&
      forcesChrome.note?.color === "rgb(17, 17, 17)",
    JSON.stringify(forcesChrome),
  );

  await menuCommand(page, "Help", "About ESCO Automation Studio");
  await page.locator(".esco-about").waitFor();
  const aboutText = await txt(page, ".esco-about");
  check(
    "Help > About opens the offline capability dialog",
    /About ESCO Automation Studio/.test(aboutText) &&
      /Version 0\.0\.1/.test(aboutText) &&
      /SAFETY/i.test(aboutText) &&
      (await cnt(page, ".esco-about__identity")) === 1,
    aboutText,
  );
  await page.locator('.esco-about .esco-btn--primary:has-text("Close")').click();
  await page.waitForFunction(() => document.querySelectorAll(".esco-about").length === 0);
  await menuCommand(page, "Help", "Help Contents");
  await page.locator(".esco-about").waitFor();
  check(
    "Help > Help Contents opens shortcuts, formats, and limitations reference",
    /Help Contents/.test(await txt(page, ".esco-modal__header h2")) &&
      /SHORTCUTS/i.test(await txt(page, ".esco-about")) &&
      /ESCO file formats/i.test(await txt(page, ".esco-about")) &&
      /\.easproj/.test(await txt(page, ".esco-about")) &&
      /\.easruntime/.test(await txt(page, ".esco-about")) &&
      /\.easpkg/.test(await txt(page, ".esco-about")) &&
      /Current limitations/i.test(await txt(page, ".esco-about")) &&
      (await cnt(page, ".esco-about__identity")) === 0,
  );
  await page.locator('.esco-about .esco-btn--primary:has-text("Close")').click();
  await page.waitForFunction(() => document.querySelectorAll(".esco-about").length === 0);

  await ribbonButton(page, "Close").click();
  const closeConfirmation = page.locator(".esco-confirmation");
  if (await closeConfirmation.waitFor({ timeout: 1000 }).then(() => true).catch(() => false)) {
    await closeConfirmation.locator(".esco-btn--primary").click();
  }
  await page.waitForFunction(() => /No controllers added/.test(document.body.innerText));
  check("Close returns to empty controller organizer", /No controllers added/.test(await txt(page, ".esco-left")));

  const passed = results.filter(Boolean).length;
  console.log(`\nSUMMARY: ${passed}/${results.length} checks passed`);
  process.exitCode = passed === results.length ? 0 : 1;
} catch (error) {
  console.log("ERROR:", error.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
