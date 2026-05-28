import { chromium } from "playwright-core";
import { URL, dismissToasts, importStarterProject, ribbonButton } from "./helpers.mjs";

const results = [];
const check = (label, cond, detail = "") => {
  results.push(!!cond);
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${detail ? "  - " + String(detail).replace(/\s+/g, " ").slice(0, 90) : ""}`);
};
const tab = (page, name) => page.locator(`.esco-ribbon__tab:has-text("${name}")`).first();
const activeTab = (page) => page.locator(".esco-ribbon__tab.is-active").innerText();

const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
const page = await context.newPage();
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));

try {
  await page.goto(URL, { waitUntil: "networkidle" });
  await importStarterProject(page);

  check("Home ribbon starts active", /Home/.test(await activeTab(page)));
  check("Home exposes common commands", (await ribbonButton(page, "Save As").count()) === 1 && (await ribbonButton(page, "Cross Reference").count()) === 1);

  await tab(page, "Edit").click();
  check("Edit tab activates", /Edit/.test(await activeTab(page)));
  check("Edit exposes clipboard/search commands", (await ribbonButton(page, "Paste").count()) === 1 && (await ribbonButton(page, "Replace").count()) === 1);

  await tab(page, "Project").click();
  check("Project tab activates", /Project/.test(await activeTab(page)));
  await ribbonButton(page, "Project Properties").click();
  await page.locator(".esco-detail__title").waitFor({ timeout: 5000 });
  check("Project Properties opens project detail", /Project · E2E_Starter/.test(await page.locator(".esco-detail__title").innerText()));
  await ribbonButton(page, "Controller Properties").click();
  await page.locator(".esco-detail__title").waitFor({ timeout: 5000 });
  check("Controller Properties opens controller detail", /Controller · E2E_Starter/.test(await page.locator(".esco-detail__title").innerText()));
  await page.locator('.esco-tree__node--routine:has-text("MainRoutine")').click();
  await page.locator(".esco-lad__rung").first().waitFor({ timeout: 5000 });

  await tab(page, "Logic").click();
  const startRungs = await page.locator(".esco-lad__rung").count();
  await ribbonButton(page, "Add Rung").click();
  await page.waitForFunction((count) => document.querySelectorAll(".esco-lad__rung").length === count + 1, startRungs);
  check("Logic tab Add Rung works", (await page.locator(".esco-lad__rung").count()) === startRungs + 1);
  await ribbonButton(page, "XIC").click();
  check("Logic tab instruction button adds an instruction", (await page.locator(".esco-lad__rung.is-selected .esco-lad__operand").count()) >= 1);

  await tab(page, "Online").click();
  check("Online tab activates", /Online/.test(await activeTab(page)));
  check("unsafe online actions are disabled", await ribbonButton(page, "Go Online").isDisabled() && await ribbonButton(page, "Download").isDisabled());
  await ribbonButton(page, "Go Offline").click();
  await page.locator(".esco-toast").waitFor({ timeout: 5000 });
  check("Go Offline reports offline simulation", /Offline Simulation/.test(await page.locator(".esco-toast").innerText()));
  await dismissToasts(page);

  await tab(page, "Tools").click();
  await ribbonButton(page, "Export Tags").waitFor({ timeout: 5000 });
  check("Tools tab exposes tag import/export", (await ribbonButton(page, "Export Tags").count()) === 1 && (await ribbonButton(page, "Import Tags").count()) === 1);

  const passed = results.filter(Boolean).length;
  console.log(`\nSUMMARY: ${passed}/${results.length} checks passed`);
  process.exitCode = passed === results.length ? 0 : 1;
} catch (err) {
  console.log("ERROR:", err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
