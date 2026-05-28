import { chromium } from "playwright-core";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { writeFileSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));
const URL = "http://localhost:5173/";
const fixturePath = join(here, "io-fixture.L5X");

const FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0" TargetName="IoCtl" ContentType="Controller">
  <Controller Use="Target" Name="IoCtl">
    <Modules>
      <Module Name="Local" CatalogNumber="1756-L83E" Slot="0"/>
      <Module Name="DI_01" CatalogNumber="1756-IB16" Slot="1" ParentModule="Local"><Description><![CDATA[Field inputs]]></Description></Module>
      <Module Name="DO_01" CatalogNumber="1756-OB16" Slot="2" ParentModule="Local"/>
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
const check = (l, c, d = "") => { results.push(!!c); console.log(`${c ? "PASS" : "FAIL"}  ${l}${d ? "  — " + d : ""}`); };

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
try {
  await page.goto(URL, { waitUntil: "networkidle" });
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.locator('.esco-titlebar__actions button:has-text("Import L5X")').click(),
  ]);
  await chooser.setFiles(fixturePath);
  await page.locator('.esco-titlebar__project:has-text("IoCtl")').waitFor({ timeout: 8000 });

  // Click the I/O Configuration group node -> I/O detail view.
  await page.locator('.esco-tree__group--button:has-text("I/O Modules")').click();
  await page.locator(".esco-detail").waitFor({ timeout: 5000 });
  const detail = await page.locator(".esco-detail").innerText();

  check("I/O detail shows the offline-only warning", /imported metadata only\. No controller communication/i.test(detail));
  check("I/O detail lists modules by slot", /Local/.test(detail) && /DI_01/.test(detail) && /DO_01/.test(detail));
  check("I/O detail shows catalog + parent + description", /1756-IB16/.test(detail) && /Field inputs/.test(detail));

  // Clicking a module opens the same view (selects that module row).
  await page.locator('.esco-tree__node--module:has-text("DO_01")').click();
  await page.locator(".esco-detail").waitFor({ timeout: 5000 });
  check("clicking a module opens the I/O view", /I\/O Configuration/.test(await page.locator(".esco-detail").innerText()));

  const passed = results.filter(Boolean).length;
  console.log(`\nSUMMARY: ${passed}/${results.length} checks passed`);
  process.exitCode = passed === results.length ? 0 : 1;
} catch (err) {
  console.log("ERROR:", err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
