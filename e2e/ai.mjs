import { chromium } from "playwright-core";
import { URL, clearAiProfileStorage, createBlankProject } from "./helpers.mjs";

const results = [];
const check = (label, cond, detail = "") => {
  results.push(!!cond);
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${detail ? "  - " + detail : ""}`);
};

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));

try {
  await page.goto(URL, { waitUntil: "networkidle" });
  await clearAiProfileStorage(page);
  await page.reload({ waitUntil: "networkidle" });
  await createBlankProject(page);

  check("old right-side Copilot tabs are not mounted in the Studio shell", (await page.locator(".esco-copilot__tab").count()) === 0);
  check("AI chat surface is absent from the first-viewport IDE", (await page.locator(".esco-ai, .esco-copilot-live").count()) === 0);
  check("no inline AI setup or API-key fields are exposed", (await page.locator(".esco-setup, input[type='password']").count()) === 0);
  check("Studio shell remains focused on organizer, ribbon, and editor", (
    await page.locator(".esco-controller-organizer").count()
  ) === 1 && (
    await page.locator(".esco-ribbon").count()
  ) === 1 && (
    await page.locator(".esco-editor__surface").count()
  ) === 1);

  const passed = results.filter(Boolean).length;
  console.log(`\nSUMMARY: ${passed}/${results.length} checks passed`);
  process.exitCode = passed === results.length ? 0 : 1;
} catch (err) {
  console.log("ERROR:", err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
