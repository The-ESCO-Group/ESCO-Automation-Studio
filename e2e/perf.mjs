import { chromium } from "playwright-core";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { writeFileSync } from "node:fs";
import { importL5XPath } from "./helpers.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const URL = "http://localhost:5173/";
const fixturePath = join(here, "perf-fixture.L5X");

const RUNG_COUNT = 120;
const rungs = Array.from(
  { length: RUNG_COUNT },
  (_, i) => `<Rung Number="${i}" Type="N"><Text><![CDATA[XIC(Bit0)OTE(Bit${i % 5});]]></Text></Rung>`,
).join("");
const tags = Array.from({ length: 5 }, (_, i) => `<Tag Name="Bit${i}" DataType="BOOL"/>`).join("");

const FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0" TargetName="BigCtl" ContentType="Controller">
  <Controller Use="Target" Name="BigCtl">
    <Tags>${tags}</Tags>
    <Programs>
      <Program Name="MainProgram" MainRoutineName="MainRoutine">
        <Routines><Routine Name="MainRoutine" Type="RLL"><RLLContent>${rungs}</RLLContent></Routine></Routines>
      </Program>
    </Programs>
  </Controller>
</RSLogix5000Content>`;
writeFileSync(fixturePath, FIXTURE, "utf-8");

const results = [];
const check = (l, c, d = "") => { results.push(!!c); console.log(`${c ? "PASS" : "FAIL"}  ${l}${d ? "  — " + d : ""}`); };
const rungCount = (page) => page.locator(".esco-lad__rung").count();

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
try {
  await page.goto(URL, { waitUntil: "networkidle" });
  await importL5XPath(page, fixturePath);
  await page.locator('.esco-titlebar__name:has-text("BigCtl")').waitFor({ timeout: 8000 });

  await page.locator('button:has-text("MainRoutine")').first().click();
  await page.locator(".esco-lad__rung").first().waitFor({ timeout: 8000 });

  // Large routine renders a bounded virtual scroll window instead of every rung.
  const firstRenderCount = await rungCount(page);
  check("large routine is virtualized below total rungs", firstRenderCount > 0 && firstRenderCount < RUNG_COUNT, `rungs=${firstRenderCount}`);
  check("large-routine banner shown", (await page.locator(".esco-editor__largebanner").count()) === 1);
  check("large-routine banner reports visible window", /rungs 1-\d+ of 120/.test(await page.locator(".esco-editor__largebanner").innerText()));

  // Scrolling reaches the tail of the routine without rendering the full list.
  await page.locator(".esco-editor__surface").evaluate((surface) => {
    surface.scrollTop = surface.scrollHeight;
    surface.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
  await page.waitForFunction(() =>
    [...document.querySelectorAll(".esco-lad__rung-no")].some((node) => node.textContent?.trim() === "119"),
  );
  check("virtual scroll reaches last rung", true);
  check("tail window remains bounded", (await rungCount(page)) > 0 && (await rungCount(page)) < RUNG_COUNT, `rungs=${await rungCount(page)}`);

  const passed = results.filter(Boolean).length;
  console.log(`\nSUMMARY: ${passed}/${results.length} checks passed`);
  process.exitCode = passed === results.length ? 0 : 1;
} catch (err) {
  console.log("ERROR:", err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
