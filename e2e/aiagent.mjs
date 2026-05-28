// Verifies the production-style Copilot surface without making any network
// request: no inline key/mode clutter, setup opens outside chat, and missing
// setup short-circuits before project context can leave the app.
import { chromium } from "playwright-core";

const URL = process.env.E2E_URL || "http://localhost:5173/";

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
  await page.evaluate(() => localStorage.removeItem("esco.ai.profile.v1"));
  await page.reload({ waitUntil: "networkidle" });

  await page.locator('.esco-copilot__tab:has-text("Chat")').click();
  check("copilot chat opens", (await page.locator(".esco-ai").count()) === 1);
  check("badge reads ONLINE", /ONLINE/.test(await page.locator(".esco-copilot__badge").innerText()));
  check("provider selector removed", (await page.locator(".esco-copilot__provider select").count()) === 0);
  check("inline API key field removed", (await page.locator('.esco-copilot-live input[type="password"]').count()) === 0);
  check("transport controls removed", (await page.locator('.esco-copilot-live select').count()) === 0);
  check("model label visible", /Opus 4\.7/.test(await page.locator(".esco-copilot-live .esco-ai__footer").innerText()));

  await page.locator('.esco-copilot-live button:has-text("Set up AI")').click();
  await page.locator(".esco-setup").waitFor({ timeout: 5000 });
  check("setup dialog opens outside chat", (await page.locator(".esco-setup").count()) === 1);
  check("setup owns API key entry", (await page.locator('.esco-setup input[type="password"]').count()) === 1);
  await page.locator('.esco-setup button[aria-label="Close setup"]').click();

  await page.locator(".esco-copilot-live .esco-ai__prompt textarea").fill("explain this routine");
  await page.locator('.esco-copilot-live .esco-ai__prompt button:has-text("Send")').click();
  await page.locator(".esco-ai__applied--error").waitFor({ timeout: 5000 });
  const keyMsg = await page.locator(".esco-ai__applied--error").innerText();
  check("missing setup short-circuits with settings message", /Settings|API key/i.test(keyMsg), keyMsg.trim());

  const passed = results.filter(Boolean).length;
  console.log(`\nSUMMARY: ${passed}/${results.length} checks passed`);
  process.exitCode = passed === results.length ? 0 : 1;
} catch (err) {
  console.log("ERROR:", err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
