import { chromium } from "playwright-core";
import { URL, dismissToasts, importL5XText } from "./helpers.mjs";

const FBD_L5X = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0" TargetName="FBD_E2E" ContentType="Controller">
  <Controller Use="Target" Name="FBD_E2E">
    <Tags>
      <Tag Name="Level" TagType="Base" DataType="REAL"/>
      <Tag Name="ValveCmd" TagType="Base" DataType="REAL"/>
    </Tags>
    <Programs>
      <Program Name="MainProgram" MainRoutineName="LoopFBD">
        <Routines>
          <Routine Name="LoopFBD" Type="FBD">
            <FBDContent SheetSize="Letter">
              <Sheet Number="0" Name="Loop">
                <Block ID="1" Type="PIDE" Operand="PIDE_01" X="120" Y="80" Visible="true">
                  <InputParameters>
                    <InputParameter Name="PV" Operand="Level"/>
                    <Parameter Name="SP" Value="10.0"/>
                  </InputParameters>
                  <OutputParameter Name="CV" Operand="ValveCmd"/>
                </Block>
                <Block ID="6" Type="TOT" Operand="Totalizer" X="120" Y="150"/>
                <IRef ID="2" Operand="Level" X="40" Y="80"/>
                <ORef ID="3" Operand="ValveCmd" X="240" Y="80"/>
                <Wire ID="4" FromID="2" ToID="1"/>
                <Wire ID="7" FromID="6"/>
                <TextBox ID="5" Text="Offline FBD review"/>
                <VendorNote Code="ReviewOnly"/>
              </Sheet>
            </FBDContent>
          </Routine>
        </Routines>
      </Program>
    </Programs>
  </Controller>
</RSLogix5000Content>`;

const results = [];
const check = (label, cond, detail = "") => {
  results.push(!!cond);
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${detail ? "  - " + String(detail).replace(/\s+/g, " ").slice(0, 120) : ""}`);
};

const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
const page = await context.newPage();
page.on("pageerror", (error) => console.log("PAGEERROR:", error.message));

try {
  await page.goto(URL, { waitUntil: "networkidle" });
  await importL5XText(page, FBD_L5X, "fbd-review.L5X");
  await dismissToasts(page);

  await page.locator('.esco-tree__node--routine:has-text("LoopFBD")').first().click();
  await page.locator(".esco-fbd-review").waitFor({ timeout: 8000 });
  const text = await page.locator(".esco-fbd-review").innerText();

  check("FBD routine opens a model-only review pane", /Model-only review/.test(text), text);
  check("FBD review keeps offline execution boundary visible", /offline review only/i.test(text) && /does not execute FBD/i.test(text), text);
  check("FBD review exposes sheet and object counts", /1 sheet/.test(text) && /2 blocks/.test(text) && /3 parameters/.test(text) && /1 input ref/.test(text) && /1 output ref/.test(text) && /2 wires/.test(text), text);
  check("FBD review exposes parseability and prominent block types", /XML parseable/.test(text) && /Blocks PIDE x1, TOT x1/.test(text), text);
  check("FBD review exposes block operands", /PIDE/.test(text) && /PIDE_01/.test(text) && /Totalizer/.test(text), text);
  const panelTexts = await page.locator(".esco-fbd-sheet__panel").allInnerTexts();
  const blocksPanel = panelTexts.find((panel) => panel.startsWith("Blocks\n")) ?? "";
  const parametersPanel = panelTexts.find((panel) => panel.startsWith("Block Parameters\n")) ?? "";
  check("FBD review keeps block parameters out of the Blocks table", /PIDE_01/.test(blocksPanel) && !/Parameters/.test(blocksPanel), blocksPanel);
  check("FBD review exposes block parameters in a dedicated table", /Block Parameters/.test(parametersPanel) && /In\s+PV\s+Level/.test(parametersPanel) && /In\s+SP\s+10\.0/.test(parametersPanel) && /Out\s+CV\s+ValveCmd/.test(parametersPanel), parametersPanel);
  check("FBD review exposes references and wires", /Level/.test(text) && /ValveCmd/.test(text) && /From/.test(text) && /To/.test(text), text);
  check("FBD review exposes text boxes", /Offline FBD review/.test(text), text);
  check("FBD review exposes unknown elements and endpoint warnings", /VendorNote/.test(text) && /Preserved unknown FBD element/i.test(text) && /unrecognized FBD element/i.test(text) && /missing imported endpoint metadata/i.test(text), text);
  check("FBD review exposes semantic diagnostics without execution claims", /1 semantic warning/.test(text) && /Semantic review diagnostics/.test(text) && /missing imported destination endpoint metadata/i.test(text) && !/execute FBD sheets/i.test(text.replace(/does not execute FBD sheets/i, "")), text);

  await page.locator(".esco-tags__search").fill("ValveCmd");
  const filtered = await page.locator(".esco-fbd-review").innerText();
  check("FBD review search filters preserved metadata", /ValveCmd/.test(filtered) && /No blocks on this sheet/.test(filtered) && !/PIDE_01/.test(filtered), filtered);

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
