import { chromium } from "playwright-core";
import { URL, dismissToasts, importL5XText } from "./helpers.mjs";

const STRUCTURE_GAPS_L5X = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0" TargetName="StructureGaps_E2E" ContentType="Controller">
  <Controller Use="Target" Name="StructureGaps_E2E">
    <Modules>
      <Module Name="Local" CatalogNumber="1756-L83E" Slot="0"/>
      <Module Name="Drive_01" CatalogNumber="PowerFlex 755" Slot="1" ParentModule="Local" ProductType="AC Drive"/>
      <Module Name="RemoteFlex" CatalogNumber="5094-AENTR" Slot="2" ParentModule="Local" ProductType="FLEX 5000 Ethernet Adapter"/>
      <Module Name="HART_AI" CatalogNumber="1756-IF8IH" Slot="3" ParentModule="Local" ProductType="HART Analog Input"/>
    </Modules>
    <Tags>
      <Tag Name="Alarm01" TagType="Base" DataType="ALARM_DIGITAL"/>
      <Tag Name="Loop01" TagType="Base" DataType="PID"/>
      <Tag Name="Valve01" TagType="Base" DataType="PVLV"/>
    </Tags>
    <DataTypes>
      <DataType Name="PVLV" Family="NoFamily">
        <Members>
          <Member Name="Cmd_Open" DataType="BOOL"/>
          <Member Name="Sts_Opened" DataType="BOOL"/>
        </Members>
      </DataType>
    </DataTypes>
    <AddOnInstructionDefinitions>
      <AddOnInstructionDefinition Name="P_PIDE" Revision="5.01" Vendor="Example Process Library" SourceProtectionType="Protected">
        <Parameters>
          <Parameter Name="Inp_PV" DataType="REAL" Usage="Input"/>
          <Parameter Name="Out_CV" DataType="REAL" Usage="Output"/>
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
              <Rung Number="0"><Text><![CDATA[NOP();]]></Text></Rung>
            </RLLContent>
          </Routine>
          <Routine Name="BlendLoop" Type="FBD">
            <FBDContent SheetSize="Letter">
              <Sheet Number="0" Name="Loop">
                <Block ID="1" Type="PIDE" Operand="Loop01" X="120" Y="80">
                  <InputParameter Name="PV" Operand="Valve01"/>
                  <InputParameter Name="SP" Value="42.0"/>
                  <OutputParameters>
                    <OutputParameter Name="CV" Operand="Drive_01"/>
                  </OutputParameters>
                </Block>
                <IRef ID="2" Operand="Valve01" X="40" Y="80"/>
                <ORef ID="3" Operand="Drive_01" X="240" Y="80"/>
                <Wire ID="4" FromID="2" ToID="1"/>
              </Sheet>
            </FBDContent>
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
  await importL5XText(page, STRUCTURE_GAPS_L5X, "structure-gaps.L5X");
  await dismissToasts(page);

  await page.locator('.esco-ribbon__tab:has-text("View")').click();
  await page.locator('.esco-ribbon-menu__item:has-text("Model Summary")').click();
  await page.locator('.esco-model__heading:has-text("Parity Gap Analysis")').waitFor({ timeout: 8000 });
  const text = await page.locator(".esco-model").innerText();

  check("Model Summary exposes project structure parity gaps", /Parity Gap Analysis/i.test(text), text);
  check(
    "gap analysis lists FBD review evidence and next step",
      /Function Block Diagram/i.test(text) &&
      /1 FBD routine/i.test(text) &&
      /1 program routine/i.test(text) &&
      /0 AOI routine/i.test(text) &&
      /1 parseable for offline review/i.test(text) &&
      /1 sheet/i.test(text) &&
      /1 block/i.test(text) &&
      /3 block parameter\/pin row/i.test(text) &&
      /PIDE x1/i.test(text) &&
      /Semantic review warnings: 0/i.test(text) &&
      /project-wide coverage evidence/i.test(text) &&
      /never executed or edited/i.test(text) &&
      /FBD viewer coverage/i.test(text),
    text,
  );
  check(
    "Model Summary lists FBD review coverage rows",
    /FBD Review Coverage/i.test(text) &&
      /BlendLoop/i.test(text) &&
      /parseable/i.test(text) &&
      /Blocks: PIDE x1/i.test(text) &&
      /parameters: 3 \(2 in, 1 out, 0 in\/out\)/i.test(text) &&
      /preserves 3 imported block parameter\/pin row/i.test(text) &&
      /semantic warnings: 0/i.test(text) &&
      /read-only XML\/preserved-source evidence/i.test(text) &&
      /does not execute FBD sheets/i.test(text),
    text,
  );
  check("gap analysis lists vendor process-library evidence", /Vendor process library/i.test(text) && /process-library object/i.test(text), text);
  check("gap analysis lists advanced module profile evidence", /Advanced module profiles/i.test(text) && /AC drives/i.test(text) && /process instrumentation I\/O/i.test(text), text);
  check("gap analysis lists alarm and PID/process gaps", /Alarm definitions \/ process alarms/i.test(text) && /Equipment phases \/ process \/ PID/i.test(text), text);
  check(
    "gap analysis keeps offline/proprietary/physical-controller boundaries visible",
    /read-only and offline/i.test(text) &&
      /no proprietary\s+binary formats/i.test(text) &&
      /controller upload\/download/i.test(text) &&
      /go-online/i.test(text) &&
      /online edits/i.test(text) &&
      /physical transports/i.test(text),
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
