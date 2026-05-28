import { chromium } from "playwright-core";
import { URL, importStarterProject } from "./helpers.mjs";
const results = [];
const check = (l, c, d = "") => { results.push(!!c); console.log(`${c ? "PASS" : "FAIL"}  ${l}${d ? "  — " + d : ""}`); };
const tab = (page, name) => page.locator(`.esco-dock__tab:has-text("${name}")`);
const motorVal = (page) => page.locator('.esco-watch tr:has-text("MotorRun") .esco-watch__value').first().innerText();
const forcedRows = (page) => page.locator(".esco-watch tr.is-forced").count();

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
try {
  await page.goto(URL, { waitUntil: "networkidle" });
  await importStarterProject(page);
  await tab(page, "Watch").click();
  check("MotorRun starts false", /\bfalse\b/.test(await motorVal(page)));

  // Force MotorRun to its current value (false), then drive StartPB on.
  await page.locator('.esco-watch tr:has-text("MotorRun") button:has-text("Force")').click();
  await page.waitForFunction(() => document.querySelectorAll(".esco-watch tr.is-forced").length >= 1);
  check("forcing a tag marks its row", (await forcedRows(page)) >= 1);

  await page.locator('.esco-watch tr:has-text("StartPB") button:has-text("Toggle")').click();
  await page.locator('button:has-text("Scan Once")').click();
  await page.waitForTimeout(60);
  check("force wins: MotorRun stays false despite Start", /\bfalse\b/.test(await motorVal(page)));

  // Trace tab captured the last scan.
  await tab(page, "Trace").click();
  await page.locator(".esco-tracetable").waitFor({ timeout: 5000 });
  const traceText = await page.locator(".esco-tracetable").innerText();
  check("trace captured instructions (OTE present)", /OTE/.test(traceText) && /MotorRun/.test(traceText));

  // Clear forces; now logic energizes MotorRun.
  await tab(page, "Watch").click();
  await page.locator('button:has-text("Clear Forces")').click();
  await page.waitForFunction(() => document.querySelectorAll(".esco-watch tr.is-forced").length === 0);
  check("clear forces removes the force", (await forcedRows(page)) === 0);

  await page.locator('button:has-text("Scan Once")').click();
  await page.waitForTimeout(60);
  check("after clearing force, logic energizes MotorRun", /\btrue\b/.test(await motorVal(page)));

  const passed = results.filter(Boolean).length;
  console.log(`\nSUMMARY: ${passed}/${results.length} checks passed`);
  process.exitCode = passed === results.length ? 0 : 1;
} catch (err) {
  console.log("ERROR:", err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
