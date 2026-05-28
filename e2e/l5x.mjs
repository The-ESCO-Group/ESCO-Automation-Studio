import { chromium } from "playwright-core";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { writeFileSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));
const URL = "http://localhost:5173/";
const fixturePath = join(here, "fixture.L5X");

const FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0" TargetName="DemoController" ContentType="Controller">
  <Controller Use="Target" Name="DemoController" ProcessorType="Emulator">
    <Tags>
      <Tag Name="StartPB" TagType="Base" DataType="BOOL"/>
      <Tag Name="StopPB" TagType="Base" DataType="BOOL"/>
      <Tag Name="MotorRun" TagType="Base" DataType="BOOL"/>
      <Tag Name="SomeDint" TagType="Base" DataType="DINT"/>
      <Tag Name="Timer1" TagType="Base" DataType="TIMER"/>
    </Tags>
    <Programs>
      <Program Name="MainProgram" MainRoutineName="MainRoutine">
        <Routines>
          <Routine Name="MainRoutine" Type="RLL">
            <RLLContent>
              <Rung Number="0" Type="N"><Comment><![CDATA[Start / stop motor]]></Comment><Text><![CDATA[XIC(StartPB)XIO(StopPB)OTE(MotorRun);]]></Text></Rung>
              <Rung Number="1" Type="N"><Text><![CDATA[XIC(StartPB)MOV(123,SomeDint);]]></Text></Rung>
              <Rung Number="2" Type="N"><Text><![CDATA[XIC(StartPB)TON(Timer1,1000);]]></Text></Rung>
              <Rung Number="3" Type="N"><Text><![CDATA[XIC(StartPB)JSR(SubRoutine);]]></Text></Rung>
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
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${detail ? "  — " + detail : ""}`);
};
const watchText = (page, tag) =>
  page.locator(`.esco-watch tr:has-text("${tag}")`).first().innerText();

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));

try {
  await page.goto(URL, { waitUntil: "networkidle" });

  // Import the L5X via the Import L5X button + native file chooser.
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.locator('.esco-titlebar__actions button:has-text("Import L5X")').click(),
  ]);
  await chooser.setFiles(fixturePath);

  await page.locator('.esco-titlebar__project:has-text("DemoController")').waitFor({ timeout: 8000 });
  check("imported project title shows DemoController", true);

  // Imported tags appear in the Project Explorer.
  const tagText = await page.locator(".esco-left").innerText();
  check("imported tags appear in explorer (Timer1 : TIMER)", /Timer1\s*:\s*TIMER/.test(tagText));

  // Import notice flags the unsupported ADD instruction.
  const notice = await page.locator(".esco-toast").innerText().catch(() => "");
  check("import notice warns about unsupported JSR", /JSR/.test(notice), notice.slice(0, 80));

  // Open the imported routine.
  await page.locator('button:has-text("MainRoutine")').first().click();
  await page.waitForFunction(() => document.querySelectorAll(".esco-lad__rung").length === 4);
  check("imported routine opens with 4 rungs", true);
  const operands = await page.locator("input.esco-lad__operand").evaluateAll((els) => els.map((e) => e.value));
  check("imported rungs render operands (MotorRun present)", operands.includes("MotorRun"),
    JSON.stringify(operands));
  await page.screenshot({ path: join(here, "l1-imported.png") });

  // Simulate: StartPB on, then scan (4× to let TON reach 1000ms).
  await page.locator('.esco-watch tr:has-text("StartPB") button:has-text("Toggle")').click();
  for (let i = 0; i < 4; i++) {
    await page.locator('button:has-text("Scan Once")').click();
    await page.waitForTimeout(50);
  }

  const motor = await watchText(page, "MotorRun");
  check("imported XIC/XIO/OTE simulates: MotorRun=true", /\btrue\b/.test(motor), motor.replace(/\s+/g, " "));
  const dint = await watchText(page, "SomeDint");
  check("imported MOV simulates: SomeDint=123", /\b123\b/.test(dint), dint.replace(/\s+/g, " "));
  const timer = await watchText(page, "Timer1");
  check("imported TON simulates: Timer1 DN=true", /DN=true/.test(timer), timer.replace(/\s+/g, " "));
  await page.screenshot({ path: join(here, "l2-scanned.png") });

  const passed = results.filter(Boolean).length;
  console.log(`\nSUMMARY: ${passed}/${results.length} checks passed`);
  process.exitCode = passed === results.length ? 0 : 1;
} catch (err) {
  console.log("ERROR:", err.message);
  await page.screenshot({ path: join(here, "l99-error.png") }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}



