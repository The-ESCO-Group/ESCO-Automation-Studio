import { chromium } from "playwright-core";
import { URL, importL5XText, openWatchPanel } from "./helpers.mjs";

const results = [];
const check = (l, c, d = "") => { results.push(!!c); console.log(`${c ? "PASS" : "FAIL"}  ${l}${d ? "  - " + d : ""}`); };
const watchRow = (page, tag) =>
  page.locator(".esco-watch tbody tr").filter({ has: page.locator(`td:first-child:text-is("${tag}")`) }).first();
const watchText = (page, tag) => watchRow(page, tag).innerText();
const toggle = (page, tag) => watchRow(page, tag).locator('button:has-text("Toggle")').click();
const scanOnce = (page) => page.locator('button:has-text("Scan Once")').click();

const NESTED_BRANCH_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0" TargetName="NestedBranchCtrl" ContentType="Controller">
  <Controller Use="Target" Name="NestedBranchCtrl">
    <Tags>
      <Tag Name="A" TagType="Base" DataType="BOOL"/>
      <Tag Name="B" TagType="Base" DataType="BOOL"/>
      <Tag Name="C" TagType="Base" DataType="BOOL"/>
      <Tag Name="D" TagType="Base" DataType="BOOL"/>
      <Tag Name="E" TagType="Base" DataType="BOOL"/>
    </Tags>
    <Programs>
      <Program Name="MainProgram" MainRoutineName="MainRoutine">
        <Routines>
          <Routine Name="MainRoutine" Type="RLL">
            <RLLContent>
              <Rung Number="0" Type="N">
                <Comment><![CDATA[Nested branch: D OR A AND (B OR C) drives E]]></Comment>
                <Text><![CDATA[[XIC(A)[XIC(B),XIC(C)],XIC(D)]OTE(E);]]></Text>
              </Rung>
            </RLLContent>
          </Routine>
        </Routines>
      </Program>
    </Programs>
    <Tasks>
      <Task Name="MainTask" Type="CONTINUOUS">
        <ScheduledPrograms><ScheduledProgram Name="MainProgram"/></ScheduledPrograms>
      </Task>
    </Tasks>
  </Controller>
</RSLogix5000Content>`;

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));

try {
  await page.goto(URL, { waitUntil: "networkidle" });
  await importL5XText(page, NESTED_BRANCH_FIXTURE, "nested-branch.L5X");
  await page.locator('.esco-titlebar__name:has-text("NestedBranchCtrl")').waitFor({ timeout: 8000 });
  await page.locator('.esco-tree__node--routine:has-text("MainRoutine")').first().click();
  await page.waitForFunction(() => document.querySelectorAll(".esco-lad__rung").length === 1);

  const structure = await page.evaluate(() => {
    const operandValues = [...document.querySelectorAll(".esco-lad__operand")]
      .map((node) => node instanceof HTMLInputElement ? node.value : node.textContent?.trim() ?? "")
      .filter(Boolean);
    const outer = document.querySelector(".esco-lad__parallel");
    const nested = outer?.querySelector(".esco-lad__parallel") ?? null;
    const bounds = (element) => {
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) };
    };
    return {
      parallelCount: document.querySelectorAll(".esco-lad__parallel").length,
      nestedParallelCount: document.querySelectorAll(".esco-lad__parallel .esco-lad__parallel").length,
      operandValues,
      outer: bounds(outer),
      nested: bounds(nested),
      branchRows: document.querySelectorAll(".esco-lad__parallel .esco-lad__row").length,
    };
  });
  check("nested branch imports as a single ladder rung", (await page.locator(".esco-lad__rung").count()) === 1);
  check("nested branch keeps two visual parallel groups", structure.parallelCount === 2 && structure.nestedParallelCount === 1, JSON.stringify(structure));
  check("nested branch operands render without flattening loss", ["A", "B", "C", "D", "E"].every((tag) => structure.operandValues.includes(tag)), structure.operandValues.join(","));
  check("nested branch geometry is visibly nested under the outer branch", !!structure.outer && !!structure.nested && structure.nested.x > structure.outer.x && structure.nested.y >= structure.outer.y, JSON.stringify(structure));

  await openWatchPanel(page);
  await page.waitForFunction(() => [...document.querySelectorAll(".esco-watch td")].some((td) => td.textContent === "E"));

  await toggle(page, "A");
  await toggle(page, "B");
  await scanOnce(page);
  check("nested branch sim: A and B drive E=true", /\btrue\b/.test(await watchText(page, "E")));

  await toggle(page, "B");
  await scanOnce(page);
  check("nested branch sim: A alone with B/C/D false drives E=false", /\bfalse\b/.test(await watchText(page, "E")));

  await toggle(page, "C");
  await scanOnce(page);
  check("nested branch sim: A and C drive E=true", /\btrue\b/.test(await watchText(page, "E")));

  await toggle(page, "A");
  await scanOnce(page);
  check("nested branch sim: C alone without A or D drives E=false", /\bfalse\b/.test(await watchText(page, "E")));

  await toggle(page, "D");
  await scanOnce(page);
  check("nested branch sim: D bypass path drives E=true", /\btrue\b/.test(await watchText(page, "E")));

  const passed = results.filter(Boolean).length;
  console.log(`\nSUMMARY: ${passed}/${results.length} checks passed`);
  process.exitCode = passed === results.length ? 0 : 1;
} catch (err) {
  console.log("ERROR:", err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
