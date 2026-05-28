import { chromium } from "playwright-core";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { writeFileSync } from "node:fs";
import { importL5XPath } from "./helpers.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const URL = "http://localhost:5173/";
const fixturePath = join(here, "array-fixture.L5X");

const FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0" TargetName="ArrCtl" ContentType="Controller">
  <Controller Use="Target" Name="ArrCtl">
    <Tags>
      <Tag Name="Arr" TagType="Base" DataType="DINT" Dimensions="4"/>
    </Tags>
    <Programs>
      <Program Name="MainProgram" MainRoutineName="MainRoutine">
        <Routines>
          <Routine Name="MainRoutine" Type="RLL">
            <RLLContent>
              <Rung Number="0" Type="N"><Text><![CDATA[MOV(42,Arr[1]);]]></Text></Rung>
            </RLLContent>
          </Routine>
        </Routines>
      </Program>
    </Programs>
  </Controller>
</RSLogix5000Content>`;
writeFileSync(fixturePath, FIXTURE, "utf-8");

const results = [];
const check = (l, c, d = "") => { results.push(!!c); console.log(`${c ? "PASS" : "FAIL"}  ${l}${d ? "  — " + d : ""}`); };
const watchValue = (page, name) =>
  page.locator(`.esco-watch tr:has-text("${name}") .esco-watch__value`).first().innerText();

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
try {
  await page.goto(URL, { waitUntil: "networkidle" });

  await importL5XPath(page, fixturePath);
  await page.locator('.esco-titlebar__project:has-text("ArrCtl")').waitFor({ timeout: 8000 });

  await page.locator('button:has-text("MainRoutine")').first().click();
  await page.locator('.esco-dock__tab:has-text("Watch")').click();

  // The DINT[4] array is expanded into four watchable elements.
  check("array element Arr[0] is watched", (await page.locator('.esco-watch tr:has-text("Arr[0]")').count()) === 1);
  check("array element Arr[3] is watched", (await page.locator('.esco-watch tr:has-text("Arr[3]")').count()) === 1);
  check("array has no out-of-range element Arr[4]", (await page.locator('.esco-watch tr:has-text("Arr[4]")').count()) === 0);

  // MOV(42, Arr[1]) writes element 1 on scan.
  await page.locator('button:has-text("Scan Once")').click();
  await page.waitForTimeout(60);
  const v1 = await watchValue(page, "Arr[1]");
  check("MOV writes the array element: Arr[1]=42", /\b42\b/.test(v1), v1.trim());

  const passed = results.filter(Boolean).length;
  console.log(`\nSUMMARY: ${passed}/${results.length} checks passed`);
  process.exitCode = passed === results.length ? 0 : 1;
} catch (err) {
  console.log("ERROR:", err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
