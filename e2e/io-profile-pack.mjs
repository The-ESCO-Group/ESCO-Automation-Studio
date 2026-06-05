import { chromium } from "playwright-core";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { URL, createBlankProject, importL5XPath } from "./helpers.mjs";

const results = [];
const check = (label, condition, detail = "") => {
  results.push(!!condition);
  console.log(`${condition ? "PASS" : "FAIL"}  ${label}${detail ? "  - " + String(detail).replace(/\s+/g, " ").slice(0, 180) : ""}`);
};

const IO_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0" TargetName="PackCtl" ContentType="Controller">
  <Controller Use="Target" Name="PackCtl" ProcessorType="1756-L85E">
    <Modules>
      <Module Name="DI_01" CatalogNumber="1756-IB16" Slot="1" ProductType="Digital Input">
        <Description><![CDATA[Imported field inputs]]></Description>
        <Communications>
          <Connections>
            <Connection Name="Input" RPI="20000" Type="Input" Priority="Scheduled" InputConnectionType="Multicast"/>
          </Connections>
        </Communications>
      </Module>
    </Modules>
    <Tags><Tag Name="Start" DataType="BOOL"/></Tags>
    <Programs>
      <Program Name="MainProgram" MainRoutineName="Main">
        <Routines>
          <Routine Name="Main" Type="RLL">
            <RLLContent>
              <Rung Number="0" Type="N"><Text><![CDATA[XIC(Start)OTE(Start);]]></Text></Rung>
            </RLLContent>
          </Routine>
        </Routines>
      </Program>
    </Programs>
  </Controller>
</RSLogix5000Content>`;

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(here, "io-profile-pack-source.L5X");
writeFileSync(fixturePath, IO_FIXTURE, "utf-8");

const ioRoot = (page) => page.locator('.esco-tree__group--button:has-text("I/O Configuration")').first();
const contextCommand = async (page, target, commandText) => {
  await target.click({ button: "right" });
  await page.locator(".esco-context-menu--organizer").waitFor({ timeout: 8000 });
  await page.locator(`.esco-context-menu__item:has-text("${commandText}")`).click();
};

const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext({ viewport: { width: 1400, height: 950 }, acceptDownloads: true });
const page = await context.newPage();
page.on("pageerror", (error) => console.log("PAGEERROR:", error.message));

try {
  await page.goto(URL, { waitUntil: "networkidle" });
  await importL5XPath(page, fixturePath);
  await page.locator('.esco-tree__node--module:has-text("Slot 1: 1756-IB16")').waitFor({ timeout: 8000 });

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    contextCommand(page, ioRoot(page), "Export I/O Profile Pack"),
  ]);
  const exportPath = await download.path();
  const text = exportPath ? await readFile(exportPath, "utf8") : "";
  const envelope = JSON.parse(text || "{}");
  check(
    "I/O context menu exports an ESCO .easio profile pack",
    download.suggestedFilename() === "PackCtl-io-profile-pack.easio" &&
      envelope.formatName === "ESCO I/O Configuration" &&
      envelope.payload?.modules?.[0]?.name === "DI_01",
    JSON.stringify({ filename: download.suggestedFilename(), formatName: envelope.formatName, module: envelope.payload?.modules?.[0]?.name }),
  );
  check(
    "Exported profile pack carries offline boundary evidence",
    /No AOP install parsing/.test((envelope.payload?.boundaries ?? []).join(" ")) &&
      /No PLC upload\/download/.test((envelope.payload?.boundaries ?? []).join(" ")),
    (envelope.payload?.boundaries ?? []).join(" | "),
  );

  await page.goto(URL, { waitUntil: "networkidle" });
  await createBlankProject(page);
  await ioRoot(page).waitFor({ timeout: 8000 });
  check("Blank target starts without the imported DI_01 module", (await page.locator('.esco-tree__node--module:has-text("DI_01")').count()) === 0);

  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    contextCommand(page, ioRoot(page), "Import I/O Profile Pack"),
  ]);
  await chooser.setFiles(exportPath);
  await page.locator("#esco-import-title").waitFor({ timeout: 8000 });
  const dialogText = await page.locator(".esco-modal__panel").innerText();
  check(
    "Importing .easio opens the profile-pack review dialog",
    /I\/O Module Profile import/i.test(dialogText) && /DI_01/.test(dialogText) && /1 new/i.test(dialogText),
    dialogText,
  );
  await page.locator('.esco-modal__footer .esco-btn--primary:has-text("Import components")').click();
  await page.locator("#esco-import-title").waitFor({ state: "detached", timeout: 8000 });
  await page.locator('.esco-tree__node--module:has-text("Slot 1: 1756-IB16")').waitFor({ timeout: 8000 });
  await page.locator('.esco-tree__node--module:has-text("Slot 1: 1756-IB16")').click();
  const detail = await page.locator(".esco-detail").innerText();
  check(
    "Imported profile pack creates the offline module profile in I/O configuration",
    /DI_01/.test(detail) && /1756-IB16/.test(detail) && /Digital Input|Offline profile/i.test(detail),
    detail,
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
