import { chromium } from "playwright-core";
import { URL, clickFileMenuItem, createBlankProject, dismissToasts, openDockPanel } from "./helpers.mjs";

const results = [];
const check = (label, cond, detail = "") => {
  results.push(!!cond);
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${detail ? "  - " + String(detail).replace(/\s+/g, " ").slice(0, 140) : ""}`);
};

const readScroll = (selector) =>
  document.querySelector(selector)
    ? {
        scrollTop: document.querySelector(selector).scrollTop,
        scrollLeft: document.querySelector(selector).scrollLeft,
        scrollHeight: document.querySelector(selector).scrollHeight,
        scrollWidth: document.querySelector(selector).scrollWidth,
        clientHeight: document.querySelector(selector).clientHeight,
        clientWidth: document.querySelector(selector).clientWidth,
        overflowX: getComputedStyle(document.querySelector(selector)).overflowX,
        overflowY: getComputedStyle(document.querySelector(selector)).overflowY,
      }
    : null;

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on("pageerror", (error) => console.log("PAGEERROR:", error.message));
await page.addInitScript(() => {
  localStorage.setItem(
    "esco.workbench.layout.v1",
    JSON.stringify({ dockTab: "watch", copilotTab: "model", rightPanelOpen: true }),
  );
});

try {
  await page.goto(URL, { waitUntil: "networkidle" });
  await createBlankProject(page);

  const rightPanelMetrics = await page.evaluate((read) => {
    const run = new Function(`return (${read})`)();
    const right = document.querySelector(".esco-right.is-open");
    const rightStyles = right ? getComputedStyle(right) : null;
    return {
      bodyClass: document.querySelector(".esco-body")?.className ?? "",
      right: right
        ? {
            display: rightStyles.display,
            scrollWidth: right.scrollWidth,
            clientWidth: right.clientWidth,
            scrollHeight: right.scrollHeight,
            clientHeight: right.clientHeight,
          }
        : null,
      content: run(".esco-right__content"),
      model: run(".esco-copilot__body > .esco-model"),
    };
  }, readScroll.toString());
  check(
    "right Copilot drawer restores open and visible",
    rightPanelMetrics.bodyClass.includes("is-right-open") &&
      rightPanelMetrics.right?.display === "flex" &&
      rightPanelMetrics.right.clientWidth > 0 &&
      rightPanelMetrics.right.clientHeight > 0,
    JSON.stringify(rightPanelMetrics.right),
  );
  check(
    "Copilot model panel owns vertical overflow",
    /auto|scroll/.test(rightPanelMetrics.model?.overflowY ?? "") &&
      rightPanelMetrics.model.scrollHeight > rightPanelMetrics.model.clientHeight,
    JSON.stringify(rightPanelMetrics.model),
  );
  await page.evaluate(() => {
    document.querySelector(".esco-copilot__body > .esco-model").scrollTop = 0;
  });
  const modelBox = await page.locator(".esco-copilot__body > .esco-model").boundingBox();
  await page.mouse.move(modelBox.x + modelBox.width / 2, modelBox.y + modelBox.height / 2);
  await page.mouse.wheel(0, 420);
  await page.waitForTimeout(40);
  const modelAfterWheel = await page.evaluate((read) => {
    const run = new Function(`return (${read})`)();
    return run(".esco-copilot__body > .esco-model");
  }, readScroll.toString());
  check("Copilot model wheel scrolls", modelAfterWheel.scrollTop > 0, JSON.stringify(modelAfterWheel));

  await page.locator('.esco-right .esco-copilot__tab:has-text("Help")').click();
  await page.locator(".esco-copilot__body > .esco-help").waitFor({ timeout: 5000 });
  const copilotHelpMetrics = await page.evaluate((read) => {
    const run = new Function(`return (${read})`)();
    return run(".esco-copilot__body > .esco-help");
  }, readScroll.toString());
  check(
    "Copilot help panel owns vertical overflow",
    /auto|scroll/.test(copilotHelpMetrics?.overflowY ?? "") &&
      copilotHelpMetrics.scrollHeight > copilotHelpMetrics.clientHeight,
    JSON.stringify(copilotHelpMetrics),
  );
  await page.evaluate(() => {
    document.querySelector(".esco-copilot__body > .esco-help").scrollTop = 0;
  });
  const helpBox = await page.locator(".esco-copilot__body > .esco-help").boundingBox();
  await page.mouse.move(helpBox.x + helpBox.width / 2, helpBox.y + helpBox.height / 2);
  await page.mouse.wheel(0, 420);
  await page.waitForTimeout(40);
  const helpAfterWheel = await page.evaluate((read) => {
    const run = new Function(`return (${read})`)();
    return run(".esco-copilot__body > .esco-help");
  }, readScroll.toString());
  check("Copilot help wheel scrolls", helpAfterWheel.scrollTop > 0, JSON.stringify(helpAfterWheel));

  const addRung = page.locator('.esco-editor__local-toolbar button[aria-label="Add rung"]');
  for (let i = 0; i < 12; i += 1) await addRung.click();

  const initialMetrics = await page.evaluate((read) => {
    const run = new Function(`return (${read})`)();
    return {
      ribbon: run(".esco-ribbon__toolbar-row--standard"),
      organizer: run(".esco-controller-organizer .esco-panel__body"),
      editor: run(".esco-editor__surface"),
      editorBefore: getComputedStyle(document.querySelector(".esco-editor__surface"), "::before").content,
      editorAfter: getComputedStyle(document.querySelector(".esco-editor__surface"), "::after").content,
      organizerBefore: getComputedStyle(document.querySelector(".esco-controller-organizer .esco-panel__body"), "::before").content,
      organizerAfter: getComputedStyle(document.querySelector(".esco-controller-organizer .esco-panel__body"), "::after").content,
    };
  }, readScroll.toString());

  check(
    "standard toolbar owns horizontal overflow",
    initialMetrics.ribbon?.overflowX === "auto" && initialMetrics.ribbon.scrollWidth > initialMetrics.ribbon.clientWidth,
    JSON.stringify(initialMetrics.ribbon),
  );
  check(
    "organizer owns vertical overflow",
    initialMetrics.organizer?.overflowY === "auto" && initialMetrics.organizer.scrollHeight > initialMetrics.organizer.clientHeight,
    JSON.stringify(initialMetrics.organizer),
  );
  check(
    "ladder editor owns vertical overflow",
    /auto|scroll/.test(initialMetrics.editor?.overflowY ?? "") && initialMetrics.editor.scrollHeight > initialMetrics.editor.clientHeight,
    JSON.stringify(initialMetrics.editor),
  );
  check(
    "static faux scrollbars are disabled",
    initialMetrics.editorBefore === "none" &&
      initialMetrics.editorAfter === "none" &&
      initialMetrics.organizerBefore === "none" &&
      initialMetrics.organizerAfter === "none",
    JSON.stringify({
      editorBefore: initialMetrics.editorBefore,
      editorAfter: initialMetrics.editorAfter,
      organizerBefore: initialMetrics.organizerBefore,
      organizerAfter: initialMetrics.organizerAfter,
    }),
  );

  await page.evaluate(() => {
    document.querySelector(".esco-ribbon__toolbar-row--standard").scrollLeft = 0;
    document.querySelector(".esco-controller-organizer .esco-panel__body").scrollTop = 0;
    document.querySelector(".esco-editor__surface").scrollTop = 0;
  });

  const ribbonBox = await page.locator(".esco-ribbon__toolbar-row--standard").boundingBox();
  await page.mouse.move(ribbonBox.x + ribbonBox.width - 80, ribbonBox.y + ribbonBox.height / 2);
  await page.mouse.wheel(700, 0);

  const organizerBox = await page.locator(".esco-controller-organizer .esco-panel__body").boundingBox();
  await page.mouse.move(organizerBox.x + organizerBox.width / 2, organizerBox.y + organizerBox.height / 2);
  await page.mouse.wheel(0, 260);

  const editorBox = await page.locator(".esco-editor__surface").boundingBox();
  await page.locator(".esco-editor__surface").hover({ position: { x: Math.min(520, editorBox.width - 80), y: editorBox.height - 64 } });
  await page.mouse.click(editorBox.x + Math.min(520, editorBox.width - 80), editorBox.y + editorBox.height - 64);
  for (let i = 0; i < 5; i += 1) {
    await page.mouse.wheel(0, 200);
    await page.waitForTimeout(40);
  }

  const afterWheel = await page.evaluate((read) => {
    const run = new Function(`return (${read})`)();
    return {
      ribbon: run(".esco-ribbon__toolbar-row--standard"),
      organizer: run(".esco-controller-organizer .esco-panel__body"),
      editor: run(".esco-editor__surface"),
    };
  }, readScroll.toString());

  check("toolbar horizontal wheel scrolls", afterWheel.ribbon.scrollLeft > 0, JSON.stringify(afterWheel.ribbon));
  check("organizer wheel scrolls", afterWheel.organizer.scrollTop > 0, JSON.stringify(afterWheel.organizer));
  check("ladder editor wheel scrolls", afterWheel.editor.scrollTop > 0, JSON.stringify(afterWheel.editor));

  await page.locator('.esco-ribbon__tab:has-text("Window")').click();
  await page.locator('.esco-ribbon-menu__item:has-text("Main Window")').click();
  await page.locator(".esco-toast__close").waitFor({ timeout: 5000 });
  const toastLayerHit = await page.evaluate(() => {
    const close = document.querySelector(".esco-toast__close");
    const fab = document.querySelector('[data-testid="floating-ai-fab"]');
    if (!close || !fab) return null;
    const closeBox = close.getBoundingClientRect();
    const hit = document.elementFromPoint(closeBox.left + closeBox.width / 2, closeBox.top + closeBox.height / 2);
    const fabBox = fab.getBoundingClientRect();
    return {
      hitClass: hit?.className ?? "",
      hitTestId: hit?.getAttribute?.("data-testid") ?? "",
      closeClass: close.className,
      fabZ: getComputedStyle(fab).zIndex,
      toastZ: getComputedStyle(document.querySelector(".esco-toasts")).zIndex,
      fabBox: {
        left: Math.round(fabBox.left),
        top: Math.round(fabBox.top),
        right: Math.round(fabBox.right),
        bottom: Math.round(fabBox.bottom),
      },
      closeBox: {
        left: Math.round(closeBox.left),
        top: Math.round(closeBox.top),
        right: Math.round(closeBox.right),
        bottom: Math.round(closeBox.bottom),
      },
    };
  });
  check(
    "floating AI launcher does not block bottom toast controls",
    toastLayerHit?.hitClass === "esco-toast__close" && Number(toastLayerHit.fabZ) < Number(toastLayerHit.toastZ),
    JSON.stringify(toastLayerHit),
  );
  await page.locator(".esco-toast__close").click();
  await dismissToasts(page);

  await page.setViewportSize({ width: 900, height: 360 });
  await page.locator('.esco-tree__group--button[title="Open the I/O configuration"]').click();
  await page.locator(".esco-detail").waitFor({ timeout: 5000 });
  const detailMetrics = await page.evaluate((read) => {
    const run = new Function(`return (${read})`)();
    return run(".esco-detail");
  }, readScroll.toString());
  check(
    "structure detail owns vertical overflow",
    /auto|scroll/.test(detailMetrics?.overflowY ?? "") && detailMetrics.scrollHeight > detailMetrics.clientHeight,
    JSON.stringify(detailMetrics),
  );
  await page.evaluate(() => {
    document.querySelector(".esco-detail").scrollTop = 0;
  });
  const detailBox = await page.locator(".esco-detail").boundingBox();
  await page.mouse.move(detailBox.x + detailBox.width / 2, detailBox.y + Math.min(120, detailBox.height / 2));
  await page.mouse.wheel(0, 360);
  await page.waitForTimeout(40);
  const detailAfterWheel = await page.evaluate((read) => {
    const run = new Function(`return (${read})`)();
    return run(".esco-detail");
  }, readScroll.toString());
  check("structure detail wheel scrolls", detailAfterWheel.scrollTop > 0, JSON.stringify(detailAfterWheel));

  await page.locator('.esco-ribbon__tab:has-text("View")').click();
  await page.locator('.esco-ribbon-menu__item:has-text("Project History")').click();
  await page.locator(".esco-vcs").waitFor({ timeout: 5000 });
  const historyMetrics = await page.evaluate((read) => {
    const run = new Function(`return (${read})`)();
    return run(".esco-vcs");
  }, readScroll.toString());
  const historyCanScroll = historyMetrics.scrollHeight > historyMetrics.clientHeight;
  check(
    "project history root is scroll-ready",
    /auto|scroll/.test(historyMetrics?.overflowY ?? "") && historyMetrics.clientHeight > 0,
    JSON.stringify(historyMetrics),
  );
  await page.evaluate(() => {
    document.querySelector(".esco-vcs").scrollTop = 0;
  });
  const historyBox = await page.locator(".esco-vcs").boundingBox();
  await page.mouse.move(historyBox.x + historyBox.width / 2, historyBox.y + Math.min(120, historyBox.height / 2));
  await page.mouse.wheel(0, 360);
  await page.waitForTimeout(40);
  const historyAfterWheel = await page.evaluate((read) => {
    const run = new Function(`return (${read})`)();
    return run(".esco-vcs");
  }, readScroll.toString());
  check(
    "project history wheel scrolls when content overflows",
    historyCanScroll ? historyAfterWheel.scrollTop > 0 : historyAfterWheel.scrollTop === 0,
    JSON.stringify(historyAfterWheel),
  );

  await page.locator('.esco-ribbon__tab:has-text("View")').click();
  await page.locator('.esco-ribbon-menu__item:has-text("ESCO Online (Gateway)")').click();
  await page.locator(".eol-root").waitFor({ timeout: 5000 });
  const onlineMetrics = await page.evaluate((read) => {
    const run = new Function(`return (${read})`)();
    return run(".eol-root");
  }, readScroll.toString());
  check(
    "ESCO Online root owns vertical overflow",
    /auto|scroll/.test(onlineMetrics?.overflowY ?? "") && onlineMetrics.scrollHeight > onlineMetrics.clientHeight,
    JSON.stringify(onlineMetrics),
  );
  await page.evaluate(() => {
    document.querySelector(".eol-root").scrollTop = 0;
  });
  const onlineBox = await page.locator(".eol-root").boundingBox();
  await page.mouse.move(onlineBox.x + onlineBox.width / 2, onlineBox.y + Math.min(120, onlineBox.height / 2));
  await page.mouse.wheel(0, 420);
  await page.waitForTimeout(40);
  const onlineAfterWheel = await page.evaluate((read) => {
    const run = new Function(`return (${read})`)();
    return run(".eol-root");
  }, readScroll.toString());
  check("ESCO Online root wheel scrolls", onlineAfterWheel.scrollTop > 0, JSON.stringify(onlineAfterWheel));

  await page.setViewportSize({ width: 1280, height: 720 });

  await clickFileMenuItem(page, "Project Properties");
  await page.locator(".esco-project-props").waitFor({ timeout: 5000 });
  const modalOverflow = await page.locator(".esco-project-props").evaluate((node) => {
    const styles = getComputedStyle(node);
    return { overflowX: styles.overflowX, overflowY: styles.overflowY, maxHeight: styles.maxHeight };
  });
  check("modal panels can scroll when content exceeds viewport", modalOverflow.overflowY === "auto", JSON.stringify(modalOverflow));
  await page.locator('.esco-project-props button[aria-label="Close project properties"]').click();
  await dismissToasts(page);

  await page.setViewportSize({ width: 900, height: 620 });
  await openDockPanel(page, "Watch");
  await page.locator(".esco-dock.is-expanded").waitFor({ timeout: 5000 });
  const dockMetrics = await page.evaluate((read) => {
    const run = new Function(`return (${read})`)();
    return {
      tabs: run(".esco-dock__tabs"),
      body: run(".esco-dock__body"),
    };
  }, readScroll.toString());
  check(
    "dock tabs own horizontal overflow at narrow widths",
    dockMetrics.tabs?.overflowX === "auto" && dockMetrics.tabs.scrollWidth > dockMetrics.tabs.clientWidth,
    JSON.stringify(dockMetrics.tabs),
  );
  check("dock body owns native overflow", /auto|scroll/.test(dockMetrics.body?.overflowY ?? ""), JSON.stringify(dockMetrics.body));
  await page.evaluate(() => {
    document.querySelector(".esco-dock__tabs").scrollLeft = 0;
  });
  const dockTabsBox = await page.locator(".esco-dock__tabs").boundingBox();
  await page.mouse.move(dockTabsBox.x + dockTabsBox.width - 24, dockTabsBox.y + dockTabsBox.height / 2);
  await page.mouse.wheel(520, 0);
  await page.waitForTimeout(40);
  const dockTabsAfterWheel = await page.evaluate((read) => {
    const run = new Function(`return (${read})`)();
    return run(".esco-dock__tabs");
  }, readScroll.toString());
  check("dock tabs wheel scroll horizontally", dockTabsAfterWheel.scrollLeft > 0, JSON.stringify(dockTabsAfterWheel));

  await page
    .locator('.esco-tree__group--button:has-text("Controller Tags"), .esco-left :text("Controller Tags")')
    .first()
    .click();
  await page.locator(".esco-tags__grid").waitFor({ timeout: 5000 });
  const tagMetrics = await page.evaluate((read) => {
    const run = new Function(`return (${read})`)();
    return {
      shell: run(".esco-tags"),
      grid: run(".esco-tags__grid"),
    };
  }, readScroll.toString());
  check(
    "tag table delegates overflow to grid scroller",
    tagMetrics.shell?.overflowX === "hidden" &&
      /auto|scroll/.test(tagMetrics.grid?.overflowX ?? "") &&
      tagMetrics.grid.scrollWidth > tagMetrics.grid.clientWidth,
    JSON.stringify(tagMetrics),
  );
  await page.evaluate(() => {
    document.querySelector(".esco-tags__grid").scrollLeft = 0;
  });
  const tagGridBox = await page.locator(".esco-tags__grid").boundingBox();
  await page.mouse.move(tagGridBox.x + Math.min(tagGridBox.width - 24, 360), tagGridBox.y + tagGridBox.height / 2);
  await page.mouse.wheel(620, 0);
  await page.waitForTimeout(40);
  const tagsAfterWheel = await page.evaluate((read) => {
    const run = new Function(`return (${read})`)();
    return run(".esco-tags__grid");
  }, readScroll.toString());
  check("tag table wheel scrolls horizontally", tagsAfterWheel.scrollLeft > 0, JSON.stringify(tagsAfterWheel));

  await page.setViewportSize({ width: 1280, height: 720 });
  await page.locator('.esco-ribbon__tab:has-text("View")').click();
  await page.locator('.esco-ribbon-menu__item:has-text("HMI Designer")').click();
  await page.locator(".esco-hmi-main").waitFor({ timeout: 5000 });

  const hmiMetrics = await page.evaluate((read) => {
    const run = new Function(`return (${read})`)();
    return {
      main: run(".esco-hmi-main"),
      toolbox: run(".esco-hmi-toolbox"),
    };
  }, readScroll.toString());

  check(
    "HMI center pane owns clipped canvas/toolbox overflow",
    /auto|scroll/.test(hmiMetrics.main?.overflowX ?? "") &&
      hmiMetrics.main.scrollWidth > hmiMetrics.main.clientWidth,
    JSON.stringify(hmiMetrics.main),
  );
  check(
    "HMI toolbox owns vertical overflow",
    /auto|scroll/.test(hmiMetrics.toolbox?.overflowY ?? "") &&
      hmiMetrics.toolbox.scrollHeight > hmiMetrics.toolbox.clientHeight,
    JSON.stringify(hmiMetrics.toolbox),
  );

  await page.evaluate(() => {
    document.querySelector(".esco-hmi-main").scrollLeft = 0;
    document.querySelector(".esco-hmi-main").scrollTop = 0;
    document.querySelector(".esco-hmi-toolbox").scrollTop = 0;
  });
  await page.locator(".esco-hmi-main").hover();
  await page.mouse.wheel(600, 0);
  await page.waitForTimeout(40);
  const hmiMainAfterWheel = await page.evaluate((read) => {
    const run = new Function(`return (${read})`)();
    return run(".esco-hmi-main");
  }, readScroll.toString());
  await page.evaluate(() => {
    document.querySelector(".esco-hmi-main").scrollLeft = 0;
    document.querySelector(".esco-hmi-main").scrollTop = 0;
  });
  await page.waitForTimeout(40);
  await page.locator(".esco-hmi-toolbox").hover();
  await page.mouse.wheel(0, 220);
  await page.waitForTimeout(40);
  const hmiAfterWheel = await page.evaluate((read) => {
    const run = new Function(`return (${read})`)();
    return {
      main: run(".esco-hmi-main"),
      toolbox: run(".esco-hmi-toolbox"),
    };
  }, readScroll.toString());

  check("HMI center pane wheel scrolls horizontally", hmiMainAfterWheel.scrollLeft > 0, JSON.stringify(hmiMainAfterWheel));
  check("HMI toolbox wheel scrolls", hmiAfterWheel.toolbox.scrollTop > 0, JSON.stringify(hmiAfterWheel.toolbox));

  await page.setViewportSize({ width: 900, height: 620 });
  await page.locator('.esco-ribbon__tab:has-text("View")').click();
  await page.locator('.esco-ribbon-menu__item:has-text("ESCO Simulation Lab")').click();
  await page.locator(".esco-simlab").waitFor({ timeout: 5000 });
  await page.locator('.esco-simlab button:has-text("Load Candy Sorter Demo")').click();
  await dismissToasts(page);
  await page.locator('.esco-simlab__tab:has-text("Run")').click();
  await page.locator(".esco-simlab__grid--three").waitFor({ timeout: 5000 });

  const simRunMetrics = await page.evaluate((read) => {
    const run = new Function(`return (${read})`)();
    return {
      lab: run(".esco-simlab"),
      stage: run(".esco-simlab__grid--three"),
      panel: run(".esco-simlab__panel"),
    };
  }, readScroll.toString());
  check(
    "Simulation Lab shell exposes stage overflow fallback",
    /auto|scroll/.test(simRunMetrics.lab?.overflowY ?? "") &&
      /auto|scroll/.test(simRunMetrics.stage?.overflowY ?? "") &&
      simRunMetrics.stage.scrollHeight > simRunMetrics.stage.clientHeight &&
      simRunMetrics.panel?.overflowY === "visible",
    JSON.stringify(simRunMetrics),
  );
  await page.evaluate(() => {
    document.querySelector(".esco-simlab").scrollTop = 0;
  });
  const simLabBox = await page.locator(".esco-simlab").boundingBox();
  await page.mouse.move(simLabBox.x + simLabBox.width / 2, simLabBox.y + Math.min(120, simLabBox.height / 2));
  await page.mouse.wheel(0, 260);
  await page.waitForTimeout(40);
  const simLabAfterWheel = await page.evaluate(() => {
    const lab = document.querySelector(".esco-simlab");
    return { labTop: lab.scrollTop, canScroll: lab.scrollHeight > lab.clientHeight };
  });
  check(
    "Simulation Lab fallback scrollbar reveals short-pane stages",
    simLabAfterWheel.canScroll ? simLabAfterWheel.labTop > 0 : simLabAfterWheel.labTop === 0,
    JSON.stringify(simLabAfterWheel),
  );
  await page.evaluate(() => {
    document.querySelector(".esco-simlab__grid--three").scrollTop = 0;
    const lab = document.querySelector(".esco-simlab");
    const stage = document.querySelector(".esco-simlab__grid--three");
    lab.scrollTop = Math.max(0, stage.offsetTop - 24);
  });
  const simStageBox = await page.locator(".esco-simlab__grid--three").boundingBox();
  await page.mouse.move(simStageBox.x + simStageBox.width / 2, simStageBox.y + Math.min(140, simStageBox.height / 2));
  await page.mouse.wheel(0, 500);
  await page.waitForTimeout(40);
  const simStageAfterWheel = await page.evaluate(() => ({
    stageTop: document.querySelector(".esco-simlab__grid--three").scrollTop,
    labTop: document.querySelector(".esco-simlab").scrollTop,
  }));
  check("Simulation Lab Run stage wheel scrolls", simStageAfterWheel.stageTop > 0, JSON.stringify(simStageAfterWheel));

  await page.locator('.esco-simlab__tab:has-text("Onsite Screens")').click();
  await page.locator('[data-testid="simlab-onsite"]').waitFor({ timeout: 5000 });
  const onsiteMetrics = await page.evaluate((read) => {
    const run = new Function(`return (${read})`)();
    return {
      lab: run(".esco-simlab"),
      onsite: run('[data-testid="simlab-onsite"]'),
      screen: run(".sim2__screen"),
    };
  }, readScroll.toString());
  check(
    "Simulation Lab onsite screen owns vertical overflow",
    /auto|scroll/.test(onsiteMetrics.lab?.overflowY ?? "") &&
      onsiteMetrics.onsite?.overflowY === "hidden" &&
      /auto|scroll/.test(onsiteMetrics.screen?.overflowY ?? "") &&
      onsiteMetrics.screen.scrollHeight > onsiteMetrics.screen.clientHeight,
    JSON.stringify(onsiteMetrics),
  );
  await page.evaluate(() => {
    document.querySelector(".sim2__screen").scrollTop = 0;
  });
  let onsiteScreenBox = await page.locator(".sim2__screen").boundingBox();
  await page.locator(".sim2__screen").hover({
    position: {
      x: Math.min(160, onsiteScreenBox.width / 2),
      y: Math.min(48, onsiteScreenBox.height / 2),
    },
  });
  onsiteScreenBox = await page.locator(".sim2__screen").boundingBox();
  await page.mouse.move(onsiteScreenBox.x + Math.min(220, onsiteScreenBox.width / 2), onsiteScreenBox.y + Math.min(60, onsiteScreenBox.height / 2));
  await page.mouse.wheel(0, 600);
  await page.waitForTimeout(40);
  const onsiteAfterWheel = await page.evaluate(() => ({
    screenTop: document.querySelector(".sim2__screen").scrollTop,
    labTop: document.querySelector(".esco-simlab").scrollTop,
  }));
  check("Simulation Lab onsite wheel scrolls", onsiteAfterWheel.screenTop > 0, JSON.stringify(onsiteAfterWheel));
} catch (error) {
  console.log("ERROR:", error?.stack || error?.message || error);
} finally {
  await browser.close();
  const passed = results.filter(Boolean).length;
  console.log(`SUMMARY: ${passed}/${results.length}`);
  if (passed !== results.length) process.exit(1);
}
