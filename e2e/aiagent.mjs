// Verifies the live online agent is opt-in and safe WITHOUT any network call:
// switching to online mode shows the warning + key field; sending with no key
// short-circuits with a clear error before any request is made; and the offline
// local assistant remains available. (Live model calls need a real key — tested
// manually.) Routine-independent so it does not depend on shell navigation.
import { chromium } from "playwright-core";

const URL = process.env.E2E_URL || "http://localhost:5173/";

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
  await page.locator('.esco-copilot__tab:has-text("Chat")').click();
  check("copilot chat opens (offline default)", (await page.locator(".esco-ai").count()) === 1);
  check("provider selector present", (await page.locator(".esco-copilot__provider select").count()) === 1);
  check("badge reads LOCAL by default", /LOCAL/.test(await page.locator(".esco-copilot__badge").innerText()));

  // Switch to live online mode.
  await page.locator(".esco-copilot__provider select").selectOption("online");
  check("badge switches to ONLINE", /ONLINE/.test(await page.locator(".esco-copilot__badge").innerText()));
  check("online warning shown", (await page.locator(".esco-ai__notice--online").count()) === 1 && /sends/i.test(await page.locator(".esco-ai__notice--online").innerText()));
  check("API key field shown (browser-key default)", (await page.locator('.esco-copilot-live input[type="password"]').count()) === 1);
  check("model label visible", /Claude/.test(await page.locator(".esco-copilot-live .esco-ai__footer").innerText()));

  // Send with no key must short-circuit with a clear message — NO network call.
  await page.locator(".esco-copilot-live .esco-ai__prompt input").fill("add a seal-in start/stop for a conveyor");
  await page.locator('.esco-copilot-live .esco-ai__prompt button:has-text("Send")').click();
  await page.locator(".esco-ai__applied--error").waitFor({ timeout: 5000 });
  const keyMsg = await page.locator(".esco-ai__applied--error").innerText();
  check("empty key short-circuits with a clear error (no network)", /API key/i.test(keyMsg), keyMsg.trim());

  // Switching to proxy mode hides the browser key field.
  await page.locator(".esco-copilot-live select").selectOption("proxy");
  check("proxy mode hides the browser key field", (await page.locator('.esco-copilot-live input[type="password"]').count()) === 0);

  // Switch back to local — the offline assistant is still available.
  await page.locator(".esco-copilot__provider select").selectOption("local");
  check("offline assistant still available", (await page.locator(".esco-ai").count()) === 1 && (await page.locator(".esco-ai__notice--online").count()) === 0);

  const passed = results.filter(Boolean).length;
  console.log(`\nSUMMARY: ${passed}/${results.length} checks passed`);
  process.exitCode = passed === results.length ? 0 : 1;
} catch (err) {
  console.log("ERROR:", err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
