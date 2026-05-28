import { chromium } from "playwright-core";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const URL = "http://localhost:5173/";

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
  await page.locator('button:has-text("MainRoutine")').first().click();

  // Open the AI Assistant tab in the right inspector rail.
  await page.locator('.esco-inspector__tab[title="AI Assistant (offline)"]').click();
  check("AI Assistant tab opens", (await page.locator(".esco-ai").count()) === 1);

  // Explain routine.
  await page.locator('button:has-text("Explain routine")').click();
  const explainText = await page.locator(".esco-ai__message").innerText();
  check("explain routine responds", /Routine "MainRoutine"/.test(explainText), explainText.split("\n")[0]);

  // Generate motor starter -> preview appears.
  await page.locator('button:has-text("Generate motor starter")').click();
  await page.locator(".esco-ai__plan").waitFor({ timeout: 5000 });
  const actionCount = await page.locator(".esco-ai__action").count();
  check("motor starter preview shows actions", actionCount >= 1, `actions=${actionCount}`);
  await page.screenshot({ path: join(here, "ai1-preview.png") });

  // Apply.
  await page.locator('.esco-ai__plan button:has-text("Apply actions")').click();
  await page.locator(".esco-ai__applied").waitFor({ timeout: 5000 });
  const appliedText = await page.locator(".esco-ai__applied").innerText();
  check("apply reports success", /Applied/.test(appliedText), appliedText.replace(/\s+/g, " "));
  // The demo already has an OTE(MotorRun); the AI motor starter adds another, so the
  // validator now correctly reports a double-coil finding (instead of "clean").
  check("validation runs after apply (double-coil flagged)", /finding/.test(appliedText), appliedText.replace(/\s+/g, " "));

  // Tags + rung were added (Watch + explorer).
  const explorer = await page.locator(".esco-left").innerText();
  check("StartPB tag created", /StartPB\s*:\s*BOOL/.test(explorer));
  check("MotorRun tag created", /MotorRun\s*:\s*BOOL/.test(explorer));
  check("seal-in rung added to routine", (await page.locator(".esco-lad__rung").count()) >= 2);
  await page.screenshot({ path: join(here, "ai2-applied.png") });

  // Scan: toggle StartPB, scan, MotorRun true (seal-in via the AI-generated rung).
  await page.locator('.esco-dock__tab:has-text("Watch")').click();
  await page.locator('.esco-watch tr:has-text("StartPB") button:has-text("Toggle")').click();
  await page.locator('button:has-text("Scan Once")').click();
  await page.waitForTimeout(80);
  const motor = await page.locator('.esco-watch tr:has-text("MotorRun") .esco-watch__value').first().innerText();
  check("AI-generated logic simulates: MotorRun=true", /\btrue\b/.test(motor), motor.trim());

  const passed = results.filter(Boolean).length;
  console.log(`\nSUMMARY: ${passed}/${results.length} checks passed`);
  process.exitCode = passed === results.length ? 0 : 1;
} catch (err) {
  console.log("ERROR:", err.message);
  await page.screenshot({ path: join(here, "ai99-error.png") }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
