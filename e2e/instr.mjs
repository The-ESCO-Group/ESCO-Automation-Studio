import { chromium } from "playwright-core";
import { URL, importL5XText, openWatchPanel } from "./helpers.mjs";

const results = [];
const check = (l, c, d = "") => { results.push(!!c); console.log(`${c ? "PASS" : "FAIL"}  ${l}${d ? "  - " + d : ""}`); };
const watchText = (page, tag) => page.locator(`.esco-watch tr:has-text("${tag}")`).first().innerText();

const INSTRUCTION_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0" TargetName="E2E_Instructions" ContentType="Controller">
  <Controller Use="Target" Name="E2E_Instructions">
    <Tags>
      <Tag Name="StartPB" TagType="Base" DataType="BOOL"/>
      <Tag Name="StopPB" TagType="Base" DataType="BOOL"/>
      <Tag Name="MotorRun" TagType="Base" DataType="BOOL"/>
      <Tag Name="SomeDint" TagType="Base" DataType="DINT"/>
      <Tag Name="Timer1" TagType="Base" DataType="TIMER"/>
      <Tag Name="SeqControl" TagType="Base" DataType="CONTROL"/>
      <Tag Name="Axis1" TagType="Base" DataType="AXIS_CIP_DRIVE"/>
      <Tag Name="MotionCtl" TagType="Base" DataType="MOTION_INSTRUCTION"/>
    </Tags>
    <Programs>
      <Program Name="MainProgram" MainRoutineName="MainRoutine">
        <Routines>
          <Routine Name="MainRoutine" Type="RLL">
            <RLLContent>
              <Rung Number="0" Type="N"><Text><![CDATA[XIC(StartPB)XIO(StopPB)OTE(MotorRun);]]></Text></Rung>
              <Rung Number="1" Type="N"><Text><![CDATA[XIC(StartPB)MOV(123,SomeDint);]]></Text></Rung>
              <Rung Number="2" Type="N"><Text><![CDATA[XIC(StartPB)TON(Timer1,750);]]></Text></Rung>
              <Rung Number="3" Type="N"><Text><![CDATA[SQC(SeqControl,0,0,0);]]></Text></Rung>
              <Rung Number="4" Type="N"><Text><![CDATA[MSO(Axis1,MotionCtl);]]></Text></Rung>
            </RLLContent>
          </Routine>
        </Routines>
      </Program>
    </Programs>
  </Controller>
</RSLogix5000Content>`;

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));

try {
  await page.goto(URL, { waitUntil: "networkidle" });
  await importL5XText(page, INSTRUCTION_FIXTURE, "instructions.L5X");

  check("imported MOV, TON, SQC, and MSO rungs render in the ladder", (
    await page.locator(".esco-lad__box").filter({ hasText: /MOV|TON|SQC|MSO/ }).count()
  ) >= 4);
  check("model-only imported instructions use the preserved-review ladder style", (
    await page.locator(".esco-lad__box--model-only").filter({ hasText: "MSO" }).count()
  ) >= 1);

  const msoTitle = await page.locator(".esco-lad__box--model-only", { hasText: "MSO" }).first().getAttribute("title");
  check("model-only imported instruction is labelled for review", /model-only \/ preserved, not simulated/i.test(msoTitle ?? ""), msoTitle ?? "");

  const sqcTitle = await page.locator(".esco-lad__box", { hasText: "SQC" }).first().getAttribute("title");
  check("executable sequencer compare keeps normal ladder title", sqcTitle === "SQC", sqcTitle ?? "");

  const movTitle = await page.locator(".esco-lad__box", { hasText: "MOV" }).first().getAttribute("title");
  check("executable imported instruction keeps normal ladder title", movTitle === "MOV", movTitle ?? "");

  await openWatchPanel(page);
  await page.waitForFunction(() => [...document.querySelectorAll(".esco-watch td")].some((td) => td.textContent === "SomeDint"));
  check("imported DINT and TIMER tags appear in Watch", (
    await page.locator(".esco-watch tr:has-text('SomeDint')").count()
  ) === 1 && (
    await page.locator(".esco-watch tr:has-text('Timer1')").count()
  ) === 1);

  await page.locator('.esco-watch tr:has-text("StartPB") button:has-text("Toggle")').click();
  for (let i = 0; i < 4; i++) {
    await page.locator('button:has-text("Scan Once")').click();
    await page.waitForTimeout(40);
  }
  check("MOV simulates from imported logic: SomeDint=123", /\b123\b/.test(await watchText(page, "SomeDint")));
  check("TON simulates from imported logic: Timer1 DN=true", /DN=true/.test(await watchText(page, "Timer1")));
  check("seal-in still drives MotorRun=true", /\btrue\b/.test(await watchText(page, "MotorRun")));

  const passed = results.filter(Boolean).length;
  console.log(`\nSUMMARY: ${passed}/${results.length} checks passed`);
  process.exitCode = passed === results.length ? 0 : 1;
} catch (err) {
  console.log("ERROR:", err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
