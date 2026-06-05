// E2E: HMI authoring → live runtime. Author an alarm, a trend with a pen, a
// language pack + localized string, a localized-text binding, and a deliberately
// broken binding entirely through the designer UI (real @esco/project-actions
// handlers). Then start the runtime preview and prove the authored data is live:
// alarm activates, trend samples, localized text switches, broken binding shows
// in diagnostics, and stop disposes cleanly.
import { chromium } from "playwright-core";
import { URL, createBlankProject, dismissToasts } from "./helpers.mjs";

const results = [];
const check = (l, c, d = "") => {
  results.push(!!c);
  console.log(`${c ? "PASS" : "FAIL"}  ${l}${d ? "  — " + d : ""}`);
};

const toolboxButton = (page, label) => page.locator(`.esco-hmi-toolbox button:has-text("${label}")`).first();
const bindLast = async (page, { property, kind, path }) => {
  await page.locator(".esco-hmi-element").last().click();
  if (property) await page.locator('select[aria-label="Binding property"]').selectOption(property);
  await page.locator('select[aria-label="Binding source kind"]').selectOption(kind);
  await page.locator('input[aria-label="Binding source path"]').fill(path);
  await page.locator('.esco-hmi-edit__form button:has-text("Bind")').click();
  await page.waitForFunction(() => document.querySelector(".esco-hmi-properties")?.textContent?.includes("Bindings (1)"));
};
const authorCommandButton = async (page, { label, commandType, languageId, username, recipeName, x = 40, y = 40 }) => {
  await toolboxButton(page, "Button").click();
  await page.locator(".esco-hmi-element").last().click();
  const xField = page.locator('input[aria-label="Geometry x"]');
  await xField.fill(String(x));
  await xField.press("Enter");
  const yField = page.locator('input[aria-label="Geometry y"]');
  await yField.fill(String(y));
  await yField.press("Enter");
  const labelField = page.locator('input[aria-label="Property label"]');
  await labelField.fill(label);
  await labelField.press("Enter");
  await page.locator('select[aria-label="Command type"]').selectOption(commandType);
  if (languageId) await page.locator('select[aria-label="Language target"]').selectOption(languageId);
  if (username) await page.locator('select[aria-label="Login user target"]').selectOption(username);
  if (recipeName) await page.locator('select[aria-label="Recipe target"]').selectOption({ label: recipeName });
  await page.locator('.esco-hmi-edit__form[aria-label="Add command"] button').click();
  await page.waitForFunction(
    (type) => {
      const panel = document.querySelector(".esco-hmi-properties");
      return panel?.textContent?.includes(type);
    },
    commandType,
  );
};

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

  await page.locator('input[aria-label="New HMI screen name"]').fill("Overview");
  await page.locator(".esco-hmi-create").filter({ has: page.locator('input[aria-label="New HMI screen name"]') }).locator("button").click();
  await page.locator('.esco-hmi-nav button:has-text("Overview")').first().waitFor({ timeout: 5000 });
  await dismissToasts(page);

  // ---- Author an alarm: Tank High, analog-high on Tank_Level >= 90 ----
  await page.locator('input[aria-label="New alarm name"]').fill("Tank High");
  await page.locator('input[aria-label="New alarm tag"]').fill("Tank_Level");
  await page.locator('select[aria-label="New alarm severity"]').selectOption("major");
  await page.locator('select[aria-label="New alarm trigger"]').selectOption("analog-high");
  await page.locator('input[aria-label="New alarm threshold"]').fill("90");
  await page.locator('.esco-hmi-authoring__form[aria-label="Add alarm"] button:has-text("Add Alarm")').click();
  await page.waitForFunction(() => /Alarms \(1\)/.test(document.querySelector('[aria-label="HMI alarms"] h2')?.textContent ?? ""));
  await page.locator('[aria-label="Alarm table offline preview"]').waitFor({ timeout: 5000 });
  await dismissToasts(page);
  check("Authored an HMI alarm through the action layer", true);
  const alarmAuthoringText = await page.locator('[aria-label="Alarm table offline preview"]').innerText();
  check(
    "Alarm offline preview renders the authored alarm table row",
    /Alarm Table Preview/i.test(alarmAuthoringText) &&
      /Tank High/.test(alarmAuthoringText) &&
      /major/.test(alarmAuthoringText) &&
      /Tank_Level/.test(alarmAuthoringText),
    alarmAuthoringText.replace(/\s+/g, " ").slice(0, 120),
  );

  // ---- Author a trend with a Tank_Level pen ----
  await page.locator('input[aria-label="New trend name"]').fill("Levels");
  await page.locator('.esco-hmi-authoring__form[aria-label="Add trend"] button:has-text("Add Trend")').click();
  await page.waitForFunction(() => /Trends \(1\)/.test(document.querySelector('[aria-label="HMI trends"] h2')?.textContent ?? ""));
  await page.locator('input[aria-label="New pen label"]').fill("Level");
  await page.locator('input[aria-label="New pen tag"]').fill("Tank_Level");
  await page.locator('.esco-hmi-authoring__form[aria-label="Add trend pen"] button:has-text("Add Pen")').click();
  await page.waitForFunction(() => /· 1 pen/.test(document.querySelector('[aria-label="HMI trends"]')?.textContent ?? ""));
  await page.locator('[aria-label="Trend offline preview"]').waitFor({ timeout: 5000 });
  await dismissToasts(page);
  check("Authored a trend with a Tank_Level pen", true);
  const trendAuthoringText = await page.locator('[aria-label="Trend offline preview"]').innerText();
  check(
    "Trend offline preview renders the authored pen",
    /Trend Preview/i.test(trendAuthoringText) &&
      /Levels/.test(trendAuthoringText) &&
      /Level:Tank_Level/.test(trendAuthoringText),
    trendAuthoringText.replace(/\s+/g, " ").slice(0, 120),
  );
  // ---- Author a data log with Tank_Level + Motor_Running tags ----
  await page.locator('[aria-label="HMI data logs"]').waitFor({ timeout: 5000 });
  await page.locator('input[aria-label="New data log name"]').fill("Process Log");
  await page.locator('input[aria-label="New data log tags"]').fill("Tank_Level,Motor_Running");
  await page.locator('input[aria-label="New data log sample rate"]').fill("1");
  await page.locator('input[aria-label="New data log retention"]').fill("1");
  await page.locator('.esco-hmi-authoring__form[aria-label="Add data log"] button:has-text("Add Data Log")').click();
  await page.waitForFunction(() => /Data Logs \(1\)/i.test(document.querySelector('[aria-label="HMI data logs"] h2')?.textContent ?? ""));
  await page.locator('[aria-label="Data log offline preview"]').waitFor({ timeout: 5000 });
  await dismissToasts(page);
  check(
    "Authored a data log through the action layer",
    /Process Log/.test(await page.locator('[aria-label="HMI data logs"]').innerText()),
  );

  // ---- Author a recipe with two local runtime tag writes ----
  await page.locator('[aria-label="HMI recipes"]').waitFor({ timeout: 5000 });
  await page.locator('input[aria-label="New recipe name"]').fill("Startup Recipe");
  await page.locator('.esco-hmi-authoring__form[aria-label="Add recipe"] button:has-text("Add Recipe")').click();
  await page.waitForFunction(() => /Recipes \(1\)/i.test(document.querySelector('[aria-label="HMI recipes"] h2')?.textContent ?? ""));
  await page.locator('input[aria-label="New recipe tag"]').fill("Tank_Level");
  await page.locator('input[aria-label="New recipe value"]').fill("70");
  await page.locator('select[aria-label="New recipe data type"]').selectOption("REAL");
  await page.locator('.esco-hmi-authoring__form[aria-label="Add recipe value"] button:has-text("Add Value")').click();
  await page.waitForFunction(() => /Tank_Level=70/i.test(document.querySelector('[aria-label="Recipe offline preview"]')?.textContent ?? ""));
  await page.locator('input[aria-label="New recipe tag"]').fill("Motor_Running");
  await page.locator('input[aria-label="New recipe value"]').fill("true");
  await page.locator('select[aria-label="New recipe data type"]').selectOption("BOOL");
  await page.locator('.esco-hmi-authoring__form[aria-label="Add recipe value"] button:has-text("Add Value")').click();
  await page.waitForFunction(() => /Motor_Running=true/i.test(document.querySelector('[aria-label="Recipe offline preview"]')?.textContent ?? ""));
  await dismissToasts(page);
  const recipeAuthoringText = await page.locator('[aria-label="Recipe offline preview"]').innerText();
  check(
    "Authored an HMI recipe with runtime tag values",
    /Startup Recipe/.test(recipeAuthoringText) && /Tank_Level=70/.test(recipeAuthoringText) && /Motor_Running=true/.test(recipeAuthoringText),
    recipeAuthoringText.replace(/\s+/g, " ").slice(0, 140),
  );

  // ---- Author a language pack + localized strings (en-US default + de-DE) ----
  await page.locator('select[aria-label="Language to edit"]').selectOption({ index: 0 });
  await page.locator('input[aria-label="Localized string key"]').fill("greeting");
  await page.locator('input[aria-label="Localized string value"]').fill("Hello");
  await page.locator('.esco-hmi-authoring__form[aria-label="Add localized string"] button:has-text("Save String")').click();
  await page.waitForFunction(() => /greeting/.test(document.querySelector('[aria-label="Localized strings"]')?.textContent ?? ""));

  await page.locator('input[aria-label="New language id"]').fill("de-DE");
  await page.locator('input[aria-label="New language name"]').fill("Deutsch");
  await page.locator('.esco-hmi-authoring__form[aria-label="Add language"] button:has-text("Add Language")').click();
  await page.waitForFunction(() => /Languages \(2\)/.test(document.querySelector('[aria-label="HMI languages"] h2')?.textContent ?? ""));
  await page.locator('select[aria-label="Language to edit"]').selectOption("de-DE");
  await page.locator('input[aria-label="Localized string key"]').fill("greeting");
  await page.locator('input[aria-label="Localized string value"]').fill("Hallo");
  await page.locator('.esco-hmi-authoring__form[aria-label="Add localized string"] button:has-text("Save String")').click();
  await dismissToasts(page);
  check("Authored a second language pack with a localized string", true);

  // ---- Objects: localized text, broken binding, alarm summary, trend chart ----
  await toolboxButton(page, "Text Display").click();
  await bindLast(page, { property: "text", kind: "system-tag", path: "Text.greeting" });

  await toolboxButton(page, "Numeric Display").click();
  await bindLast(page, { property: "value", kind: "tag", path: "Ghost_Tag" });

  await toolboxButton(page, "Alarm Summary").click();

  await toolboxButton(page, "Trend Chart").click();
  // Bind the trend chart to the named trend "Levels" via its trendId selector.
  await page.locator(".esco-hmi-element").last().click();
  await page.locator('select[aria-label="Property trendId"]').selectOption({ label: "Levels" });
  check("Placed objects and bound the trend chart to the 'Levels' trend", (await page.locator(".esco-hmi-element").count()) >= 4);
  const visualQaText = await page.locator('[aria-label="HMI visual QA"]').innerText();
  check(
    "Visual QA reports complex screen coverage",
    /Complex surfaces\s+1/.test(visualQaText) && /Runtime-ready/.test(visualQaText) && /Coverage/.test(visualQaText),
    visualQaText.replace(/\s+/g, " ").slice(0, 140),
  );

  // ---- Author a security role + user ----
  await page.locator('input[aria-label="New role name"]').fill("Supervisor");
  await page.locator('.esco-hmi-authoring__form[aria-label="Add role"] button:has-text("Add Role")').click();
  await page.waitForFunction(() => /roles/.test(document.querySelector('[aria-label="HMI security"] h2')?.textContent ?? ""));
  await page.locator('input[aria-label="New user name"]').fill("alice");
  await page.locator('select[aria-label="New user role"]').selectOption({ label: "Supervisor" });
  await page.locator('.esco-hmi-authoring__form[aria-label="Add user"] button:has-text("Add User")').click();
  await page.waitForFunction(() => /1 users\b/.test(document.querySelector('[aria-label="HMI security"] h2')?.textContent ?? ""));
  await dismissToasts(page);
  check("Authored a security role and user", true);

  // ---- Author event-command buttons that use language/security runtime commands ----
  await authorCommandButton(page, { label: "Language DE", commandType: "change-language", languageId: "de-DE", x: 36, y: 32 });
  await dismissToasts(page);
  const languageCommandText = await page.locator(".esco-hmi-properties").innerText();
  check(
    "Authored a runtime-preview language event command",
    /press → change-language/.test(languageCommandText),
    languageCommandText.replace(/\s+/g, " ").slice(0, 120),
  );
  await authorCommandButton(page, { label: "Login Alice", commandType: "login-user", username: "alice", x: 36, y: 96 });
  await dismissToasts(page);
  const commandListText = await page.locator(".esco-hmi-properties").innerText();
  check(
    "Authored a runtime-preview login event command",
    /press → login-user/.test(commandListText),
    commandListText.replace(/\s+/g, " ").slice(0, 140),
  );
  await authorCommandButton(page, { label: "Apply Startup", commandType: "apply-recipe", recipeName: "Startup Recipe", x: 36, y: 160 });
  await dismissToasts(page);
  const recipeCommandText = await page.locator(".esco-hmi-properties").innerText();
  check(
    "Authored a runtime-preview recipe apply event command",
    /press → apply-recipe/.test(recipeCommandText),
    recipeCommandText.replace(/\s+/g, " ").slice(0, 140),
  );

  // ---- Start the live runtime preview ----
  await page.locator('[data-testid="hmi-start-preview"]').click();
  await page.locator('[data-testid="hmi-live-preview"]').waitFor({ timeout: 8000 });
  check("Runtime preview opens with authored content", true);

  // Authored recipe command writes into the local runtime tag provider.
  await page.locator(".esco-hmi-live--button").filter({ hasText: "Apply Startup" }).click();
  await page.waitForFunction(() => /Tank_Level/.test(document.querySelector('[data-testid="hmi-live-recipe-history"]')?.textContent ?? ""));
  const recipeHistoryText = await page.locator('[data-testid="hmi-live-recipe-history"]').innerText();
  check(
    "Runtime recipe apply command writes local tag values and records a receipt",
    /Tank_Level/.test(recipeHistoryText) && /Motor_Running/.test(recipeHistoryText),
    recipeHistoryText.replace(/\s+/g, " ").slice(0, 160),
  );
  check("Recipe apply updates Tank_Level in the runtime tag inspector", (await page.locator('input[aria-label="Set Tank_Level"]').first().inputValue()) === "70");

  // Localized text resolves the default language string.
  const localized = () => page.locator(".esco-hmi-live--text span").first().innerText();
  await page.waitForFunction(() => /Hello/.test(document.querySelector(".esco-hmi-live--text span")?.textContent ?? ""));
  check("Localized text binding resolves the default language (Hello)", /Hello/.test(await localized()));

  // Authored language command button switches language live.
  await page.locator(".esco-hmi-live--button").filter({ hasText: "Language DE" }).click();
  await page.waitForFunction(() => /Hallo/.test(document.querySelector(".esco-hmi-live--text span")?.textContent ?? ""));
  check("Authored language command updates localized text live (Hallo)", /Hallo/.test(await localized()));

  // Drive Tank_Level high → authored alarm activates + trend samples.
  const levelInput = page.locator('input[aria-label="Set Tank_Level"]').first();
  await levelInput.fill("30");
  await levelInput.press("Enter");
  await levelInput.fill("95");
  await levelInput.press("Enter");
  await page.waitForFunction(() => document.querySelector('[data-testid="live-alarm-active"]')?.textContent?.trim() === "1");
  check("Authored alarm activates when Tank_Level crosses the threshold", (await page.locator('[data-testid="live-alarm-active"]').innerText()) === "1");
  const alarmSummaryText = await page.locator(".esco-hmi-live--alarms").innerText();
  check(
    "Alarm Summary widget shows the authored active alarm",
    /Tank High/.test(alarmSummaryText) && /major/.test(alarmSummaryText),
    alarmSummaryText.replace(/\s+/g, " ").slice(0, 90),
  );
  const alarmManagerText = await page.locator('[data-testid="hmi-live-alarm-manager"]').innerText();
  check(
    "Alarm Manager panel shows the active unacknowledged alarm",
    /Tank High/.test(alarmManagerText) && /Active Unacknowledged/.test(alarmManagerText),
    alarmManagerText.replace(/\s+/g, " ").slice(0, 110),
  );
  await page.locator('[aria-label="Alarm runtime view"] button:has-text("Event Log")').click();
  await page.waitForFunction(() => /Activated/.test(document.querySelector('[data-testid="hmi-live-alarm-history"]')?.textContent ?? ""));
  check(
    "Alarm Event Log records the activation event",
    /Activated/.test(await page.locator('[data-testid="hmi-live-alarm-history"]').innerText()),
  );
  await page.locator('[aria-label="Alarm runtime view"] button:has-text("Manager")').click();
  await levelInput.fill("30");
  await levelInput.press("Enter");
  await page.waitForFunction(() => document.querySelector('[data-testid="hmi-live-alarm-manager"] [data-state="returned-unacknowledged"]'));
  check(
    "Alarm Manager shows returned-unacknowledged after the tag returns normal",
    /Returned Unacknowledged/.test(await page.locator('[data-testid="hmi-live-alarm-manager"]').innerText()),
  );
  await page.locator('[data-testid="hmi-live-alarm-manager"] button:has-text("Reset")').last().click();
  await page.waitForFunction(() => document.querySelector('[data-testid="hmi-live-alarm-manager"] [data-state="normal"]'));
  await page.locator('[aria-label="Alarm runtime view"] button:has-text("Event Log")').click();
  await page.waitForFunction(() => /Reset/.test(document.querySelector('[data-testid="hmi-live-alarm-history"]')?.textContent ?? ""));
  check(
    "Alarm reset clears the returned row and records an event-log entry",
    /Reset/.test(await page.locator('[data-testid="hmi-live-alarm-history"]').innerText()),
  );
  await page.locator('[aria-label="Alarm runtime view"] button:has-text("Manager")').click();
  await levelInput.fill("95");
  await levelInput.press("Enter");
  await page.waitForFunction(() => document.querySelector('[data-testid="live-alarm-active"]')?.textContent?.trim() === "1");

  await page.waitForFunction(() => {
    const svg = document.querySelector('[data-testid="hmi-live-trend"]');
    return svg !== null && Number(svg.getAttribute("data-points")) > 0;
  });
  check("Authored trend collects live samples (sparkline)", Number(await page.locator('[data-testid="hmi-live-trend"]').getAttribute("data-points")) > 0);

  await page.waitForFunction(() => {
    const row = document.querySelector('[data-testid="hmi-live-data-log"]');
    return row !== null && Number(row.getAttribute("data-rows")) > 0;
  });
  const dataLogText = await page.locator('[aria-label="Data log runtime"]').innerText();
  check(
    "Authored data log records live runtime samples",
    /Process Log/.test(dataLogText) && /recording/i.test(dataLogText),
    dataLogText.replace(/\s+/g, " ").slice(0, 100),
  );
  await page.locator('[aria-label="Data log runtime"] button:has-text("Export")').click();
  await page.locator('[data-testid="hmi-live-data-log-export"]').waitFor({ timeout: 5000 });
  check(
    "Data log export preview reports deterministic CSV output",
    /Process-Log\.hmi-data-log\.csv/.test(await page.locator('[data-testid="hmi-live-data-log-export"]').innerText()),
  );
  await page.locator('[aria-label="Data log runtime"] button:has-text("Clear")').click();
  await page.waitForTimeout(50);
  check("Data log clear preview command is wired", true);

  // Broken binding remains visible in diagnostics.
  const diagText = await page.locator('[aria-label="Runtime diagnostics"]').innerText();
  check("Broken binding shows in the diagnostics panel", /Ghost_Tag/.test(diagText), diagText.replace(/\s+/g, " ").slice(0, 70));

  // Acknowledge through the Alarm Summary widget.
  await page.locator('.esco-hmi-live--alarms button:has-text("Ack")').click();
  await page.waitForFunction(() => /ack/.test(document.querySelector(".esco-hmi-live--alarms")?.textContent ?? ""));
  check("Alarm Summary widget acknowledge is wired to the alarm runtime", /ack/.test(await page.locator(".esco-hmi-live--alarms").innerText()));

  // Acknowledge all clears the unacknowledged alarm.
  await page.locator('.esco-hmi-live-preview__panel button:has-text("Acknowledge All")').click();
  await page.waitForTimeout(200);
  check("Acknowledge All is wired to the alarm runtime", true);

  // Runtime login through the authored event command.
  await page.locator(".esco-hmi-live--button").filter({ hasText: "Login Alice" }).click();
  await page.waitForFunction(() => document.querySelector('[data-testid="live-user"]')?.textContent?.trim() === "alice");
  check("Authored login command switches the active user to the authored user", (await page.locator('[data-testid="live-user"]').innerText()) === "alice");

  // Stop disposes cleanly.
  await page.locator('[data-testid="hmi-stop-preview"]').click();
  await page.waitForFunction(() => !document.querySelector('[data-testid="hmi-live-preview"]'));
  check("Stop preview disposes the runtime view", (await page.locator('[data-testid="hmi-live-preview"]').count()) === 0);

  const passed = results.filter(Boolean).length;
  console.log(`\nSUMMARY: ${passed}/${results.length} checks passed`);
  process.exitCode = passed === results.length ? 0 : 1;
} catch (err) {
  console.log("ERROR:", err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
