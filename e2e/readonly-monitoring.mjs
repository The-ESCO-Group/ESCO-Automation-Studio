import { chromium } from "playwright-core";
import { URL, dismissToasts, importL5XText, openDockPanel } from "./helpers.mjs";

const MIXED_L5X = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0" TargetName="MixedRoutineCtl" ContentType="Controller">
  <Controller Use="Target" Name="MixedRoutineCtl">
    <Tasks>
      <Task Name="MainTask" Type="PERIODIC" Rate="20" Priority="10" Watchdog="500">
        <ScheduledPrograms><ScheduledProgram Name="MainProgram"/></ScheduledPrograms>
      </Task>
    </Tasks>
    <Tags>
      <Tag Name="StartPB" TagType="Base" DataType="BOOL"/>
      <Tag Name="MotorRun" TagType="Base" DataType="BOOL"/>
      <Tag Name="SpeedCmd" TagType="Base" DataType="DINT"/>
    </Tags>
    <Programs>
      <Program Name="MainProgram" MainRoutineName="MainRoutine">
        <Routines>
          <Routine Name="MainRoutine" Type="RLL">
            <RLLContent>
              <Rung Number="0" Type="N"><Text><![CDATA[XIC(StartPB)OTE(MotorRun);]]></Text></Rung>
            </RLLContent>
          </Routine>
          <Routine Name="ScaleST" Type="ST">
            <STContent>
              <Line>SpeedCmd := SpeedCmd + 1;</Line>
              <Line>IF SpeedCmd &gt; 100 THEN</Line>
              <Line>  SpeedCmd := 0;</Line>
              <Line>END_IF;</Line>
            </STContent>
          </Routine>
          <Routine Name="LoopFBD" Type="FBD">
            <FBDContent SheetSize="Letter">
              <Sheet Number="1">
                <Block Type="PIDE" Operand="PIDE_01" Visible="true"/>
                <Wire From="SpeedCmd" To="PIDE_01.PV"/>
              </Sheet>
            </FBDContent>
          </Routine>
          <Routine Name="SeqSFC" Type="SFC">
            <SFCContent>
              <Step Name="Idle" X="100" Y="100"/>
              <Transition Name="StartTransition" Condition="StartPB"/>
            </SFCContent>
          </Routine>
        </Routines>
      </Program>
    </Programs>
  </Controller>
</RSLogix5000Content>`;

const results = [];
const check = (label, cond, detail = "") => {
  results.push(!!cond);
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${detail ? "  - " + String(detail).replace(/\s+/g, " ").slice(0, 90) : ""}`);
};
const routineNode = (page, label) => page.locator(`.esco-tree__node--routine:has-text("${label}")`).first();

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));

try {
  // The app's LiveBridge opens a retrying EventSource (MCP live stream), so the
  // network never goes idle — wait for the shell to mount instead of networkidle.
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.locator(".esco-ribbon").waitFor({ timeout: 60000 });
  await importL5XText(page, MIXED_L5X, "mixed-routines.L5X");
  await dismissToasts(page);

  await routineNode(page, "ScaleST").click();
  await page.locator(".esco-st-editor").waitFor({ timeout: 5000 });
  const stText = await page.locator(".esco-nonladder").innerText();
  const stSource = await page.locator(".esco-st-editor").inputValue();
  check("Structured Text routine opens in editable ST editor", /Editable ST/.test(stText) && /SpeedCmd := SpeedCmd \+ 1/.test(stSource));

  await routineNode(page, "LoopFBD").click();
  await page.locator(".esco-fbd-review").waitFor({ timeout: 5000 });
  const fbdText = await page.locator(".esco-fbd-review").innerText();
  check(
    "Function Block routine opens as model-only review (read-only, not executed)",
    /Model-only review/.test(fbdText) && /offline review only/i.test(fbdText) && /PIDE_01/.test(fbdText),
  );

  await routineNode(page, "SeqSFC").click();
  await page.locator(".esco-graphical-outline").waitFor({ timeout: 5000 });
  const sfcText = await page.locator(".esco-graphical-outline").innerText();
  check("SFC routine opens as readonly outline", /SFCContent/.test(sfcText) && /Idle/.test(sfcText));

  await openDockPanel(page, "Trend");
  await page.locator(".esco-trend").waitFor({ timeout: 5000 });
  check("Trend starts with an honest empty buffer", /No trend samples yet/.test(await page.locator(".esco-trend").innerText()));
  await page.locator('.esco-trend button:has-text("Capture Scan")').click();
  await page.locator(".esco-trend__samples tbody tr").first().waitFor({ timeout: 5000 });
  const trendText = await page.locator(".esco-trend").innerText();
  check("Trend capture records a scan sample", /Trend buffer:\s*1 sample/.test(trendText) && /StartPB/.test(trendText));

  await page.locator('.esco-trend button:has-text("Clear Buffer")').click();
  await page.locator('.esco-trend:has-text("No trend samples yet")').waitFor({ timeout: 5000 });
  check("Trend Clear Buffer empties the buffer", /No trend samples yet/.test(await page.locator(".esco-trend").innerText()));

  const organizerText = await page.locator(".esco-left").innerText();
  check("Controller Organizer shows imported task metadata", /MainTask/.test(organizerText) && /MainProgram/.test(organizerText));

  const passed = results.filter(Boolean).length;
  console.log(`\nSUMMARY: ${passed}/${results.length} checks passed`);
  process.exitCode = passed === results.length ? 0 : 1;
} catch (err) {
  console.log("ERROR:", err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
