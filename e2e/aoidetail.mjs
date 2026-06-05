import { chromium } from "playwright-core";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { writeFileSync } from "node:fs";
import { URL, importL5XPath } from "./helpers.mjs";

const here = dirname(fileURLToPath(import.meta.url));
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
      <AddOnInstructionDefinition Name="SealedAOI" Revision="2.0" SignatureID="16#dead_beef" SourceProtectionType="Protected">
        <Description><![CDATA[Vendor-sealed instruction]]></Description>
        <Parameters><Parameter Name="Enable" DataType="BOOL" Usage="Input" Required="true"/></Parameters>
        <EncodedData EncodedType="EncryptedData"><![CDATA[QUJDREVG]]></EncodedData>
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
  await importL5XPath(page, fixturePath);
  await page.locator('.esco-titlebar__name:has-text("AoiCtl")').waitFor({ timeout: 8000 });

  const organizerText = await page.locator(".esco-left").innerText();
  check("Add-On Instructions group shows imported AOIs", /Add-On Instructions/.test(organizerText) && /ScaleAOI/.test(organizerText) && /SealedAOI/.test(organizerText));

  // Click the AOI node -> detail view opens in the center.
  await page.locator('.esco-tree__node--aoi:has-text("ScaleAOI")').click();
  await page.locator(".esco-detail").waitFor({ timeout: 5000 });
  const detail = await page.locator(".esco-detail").innerText();

  check("AOI detail shows the name + revision", /ScaleAOI/.test(detail) && /Rev 1\.3/.test(detail));
  // Parameters and local tags are now editable controls (offline AOI editor).
  check(
    "AOI detail shows editable parameters (In/Out, Input/Output)",
    (await page.locator('input[aria-label="Parameter In name"]').count()) === 1 &&
      (await page.locator('input[aria-label="Parameter Out name"]').count()) === 1 &&
      (await page.locator('select[aria-label="Parameter In usage"]').inputValue()) === "Input" &&
      (await page.locator('select[aria-label="Parameter Out usage"]').inputValue()) === "Output",
  );
  check(
    "AOI detail shows editable local tags (Scratch)",
    (await page.locator('input[aria-label="Local tag Scratch name"]').count()) === 1,
  );
  check("AOI detail shows routines (Logic)", /Logic/.test(detail));
  check("AOI detail shows 'Used by' (Main rung 0)", /used by/i.test(detail) && /Main/.test(detail) && /rung 0/.test(detail));

  // Click the source-protected AOI -> protection state surfaces, logic withheld.
  await page.locator('.esco-tree__node--aoi:has-text("SealedAOI")').click();
  await page.locator('.esco-detail__title:has-text("SealedAOI")').waitFor({ timeout: 5000 });
  const sealed = await page.locator(".esco-detail").innerText();

  check("Protected AOI shows the Protected pill", /Protected/.test(sealed));
  check("Protected AOI shows a source-protection banner", /source-protected/i.test(sealed));
  check("Protected AOI shows its signature", /dead_beef/.test(sealed));
  check("Protected AOI withholds logic", /source-protected and not exported/i.test(sealed));

  const passed = results.filter(Boolean).length;
  console.log(`\nSUMMARY: ${passed}/${results.length} checks passed`);
  process.exitCode = passed === results.length ? 0 : 1;
} catch (err) {
  console.log("ERROR:", err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
