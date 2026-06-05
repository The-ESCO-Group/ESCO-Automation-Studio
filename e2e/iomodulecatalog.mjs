// E2E: I/O module profile workflow. Right-click I/O Configuration opens the
// enhanced module catalog, exposes profile review details, validates the device
// definition step, creates a module, and leaves the post-create I/O detail
// review visible. "Add 1756 Backplane..." still opens the same catalog
// prefiltered to chassis devices.
import { chromium } from "playwright-core";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { writeFileSync } from "node:fs";
import { importL5XPath } from "./helpers.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const URL = process.env.E2E_URL || "http://localhost:5173/";
const fixturePath = join(here, "io-fixture.L5X");

const FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0" TargetName="IoCtl" ContentType="Controller">
  <Controller Use="Target" Name="IoCtl">
    <Modules>
      <Module Name="Local" CatalogNumber="1756-L83E" Slot="0"/>
      <Module Name="DI_01" CatalogNumber="1756-IB16" Slot="1" ParentModule="Local"/>
    </Modules>
    <Tags><Tag Name="Start" DataType="BOOL"/></Tags>
    <Programs>
      <Program Name="MainProgram" MainRoutineName="Main">
        <Routines><Routine Name="Main" Type="RLL"><RLLContent>
          <Rung Number="0" Type="N"><Text><![CDATA[XIC(Start)OTE(Start);]]></Text></Rung>
        </RLLContent></Routine></Routines>
      </Program>
    </Programs>
  </Controller>
