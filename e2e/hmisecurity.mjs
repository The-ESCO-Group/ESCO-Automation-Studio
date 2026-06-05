// E2E: HMI surface security authoring. Create operator/supervisor roles,
// secure one screen from the selected-surface inspector, then prove the HMI
// navigation projection hides/reveals it from the runtime preview role.
import { chromium } from "playwright-core";
import { URL, createBlankProject, dismissToasts } from "./helpers.mjs";

const results = [];
const check = (label, cond, detail = "") => {
  results.push(!!cond);
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${detail ? "  - " + detail : ""}`);
};

const createScreen = async (page, name) => {
  await page.locator('input[aria-label="New HMI screen name"]').fill(name);
  await page
    .locator(".esco-hmi-create")
    .filter({ has: page.locator('input[aria-label="New HMI screen name"]') })
    .locator("button")
    .click();
  await page.locator(`.esco-hmi-nav button:has-text("${name}")`).first().waitFor({ timeout: 5000 });
  await dismissToasts(page);
};

const createRole = async (page, name) => {
  await page.locator('input[aria-label="New role name"]').fill(name);
  await page.locator('.esco-hmi-authoring__form[aria-label="Add role"] button:has-text("Add Role")').click();
  await page.waitForFunction(
    (roleName) => document.querySelector('[aria-label="HMI security"]')?.textContent?.includes(roleName),
    name,
  );
  await dismissToasts(page);
};

const navSummaryText = (page) =>
  page.locator(".esco-hmi-nav section").filter({ has: page.locator('h2:has-text("Navigation")') }).locator("p").innerText();

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1450, height: 960 } });
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));

try {
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.locator(".esco-controller-organizer").waitFor({ timeout: 60000 });
  await createBlankProject(page);

  await page.locator('.esco-ribbon__tab:has-text("View")').click();
  await page.locator('.esco-ribbon-menu__item:has-text("HMI Designer")').click();
  if ((await page.locator('button:has-text("Enable HMI Project")').count()) > 0) {
    await page.locator('button:has-text("Enable HMI Project")').click();
  }
  await page.locator('[data-testid="hmi-designer"]').waitFor({ timeout: 8000 });

  await createScreen(page, "Overview");
  await createScreen(page, "Secure");
  await createRole(page, "Operator");
  await createRole(page, "Supervisor");

  await page.locator('.esco-hmi-nav button:has-text("Secure")').first().click();
  await page.locator('[data-testid="hmi-surface-security"]').waitFor({ timeout: 5000 });
  check("Surface inspector exposes security role authoring", /Surface|Security/.test(await page.locator(".esco-hmi-properties").innerText()));

  await page.locator('input[aria-label="Surface role Supervisor"]').check();
  await page.waitForFunction(() => /security-hidden/.test(document.querySelector(".esco-hmi-nav")?.textContent ?? ""));
  let navText = await navSummaryText(page);
  check("Securing the screen hides it from the no-role preview route model", /1 security-hidden/.test(navText), navText);

  await page.locator('select[aria-label="Runtime preview role"]').selectOption({ label: "Supervisor" });
  await page.waitForFunction(() => !/security-hidden/.test(document.querySelector(".esco-hmi-nav")?.textContent ?? ""));
  navText = await navSummaryText(page);
  check("Supervisor preview role can see the secured screen", !/security-hidden/.test(navText), navText);

  await page.locator('select[aria-label="Runtime preview role"]').selectOption({ label: "Operator" });
  await page.waitForFunction(() => /security-hidden/.test(document.querySelector(".esco-hmi-nav")?.textContent ?? ""));
  navText = await navSummaryText(page);
  check("Operator preview role is blocked from the supervisor screen", /1 security-hidden/.test(navText), navText);

  await page.locator('input[aria-label="Surface role Supervisor"]').uncheck();
  await page.waitForFunction(() => !/security-hidden/.test(document.querySelector(".esco-hmi-nav")?.textContent ?? ""));
  navText = await navSummaryText(page);
  check("Clearing surface security makes the screen visible again", !/security-hidden/.test(navText), navText);

  const passed = results.filter(Boolean).length;
  console.log(`\nSUMMARY: ${passed}/${results.length} checks passed`);
  process.exitCode = passed === results.length ? 0 : 1;
} catch (err) {
  console.log("ERROR:", err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
