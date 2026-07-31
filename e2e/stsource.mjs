import { chromium } from "playwright-core";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import { URL, clickFileMenuItem, dismissToasts, importL5XPath } from "./helpers.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(here, "stsource-fixture.L5X");
const exportedPath = join(here, "stsource-exported.L5X");

const FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0" TargetName="STCtrl" ContentType="Controller">
  <Controller Use="Target" Name="STCtrl">
    <Tags>
      <Tag Name="Start" TagType="Base" DataType="BOOL"/>
      <Tag Name="Done" TagType="Base" DataType="BOOL"/>
    </Tags>
    <Programs>
      <Program Name="MainProgram" MainRoutineName="MainRoutine">
        <Routines>
          <Routine Name="MainRoutine" Type="RLL">
            <RLLContent>
              <Rung Number="0" Type="N"><Text><![CDATA[XIC(Start)OTE(Done);]]></Text></Rung>
            </RLLContent>
          </Routine>
          <Routine Name="CalcST" Type="ST">
            <STContent>
              <Line Number="0"><![CDATA[IF Start THEN]]></Line>
              <Line Number="1"><![CDATA[  Done := TRUE;]]></Line>
              <Line Number="2"><![CDATA[END_IF;]]></Line>
            </STContent>
          </Routine>
        </Routines>
      </Program>
    </Programs>
  </Controller>
</RSLogix5000Content>`;

writeFileSync(fixturePath, FIXTURE, "utf-8");

const results = [];
const check = (label, cond, detail = "") => {
  results.push(!!cond);
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${detail ? "  - " + String(detail).replace(/\s+/g, " ").slice(0, 90) : ""}`);
};

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));

try {
  await page.goto(URL, { waitUntil: "networkidle" });
  await importL5XPath(page, fixturePath);
  await dismissToasts(page);

  await page.locator('button:has-text("CalcST")').first().click();
  await page.locator("textarea.esco-st-editor").waitFor({ timeout: 8000 });
  check("Structured Text routine opens in editable source pane", (await page.locator("textarea.esco-st-editor").count()) === 1);

  const initialStatus = await page.locator(".esco-st-analysis").innerText();
  check("ST structural check reports clean imported source", /check passed/i.test(initialStatus) && /ST syntax OK/i.test(await page.locator(".esco-nonladder__badges").innerText()), initialStatus);

  const brokenSource = "IF Start THEN\n  Done := FALSE;";
  await page.locator("textarea.esco-st-editor").fill(brokenSource);
  const warningStatus = await page.locator(".esco-st-analysis").innerText();
  check("ST structural check reports unmatched block while editing", /IF.*not closed|expected 'END_IF'/i.test(warningStatus), warningStatus);

  await page.locator('button:has-text("Apply ST")').click();
  await page.locator(".esco-toast:has-text('Structured Text source updated')").waitFor({ timeout: 5000 });
  check("Apply ST saves through the IDE action path", true);
  await dismissToasts(page);

  await page.locator('.esco-ribbon__tab:has-text("Logic")').click();
  await page.locator('.esco-ribbon-menu__item:has-text("Verify Controller")').click();
  await page.locator(".esco-diagnostics__table").waitFor({ timeout: 5000 });
  const dockText = await page.locator(".esco-dock").innerText();
  check("Verify reports applied ST structural problems in diagnostics", /structured-text-syntax/i.test(dockText) && /END_IF/i.test(dockText), dockText);

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    clickFileMenuItem(page, "Export L5X"),
  ]);
  await download.saveAs(exportedPath);
  const exported = readFileSync(exportedPath, "utf-8");
  check("Exported L5X preserves edited ST source", /<Routine Name="CalcST" Type="ST">/.test(exported) && /Done := FALSE;/.test(exported), exported.slice(exported.indexOf("CalcST"), exported.indexOf("CalcST") + 180));

  const passed = results.filter(Boolean).length;
  console.log(`\nSUMMARY: ${passed}/${results.length} checks passed`);
  process.exitCode = passed === results.length ? 0 : 1;
} catch (err) {
  console.log("ERROR:", err.message);
  await page.screenshot({ path: join(here, "stsource-error.png") }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
