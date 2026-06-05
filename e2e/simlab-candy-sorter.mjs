// E2E: Simulation Lab candy sorter mock project.
// open lab -> load candy sorter demo -> run scenarios -> generate report.
import { chromium } from "playwright-core";
import { URL } from "./helpers.mjs";

const results = [];
const check = (label, condition, detail = "") => {
  results.push(!!condition);
  console.log(`${condition ? "PASS" : "FAIL"}  ${label}${detail ? "  - " + String(detail).replace(/\s+/g, " ").slice(0, 160) : ""}`);
};

const lab = (page) => page.locator(".esco-simlab");
const labBtn = (page, text) => page.locator(`.esco-simlab button:has-text("${text}")`).first();
const labTab = (page, text) => page.locator(`.esco-simlab__tab:has-text("${text}")`).first();

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 980 } });
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));

try {
  await page.goto(URL, { waitUntil: "networkidle" });

  await page.locator('.esco-ribbon__utility-btn[aria-label="Simulation lab"]').click();
  await lab(page).waitFor({ timeout: 8000 });
  await labBtn(page, "Load Candy Sorter Demo").click();
  await page.locator(".esco-simlab__tab.is-active:has-text('Run')").waitFor({ timeout: 8000 });

  const headerText = await page.locator(".esco-simlab__header").innerText();
  check("Candy sorter demo loads from the Studio UI", /Candy Bar Sorter - 5 Count Case Packer/.test(headerText), headerText);
  check("Run stage is opened for the mock project", (await page.locator(".esco-simlab__tab.is-active:has-text('Run')").count()) === 1);

  const scenarioRows = await page.locator(".esco-simlab__panel:has-text('Scenario Runner') .esco-simlab__row").count();
  check("Candy sorter scenarios are preloaded", scenarioRows === 4, `${scenarioRows} scenario row(s)`);

  const runTextBefore = await lab(page).innerText();
  check("Sorter-specific lanes and cases are visible", /KitKat/i.test(runTextBefore) && /Hershey/i.test(runTextBefore) && /5-count/i.test(runTextBefore));

  await labBtn(page, "Run All").click();
  await page.waitForTimeout(500);
  const runText = await lab(page).innerText();
  check("All candy sorter scenarios pass", (runText.match(/\bPASS -/g) ?? []).length === 4, runText.match(/\bPASS -[^\n]*/g)?.join(" | ") ?? "");

  await labTab(page, "HMI").click();
  const hmiText = await lab(page).innerText();
  check("HMI overview includes both product lanes", /KitKat Box Count/i.test(hmiText) && /Hershey Box Count/i.test(hmiText));

  await labTab(page, "Reports").click();
  await labBtn(page, "Generate Report").click();
  await page.waitForTimeout(300);
  const reportText = await page.locator(".esco-simlab__report").first().innerText();
  check("Candy sorter report is PASS", /Status:\s*PASS/i.test(reportText), reportText);
  check("Report captures 4 of 4 scenarios", /4\/4 scenarios passed/i.test(reportText), reportText);

  await labTab(page, "Boundaries").click();
  const boundaryText = await lab(page).innerText();
  check("Real-controller operations remain blocked", /Blocked/i.test(boundaryText) && /Go Online|Download/i.test(boundaryText));

  const passed = results.filter(Boolean).length;
  console.log(`\nSUMMARY: ${passed}/${results.length} checks passed`);
  process.exitCode = passed === results.length ? 0 : 1;
} catch (error) {
  console.log("ERROR:", error.message);
  await page.screenshot({ path: new globalThis.URL("./simlab-candy-sorter-error.png", import.meta.url).pathname }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
