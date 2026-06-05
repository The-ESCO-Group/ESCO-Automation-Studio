import { chromium } from "playwright-core";
import { URL, dismissToasts, importL5XText, openMainRoutine } from "./helpers.mjs";

const results = [];
const check = (label, cond, detail = "") => {
  results.push(!!cond);
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${detail ? "  - " + String(detail).replace(/\s+/g, " ").slice(0, 140) : ""}`);
};

const LADDER_L5X = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0" TargetName="E2E_LadderAddDelete" ContentType="Controller">
  <Controller Use="Target" Name="E2E_LadderAddDelete">
    <Tags>
      <Tag Name="A" TagType="Base" DataType="BOOL"/>
      <Tag Name="B" TagType="Base" DataType="BOOL"/>
      <Tag Name="C" TagType="Base" DataType="BOOL"/>
      <Tag Name="Out" TagType="Base" DataType="BOOL"/>
    </Tags>
    <Programs>
      <Program Name="MainProgram" MainRoutineName="MainRoutine">
        <Routines>
          <Routine Name="MainRoutine" Type="RLL">
            <RLLContent>
              <Rung Number="0" Type="N"><Text><![CDATA[XIC(A)OTE(Out);]]></Text></Rung>
              <Rung Number="1" Type="N"><Text><![CDATA[XIC(B)OTE(Out);]]></Text></Rung>
              <Rung Number="2" Type="N"><Text><![CDATA[XIC(C)OTE(Out);]]></Text></Rung>
            </RLLContent>
          </Routine>
        </Routines>
      </Program>
    </Programs>
  </Controller>
</RSLogix5000Content>`;

const RUNG_SELECTOR = ".esco-lad__rung:not(.esco-lad__rung--empty)";
const rungCount = (page) => page.locator(RUNG_SELECTOR).count();
const rung = (page, index) => page.locator(RUNG_SELECTOR).nth(index);
const localButton = (page, label) => page.locator(`.esco-editor__local-toolbar button[aria-label="${label}"]`).first();
const ribbonButton = (page, label) => page.locator(`.esco-ribbon__button[aria-label="${label}"]`).first();
const instructionCount = (page, index) => rung(page, index).locator(".esco-lad__node, .esco-lad__box").count();
const selectedInstructionCount = (page) => page.locator(".esco-lad__node.is-selected, .esco-lad__box.is-selected").count();
const rungOperands = (page, index) =>
  rung(page, index).locator("input.esco-lad__operand").evaluateAll((inputs) => inputs.map((input) => input.value).join("|"));

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
page.on("pageerror", (error) => console.log("PAGEERROR:", error.message));

try {
  await page.goto(URL, { waitUntil: "networkidle" });
  await importL5XText(page, LADDER_L5X, "ladder-add-delete.L5X");
  await openMainRoutine(page);
  await dismissToasts(page);

  check("fixture opens three populated rungs", (await rungCount(page)) === 3);

  await rung(page, 0).click();
  const beforeUndoAdd = await instructionCount(page, 0);
  await ribbonButton(page, "XIO").click();
  await page.waitForFunction(
    (count) =>
      document.querySelectorAll(
        ".esco-lad__rung.is-selected .esco-lad__node, .esco-lad__rung.is-selected .esco-lad__box",
      ).length ===
      count + 1,
    beforeUndoAdd,
  );
  check("Adding an instruction selects the new instruction", (await selectedInstructionCount(page)) === 1);
  await page.keyboard.press("Control+z");
  await page.waitForFunction(
    (count) =>
      document.querySelectorAll(
        ".esco-lad__rung.is-selected .esco-lad__node, .esco-lad__rung.is-selected .esco-lad__box",
      ).length === count,
    beforeUndoAdd,
  );
  check(
    "Undo after adding an instruction repairs selection to the rung",
    (await instructionCount(page, 0)) === beforeUndoAdd && (await selectedInstructionCount(page)) === 0,
  );

  await rung(page, 0).locator(".esco-lad__node, .esco-lad__box").first().click();
  const beforeRelativeInsert = await instructionCount(page, 0);
  await page.keyboard.press("Alt+Insert");
  await page.locator(".esco-instr-picker__input").fill("XIO");
  await page.keyboard.press("Enter");
  await page.locator(".esco-instr-picker").waitFor({ state: "detached", timeout: 8000 });
  await page.waitForFunction(
    (count) =>
      document.querySelectorAll(
        ".esco-lad__rung.is-selected .esco-lad__node, .esco-lad__rung.is-selected .esco-lad__box",
      ).length === count + 1,
    beforeRelativeInsert,
  );
  check(
    "Alt+Insert from a selected instruction inserts immediately after that instruction",
    /^A\|\|Out$/.test(await rungOperands(page, 0)),
    await rungOperands(page, 0),
  );
  await page.keyboard.press("Control+z");
  await page.waitForFunction(
    (count) =>
      document.querySelectorAll(
        ".esco-lad__rung.is-selected .esco-lad__node, .esco-lad__rung.is-selected .esco-lad__box",
      ).length === count,
    beforeRelativeInsert,
  );

  await rung(page, 0).click({ button: "right" });
  await page.locator('.esco-context-menu__item:text-is("Insert Rung Below")').click();
  await page.waitForFunction(
    () => document.querySelectorAll(".esco-lad__rung:not(.esco-lad__rung--empty)").length === 4,
  );
  check(
    "Insert Rung Below inserts directly below the clicked rung",
    (await instructionCount(page, 1)) === 0 && /B\|Out/.test(await rungOperands(page, 2)),
    await page.locator(RUNG_SELECTOR).evaluateAll((rungs) => rungs.map((item) => item.textContent?.replace(/\s+/g, " ").trim()).join(" / ")),
  );

  await rung(page, 0).click();
  const branchInstructionCount = await instructionCount(page, 0);
  await localButton(page, "Add parallel branch").click();
  await page.locator(".esco-lad__branch-target").first().waitFor({ timeout: 8000 });
  await page.locator(".esco-lad__branch-target").first().click();
  await page.locator(".esco-instr-picker__input").fill("XIO");
  await page.keyboard.press("Enter");
  await page.locator(".esco-instr-picker").waitFor({ state: "detached", timeout: 8000 });
  await page.waitForFunction(() => document.querySelectorAll(".esco-lad__node--xio").length >= 1);
  check(
    "Empty branch leg opens the picker and inserts the chosen instruction",
    (await page.locator(".esco-lad__node--xio.is-selected").count()) === 1 &&
      (await page.locator(".esco-lad__branch-remove").count()) === 0,
  );
  await rung(page, 0).click({ button: "right" });
  await page.locator('.esco-context-menu__item:text-is("Add Branch Leg")').click();
  await page.locator(".esco-lad__branch-remove").first().waitFor({ timeout: 8000 });
  check("Empty parallel branch leg exposes a remove affordance", (await page.locator(".esco-lad__branch-remove").count()) === 1);
  await page.locator(".esco-lad__branch-remove").first().click();
  await page.waitForFunction(() => document.querySelectorAll(".esco-lad__branch-remove").length === 0);
  check(
    "Removing the empty branch leg preserves existing branch instructions",
    (await instructionCount(page, 0)) === branchInstructionCount + 1 &&
      (await page.locator(".esco-lad__parallel").count()) === 1,
  );

  const beforeUnsafeKeys = await rungCount(page);
  await rung(page, 2).click();
  await localButton(page, "Add rung").focus();
  await page.keyboard.press("Delete");
  check("Delete with toolbar focus does not remove ladder logic", (await rungCount(page)) === beforeUnsafeKeys);
  await page.keyboard.press("Control+x");
  check("Ctrl+X with toolbar focus does not cut the selected rung", (await rungCount(page)) === beforeUnsafeKeys);

  await rung(page, 2).click({ button: "right" });
  await page.locator(".esco-context-menu").waitFor({ timeout: 8000 });
  await page.keyboard.press("Delete");
  check("Delete while a context menu is open does not remove ladder logic", (await rungCount(page)) === beforeUnsafeKeys);
  await page.keyboard.press("Escape");
  await page.locator(".esco-context-menu").waitFor({ state: "detached", timeout: 3000 }).catch(() => {});

  await rung(page, 0).click();
  await rung(page, 2).focus();
  await page.waitForFunction(() => {
    const selected = document.querySelector(".esco-lad__rung.is-selected");
    return Array.from(selected?.querySelectorAll("input.esco-lad__operand") ?? []).some((input) => input.value === "B");
  });
  const beforeFocusedDelete = await rungCount(page);
  await page.keyboard.press("Delete");
  await page.waitForFunction(
    (count) => document.querySelectorAll(".esco-lad__rung:not(.esco-lad__rung--empty)").length === count - 1,
    beforeFocusedDelete,
  );
  check(
    "Delete follows the focused rung instead of a stale prior selection",
    (await rungCount(page)) === beforeFocusedDelete - 1 &&
      !(await page.locator("input.esco-lad__operand").evaluateAll((inputs) => inputs.some((input) => input.value === "B"))),
  );
  await page.keyboard.press("Control+z");
  await page.waitForFunction(
    (count) => document.querySelectorAll(".esco-lad__rung:not(.esco-lad__rung--empty)").length === count,
    beforeFocusedDelete,
  );

  await localButton(page, "Find in routine").click();
  await page.locator('.esco-routine-command input[aria-label="Find text"]').fill("A");
  await page.keyboard.press("Alt+Insert");
  check("Alt+Insert over a routine command input does not open the instruction picker", (await page.locator(".esco-instr-picker").count()) === 0);
  await page.locator('.esco-routine-command button:has-text("Cancel")').click();

  await rung(page, 2).click();
  await page.keyboard.press("Delete");
  await page.waitForFunction(
    () => document.querySelectorAll(".esco-lad__rung:not(.esco-lad__rung--empty)").length === 3,
  );
  check(
    "Delete removes the selected rung and selects the next real rung",
    (await rungCount(page)) === 3 && /C\|Out/.test(await page.locator(`${RUNG_SELECTOR}.is-selected input.esco-lad__operand`).evaluateAll((inputs) => inputs.map((input) => input.value).join("|"))),
  );

  await rung(page, 2).click();
  const beforeInstructionDelete = await instructionCount(page, 2);
  await rung(page, 2).locator(".esco-lad__node, .esco-lad__box").first().click();
  await page.keyboard.press("Delete");
  await page.waitForFunction(
    () => document.querySelectorAll(".esco-lad__rung.is-selected .esco-lad__node, .esco-lad__rung.is-selected .esco-lad__box").length === 1,
  );
  check(
    "Delete removes the selected instruction and keeps selection on a real instruction",
    beforeInstructionDelete === 2 && (await instructionCount(page, 2)) === 1 && (await selectedInstructionCount(page)) === 1,
  );

  const beforeTextEntryDelete = await instructionCount(page, 2);
  await rung(page, 2).locator("input.esco-lad__operand").first().click();
  await page.keyboard.press("Delete");
  check("Delete inside an operand field does not remove logic", (await instructionCount(page, 2)) === beforeTextEntryDelete);

  const beforeBackspace = await rungCount(page);
  await rung(page, beforeBackspace - 1).click();
  await page.keyboard.press("Backspace");
  await page.waitForFunction(
    (count) => document.querySelectorAll(".esco-lad__rung:not(.esco-lad__rung--empty)").length === count - 1,
    beforeBackspace,
  );
  check("Backspace also deletes the selected rung", (await rungCount(page)) === beforeBackspace - 1);

  const beforeClearFirst = await rungCount(page);
  await rung(page, 0).click();
  await page.keyboard.press("Delete");
  await page.waitForFunction(
    (count) => document.querySelectorAll(".esco-lad__rung:not(.esco-lad__rung--empty)").length === count - 1,
    beforeClearFirst,
  );
  const beforeClearLast = await rungCount(page);
  await rung(page, 0).click();
  await page.keyboard.press("Delete");
  await page.waitForFunction(() => document.querySelectorAll(".esco-lad__rung:not(.esco-lad__rung--empty)").length === 0);
  check(
    "Deleting the final rung shows the empty-routine add target",
    beforeClearLast === 1 &&
      (await page.locator('.esco-editor__norungs[aria-label="Empty ladder routine"]').count()) === 1 &&
      (await page.locator('.esco-lad__rung--empty[aria-label="Add first rung"]').count()) === 1,
  );
  await page.keyboard.press("Control+z");
  await page.waitForFunction(() => document.querySelectorAll(".esco-lad__rung:not(.esco-lad__rung--empty)").length === 1);
  check(
    "Undo restores the final deleted rung",
    (await rungCount(page)) === 1 && (await page.locator('.esco-editor__norungs[aria-label="Empty ladder routine"]').count()) === 0,
  );
  await page.keyboard.press("Control+y");
  await page.waitForFunction(() => document.querySelectorAll(".esco-lad__rung:not(.esco-lad__rung--empty)").length === 0);
  check(
    "Redo returns to the empty-routine add target",
    (await page.locator('.esco-editor__norungs[aria-label="Empty ladder routine"]').count()) === 1 &&
      (await page.locator('.esco-lad__rung--empty[aria-label="Add first rung"]').count()) === 1,
  );
  await page.locator('.esco-lad__rung--empty[aria-label="Add first rung"]').click();
  await page.waitForFunction(() => document.querySelectorAll(".esco-lad__rung:not(.esco-lad__rung--empty)").length === 1);
  check("Add first rung recreates a selected rung", (await rungCount(page)) === 1 && (await page.locator(`${RUNG_SELECTOR}.is-selected`).count()) === 1);
  await localButton(page, "Add rung").click();
  await page.waitForFunction(() => document.querySelectorAll(".esco-lad__rung:not(.esco-lad__rung--empty)").length === 2);
  check("Add rung after Add first rung creates a second blank rung", (await rungCount(page)) === 2);
  await localButton(page, "Delete rung").click();
  await page.waitForFunction(() => document.querySelectorAll(".esco-lad__rung:not(.esco-lad__rung--empty)").length === 1);
  check("Delete rung removes the newly added blank rung without reselecting", (await rungCount(page)) === 1);

  const passed = results.filter(Boolean).length;
  console.log(`\nSUMMARY: ${passed}/${results.length} checks passed`);
  process.exitCode = passed === results.length ? 0 : 1;
} catch (error) {
  console.log("ERROR:", error.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
