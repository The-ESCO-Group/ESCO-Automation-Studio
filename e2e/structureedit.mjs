// E2E: controller-database editing — add/remove UDT members and AOI parameters
// through the reviewed @esco/project-actions layer, and confirm a source-protected
// AOI stays read-only.
import { chromium } from "playwright-core";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { writeFileSync } from "node:fs";
import { URL, importL5XPath } from "./helpers.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(here, "structureedit-fixture.L5X");

const FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0" TargetName="DbCtl" ContentType="Controller">
  <Controller Use="Target" Name="DbCtl">
    <DataTypes>
      <DataType Name="MotorUdt">
        <Members>
          <Member Name="Run" DataType="BOOL"/>
          <Member Name="Speed" DataType="DINT"/>
        </Members>
      </DataType>
    </DataTypes>
    <AddOnInstructionDefinitions>
      <AddOnInstructionDefinition Name="ScaleAOI" Revision="1.0">
        <Parameters>
          <Parameter Name="In" DataType="REAL" Usage="Input" Required="true"/>
          <Parameter Name="Out" DataType="REAL" Usage="Output"/>
        </Parameters>
        <LocalTags><LocalTag Name="Scratch" DataType="DINT"/></LocalTags>
        <Routines><Routine Name="Logic" Type="RLL"/></Routines>
      </AddOnInstructionDefinition>
      <AddOnInstructionDefinition Name="SealedAOI" Revision="2.0" SourceProtectionType="Protected">
        <Parameters><Parameter Name="Enable" DataType="BOOL" Usage="Input"/></Parameters>
        <EncodedData EncodedType="EncryptedData"><![CDATA[QUJD]]></EncodedData>
      </AddOnInstructionDefinition>
    </AddOnInstructionDefinitions>
    <Tags>
      <Tag Name="M1" DataType="MotorUdt"/>
      <Tag Name="Inst" DataType="ScaleAOI"/>
    </Tags>
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
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.locator('button:has-text("Create New Routine")').first().waitFor({ timeout: 60000 });
  await importL5XPath(page, fixturePath);
  await page.locator('.esco-titlebar__project:has-text("DbCtl")').waitFor({ timeout: 8000 });

  // ---- UDT member editing ----
  await page.locator('.esco-tree__node--udt:has-text("MotorUdt")').click();
  await page.locator(".esco-detail").waitFor({ timeout: 5000 });
  check("UDT detail is offline-editable", /Offline editable/.test(await page.locator(".esco-detail").innerText()));

  await page.locator('input[aria-label="New member name"]').fill("Pressure");
  await page.locator('input[aria-label="New member type"]').fill("REAL");
  await page.locator('.esco-edit__add-row button:has-text("Add")').click();
  await page.locator('input[aria-label="Member Pressure name"]').waitFor({ timeout: 5000 });
  check("added a UDT member", /MotorUdt\.Pressure/.test(await page.locator(".esco-detail").innerText()));

  await page.locator('button[aria-label="Remove member Run"]').click();
  await page.locator('input[aria-label="Member Run name"]').waitFor({ state: "detached", timeout: 5000 });
  check("removed a UDT member", (await page.locator('input[aria-label="Member Run name"]').count()) === 0);

  // ---- AOI parameter editing ----
  await page.locator('.esco-tree__node--aoi:has-text("ScaleAOI")').click();
  await page.locator('.esco-detail__title:has-text("ScaleAOI")').waitFor({ timeout: 5000 });
  await page.locator('input[aria-label="New parameter name"]').fill("Gain");
  await page.locator('input[aria-label="New parameter type"]').fill("REAL");
  await page
    .locator('tr.esco-edit__add-row:has(input[aria-label="New parameter name"]) button:has-text("Add")')
    .click();
  await page.locator('input[aria-label="Parameter Gain name"]').waitFor({ timeout: 5000 });
  check("added an AOI parameter", (await page.locator('input[aria-label="Parameter Gain name"]').count()) === 1);

  // ---- Source-protected AOI stays read-only ----
  await page.locator('.esco-tree__node--aoi:has-text("SealedAOI")').click();
  await page.locator('.esco-detail__title:has-text("SealedAOI")').waitFor({ timeout: 5000 });
  const sealed = await page.locator(".esco-detail").innerText();
  check("protected AOI surfaces its protection state", /source-protected/i.test(sealed));
  check(
    "protected AOI exposes no parameter editor",
    (await page.locator('input[aria-label="New parameter name"]').count()) === 0,
  );

  const passed = results.filter(Boolean).length;
  console.log(`\nSUMMARY: ${passed}/${results.length} checks passed`);
  process.exitCode = passed === results.length ? 0 : 1;
} catch (err) {
  console.log("ERROR:", err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
