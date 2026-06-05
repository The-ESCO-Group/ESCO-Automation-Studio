import { chromium } from "playwright-core";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { URL, importL5XPath } from "./helpers.mjs";

// Roundtrip: export an Add-On Instruction component, then re-import the same
// file and resolve the resulting name collision (rename / overwrite / skip)
// through the offline conflict dialog.

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(here, "component-import-fixture.L5X");

const FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0" TargetName="ImpCtl" ContentType="Controller">
  <Controller Use="Target" Name="ImpCtl">
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
const check = (label, condition, detail = "") => {
  results.push(!!condition);
  console.log(`${condition ? "PASS" : "FAIL"}  ${label}${detail ? "  — " + String(detail).replace(/\s+/g, " ").slice(0, 160) : ""}`);
};

const contextCommand = async (page, targetSelector, commandText) => {
  await page.locator(targetSelector).first().click({ button: "right" });
  await page.locator(".esco-context-menu--organizer").waitFor({ timeout: 5000 });
  await page.locator(`.esco-context-menu__item:has-text("${commandText}")`).click();
};

const aoiCount = (page) => page.locator(".esco-tree__node--aoi").count();

const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext({ viewport: { width: 1400, height: 950 }, acceptDownloads: true });
const page = await context.newPage();
page.on("pageerror", (error) => console.log("PAGEERROR:", error.message));

const AOI_ROOT = '.esco-left .esco-tree__group:has-text("Add-On Instructions")';

try {
  await page.goto(URL, { waitUntil: "networkidle" });
  await importL5XPath(page, fixturePath);
  await page.locator('.esco-tree__node--aoi:has-text("ScaleAOI")').waitFor({ timeout: 8000 });
  check("AOI fixture imported with ScaleAOI", (await aoiCount(page)) === 1);

  // 1) Export the AOI component to a real ESCO envelope file.
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    contextCommand(page, '.esco-tree__node--aoi:has-text("ScaleAOI")', "Export Custom Instruction"),
  ]);
  const exportPath = await download.path();
  const envelope = JSON.parse(exportPath ? await readFile(exportPath, "utf8") : "{}");
  check(
    "Export Custom Instruction wrote a custom-instruction envelope",
    download.suggestedFilename() === "ScaleAOI.esco-custom-instruction.json" && envelope.kind === "custom-instruction",
    JSON.stringify({ filename: download.suggestedFilename(), kind: envelope.kind }),
  );

  // 2) Re-import the same file — the collision must open the conflict dialog.
  const reimport = async () => {
    const [chooser] = await Promise.all([
      page.waitForEvent("filechooser"),
      contextCommand(page, AOI_ROOT, "Import Add-On Instruction"),
    ]);
    await chooser.setFiles(exportPath);
    await page.locator("#esco-import-title").waitFor({ timeout: 8000 });
  };
  await reimport();
  check(
    "Re-importing the AOI opens the conflict dialog flagging ScaleAOI",
    (await page.locator('.esco-tagcsv__row--rename:has-text("ScaleAOI")').count()) === 1 &&
      (await page.locator(".esco-modal__panel:has-text('already exist')").count()) >= 1,
  );

  // 3) Choosing "Skip" leaves nothing to import, so Apply must disable.
  const resolution = page.locator('select[aria-label="Resolution for ScaleAOI"]');
  const applyButton = page.locator('.esco-modal__footer .esco-btn--primary:has-text("Import components")');
  await resolution.selectOption("skip");
  check("Skipping the only component disables Import", await applyButton.isDisabled());

  // 4) Default rename brings it in as ScaleAOI_1.
  await resolution.selectOption("rename");
  await applyButton.click();
  await page.locator("#esco-import-title").waitFor({ state: "detached", timeout: 8000 });
  await page.locator('.esco-tree__node--aoi:has-text("ScaleAOI_1")').waitFor({ timeout: 8000 });
  check("Rename resolution imports ScaleAOI as ScaleAOI_1", (await aoiCount(page)) === 2);

  // 5) Overwrite replaces the existing ScaleAOI in place — no new node added.
  await reimport();
  await page.locator('select[aria-label="Resolution for ScaleAOI"]').selectOption("overwrite");
  await page.locator('.esco-modal__footer .esco-btn--primary:has-text("Import components")').click();
  await page.locator("#esco-import-title").waitFor({ state: "detached", timeout: 8000 });
  check(
    "Overwrite resolution replaces ScaleAOI without adding a node",
    (await aoiCount(page)) === 2 &&
      (await page.locator('.esco-tree__node--aoi:has-text("ScaleAOI_2")').count()) === 0 &&
      (await page.locator('.esco-tree__node--aoi:has-text("ScaleAOI")').count()) >= 1,
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
