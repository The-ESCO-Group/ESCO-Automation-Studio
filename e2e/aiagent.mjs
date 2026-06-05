import { chromium } from "playwright-core";
import { URL, clearAiProfileStorage } from "./helpers.mjs";

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

  check("Copilot live-agent panel is not part of the ESCO IDE chrome", (await page.locator(".esco-copilot-live").count()) === 0);
  check("old setup badge/provider controls are absent", (
    await page.locator(".esco-copilot__badge, .esco-copilot__provider select, .esco-ai__footer").count()
  ) === 0);
  check("no AI prompt can transmit project context from the landing workspace", (await page.locator(".esco-ai__prompt textarea").count()) === 0);
  check("offline IDE still exposes the classic menu bar", /File\s+Edit\s+View\s+Search\s+Logic\s+Communications\s+Tools/.test(await page.locator(".esco-ribbon").innerText()));

  const passed = results.filter(Boolean).length;
  console.log(`\nSUMMARY: ${passed}/${results.length} checks passed`);
  process.exitCode = passed === results.length ? 0 : 1;
} catch (err) {
  console.log("ERROR:", err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
