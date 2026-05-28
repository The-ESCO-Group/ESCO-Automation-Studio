import { chromium } from "playwright-core";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { writeFileSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));
const URL = "http://localhost:5173/";
const fixturePath = join(here, "aoi-fixture.L5X");

const FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0" TargetName="AoiCtl" ContentType="Controller">
  <Controller Use="Target" Name="AoiCtl">
    <AddOnInstructionDefinitions>
      <AddOnInstructionDefinition Name="ScaleAOI" Revision="1.3">
        <Description><![CDATA[Analog scaler]]></Description>
        <Parameters>
          <Parameter Name="In" DataType="REAL" Usage="Input" Required="true"/>
          <Parameter Name="Out" DataType="REAL" Usage="Output"/>
        </Parameters>
        <LocalTags><LocalTag Name="Scratch" DataType="DINT"/></LocalTags>
        <Routines><Routine Name="Logic" Type="RLL"/></Routines>
      </AddOnInstructionDefinition>
    </AddOnInstructionDefinitions>
    <Tags><Tag Name="Inst" DataType="ScaleAOI"/></Tags>
    <Programs>
      <Program Name="MainProgram" MainRoutineName="Main">
        <Routines><Routine Name="Main" Type="RLL"><RLLContent>
          <Rung Number="0" Type="N"><Text><![CDATA[ScaleAOI(Inst);]]></Text></Rung>
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
  await page.locator('.esco-titlebar__project:has-text("AoiCtl")').waitFor({ timeout: 8000 });

  check("Add-On Instructions group shown", /Add-On Instructions \(1\)/.test(await page.locator(".esco-left").innerText()));

  // Click the AOI node -> detail view opens in the center.
  await page.locator('.esco-tree__node--aoi:has-text("ScaleAOI")').click();
  await page.locator(".esco-detail").waitFor({ timeout: 5000 });
  const detail = await page.locator(".esco-detail").innerText();

  check("AOI detail shows the name + revision", /ScaleAOI/.test(detail) && /Rev 1\.3/.test(detail));
  check("AOI detail shows parameters (In/Input, Out/Output)", /\bIn\b/.test(detail) && /Input/.test(detail) && /\bOut\b/.test(detail) && /Output/.test(detail));
  check("AOI detail shows local tags (Scratch)", /Scratch/.test(detail));
  check("AOI detail shows routines (Logic)", /Logic/.test(detail));
  check("AOI detail shows 'Used by' (Main rung 0)", /used by/i.test(detail) && /Main/.test(detail) && /rung 0/.test(detail));

  const passed = results.filter(Boolean).length;
  console.log(`\nSUMMARY: ${passed}/${results.length} checks passed`);
  process.exitCode = passed === results.length ? 0 : 1;
} catch (err) {
  console.log("ERROR:", err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
