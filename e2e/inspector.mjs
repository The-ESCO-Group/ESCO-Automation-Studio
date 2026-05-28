import { chromium } from "playwright-core";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { URL, importStarterProject } from "./helpers.mjs";

const here = dirname(fileURLToPath(import.meta.url));

const results = [];
const check = (label, cond, detail = "") => {
  results.push(!!cond);
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${detail ? "  — " + detail : ""}`);
};

const copilotTab = (page, label) =>
  page.locator(`.esco-copilot__tab:has-text("${label}")`);

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));

try {
  await page.goto(URL, { waitUntil: "networkidle" });
  await importStarterProject(page);

  // The right rail is now the local AI Copilot with Chat + History.
  check("AI Copilot panel renders", (await page.locator(".esco-copilot").count()) === 1);
  check("copilot has Chat and History tabs", (await page.locator(".esco-copilot__tab").count()) === 2);

  // AI is no longer in the bottom dock — it moved to the inspector.
  check("AI removed from bottom dock", (await page.locator('.esco-dock__tab:has-text("AI Assistant")').count()) === 0);
  check("bottom dock has a Forces tab", (await page.locator('.esco-dock__tab:has-text("Forces")').count()) === 1);

  // Open the imported routine so the model summary has content.
  await page.locator('button:has-text("MainRoutine")').first().click();
  await page.locator(".esco-lad__rung").first().waitFor({ timeout: 5000 });

  // History tab: selection properties + edit state.
  await copilotTab(page, "History").click();
  await page.locator(".esco-history").waitFor({ timeout: 5000 });
  const historyText = await page.locator(".esco-history").innerText();
  check("history shows undo steps", /Undo steps/.test(historyText));

  // Chat tab: AI input present in the copilot.
  await copilotTab(page, "Chat").click();
  await page.locator(".esco-ai").waitFor({ timeout: 5000 });
  check("Chat tab exposes a chat input", (await page.locator(".esco-ai__input").count()) === 1);

  // Selecting a tag shows tag details in the History/context tab.
  await page.locator('.esco-tree__node--tag:has-text("StartPB")').click();
  await page.locator(".esco-props__heading").first().waitFor({ timeout: 5000 });
  check("selecting a tag shows Properties context", /tag/i.test(await page.locator(".esco-props__heading").first().innerText()));

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
