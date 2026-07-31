import { chromium } from "playwright-core";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import { clickFileMenuItem, dismissToasts, importL5XPath, openWatchPanel } from "./helpers.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const URL = "http://localhost:5173/";
const fixturePath = join(here, "fixture.L5X");
const exportedPath = join(here, "exported-roundtrip.L5X");

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
              <Rung Number="3" Type="N"><Text><![CDATA[XIC(StartPB)XUNKNOWN(SubRoutine);]]></Text></Rung>
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

  // Import a real L5X fixture through the app's L5X file input.
  await importL5XPath(page, fixturePath);

  await page.locator('.esco-titlebar__name:has-text("DemoController")').waitFor({ timeout: 8000 });
  check("imported project title shows DemoController", true);

  await openWatchPanel(page);
  check("imported TIMER tag appears in Watch", (await page.locator('.esco-watch tr:has-text("Timer1")').count()) === 1);

  // Import notice flags a truly unknown vendor block, not a process/PID instruction.
  const notice = await page.locator(".esco-toast").innerText().catch(() => "");
  check("import notice warns about unknown unsupported instruction", /XUNKNOWN/.test(notice), notice.slice(0, 80));
  await dismissToasts(page);

  // Export the imported project back to review-only L5X, then re-import that generated file.
  const [l5xDownload] = await Promise.all([
    page.waitForEvent("download"),
    clickFileMenuItem(page, "Export L5X"),
  ]);
  await l5xDownload.saveAs(exportedPath);
  const generatedL5X = readFileSync(exportedPath, "utf-8");
  check("Export L5X downloads an L5X file", /\.L5X$/i.test(l5xDownload.suggestedFilename()), l5xDownload.suggestedFilename());
  check("downloaded L5X contains the controller name", /DemoController/.test(generatedL5X));

  await page.reload({ waitUntil: "networkidle" });
  await importL5XPath(page, exportedPath);
  await page.locator('.esco-titlebar__name:has-text("DemoController")').waitFor({ timeout: 8000 });
  check("generated L5X re-imports successfully", true);

  // Open the imported routine.
  await page.locator('.esco-tree__node--routine:has-text("MainRoutine")').first().click();
  await page.waitForFunction(() => document.querySelectorAll(".esco-lad__rung").length === 4);
  check("imported routine opens with 4 rungs", true);
  const operands = await page.locator("input.esco-lad__operand").evaluateAll((els) => els.map((e) => e.value));
  check("imported rungs render operands (MotorRun present)", operands.includes("MotorRun"),
    JSON.stringify(operands));
  const unsupportedBox = page.locator(".esco-lad__box--unsupported:has-text('XUNKNOWN')").first();
  check("unknown unsupported instruction renders read-only", (await unsupportedBox.count()) === 1);
  const unsupportedTitle = await unsupportedBox.getAttribute("title");
  check("unknown unsupported instruction is labelled for review", /unsupported/i.test(unsupportedTitle ?? ""), unsupportedTitle ?? "");
  const floatingTitles = await page.locator(".esco-lad__box").evaluateAll((boxes) =>
    boxes.map((box) => ({
      type: box.querySelector(".esco-lad__box-name")?.textContent?.trim() ?? "",
      title: box.querySelector(".esco-lad__box-title")?.textContent?.trim() ?? "",
    })),
  );
  check(
    "generic ladder boxes do not float source operands as titles",
    floatingTitles.some((box) => box.type === "TON" && box.title === "Timer1") &&
      floatingTitles.some((box) => box.type === "MOV" && box.title === "") &&
      floatingTitles.some((box) => box.type === "XUNKNOWN" && box.title === ""),
    JSON.stringify(floatingTitles),
  );
  const unsupportedChrome = await unsupportedBox.evaluate((box) => {
    const boxStyles = getComputedStyle(box);
    const name = box.querySelector(".esco-lad__box-name");
    const operand = box.querySelector(".esco-lad__operand");
    return {
      borderStyle: boxStyles.borderStyle,
      borderColor: boxStyles.borderColor,
      backgroundColor: boxStyles.backgroundColor,
      nameColor: name ? getComputedStyle(name).color : "",
      operandColor: operand ? getComputedStyle(operand).color : "",
    };
  });
  check(
    "unknown unsupported instruction preserves plain Studio ladder box chrome",
    unsupportedChrome.borderStyle === "solid" &&
      unsupportedChrome.borderColor === "rgb(17, 17, 17)" &&
      unsupportedChrome.backgroundColor === "rgb(255, 255, 255)" &&
      unsupportedChrome.nameColor === "rgb(17, 17, 17)" &&
      unsupportedChrome.operandColor === "rgb(17, 17, 17)",
    JSON.stringify(unsupportedChrome),
  );
  await page.screenshot({ path: join(here, "l1-imported.png") });

  // Simulate: StartPB on, then scan (4× to let TON reach 1000ms).
  await openWatchPanel(page);
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
