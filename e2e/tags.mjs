import { chromium } from "playwright-core";
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
  await page.screenshot({ path: "C:/Users/nmodha/Projects/esco-e2e/tags1.png" });

  const passed = results.filter(Boolean).length;
  console.log(`\nSUMMARY: ${passed}/${results.length} checks passed`);
  process.exitCode = passed === results.length ? 0 : 1;
} catch (err) {
  console.log("ERROR:", err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
