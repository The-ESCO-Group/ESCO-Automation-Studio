import { chromium } from "playwright-core";
import { URL, dismissToasts, importL5XText } from "./helpers.mjs";

const ST_COVERAGE_L5X = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0" TargetName="StructuredTextCoverage_E2E" ContentType="Controller">
  <Controller Use="Target" Name="StructuredTextCoverage_E2E">
    <Tags>
      <Tag Name="Start" TagType="Base" DataType="BOOL"/>
      <Tag Name="Count" TagType="Base" DataType="DINT"/>
      <Tag Name="Shot" TagType="Base" DataType="FBD_ONESHOT"/>
      <Tag Name="MessageCtrl" TagType="Base" DataType="MESSAGE"/>
    </Tags>
    <Programs>
      <Program Name="MainProgram" MainRoutineName="MainRoutine">
        <Routines>
          <Routine Name="MainRoutine" Type="RLL">
            <RLLContent>
              <Rung Number="0" Type="N"><Text><![CDATA[NOP();]]></Text></Rung>
            </RLLContent>
          </Routine>
          <Routine Name="CalcST" Type="ST">
            <STContent>
              <Line Number="0"><![CDATA[IF Start THEN]]></Line>
              <Line Number="1"><![CDATA[  MOV(5, Count);]]></Line>
              <Line Number="2"><![CDATA[  OSRI(Shot);]]></Line>
              <Line Number="3"><![CDATA[ELSE]]></Line>
              <Line Number="4"><![CDATA[  MSG(MessageCtrl);]]></Line>
              <Line Number="5"><![CDATA[END_IF;]]></Line>
              <Line Number="6"><![CDATA[FOR Count := 0 TO 2 DO]]></Line>
              <Line Number="7"><![CDATA[  UNSUPPORTED_ST(Count);]]></Line>
              <Line Number="8"><![CDATA[END_FOR;]]></Line>
            </STContent>
          </Routine>
        </Routines>
      </Program>
    </Programs>
  </Controller>
</RSLogix5000Content>`;

const results = [];
const check = (label, cond, detail = "") => {
  results.push(!!cond);
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${detail ? "  - " + String(detail).replace(/\s+/g, " ").slice(0, 140) : ""}`);
};

const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
const page = await context.newPage();
page.on("pageerror", (error) => console.log("PAGEERROR:", error.message));

try {
  await page.goto(URL, { waitUntil: "networkidle" });
  await importL5XText(page, ST_COVERAGE_L5X, "structured-text-coverage.L5X");
  await dismissToasts(page);

  await page.locator('.esco-ribbon__tab:has-text("View")').click();
  await page.locator('.esco-ribbon-menu__item:has-text("Model Summary")').click();
  await page.locator('.esco-model__subheading:has-text("Structured Text Coverage")').waitFor({ timeout: 8000 });
  const text = await page.locator(".esco-model").innerText();

  check("Model Summary exposes Structured Text coverage", /Structured Text Coverage/i.test(text), text);
  check("ST routine row shows imported routine and source location", /CalcST/i.test(text) && /StructuredTextCoverage_E2E \/ MainProgram/i.test(text), text);
  check("ST call fidelity rolls executable, preserved, and unsupported calls together", /2\/4 executable/i.test(text) && /2 preserved for review/i.test(text), text);
  check("ST stats include routines, executable calls, preserved calls, and control-flow routines", /1\s+ST routines/i.test(text) && /2\s+Executable calls/i.test(text) && /2\s+Preserved calls/i.test(text) && /1\s+Control-flow routines/i.test(text), text);
  check("ST control-flow evidence is visible", /Assignments/i.test(text) && /IF\/ELSIF/i.test(text) && /FOR/i.test(text), text);
  check(
    "Structured Text coverage boundaries stay offline-only",
    /offline source evidence only/i.test(text) &&
      /model-only, review-only, and unknown calls are preserved/i.test(text) &&
      /Firmware-specific scan phases/i.test(text) &&
      /online edits/i.test(text) &&
      /physical-controller transfer/i.test(text) &&
      /proprietary binary formats/i.test(text),
    text,
  );

  const passed = results.filter(Boolean).length;
  console.log(`\nSUMMARY: ${passed}/${results.length} checks passed`);
  process.exitCode = passed === results.length ? 0 : 1;
} catch (error) {
  console.log("ERROR:", error.message);
  process.exitCode = 1;
} finally {
  await context.close();
  await browser.close();
}