</RSLogix5000Content>`;
writeFileSync(fixturePath, FIXTURE, "utf-8");

const results = [];
const check = (l, c, d = "") => { results.push(!!c); console.log(`${c ? "PASS" : "FAIL"}  ${l}${d ? "  — " + String(d).replace(/\s+/g, " ").slice(0, 100) : ""}`); };

const ioRoot = (page) => page.locator('.esco-tree__group--button:has-text("I/O Configuration")').first();
const menuItem = (page, label) => page.locator(`.esco-context-menu__item:has-text("${label}")`).first();
const searchInput = (page) => page.locator('.esco-new-module__search-row input').first();
const selectModuleType = (page) => page.locator('[aria-label="Select Module Type"]').first();
const selectReplacementModuleType = (page) => page.locator('[aria-label="Select Replacement Module Type"]').first();
const deviceDefinition = (page) => page.locator('[aria-label="Device definition"]').first();
const newModuleStage = (page) => page.locator('[aria-label="New Module"]').first();
const changeModuleStage = (page) => page.locator('[aria-label="Change Module"]').first();
const controllerTagsGroup = (page) => page.locator('.esco-tree__group--button:has-text("Controller Tags")').first();

async function visibleTagRows(page, prefix) {
  await controllerTagsGroup(page).click();
  await page.locator(".esco-tags").waitFor({ timeout: 8000 });
  await page.locator(".esco-tags__search").fill(prefix);
  await page.waitForTimeout(100);
  return page.locator(".esco-tags__table tbody tr").evaluateAll((rows, tagPrefix) =>
    rows
      .map((row) => {
        const valueOf = (selector) => row.querySelector(selector)?.value ?? "";
        return {
          name: valueOf("td:nth-child(1) input"),
          dataType: valueOf("td:nth-child(5) input"),
          externalAccess: valueOf("td:nth-child(11) select"),
          description: valueOf("td:nth-child(8) input"),
        };
      })
      .filter((row) => row.name.startsWith(tagPrefix)),
    prefix,
  );
}

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
try {
  await page.goto(URL, { waitUntil: "networkidle" });
  await importL5XPath(page, fixturePath);
  await page.locator('.esco-titlebar__name:has-text("IoCtl")').waitFor({ timeout: 8000 });

  // New Module... opens the enhanced ESCO catalog and exposes profile review details.
  await ioRoot(page).click({ button: "right" });
  await menuItem(page, "New Module").click();
  await page.locator(".esco-new-module").waitFor({ timeout: 8000 });
  check("right-click New Module opens the enhanced ESCO catalog", (await page.locator(".esco-new-module").count()) === 1);
  const allRows = await page.locator(".esco-new-module__table tbody tr").count();
  check("catalog lists many module types", allRows >= 10, `${allRows} rows`);
  check("catalog search starts empty for New Module", (await searchInput(page).inputValue()) === "");
  const catalogText = await selectModuleType(page).innerText();
  check(
    "catalog clarifies mode, category, vendor/family filters, and selected profile review",
    /Mode: Catalog/.test(catalogText) &&
      /Category: All categories/.test(catalogText) &&
      /Vendor\/Family: All families/.test(catalogText) &&
      /Profile Summary.*Connection Summary.*Channel Summary.*Profile Source/s.test(catalogText),
    catalogText,
  );

  await searchInput(page).fill("1756-IF8H");
  await page.locator('.esco-new-module__table tbody tr:has-text("1756-IF8H")').first().click();
  const hartProfileText = await selectModuleType(page).innerText();
  check(
    "selected HART module shows connection and channel profile summary before create",
    /1756-IF8H/.test(hartProfileText) &&
      /RPI 100000 us/.test(hartProfileText) &&
      /8-channel HART/.test(hartProfileText),
    hartProfileText,
  );

  await selectModuleType(page).locator('.esco-btn--primary:has-text("Create")').click();
  await deviceDefinition(page).waitFor({ timeout: 8000 });
  check(
    "device definition carries HART input data default",
    (await deviceDefinition(page).locator('label:has-text("Input Data:") select').inputValue()) === "Analog and HART",
  );
  await deviceDefinition(page).locator('label:has-text("Name:*") input').fill("Profile_AI_02");
  await deviceDefinition(page).locator('label:has-text("Slot:") input').fill("1");
  await deviceDefinition(page).locator('[role="alert"]:has-text("Slot 1")').waitFor({ timeout: 5000 });
  check(
    "device definition blocks duplicate local slots before create",
    (await deviceDefinition(page).locator('.esco-btn--primary:has-text("OK")').isDisabled()) &&
      /Slot 1 is already used at this I\/O location/i.test(await deviceDefinition(page).locator('[role="alert"]').innerText()),
  );

  await deviceDefinition(page).locator('label:has-text("Slot:") input').fill("2");
  await deviceDefinition(page).locator('.esco-btn--primary:has-text("OK")').click();
  await deviceDefinition(page).waitFor({ state: "detached", timeout: 8000 });
  const overviewText = await newModuleStage(page).innerText();
  check(
    "new module overview reviews profile, connection, channels, and create validation",
    /Profile Summary.*Connection Summary.*Channel Summary.*Creation Validation.*Ready to create offline module profile/s.test(overviewText) &&
      /Analog and HART/.test(overviewText) &&
    /RPI:.*100000 us/s.test(overviewText),
    overviewText,
  );
  check(
    "new module overview previews generated offline setup tags",
    /Setup Tags:.*Create 10/s.test(overviewText) &&
      /Create offline setup tags/.test(overviewText) &&
      /Profile_AI_02_Ch0/.test(overviewText),
    overviewText,
  );

  await newModuleStage(page).locator('.esco-new-module-stage__nav button:has-text("Channels")').click();
  await newModuleStage(page).locator('[aria-label="Profile channel configuration"]').waitFor({ timeout: 5000 });
  const createChannelTable = newModuleStage(page).locator('[aria-label="Profile channel configuration"]');
  const createChannelText = await createChannelTable.innerText();
  const createChannelFormat = await createChannelTable.locator('select[aria-label="Channel 0 data format"]').inputValue();
  const createChannelRange = await createChannelTable.locator('input[aria-label="Channel 0 range"]').inputValue();
  check(
    "channels section exposes editable HART channel profile rows",
    /Channel 0/.test(createChannelText) &&
      createChannelFormat === "Float + HART" &&
      /4-20 mA \+ HART/.test(createChannelRange),
    `${createChannelText} / format=${createChannelFormat} / range=${createChannelRange}`,
  );
  await createChannelTable.locator('select[aria-label="Channel 0 data format"]').selectOption("Integer");
  await createChannelTable.locator('input[aria-label="Channel 0 enabled"]').uncheck();
  check(
    "channel row edits are visible before the module is created",
    (await createChannelTable.locator('select[aria-label="Channel 0 data format"]').inputValue()) === "Integer" &&
      !(await createChannelTable.locator('input[aria-label="Channel 0 enabled"]').isChecked()),
  );

  await newModuleStage(page).locator('.esco-new-module-stage__footer .esco-btn--primary:has-text("OK")').click();
  await newModuleStage(page).waitFor({ state: "detached", timeout: 8000 });
  await page.locator('.esco-tree__node--module:has-text("Slot 2: 1756-IF8H")').waitFor({ timeout: 8000 });
  await page.locator('.esco-detail:has-text("Selected Module Profile Review")').waitFor({ timeout: 8000 });
  const postCreateDetail = await page.locator(".esco-detail").innerText();
  const postCreateSignals = {
    review: /Selected Module Profile Review/i.test(postCreateDetail),
    name: /Profile_AI_02/.test(postCreateDetail),
    connection: /Connection summary.*100000 us/s.test(postCreateDetail),
    channels: /Channel summary.*8-channel HART/s.test(postCreateDetail),
    source: /Profile source/s.test(postCreateDetail),
  };
  check(
    "post-create I/O detail shows selected module profile review",
    Object.values(postCreateSignals).every(Boolean),
    JSON.stringify(postCreateSignals),
  );
  check(
    "I/O Configuration detail is a clean slot/module overview",
    (await page.locator('.esco-detail [aria-label="I/O configuration overview"]').count()) === 1 &&
      (await page.locator(".esco-detail .esco-io-slot-map .esco-io-slot").count()) >= 3 &&
      (await page.locator(".esco-detail .esco-io-module-card").count()) >= 2 &&
      (await page.locator('.esco-detail .esco-io-config__actions .esco-btn:has-text("New Module")').count()) === 1 &&
      (await page.locator('.esco-detail .esco-io-module-card__actions .esco-btn:has-text("Properties")').count()) >= 1,
    postCreateDetail,
  );
  check(
    "I/O Configuration detail does not expose inline module editor clutter",
    (await page.locator('.esco-detail .esco-iodevice-add__grid input, .esco-detail button:has-text("Apply Module Properties")').count()) === 0,
  );
  const committedSetupTags = await visibleTagRows(page, "Profile_AI_02_");
  const tagByName = Object.fromEntries(committedSetupTags.map((tag) => [tag.name, tag]));
  check(
    "offline setup tags commit into Controller Tags after module create",
    committedSetupTags.length === 9 &&
      !tagByName.Profile_AI_02_Ch0 &&
      tagByName.Profile_AI_02_Ch1?.dataType === "REAL" &&
      tagByName.Profile_AI_02_Status?.dataType === "DINT" &&
      tagByName.Profile_AI_02_Fault?.dataType === "BOOL" &&
      committedSetupTags.every((tag) => tag.externalAccess === "read-only"),
    JSON.stringify(committedSetupTags),
  );

  await page.locator('.esco-tree__node--module:has-text("Slot 2: 1756-IF8H")').click({ button: "right" });
  await menuItem(page, "Properties").click();
  const moduleProperties = page.locator('[aria-label="Module Properties"]').first();
  await moduleProperties.waitFor({ timeout: 8000 });
  await moduleProperties.locator('[role="tab"]:has-text("Connection")').click();
  const connectionSummary = await moduleProperties.locator('[aria-label="Connection profile summary"]').innerText();
  check(
    "module properties show connection profile summary with RPI, keying, slot, and offline guard",
    /RPI.*100000 us.*100 ms/s.test(connectionSummary) &&
      /Keying.*Compatible Module/s.test(connectionSummary) &&
      /Slot Review.*2/s.test(connectionSummary) &&
      /Offline metadata only/s.test(connectionSummary),
    connectionSummary,
  );
  await moduleProperties.locator('[role="tab"]:has-text("Channels")').click();
  const propertiesChannelTable = moduleProperties.locator('[aria-label="Profile channel configuration"]');
  await propertiesChannelTable.waitFor({ timeout: 5000 });
  check(
    "module properties preserve editable channel profile rows after create",
    (await propertiesChannelTable.locator('select[aria-label="Channel 0 data format"]').inputValue()) === "Integer" &&
      !(await propertiesChannelTable.locator('input[aria-label="Channel 0 enabled"]').isChecked()),
  );
  await moduleProperties.locator('[role="tab"]:has-text("Module Info")').click();
  const diagnosticsText = await moduleProperties.locator('[aria-label="Offline profile diagnostics"]').innerText();
  check(
    "module properties show offline profile diagnostics and status rows",
    /Offline profile review/.test(diagnosticsText) &&
      /Channel profile loaded/.test(diagnosticsText) &&
      /no controller connection/i.test(diagnosticsText),
    diagnosticsText,
  );
  await moduleProperties.locator('[aria-label="Close Module Properties"]').click();

  await page.locator('.esco-tree__node--module:has-text("Slot 2: 1756-IF8H")').click({ button: "right" });
  await menuItem(page, "Change Module").click();
  await selectReplacementModuleType(page).waitFor({ timeout: 8000 });
  check(
    "Change Module opens replacement catalog prefiltered to the selected profile",
    (await searchInput(page).inputValue()) === "1756-IF8H" &&
      /Select Replacement Module Type/.test(await selectReplacementModuleType(page).innerText()),
  );
  await searchInput(page).fill("1756-OB16");
  await page.locator('.esco-new-module__table tbody tr:has-text("1756-OB16")').first().click();
  await selectReplacementModuleType(page).locator('.esco-btn--primary:has-text("Change")').click();
  await deviceDefinition(page).waitFor({ timeout: 8000 });
  check(
    "Change Module keeps the module identity and slot in device definition",
    (await deviceDefinition(page).locator('label:has-text("Name:*") input').inputValue()) === "Profile_AI_02" &&
      (await deviceDefinition(page).locator('label:has-text("Slot:") input').inputValue()) === "2",
  );
  await deviceDefinition(page).locator('.esco-btn--primary:has-text("OK")').click();
  await deviceDefinition(page).waitFor({ state: "detached", timeout: 8000 });
  const changeOverviewText = await changeModuleStage(page).innerText();
  check(
    "Change Module reviews replacement profile before applying",
    /1756-OB16/.test(changeOverviewText) &&
      /Change Validation.*Ready to change offline module profile/s.test(changeOverviewText),
    changeOverviewText,
  );
  await changeModuleStage(page).locator('.esco-new-module-stage__footer .esco-btn--primary:has-text("OK")').click();
  await changeModuleStage(page).waitFor({ state: "detached", timeout: 8000 });
  await page.locator('.esco-tree__node--module:has-text("Slot 2: 1756-OB16")').waitFor({ timeout: 8000 });
  const changedDetail = await page.locator(".esco-detail").innerText();
  check(
    "Change Module replaces the selected module profile in place",
    /Profile_AI_02/.test(changedDetail) && /1756-OB16/.test(changedDetail) && !/1756-IF8H/.test(changedDetail),
    changedDetail,
  );

  await page.locator('.esco-detail .esco-io-slot:has-text("Slot 3")').click();
  await page.locator(".esco-new-module").waitFor({ timeout: 8000 });
  await searchInput(page).fill("1756-IF8H");
  await page.locator('.esco-new-module__table tbody tr:has-text("1756-IF8H")').first().click();
  await selectModuleType(page).locator('.esco-btn--primary:has-text("Create")').click();
  await deviceDefinition(page).waitFor({ timeout: 8000 });
  check(
    "clicking an empty backplane slot opens New Module prefilled to that slot",
    (await deviceDefinition(page).locator('label:has-text("Slot:") input').inputValue()) === "3",
  );
  await deviceDefinition(page).locator('label:has-text("Name:*") input').fill("Profile_AI_03");
  await deviceDefinition(page).locator('.esco-btn--primary:has-text("OK")').click();
  await deviceDefinition(page).waitFor({ state: "detached", timeout: 8000 });
  await newModuleStage(page).locator('.esco-new-module__setup-tags input[type="checkbox"]').uncheck();
  const skipOverview = await newModuleStage(page).innerText();
  check("setup tag opt-out is visible before module create", /Setup Tags:.*Skip 10/s.test(skipOverview), skipOverview);
  await newModuleStage(page).locator('.esco-new-module-stage__footer .esco-btn--primary:has-text("OK")').click();
  await newModuleStage(page).waitFor({ state: "detached", timeout: 8000 });
  await page.locator('.esco-tree__node--module:has-text("Slot 3: 1756-IF8H")').waitFor({ timeout: 8000 });
  const skippedSetupTags = await visibleTagRows(page, "Profile_AI_03_");
  check(
    "setup tag opt-out creates the module without generated controller tags",
    skippedSetupTags.length === 0,
    JSON.stringify(skippedSetupTags),
  );

  // Add 1756 Backplane... opens the same catalog prefiltered to chassis.
  await ioRoot(page).click({ button: "right" });
  await menuItem(page, "Add 1756 Backplane").click();
  await page.locator(".esco-new-module").waitFor({ timeout: 8000 });
  check("Add 1756 Backplane opens the catalog", (await page.locator(".esco-new-module").count()) === 1);
  check("Add Backplane prefills the chassis search", (await searchInput(page).inputValue()) === "Chassis");
  const chassisRows = await page.locator(".esco-new-module__table tbody tr").count();
  check("chassis filter narrows the catalog", chassisRows >= 1 && chassisRows < allRows, `${chassisRows} of ${allRows}`);
  const tableText = await page.locator(".esco-new-module__table tbody").innerText();
  check("chassis filter shows backplane/rack devices", /Backplane|Rack|Chassis/i.test(tableText), tableText);

  const passed = results.filter(Boolean).length;
  console.log(`\nSUMMARY: ${passed}/${results.length} checks passed`);
  process.exitCode = passed === results.length ? 0 : 1;
} catch (err) {
  console.log("ERROR:", err.message);
  await page.screenshot({ path: join(here, "iomodulecatalog-error.png") }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
