import { chromium } from "playwright-core";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const URL = "http://localhost:5173/";
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

  // Select the StartPB tag in the Project Explorer.
  await page.locator('.esco-tree__node--tag:has-text("StartPB")').click();
  // Open the Cross Ref tab.
  await page.locator('.esco-dock__tab:has-text("Cross Ref")').click();

  await page.locator(".esco-xref__row").first().waitFor({ timeout: 5000 });
  const rowCount = await page.locator(".esco-xref__row").count();
  check("cross-ref shows StartPB references", rowCount >= 1, `rows=${rowCount}`);
  const head = await page.locator(".esco-xref__head").innerText();
  check("header names the tag", /StartPB/.test(head), head);
  const firstRow = await page.locator(".esco-xref__row").first().innerText();
  check("reference shows routine + instruction", /MainRoutine/.test(firstRow) && /XIC/.test(firstRow),
    firstRow.replace(/\s+/g, " "));
  await page.screenshot({ path: join(here, "xref1.png") });

  // Clicking a reference opens the routine.
  await page.locator(".esco-xref__row").first().click();
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
