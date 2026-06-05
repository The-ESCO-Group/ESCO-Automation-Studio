import { chromium } from "playwright-core";
import { URL, dismissToasts, importL5XText } from "./helpers.mjs";

const PROCESS_L5X = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0" TargetName="ProcessLib_E2E" ContentType="Controller">
  <Controller Use="Target" Name="ProcessLib_E2E">
    <Tags>
      <Tag Name="AI101" TagType="Base" DataType="P_AIn"/>
    </Tags>
    <DataTypes>
      <DataType Name="PVLV" Family="NoFamily">
        <Members>
          <Member Name="Cmd_Open" DataType="BOOL"/>
          <Member Name="Sts_Opened" DataType="BOOL"/>
          <Member Name="Alm_Fail" DataType="BOOL"/>
        </Members>
      </DataType>
    </DataTypes>
    <AddOnInstructionDefinitions>
      <AddOnInstructionDefinition Name="P_AIn" Revision="5.01" Vendor="Example Process Library" SourceProtectionType="Protected" SignatureID="16#1234">
        <Parameters>
          <Parameter Name="Inp_PV" DataType="REAL" Usage="Input"/>
          <Parameter Name="Sts" DataType="DINT" Usage="Output"/>
        </Parameters>
        <LocalTags>
          <LocalTag Name="Cfg" DataType="DINT"/>
        </LocalTags>
        <Routines><Routine Name="Logic" Type="RLL"/></Routines>
      </AddOnInstructionDefinition>
    </AddOnInstructionDefinitions>
    <Programs>
      <Program Name="Area01">
        <Tags>
          <Tag Name="XV101" TagType="Base" DataType="PVLV"/>
          <Tag Name="MissingObj" TagType="Base" DataType="raP_Unknown"/>
        </Tags>
        <Routines>
          <Routine Name="MainRoutine" Type="RLL">
            <RLLContent>
              <Rung Number="0"><Text><![CDATA[NOP();]]></Text></Rung>
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
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${detail ? "  - " + String(detail).replace(/\s+/g, " ").slice(0, 120) : ""}`);
};

const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
const page = await context.newPage();
page.on("pageerror", (error) => console.log("PAGEERROR:", error.message));

try {
  await page.goto(URL, { waitUntil: "networkidle" });
  await importL5XText(page, PROCESS_L5X, "process-library.L5X");
  await dismissToasts(page);

  await page.locator('.esco-ribbon__tab:has-text("View")').click();
  await page.locator('.esco-ribbon-menu__item:has-text("Model Summary")').click();
  await page.locator('.esco-model__subheading:has-text("Process Library Objects")').waitFor({ timeout: 8000 });
  const text = await page.locator(".esco-model").innerText();

  check("Model Summary exposes process library object section", /Process Library Objects/i.test(text), text);
  check("process library section exposes AOI definition", /AOI/i.test(text) && /P_AIn/.test(text) && /metadata-only/i.test(text), text);
  check("process library section exposes UDT definition and fields", /UDT/i.test(text) && /PVLV/.test(text) && /Alm_Fail: BOOL/.test(text), text);
  check("process library section exposes tag instances", /TAG/i.test(text) && /AI101/.test(text) && /XV101/.test(text), text);
  check("process library section flags missing imported definitions", /MissingObj/.test(text) && /definition not imported/.test(text), text);
  check("process library section keeps model-only boundaries visible", /Vendor faceplates/.test(text) && /process-object execution/.test(text) && /controller communication are not modelled/.test(text), text);

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
