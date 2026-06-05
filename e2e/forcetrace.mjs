import { chromium } from "playwright-core";
import { URL, dismissToasts, importL5XText, openDockPanel, openMainRoutine, openWatchPanel } from "./helpers.mjs";
const results = [];
const check = (l, c, d = "") => { results.push(!!c); console.log(`${c ? "PASS" : "FAIL"}  ${l}${d ? "  — " + d : ""}`); };
const motorVal = (page) => page.locator('.esco-watch tr:has-text("MotorRun") .esco-watch__value').first().innerText();
const forcedRows = (page) => page.locator(".esco-watch tr.is-forced").count();

const SIM_L5X = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0" TargetName="E2E_Sim" ContentType="Controller">
  <Controller Use="Target" Name="E2E_Sim">
    <Tags>
      <Tag Name="StartPB" TagType="Base" DataType="BOOL"/>
      <Tag Name="StopPB" TagType="Base" DataType="BOOL"/>
      <Tag Name="MotorRun" TagType="Base" DataType="BOOL"/>
      <Tag Name="SpeedCmd" TagType="Base" DataType="DINT"/>
      <Tag Name="BatchName" TagType="Base" DataType="STRING"/>
    </Tags>
    <Programs>
      <Program Name="MainProgram" MainRoutineName="MainRoutine">
        <Routines>
          <Routine Name="MainRoutine" Type="RLL">
            <RLLContent>
              <Rung Number="0" Type="N"><Text><![CDATA[XIC(StartPB)XIO(StopPB)OTE(MotorRun);]]></Text></Rung>
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
  await importL5XText(page, SIM_L5X, "sim-watch.L5X");
  await openMainRoutine(page);
  await dismissToasts(page);
  await openWatchPanel(page);
  check("MotorRun starts false", /\bfalse\b/.test(await motorVal(page)));

  const speedInput = page.locator('.esco-watch tr:has-text("SpeedCmd") input[type="number"]').first();
  const batchInput = page.locator('.esco-watch tr:has-text("BatchName") input[type="text"]').first();
  await speedInput.fill("42");
  await batchInput.fill("LineA");
  check("number watch edit updates SpeedCmd", (await speedInput.inputValue()) === "42");
  check("string watch edit updates BatchName", (await batchInput.inputValue()) === "LineA");
  await page.locator('button:has-text("Reset Values")').click();
  await page.waitForTimeout(60);
  check("Reset Values restores edited number and string inputs", (await speedInput.inputValue()) === "0" && (await batchInput.inputValue()) === "");

  // Force MotorRun to its current value (false), then drive StartPB on.
  await page.locator('.esco-watch tr:has-text("MotorRun") button:has-text("Force")').click();
  await page.waitForFunction(() => document.querySelectorAll(".esco-watch tr.is-forced").length >= 1);
  check("forcing a tag marks its row", (await forcedRows(page)) >= 1);

  await page.locator('.esco-watch tr:has-text("StartPB") button:has-text("Toggle")').click();
  await page.locator('button:has-text("Scan Once")').click();
  await page.waitForTimeout(60);
  check("force wins: MotorRun stays false despite Start", /\bfalse\b/.test(await motorVal(page)));

  await openDockPanel(page, "Forces");
  await page.locator(".esco-forces tr.is-forced").first().waitFor({ timeout: 5000 });
  const forcesText = await page.locator(".esco-forces").innerText();
  check("Forces dock lists the pinned MotorRun value", /MotorRun/.test(forcesText) && /false/.test(forcesText));

  // Clear forces; now logic energizes MotorRun.
  await openWatchPanel(page);
  await page.locator('button:has-text("Clear Forces")').click();
  await page.waitForFunction(() => document.querySelectorAll(".esco-watch tr.is-forced").length === 0);
  check("clear forces removes the force", (await forcedRows(page)) === 0);

  await page.locator('button:has-text("Scan Once")').click();
  await page.waitForTimeout(60);
  check("after clearing force, logic energizes MotorRun", /\btrue\b/.test(await motorVal(page)));

  await page.locator('.esco-lad__operand[title="StartPB"]').first().click({ button: "right" });
  await page.locator('.esco-context-menu__item:has-text("Force Value")').click();
  await page.locator('.esco-dock__tab.is-active:has-text("Forces")').waitFor({ timeout: 5000 });
  const selectedForceText = await page.locator(".esco-forces").innerText();
  check(
    "Force Value routes selected tag and pins the current value",
    /Selected tag:\s*StartPB/.test(selectedForceText) &&
      (await page.locator('.esco-forces tr.is-forced:has-text("StartPB")').count()) === 1,
  );

  await page.locator('.esco-lad__operand[title="StopPB"]').first().click({ button: "right" });
  await page.locator('.esco-context-menu__item:has-text("Watch Tag")').click();
  await page.locator('.esco-dock__tab.is-active:has-text("Watch")').waitFor({ timeout: 5000 });
  check(
    "Watch Tag routes and highlights the selected watch row",
    (await page.locator('.esco-watch tr.is-selected:has-text("StopPB")').count()) === 1,
  );

  await openDockPanel(page, "Trend");
  await page.locator('.esco-trend button:has-text("Capture Scan")').click();
  await page.locator(".esco-trend__samples tbody tr").first().waitFor({ timeout: 5000 });
  await page.locator('.esco-trend button:has-text("Clear Buffer")').click();
  check("Trend Clear Buffer empties the scan sample buffer", /No trend samples yet/.test(await page.locator(".esco-trend").innerText()));

  // Reset Values returns the project to its power-up state (all tags zeroed).
  await openWatchPanel(page);
  await page.locator('button:has-text("Reset Values")').click();
  await page.waitForTimeout(60);
  check("Reset Values returns MotorRun to power-up false", /\bfalse\b/.test(await motorVal(page)));

  const passed = results.filter(Boolean).length;
  console.log(`\nSUMMARY: ${passed}/${results.length} checks passed`);
  process.exitCode = passed === results.length ? 0 : 1;
} catch (err) {
  console.log("ERROR:", err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
