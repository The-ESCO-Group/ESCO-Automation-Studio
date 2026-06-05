// Workbench ergonomics smoke: layout persistence (active dock tab survives into
// localStorage) and Ctrl+Tab / Ctrl+Shift+Tab routine-tab cycling. Honors E2E_URL.
import { chromium } from "playwright-core";
import { URL, importL5XText, openMainRoutine, dismissToasts, openDockPanel } from "./helpers.mjs";

const results = [];
const check = (label, cond, detail = "") => {
  results.push(!!cond);
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${detail ? "  - " + String(detail).replace(/\s+/g, " ").slice(0, 140) : ""}`);
};

// Two routines in one program so the editor shows multiple tabs to cycle through.
const TWO_ROUTINE_L5X = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0" TargetName="WB_Two" ContentType="Controller">
  <Controller Use="Target" Name="WB_Two">
    <Tags><Tag Name="StartPB" TagType="Base" DataType="BOOL"/><Tag Name="MotorRun" TagType="Base" DataType="BOOL"/></Tags>
    <Programs>
      <Program Name="MainProgram" MainRoutineName="MainRoutine">
        <Routines>
          <Routine Name="MainRoutine" Type="RLL">
            <RLLContent><Rung Number="0" Type="N"><Text><![CDATA[XIC(StartPB)OTE(MotorRun);]]></Text></Rung></RLLContent>
          </Routine>
          <Routine Name="SecondRoutine" Type="RLL">
            <RLLContent><Rung Number="0" Type="N"><Text><![CDATA[XIC(MotorRun)OTE(StartPB);]]></Text></Rung></RLLContent>
          </Routine>
        </Routines>
      </Program>
    </Programs>
  </Controller>
</RSLogix5000Content>`;

const activeTabTitle = (page) =>
  page.locator(".esco-editor__tab.is-active .esco-editor__tab-title").first().innerText({ timeout: 5000 });
const activeDockTab = (page) =>
  page.locator(".esco-dock__tab.is-active").first().innerText({ timeout: 5000 });
const layoutFromStorage = (page) =>
  page.evaluate(() => {
    try {
      return JSON.parse(localStorage.getItem("esco.workbench.layout.v1") || "null");
    } catch {
      return null;
    }
  });

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
page.setDefaultTimeout(10000);

try {
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.locator(".esco-ribbon").waitFor({ timeout: 60000 });
  await importL5XText(page, TWO_ROUTINE_L5X, "workbench.L5X");
  await openMainRoutine(page);
  await dismissToasts(page);

  // ---- Ctrl+Tab routine cycling ----
  const first = (await activeTabTitle(page)).trim();
  check("MainRoutine opens as the active editor tab", /MainRoutine/.test(first), first);

  await page.keyboard.press("Control+Tab");
  const afterForward = (await activeTabTitle(page)).trim();
  check("Ctrl+Tab advances to the next routine tab", /SecondRoutine/.test(afterForward), afterForward);

  await page.keyboard.press("Control+Shift+Tab");
  const afterBack = (await activeTabTitle(page)).trim();
  check("Ctrl+Shift+Tab returns to the previous routine tab", /MainRoutine/.test(afterBack), afterBack);

  await page.locator('.esco-editor__tab.is-active button[aria-label="Close MainRoutine"]').click();
  await page.waitForFunction(() => /SecondRoutine/.test(document.querySelector(".esco-editor__tab.is-active")?.textContent ?? ""));
  const afterClose = (await activeTabTitle(page)).trim();
  check("closing the active routine tab switches to a neighboring routine instead of blanking the editor", /SecondRoutine/.test(afterClose), afterClose);
  const closedTabCount = await page.locator('.esco-editor__tab-title:has-text("MainRoutine")').count();
  check("closing a routine tab removes it from the tab strip", closedTabCount === 0, `remaining MainRoutine tabs: ${closedTabCount}`);

  // ---- Active dock tab persists to local layout ----
  await openDockPanel(page, "Forces");
  const dockTab = (await activeDockTab(page)).trim();
  check("Selecting the Forces dock tab makes it active", /Forces/i.test(dockTab), dockTab);

  // Give the persistence effect a tick to flush, then read the stored layout.
  await page.waitForFunction(
    () => {
      try {
        return JSON.parse(localStorage.getItem("esco.workbench.layout.v1") || "{}").dockTab === "forces";
      } catch {
        return false;
      }
    },
    { timeout: 5000 },
  ).catch(() => {});
  const layout = await layoutFromStorage(page);
  check("Workbench layout persists the active dock tab", layout && layout.dockTab === "forces", JSON.stringify(layout));

  // ---- Restored on reload: the persisted dock tab comes back ----
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator(".esco-ribbon").waitFor({ timeout: 60000 });
  const restored = await layoutFromStorage(page);
  check("Persisted layout survives a reload", restored && restored.dockTab === "forces", JSON.stringify(restored));
} catch (error) {
  check("workbench driver completed without throwing", false, error?.message ?? String(error));
} finally {
  const passed = results.filter(Boolean).length;
  console.log(`SUMMARY: ${passed}/${results.length}`);
  await browser.close();
  if (passed !== results.length) process.exitCode = 1;
}
