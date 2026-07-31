export const URL = process.env.E2E_URL || "http://localhost:5173/";

export const STARTER_L5X = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0" TargetName="E2E_Starter" ContentType="Controller">
  <Controller Use="Target" Name="E2E_Starter">
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

export const ribbonButton = (page, label) =>
  page.locator(`.esco-ribbon__button[aria-label="${label}"], .esco-ribbon__button:has-text("${label}")`).first();

export const paletteButton = (page, type) =>
  page.locator(`.esco-palette__menu button[aria-label="${type}"]`).first();

const FILE_SUBMENUS = [
  {
    label: "Import / Export",
    commands: [
      "Cloud Projects",
      "Import L5X",
      "Export L5X",
      "L5X Handoff Receipt",
      "Export ESCO Snapshot",
      "Import ESCO Snapshot",
      "Export ESCO Library",
      "Export ESCO Exchange",
      "Import ESCO Exchange",
      "Export ESCO Package",
      "Import ESCO Package",
    ],
  },
  {
    label: "Runtime / SoftController",
    commands: [
      "Build ESCO Runtime",
      "Export ESCO Runtime",
      "Import ESCO Runtime",
      "Download Runtime to ESCO SoftController",
      "Open ESCO SoftController Upload",
      "Validate ESCO Package / Runtime Files",
    ],
  },
  {
    label: "Properties",
    commands: ["Project Properties", "Controller Properties"],
  },
];

export async function openRibbonMenu(page, menu) {
  await page.locator(`.esco-ribbon__tab:has-text("${menu}")`).click();
  await page.locator(`.esco-ribbon-menu[aria-label="${menu} menu"]`).waitFor({ timeout: 5000 });
}

export async function clickRibbonMenuItem(page, menu, label) {
  await openRibbonMenu(page, menu);
  if (menu === "File") {
    const group = FILE_SUBMENUS.find((candidate) =>
      candidate.commands.some((command) => label.toLowerCase().startsWith(command.toLowerCase())),
    );
    if (group) {
      await page.locator(".esco-ribbon-menu__submenu-trigger:visible").filter({ hasText: group.label }).first().hover();
      await page
        .locator(`.esco-ribbon-menu--nested[aria-label="${group.label} submenu"] .esco-ribbon-menu__item:visible`)
        .filter({ hasText: label })
        .first()
        .click();
      return;
    }
  }
  await page
    .locator(`.esco-ribbon-menu[aria-label="${menu} menu"] > .esco-ribbon-menu__item:visible`)
    .filter({ hasText: label })
    .first()
    .click();
}

export const clickFileMenuItem = (page, label) => clickRibbonMenuItem(page, "File", label);

export async function addPaletteInstruction(page, type) {
  const group = page.locator(".esco-palette__group").filter({
    has: page.locator(`button[aria-label="${type}"]`),
  }).first();
  await group.locator(".esco-palette__summary").click();
  await paletteButton(page, type).click();
}

export const l5xInput = (page) =>
  page.locator('input[type="file"][accept*=".l5x"]').first();

export async function dismissToasts(page) {
  while ((await page.locator(".esco-toast__close").count()) > 0) {
    await page.locator(".esco-toast__close").first().click();
  }
}

export async function readConfirmationText(page) {
  await page.locator(".esco-confirmation").waitFor({ timeout: 8000 });
  return page.locator(".esco-confirmation").innerText();
}

export async function acceptConfirmation(page) {
  await page.locator(".esco-confirmation").waitFor({ timeout: 8000 });
  await page.locator(".esco-confirmation .esco-btn--primary").click();
  await page.locator(".esco-confirmation").waitFor({ state: "detached", timeout: 8000 });
}

export async function cancelConfirmation(page) {
  await page.locator(".esco-confirmation").waitFor({ timeout: 8000 });
  await page.locator('.esco-confirmation .esco-btn:has-text("Cancel")').click();
  await page.locator(".esco-confirmation").waitFor({ state: "detached", timeout: 8000 });
}

