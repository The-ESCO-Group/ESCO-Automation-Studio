import { chromium } from "playwright-core";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { writeFileSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));
const URL = "http://localhost:5173/";
const fixturePath = join(here, "structure-fixture.L5X");

const FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0" TargetName="StructCtl" ContentType="Controller">
  <Controller Use="Target" Name="StructCtl">
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

  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.locator('.esco-titlebar__actions button:has-text("Import L5X")').click(),
  ]);
  await chooser.setFiles(fixturePath);
  await page.locator('.esco-titlebar__project:has-text("StructCtl")').waitFor({ timeout: 8000 });

  const explorer = await page.locator(".esco-left").innerText();
  check("Data Types group shows the imported UDT", /Data Types \(1\)/.test(explorer) && /MotorUdt/.test(explorer), explorer.match(/MotorUdt[^\n]*/)?.[0] ?? "");
  check("Add-On Instructions group shows the AOI", /Add-On Instructions \(1\)/.test(explorer) && /ScaleAOI/.test(explorer));
  check("I/O Modules group shows the modules", /I\/O Modules \(2\)/.test(explorer) && /DI_01/.test(explorer));
  check("module shows catalog + slot", /1756-IB16/.test(explorer) && /slot 1/.test(explorer));

  const passed = results.filter(Boolean).length;
  console.log(`\nSUMMARY: ${passed}/${results.length} checks passed`);
  process.exitCode = passed === results.length ? 0 : 1;
} catch (err) {
  console.log("ERROR:", err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
