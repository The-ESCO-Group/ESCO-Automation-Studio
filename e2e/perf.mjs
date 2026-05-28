import { chromium } from "playwright-core";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { writeFileSync } from "node:fs";

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
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.locator('.esco-titlebar__actions button:has-text("Import L5X")').click(),
  ]);
  await chooser.setFiles(fixturePath);
  await page.locator('.esco-titlebar__project:has-text("BigCtl")').waitFor({ timeout: 8000 });

  await page.locator('button:has-text("MainRoutine")').first().click();
  await page.locator(".esco-lad__rung").first().waitFor({ timeout: 8000 });

  // Large routine collapses to the first 100 rungs with a banner.
  check("large routine is capped to 100 rungs", (await rungCount(page)) === 100, `rungs=${await rungCount(page)}`);
  check("large-routine banner shown", (await page.locator(".esco-editor__largebanner").count()) === 1);

  // Show all reveals every rung.
  await page.locator('.esco-editor__largebanner button:has-text("Show all")').click();
  await page.waitForFunction((n) => document.querySelectorAll(".esco-lad__rung").length === n, RUNG_COUNT);
  check("Show all reveals every rung", (await rungCount(page)) === RUNG_COUNT);

  const passed = results.filter(Boolean).length;
  console.log(`\nSUMMARY: ${passed}/${results.length} checks passed`);
  process.exitCode = passed === results.length ? 0 : 1;
} catch (err) {
  console.log("ERROR:", err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