export async function clearAiProfileStorage(page) {
  await page.evaluate(() => {
    localStorage.removeItem("esco.ai.profile.v1");
    localStorage.removeItem("esco.ai.profile.v2");
    localStorage.removeItem("esco.ai.profile.secret.v1");
  });
}

export async function importL5XText(page, text, name = "fixture.L5X") {
  await l5xInput(page).setInputFiles({
    name,
    mimeType: "application/xml",
    buffer: Buffer.from(text),
  });
  await page.locator(".esco-tree__node--routine, .esco-tree__node--controller").first().waitFor({ timeout: 8000 });
}

export async function importL5XPath(page, path) {
  await l5xInput(page).setInputFiles(path);
  await page.locator('button:has-text("MainRoutine"), button:has-text("Main")').first().waitFor({ timeout: 8000 });
}

export async function importStarterProject(page) {
  await importL5XText(page, STARTER_L5X, "starter.L5X");
  await openMainRoutine(page);
  await dismissToasts(page);
}

export async function createBlankProject(page) {
  await page.locator('.esco-ribbon__toolbar-row--standard .esco-ribbon__button[aria-label="New"]').click();
  await page.locator(".esco-new-project").waitFor({ timeout: 8000 });
  await page.locator('.esco-new-project .esco-btn--primary:has-text("OK")').click();
  await page.locator(".esco-editor__surface").waitFor({ timeout: 8000 });
  await dismissToasts(page);
}

export async function createBoolTag(page, name) {
  await page.locator('.esco-left :text("Controller Tags")').first().click({ button: "right" });
  await page.locator('.esco-context-menu__item:has-text("New Tag")').click();
  await page.locator('.esco-modal__panel[aria-label="New Tag"]').waitFor({ timeout: 8000 });
  await page.locator('.esco-modal__panel[aria-label="New Tag"] label:has-text("Name") input').fill(name);
  await page.locator('.esco-modal__panel[aria-label="New Tag"] .esco-btn--primary:has-text("OK")').click();
  await page.locator('.esco-modal__panel[aria-label="New Tag"]').waitFor({ state: "detached", timeout: 8000 });
  await dismissToasts(page);
}

export async function openWatchPanel(page) {
  if ((await page.locator('.esco-dock__tab:has-text("Watch")').count()) > 0) {
    await page.locator('.esco-dock__tab:has-text("Watch")').click();
  } else {
    await page.locator('.esco-ribbon__tab:has-text("View")').click();
    await page.locator('.esco-ribbon-menu__item:has-text("Watch")').click();
  }
  await page.locator(".esco-watch").waitFor({ timeout: 8000 });
}

export async function addRungViaProjectMenu(page) {
  await page.locator('.esco-ribbon__tab:has-text("Logic")').click();
  await page.locator('.esco-ribbon-menu__item:has-text("Add Rung")').click();
}

export async function openDockPanel(page, label) {
  if ((await page.locator(`.esco-dock__tab:has-text("${label}")`).count()) > 0) {
    await page.locator(`.esco-dock__tab:has-text("${label}")`).click();
  } else if (/^watch$/i.test(label)) {
    await page.locator('.esco-ribbon__tab:has-text("View")').click();
    await page.locator('.esco-ribbon-menu__item:has-text("Watch")').click();
  } else if (/^forces$/i.test(label)) {
    await page.locator('.esco-ribbon__tab:has-text("View")').click();
    await page.locator('.esco-ribbon-menu__item:has-text("Forces")').click();
  } else if (/cross ref|cross reference/i.test(label)) {
    await page.locator('.esco-ribbon__tab:has-text("Tools")').click();
    await page.locator('.esco-ribbon-menu__item:has-text("Cross Reference")').click();
  } else if (/search/i.test(label)) {
    await ribbonButton(page, "Find").click();
  } else {
    await openWatchPanel(page);
    await page.locator(`.esco-dock__tab:has-text("${label}")`).click();
  }
}

export async function openMainRoutine(page) {
  await page.locator('.esco-tree__node--routine:has-text("MainRoutine"), .esco-tree__node--routine:has-text("Main")').first().click();
  await page.locator(".esco-editor__surface").waitFor({ timeout: 8000 });
}
