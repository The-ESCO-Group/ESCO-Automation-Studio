import { chromium } from "playwright-core";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { URL, addRungViaProjectMenu, importStarterProject, ribbonButton } from "./helpers.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const exportPath = join(here, "dirtystate-export.easproj");

const results = [];
const check = (l, c, d = "") => { results.push(!!c); console.log(`${c ? "PASS" : "FAIL"}  ${l}${d ? "  — " + d : ""}`); };
const titleText = (page) => page.locator(".esco-titlebar__name").innerText();
const isDirty = async (page) => /\*$/.test(await titleText(page));
const isSaved = async (page) => !/\*$/.test(await titleText(page));
const confirmationText = (page) => page.locator(".esco-confirmation").innerText();
const cancelConfirmation = async (page) => {
  await page.locator(".esco-confirmation").waitFor({ timeout: 8000 });
  await page.locator('.esco-confirmation .esco-btn:has-text("Cancel")').click();
  await page.locator(".esco-confirmation").waitFor({ state: "detached", timeout: 8000 });
};
const acceptConfirmation = async (page) => {
  await page.locator(".esco-confirmation").waitFor({ timeout: 8000 });
  await page.locator('.esco-confirmation .esco-btn--primary').click();
  await page.locator(".esco-confirmation").waitFor({ state: "detached", timeout: 8000 });
};

const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext({ viewport: { width: 1400, height: 950 }, acceptDownloads: true });
const page = await context.newPage();
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
try {
  await page.goto(URL, { waitUntil: "networkidle" });
  await importStarterProject(page);
  check("fresh project shows Saved", await isSaved(page));

  // An edit marks the project dirty.
  await addRungViaProjectMenu(page);
  await page.waitForFunction(() => /\*$/.test(document.querySelector(".esco-titlebar__name")?.textContent ?? ""));
  check("an edit marks the project Unsaved", await isDirty(page));

  // Undo back to the saved baseline marks it clean again.
  await ribbonButton(page, "Undo").click();
  await page.waitForFunction(() => !/\*$/.test(document.querySelector(".esco-titlebar__name")?.textContent ?? ""));
  check("undo back to baseline marks it Saved", await isSaved(page));

  // Redo -> dirty; export -> saved.
  await ribbonButton(page, "Redo").click();
  await page.waitForFunction(() => /\*$/.test(document.querySelector(".esco-titlebar__name")?.textContent ?? ""));
  check("redo marks it Unsaved again", await isDirty(page));

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    ribbonButton(page, "Save").click(),
  ]);
  await download.saveAs(exportPath);
  await page.waitForFunction(() => !/\*$/.test(document.querySelector(".esco-titlebar__name")?.textContent ?? ""));
  check("exporting marks the project Saved", await isSaved(page));

  // New Project is destructive when dirty, so the OK path must be guarded.
  await addRungViaProjectMenu(page);
  await page.waitForFunction(() => /\*$/.test(document.querySelector(".esco-titlebar__name")?.textContent ?? ""));
  const dirtyRungs = await page.locator(".esco-lad__rung").count();
  await ribbonButton(page, "New").click();
  await page.locator(".esco-new-project").waitFor({ timeout: 8000 });
  await page.locator('.esco-new-project .esco-btn--primary:has-text("OK")').click();
  const dismissText = await confirmationText(page);
  check("New Project warns before discarding dirty work", /Unsaved changes will be lost/i.test(dismissText), dismissText);
  await cancelConfirmation(page);
  const dialogStillOpen = (await page.locator(".esco-new-project").count()) === 1;
  const rungsAfterCancel = await page.locator(".esco-lad__rung").count();
  const stillDirtyAfterCancel = await isDirty(page);
  check(
    "canceling New Project keeps the dirty project open",
    dialogStillOpen && rungsAfterCancel === dirtyRungs && stillDirtyAfterCancel,
    `rungs=${rungsAfterCancel}`,
  );

  await page.locator('.esco-new-project .esco-btn--primary:has-text("OK")').click();
  await acceptConfirmation(page);
  await page.waitForFunction(() =>
    /Untitled Project.*\*$/.test(document.querySelector(".esco-titlebar__name")?.textContent ?? "") &&
    document.querySelectorAll(".esco-lad__rung").length === 1,
  );
  check("confirming New Project creates an unsaved blank project", await isDirty(page) && (await page.locator(".esco-lad__rung").count()) === 1);

  const [shortcutDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.keyboard.press("Control+S"),
  ]);
  check("Ctrl+S invokes the ESCO project Save command", shortcutDownload.suggestedFilename().endsWith(".easproj"), shortcutDownload.suggestedFilename());

  const passed = results.filter(Boolean).length;
  console.log(`\nSUMMARY: ${passed}/${results.length} checks passed`);
  process.exitCode = passed === results.length ? 0 : 1;
} catch (err) {
  console.log("ERROR:", err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
