// E2E: ESCO offline project snapshot export/validate/import. This verifies the
// .eassnap workflow stays in the ESCO-native JSON family and never opens a
// controller connection, upload/download path, or online edit.
import { chromium } from "playwright-core";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFile } from "node:fs/promises";
import { URL, importStarterProject } from "./helpers.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const snapshotPath = join(here, "validator-snapshot.eassnap");

const results = [];
const check = (label, condition, detail = "") => {
  results.push(!!condition);
  console.log(`${condition ? "PASS" : "FAIL"}  ${label}${detail ? " - " + String(detail).replace(/\s+/g, " ").slice(0, 160) : ""}`);
};

const sha256 = (text) => createHash("sha256").update(text, "utf8").digest("hex");
const fileMenuItem = (page, label) => page.locator(`.esco-ribbon-menu__item:has-text("${label}")`).first();

async function clickFileMenuItem(page, label) {
  await page.locator('.esco-ribbon__tab:has-text("File")').click();
  await page.locator(".esco-ribbon-menu").waitFor({ timeout: 5000 });
  await fileMenuItem(page, label).click();
}

async function dismissToasts(page) {
  while ((await page.locator(".esco-toast__close").count()) > 0) {
    await page.locator(".esco-toast__close").first().click();
  }
}

async function continueIfPrompted(page) {
  const confirm = page.locator(".esco-confirmation");
  if ((await confirm.count()) === 0) return;
  await confirm.locator('button:has-text("Continue")').click();
}

async function validateFile(page, filePath) {
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    clickFileMenuItem(page, "Validate ESCO Package / Runtime Files"),
  ]);
  await chooser.setFiles(filePath);
}

async function exportSnapshot(page) {
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    clickFileMenuItem(page, "Export ESCO Snapshot"),
  ]);
  await download.saveAs(snapshotPath);
  return download.suggestedFilename();
}

async function importSnapshot(page, filePath) {
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    clickFileMenuItem(page, "Import ESCO Snapshot"),
  ]);
  await chooser.setFiles(filePath);
  await continueIfPrompted(page);
}

const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext({ viewport: { width: 1400, height: 950 }, acceptDownloads: true });
const page = await context.newPage();
page.on("pageerror", (error) => console.log("PAGEERROR:", error.message));

try {
  await page.goto(URL, { waitUntil: "networkidle" });
  await importStarterProject(page);
  await dismissToasts(page);
  const titleBefore = await page.locator(".esco-titlebar__name").innerText();

  const snapshotName = await exportSnapshot(page);
  check("Export ESCO Snapshot produced a .eassnap artifact", snapshotName.endsWith(".eassnap"), snapshotName);
  await dismissToasts(page);

  const snapshotJson = JSON.parse(await readFile(snapshotPath, "utf8"));
  check(
    "Snapshot is an ESCO-native snapshot envelope",
    snapshotJson.native?.kind === "snapshot" &&
      snapshotJson.extension === ".eassnap" &&
      snapshotJson.payload?.snapshotKind === "offline-project-snapshot",
    JSON.stringify({ kind: snapshotJson.native?.kind, extension: snapshotJson.extension, snapshotKind: snapshotJson.payload?.snapshotKind }),
  );
  check(
    "Snapshot checksum matches the payload",
    snapshotJson.native.checksum.value === sha256(JSON.stringify(snapshotJson.payload)),
    snapshotJson.native.checksum.value,
  );
  check(
    "Snapshot carries explicit offline boundaries",
    snapshotJson.payload.summary.boundaries.includes("no-controller-communication") &&
      snapshotJson.payload.summary.boundaries.includes("no-physical-upload-download") &&
      snapshotJson.payload.summary.boundaries.includes("no-online-edit"),
    snapshotJson.payload.summary.boundaries.join(", "),
  );

  await validateFile(page, snapshotPath);
  await page.locator('.esco-toast:has-text("Validated ESCO artifact")').waitFor({ timeout: 8000 });
  const validationToast = await page.locator(".esco-toast").last().innerText();
  check("Validator accepts a downloaded ESCO Snapshot non-mutatingly", /snapshot|checksum verified/i.test(validationToast), validationToast);
  await dismissToasts(page);

  await importSnapshot(page, snapshotPath);
  await page.locator('.esco-toast:has-text("Imported ESCO Snapshot")').waitFor({ timeout: 8000 });
  const titleAfter = await page.locator(".esco-titlebar__name").innerText();
  check("Snapshot import restores the active project", titleAfter === titleBefore, titleAfter);
  check("Snapshot import keeps the app offline", /Offline(?: Simulation)?/i.test(await page.locator(".esco-statusbar__connection").innerText()));

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
