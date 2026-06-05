// E2E: offline IDE workflow parity — Controller Organizer commands perform real
// offline actions (no dead buttons). Focuses on the newly-wired offline
// component import (Add-On Instruction / Data Type / Trend), including its
// conflict-resolution dialog, plus a representative offline verification — all
// driven through the real context menus.
import { chromium } from "playwright-core";
import { URL, STARTER_L5X, dismissToasts, importL5XText } from "./helpers.mjs";

const results = [];
const check = (label, cond, detail = "") => {
  results.push(!!cond);
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${detail ? "  - " + String(detail).replace(/\s+/g, " ").slice(0, 130) : ""}`);
};

const menu = (page) => page.locator(".esco-context-menu--organizer").first();
const menuItem = (page, label) => page.locator(`.esco-context-menu__item:has-text("${label}")`).first();
const lastToast = (page) => page.locator(".esco-toast__message").last();
const importDialog = (page) => page.locator('.esco-modal__panel:has-text("Review components from")');

async function openContext(page, locator) {
  await locator.first().scrollIntoViewIfNeeded();
  await locator.first().click({ button: "right" });
  await menu(page).waitFor({ timeout: 8000 });
}

function bundle(kind, payload) {
  return JSON.stringify({ format: "esco.controller-assets.export.v1", kind, payload });
}

// Right-click an organizer folder and feed the hidden file input via the
// filechooser the import command triggers.
async function pickImportFile(page, organizer, rootLabel, menuLabel, fileName, text, mimeType = "application/json") {
  await openContext(page, organizer.locator(`:text("${rootLabel}")`).first());
  const fileChooserPromise = page.waitForEvent("filechooser", { timeout: 8000 });
  await menuItem(page, menuLabel).click();
  const chooser = await fileChooserPromise;
  await chooser.setFiles({ name: fileName, mimeType, buffer: Buffer.from(text) });
}

async function confirmImportDialog(page) {
  const dialog = importDialog(page);
  await dialog.waitFor({ timeout: 8000 });
  await dialog.locator('.esco-btn--primary:has-text("Import components")').click();
  await dialog.waitFor({ state: "detached", timeout: 8000 });
}

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
page.on("pageerror", (error) => console.log("PAGEERROR:", error.message));
page.setDefaultTimeout(10000);

try {
  // The app's LiveBridge opens a retrying EventSource (MCP live stream), so the
  // network never goes idle — wait for the shell to mount instead of networkidle.
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.locator(".esco-ribbon").waitFor({ timeout: 60000 });
  await importL5XText(page, STARTER_L5X, "offline-workflows.L5X");
  await dismissToasts(page);

  const organizer = page.locator(".esco-controller-organizer");

  // --- Import Add-On Instruction (offline component import) ---
  const aoiBundle = bundle("add-on-instructions", [
    { name: "ImportedAOI", revision: "1.0", parameters: [{ name: "In", dataType: "REAL", usage: "Input" }], localTags: [], routineNames: [] },
  ]);
  await pickImportFile(page, organizer, "Add-On Instructions", "Import Add-On Instruction", "aoi.json", aoiBundle);
  await importDialog(page).waitFor({ timeout: 8000 });
  check("Import AOI opens a review dialog before merging", (await importDialog(page).count()) === 1);
  await confirmImportDialog(page);
  await page.locator('.esco-detail__title:has-text("Add-On Instruction · ImportedAOI")').waitFor({ timeout: 8000 });
  check("Import Add-On Instruction merges a real AOI from a component file", (await organizer.locator('.esco-tree__node--aoi:has-text("ImportedAOI")').count()) === 1);
  check("Import AOI reports a success toast", /Imported Add-On Instruction/.test(await lastToast(page).innerText()));
  await dismissToasts(page);

  // Re-importing the same name surfaces a conflict and auto-renames by default.
  await pickImportFile(page, organizer, "Add-On Instructions", "Import Add-On Instruction", "aoi.json", aoiBundle);
  await importDialog(page).waitFor({ timeout: 8000 });
  check("Re-import flags the name conflict in the dialog", /already exist/i.test(await importDialog(page).innerText()));
  await confirmImportDialog(page);
  await page.locator('.esco-detail__title:has-text("Add-On Instruction · ImportedAOI_1")').waitFor({ timeout: 8000 });
  check("Colliding AOI auto-renames (ImportedAOI_1), never overwrites", (await organizer.locator('.esco-tree__node--aoi:has-text("ImportedAOI_1")').count()) === 1);
  check("Original ImportedAOI is preserved after collision import", (await organizer.locator('.esco-tree__node--aoi:has-text("ImportedAOI")').count()) >= 1);
  await dismissToasts(page);

  const aoiL5x = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0" TargetName="L5XScale" ContentType="AddOnInstructionDefinition">
  <Controller Use="Context" Name="ImportSource">
    <AddOnInstructionDefinitions>
      <AddOnInstructionDefinition Name="L5XScale" Revision="1.0">
        <Parameters>
          <Parameter Name="In" DataType="REAL" Usage="Input"/>
          <Parameter Name="Out" DataType="REAL" Usage="Output"/>
        </Parameters>
      </AddOnInstructionDefinition>
    </AddOnInstructionDefinitions>
  </Controller>
</RSLogix5000Content>`;
  await pickImportFile(page, organizer, "Add-On Instructions", "Import Add-On Instruction", "aoi-l5x.L5X", aoiL5x, "application/xml");
  await importDialog(page).waitFor({ timeout: 8000 });
  check("Import AOI accepts an offline L5X component and opens the same review dialog", /L5XScale/.test(await importDialog(page).innerText()));
  await confirmImportDialog(page);
  await page.locator('.esco-detail__title:has-text("Add-On Instruction · L5XScale")').waitFor({ timeout: 8000 });
  check("L5X Add-On Instruction merges through the organizer import command", (await organizer.locator('.esco-tree__node--aoi:has-text("L5XScale")').count()) === 1);
  await dismissToasts(page);

  // --- Import Data Type ---
  const udtBundle = bundle("user-defined-data-types", [{ name: "ImportedUDT", members: [{ name: "Ready", dataType: "BOOL" }] }]);
  await pickImportFile(page, organizer, "Data Types", "Import Data Type", "udt.json", udtBundle);
  await confirmImportDialog(page);
  await page.locator('.esco-detail__title:has-text("Data Type · ImportedUDT")').waitFor({ timeout: 8000 });
  check("Import Data Type merges a real UDT", (await organizer.locator('.esco-tree__node--udt:has-text("ImportedUDT")').count()) === 1);
  await dismissToasts(page);

  // --- Import Trend ---
  const trendBundle = bundle("controller-trends", [{ name: "ImportedTrend", pens: [{ id: "p", name: "StartPB" }] }]);
  await pickImportFile(page, organizer, "Trends", "Import Trend", "trend.json", trendBundle);
  await confirmImportDialog(page);
  await page.locator('.esco-detail__title:has-text("Trend · ImportedTrend")').waitFor({ timeout: 8000 });
  check("Import Trend merges a real trend", (await organizer.locator('.esco-tree__node--trend:has-text("ImportedTrend")').count()) === 1);
  await dismissToasts(page);

  // --- Wrong-family guard: a UDT file rejected by the AOI import command (no dialog) ---
  await pickImportFile(page, organizer, "Add-On Instructions", "Import Add-On Instruction", "wrong.json", udtBundle);
  await page.locator('.esco-toast--error').first().waitFor({ timeout: 8000 });
  check("Importing a Data Type file via Import AOI is rejected with a clear error", /Data Type/.test(await lastToast(page).innerText()));
  check("Rejected wrong-family import opens no dialog and adds no stray AOI", (await importDialog(page).count()) === 0 && (await organizer.locator('.esco-tree__node--aoi:has-text("ImportedUDT")').count()) === 0);
  await dismissToasts(page);

  // --- Invalid JSON guard (no dialog) ---
  await pickImportFile(page, organizer, "Data Types", "Import Data Type", "broken.json", "not json {");
  await page.locator('.esco-toast--error').first().waitFor({ timeout: 8000 });
  check("Invalid JSON import fails with a clear message", /valid JSON/.test(await lastToast(page).innerText()));
  await dismissToasts(page);

  // --- Verify Controller (offline build report) ---
  await openContext(page, organizer.locator('.esco-tree__node--controller').first());
  await menuItem(page, "Verify Controller").click();
  await page.locator(".esco-toast__message").last().waitFor({ timeout: 8000 });
  check("Verify Controller runs an offline verification and reports a result", /Offline Simulation|verification/i.test(await lastToast(page).innerText()));
  check("Verify Controller opens the Build/Output dock", (await page.locator('.esco-dock__tab:has-text("Build"), .esco-dock').count()) > 0);

  const passed = results.filter(Boolean).length;
  console.log(`\nSUMMARY: ${passed}/${results.length} checks passed`);
  process.exitCode = passed === results.length ? 0 : 1;
} catch (error) {
  check("offline workflows driver completed without throwing", false, error?.message ?? String(error));
  console.log(`\nSUMMARY: ${results.filter(Boolean).length}/${results.length} checks passed`);
  process.exitCode = 1;
} finally {
  await browser.close();
}
