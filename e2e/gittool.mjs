import { chromium } from "playwright-core";
import { createBlankProject, dismissToasts, URL } from "./helpers.mjs";

const results = [];
const check = (label, cond, detail = "") => {
  results.push(!!cond);
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${detail ? "  - " + String(detail).replace(/\s+/g, " ").slice(0, 140) : ""}`);
};

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
page.setDefaultTimeout(10000);
let pageError = "";
page.on("pageerror", (error) => {
  pageError = error.message;
  console.log("PAGEERROR:", error.message);
});

try {
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.locator(".esco-titlebar").waitFor();
  await createBlankProject(page);
  await dismissToasts(page);

  // The Tools menu exposes a plain "Git" entry.
  await page.locator('.esco-ribbon__tab:has-text("Tools")').click();
  const gitItem = page.locator('.esco-ribbon-menu__item:has-text("Git")');
  check("Tools menu lists Git", (await gitItem.count()) > 0);

  await gitItem.first().click();

  await page.locator(".esco-vcs").waitFor({ timeout: 8000 });
  const historyText = await page.locator(".esco-vcs").innerText();
  check("clicking Git opens the Project History surface", /Project History/i.test(historyText), historyText);

  // In the browser build there is no terminal to open, so it must say the terminal
  // lives in the desktop app while still opening the useful in-app history view.
  await page.locator('.esco-toast:has-text("desktop app")').waitFor({ timeout: 8000 });
  const toast = (await page.locator(".esco-toast").first().innerText()).replace(/\s+/g, " ");
  check("clicking Git explains the terminal opens in the desktop app", /Project History opened/i.test(toast) && /desktop app/i.test(toast), toast);

  check("no runtime page errors", pageError === "", pageError);
} catch (error) {
  check("driver completed without throwing", false, error?.message ?? String(error));
} finally {
  await browser.close();
}

const passed = results.filter(Boolean).length;
console.log(`SUMMARY: ${passed}/${results.length}`);
process.exit(passed === results.length ? 0 : 1);
