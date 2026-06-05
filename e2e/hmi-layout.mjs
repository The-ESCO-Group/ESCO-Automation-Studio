// E2E: HMI designer/operator runtime layout landmarks for the ESCO runtime pass.
import { chromium } from "playwright-core";
import { URL, createBlankProject, dismissToasts } from "./helpers.mjs";

const results = [];
const check = (label, condition, detail = "") => {
  results.push(!!condition);
  console.log(`${condition ? "PASS" : "FAIL"}  ${label}${detail ? "  - " + detail : ""}`);
};

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 980 } });
page.on("pageerror", (error) => console.log("PAGEERROR:", error.message));

try {
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.locator(".esco-controller-organizer").waitFor({ timeout: 60000 });
  await createBlankProject(page);

  await page.locator('.esco-ribbon__tab:has-text("View")').click();
  await page.locator('.esco-ribbon-menu__item:has-text("HMI Designer")').click();
  if ((await page.locator('button:has-text("Enable HMI Project")').count()) > 0) {
    await page.locator('button:has-text("Enable HMI Project")').click();
  }
  await page.locator('[data-testid="hmi-designer"]').waitFor({ timeout: 8000 });

  const headerText = await page.locator(".esco-hmi__header").innerText();
  check("Designer header shows EAS HMI Designer", /EAS HMI Designer/.test(headerText), headerText);
  check("Designer header uses the actual HMI project name", /Project\s+Untitled Project HMI/.test(headerText), headerText);
  check("Designer header does not show demo project text", !/Packaging_Line_01|Packaging Line 01/.test(headerText), headerText);
  check("Designer header exposes Preview", /Preview/.test(headerText), headerText);
  check("Designer header exposes Build Runtime", /Build Runtime/.test(headerText), headerText);

  const treeText = await page.locator('[data-testid="hmi-project-tree"]').innerText();
  const normalizedTreeText = treeText.toLowerCase();
  check(
    "Project tree sections match layout target",
    ["screens", "popups", "tags", "alarms", "trends"].every((label) => normalizedTreeText.includes(label)),
    treeText.replace(/\s+/g, " ").slice(0, 180),
  );

  const propsText = await page.locator('[data-testid="hmi-props-panel"]').innerText();
  check(
    "Props tabs show Bind, Events, Sec.",
    /Bind/.test(propsText) && /Events/.test(propsText) && /Sec\./.test(propsText),
    propsText.replace(/\s+/g, " ").slice(0, 120),
  );

  const dockText = await page.locator('[data-testid="hmi-bottom-dock"]').innerText();
  check(
    "Bottom dock has target tabs",
    ["Problems", "Runtime Diagnostics", "Tag Watch", "Output"].every((label) => dockText.includes(label)),
    dockText.replace(/\s+/g, " ").slice(0, 160),
  );

  await page.locator('input[aria-label="New HMI screen name"]').fill("Overview");
  await page
    .locator(".esco-hmi-create")
    .filter({ has: page.locator('input[aria-label="New HMI screen name"]') })
    .locator("button")
    .click();
  await page.locator('.esco-hmi-nav button:has-text("Overview")').first().waitFor({ timeout: 5000 });
  await page.locator('input[aria-label="New HMI screen name"]').fill("Manual");
  await page
    .locator(".esco-hmi-create")
    .filter({ has: page.locator('input[aria-label="New HMI screen name"]') })
    .locator("button")
    .click();
  await page.locator('.esco-hmi-nav button:has-text("Manual")').first().waitFor({ timeout: 5000 });
  await dismissToasts(page);

  await page.locator('[data-testid="hmi-start-preview"]').click();
  await page.locator('[data-testid="hmi-operator-runtime"]').waitFor({ timeout: 8000 });

  const operatorStatus = await page.locator('[data-testid="hmi-operator-status"]').innerText();
  check(
    "Operator status bar uses real runtime state, not demo identity",
    /Overview/.test(operatorStatus) &&
      /AUTO/.test(operatorStatus) &&
      /Operator: Guest/.test(operatorStatus) &&
      /0 Active Alarms/.test(operatorStatus) &&
      !/Packaging Line 01|Neel/.test(operatorStatus),
    operatorStatus,
  );

  const overviewNav = page.locator('[data-testid="hmi-operator-nav-overview"]');
  const manualNav = page.locator('[data-testid="hmi-operator-nav-manual"]');
  const recipesNav = page.locator('[data-testid="hmi-operator-nav-recipes"]');
  check(
    "Operator runtime nav marks the active screen",
    (await overviewNav.getAttribute("aria-current")) === "page" &&
      (await overviewNav.evaluate((node) => node.classList.contains("is-active"))) &&
      !(await manualNav.evaluate((node) => node.classList.contains("is-active"))),
  );
  check(
    "Operator runtime nav disables destinations with no matching screen",
    (await recipesNav.isDisabled()) && (await page.locator('[data-testid="hmi-operator-nav-i-o"]').isDisabled()),
  );
  await manualNav.click();
  await page.locator('[data-testid="hmi-operator-status"]').filter({ hasText: "Manual" }).waitFor({ timeout: 5000 });
  check(
    "Operator runtime nav changes the current screen when a valid destination is clicked",
    (await manualNav.getAttribute("aria-current")) === "page" &&
      (await manualNav.evaluate((node) => node.classList.contains("is-active"))) &&
      !(await overviewNav.evaluate((node) => node.classList.contains("is-active"))),
  );

  const mimicText = await page.locator('[data-testid="hmi-process-mimic"]').innerText();
  check(
    "Operator mimic shows Tank to Filler process chain",
    ["Tank", "Pump", "Valve", "Conveyor", "Filler"].every((label) => mimicText.includes(label)),
    mimicText.replace(/\s+/g, " "),
  );

  const operatorText = await page.locator('[data-testid="hmi-operator-runtime"]').innerText();
  const normalizedOperatorText = operatorText.toLowerCase();
  check(
    "Operator runtime shows values, controls, alarm strip, and nav",
    ["tank level", "pump speed", "motor", "fault", "start", "stop", "reset", "manual mode", "alarm strip", "home", "recipes", "i/o"].every(
      (label) => normalizedOperatorText.includes(label),
    ),
    operatorText.replace(/\s+/g, " ").slice(0, 260),
  );

  const passed = results.filter(Boolean).length;
  console.log(`\nSUMMARY: ${passed}/${results.length} checks passed`);
  process.exitCode = passed === results.length ? 0 : 1;
} catch (err) {
  console.log("ERROR:", err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
