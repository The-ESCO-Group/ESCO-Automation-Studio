// E2E: Controller Organizer asset creation parity.
// Right-clicks the controller asset folders and verifies the commands create
// real project objects that open in the Structure detail view.
import { chromium } from "playwright-core";
import { URL, STARTER_L5X, acceptConfirmation, dismissToasts, importL5XText } from "./helpers.mjs";

const results = [];
const check = (label, cond, detail = "") => {
  results.push(!!cond);
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${detail ? "  - " + String(detail).replace(/\s+/g, " ").slice(0, 130) : ""}`);
};

const menu = (page) => page.locator(".esco-context-menu--organizer").first();
const menuItem = (page, label) => page.locator(`.esco-context-menu__item:has-text("${label}")`).first();

async function openContext(page, locator) {
  await locator.first().scrollIntoViewIfNeeded();
  await locator.first().click({ button: "right" });
  await menu(page).waitFor({ timeout: 8000 });
  return menu(page).innerText();
}

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
page.on("pageerror", (error) => console.log("PAGEERROR:", error.message));
page.setDefaultTimeout(10000);

try {
  await page.goto(URL, { waitUntil: "networkidle" });
  await importL5XText(page, STARTER_L5X, "organizer-assets.L5X");
  await dismissToasts(page);

  const organizer = page.locator(".esco-controller-organizer");

  const aoiMenu = await openContext(page, organizer.locator(':text("Add-On Instructions")'));
  check("Add-On Instructions root exposes create/import/export", /New Add-On Instruction/.test(aoiMenu) && /Import Add-On Instruction/.test(aoiMenu) && /Export Add-On Instructions/.test(aoiMenu), aoiMenu);
  await menuItem(page, "New Add-On Instruction").click();
  await page.locator('.esco-detail__title:has-text("Add-On Instruction · AOI_1")').waitFor({ timeout: 8000 });
  check("New Add-On Instruction creates and opens AOI_1", (await organizer.locator('.esco-tree__node--aoi:has-text("AOI_1")').count()) === 1);
  check(
    "New AOI opens editable parameter/local-tag detail",
    (await page.locator('input[aria-label="New parameter name"]').count()) === 1 &&
      (await page.locator('input[aria-label="New local tag name"]').count()) === 1,
  );

  const aoiNode = organizer.locator('.esco-tree__node--aoi:has-text("AOI_1")');
  const aoiItemMenu = await openContext(page, aoiNode);
  check(
    "AOI item exposes definition/properties/signature/export/delete",
    /Open Definition/.test(aoiItemMenu) &&
      /Properties/.test(aoiItemMenu) &&
      /Signature \/ Source Protection/.test(aoiItemMenu) &&
      /Export Custom Instruction/.test(aoiItemMenu) &&
      /Delete/.test(aoiItemMenu),
    aoiItemMenu,
  );
  await menuItem(page, "Signature / Source Protection").click();
  const aoiProtection = page.locator('.esco-detail__section[aria-label="AOI signature and source protection review"]');
  await aoiProtection.waitFor({ timeout: 8000 });
  const aoiProtectionText = await aoiProtection.innerText();
  check(
    "AOI signature/source protection opens real metadata review",
    /Signature ID/.test(aoiProtectionText) && /Source protected\s+no/.test(aoiProtectionText),
    aoiProtectionText,
  );

  const dataTypeMenu = await openContext(page, organizer.locator(':text("Data Types")').first());
  check("Data Types root exposes create/import/export", /New Data Type/.test(dataTypeMenu) && /Import Data Type/.test(dataTypeMenu) && /Export Data Types/.test(dataTypeMenu), dataTypeMenu);
  await menuItem(page, "New Data Type").click();
  await page.locator('.esco-detail__title:has-text("Data Type · UDT_1")').waitFor({ timeout: 8000 });
  check("New Data Type creates and opens UDT_1", (await organizer.locator('.esco-tree__node--udt:has-text("UDT_1")').count()) === 1);
  check("New UDT opens editable member detail", (await page.locator('input[aria-label="New member name"]').count()) === 1);

  const udtNode = organizer.locator('.esco-tree__node--udt:has-text("UDT_1")');
  const udtItemMenu = await openContext(page, udtNode);
  check(
    "UDT item exposes definition/properties/export/delete",
    /Open Definition/.test(udtItemMenu) &&
      /Properties/.test(udtItemMenu) &&
      /Export Data Type/.test(udtItemMenu) &&
      /Delete/.test(udtItemMenu),
    udtItemMenu,
  );
  await menuItem(page, "Properties").click();
  await page.locator('.esco-detail__title:has-text("Data Type · UDT_1")').waitFor({ timeout: 8000 });
  check("UDT Properties reopens editable data type detail", (await page.locator('input[aria-label="New member name"]').count()) === 1);

  const trendMenu = await openContext(page, organizer.locator(':text("Trends")').first());
  check("Trends root exposes create/import/export", /New Trend/.test(trendMenu) && /Import Trend/.test(trendMenu) && /Export Trends/.test(trendMenu), trendMenu);
  await menuItem(page, "New Trend").click();
  await page.locator('.esco-detail__title:has-text("Trend · Trend_1")').waitFor({ timeout: 8000 });
  const trendDetail = await page.locator(".esco-detail").innerText();
  check("New Trend creates and opens Trend_1", (await organizer.locator('.esco-tree__node--trend:has-text("Trend_1")').count()) === 1);
  check("New Trend seeds a usable first pen from controller tags", /Pens\s+1|Pens \(1\)|StartPB/.test(trendDetail), trendDetail);

  const trendNode = organizer.locator('.esco-tree__node--trend:has-text("Trend_1")');
  const trendItemMenu = await openContext(page, trendNode);
  check("Trend item exposes open/properties/export/delete", /Open/.test(trendItemMenu) && /Trend Properties/.test(trendItemMenu) && /Export Trend/.test(trendItemMenu) && /Delete/.test(trendItemMenu), trendItemMenu);
  await menuItem(page, "Trend Properties").click();
  await page.locator('.esco-detail__title:has-text("Trend · Trend_1")').waitFor({ timeout: 8000 });
  check("Trend Properties reopens the trend detail view", true);

  await openContext(page, trendNode);
  await menuItem(page, "Delete").click();
  await acceptConfirmation(page);
  await page.locator('.esco-detail__title:has-text("Controller")').waitFor({ timeout: 8000 });
  check("Trend Delete removes Trend_1 and returns to controller detail", (await organizer.locator('.esco-tree__node--trend:has-text("Trend_1")').count()) === 0);

  const passed = results.filter(Boolean).length;
  console.log(`\nSUMMARY: ${passed}/${results.length} checks passed`);
  process.exitCode = passed === results.length ? 0 : 1;
} catch (error) {
  check("organizer asset driver completed without throwing", false, error?.message ?? String(error));
  process.exitCode = 1;
} finally {
  await browser.close();
}
