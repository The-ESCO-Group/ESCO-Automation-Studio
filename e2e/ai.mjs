import { chromium } from "playwright-core";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { URL, clearAiProfileStorage, createBlankProject } from "./helpers.mjs";

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
  await clearAiProfileStorage(page);
  await page.reload({ waitUntil: "networkidle" });
  await createBlankProject(page);

  // Open the AI Copilot chat tab in the right panel.
  await page.locator('.esco-copilot__tab:has-text("Chat")').click();
  check("AI Copilot chat opens", (await page.locator(".esco-ai").count()) === 1);

  // Without first-run setup, quick prompts open Settings and no network call is made.
  await page.locator('button:has-text("Explain this routine")').click();
  await page.locator(".esco-setup").waitFor({ timeout: 5000 });
  check("quick prompt opens first-run setup when no API key is saved", (await page.locator(".esco-setup").count()) === 1);
  await page.screenshot({ path: join(here, "ai1-preview.png") });
  await page.locator('.esco-setup button[aria-label="Close setup"]').click();

  // Typed sends short-circuit locally until setup is complete.
  await page.locator(".esco-copilot-live .esco-ai__prompt textarea").fill("Explain this routine");
  await page.locator('.esco-copilot-live .esco-ai__prompt button:has-text("Send")').click();
  await page.locator(".esco-ai__applied--error").waitFor({ timeout: 5000 });
  const message = await page.locator(".esco-ai__applied--error").innerText();
  check("missing setup blocks live send locally", /Settings|API key/i.test(message), message.trim());
  check("no AI plan is applied without setup", (await page.locator(".esco-ai__plan").count()) === 0);
  check("routine remains unchanged", (await page.locator(".esco-lad__rung").count()) === 0);
  await page.screenshot({ path: join(here, "ai2-applied.png") });

  const passed = results.filter(Boolean).length;
  console.log(`\nSUMMARY: ${passed}/${results.length} checks passed`);
  process.exitCode = passed === results.length ? 0 : 1;
} catch (err) {
  console.log("ERROR:", err.message);
  await page.screenshot({ path: join(here, "ai99-error.png") }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
