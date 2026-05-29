// E2E: HMI View Designer editing depth — create a screen, add an element, edit a
// property, bind a tag, then delete the element and rename/delete the surface.
// All edits flow through the reviewed @esco/project-actions HMI action layer.
import { chromium } from "playwright-core";
import { URL, createBlankProject, dismissToasts } from "./helpers.mjs";

const results = [];
const check = (l, c, d = "") => {
  results.push(!!c);
  console.log(`${c ? "PASS" : "FAIL"}  ${l}${d ? "  — " + d : ""}`);
};

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
try {
  // domcontentloaded + explicit wait is cold-Vite-server safe (and works warm too).
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.locator('button:has-text("Create New Routine")').first().waitFor({ timeout: 60000 });
  await createBlankProject(page);

  // Open the HMI View Designer.
  await page.locator('button[aria-label="HMI Designer"]').click();
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
    /Home/.test(await page.locator('.esco-hmi-nav button:has-text("Overview")').first().innerText()),
  );
  await dismissToasts(page);

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
  const inspectorText = await page.locator(".esco-hmi-properties").innerText();
  check("Adding a binding records it in the inspector", /Bindings \(1\)/.test(inspectorText) && /MotorRun/.test(inspectorText));
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
  await page.locator('.esco-hmi-nav button:has-text("Main HMI")').first().waitFor({ timeout: 5000 });
  check("Renaming a screen updates the navigation list", true);
  await dismissToasts(page);

  // Delete the screen.
  await page.locator('.esco-hmi-properties button:has-text("Delete screen")').click();
  await page.locator('.esco-hmi-nav__empty:has-text("No screens created")').first().waitFor({ timeout: 5000 });
  check("Deleting a screen removes it from the project", true);

  const passed = results.filter(Boolean).length;
  console.log(`\nSUMMARY: ${passed}/${results.length} checks passed`);
  process.exitCode = passed === results.length ? 0 : 1;
} catch (err) {
  console.log("ERROR:", err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
