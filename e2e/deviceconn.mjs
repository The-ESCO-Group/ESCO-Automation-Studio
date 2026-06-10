import { chromium } from "playwright-core";
import { URL, importL5XText, openMainRoutine, dismissToasts } from "./helpers.mjs";

const results = [];
const check = (l, c, d = "") => { results.push(!!c); console.log(`${c ? "PASS" : "FAIL"}  ${l}${d ? "  - " + d : ""}`); };

// A project whose ladder references two of a motor device's standard tags.
const DEVICE_L5X = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0" TargetName="DevTest" ContentType="Controller">
  <Controller Use="Target" Name="DevTest">
    <Tags>
      <Tag Name="M1_Run" TagType="Base" DataType="BOOL"/>
      <Tag Name="M1_Overload" TagType="Base" DataType="BOOL"/>
      <Tag Name="Light" TagType="Base" DataType="BOOL"/>
    </Tags>
    <Programs>
      <Program Name="MainProgram" MainRoutineName="MainRoutine">
        <Routines>
          <Routine Name="MainRoutine" Type="RLL">
            <RLLContent>
              <Rung Number="0" Type="N"><Text><![CDATA[XIC(M1_Run)XIO(M1_Overload)OTE(Light);]]></Text></Rung>
            </RLLContent>
          </Routine>
        </Routines>
      </Program>
    </Programs>
  </Controller>
</RSLogix5000Content>`;

const openConnections = async (page) => {
  await page.locator('.esco-left :text("Controller Tags")').first().click({ button: "right" });
  await page.locator('.esco-context-menu__item:has-text("Device Connections")').first().click();
  await page.locator('.esco-modal__panel[aria-label="Device Connections"]').waitFor({ timeout: 8000 });
};

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));

try {
  await page.goto(URL, { waitUntil: "networkidle" });
  await importL5XText(page, DEVICE_L5X, "devtest.L5X");
  await openMainRoutine(page);
  await dismissToasts(page);

  await openConnections(page);
  check("Device Connections panel opens from the explorer", true);

  const dialog = page.locator('.esco-modal__panel[aria-label="Device Connections"]');
  await dialog.locator('label:has-text("Prefix") input').fill("M1");
  await dialog.locator(".esco-device-conn__summary").waitFor({ timeout: 8000 });

  const summary = (await dialog.locator(".esco-device-conn__summary").innerText()).replace(/\s+/g, " ");
  // Motor has 6 standard tags; two (M1_Run, M1_Overload) are referenced, four unused.
  check("summary reports the device's tag/reference/unused counts", /6 tag/.test(summary) && /2 ladder reference/.test(summary) && /4 unused/.test(summary), summary);

  const unused = await dialog.locator(".esco-device-conn__list > li.is-unused").count();
  check("unused device tags are listed", unused === 4, `${unused} unused`);

  // A referenced tag shows where it is used in ladder logic.
  const runRefs = await dialog.locator('.esco-device-conn__list > li:has(code:text-is("M1_Run")) .esco-device-conn__refs li').allInnerTexts();
  check("referenced tag shows its routine/rung usage", runRefs.some((t) => /MainRoutine/.test(t) && /rung 0/.test(t)), runRefs.join(" | "));

  const passed = results.filter(Boolean).length;
  console.log(`\nSUMMARY: ${passed}/${results.length} checks passed`);
  process.exitCode = passed === results.length ? 0 : 1;
} catch (err) {
  console.log("ERROR:", err.stack || err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
