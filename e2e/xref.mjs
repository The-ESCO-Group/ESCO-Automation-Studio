import { chromium } from "playwright-core";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { URL, importStarterProject, openDockPanel } from "./helpers.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const results = [];
const check = (label, cond, detail = "") => {
  results.push(!!cond);
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${detail ? "  — " + detail : ""}`);
};

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));

try {
  await page.goto(URL, { waitUntil: "networkidle" });
  await importStarterProject(page);

  await page.locator('.esco-tree__node--routine:has-text("MainRoutine")').first().click();
  await page.locator('.esco-lad__operand[title="StartPB"]').first().click({ button: "right" });
  await page.locator('.esco-context-menu__item:has-text("Cross Reference")').click();

  await page.locator(".esco-xref__row").first().waitFor({ timeout: 5000 });
  const rowCount = await page.locator(".esco-xref__row").count();
  check("cross-ref shows StartPB references", rowCount >= 1, `rows=${rowCount}`);
  const head = await page.locator(".esco-xref__head").innerText();
  check("header names the tag", /StartPB/.test(head), head);
  const firstRow = await page.locator(".esco-xref__row").first().innerText();
  check("reference shows routine + instruction", /MainRoutine/.test(firstRow) && /XIC/.test(firstRow),
    firstRow.replace(/\s+/g, " "));
  check("reference classifies ladder reads", /read/i.test(firstRow), firstRow.replace(/\s+/g, " "));
  await page.screenshot({ path: join(here, "xref1.png") });

  await page.locator('.esco-xref__head button:has-text("Watch")').click();
  await page.locator('.esco-dock__tab.is-active:has-text("Watch")').waitFor({ timeout: 5000 });
  check("cross-ref Watch button opens watch on the selected tag", (await page.locator('.esco-watch tr:has-text("StartPB")').count()) >= 1);

  await openDockPanel(page, "Cross Reference");
  await page.locator('.esco-xref__head button:has-text("Force")').click();
  await page.locator('.esco-dock__tab.is-active:has-text("Forces")').waitFor({ timeout: 5000 });
  check("cross-ref Force button creates an offline force", (await page.locator('.esco-forces tr:has-text("StartPB")').count()) === 1);

  await openDockPanel(page, "Cross Reference");
  const forceRow = page.locator('.esco-xref__row:has-text("Force table")');
  await forceRow.first().waitFor({ timeout: 5000 });
  check("cross-ref classifies active offline forces", /Force/.test(await forceRow.first().innerText()));

  await openDockPanel(page, "Cross Reference");
  // Clicking a reference opens the routine.
  await page.locator('.esco-xref__row button:has-text("Open")').first().click();
  const editorTab = await page.locator(".esco-editor__tab.is-active").innerText();
  check("clicking a reference opens the routine", /MainRoutine/.test(editorTab), editorTab);

  const passed = results.filter(Boolean).length;
  console.log(`\nSUMMARY: ${passed}/${results.length} checks passed`);
  process.exitCode = passed === results.length ? 0 : 1;
} catch (err) {
  console.log("ERROR:", err.message);
  await page.screenshot({ path: join(here, "xref99-error.png") }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
