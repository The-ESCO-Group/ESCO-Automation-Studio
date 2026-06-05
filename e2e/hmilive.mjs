// E2E: HMI live runtime preview — bind objects to tags/expressions, start the
// preview, drive live tag values, and exercise a button action. Everything runs
// through the real @esco/hmi-model runtime controller (provider + binding engine
// + alarm/trend runtimes), not cosmetic UI state.
import { chromium } from "playwright-core";
import { URL, createBlankProject, dismissToasts } from "./helpers.mjs";

const results = [];
const check = (l, c, d = "") => {
  results.push(!!c);
  console.log(`${c ? "PASS" : "FAIL"}  ${l}${d ? "  — " + d : ""}`);
};

const toolboxButton = (page, label) => page.locator(`.esco-hmi-toolbox button:has-text("${label}")`).first();

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 980 } });
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

  // Create a screen.
  await page.locator('input[aria-label="New HMI screen name"]').fill("Overview");
  await page
    .locator(".esco-hmi-create")
    .filter({ has: page.locator('input[aria-label="New HMI screen name"]') })
    .locator("button")
    .click();
  await page.locator('.esco-hmi-nav button:has-text("Overview")').first().waitFor({ timeout: 5000 });
  await dismissToasts(page);

  // Numeric Display bound value -> {Tank_Level} (demo tag seeds Tank_Level = 42).
  await toolboxButton(page, "Numeric Display").click();
  await page.locator(".esco-hmi-element").first().click();
  await page.locator('select[aria-label="Binding source kind"]').selectOption("tag");
  await page.locator('input[aria-label="Binding source path"]').fill("Tank_Level");
  await page.locator('.esco-hmi-edit__form button:has-text("Bind")').click();
  await page.waitForFunction(() => document.querySelector(".esco-hmi-properties")?.textContent?.includes("Bindings (1)"));

  // Text Display bound text -> expression on {Motor_Running}.
  await toolboxButton(page, "Text Display").click();
  await page.locator('.esco-hmi-element:has-text("Text Display")').first().click();
  await page.locator('select[aria-label="Binding property"]').selectOption("text");
  await page.locator('select[aria-label="Binding source kind"]').selectOption("expression");
  await page.locator('input[aria-label="Binding source path"]').fill('if({Motor_Running}, "RUN", "STOP")');
  await page.locator('.esco-hmi-edit__form button:has-text("Bind")').click();
  await page.waitForFunction(() => document.querySelector(".esco-hmi-properties")?.textContent?.includes("Bindings (1)"));

  // Button with a press command that sets Motor_Running = true.
  await toolboxButton(page, "Button").first().click();
  await page.locator('.esco-hmi-element:has-text("Button")').first().click();
  await page.locator('select[aria-label="Command type"]').selectOption("set-tag-value");
  await page.locator('input[aria-label="Set tag path"]').fill("Motor_Running");
  await page.locator('input[aria-label="Set tag value"]').fill("true");
  await page.locator('.esco-hmi-edit__form[aria-label="Add command"] button.esco-btn--primary').click();
  await page.waitForFunction(() => /press → set-tag-value/.test(document.querySelector(".esco-hmi-properties")?.textContent ?? ""));
  check("Authored objects: numeric tag binding, expression binding, and a button command", true);

  // Indicator Lamp bound value -> {Motor_Running} (slice 2).
  await toolboxButton(page, "Indicator Lamp").click();
  await page.locator(".esco-hmi-element").last().click();
  await page.locator('select[aria-label="Binding source kind"]').selectOption("tag");
  await page.locator('input[aria-label="Binding source path"]').fill("Motor_Running");
  await page.locator('.esco-hmi-edit__form button:has-text("Bind")').click();
  await page.waitForFunction(() => document.querySelector(".esco-hmi-properties")?.textContent?.includes("Bindings (1)"));

  // A deliberately broken binding: Numeric Display value -> {Ghost_Tag} (slice 4).
  await toolboxButton(page, "Numeric Display").click();
  await page.locator(".esco-hmi-element").last().click();
  await page.locator('select[aria-label="Binding source kind"]').selectOption("tag");
  await page.locator('input[aria-label="Binding source path"]').fill("Ghost_Tag");
  await page.locator('.esco-hmi-edit__form button:has-text("Bind")').click();
  await page.waitForFunction(() => document.querySelector(".esco-hmi-properties")?.textContent?.includes("Bindings (1)"));
  check("Authored an indicator lamp and a deliberately broken binding", true);

  // ---- Start the live runtime preview ----
  await page.locator('[data-testid="hmi-start-preview"]').click();
  await page.locator('[data-testid="hmi-live-preview"]').waitFor({ timeout: 8000 });
  check("Start Runtime Preview opens the live operator view", true);

  // Regression guard: the configured-screen surface must stay inside its
  // overflow:hidden clipping stage. If the surface is taller than the stage,
  // objects authored near the top/bottom of the screen render in the clipped
  // band and become invisible/unclickable in the operator preview.
  const surfaceFits = await page.evaluate(() => {
    const surface = document.querySelector(".esco-hmi-live-preview__surface");
    const stage = document.querySelector(".esco-hmi-live-preview__stage");
    if (!surface || !stage) return false;
    const s = surface.getBoundingClientRect();
    const g = stage.getBoundingClientRect();
    // 1px tolerance for sub-pixel rounding/borders.
    return s.top >= g.top - 1 && s.bottom <= g.bottom + 1 && s.left >= g.left - 1 && s.right <= g.right + 1;
  });
  check("Live screen surface stays within the clipping stage (no clipped objects)", surfaceFits);

  const numericValue = () => page.locator(".esco-hmi-live--display .esco-hmi-live__value").first().innerText();
  await page.waitForFunction(() => document.querySelector(".esco-hmi-live--display .esco-hmi-live__value")?.textContent?.trim() === "42");
  check("Numeric display reads the live tag value (Tank_Level = 42)", (await numericValue()) === "42");

  // Tag inspector lists the runtime tags and drives values live.
  check("Tag inspector lists runtime tags", (await page.locator('.esco-hmi-live-preview__tag-input').count()) > 0);
  const levelInput = page.locator('input[aria-label="Set Tank_Level"]').first();
  await levelInput.fill("88");
  await levelInput.press("Enter");
  await page.waitForFunction(() => document.querySelector(".esco-hmi-live--display .esco-hmi-live__value")?.textContent?.trim() === "88");
  check("Driving Tank_Level from the inspector updates the bound display (88)", (await numericValue()) === "88");

  // Expression-bound text starts STOPPED, button press flips Motor_Running -> RUN.
  const runText = () => page.locator(".esco-hmi-live--text span").first().innerText();
  check("Expression binding renders STOP before the button press", /STOP/.test(await runText()));
  await page.locator(".esco-hmi-live--button").first().click();
  await page.waitForFunction(() => /RUN/.test(document.querySelector(".esco-hmi-live--text span")?.textContent ?? ""));
  check("Button command writes Motor_Running; expression binding updates to RUN", /RUN/.test(await runText()));

  // Indicator lamp lights once Motor_Running is true (slice 2 live behavior).
  await page.waitForFunction(() => document.querySelector('.esco-hmi-live--lamp[data-lit="true"]') !== null);
  check("Indicator lamp lights from the bound Motor_Running tag", (await page.locator('.esco-hmi-live--lamp[data-lit="true"]').count()) === 1);

  // The broken binding surfaces in the diagnostics panel (slice 4).
  const diagText = await page.locator('[aria-label="Runtime diagnostics"]').innerText();
  check("Diagnostics panel reports the broken binding", /Ghost_Tag/.test(diagText), diagText.replace(/\s+/g, " ").slice(0, 80));
  await page.locator('[aria-label="Diagnostics runtime view"] button:has-text("History")').click();
  await page.waitForFunction(() => /Ghost_Tag/.test(document.querySelector('[data-testid="hmi-runtime-diagnostics-history"]')?.textContent ?? ""));
  const diagHistoryText = await page.locator('[data-testid="hmi-runtime-diagnostics-history"]').innerText();
  check(
    "Diagnostics history records the broken binding event",
    /Ghost_Tag/.test(diagHistoryText) && /unknown-tag/.test(diagHistoryText),
    diagHistoryText.replace(/\s+/g, " ").slice(0, 90),
  );

  // Stop disposes the preview cleanly.
  await page.locator('[data-testid="hmi-stop-preview"]').click();
  await page.waitForFunction(() => !document.querySelector('[data-testid="hmi-live-preview"]'));
  check("Stop Preview disposes the live runtime view", (await page.locator('[data-testid="hmi-live-preview"]').count()) === 0);

  const passed = results.filter(Boolean).length;
  console.log(`\nSUMMARY: ${passed}/${results.length} checks passed`);
  process.exitCode = passed === results.length ? 0 : 1;
} catch (err) {
  console.log("ERROR:", err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
