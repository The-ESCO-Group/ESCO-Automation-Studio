import { chromium } from "playwright-core";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { writeFileSync } from "node:fs";
import { importL5XPath } from "./helpers.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const URL = process.env.E2E_URL || "http://localhost:5173/";
const fixturePath = join(here, "io-detail-fixture.L5X");

const FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0" TargetName="IoCtl" ContentType="Controller">
  <Controller Use="Target" Name="IoCtl">
    <Modules>
      <Module Name="Local" CatalogNumber="1756-L83E" Slot="0"/>
      <Module Name="DI_01" CatalogNumber="1756-IB16" Slot="1" ParentModule="Local"><Description><![CDATA[Field inputs]]></Description></Module>
      <Module Name="DO_01" CatalogNumber="1756-OB16" Slot="2" ParentModule="Local"/>
      <Module Name="Drive_01" CatalogNumber="PowerFlex 755" Slot="3" ParentModule="Local" ProductType="AC Drive"/>
      <Module Name="HART_AI" CatalogNumber="1756-IF8IH" Slot="4" ParentModule="Local" ProductType="HART Analog Input"/>
      <Module Name="EN2T_01" CatalogNumber="1756-EN2T" Slot="5" ParentModule="Local" ProductType="EtherNet/IP Bridge"/>
      <Module Name="FlexAI" CatalogNumber="5094-IF8" Slot="6" ParentModule="Local" ProductType="FLEX 5000 Analog Input"/>
      <Module Name="FlexHart" CatalogNumber="5094-IF8IH" Slot="7" ParentModule="Local" ProductType="FLEX 5000 HART Analog Input"/>
    </Modules>
    <Tags><Tag Name="Start" DataType="BOOL"/></Tags>
    <Programs>
      <Program Name="MainProgram" MainRoutineName="Main">
        <Routines><Routine Name="Main" Type="RLL"><RLLContent>
          <Rung Number="0" Type="N"><Text><![CDATA[XIC(Start)OTE(Start);]]></Text></Rung>
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
  await page.locator('.esco-titlebar__name:has-text("IoCtl")').waitFor({ timeout: 8000 });

  await page.locator('.esco-ribbon__tab:has-text("View")').click();
  await page.locator('.esco-ribbon-menu__item:has-text("Model Summary")').click();
  await page.locator('.esco-model__subheading:has-text("Advanced Module Profiles")').waitFor({ timeout: 8000 });
  const modelSummary = await page.locator(".esco-model").innerText();
  check(
    "Model Summary exposes advanced module profile rollup",
      /Advanced Module Profiles/i.test(modelSummary) &&
      /PowerFlex 755/.test(modelSummary) &&
      /1756-IF8IH/.test(modelSummary) &&
      /1756-EN2T/.test(modelSummary) &&
      /5094-IF8/.test(modelSummary) &&
      /FLEX 5000 \/ 5094 profile/i.test(modelSummary) &&
      /HART \/ process I\/O profile/i.test(modelSummary) &&
      /Industrial network bridge profile/i.test(modelSummary) &&
      /AOP download/i.test(modelSummary) &&
      /live diagnostics/i.test(modelSummary),
    modelSummary,
  );

  // Open the I/O Configuration detail view. Creation belongs in the right-click New Module workflow,
  // so this page should stay focused on list/profile/edit/remove instead of showing a permanent catalog.
  await page.locator('.esco-tree__group--button:has-text("I/O Configuration")').click();
  await page.locator(".esco-detail").waitFor({ timeout: 5000 });
  const detail = await page.locator(".esco-detail").innerText();

  check(
    "I/O detail shows a clean offline backplane overview",
      /Local Backplane/i.test(detail) &&
      /Field modules\s*7/i.test(detail) &&
      /Next open slot\s*8/i.test(detail) &&
      /Connection\s*Offline metadata/i.test(detail),
    detail,
  );
  check(
    "I/O detail lists field modules by slot without inline form clutter",
    /Slot 1\s*1756-IB16\s*DI_01/s.test(detail) &&
      /Slot 2\s*1756-OB16\s*DO_01/s.test(detail) &&
      /Slot 3\s*PowerFlex 755\s*Drive_01/s.test(detail) &&
      /Slot 5\s*1756-EN2T\s*EN2T_01/s.test(detail) &&
      /Slot 6\s*5094-IF8\s*FlexAI/s.test(detail) &&
      /Properties\s*Inhibit\s*Delete/s.test(detail),
    detail,
  );
  check("I/O detail never shows the inline Add I/O Device catalog or module editor", (await page.locator(".esco-iodevice-add, .esco-iomodule-props").count()) === 0);

  await page.locator('.esco-tree__node--module:has-text("Slot 1: 1756-IB16")').click();
  await page.locator('.esco-detail:has-text("Selected Module Profile Review")').waitFor({ timeout: 5000 });
  await page.locator('[aria-label="Module Properties"]').waitFor({ timeout: 5000 });
  const selectedDetail = await page.locator(".esco-detail").innerText();
  check(
    "selecting a module shows profile review without showing inline edit clutter",
    /Selected Module Profile Review/i.test(selectedDetail) &&
      /DI_01/.test(selectedDetail) &&
      /Offline Module Diagnostics/i.test(selectedDetail) &&
      /Offline profile review/i.test(selectedDetail) &&
      /No connection metadata/i.test(selectedDetail) &&
      (await page.locator(".esco-iodevice-add, .esco-iomodule-props").count()) === 0,
    selectedDetail,
  );
  check("clicking a module keeps the I/O Configuration view", /I\/O Configuration/.test(selectedDetail));
  check("I/O module properties open in the dedicated module dialog", (await page.locator('[aria-label="Module Properties"]').count()) === 1);
  await page.locator('.esco-iomodule-dialog .esco-btn:has-text("Cancel")').click();
  await page.locator('[aria-label="Module Properties"]').waitFor({ state: "detached", timeout: 5000 });

  await page.locator('.esco-io-module-card:has-text("Drive_01") .esco-io-module-card__main').click();
  await page.locator('.esco-detail:has-text("AC drive profile")').waitFor({ timeout: 5000 });
  const driveDetail = await page.locator(".esco-detail").innerText();
  check(
    "advanced module profile review surfaces drive AOP-style metadata with offline boundaries",
    /Advanced profile\s*AC drive profile/i.test(driveDetail) &&
      /does not download an AOP profile/i.test(driveDetail) &&
      /browse live diagnostics/i.test(driveDetail),
    driveDetail,
  );

  await page.locator('.esco-io-module-card:has-text("HART_AI") .esco-io-module-card__main').click();
  await page.locator('.esco-detail:has-text("HART / process I/O profile")').waitFor({ timeout: 5000 });
  const hartDetail = await page.locator(".esco-detail").innerText();
  check(
    "advanced module profile review surfaces HART/process I/O metadata with offline boundaries",
    /Advanced profile\s*HART \/ process I\/O profile/i.test(hartDetail) &&
      /does not download an AOP profile/i.test(hartDetail) &&
      /browse live diagnostics/i.test(hartDetail) &&
      /command the module/i.test(hartDetail),
    hartDetail,
  );

  await page.locator('.esco-io-module-card:has-text("FlexAI") .esco-io-module-card__main').click();
  await page.locator('.esco-detail:has-text("FLEX 5000 / 5094 profile")').waitFor({ timeout: 5000 });
  const flexDetail = await page.locator(".esco-detail").innerText();
  check(
    "advanced module profile review surfaces FLEX 5000 metadata with offline boundaries",
    /Advanced profile\s*FLEX 5000 \/ 5094 profile/i.test(flexDetail) &&
      /does not download an AOP profile/i.test(flexDetail) &&
      /browse live diagnostics/i.test(flexDetail) &&
      /command the module/i.test(flexDetail),
    flexDetail,
  );

  await page.locator('.esco-io-module-card:has-text("EN2T_01") .esco-io-module-card__main').click();
  await page.locator('.esco-detail:has-text("Industrial network bridge profile")').waitFor({ timeout: 5000 });
  const bridgeDetail = await page.locator(".esco-detail").innerText();
  check(
    "advanced module profile review surfaces bridge metadata with offline boundaries",
    /Advanced profile\s*Industrial network bridge profile/i.test(bridgeDetail) &&
      /does not download an AOP profile/i.test(bridgeDetail) &&
      /browse live diagnostics/i.test(bridgeDetail) &&
      /command the module/i.test(bridgeDetail),
    bridgeDetail,
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
