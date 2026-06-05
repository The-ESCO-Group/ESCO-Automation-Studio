// E2E: global floating AI assistant — FAB launcher + popover chat.
import { chromium } from "playwright-core";
import { URL } from "./helpers.mjs";

const results = [];
const check = (label, condition, detail = "") => {
  results.push(!!condition);
  console.log(`${condition ? "PASS" : "FAIL"}  ${label}${detail ? "  — " + String(detail).replace(/\s+/g, " ").slice(0, 140) : ""}`);
};
const tid = (page, id) => page.locator(`[data-testid="${id}"]`);

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 920 } });
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));

try {
  await page.goto(URL, { waitUntil: "networkidle" });

  // 1. The launcher is present but collapsed (no panel) — does not clutter layout.
  await tid(page, "floating-ai-fab").waitFor({ timeout: 8000 });
  check("Floating AI launcher (FAB) is present", (await tid(page, "floating-ai-fab").count()) === 1);
  check("Panel is collapsed by default", (await tid(page, "floating-ai-panel").count()) === 0);

  // 2. Clicking the FAB opens the popover.
  await tid(page, "floating-ai-fab").click();
  await tid(page, "floating-ai-panel").waitFor({ timeout: 5000 });
  check("Clicking the FAB opens the AI popover", (await tid(page, "floating-ai-panel").count()) === 1);

  // 3. The chat loop works (sending a prompt yields an assistant reply).
  await tid(page, "floating-ai-input").fill("What can you help me with?");
  await tid(page, "floating-ai-send").click();
  await page.locator(".esco-fai__msg.is-assistant").first().waitFor({ timeout: 6000 });
  check("Assistant replies in the chat", (await page.locator(".esco-fai__msg.is-assistant").count()) >= 1);
  check("User message is shown", (await page.locator(".esco-fai__msg.is-user").count()) >= 1);

  // 4. A quick-prompt chip drives the assistant too (after first message the welcome chips are gone,
  //    so re-open via a fresh send to confirm input path remains usable).
  await tid(page, "floating-ai-input").fill("Explain the selected rung");
  await tid(page, "floating-ai-input").press("Enter");
  await page.waitForTimeout(500);
  check("Enter-to-send works", (await page.locator(".esco-fai__msg.is-user").count()) >= 2);

  // 5. The portal renders above the app (high z-index) and over the canvas, not in the dock.
  const inBody = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="floating-ai-panel"]');
    return !!el && el.closest(".esco-body") === null; // not inside the app body grid
  });
  check("Popover is portaled (floats above layout, not docked)", inBody);

  // 6. Minimizing collapses back to the FAB.
  await page.locator('.esco-fai__iconbtn[aria-label="Minimize"]').click();
  await page.waitForTimeout(200);
  check("Minimize collapses back to the launcher", (await tid(page, "floating-ai-panel").count()) === 0 && (await tid(page, "floating-ai-fab").count()) === 1);

  const passed = results.filter(Boolean).length;
  console.log(`\nSUMMARY: ${passed}/${results.length} checks passed`);
  process.exitCode = passed === results.length ? 0 : 1;
} catch (error) {
  console.log("ERROR:", error.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
