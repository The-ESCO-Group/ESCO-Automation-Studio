import { chromium } from "playwright-core";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { URL, acceptConfirmation, importStarterProject, openDockPanel, readConfirmationText } from "./helpers.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const results = [];
const check = (label, cond, detail = "") => {
  results.push(!!cond);
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${detail ? " - " + detail : ""}`);
};

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));

async function createSearchDescriptionTag() {
  await page.locator('.esco-left :text("Controller Tags")').first().click({ button: "right" });
  await page.locator('.esco-context-menu__item:has-text("New Tag")').click();
  const dialog = page.locator('.esco-modal__panel[aria-label="New Tag"]');
  await dialog.waitFor({ timeout: 8000 });
  await dialog.locator('label:has-text("Name") input').fill("PumpNote");
  await dialog.locator('label:has-text("Description") textarea').fill("Pump helper note");
  await dialog.locator('.esco-btn--primary:has-text("OK")').click();
  await dialog.waitFor({ state: "detached", timeout: 8000 });
}

try {
  await page.goto(URL, { waitUntil: "networkidle" });
  await importStarterProject(page);
  await createSearchDescriptionTag();

  await openDockPanel(page, "Search Results");
  const searchInput = page.locator('.esco-search input[type="search"]');
  const replaceInput = page.locator(".esco-search__input--replace");

  await searchInput.fill("Pump");
  await page.locator(".esco-search table tbody tr").first().waitFor({ timeout: 5000 });
  await replaceInput.fill("Mixer");
  await page.locator('.esco-search__bar button:has-text("Replace All")').click();
  const confirmation = await readConfirmationText(page);
  check("Replace All asks for confirmation", /Replace \d+ mutable text/.test(confirmation), confirmation);
  await acceptConfirmation(page);
  await searchInput.fill("Mixer");
  await page.locator(".esco-search table tbody tr").first().waitFor({ timeout: 5000 });
  check("Replace All updates mutable text fields", /Mixer helper note/.test(await page.locator(".esco-search").innerText()));

  await searchInput.fill("MotorRun");
  await page.locator(".esco-search table tbody tr").first().waitFor({ timeout: 5000 });
  const resultCount = await page.locator(".esco-search table tbody tr").count();
  check("Search Results finds tag and ladder operand hits", resultCount >= 2, `rows=${resultCount}`);

  await page.locator('.esco-search__bar button:has-text("Find Next")').click();
  await page.locator(".esco-search tr.is-active").waitFor({ timeout: 5000 });
  check("Find Next selects an active search result", /MotorRun/.test(await page.locator(".esco-search tr.is-active").innerText()));

  await page.locator('.esco-search__bar button:has-text("Find Next")').click();
  await page.locator(".esco-search tr.is-active").waitFor({ timeout: 5000 });
  check("Find Next opens the owning routine", /MainRoutine/.test(await page.locator(".esco-editor__tab.is-active").innerText()));

  await page.locator('.esco-search__bar button:has-text("Previous")').click();
  await page.locator(".esco-search tr.is-active").waitFor({ timeout: 5000 });
  check("Find Previous keeps navigation inside the result set", /MotorRun/.test(await page.locator(".esco-search tr.is-active").innerText()));

  await page.locator('.esco-search tr:has-text("MotorRun") button:has-text("Watch")').first().click();
  await page.locator('.esco-dock__tab.is-active:has-text("Watch")').waitFor({ timeout: 5000 });
  check("Search hit Watch opens the watch table on the tag", (await page.locator('.esco-watch tr:has-text("MotorRun")').count()) >= 1);

  await openDockPanel(page, "Search Results");
  await page.locator('.esco-search tr:has-text("MotorRun") button:has-text("Force")').first().click();
  await page.locator('.esco-dock__tab.is-active:has-text("Forces")').waitFor({ timeout: 5000 });
  check("Search hit Force creates an offline force row", (await page.locator('.esco-forces tr:has-text("MotorRun")').count()) === 1);

  await openDockPanel(page, "Search Results");
  await page.locator('.esco-search tr:has-text("MotorRun") button:has-text("XRef")').first().click();
  await page.locator(".esco-xref__row").first().waitFor({ timeout: 5000 });
  check("Search hit XRef opens cross reference on the tag", /MotorRun/.test(await page.locator(".esco-xref__head").innerText()));
  check("Cross reference classifies ladder output references", /output/i.test(await page.locator(".esco-xref__row").first().innerText()));

  await openDockPanel(page, "Search Results");
  await page.locator('.esco-search tr:has-text("rung") button:has-text("Open")').first().click();
  check("Search hit Open navigates to the result", /MainRoutine/.test(await page.locator(".esco-editor__tab.is-active").innerText()));

  await page.screenshot({ path: join(here, "search1.png") });

  const passed = results.filter(Boolean).length;
  console.log(`\nSUMMARY: ${passed}/${results.length} checks passed`);
  process.exitCode = passed === results.length ? 0 : 1;
} catch (err) {
  console.log("ERROR:", err.message);
  await page.screenshot({ path: join(here, "search99-error.png") }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
