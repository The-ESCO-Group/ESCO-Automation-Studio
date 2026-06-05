import { chromium } from "playwright-core";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { writeFileSync } from "node:fs";
import { importL5XPath } from "./helpers.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const URL = "http://localhost:5173/";
const fixturePath = join(here, "structure-fixture.L5X");

const FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0" TargetName="StructCtl" ContentType="Controller">
  <Controller Use="Target" Name="StructCtl" ProcessorType="1756-L83E">
    <DataTypes>
      <DataType Name="MotorUdt">
        <Members>
          <Member Name="Running" DataType="BOOL"/>
          <Member Name="Speed" DataType="DINT"/>
        </Members>
      </DataType>
    </DataTypes>
    <AddOnInstructionDefinitions>
      <AddOnInstructionDefinition Name="ScaleAOI"><Description><![CDATA[Analog scaler]]></Description></AddOnInstructionDefinition>
    </AddOnInstructionDefinitions>
    <Modules>
      <Module Name="Local" CatalogNumber="1756-L83E" Slot="0"/>
      <Module Name="DI_01" CatalogNumber="1756-IB16" Slot="1"/>
    </Modules>
    <Tags><Tag Name="Start" DataType="BOOL"/><Tag Name="Run" DataType="BOOL"/></Tags>
    <Programs>
      <Program Name="MainProgram" MainRoutineName="Main">
        <Routines><Routine Name="Main" Type="RLL"><RLLContent>
          <Rung Number="0" Type="N"><Text><![CDATA[XIC(Start)OTE(Run);]]></Text></Rung>
        </RLLContent></Routine></Routines>
      </Program>
    </Programs>
  </Controller>
</RSLogix5000Content>`;
writeFileSync(fixturePath, FIXTURE, "utf-8");

const results = [];
const check = (l, c, d = "") => { results.push(!!c); console.log(`${c ? "PASS" : "FAIL"}  ${l}${d ? "  — " + d : ""}`); };

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
try {
  await page.goto(URL, { waitUntil: "networkidle" });

  await importL5XPath(page, fixturePath);
  await page.locator('.esco-titlebar__name:has-text("StructCtl")').waitFor({ timeout: 8000 });

  const explorer = await page.locator(".esco-left").innerText();
  check("Data Types group is present in the organizer", /Data Types/.test(explorer), explorer);
  check("Add-On Instructions group is present in the organizer", /Add-On Instructions/.test(explorer), explorer);
  check("I/O Configuration group shows imported modules", /I\/O Configuration/.test(explorer) && /Slot 1: 1756-IB16/.test(explorer), explorer.match(/Slot 1:[^\n]*/)?.[0] ?? "");
  check("processor and input modules show catalog plus slot", /Slot 0: 1756-L83E Processor/.test(explorer) && /Slot 1: 1756-IB16/.test(explorer));

  const passed = results.filter(Boolean).length;
  console.log(`\nSUMMARY: ${passed}/${results.length} checks passed`);
  process.exitCode = passed === results.length ? 0 : 1;
} catch (err) {
  console.log("ERROR:", err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
