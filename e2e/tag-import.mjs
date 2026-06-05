import { chromium } from "playwright-core";
import { readFile } from "node:fs/promises";
import { URL, importStarterProject } from "./helpers.mjs";

// Roundtrip: export one Tag component from the tag grid, then re-import the
// same `.esco-tag.json` through the Controller Tags organizer menu.

const results = [];
const check = (label, condition, detail = "") => {
  results.push(!!condition);
  console.log(`${condition ? "PASS" : "FAIL"}  ${label}${detail ? "  - " + String(detail).replace(/\s+/g, " ").slice(0, 160) : ""}`);
};

const contextCommand = async (page, targetSelector, commandText) => {
  await page.locator(targetSelector).first().click({ button: "right" });
  await page.locator(".esco-context-menu--organizer").waitFor({ timeout: 5000 });
  await page.locator(`.esco-context-menu__item:has-text("${commandText}")`).click();
};

const openTags = async (page) => {
  await page.locator('.esco-left :text("Controller Tags")').first().click();
  await page.locator(".esco-tags").waitFor({ timeout: 5000 });
};

const tagRowCount = (page, tagName) => page.locator(`.esco-tags__table tbody tr:has(input[value="${tagName}"])`).count();

const importTagFile = async (page, file) => {
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    contextCommand(page, '.esco-tree__group--button:has-text("Controller Tags")', "Import Tag Component"),
  ]);
  await chooser.setFiles(file);
  await page.locator("#esco-import-title").waitFor({ timeout: 8000 });
};

const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext({ viewport: { width: 1400, height: 950 }, acceptDownloads: true });
const page = await context.newPage();
await page.addInitScript(() => window.localStorage.removeItem("esco.tags.filter"));
page.on("pageerror", (error) => console.log("PAGEERROR:", error.message));

try {
  await page.goto(URL, { waitUntil: "networkidle" });
  await importStarterProject(page);
  await openTags(page);

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.locator('.esco-tags__table tbody tr:has(input[value="StartPB"]) button[aria-label="Export StartPB"]').click(),
  ]);
  const exportPath = await download.path();
  const envelope = JSON.parse(exportPath ? await readFile(exportPath, "utf8") : "{}");
  check(
    "Tag grid exports an ESCO tag component envelope",
    download.suggestedFilename() === "StartPB.esco-tag.json" &&
      envelope.kind === "tag" &&
      envelope.payload?.name === "StartPB" &&
      envelope.owner?.type === "controller",
    JSON.stringify({ filename: download.suggestedFilename(), kind: envelope.kind, owner: envelope.owner }),
  );

  await importTagFile(page, exportPath);
  check(
    "Re-importing StartPB opens a Controller Tags conflict dialog",
    (await page.locator('.esco-modal__panel:has-text("Tag import")').count()) === 1 &&
      (await page.locator('.esco-modal__panel:has-text("Controller Tags")').count()) === 1 &&
      (await page.locator('.esco-tagcsv__row--rename:has-text("StartPB")').count()) === 1,
  );

  const resolution = page.locator('select[aria-label="Resolution for StartPB"]');
  const applyButton = page.locator('.esco-modal__footer .esco-btn--primary:has-text("Import components")');
  await resolution.selectOption("skip");
  check("Skipping the only Tag disables Import", await applyButton.isDisabled());

  await resolution.selectOption("rename");
  await page.locator('input[aria-label="Rename StartPB to"]').fill("StartPB_Imported");
  await applyButton.click();
  await page.locator("#esco-import-title").waitFor({ state: "detached", timeout: 8000 });
  await page.locator(".esco-tags").waitFor({ timeout: 8000 });
  await page.locator(".esco-tags__search").fill("StartPB_Imported");
  check("Rename imports StartPB_Imported into Controller Tags", (await tagRowCount(page, "StartPB_Imported")) === 1);

  await page.locator(".esco-tags__search").fill("");
  await importTagFile(page, exportPath);
  await page.locator('select[aria-label="Resolution for StartPB"]').selectOption("overwrite");
  await page.locator('.esco-modal__footer .esco-btn--primary:has-text("Import components")').click();
  await page.locator("#esco-import-title").waitFor({ state: "detached", timeout: 8000 });
  await page.locator(".esco-tags__search").fill("StartPB");
  check(
    "Overwrite replaces StartPB without adding another imported copy",
    (await tagRowCount(page, "StartPB")) === 1 && (await tagRowCount(page, "StartPB_Imported")) === 1,
  );

  const passed = results.filter(Boolean).length;
  console.log(`\nSUMMARY: ${passed}/${results.length} checks passed`);
  process.exitCode = passed === results.length ? 0 : 1;
} catch (error) {
  console.log("ERROR:", error.message);
  process.exitCode = 1;
} finally {
  await context.close();
  await browser.close();
}
