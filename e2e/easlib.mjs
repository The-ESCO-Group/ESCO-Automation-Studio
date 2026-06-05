import { readFile } from "node:fs/promises";
import { chromium } from "playwright-core";
import { URL, dismissToasts, importStarterProject } from "./helpers.mjs";

const results = [];
const check = (label, cond, detail = "") => {
  results.push(!!cond);
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${detail ? "  - " + String(detail).replace(/\s+/g, " ").slice(0, 140) : ""}`);
};

const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, acceptDownloads: true });
const page = await context.newPage();
page.on("pageerror", (error) => console.log("PAGEERROR:", error.message));

try {
  await page.goto(URL, { waitUntil: "networkidle" });
  await importStarterProject(page);
  await dismissToasts(page);

  await page.locator('.esco-ribbon__tab:has-text("File")').click();
  const downloadPromise = page.waitForEvent("download");
  await page.locator('.esco-ribbon-menu__item:has-text("Export ESCO Library")').click();
  const download = await downloadPromise;
  const fileName = download.suggestedFilename();
  const path = await download.path();
  const text = path ? await readFile(path, "utf8") : "";
  const parsed = JSON.parse(text);
  const toastText = await page.locator(".esco-toast").last().innerText();

  check("Export ESCO Library produced a .easlib artifact", fileName.endsWith(".easlib"), fileName);
  check("library artifact uses ESCO-native library envelope", parsed.formatName === "ESCO Automation Library" && parsed.extension === ".easlib" && parsed.native?.kind === "library", text);
  check("library artifact embeds a valid-looking checksum", /^[0-9a-f]{64}$/.test(parsed.native?.checksum?.value ?? ""), parsed.native?.checksum?.value);
  check("library payload carries reusable offline project content counts", parsed.payload?.counts?.controllers === 1 && parsed.payload?.counts?.routines >= 1 && parsed.payload?.counts?.controllerTags >= 3, text);
  check("library payload keeps offline boundaries explicit", parsed.payload?.boundaries?.noProprietaryBinaryProjectFiles === true && parsed.payload?.boundaries?.noControllerTransfer === true && parsed.payload?.boundaries?.noControllerCommunication === true, text);
  check("library export toast names no controller transfer", /Exported ESCO Library/i.test(toastText) && /no controller transfer/i.test(toastText), toastText);

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
