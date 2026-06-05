import { chromium } from "playwright-core";
import { URL, dismissToasts, importL5XText } from "./helpers.mjs";

const ALARM_REVIEW_L5X = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0" TargetName="AlarmReview_E2E" ContentType="Controller">
  <Controller Use="Target" Name="AlarmReview_E2E">
    <Tags>
      <Tag Name="LevelHigh" TagType="Base" DataType="ALARM_ANALOG"/>
      <Tag Name="DoorOpen" TagType="Base" DataType="ALARM_DIGITAL"/>
      <Tag Name="BadAlarm" TagType="Base" DataType="DINT"/>
      <Tag Name="LevelPV" TagType="Base" DataType="REAL"/>
      <Tag Name="DoorIn" TagType="Base" DataType="BOOL"/>
    </Tags>
    <DataTypes>
      <DataType Name="AreaAlarm" Family="NoFamily">
        <Members>
          <Member Name="Acked" DataType="BOOL"/>
          <Member Name="InAlarm" DataType="BOOL"/>
        </Members>
      </DataType>
    </DataTypes>
    <AddOnInstructionDefinitions>
      <AddOnInstructionDefinition Name="P_Alarm" Revision="5.01" Vendor="Example Process Library" SourceProtectionType="Protected">
        <Parameters>
          <Parameter Name="Inp" DataType="BOOL" Usage="Input"/>
          <Parameter Name="Sts_InAlarm" DataType="BOOL" Usage="Output"/>
        </Parameters>
        <LocalTags>
          <LocalTag Name="Cfg" DataType="DINT"/>
        </LocalTags>
        <Routines><Routine Name="Logic" Type="RLL"/></Routines>
      </AddOnInstructionDefinition>
    </AddOnInstructionDefinitions>
    <Programs>
      <Program Name="Area01" MainRoutineName="MainRoutine">
        <Routines>
          <Routine Name="MainRoutine" Type="RLL">
            <RLLContent>
              <Rung Number="0"><Text><![CDATA[ALMA(LevelHigh,LevelPV);]]></Text></Rung>
              <Rung Number="1"><Text><![CDATA[ALMD(DoorOpen,DoorIn);]]></Text></Rung>
              <Rung Number="2"><Text><![CDATA[ALMD(BadAlarm,DoorIn);]]></Text></Rung>
            </RLLContent>
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
  await importL5XText(page, ALARM_REVIEW_L5X, "alarm-review.L5X");
  await dismissToasts(page);

  await page.locator('.esco-ribbon__tab:has-text("View")').click();
  await page.locator('.esco-ribbon-menu__item:has-text("Model Summary")').click();
  await page.locator('.esco-model__subheading:has-text("Controller / Process Alarm Review")').waitFor({ timeout: 8000 });
  const text = await page.locator(".esco-model").innerText();

  check("Model Summary exposes controller/process alarm review", /Controller \/ Process Alarm Review/i.test(text), text);
  check("alarm review lists imported analog and digital alarm tags", /ALARM_ANALOG/i.test(text) && /LevelHigh/i.test(text) && /ALARM_DIGITAL/i.test(text) && /DoorOpen/i.test(text), text);
  check("alarm review lists ALMA and ALMD instruction rows", /ALMA/i.test(text) && /ALMD/i.test(text) && /Rung 0/i.test(text) && /Rung 1/i.test(text), text);
  check("alarm review flags mismatched alarm tag types", /BadAlarm/i.test(text) && /needs-attention/i.test(text), text);
  check("alarm review lists process alarm definitions and fields", /P_Alarm/i.test(text) && /Sts_InAlarm: BOOL/i.test(text) && /AreaAlarm/i.test(text) && /InAlarm: BOOL/i.test(text), text);
  check(
    "alarm review keeps offline alarm boundaries visible",
    /alarm condition evaluation/i.test(text) &&
      /status updates/i.test(text) &&
      /latch\/acknowledge/i.test(text) &&
      /deadband\/delay timing/i.test(text) &&
      /controller communication/i.test(text) &&
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
