// E2E: the ladder editor display-mode toolbar buttons must change visible state.
// Covers Tag description display, Operand inline display, Operand text mode,
// Show branch structure, and Show instruction source.
import { chromium } from "playwright-core";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { writeFileSync } from "node:fs";
import { URL, dismissToasts, importL5XPath, openMainRoutine } from "./helpers.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(here, "laddertoolbar-fixture.L5X");

const FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0" TargetName="LadCtrl" ContentType="Controller">
  <Controller Use="Target" Name="LadCtrl">
    <Tags>
      <Tag Name="StartPB" TagType="Base" DataType="BOOL"><Description><![CDATA[Master start command]]></Description></Tag>
      <Tag Name="Level" TagType="Base" DataType="DINT">
        <Description><![CDATA[Tank level reading]]></Description>
        <EngineeringUnits><EngineeringUnit Operand="">psi</EngineeringUnit></EngineeringUnits>
      </Tag>
      <Tag Name="MotorRun" TagType="Base" DataType="BOOL"><Description><![CDATA[Motor run output]]></Description></Tag>
    </Tags>
    <Programs>
      <Program Name="MainProgram" MainRoutineName="MainRoutine">
        <Routines>
          <Routine Name="MainRoutine" Type="RLL">
            <RLLContent>
              <Rung Number="0" Type="N"><Text><![CDATA[XIC(StartPB)GRT(Level,100)OTE(MotorRun);]]></Text></Rung>
            </RLLContent>
          </Routine>
        </Routines>
      </Program>
    </Programs>
  </Controller>
</RSLogix5000Content>`;

writeFileSync(fixturePath, FIXTURE, "utf-8");

const results = [];
const check = (label, cond, detail = "") => {
  results.push(!!cond);
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${detail ? "  - " + String(detail).replace(/\s+/g, " ").slice(0, 100) : ""}`);
};

const toolBtn = (page, label) => page.locator(`.esco-editor__tool-btn[aria-label="${label}"]`).first();

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));

try {
  await page.goto(URL, { waitUntil: "networkidle" });
  await importL5XPath(page, fixturePath);
  await openMainRoutine(page);
  await dismissToasts(page);
  await page.locator(".esco-lad__rung").first().click();

  // Baseline: no operand annotations and no inspector.
  check("baseline has no operand annotations", (await page.locator(".esco-lad__operand-annotation").count()) === 0);
  check("baseline has no rung inspector", (await page.locator(".esco-rung-inspector").count()) === 0);

  // 1) Tag description display -> descriptions appear under operands.
  await toolBtn(page, "Tag description display").click();
  await page.locator(".esco-lad__operand-desc").first().waitFor({ timeout: 8000 });
  const descText = await page.locator(".esco-lad__operand-annotation").allInnerTexts();
  const descBlob = descText.join(" | ");
  check("Tag description display shows project tag descriptions", /Master start command/.test(descBlob), descBlob);
  check("Tag description display shows engineering units", /psi/.test(descBlob), descBlob);
  check("Tag description button is pressed", (await toolBtn(page, "Tag description display").getAttribute("aria-pressed")) === "true");

  // 2) Operand inline display -> data type metadata appears.
  await toolBtn(page, "Operand inline display").click();
  await page.locator(".esco-lad__operand-meta").first().waitFor({ timeout: 8000 });
  const metaBlob = (await page.locator(".esco-lad__operand-meta").allInnerTexts()).join(" | ");
  check("Operand inline display shows data types", /BOOL/.test(metaBlob) && /DINT/.test(metaBlob), metaBlob);

  // 3) Operand text mode -> clears all annotations.
  await toolBtn(page, "Operand text mode").click();
  await page.locator(".esco-lad__operand-annotation").first().waitFor({ state: "detached", timeout: 8000 });
  check("Operand text mode clears annotations", (await page.locator(".esco-lad__operand-annotation").count()) === 0);
  check("Operand text mode button is pressed", (await toolBtn(page, "Operand text mode").getAttribute("aria-pressed")) === "true");

  // 4) Show branch structure -> inspector with branch tree.
  await toolBtn(page, "Show branch structure").click();
  await page.locator(".esco-rung-inspector").waitFor({ timeout: 8000 });
  const branchText = await page.locator(".esco-rung-inspector").innerText();
  check("Show branch structure opens branch inspector", /Branch Structure/.test(branchText), branchText);
  check("Branch inspector lists series instructions", /XIC\(StartPB\)/.test(branchText) && /Series/.test(branchText), branchText);

  // 5) Show instruction source -> serialized rung text (rungToText).
  await toolBtn(page, "Show instruction source").click();
  await page.locator(".esco-rung-inspector__source pre").waitFor({ timeout: 8000 });
  const sourceText = await page.locator(".esco-rung-inspector__source pre").innerText();
  check(
    "Show instruction source shows serialized rung text",
    /XIC\(StartPB\)/.test(sourceText) && /GRT\(Level,100\)/.test(sourceText) && /OTE\(MotorRun\)/.test(sourceText),
    sourceText,
  );

  // Toggling the active inspector button off closes it.
  await toolBtn(page, "Show instruction source").click();
  await page.locator(".esco-rung-inspector").waitFor({ state: "detached", timeout: 8000 });
  check("toggling inspector button off closes the drawer", (await page.locator(".esco-rung-inspector").count()) === 0);

  const passed = results.filter(Boolean).length;
  console.log(`\nSUMMARY: ${passed}/${results.length} checks passed`);
  process.exitCode = passed === results.length ? 0 : 1;
} catch (err) {
  console.log("ERROR:", err.message);
  await page.screenshot({ path: join(here, "laddertoolbar-error.png") }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
