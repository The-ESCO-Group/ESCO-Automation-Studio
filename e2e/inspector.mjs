import { chromium } from "playwright-core";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { URL, importL5XText, importStarterProject, openDockPanel, openWatchPanel } from "./helpers.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const results = [];
const check = (label, cond, detail = "") => {
  results.push(!!cond);
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${detail ? "  - " + detail : ""}`);
};

const ADVANCED_DOMAIN_L5X = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0" TargetName="AdvancedDomainCtl" ContentType="Controller">
  <Controller Use="Target" Name="AdvancedDomainCtl">
    <SafetyInfo SafetyEnabled="true">
      <SafetyTagMap>StdOK,SafeOK</SafetyTagMap>
    </SafetyInfo>
    <Tags>
      <Tag Name="StdOK" DataType="BOOL" Class="Standard"/>
      <Tag Name="SafeOK" DataType="BOOL" Class="Safety"/>
      <Tag Name="MotionGroup" DataType="MOTION_GROUP"/>
      <Tag Name="Coord1" DataType="COORDINATE_SYSTEM"/>
      <Tag Name="Axis1" DataType="AXIS_CIP_DRIVE"/>
      <Tag Name="GroupCtl" DataType="MOTION_INSTRUCTION"/>
      <Tag Name="CoordCtl" DataType="MOTION_INSTRUCTION"/>
      <Tag Name="MoveCtl" DataType="MOTION_INSTRUCTION"/>
      <Tag Name="Loop1" DataType="PID"/>
      <Tag Name="PV" DataType="REAL"/>
      <Tag Name="CV" DataType="REAL"/>
      <Tag Name="Mixer1" DataType="EQUIPMENT_PHASE"/>
    </Tags>
    <Modules>
      <Module Name="ServoDrive_Axis1" CatalogNumber="Servo drive" ProductType="Servo" ParentModule="Local" ParentModPortId="2"/>
    </Modules>
    <Programs>
      <Program Name="MainProgram" MainRoutineName="MainRoutine">
        <Routines>
          <Routine Name="MainRoutine" Type="RLL">
            <RLLContent>
              <Rung Number="0" Type="N"><Text><![CDATA[MGS(MotionGroup,GroupCtl);]]></Text></Rung>
              <Rung Number="1" Type="N"><Text><![CDATA[MCLM(Coord1,CoordCtl);]]></Text></Rung>
              <Rung Number="2" Type="N"><Text><![CDATA[MAM(Axis1,MoveCtl);]]></Text></Rung>
              <Rung Number="3" Type="N"><Text><![CDATA[PID(Loop1,PV,0,CV);]]></Text></Rung>
              <Rung Number="4" Type="N"><Text><![CDATA[PCMD(Mixer1);]]></Text></Rung>
            </RLLContent>
          </Routine>
        </Routines>
      </Program>
    </Programs>
  </Controller>
</RSLogix5000Content>`;

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));

try {
  await page.goto(URL, { waitUntil: "networkidle" });
  await importStarterProject(page);

  check("old right inspector/copilot rail is absent from the Studio shell", (await page.locator(".esco-copilot, .esco-props").count()) === 0);

  await page.locator('.esco-ribbon__tab:has-text("View")').click();
  await page.locator('.esco-ribbon-menu__item:has-text("Model Summary")').click();
  await page.locator(".esco-model").waitFor({ timeout: 8000 });
  const modelText = await page.locator(".esco-model").innerText();
  check("Model Summary dock shows instruction fidelity", /Instruction Fidelity/i.test(modelText) && /Executable/i.test(modelText), modelText);
  check("Model Summary dock keeps open routine context", /Open routine\s+MainRoutine/.test(modelText), modelText);

  await openWatchPanel(page);
  const tabs = await page.locator(".esco-dock__tab").evaluateAll((nodes) => nodes.map((node) => node.textContent?.trim()).filter(Boolean));
  check("bottom dock exposes Studio work panes", ["Errors", "Search Results", "Cross Reference", "Watch", "Trend", "Forces"].every((label) => tabs.includes(label)), tabs.join("|"));

  await openDockPanel(page, "Forces");
  await page.locator(".esco-forces").waitFor({ timeout: 5000 });
  check("Forces tab shows current empty state", /No forces active/.test(await page.locator(".esco-forces").innerText()));

  await openDockPanel(page, "Search Results");
  await page.locator('.esco-search input[type="search"]').fill("MotorRun");
  await page.waitForTimeout(150);
  check("Search Results tab searches ladder/tag content", (await page.locator(".esco-search table tbody tr").count()) >= 1);

  await page.locator('.esco-lad__operand[title="StartPB"]').first().click({ button: "right" });
  await page.locator('.esco-context-menu__item:has-text("Cross Reference")').click();
  await page.locator(".esco-xref__row").first().waitFor({ timeout: 5000 });
  check("Cross Reference opens from ladder context", /StartPB/.test(await page.locator(".esco-xref__head").innerText()));

  await importL5XText(page, ADVANCED_DOMAIN_L5X, "advanced-domain.L5X");
  await page.locator('.esco-ribbon__tab:has-text("View")').click();
  await page.locator('.esco-ribbon-menu__item:has-text("Model Summary")').click();
  await page.locator(".esco-model").waitFor({ timeout: 8000 });
  const advancedModelText = await page.locator(".esco-model").innerText();
  check(
    "Model Summary shows advanced-domain inspector cards",
      /Domain Inspectors/i.test(advancedModelText) &&
      /Controller SafetyTagMap/.test(advancedModelText) &&
      /Motion Axis \/ Device Tree/i.test(advancedModelText) &&
      /ServoDrive_Axis1/.test(advancedModelText) &&
      /AXIS_CIP_DRIVE/.test(advancedModelText) &&
      /Motion Axis \/ Object Inspector/.test(advancedModelText) &&
      /PIDE \/ Process Loop Inspector/.test(advancedModelText) &&
      /Loop tag/i.test(advancedModelText) &&
      /PV\/CV references/i.test(advancedModelText) &&
      /Timing preview/i.test(advancedModelText) &&
      /offline timing preview/i.test(advancedModelText) &&
      /runtime writes are not executed/i.test(advancedModelText) &&
      /Tuning parameters/i.test(advancedModelText) &&
      /Tuning comparison/i.test(advancedModelText) &&
      /Equipment Phase Inspector/.test(advancedModelText) &&
      /Phase target/i.test(advancedModelText) &&
      /State\/timing preview/i.test(advancedModelText) &&
      /no state engine, arbitration, ownership transfer, batch request, or runtime write is executed/i.test(advancedModelText) &&
      /State transition map/i.test(advancedModelText) &&
      /Command\/request operands/i.test(advancedModelText),
    advancedModelText,
  );
  await page.screenshot({ path: join(here, "inspector1.png") });

  const passed = results.filter(Boolean).length;
  console.log(`\nSUMMARY: ${passed}/${results.length} checks passed`);
  process.exitCode = passed === results.length ? 0 : 1;
} catch (err) {
  console.log("ERROR:", err.message);
  await page.screenshot({ path: join(here, "inspector99-error.png") }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
