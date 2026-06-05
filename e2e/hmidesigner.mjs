// E2E: HMI Designer editing depth — create a screen, add an element, edit a
// property, bind a tag, then delete the element and rename/delete the surface.
// All edits flow through the reviewed @esco/project-actions HMI action layer.
import { chromium } from "playwright-core";
import { readFileSync } from "node:fs";
import { URL, acceptConfirmation, cancelConfirmation, createBlankProject, dismissToasts, readConfirmationText } from "./helpers.mjs";

const results = [];
const check = (l, c, d = "") => {
  results.push(!!c);
  console.log(`${c ? "PASS" : "FAIL"}  ${l}${d ? "  — " + d : ""}`);
};

const section = (page, label) =>
  page.locator(".esco-hmi-nav section").filter({ has: page.locator(`h2:has-text("${label}")`) }).first();
const screenButton = (page, label) => section(page, "Screens").locator(`button:has-text("${label}")`).first();
const popupButton = (page, label) => section(page, "Popups").locator(`button:has-text("${label}")`).first();
const createRow = (page, ariaLabel) =>
  page.locator(".esco-hmi-create").filter({ has: page.locator(`input[aria-label="${ariaLabel}"]`) }).first();
const propertiesText = (page) => page.locator(".esco-hmi-properties").innerText();

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
try {
  // domcontentloaded + explicit wait is cold-Vite-server safe (and works warm too).
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.locator(".esco-controller-organizer").waitFor({ timeout: 60000 });
  await createBlankProject(page);

  // Open the HMI Designer.
  await page.locator('.esco-ribbon__tab:has-text("View")').click();
  await page.locator('.esco-ribbon-menu__item:has-text("HMI Designer")').click();
  if ((await page.locator('button:has-text("Enable HMI Project")').count()) > 0) {
    await page.locator('button:has-text("Enable HMI Project")').click();
  }
  await page.locator('[data-testid="hmi-designer"]').waitFor({ timeout: 8000 });
  check("HMI Designer opens for a blank project", true);

  // Create a screen (the create input defaults to "Overview").
  const screenInput = page.locator('input[aria-label="New HMI screen name"]');
  await screenInput.fill("Overview");
  await page
    .locator(".esco-hmi-create")
    .filter({ has: page.locator('input[aria-label="New HMI screen name"]') })
    .locator("button")
    .click();
  await page.locator('.esco-hmi-nav button:has-text("Overview")').first().waitFor({ timeout: 5000 });
  check("Created an HMI screen", true);
  check(
    "First screen is auto-marked as the home screen",
    /Home/.test(await screenButton(page, "Overview").innerText()),
  );
  await dismissToasts(page);

  // Create a second screen, mark it home, then return to Overview for element work.
  await screenInput.fill("Details");
  await createRow(page, "New HMI screen name").locator("button").click();
  await screenButton(page, "Details").waitFor({ timeout: 5000 });
  await page.locator('.esco-hmi-properties button:has-text("Set as home")').click();
  await page.waitForFunction(
    () => {
      const buttons = [...document.querySelectorAll(".esco-hmi-nav section button")];
      const details = buttons.find((button) => button.textContent?.includes("Details"));
      const overview = buttons.find((button) => button.textContent?.includes("Overview"));
      return details?.textContent?.includes("Home") && !overview?.textContent?.includes("Home");
    },
    undefined,
    { timeout: 5000 },
  );
  check("Set as home moves the Home marker to the selected screen", true);
  await dismissToasts(page);

  // Create a popup, prove delete is guarded, then delete it after accepting.
  const popupInput = page.locator('input[aria-label="New HMI popup name"]');
  await popupInput.fill("Motor Popup");
  await createRow(page, "New HMI popup name").locator("button").click();
  await popupButton(page, "Motor Popup").waitFor({ timeout: 5000 });
  check("Create Popup adds and selects an HMI popup surface", /Motor Popup/.test(await page.locator(".esco-hmi-canvas__toolbar").innerText()));
  await page.locator('.esco-hmi-properties button:has-text("Delete popup")').click();
  check("Popup delete guard prompts before removing content", /Delete HMI popup "Motor Popup"/.test(await readConfirmationText(page)));
  await cancelConfirmation(page);
  check("Dismissing the popup delete guard keeps the popup", (await popupButton(page, "Motor Popup").count()) === 1);
  await page.locator('.esco-hmi-properties button:has-text("Delete popup")').click();
  await acceptConfirmation(page);
  await page.locator('.esco-hmi-nav__empty:has-text("No popups created")').first().waitFor({ timeout: 5000 });
  check("Accepting the popup delete guard removes the popup", true);
  await dismissToasts(page);

  await popupInput.fill("Runtime Popup");
  await createRow(page, "New HMI popup name").locator("button").click();
  await popupButton(page, "Runtime Popup").waitFor({ timeout: 5000 });
  check("Created a runtime popup target for event preview", true);
  await dismissToasts(page);

  // System banner is selectable but has no screen/popup destructive action.
  await page.locator('.esco-hmi-nav__banner:has-text("System Banner")').click();
  await page.locator('.esco-hmi-canvas__toolbar:has-text("System Banner")').waitFor({ timeout: 5000 });
  const bannerInspector = await propertiesText(page);
  check("System banner selection opens the banner surface inspector", /Kind\s+system-banner/.test(bannerInspector));
  check("System banner selection has no delete surface button", (await page.locator('.esco-hmi-properties button:has-text("Delete system-banner")').count()) === 0);

  await screenButton(page, "Overview").click();

  // Add a Button element from the toolbox.
  await page.locator('.esco-hmi-toolbox button:has-text("Button")').first().click();
  await page.locator(".esco-hmi-element").first().waitFor({ timeout: 5000 });
  check("Added a Button element to the canvas", (await page.locator(".esco-hmi-element").count()) === 1);
  await dismissToasts(page);

  // Select the element to open the editable inspector.
  await page.locator(".esco-hmi-element").first().click();
  await page.locator('input[aria-label="Element name"]').waitFor({ timeout: 5000 });
  check("Selecting an element opens the editable inspector", true);

  // Edit the label property — the canvas caption should update live.
  const labelField = page.locator('input[aria-label="Property label"]');
  await labelField.fill("Start Motor");
  await labelField.blur();
  await page.locator('.esco-hmi-element:has-text("Start Motor")').first().waitFor({ timeout: 5000 });
  check("Editing the label property updates the element on the canvas", true);
  await dismissToasts(page);

  // Bind the "enabled" property to a tag through the action layer.
  await page.locator('input[aria-label="Binding source path"]').fill("MotorRun");
  await page.locator('.esco-hmi-edit__form button:has-text("Bind")').click();
  await page.waitForFunction(
    () => /Bindings \(1\)/.test(document.querySelector(".esco-hmi-properties")?.textContent ?? ""),
    undefined,
    { timeout: 5000 },
  );
  let inspectorText = await propertiesText(page);
  check("Adding a binding records it in the inspector", /Bindings \(1\)/i.test(inspectorText) && /MotorRun/i.test(inspectorText));
  await dismissToasts(page);

  // Remove the binding through the inspector command button.
  await page.locator('button[aria-label="Remove binding enabled"]').click();
  await page.waitForFunction(
    () => document.querySelector(".esco-hmi-properties")?.textContent?.includes("Bindings (0)"),
    undefined,
    { timeout: 5000 },
  );
  check("Remove binding clears the selected element binding", /Bindings \(0\)/i.test(await propertiesText(page)));
  await dismissToasts(page);

  // Add and remove a navigation command.
  await page.locator('select[aria-label="Navigation target screen"]').selectOption({ label: "Details" });
  await page.locator('.esco-hmi-edit__form button:has-text("Add navigate")').click();
  inspectorText = await propertiesText(page);
  check("Add Navigate event creates a press navigate command", /press\s+→\s+navigate/.test(inspectorText) && /Details/.test(inspectorText));
  await dismissToasts(page);

  await page.locator('button[aria-label="Preview press event"]').click();
  await page.waitForFunction(
    () => {
      const text = document.querySelector(".esco-hmi-runtime")?.textContent ?? "";
      return text.includes("Current screen") && text.includes("Details") && text.includes("Navigated to screen");
    },
    undefined,
    { timeout: 5000 },
  );
  let runtimeText = await page.locator(".esco-hmi-runtime").innerText();
  check(
    "Preview press executes the navigate command through the runtime session",
    /Current screen\s+Details/.test(runtimeText) &&
      /applied\s+·\s+navigate/.test(runtimeText) &&
      /Navigated to screen "Details"/.test(runtimeText),
    runtimeText,
  );

  const [runtimePackageDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.locator('button:has-text("Build Runtime Package")').click(),
  ]);
  const runtimePackagePath = await runtimePackageDownload.path();
  const runtimePackage = JSON.parse(readFileSync(runtimePackagePath, "utf-8"));
  check(
    "Build Runtime Package downloads a verified offline runtime artifact",
    /\.hmiruntime\.json$/i.test(runtimePackageDownload.suggestedFilename()) &&
      runtimePackage.kind === "hmi-runtime-package" &&
      runtimePackage.runtimeProfile === "offline-preview" &&
      runtimePackage.verification?.status === "ready" &&
      runtimePackage.summary?.screenCount === 2 &&
      runtimePackage.summary?.elementCount === 1 &&
      runtimePackage.hardwareTransfer?.download === "disabled-model-only" &&
      /^hmirt_[0-9a-f]{8}$/.test(runtimePackage.packageId),
    JSON.stringify(runtimePackage).slice(0, 240),
  );

  await page.locator('button[aria-label="Remove press command"]').click();
  await page.waitForFunction(
    () => document.querySelector(".esco-hmi-properties")?.textContent?.includes("No event handlers."),
    undefined,
    { timeout: 5000 },
  );
  check("Remove navigation command drops the empty event handler", /No event handlers\./.test(await propertiesText(page)));
  await dismissToasts(page);

  // Add a set-tag-value command through the generalized command form (no screen target).
  await page.locator('select[aria-label="Command type"]').selectOption("set-tag-value");
  await page.locator('input[aria-label="Set tag path"]').fill("Motor.Run");
  await page.locator('input[aria-label="Set tag value"]').fill("1");
  await page.locator('.esco-hmi-edit__form button:has-text("Add set tag")').click();
  inspectorText = await propertiesText(page);
  check(
    "Add Set tag value creates a press set-tag-value command",
    /press\s+→\s+set-tag-value/.test(inspectorText),
  );
  await dismissToasts(page);

  await page.locator('button[aria-label="Preview press event"]').click();
  await page.waitForFunction(
    () => (document.querySelector(".esco-hmi-runtime")?.textContent ?? "").includes('Queued offline tag-write preview for "Motor.Run"'),
    undefined,
    { timeout: 5000 },
  );
  runtimeText = await page.locator(".esco-hmi-runtime").innerText();
  check(
    "Preview press queues a runtime tag-write preview through the backend",
    /applied\s+·\s+set-tag-value/.test(runtimeText) &&
      /Queued offline tag-write preview for "Motor\.Run"/.test(runtimeText) &&
      /Value 1/.test(runtimeText),
    runtimeText,
  );

  await page.locator('button[aria-label="Remove press command"]').click();
  await page.waitForFunction(
    () => document.querySelector(".esco-hmi-properties")?.textContent?.includes("No event handlers."),
    undefined,
    { timeout: 5000 },
  );
  check("Remove set-tag-value command drops the empty event handler", /No event handlers\./.test(await propertiesText(page)));
  await dismissToasts(page);

  await page.locator('select[aria-label="Command type"]').selectOption("open-popup");
  await page.locator('select[aria-label="Open popup target"]').selectOption({ label: "Runtime Popup" });
  await page.locator('.esco-hmi-edit__form button:has-text("Add open popup")').click();
  inspectorText = await propertiesText(page);
  check("Add Open popup event creates a press open-popup command", /press\s+→\s+open-popup/.test(inspectorText));
  await page.locator('button[aria-label="Preview press event"]').click();
  await page.waitForFunction(
    () => {
      const text = document.querySelector(".esco-hmi-runtime")?.textContent ?? "";
      return text.includes("Open popups") && text.includes("Runtime Popup") && text.includes('Opened popup "Runtime Popup"');
    },
    undefined,
    { timeout: 5000 },
  );
  runtimeText = await page.locator(".esco-hmi-runtime").innerText();
  check(
    "Preview press opens a popup through the runtime session",
    /Open popups\s+Runtime Popup/.test(runtimeText) &&
      /applied\s+·\s+open-popup/.test(runtimeText) &&
      /Opened popup "Runtime Popup"/.test(runtimeText),
    runtimeText,
  );
  await page.locator('button[aria-label="Remove press command"]').click();
  await page.waitForFunction(
    () => document.querySelector(".esco-hmi-properties")?.textContent?.includes("No event handlers."),
    undefined,
    { timeout: 5000 },
  );

  await page.locator('select[aria-label="Command type"]').selectOption("close-popup");
  await page.locator('.esco-hmi-edit__form button:has-text("Add close popup")').click();
  inspectorText = await propertiesText(page);
  check("Add Close popup event creates a press close-popup command", /press\s+→\s+close-popup/.test(inspectorText));
  await page.locator('button[aria-label="Preview press event"]').click();
  await page.waitForFunction(
    () => {
      const text = document.querySelector(".esco-hmi-runtime")?.textContent ?? "";
      return text.includes("Open popups") && text.includes("none") && text.includes('Closed popup "Runtime Popup"');
    },
    undefined,
    { timeout: 5000 },
  );
  runtimeText = await page.locator(".esco-hmi-runtime").innerText();
  check(
    "Preview press closes the popup through the runtime session",
    /Open popups\s+none/.test(runtimeText) &&
      /applied\s+·\s+close-popup/.test(runtimeText) &&
      /Closed popup "Runtime Popup"/.test(runtimeText),
    runtimeText,
  );
  await page.locator('button[aria-label="Remove press command"]').click();
  await page.waitForFunction(
    () => document.querySelector(".esco-hmi-properties")?.textContent?.includes("No event handlers."),
    undefined,
    { timeout: 5000 },
  );
  await dismissToasts(page);

  // Delete the element; the inspector falls back to the surface inspector.
  await page.locator('.esco-hmi-properties button:has-text("Delete element")').click();
  await page.locator('input[aria-label="Surface name"]').waitFor({ timeout: 5000 });
  check("Deleting the element clears it from the canvas", (await page.locator(".esco-hmi-element").count()) === 0);
  await dismissToasts(page);

  // Rename the surface from the surface inspector.
  const surfaceName = page.locator('input[aria-label="Surface name"]');
  await surfaceName.fill("Main HMI");
  await surfaceName.blur();
  await screenButton(page, "Main HMI").waitFor({ timeout: 5000 });
  check("Renaming a screen updates the navigation list", true);
  await dismissToasts(page);

  // Delete screen uses the same guard. Cancel first, then accept.
  await page.locator('.esco-hmi-properties button:has-text("Delete screen")').click();
  check("Screen delete guard prompts before removing content", /Delete HMI screen "Main HMI"/.test(await readConfirmationText(page)));
  await cancelConfirmation(page);
  check("Dismissing the screen delete guard keeps the screen", (await screenButton(page, "Main HMI").count()) === 1);

  await page.locator('.esco-hmi-properties button:has-text("Delete screen")').click();
  await acceptConfirmation(page);
  await page.waitForFunction(
    () => ![...document.querySelectorAll(".esco-hmi-nav section button")].some((button) => button.textContent?.includes("Main HMI")),
    undefined,
    { timeout: 5000 },
  );
  check("Accepting the screen delete guard removes the selected screen", (await screenButton(page, "Main HMI").count()) === 0);
  check("Deleting a non-home screen preserves the configured home screen", /Home/.test(await screenButton(page, "Details").innerText()));

  await screenButton(page, "Details").click();
  await page.locator('.esco-hmi-properties button:has-text("Delete screen")').click();
  await acceptConfirmation(page);
  await page.locator('.esco-hmi-nav__empty:has-text("No screens created")').first().waitFor({ timeout: 5000 });
  check("Deleting the final home screen is guarded and clears the screen list", true);

  const passed = results.filter(Boolean).length;
  console.log(`\nSUMMARY: ${passed}/${results.length} checks passed`);
  process.exitCode = passed === results.length ? 0 : 1;
} catch (err) {
  console.log("ERROR:", err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
