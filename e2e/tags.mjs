import { chromium } from "playwright-core";
import { readFileSync } from "node:fs";
import { URL, acceptConfirmation, cancelConfirmation, importStarterProject, readConfirmationText } from "./helpers.mjs";
const results = [];
const check = (l, c, d = "") => { results.push(!!c); console.log(`${c ? "PASS" : "FAIL"}  ${l}${d ? "  — " + d : ""}`); };
const rows = (page) => page.locator(".esco-tags__table tbody tr");
const openTags = async (page) => {
  await page.locator('.esco-left :text("Controller Tags")').first().click();
  await page.locator(".esco-tags").waitFor({ timeout: 5000 });
};
const remountTags = async (page) => {
  await page.locator('.esco-tree__node--routine:has-text("MainRoutine"), .esco-tree__node--routine:has-text("Main")').first().click();
  await page.locator(".esco-editor__surface").waitFor({ timeout: 5000 });
  await openTags(page);
};

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
await page.addInitScript(() => window.localStorage.removeItem("esco.tags.filter"));
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
try {
  await page.goto(URL, { waitUntil: "networkidle" });
  await importStarterProject(page);
  await openTags(page);
  const initial = await rows(page).count();
  check("tag table lists existing tags", initial >= 3, `rows=${initial}`);
  const tagChrome = await page.evaluate(() => {
    const sample = (selector) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const bounds = element.getBoundingClientRect();
      const styles = getComputedStyle(element);
      return {
        width: Math.round(bounds.width),
        height: Math.round(bounds.height),
        backgroundColor: styles.backgroundColor,
        backgroundImage: styles.backgroundImage,
        borderColor: styles.borderColor,
        borderRadius: styles.borderRadius,
        borderTopColor: styles.borderTopColor,
        display: styles.display,
        gridTemplateRows: styles.gridTemplateRows,
        fontSize: styles.fontSize,
      };
    };
    return {
      shell: sample(".esco-tags"),
      bar: sample(".esco-tags__bar"),
      add: sample(".esco-tags__add"),
      header: sample(".esco-tags__table th"),
      cell: sample(".esco-tags__table td"),
      tabs: sample(".esco-tags__tabs"),
      activeTab: sample(".esco-tags__tab.is-active"),
      command: sample(".esco-tags__delete"),
      button: sample(".esco-tags .esco-btn"),
    };
  });
  check(
    "tag editor uses Studio-style dense worksheet chrome",
    /^32px 34px /.test(tagChrome.shell?.gridTemplateRows ?? "") &&
      tagChrome.bar?.height === 32 &&
      tagChrome.add?.height === 34 &&
      tagChrome.add?.borderRadius === "0px" &&
      /linear-gradient/.test(tagChrome.header?.backgroundImage ?? "") &&
      tagChrome.cell?.borderColor === "rgb(200, 200, 200)",
    JSON.stringify(tagChrome),
  );
  check(
    "tag editor bottom tabs and command glyph use classic square styling",
    tagChrome.activeTab?.height === 27 &&
      tagChrome.activeTab?.backgroundColor === "rgb(255, 255, 255)" &&
      tagChrome.activeTab?.borderRadius === "0px" &&
      tagChrome.command?.width === 16 &&
      tagChrome.command?.borderRadius === "0px" &&
      tagChrome.button?.height === 22,
    JSON.stringify(tagChrome),
  );

  await page.locator('.esco-tags__tab:has-text("Monitor Tags")').click();
  const startValue = page.locator('button[aria-label="Toggle value for StartPB"]');
  await startValue.waitFor({ timeout: 5000 });
  check("monitor mode shows offline scalar values", (await startValue.innerText()) === "false");
  await startValue.click();
  check("monitor mode writes guarded input values offline", (await startValue.innerText()) === "true");
  check("monitor mode keeps logic output values read-only", (await page.locator('button[aria-label="Toggle value for MotorRun"]').count()) === 0);
  await page.locator('button[aria-label="Force StartPB"]').click();
  check("monitor mode can force a tag row", await page.locator('button[aria-label="Unforce StartPB"]').isVisible());
  await page.locator('button[aria-label="Unforce StartPB"]').click();
  check("monitor mode can unforce a tag row", await page.locator('button[aria-label="Force StartPB"]').isVisible());
  await page.locator('button[aria-label="Watch StartPB"]').click();
  await page.locator('.esco-dock__tab.is-active:has-text("Watch")').waitFor({ timeout: 5000 });
  check("monitor row Watch routes to selected watch row", /Selected:\s*StartPB/.test(await page.locator(".esco-simbar").innerText()));
  await page.locator('button[aria-label="Cross reference StartPB"]').click();
  await page.locator('.esco-dock__tab.is-active:has-text("Cross Reference")').waitFor({ timeout: 5000 });
  check("monitor row XRef routes to selected cross reference", /StartPB/.test(await page.locator(".esco-xref").innerText()));
  await page.locator('.esco-tags__tab:has-text("Edit Tags")').click();

  await page.locator('.esco-tags__add input[placeholder="New tag name"]').fill("StartPB");
  check("duplicate add is guarded before hitting backend", await page.locator('.esco-tags__add button:has-text("Add Tag")').isDisabled());
  await page.locator('.esco-tags__add input[placeholder="New tag name"]').fill("");

  // Add a tag (name is rendered as an editable input → match by value attr).
  await page.locator('.esco-tags__add input[placeholder="New tag name"]').fill("Lamp");
  await page.locator('.esco-tags__add button:has-text("Add Tag")').click();
  await page.waitForFunction((n) => document.querySelectorAll(".esco-tags__table tbody tr").length === n, initial + 1, { timeout: 5000 });
  check("add tag adds a row", (await rows(page).count()) === initial + 1);
  check("new Lamp tag present", (await page.locator('.esco-tags__table input[value="Lamp"]').count()) >= 1);

  // Referenced tag (StartPB) cannot be deleted; unused (Lamp) can.
  const startDelete = page.locator('.esco-tags__table tbody tr:has(input[value="StartPB"]) button[aria-label="Delete StartPB"]');
  check("referenced tag delete is disabled", await startDelete.isDisabled());
  const lampDelete = page.locator('.esco-tags__table tbody tr:has(input[value="Lamp"]) button[aria-label="Delete Lamp"]');
  check("unused tag delete is enabled", await lampDelete.isEnabled());
  await lampDelete.click();
  check("delete confirmation names the tag", /Delete tag "Lamp"/.test(await readConfirmationText(page)));
  await cancelConfirmation(page);
  check("delete cancel keeps the row", (await page.locator('.esco-tags__table input[value="Lamp"]').count()) === 1);
  await lampDelete.click();
  await acceptConfirmation(page);
  await page.waitForFunction((n) => document.querySelectorAll(".esco-tags__table tbody tr").length === n, initial, { timeout: 5000 });
  check("delete removes the row", (await rows(page).count()) === initial);

  // Add a program-scoped local tag from the same tag table create row.
  await page.locator('.esco-tags__add input[placeholder="New tag name"]').fill("LocalLamp");
  await page.locator('select[aria-label="New tag scope"]').selectOption("program");
  await page.locator('select[aria-label="New tag program"]').selectOption({ label: "MainProgram" });
  await page.locator('.esco-tags__add button:has-text("Add Tag")').click();
  await page.waitForFunction((n) => document.querySelectorAll(".esco-tags__table tbody tr").length === n, initial + 1, { timeout: 5000 });
  const localLampRow = page.locator('.esco-tags__table tbody tr:has(input[value="LocalLamp"])');
  check("program-scoped add creates a local tag row", (await localLampRow.count()) === 1);
  await localLampRow.locator('button[aria-label="Delete LocalLamp"]').click();
  await acceptConfirmation(page);
  await page.waitForFunction((n) => document.querySelectorAll(".esco-tags__table tbody tr").length === n, initial, { timeout: 5000 });
  await page.locator('select[aria-label="New tag scope"]').selectOption("controller");

  // Multi-dimensional array metadata can be authored and edited from the tag table.
  await page.locator('.esco-tags__add input[placeholder="New tag name"]').fill("Matrix");
  await page.locator('.esco-tags__add input[placeholder="Dims (optional)"]').fill("2,3");
  await page.locator('.esco-tags__add button:has-text("Add Tag")').click();
  await page.waitForFunction((n) => document.querySelectorAll(".esco-tags__table tbody tr").length === n, initial + 1, { timeout: 5000 });
  check("add tag preserves multi-dimensional dimensions", (await page.locator('input[aria-label="Dimensions for Matrix"]').inputValue()) === "2,3");
  await page.locator('input[aria-label="Data type for Matrix"]').fill("REAL");
  await page.keyboard.press("Tab");
  await page.locator('input[aria-label="Dimensions for Matrix"]').fill("4,5");
  await page.keyboard.press("Tab");
  await page.locator('select[aria-label="Display style for Matrix"]').selectOption("Hex");
  await page.locator('input[aria-label="Comments for Matrix"]').fill(".Speed=Commanded speed | [0]=First index");
  await page.keyboard.press("Tab");
  await page.locator('input[aria-label="Engineering units for Matrix"]').fill("=rpm | [0]=counts");
  await page.keyboard.press("Tab");
  await page.locator('select[aria-label="External access for Matrix"]').selectOption("read-only");
  await page.locator('input[aria-label="Constant tag Matrix"]').check();
  await remountTags(page);
  check("tag data type edit persists", (await page.locator('input[aria-label="Data type for Matrix"]').inputValue()) === "REAL");
  check("tag dimension edit persists", (await page.locator('input[aria-label="Dimensions for Matrix"]').inputValue()) === "4,5");
  check("tag display style edit persists", (await page.locator('select[aria-label="Display style for Matrix"]').inputValue()) === "Hex");
  check("tag comment edit persists", (await page.locator('input[aria-label="Comments for Matrix"]').inputValue()) === ".Speed=Commanded speed | [0]=First index");
  check("tag engineering unit edit persists", (await page.locator('input[aria-label="Engineering units for Matrix"]').inputValue()) === "=rpm | [0]=counts");
  check("tag ExternalAccess edit persists", (await page.locator('select[aria-label="External access for Matrix"]').inputValue()) === "read-only");
  check("tag Constant flag edit persists", await page.locator('input[aria-label="Constant tag Matrix"]').isChecked());
  await page.locator(".esco-tags__search").fill("rpm");
  check("search finds engineering units", (await rows(page).count()) === 1 && (await page.locator('.esco-tags__table input[value="Matrix"]').count()) === 1);
  await page.locator(".esco-tags__search").fill("");
  await page.locator('.esco-tags__table tbody tr:has(input[value="Matrix"]) button[aria-label="Delete Matrix"]').click();
  await acceptConfirmation(page);
  await page.waitForFunction((n) => document.querySelectorAll(".esco-tags__table tbody tr").length === n, initial, { timeout: 5000 });

  // Alias editing: point StopPB at StartPB, then re-mount the view (switch away and
  // back) so the uncontrolled alias input re-seeds from the model and proves it persisted.
  await page.locator('input[aria-label="Alias target for StopPB"]').fill("StartPB");
  await page.keyboard.press("Tab");
  await remountTags(page);
  check(
    "tag alias edit persists through the action layer",
    (await page.locator('input[aria-label="Alias target for StopPB"]').inputValue()) === "StartPB",
  );

  // Search filter.
  await page.locator(".esco-tags__search").fill("StartPB");
  check("search includes alias targets", (await rows(page).count()) >= 2);
  await page.locator(".esco-tags__search").fill("MotorRun");
  check("search filters rows", (await rows(page).count()) === 1);
  await page.locator(".esco-tags__search").fill("");

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.locator('.esco-tags__bar button:has-text("Export CSV")').click(),
  ]);
  const csvPath = await download.path();
  const csvText = csvPath ? readFileSync(csvPath, "utf-8") : "";
  check(
    "tag CSV export downloads the expected file",
    /-tags\.csv$/i.test(download.suggestedFilename()) &&
      /Scope,Program,Name,DataType/.test(csvText) &&
      /Radix,Description,Comments,EngineeringUnits/.test(csvText),
  );

  await page.locator('input[type="file"][accept*=".csv"]').setInputFiles({
    name: "bad-tags-import.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("Name,DataType,Scope,Program,Description\nBad__Name,BOOL,controller,,Invalid CSV\n"),
  });
  await page.locator(".esco-tagcsv").waitFor({ timeout: 5000 });
  const badPreviewText = await page.locator(".esco-tagcsv").innerText();
  check(
    "tag CSV preview blocks invalid rows",
    /Bad__Name/.test(badPreviewText) &&
      /consecutive underscores/i.test(badPreviewText) &&
      await page.locator('.esco-tagcsv button:has-text("Apply CSV")').isDisabled(),
  );
  await page.locator('button[aria-label="Close tag CSV preview"]').click();
  await page.locator(".esco-tagcsv").waitFor({ state: "detached", timeout: 5000 });

  await page.locator('input[type="file"][accept*=".csv"]').setInputFiles({
    name: "tags-import.csv",
    mimeType: "text/csv",
    buffer: Buffer.from('Name,DataType,Scope,Program,Description,AliasFor,Dimension,Radix,Comments,EngineeringUnits\nCsvLamp,BOOL,controller,,Imported from CSV,,,Hex,"[{""operand"":"""",""text"":""CSV comment""}]","[{""operand"":"""",""text"":""state""}]"\n'),
  });
  await page.locator(".esco-tagcsv").waitFor({ timeout: 5000 });
  const previewText = await page.locator(".esco-tagcsv").innerText();
  check("tag CSV import preview shows created tag", /CsvLamp/.test(previewText) && /1 create/.test(previewText));
  await page.locator('.esco-tagcsv button:has-text("Apply CSV")').click();
  await page.locator(".esco-tagcsv").waitFor({ state: "detached", timeout: 5000 });
  await page.locator(".esco-tags__search").fill("CsvLamp");
  check("tag CSV apply adds imported tag", (await rows(page).count()) === 1 && (await page.locator('.esco-tags__table input[value="CsvLamp"]').count()) === 1);
  check("tag CSV apply keeps imported radix", (await page.locator('select[aria-label="Display style for CsvLamp"]').inputValue()) === "Hex");
  check("tag CSV apply keeps imported comments", (await page.locator('input[aria-label="Comments for CsvLamp"]').inputValue()) === "=CSV comment");
  check("tag CSV apply keeps imported engineering units", (await page.locator('input[aria-label="Engineering units for CsvLamp"]').inputValue()) === "=state");

  const passed = results.filter(Boolean).length;
  console.log(`\nSUMMARY: ${passed}/${results.length} checks passed`);
  process.exitCode = passed === results.length ? 0 : 1;
} catch (err) {
  console.log("ERROR:", err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
