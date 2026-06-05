import { chromium } from "playwright-core";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { writeFileSync } from "node:fs";
import { URL, dismissToasts, importL5XPath } from "./helpers.mjs";

// Proves the Verify Controller workflow produces a controller-verification Output log
// in the Build dock (not just a toast): "Verifying controller…" lines, a finding
// line for the seeded error, and a "Complete - N error(s), M warning(s)" summary.

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(here, "verifyoutput-fixture.L5X");

// MainRoutine is clean; BadST has an unterminated IF so the verify reports one
// structured-text error scoped to that routine.
const FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0" TargetName="VerifyCtrl" ContentType="Controller">
  <Controller Use="Target" Name="VerifyCtrl">
    <Tags>
      <Tag Name="Start" TagType="Base" DataType="BOOL"/>
      <Tag Name="Done" TagType="Base" DataType="BOOL"/>
    </Tags>
    <Programs>
      <Program Name="MainProgram" MainRoutineName="MainRoutine">
        <Routines>
          <Routine Name="MainRoutine" Type="RLL">
            <RLLContent>
              <Rung Number="0" Type="N"><Text><![CDATA[XIC(Start)OTE(Done);]]></Text></Rung>
            </RLLContent>
          </Routine>
          <Routine Name="BadST" Type="ST">
            <STContent>
              <Line Number="0"><![CDATA[IF Start THEN]]></Line>
              <Line Number="1"><![CDATA[  Done := TRUE;]]></Line>
            </STContent>
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
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${detail ? "  - " + String(detail).replace(/\s+/g, " ").slice(0, 110) : ""}`);
};

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));

try {
  await page.goto(URL, { waitUntil: "networkidle" });
  await importL5XPath(page, fixturePath);
  await dismissToasts(page);

  // Verify Controller from the Logic ribbon menu.
  await page.locator('.esco-ribbon__tab:has-text("Logic")').click();
  await page.locator('.esco-ribbon-menu__item:has-text("Verify Controller")').click();

  // Verify focuses the Build dock and renders the Output log.
  await page.locator(".esco-build__output").waitFor({ timeout: 6000 });
  const activeTab = await page.locator(".esco-dock__tab.is-active").innerText();
  check("Verify Controller focuses the Build dock", /build/i.test(activeTab), activeTab);

  const logText = await page.locator(".esco-build__output").innerText();
  check("Output log announces the controller being verified", /Verifying controller 'VerifyCtrl'/.test(logText), logText);
  check("Output log lists the seeded structured-text error", /Error:.*BadST/.test(logText), logText);
  check("Output log ends with a Studio-style Complete summary", /Complete - \d+ error/.test(logText), logText);
  check("Output log reports at least one error", /Complete - [1-9]\d* error/.test(logText), logText);

  // The ordered step table is rendered alongside the log.
  const buildText = await page.locator(".esco-build").innerText();
  check("Build dock renders the per-component step grid and log together", /Offline build output/.test(buildText) && /VerifyCtrl/.test(buildText), buildText);

  // Clear Output blanks the log; re-verifying rebuilds it.
  await page.locator('.esco-build__bar .esco-btn:has-text("Clear Output")').click();
  const clearedLog = await page.locator(".esco-build__output").innerText();
  check("Clear Output blanks the verify log", /Output cleared/.test(clearedLog), clearedLog);

  await page.locator('.esco-build__bar .esco-btn:has-text("Verify Controller")').click();
  const rebuiltLog = await page.locator(".esco-build__output").innerText();
  check("Re-running Verify rebuilds the Output log", /Complete - /.test(rebuiltLog), rebuiltLog);

  const passed = results.filter(Boolean).length;
  console.log(`\nSUMMARY: ${passed}/${results.length} checks passed`);
  process.exitCode = passed === results.length ? 0 : 1;
} catch (err) {
  console.log("ERROR:", err.message);
  await page.screenshot({ path: join(here, "verifyoutput-error.png") }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
