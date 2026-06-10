// E2E: real offline ladder editing added to the rung/instruction context menus —
// Insert Rung Above/Below, relative Paste, Insert Instruction Before/After, and
// Verify Rung. Every action is a real project-action edit (no placeholder toasts).
import { chromium } from "playwright-core";
import { URL, dismissToasts, importL5XText, openMainRoutine } from "./helpers.mjs";

const results = [];
const check = (label, cond, detail = "") => {
  results.push(!!cond);
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${detail ? "  - " + String(detail).replace(/\s+/g, " ").slice(0, 140) : ""}`);
};

const FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0" TargetName="E2E_OfflineEdits" ContentType="Controller">
  <Controller Use="Target" Name="E2E_OfflineEdits" ProcessorType="1756-L85E">
    <Tags>
      <Tag Name="StartPB" TagType="Base" DataType="BOOL"/>
      <Tag Name="StopPB" TagType="Base" DataType="BOOL"/>
      <Tag Name="MotorRun" TagType="Base" DataType="BOOL"/>
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

const RUNG_SELECTOR = ".esco-lad__rung:not(.esco-lad__rung--empty)";
const contextMenu = (page) => page.locator(".esco-context-menu");
const menuItem = (page, label) => page.locator(`.esco-context-menu__item:has-text("${label}")`).first();
const rungCount = (page) => page.locator(RUNG_SELECTOR).count();
// Ladder operands render as <input>, so count operand inputs (innerText misses them).
const operandCount = (page) => page.locator(`${RUNG_SELECTOR} .esco-lad__operand`).count();

async function closeContextMenu(page) {
  if ((await contextMenu(page).count()) === 0) return;
  await page.keyboard.press("Escape");
  await contextMenu(page).waitFor({ state: "detached", timeout: 2000 }).catch(() => {});
}

async function openRungContext(page, index = 0) {
  await closeContextMenu(page);
  await page.locator(RUNG_SELECTOR).nth(index).click({ button: "right" });
  await contextMenu(page).waitFor({ timeout: 8000 });
}

async function openInstructionContext(page, tagName) {
  await closeContextMenu(page);
  await page.locator(`.esco-lad__operand[title="${tagName}"]`).first().click({ button: "right" });
  await contextMenu(page).waitFor({ timeout: 8000 });
}

async function clickItem(page, label) {
  const item = menuItem(page, label);
  if ((await item.count()) === 0 || (await item.isDisabled())) {
    await closeContextMenu(page);
    return false;
  }
  await item.click();
  return true;
}

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
page.on("pageerror", (error) => console.log("PAGEERROR:", error.message));

try {
  await page.goto(URL, { waitUntil: "networkidle" });
  await importL5XText(page, FIXTURE, "ladder-offline-edits.L5X");
  await openMainRoutine(page);
  await dismissToasts(page);

  check("fixture opens a single ladder rung", (await rungCount(page)) === 1);

  // 1) Insert Rung Below adds a rung after the selected one.
  let before = await rungCount(page);
  await openRungContext(page, 0);
  check("Insert Rung Below clicked", await clickItem(page, "Insert Rung Below"));
  await page.waitForFunction((n) => document.querySelectorAll(".esco-lad__rung:not(.esco-lad__rung--empty)").length === n + 1, before).catch(() => {});
  check("Insert Rung Below adds a rung", (await rungCount(page)) === before + 1);

  // 2) Insert Rung Above adds a rung before the selected one.
  before = await rungCount(page);
  await openRungContext(page, 0);
  check("Insert Rung Above clicked", await clickItem(page, "Insert Rung Above"));
  await page.waitForFunction((n) => document.querySelectorAll(".esco-lad__rung:not(.esco-lad__rung--empty)").length === n + 1, before).catch(() => {});
  check("Insert Rung Above adds a rung", (await rungCount(page)) === before + 1);

  // 3) Copy the motor rung, then Paste Rung Below the first rung.
  // Operands render as <input>, so locate the rung by its operand title, not text.
  const motorRungIndex = await page.locator(RUNG_SELECTOR).evaluateAll((rungs) =>
    rungs.findIndex((rung) => !!rung.querySelector('.esco-lad__operand[title="StartPB"]')),
  );
  check("motor rung is present", motorRungIndex >= 0);
  await openRungContext(page, Math.max(0, motorRungIndex));
  check("Copy Rung clicked", await clickItem(page, "Copy Rung"));
  before = await rungCount(page);
  await openRungContext(page, 0);
  check("Paste Rung Below clicked", await clickItem(page, "Paste Rung Below"));
  await page.waitForFunction((n) => document.querySelectorAll(".esco-lad__rung:not(.esco-lad__rung--empty)").length === n + 1, before).catch(() => {});
  check("Paste Rung Below adds a rung", (await rungCount(page)) === before + 1);
  // The pasted rung (index 1, below the empty top rung) carries the copied operands.
  const pastedStart = await page.locator(RUNG_SELECTOR).nth(1).locator('.esco-lad__operand[title="StartPB"]').count();
  check("Paste Rung Below copies the rung content", pastedStart >= 1, `StartPB operands in pasted rung: ${pastedStart}`);

  // 4) Insert Instruction After an existing instruction via the picker.
  const opsBefore = await operandCount(page);
  await openInstructionContext(page, "StartPB");
  check("Insert Instruction After clicked", await clickItem(page, "Insert Instruction After"));
  await page.locator(".esco-instr-picker").waitFor({ timeout: 8000 });
  check("Insert Instruction After opens the picker", (await page.locator(".esco-instr-picker").count()) === 1);
  await page.locator(".esco-instr-picker__input").fill("Examine If Closed");
  const xicItem = page.locator(".esco-instr-picker__item", { has: page.locator('.esco-instr-picker__mnemonic:text-is("XIC")') });
  await xicItem.first().waitFor({ timeout: 8000 });
  await xicItem.first().click();
  await page.locator('.esco-instr-picker .esco-btn--primary:has-text("Insert")').click();
  await page.locator(".esco-instr-picker").waitFor({ state: "detached", timeout: 8000 });
  await page.waitForFunction((n) => document.querySelectorAll(".esco-lad__rung:not(.esco-lad__rung--empty) .esco-lad__operand").length === n + 1, opsBefore).catch(() => {});
  check("Insert Instruction After adds one instruction operand", (await operandCount(page)) === opsBefore + 1);

  // 5) Verify Rung runs real offline validation.
  await openRungContext(page, 0);
  check("Verify Rung clicked", await clickItem(page, "Verify Rung"));
  await page.locator('.esco-dock__tab.is-active:has-text("Build")').waitFor({ timeout: 8000 }).catch(() => {});
  const verifyToast = page.locator(".esco-toast").filter({ hasText: /Rung\s+\d+:/ }).last();
  await verifyToast.waitFor({ timeout: 8000 }).catch(() => {});
  const verifyText = await verifyToast.innerText().catch(() => "");
  check(
    "Verify Rung produces rung-scoped verification text",
    (await page.locator('.esco-dock__tab.is-active:has-text("Build")').count()) === 1 &&
      /Rung\s+\d+:.*\d+\s+errors?/i.test(verifyText) &&
      /(verification passed in Offline Simulation|Complete.*\d+\s+warnings?|\d+\s+warnings?)/i.test(verifyText),
    verifyText,
  );

  const passed = results.filter(Boolean).length;
  console.log(`\nSUMMARY: ${passed}/${results.length} checks passed`);
  process.exitCode = passed === results.length ? 0 : 1;
} catch (error) {
  console.log("ERROR:", error.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
