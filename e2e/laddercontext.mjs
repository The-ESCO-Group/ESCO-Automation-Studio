import { chromium } from "playwright-core";
import { URL, dismissToasts, importL5XText, openMainRoutine } from "./helpers.mjs";

const results = [];
const check = (label, cond, detail = "") => {
  results.push(!!cond);
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${detail ? "  - " + String(detail).replace(/\s+/g, " ").slice(0, 140) : ""}`);
};
const note = (label, detail = "") => console.log(`INFO  ${label}${detail ? "  - " + detail : ""}`);

const CONTEXT_L5X = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0" TargetName="E2E_LadderContext" ContentType="Controller">
  <Controller Use="Target" Name="E2E_LadderContext" ProcessorType="1756-L85E">
    <Tags>
      <Tag Name="StartPB" TagType="Base" DataType="BOOL"/>
      <Tag Name="StopPB" TagType="Base" DataType="BOOL"/>
      <Tag Name="MotorRun" TagType="Base" DataType="BOOL"/>
      <Tag Name="SourceA" TagType="Base" DataType="DINT"/>
      <Tag Name="DestB" TagType="Base" DataType="DINT"/>
      <Tag Name="DestC" TagType="Base" DataType="DINT"/>
    </Tags>
    <Programs>
      <Program Name="MainProgram" TestEdits="true" MainRoutineName="MainRoutine">
        <Routines>
          <Routine Name="MainRoutine" Type="RLL">
            <RLLContent>
              <Rung Number="0" Type="N"><Text><![CDATA[XIC(StartPB)XIO(StopPB)OTE(MotorRun);]]></Text></Rung>
              <Rung Number="1" Type="N"><Text><![CDATA[MOV(SourceA,DestB);]]></Text></Rung>
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

async function closeContextMenu(page) {
  if ((await contextMenu(page).count()) === 0) return;
  await page.keyboard.press("Escape");
  await contextMenu(page).waitFor({ state: "detached", timeout: 2000 }).catch(() => {});
}

async function openRungContext(page) {
  await closeContextMenu(page);
  await page.locator(RUNG_SELECTOR).first().click({ button: "right" });
  await contextMenu(page).waitFor({ timeout: 8000 });
}

async function openRungContextContaining(page, tagName) {
  await closeContextMenu(page);
  await page.locator(`${RUNG_SELECTOR}:has(.esco-lad__operand[title="${tagName}"])`).first().click({ button: "right" });
  await contextMenu(page).waitFor({ timeout: 8000 });
}

async function openInstructionContext(page, tagName = "StartPB") {
  await closeContextMenu(page);
  await page.locator(`.esco-lad__operand[title="${tagName}"]`).first().click({ button: "right" });
  await contextMenu(page).waitFor({ timeout: 8000 });
}

async function menuLabels(page) {
  return contextMenu(page).locator(".esco-context-menu__item").evaluateAll((items) =>
    items.map((item) => item.textContent?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean),
  );
}

async function activeElementText(page) {
  return page.evaluate(() => document.activeElement?.textContent?.replace(/\s+/g, " ").trim() ?? "");
}

async function movOperands(page) {
  return page
    .locator(".esco-lad__box:has-text('MOV') input.esco-lad__operand")
    .evaluateAll((inputs) => inputs.map((input) => input.value).join("|"));
}

function hasLabel(labels, expected) {
  return labels.some((label) => label.includes(expected));
}

function checkMenuIncludes(menuName, labels, expectedLabels) {
  for (const label of expectedLabels) {
    check(`${menuName} includes ${label}`, hasLabel(labels, label), labels.join(" | "));
  }
}

async function clickMenuItemIfPresent(page, label, checkLabel = `${label} context command can be clicked`) {
  const item = menuItem(page, label);
  const exists = (await item.count()) > 0;
  check(checkLabel, exists);
  if (!exists) {
    await closeContextMenu(page);
    return false;
  }
  const enabled = !(await item.isDisabled());
  check(`${label} context command is enabled`, enabled);
  if (!enabled) {
    await closeContextMenu(page);
    return false;
  }
  await item.click();
  return true;
}

async function closeInstructionPicker(page) {
  if ((await page.locator(".esco-instr-picker").count()) === 0) return;
  await page.locator('.esco-instr-picker button[aria-label="Close Add Ladder Element"], .esco-instr-picker .esco-icon-btn').first().click().catch(() => {});
  await page.locator(".esco-instr-picker").waitFor({ state: "detached", timeout: 3000 }).catch(() => {});
}

async function watchValueText(page, tagName) {
  const row = page.locator(`.esco-watch tr:has-text("${tagName}")`).first();
  await row.waitFor({ timeout: 8000 });
  const value = row.locator(".esco-watch__value").first();
  if ((await value.count()) > 0) return value.innerText();
  return row.innerText();
}

async function boolWatchValue(page, tagName) {
  const text = await watchValueText(page, tagName);
  if (/\btrue\b/i.test(text)) return "true";
  if (/\bfalse\b/i.test(text)) return "false";
  return "";
}

async function helpSurfaceOpen(page) {
  return page.evaluate(() => {
    if (document.querySelector(".esco-dialog-help__panel")) return true;
    if ([...document.querySelectorAll(".esco-modal__panel")].some((panel) => /help/i.test(panel.textContent ?? ""))) return true;
    const rightPanel = document.querySelector(".esco-right-copilot, .esco-inspector");
    return /help/i.test(rightPanel?.textContent ?? "");
  });
}

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
page.on("pageerror", (error) => console.log("PAGEERROR:", error.message));

try {
  await page.goto(URL, { waitUntil: "networkidle" });
  await importL5XText(page, CONTEXT_L5X, "ladder-context.L5X");
  await openMainRoutine(page);
  await dismissToasts(page);

  check("fixture opens a ladder routine", (await rungCount(page)) >= 1);
  check("fixture surfaces pending online edit state", (await page.locator(".esco-editor__onlineedit-bar").count()) === 1);

  await page.locator(RUNG_SELECTOR).first().focus();
  await page.keyboard.press("Shift+F10");
  await page.getByRole("menu").waitFor({ timeout: 8000 });
  await page.getByRole("menuitem", { name: /Insert Rung Above/ }).waitFor({ timeout: 8000 });
  check("keyboard opens rung context menu with menuitem roles", (await page.getByRole("menuitem").count()) >= 8);
  check("keyboard-opened context menu focuses the first enabled item", /Insert Rung Above/.test(await activeElementText(page)));
  await page.keyboard.press("End");
  check("End moves context menu focus to the final item", /Delete Rung/.test(await activeElementText(page)));
  await page.keyboard.press("Home");
  check("Home moves context menu focus back to the first item", /Insert Rung Above/.test(await activeElementText(page)));
  await page.keyboard.press("ArrowDown");
  check("ArrowDown moves context menu focus forward", /Insert Rung Below/.test(await activeElementText(page)));
  await page.keyboard.press("Escape");
  await contextMenu(page).waitFor({ state: "detached", timeout: 3000 }).catch(() => {});
  check(
    "Escape closes keyboard-opened context menu and restores rung focus",
    (await contextMenu(page).count()) === 0 &&
      /Rung 0/.test(await page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? "")),
  );

  await openRungContext(page);
  const rungLabels = await menuLabels(page);
  checkMenuIncludes("rung context menu", rungLabels, [
    "Insert Rung Above",
    "Insert Rung Below",
    "Add Ladder Element",
    "Copy Rung",
    "Cut Rung",
    "Paste Rung",
    "Paste Rung Above",
    "Paste Rung Below",
    "Add Parallel Branch",
    "Add Branch Leg",
    "Verify Rung",
    "Cross Reference Rung",
    "Delete Rung",
    "Test Edits",
    "Assemble Edits",
    "Finalize All Edits",
    "Cancel Edits",
  ]);
  check("Paste Rung is disabled before copying", hasLabel(rungLabels, "Paste Rung") && (await menuItem(page, "Paste Rung").isDisabled()));
  await closeContextMenu(page);

  await openRungContext(page);
  if (await clickMenuItemIfPresent(page, "Assemble Edits", "Assemble Edits is available from the rung context menu")) {
    await page.locator('.esco-editor__onlineedit-bar[data-edit-state="assembled"]').waitFor({ timeout: 8000 }).catch(() => {});
    const assembledBar = await page.locator(".esco-editor__onlineedit-bar").innerText().catch(() => "");
    const statusText = await page.locator(".esco-statusbar").innerText().catch(() => "");
    check(
      "Assemble Edits records an offline assembled lifecycle state",
      /Offline Edits Assembled/i.test(assembledBar) && /Edits:\s*Assembled/i.test(statusText),
      `${assembledBar} / ${statusText}`,
    );
  }

  await openRungContext(page);
  if (await clickMenuItemIfPresent(page, "Cancel Edits", "Cancel Edits is available from the rung context menu")) {
    await page.locator(".esco-editor__onlineedit-bar").waitFor({ state: "detached", timeout: 8000 }).catch(() => {});
    const statusText = await page.locator(".esco-statusbar").innerText().catch(() => "");
    check(
      "Cancel Edits records offline canceled state and clears the pending edit bar",
      (await page.locator(".esco-editor__onlineedit-bar").count()) === 0 && /Edits:\s*Canceled/i.test(statusText),
      statusText,
    );
  }

  await openRungContext(page);
  if (await clickMenuItemIfPresent(page, "Test Edits", "Test Edits is available from the rung context menu")) {
    await page.locator('.esco-editor__onlineedit-bar[data-edit-state="test"]').waitFor({ timeout: 8000 }).catch(() => {});
    const testBar = await page.locator(".esco-editor__onlineedit-bar").innerText().catch(() => "");
    const statusText = await page.locator(".esco-statusbar").innerText().catch(() => "");
    check(
      "Test Edits restores the pending test lifecycle state",
      /Pending Test Edits/i.test(testBar) && /Edits:\s*Pending Test/i.test(statusText),
      `${testBar} / ${statusText}`,
    );
  }

  await openRungContext(page);
  if (await clickMenuItemIfPresent(page, "Finalize All Edits", "Finalize All Edits is available from the rung context menu")) {
    await page.locator(".esco-editor__onlineedit-bar").waitFor({ state: "detached", timeout: 8000 }).catch(() => {});
    const statusText = await page.locator(".esco-statusbar").innerText().catch(() => "");
    check(
      "Finalize All Edits records offline finalized state and clears the pending edit bar",
      (await page.locator(".esco-editor__onlineedit-bar").count()) === 0 && /Edits:\s*Finalized/i.test(statusText),
      statusText,
    );
  }

  await openRungContext(page);
  if (await clickMenuItemIfPresent(page, "Add Ladder Element", "Add Ladder Element opens from the rung context menu")) {
    await page.locator(".esco-instr-picker").waitFor({ timeout: 8000 }).catch(() => {});
    check("Add Ladder Element opens the instruction picker", (await page.locator(".esco-instr-picker").count()) === 1);
    const pickerText = await page.locator(".esco-instr-picker").innerText().catch(() => "");
    check("Instruction picker shows fidelity badges", /Executable simulation/i.test(pickerText), pickerText);
    await page.locator('.esco-instr-picker input[aria-label="Search instructions"]').fill("MSG model-only");
    const modelOnlyText = await page.locator(".esco-instr-picker").innerText().catch(() => "");
    check(
      "Instruction picker search includes fidelity and boundary text",
      /MSG/i.test(modelOnlyText) && /Model-only/i.test(modelOnlyText) && /no controller/i.test(modelOnlyText),
      modelOnlyText,
    );
    await closeInstructionPicker(page);
  }

  const beforePaste = await rungCount(page);
  await openRungContext(page);
  if (await clickMenuItemIfPresent(page, "Copy Rung", "Copy Rung is available from the rung context menu")) {
    await openRungContext(page);
    const pasteEnabled = (await menuItem(page, "Paste Rung").count()) > 0 && !(await menuItem(page, "Paste Rung").isDisabled());
    check("Copy Rung enables Paste Rung", pasteEnabled);
    if (pasteEnabled) {
      await menuItem(page, "Paste Rung").click();
      await page.waitForFunction(
        (count) => document.querySelectorAll(".esco-lad__rung:not(.esco-lad__rung--empty)").length === count + 1,
        beforePaste,
      ).catch(() => {});
      check("Paste Rung adds another rung", (await rungCount(page)) === beforePaste + 1);
    } else {
      await closeContextMenu(page);
      check("Paste Rung adds another rung", false, "Paste Rung was not enabled after Copy Rung");
    }
  } else {
    check("Copy Rung enables Paste Rung", false, "Copy Rung was unavailable");
    check("Paste Rung adds another rung", false, "Copy Rung was unavailable");
  }

  await openInstructionContext(page, "StartPB");
  const instructionLabels = await menuLabels(page);
  checkMenuIncludes("instruction context menu", instructionLabels, [
    "Edit Operand",
    "Insert Instruction Before",
    "Insert Instruction After",
    "Edit Tag Properties",
    "Toggle Bit",
    "Watch Tag",
    "Cross Reference",
    "Trend",
    "Force Value",
    "Unforce",
    "Instruction Help",
    "Delete Instruction",
  ]);
  await closeContextMenu(page);

  check("fixture includes MOV operands before operand-index edit", (await movOperands(page)) === "SourceA|DestB", await movOperands(page));
  await openInstructionContext(page, "DestB");
  if (await clickMenuItemIfPresent(page, "Edit Operand", "Edit Operand targets the right-clicked MOV destination")) {
    const commandInput = page.locator('.esco-routine-command input[aria-label="Operand value"]');
    await commandInput.waitFor({ timeout: 8000 });
    check("Edit Operand command is seeded from operand index 1", (await commandInput.inputValue()) === "DestB");
    await commandInput.fill("DestC");
    await page.locator('.esco-routine-command button:has-text("Apply")').click();
    await page.waitForFunction(() => {
      const operands = [...document.querySelectorAll(".esco-lad__box input.esco-lad__operand")].map((input) => input.value);
      return operands.includes("SourceA") && operands.includes("DestC") && !operands.includes("DestB");
    }, null, { timeout: 8000 }).catch(() => {});
    check("Edit Operand updates operand index 1 without changing operand 0", (await movOperands(page)) === "SourceA|DestC", await movOperands(page));
    check("Edit Operand closes the inline command after Apply", (await page.locator(".esco-routine-command").count()) === 0);
  }

  // Insert Rung Above adds a rung above the selected one (real structural edit).
  const beforeInsert = await rungCount(page);
  await openRungContext(page);
  if (await clickMenuItemIfPresent(page, "Insert Rung Above", "Insert Rung Above is available from the rung context menu")) {
    await page.waitForFunction(
      (count) => document.querySelectorAll(".esco-lad__rung:not(.esco-lad__rung--empty)").length === count + 1,
      beforeInsert,
    ).catch(() => {});
    check("Insert Rung Above adds a rung", (await rungCount(page)) === beforeInsert + 1);
  }

  // Verify Rung runs real offline validation scoped to the rung.
  await openRungContextContaining(page, "StartPB");
  if (await clickMenuItemIfPresent(page, "Verify Rung", "Verify Rung is available from the rung context menu")) {
    await page.locator('.esco-dock__tab.is-active:has-text("Build")').waitFor({ timeout: 8000 }).catch(() => {});
    const verifyToast = page.locator(".esco-toast").filter({ hasText: /Rung\s+\d+:/ }).last();
    await verifyToast.waitFor({ timeout: 8000 }).catch(() => {});
    const verifyText = await verifyToast.innerText().catch(() => "");
    check(
      "Verify Rung reports rung-scoped validation text",
      (await page.locator('.esco-dock__tab.is-active:has-text("Build")').count()) === 1 &&
        /Rung\s+\d+:.*\d+\s+errors?/i.test(verifyText) &&
        /(verification passed in Offline Simulation|Complete.*\d+\s+warnings?|\d+\s+warnings?)/i.test(verifyText),
      verifyText,
    );
    await dismissToasts(page);
  }

  // Cross Reference Rung opens real cross-reference results in the dock.
  await openRungContextContaining(page, "StartPB");
  if (await clickMenuItemIfPresent(page, "Cross Reference Rung", "Cross Reference Rung is available from the rung context menu")) {
    await page.locator('.esco-dock__tab.is-active:has-text("Cross Reference"), .esco-dock__tab.is-active:has-text("Reference")').first().waitFor({ timeout: 8000 }).catch(() => {});
    const xrefText = await page.locator(".esco-xref").innerText().catch(() => "");
    const xrefToast = await page.locator(".esco-toast").last().innerText().catch(() => "");
    check(
      "Cross Reference Rung opens StartPB references in the references dock",
      (await page.locator('.esco-dock__tab.is-active:has-text("Cross Reference")').count()) === 1 &&
        /StartPB/.test(xrefText) &&
        /MainProgram\/MainRoutine/.test(xrefText) &&
        /Location\s+Rung\s+Source\s+Reference/i.test(xrefText) &&
        /XIC/i.test(xrefText) &&
        /Cross Reference for rung\s+\d+:\s+StartPB/i.test(xrefToast),
      `${xrefText} / ${xrefToast}`,
    );
    await dismissToasts(page);
  }

  await openInstructionContext(page, "StartPB");
  if (await clickMenuItemIfPresent(page, "Edit Operand", "Edit Operand is available from the instruction context menu")) {
    await page.locator(".esco-routine-command").waitFor({ timeout: 8000 }).catch(() => {});
    check("Edit Operand opens the inline operand command", (await page.locator(".esco-routine-command").count()) === 1);
    await page.locator('.esco-routine-command button:has-text("Cancel")').click().catch(() => {});
  }

  await openInstructionContext(page, "StartPB");
  if (await clickMenuItemIfPresent(page, "Watch Tag", "Watch Tag is available from the instruction context menu")) {
    await page.locator('.esco-dock__tab.is-active:has-text("Watch")').waitFor({ timeout: 8000 }).catch(() => {});
    check("Watch Tag opens the Watch dock", (await page.locator('.esco-dock__tab.is-active:has-text("Watch")').count()) === 1);
    check("Watch Tag selects the StartPB watch row", (await page.locator('.esco-watch tr.is-selected:has-text("StartPB")').count()) === 1);
  }

  const beforeToggle = await boolWatchValue(page, "StartPB").catch(() => "");
  await openInstructionContext(page, "StartPB");
  if (await clickMenuItemIfPresent(page, "Toggle Bit", "Toggle Bit is available from the instruction context menu")) {
    if (beforeToggle) {
      await page.waitForFunction(
        ({ tagName, previous }) => {
          const row = [...document.querySelectorAll(".esco-watch tr")].find((candidate) =>
            candidate.textContent?.includes(tagName),
          );
          const text = row?.querySelector(".esco-watch__value")?.textContent ?? row?.textContent ?? "";
          const next = /\btrue\b/i.test(text) ? "true" : /\bfalse\b/i.test(text) ? "false" : "";
          return next !== "" && next !== previous;
        },
        { tagName: "StartPB", previous: beforeToggle },
        { timeout: 5000 },
      ).catch(() => {});
      const afterToggle = await boolWatchValue(page, "StartPB").catch(() => "");
      check("Toggle Bit changes the BOOL watch value", afterToggle !== "" && afterToggle !== beforeToggle, `${beforeToggle} -> ${afterToggle || "unknown"}`);
    } else {
      check("Toggle Bit changes the BOOL watch value", false, "StartPB watch value was not readable");
    }
  } else {
    note("Toggle Bit value-change check skipped", "command is not available yet");
  }

  await openInstructionContext(page, "StartPB");
  if (await clickMenuItemIfPresent(page, "Trend", "Trend is available from the instruction context menu")) {
    await page.locator('.esco-dock__tab.is-active:has-text("Trend")').waitFor({ timeout: 8000 }).catch(() => {});
    check("Trend opens the Trend dock", (await page.locator('.esco-dock__tab.is-active:has-text("Trend")').count()) === 1);
  }

  await openInstructionContext(page, "StartPB");
  if (await clickMenuItemIfPresent(page, "Instruction Help", "Instruction Help is available from the instruction context menu")) {
    await page.waitForFunction(() => {
      if (document.querySelector(".esco-dialog-help__panel")) return true;
      if ([...document.querySelectorAll(".esco-modal__panel")].some((panel) => /help/i.test(panel.textContent ?? ""))) return true;
      const rightPanel = document.querySelector(".esco-right-copilot, .esco-inspector");
      return /help/i.test(rightPanel?.textContent ?? "");
    }, null, { timeout: 8000 }).catch(() => {});
    check("Instruction Help opens an in-app help surface", await helpSurfaceOpen(page));
  }

  const passed = results.filter(Boolean).length;
  console.log(`\nSUMMARY: ${passed}/${results.length} checks passed`);
  process.exitCode = passed === results.length ? 0 : 1;
} catch (error) {
  console.log("ERROR:", error.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
