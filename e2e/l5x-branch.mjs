import { chromium } from "playwright-core";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { writeFileSync } from "node:fs";
import { importL5XPath, openWatchPanel } from "./helpers.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const URL = "http://localhost:5173/";
const fixturePath = join(here, "branch.L5X");

const FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0">
  <Controller Use="Target" Name="PlantController" ProcessorType="1756-L83E">
    <Tags>
      <Tag Name="Start" TagType="Base" DataType="BOOL"><Description><![CDATA[Master start]]></Description></Tag>
      <Tag Name="Stop" TagType="Base" DataType="BOOL"/>
      <Tag Name="Run" TagType="Base" DataType="BOOL"/>
      <Tag Name="Motor" TagType="Base" DataType="BOOL"/>
      <Tag Name="Level" TagType="Base" DataType="DINT"/>
    </Tags>
    <Programs>
      <Program Name="Conveyor" MainRoutineName="Main">
        <Routines>
          <Routine Name="Main" Type="RLL">
            <RLLContent>
              <Rung Number="0" Type="N"><Comment><![CDATA[Seal-in with run feedback]]></Comment><Text><![CDATA[[XIC(Start),XIC(Run)]XIO(Stop)OTE(Run);]]></Text></Rung>
              <Rung Number="1" Type="N"><Text><![CDATA[XIC(Start)XUNKNOWN(SubRoutine);]]></Text></Rung>
            </RLLContent>
          </Routine>
        </Routines>
      </Program>
    </Programs>
    <Tasks><Task Name="MainTask" Type="CONTINUOUS"><ScheduledPrograms><ScheduledProgram Name="Conveyor"/></ScheduledPrograms></Task></Tasks>
  </Controller>
</RSLogix5000Content>`;
writeFileSync(fixturePath, FIXTURE, "utf-8");

const results = [];
const check = (label, cond, detail = "") => {
  results.push(!!cond);
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${detail ? "  — " + detail : ""}`);
};
const runVal = (page) =>
  page.locator('.esco-watch tr:has-text("Run") .esco-watch__value').first().innerText();

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));

try {
  await page.goto(URL, { waitUntil: "networkidle" });
  await importL5XPath(page, fixturePath);
  await page.locator('.esco-titlebar__name:has-text("PlantController")').waitFor({ timeout: 8000 });

  const notice = await page.locator(".esco-toast").innerText();
  check("import summary shows counts", /1 program\(s\),\s*1 routine\(s\),\s*2 rung\(s\),\s*5 tag\(s\)/.test(notice), notice);
  check("import summary lists unknown unsupported instruction", /Unsupported:\s*XUNKNOWN/.test(notice));

  await page.locator('.esco-tree__node--routine:has-text("Main")').first().click();
  await page.waitForFunction(() => document.querySelectorAll(".esco-lad__rung").length === 2);
  check("branch routine opens with 2 rungs", true);
  check("unknown unsupported branch fixture instruction renders read-only", (await page.locator(".esco-lad__box--unsupported:has-text('XUNKNOWN')").count()) === 1);
  const branchGeometry = await page.evaluate(() => {
    const bounds = (selector) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return { x: Math.round(rect.x), right: Math.round(rect.right), width: Math.round(rect.width) };
    };
    return {
      diagram: bounds(".esco-lad__diagram"),
      leftRail: bounds(".esco-lad__rail--left"),
      rightRail: bounds(".esco-lad__rail--right"),
      branch: bounds(".esco-lad__parallel"),
    };
  });
  check(
    "seal-in branch renders directly off the left power rail",
    branchGeometry.branch && branchGeometry.leftRail && branchGeometry.branch.x - branchGeometry.leftRail.x <= 32,
    JSON.stringify(branchGeometry),
  );
  check(
    "right power rail renders on the diagram edge",
    branchGeometry.rightRail &&
      branchGeometry.diagram &&
      Math.abs(branchGeometry.rightRail.right - branchGeometry.diagram.right) <= 2,
    JSON.stringify(branchGeometry),
  );
  await page.screenshot({ path: join(here, "b1-imported.png") });

  // Seal-in branch: Start -> Run true; release Start -> Run stays true; Stop -> Run false.
  await openWatchPanel(page);
  await page.locator('.esco-watch tr:has-text("Start") button:has-text("Toggle")').click();
  await page.locator('button:has-text("Scan Once")').click();
  await page.waitForTimeout(60);
  check("branch sim: Start -> Run=true", /\btrue\b/.test(await runVal(page)));

  await page.locator('.esco-watch tr:has-text("Start") button:has-text("Toggle")').click(); // Start off
  await page.locator('button:has-text("Scan Once")').click();
  await page.waitForTimeout(60);
  check("branch sim: Run sealed in after Start released", /\btrue\b/.test(await runVal(page)));

  await page.locator('.esco-watch tr:has-text("Stop") button:has-text("Toggle")').click(); // Stop on
  await page.locator('button:has-text("Scan Once")').click();
  await page.waitForTimeout(60);
  check("branch sim: Stop breaks the seal -> Run=false", /\bfalse\b/.test(await runVal(page)));
  await page.screenshot({ path: join(here, "b2-sim.png") });

  const passed = results.filter(Boolean).length;
  console.log(`\nSUMMARY: ${passed}/${results.length} checks passed`);
  process.exitCode = passed === results.length ? 0 : 1;
} catch (err) {
  console.log("ERROR:", err.message);
  await page.screenshot({ path: join(here, "b99-error.png") }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
