// E2E: ESCO Exchange export/validate/import. This verifies the `.easx`
// workflow stays in the ESCO-native JSON family and restores only an offline
// editable project artifact.
import { chromium } from "playwright-core";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { URL, importStarterProject } from "./helpers.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const exchangePath = join(here, "validator-exchange.easx");
const tamperedExchangePath = join(here, "validator-exchange-tampered.easx");

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

async function exportExchange(page) {
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    clickFileMenuItem(page, "Export ESCO Exchange"),
  ]);
  await download.saveAs(exchangePath);
  return download.suggestedFilename();
}

async function importExchange(page, filePath) {
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    clickFileMenuItem(page, "Import ESCO Exchange"),
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

  const exchangeName = await exportExchange(page);
  check("Export ESCO Exchange produced a .easx artifact", exchangeName.endsWith(".easx"), exchangeName);
  await dismissToasts(page);

  const exchangeJson = JSON.parse(await readFile(exchangePath, "utf8"));
  check(
    "Exchange is an ESCO-native exchange envelope",
    exchangeJson.native?.kind === "exchange" &&
      exchangeJson.extension === ".easx" &&
      exchangeJson.payload?.exchangeKind === "editable-project-exchange",
    JSON.stringify({ kind: exchangeJson.native?.kind, extension: exchangeJson.extension, exchangeKind: exchangeJson.payload?.exchangeKind }),
  );
  check(
    "Exchange checksum matches the payload",
    exchangeJson.native.checksum.value === sha256(JSON.stringify(exchangeJson.payload)),
    exchangeJson.native.checksum.value,
  );
  check(
    "Exchange embeds one editable ESCO project artifact",
    exchangeJson.payload.artifact.path.endsWith(".easproj") &&
      exchangeJson.payload.artifact.format === "project" &&
      exchangeJson.payload.artifact.bytes === Buffer.byteLength(exchangeJson.payload.artifact.text, "utf8"),
    JSON.stringify({ path: exchangeJson.payload.artifact.path, bytes: exchangeJson.payload.artifact.bytes }),
  );
  check(
    "Exchange carries explicit offline boundaries",
    exchangeJson.payload.summary.boundaries.includes("no-controller-communication") &&
      exchangeJson.payload.summary.boundaries.includes("no-physical-upload-download") &&
      exchangeJson.payload.summary.boundaries.includes("no-online-edit") &&
      exchangeJson.payload.summary.boundaries.includes("no-proprietary-binary-project"),
    exchangeJson.payload.summary.boundaries.join(", "),
  );

  await validateFile(page, exchangePath);
  await page.locator('.esco-toast:has-text("Validated ESCO artifact")').waitFor({ timeout: 8000 });
  const validationToast = await page.locator(".esco-toast").last().innerText();
  check("Validator accepts a downloaded ESCO Exchange non-mutatingly", /checksum verified/i.test(validationToast), validationToast);
  await dismissToasts(page);

  await importExchange(page, exchangePath);
  await page.locator('.esco-toast:has-text("Imported ESCO Exchange")').waitFor({ timeout: 8000 });
  const titleAfter = await page.locator(".esco-titlebar__name").innerText();
  check("Exchange import restores the active project", titleAfter === titleBefore, titleAfter);
  check("Exchange import keeps the app offline", /Offline Simulation/i.test(await page.locator(".esco-statusbar__connection").innerText()));
  await dismissToasts(page);

  const tampered = {
    ...exchangeJson,
    payload: {
      ...exchangeJson.payload,
      artifact: {
        ...exchangeJson.payload.artifact,
        text: `${exchangeJson.payload.artifact.text}\n`,
      },
    },
  };
  await writeFile(tamperedExchangePath, JSON.stringify(tampered, null, 2));
  await validateFile(page, tamperedExchangePath);
  await page.locator('.esco-toast:has-text("checksum does not match")').waitFor({ timeout: 8000 });
  check("Validator rejects tampered ESCO Exchange payloads", /checksum does not match/i.test(await page.locator(".esco-toast").last().innerText()));

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
