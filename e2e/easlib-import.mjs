import { chromium } from "playwright-core";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFile } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import { URL, clickFileMenuItem, dismissToasts, importL5XPath } from "./helpers.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(here, "easlib-import-fixture.L5X");

const FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0" TargetName="EasLibCtl" ContentType="Controller">
  <Controller Use="Target" Name="EasLibCtl">
    <AddOnInstructionDefinitions>
      <AddOnInstructionDefinition Name="ScaleAOI" Revision="1.3">
        <Parameters>
          <Parameter Name="In" DataType="REAL" Usage="Input" Required="true"/>
          <Parameter Name="Out" DataType="REAL" Usage="Output"/>
        </Parameters>
        <LocalTags><LocalTag Name="Scratch" DataType="DINT"/></LocalTags>
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
const check = (label, condition, detail = "") => {
  results.push(!!condition);
  console.log(`${condition ? "PASS" : "FAIL"}  ${label}${detail ? "  - " + String(detail).replace(/\s+/g, " ").slice(0, 160) : ""}`);
};

const contextCommand = async (page, targetSelector, commandText) => {
  await page.locator(targetSelector).first().click({ button: "right" });
  await page.locator(".esco-context-menu--organizer").waitFor({ timeout: 5000 });
  await page.locator(`.esco-context-menu__item:has-text("${commandText}")`).click();
};

const AOI_ROOT = '.esco-left .esco-tree__group:has-text("Add-On Instructions")';

const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext({ viewport: { width: 1400, height: 950 }, acceptDownloads: true });
const page = await context.newPage();
page.on("pageerror", (error) => console.log("PAGEERROR:", error.message));

try {
  await page.goto(URL, { waitUntil: "networkidle" });
  await importL5XPath(page, fixturePath);
  await page.locator('.esco-tree__node--aoi:has-text("ScaleAOI")').waitFor({ timeout: 8000 });
  await dismissToasts(page);
  check("AOI fixture imported with ScaleAOI", (await page.locator('.esco-tree__node--aoi:has-text("ScaleAOI")').count()) >= 1);

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    clickFileMenuItem(page, "Export ESCO Library"),
  ]);
  const exportPath = await download.path();
  const exportedText = exportPath ? await readFile(exportPath, "utf8") : "";
  const exported = JSON.parse(exportedText || "{}");
  check(
    "Export ESCO Library produced a checksummed .easlib artifact",
    download.suggestedFilename().endsWith(".easlib") &&
      exported.native?.kind === "library" &&
      /^[0-9a-f]{64}$/.test(exported.native?.checksum?.value ?? ""),
    JSON.stringify({ filename: download.suggestedFilename(), kind: exported.native?.kind }),
  );

  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    contextCommand(page, AOI_ROOT, "Import Add-On Instruction"),
  ]);
  await chooser.setFiles(exportPath);
  await page.locator("#esco-import-title").waitFor({ timeout: 8000 });
  const dialogText = await page.locator(".esco-modal__panel").innerText();
  check(
    "Import Add-On Instruction accepts the ESCO library and flags the name collision",
    /ScaleAOI/i.test(dialogText) && /already exist|rename/i.test(dialogText),
    dialogText,
  );

  await page.locator('.esco-modal__footer .esco-btn--primary:has-text("Import components")').click();
  await page.locator("#esco-import-title").waitFor({ state: "detached", timeout: 8000 });
  await page.locator('.esco-tree__node--aoi:has-text("ScaleAOI_1")').waitFor({ timeout: 8000 });
  check(
    ".easlib import adds the AOI through the offline component flow",
    (await page.locator('.esco-tree__node--aoi:has-text("ScaleAOI_1")').count()) >= 1,
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
