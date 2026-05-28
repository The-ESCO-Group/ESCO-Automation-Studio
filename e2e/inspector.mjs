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

const rail = (page, label) =>
  page.locator(`.esco-inspector__tab:has-text("${label}")`);

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));

try {
  await page.goto(URL, { waitUntil: "networkidle" });

  // The right inspector renders a five-tab vertical rail.
  check("inspector rail has five tabs", (await page.locator(".esco-inspector__tab").count()) === 5);

  // AI is no longer in the bottom dock — it moved to the inspector.
  check("AI removed from bottom dock", (await page.locator('.esco-dock__tab:has-text("AI Assistant")').count()) === 0);
  check("bottom dock has a Forces tab", (await page.locator('.esco-dock__tab:has-text("Forces")').count()) === 1);

  // Open the demo routine so the model summary has content.
  await page.locator('button:has-text("MainRoutine")').first().click();
  await page.locator(".esco-lad__rung").first().waitFor({ timeout: 5000 });

  // Model summary tab: project identity + counts.
  await rail(page, "Model").click();
  await page.locator(".esco-model").waitFor({ timeout: 5000 });
  const modelText = await page.locator(".esco-model").innerText();
  check("model summary shows controller", /DemoController/.test(modelText));
  check("model summary lists routine count", /Routines/.test(modelText));
  check("model summary reports health pills", (await page.locator(".esco-model__pill").count()) >= 3);

  // History tab: edit state + activity log.
  await rail(page, "History").click();
  await page.locator(".esco-history").waitFor({ timeout: 5000 });
  const historyText = await page.locator(".esco-history").innerText();
  check("history shows undo steps", /Undo steps/.test(historyText));

  // Help tab: offline safety guidance.
  await rail(page, "Help").click();
  await page.locator(".esco-help").waitFor({ timeout: 5000 });
  check("help shows offline safety notice", /offline internal engineering tool/i.test(await page.locator(".esco-help").innerText()));

  // AI tab: chat input present in the inspector.
  await rail(page, "AI").click();
  await page.locator(".esco-ai").waitFor({ timeout: 5000 });
  check("AI tab exposes a chat input", (await page.locator(".esco-ai__input").count()) === 1);

  // Properties tab: selecting a tag shows tag details (auto-switches to Properties).
  await page.locator('.esco-tree__node--tag:has-text("StartPB")').click();
  await page.locator(".esco-props__heading").first().waitFor({ timeout: 5000 });
  check("selecting a tag returns to Properties", /tag/i.test(await page.locator(".esco-props__heading").first().innerText()));

  // Forces dock tab: empty state when nothing forced.
  await page.locator('.esco-dock__tab:has-text("Forces")').click();
  await page.locator(".esco-forces").waitFor({ timeout: 5000 });
  check("forces tab shows empty state", /No forces active/.test(await page.locator(".esco-forces").innerText()));
  await page.screenshot({ path: join(here, "inspector1.png") });

  const passed = results.filter(Boolean).length;
  console.log(`\nSUMMARY: ${passed}/${results.length} checks passed`);
  process.exitCode = passed === results.length ? 0 : 1;
} catch (err) {
  console.log("ERROR:", err.message);
  await page.screenshot({ path: join(here, "inspector99-error.png") }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
