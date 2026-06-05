import { chromium } from "playwright-core";
import { URL, importStarterProject } from "./helpers.mjs";

const results = [];
const check = (label, cond, detail = "") => {
  results.push(!!cond);
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${detail ? "  - " + String(detail).replace(/\s+/g, " ").slice(0, 120) : ""}`);
};

const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
const page = await context.newPage();
page.on("pageerror", (error) => console.log("PAGEERROR:", error.message));

try {
  await page.goto(URL, { waitUntil: "networkidle" });
  await importStarterProject(page);

  await page.locator('.esco-ribbon__tab:has-text("File")').click();
  await page.locator(".esco-ribbon-menu").waitFor({ timeout: 5000 });
  await page.locator(".esco-ribbon-menu__item").filter({ hasText: /^Build ESCO Runtime$/ }).first().click();

  await page.locator('.esco-dock__tab.is-active:has-text("Build")').waitFor({ timeout: 5000 });
  await page.locator('[aria-label="ESCO Runtime build preview"]:not(.is-empty)').waitFor({ timeout: 5000 });

  const runtimePreview = page.locator('[aria-label="ESCO Runtime build preview"]').first();
  const previewText = await runtimePreview.innerText();
  const checksum = (await runtimePreview.locator(".esco-runtime-preview__stats code").first().innerText()).trim();
  check("Build ESCO Runtime opens Build dock preview", /ESCO Runtime Build/.test(previewText), previewText);
  check("runtime preview names the generated .easruntime artifact", /e2e-starter\.easruntime/i.test(previewText), previewText);
  check("runtime preview exposes checksum", /^[0-9a-f]{16}\.\.\.$/.test(checksum), checksum);
  check(
    "runtime preview exposes compiled model counts",
    /Controllers\s+1/.test(previewText) &&
      /Programs\s+1/.test(previewText) &&
      /Routines\s+1/.test(previewText) &&
      /Tags\s+3/.test(previewText),
    previewText,
  );
  check("runtime preview exposes instruction-fidelity counts", /Instruction fidelity/.test(previewText) && /executable offline/.test(previewText), previewText);
  check("runtime preview keeps physical-controller boundary visible", /Physical-controller transfer remains guarded/.test(previewText), previewText);
  check(
    "runtime preview exposes export and ESCO SoftController handoff actions",
    (await runtimePreview.locator('button:has-text("Export Runtime")').count()) === 1 &&
      (await runtimePreview.locator('button:has-text("Download to ESCO SoftController")').count()) === 1,
    previewText,
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
