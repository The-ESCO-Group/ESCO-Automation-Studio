import { chromium } from "playwright-core";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { writeFileSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));
const URL = "http://localhost:5173/";
const fixturePath = join(here, "udt-fixture.L5X");

const FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0" TargetName="UdtCtl" ContentType="Controller">
  <Controller Use="Target" Name="UdtCtl">
    <DataTypes>
      <DataType Name="MotorUdt">
        <Description><![CDATA[Motor status]]></Description>
        <Members>
          <Member Name="Running" DataType="BOOL"/>
          <Member Name="Speed" DataType="DINT"/>
          <Member Name="History" DataType="DINT" Dimension="8"/>
        </Members>
      </DataType>
    </DataTypes>
    <Tags><Tag Name="M1" DataType="MotorUdt"/></Tags>
    <Programs>
      <Program Name="MainProgram" MainRoutineName="Main">
        <Routines><Routine Name="Main" Type="RLL"><RLLContent>
          <Rung Number="0" Type="N"><Text><![CDATA[XIC(M1.Running)OTE(M1.Running);]]></Text></Rung>
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
  await page.locator('.esco-titlebar__project:has-text("UdtCtl")').waitFor({ timeout: 8000 });

  await page.locator('.esco-tree__node--udt:has-text("MotorUdt")').click();
  await page.locator(".esco-detail").waitFor({ timeout: 5000 });
  const detail = await page.locator(".esco-detail").innerText();

  check("UDT detail shows name + description", /MotorUdt/.test(detail) && /Motor status/.test(detail));
  check("UDT detail shows members with array dim", /Running/.test(detail) && /Speed/.test(detail) && /History/.test(detail) && /\[8\]/.test(detail));
  check("UDT detail shows member paths", /MotorUdt\.Running/.test(detail));
  check("UDT detail shows tags using the type (M1)", /using this type/i.test(detail) && /\bM1\b/.test(detail));

  const passed = results.filter(Boolean).length;
  console.log(`\nSUMMARY: ${passed}/${results.length} checks passed`);
  process.exitCode = passed === results.length ? 0 : 1;
} catch (err) {
  console.log("ERROR:", err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
