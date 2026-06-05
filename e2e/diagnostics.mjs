import { chromium } from "playwright-core";
import { URL, dismissToasts, importL5XText } from "./helpers.mjs";

const L5X = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0" TargetName="DiagCtrl" ContentType="Controller">
  <Controller Use="Target" Name="DiagCtrl">
    <Tags>
      <Tag Name="StartPB" TagType="Base" DataType="BOOL"/>
      <Tag Name="MotorRun" TagType="Base" DataType="BOOL"/>
    </Tags>
    <Programs>
      <Program Name="MainProgram" MainRoutineName="MainRoutine">
        <Routines>
          <Routine Name="MainRoutine" Type="RLL">
            <RLLContent>
              <Rung Number="0" Type="N"><Text><![CDATA[XIC(GhostInput)OTE(MotorRun);]]></Text></Rung>
            </RLLContent>
          </Routine>
          <Routine Name="CalcST" Type="ST">
            <STContent>
              <Line Number="0"><![CDATA[IF StartPB THEN]]></Line>
              <Line Number="1"><![CDATA[  MotorRun := TRUE;]]></Line>
            </STContent>
          </Routine>
        </Routines>
      </Program>
    </Programs>
    <Tasks><Task Name="MainTask" Type="CONTINUOUS"><ScheduledPrograms><ScheduledProgram Name="MainProgram"/></ScheduledPrograms></Task></Tasks>
  </Controller>
</RSLogix5000Content>`;

const results = [];
const check = (label, cond, detail = "") => {
  results.push(!!cond);
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${detail ? "  - " + String(detail).replace(/\s+/g, " ").slice(0, 120) : ""}`);
};

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
page.setDefaultTimeout(10000);
page.on("pageerror", (error) => console.log("PAGEERROR:", error.message));

try {
  await page.goto(URL, { waitUntil: "networkidle" });
  await importL5XText(page, L5X, "diagnostics.L5X");
  await dismissToasts(page);

  await page.locator('.esco-ribbon__tab:has-text("Logic")').click();
  await page.locator('.esco-ribbon-menu__item:has-text("Verify Controller")').click();
  await page.locator('.esco-dock__tab:has-text("Errors")').click();
  await page.locator('.esco-dock__tab.is-active:has-text("Errors")').waitFor();
  await page.locator(".esco-diagnostics__table").waitFor();
  const diagnosticsText = await page.locator(".esco-diagnostics").innerText();
  check(
    "Verify produces actionable diagnostic rows with severity, area, target, and actions",
    /Severity/.test(diagnosticsText) &&
      /Area/.test(diagnosticsText) &&
      /structured-text-syntax/.test(diagnosticsText) &&
      /GhostInput/.test(diagnosticsText) &&
      /Open/.test(diagnosticsText),
    diagnosticsText,
  );

  await page.getByTestId("diagnostic-area-structured-text").click();
  const stFilteredText = await page.locator(".esco-diagnostics").innerText();
  check(
    "Diagnostics area filter isolates Structured Text findings",
    /Showing\s+1\s+of\s+3/.test(stFilteredText) &&
      /structured-text-syntax/.test(stFilteredText) &&
      !/GhostInput/.test(stFilteredText),
    stFilteredText,
  );

  await page.getByTestId("diagnostic-area-tags-data-types").click();
  const tagFilteredText = await page.locator(".esco-diagnostics").innerText();
  check(
    "Diagnostics area filter isolates tag/data-type findings",
    /Showing\s+1\s+of\s+3/.test(tagFilteredText) &&
      /GhostInput/.test(tagFilteredText) &&
      !/structured-text-syntax/.test(tagFilteredText),
    tagFilteredText,
  );

  await page.getByTestId("diagnostic-filter-warning").click();
  const emptyFilteredText = await page.locator(".esco-diagnostics").innerText();
  check("Diagnostics filters show an explicit empty filtered state", /No diagnostics match the selected filters/.test(emptyFilteredText), emptyFilteredText);

  await page.getByTestId("diagnostic-filter-clear").click();
  const clearedFilterText = await page.locator(".esco-diagnostics").innerText();
  check("Diagnostics filter clear restores all rows", /structured-text-syntax/.test(clearedFilterText) && /GhostInput/.test(clearedFilterText), clearedFilterText);

  await page.locator('.esco-diagnostics__table tr:has-text("structured-text-syntax") button:has-text("Open")').first().click();
  await page.locator("textarea.esco-st-editor").waitFor();
  check("Diagnostic Open selects the Structured Text routine", /MotorRun := TRUE/.test(await page.locator("textarea.esco-st-editor").inputValue()));

  await page.locator('.esco-dock__tab:has-text("Build")').click();
  await page.locator(".esco-build__table").waitFor();
  const buildText = await page.locator(".esco-build").innerText();
  check(
    "Build output includes phase rows and failed verify findings",
    /Offline build output/.test(buildText) &&
      /Build Result/.test(buildText) &&
      /Structured Text/.test(buildText) &&
      /Tags\/Data Types/.test(buildText) &&
      /Failed/.test(buildText),
    buildText,
  );

  await page.locator('.esco-build__bar button:has-text("Clear Output")').click();
  check("Clear Output empties the build grid without changing live validation", /Output cleared/i.test(await page.locator(".esco-build").innerText()));

  await page.locator('.esco-build__bar button:has-text("Verify Controller")').click();
  const rerunText = await page.locator(".esco-build").innerText();
  check("Re-run repopulates build diagnostics after clearing", /structured-text-syntax/.test(rerunText) && /GhostInput/.test(rerunText), rerunText);

  const passed = results.filter(Boolean).length;
  console.log(`\nSUMMARY: ${passed}/${results.length} checks passed`);
  process.exitCode = passed === results.length ? 0 : 1;
} catch (error) {
  console.log("ERROR:", error.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
