import { chromium } from "playwright-core";
import { URL, createBlankProject, dismissToasts } from "./helpers.mjs";

const results = [];
const check = (l, c, d = "") => { results.push(!!c); console.log(`${c ? "PASS" : "FAIL"}  ${l}${d ? "  - " + d : ""}`); };

const openDeviceTagsDialog = async (page) => {
  await page.locator('.esco-left :text("Controller Tags")').first().click({ button: "right" });
  await page.locator('.esco-context-menu__item:has-text("Generate Device Tags")').first().click();
  await page.locator('.esco-modal__panel[aria-label="Generate Device Tags"]').waitFor({ timeout: 8000 });
};

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));

try {
  await page.goto(URL, { waitUntil: "networkidle" });
  await createBlankProject(page);

  // Open the dialog from the Controller Tags context menu.
  await openDeviceTagsDialog(page);
  check("Generate Device Tags dialog opens from the explorer", true);

  const dialog = page.locator('.esco-modal__panel[aria-label="Generate Device Tags"]');
  await dialog.locator('label:has-text("Prefix") input').fill("P101");

  // The live preview lists the vendor-neutral motor tag plan.
  await page.locator('.esco-device-tags__list:has-text("P101_Run")').waitFor({ timeout: 8000 });
  const plannedCount = await dialog.locator(".esco-device-tags__list li").count();
  check("preview lists the planned device tags", plannedCount >= 5, `${plannedCount} tags`);

  // Generate, expect a success toast and the dialog to close.
  await dialog.locator('.esco-btn--primary:has-text("Generate")').click();
  await dialog.waitFor({ state: "detached", timeout: 8000 });
  const toastText = await page.locator(".esco-toast").first().innerText().catch(() => "");
  check("generation reports a success toast", /Generated\s+\d+\s+tag/i.test(toastText), toastText.replace(/\n/g, " "));
  await dismissToasts(page);

  // Re-open with the same prefix: the previously created tags are now marked existing.
  await openDeviceTagsDialog(page);
  await page.locator('.esco-modal__panel[aria-label="Generate Device Tags"] label:has-text("Prefix") input').fill("P101");
  await page.locator('.esco-device-tags__list li.is-existing').first().waitFor({ timeout: 8000 });
  const existingCount = await page.locator('.esco-device-tags__list li.is-existing').count();
  check("re-opening shows the generated tags as existing (skip-not-overwrite)", existingCount >= 5, `${existingCount} existing`);

  const passed = results.filter(Boolean).length;
  console.log(`\nSUMMARY: ${passed}/${results.length} checks passed`);
  process.exitCode = passed === results.length ? 0 : 1;
} catch (err) {
  console.log("ERROR:", err.stack || err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
