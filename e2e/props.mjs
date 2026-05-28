import { chromium } from "playwright-core";
const URL = "http://localhost:5173/";
const results = [];
const check = (l, c, d = "") => { results.push(!!c); console.log(`${c ? "PASS" : "FAIL"}  ${l}${d ? "  — " + d : ""}`); };
const heading = async (page) => (await page.locator(".esco-props__heading").first().innerText()).trim().toLowerCase();

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
try {
  await page.goto(URL, { waitUntil: "networkidle" });

  // Tag selection -> Properties shows Tag details.
  await page.locator('.esco-tree__node--tag:has-text("StartPB")').click();
  await page.locator(".esco-props__heading").first().waitFor({ timeout: 5000 });
  check("tag selection shows Tag properties", (await heading(page)) === "tag");
  const propsText = await page.locator(".esco-props").innerText();
  check("tag properties include References + Value", /References/.test(propsText) && /Value/.test(propsText));

  // Cross Ref tab shows StartPB references with a direction badge.
  await page.locator('.esco-dock__tab:has-text("Cross Ref")').click();
  await page.locator(".esco-xref__row").first().waitFor({ timeout: 5000 });
  check("cross ref lists references", (await page.locator(".esco-xref__row").count()) >= 1);
  check("direction badge present", (await page.locator(".esco-xref__dir").count()) >= 1);

  // Open routine, select a rung -> Properties shows Rung.
  await page.locator('button:has-text("MainRoutine")').first().click();
  await page.locator(".esco-lad__rung-no").first().click();
  check("rung selection shows Rung properties", (await heading(page)) === "rung");

  // Select an instruction -> Properties shows Instruction.
  await page.locator(".esco-lad__node").first().click();
  check("instruction selection shows Instruction properties", (await heading(page)) === "instruction");
  await page.screenshot({ path: "C:/Users/nmodha/Projects/esco-e2e/props1.png" });

  const passed = results.filter(Boolean).length;
  console.log(`\nSUMMARY: ${passed}/${results.length} checks passed`);
  process.exitCode = passed === results.length ? 0 : 1;
} catch (err) {
  console.log("ERROR:", err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
