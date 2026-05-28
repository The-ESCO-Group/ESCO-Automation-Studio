import { chromium } from "playwright-core";
import { readFileSync } from "node:fs";
import { URL, importStarterProject } from "./helpers.mjs";
const results = [];
const check = (l, c, d = "") => { results.push(!!c); console.log(`${c ? "PASS" : "FAIL"}  ${l}${d ? "  — " + d : ""}`); };
const rows = (page) => page.locator(".esco-tags__table tbody tr");

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
try {
  await page.goto(URL, { waitUntil: "networkidle" });
  await importStarterProject(page);
  await page.locator('.esco-activity-rail__button[aria-label="Tags"]').click();
  await page.locator(".esco-tags").waitFor({ timeout: 5000 });
  const initial = await rows(page).count();
  check("tag table lists existing tags", initial >= 3, `rows=${initial}`);

  // Add a tag (name is rendered as an editable input → match by value attr).
  await page.locator('.esco-tags__add input[placeholder="New tag name"]').fill("Lamp");
  await page.locator('.esco-tags__add button:has-text("Add Tag")').click();
  await page.waitForFunction((n) => document.querySelectorAll(".esco-tags__table tbody tr").length === n, initial + 1, { timeout: 5000 });
  check("add tag adds a row", (await rows(page).count()) === initial + 1);
  check("new Lamp tag present", (await page.locator('.esco-tags__table input[value="Lamp"]').count()) >= 1);

  // Referenced tag (StartPB) cannot be deleted; unused (Lamp) can.
  const startDelete = page.locator('.esco-tags__table tbody tr:has(input[value="StartPB"]) button:has-text("Delete")');
  check("referenced tag delete is disabled", await startDelete.isDisabled());
  const lampDelete = page.locator('.esco-tags__table tbody tr:has(input[value="Lamp"]) button:has-text("Delete")');
  check("unused tag delete is enabled", await lampDelete.isEnabled());
  await lampDelete.click();
  await page.waitForFunction((n) => document.querySelectorAll(".esco-tags__table tbody tr").length === n, initial, { timeout: 5000 });
  check("delete removes the row", (await rows(page).count()) === initial);

  // Search filter.
  await page.locator(".esco-tags__search").fill("Start");
  check("search filters rows", (await rows(page).count()) === 1);
  await page.locator(".esco-tags__search").fill("");

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.locator('.esco-tags__bar button:has-text("Export CSV")').click(),
  ]);
  const csvPath = await download.path();
  const csvText = csvPath ? readFileSync(csvPath, "utf-8") : "";
  check("tag CSV export downloads the expected file", /-tags\.csv$/i.test(download.suggestedFilename()) && /Scope,Program,Name,DataType/.test(csvText));

  await page.locator('input[type="file"][accept*=".csv"]').setInputFiles({
    name: "tags-import.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("Name,DataType,Scope,Program,Description,AliasFor,Dimension\nCsvLamp,BOOL,controller,,Imported from CSV,,\n"),
  });
  await page.locator(".esco-tagcsv").waitFor({ timeout: 5000 });
  const previewText = await page.locator(".esco-tagcsv").innerText();
  check("tag CSV import preview shows created tag", /CsvLamp/.test(previewText) && /1 create/.test(previewText));
  await page.locator('.esco-tagcsv button:has-text("Apply CSV")').click();
  await page.locator(".esco-tagcsv").waitFor({ state: "detached", timeout: 5000 });
  await page.locator(".esco-tags__search").fill("CsvLamp");
  check("tag CSV apply adds imported tag", (await rows(page).count()) === 1 && (await page.locator('.esco-tags__table input[value="CsvLamp"]').count()) === 1);

  const passed = results.filter(Boolean).length;
  console.log(`\nSUMMARY: ${passed}/${results.length} checks passed`);
  process.exitCode = passed === results.length ? 0 : 1;
} catch (err) {
  console.log("ERROR:", err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
