import { chromium } from "playwright-core";
import { URL, dismissToasts, importL5XText } from "./helpers.mjs";

const MODULE_CONNECTIONS_L5X = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0" TargetName="ModuleConnections_E2E" ContentType="Controller">
  <Controller Use="Target" Name="ModuleConnections_E2E">
    <Modules>
      <Module Name="Local" CatalogNumber="1756-L83E" Slot="0"/>
      <Module Name="DI_01" CatalogNumber="1756-IB16" Slot="1" ParentModule="Local">
        <Communications>
          <Connections>
            <Connection Name="Data" RPI="20000" Type="Input" Priority="Scheduled" Unicast="false" EventID="0" InputConnectionType="Multicast" InputProductionTrigger="Cyclic"/>
            <Connection Name="EventIn" RPI="5000" Type="Input" Priority="High" Unicast="true" EventID="7" ProgrammaticallySendEventTrigger="true"/>
          </Connections>
        </Communications>
      </Module>
      <Module Name="DO_01" CatalogNumber="1756-OB16" Slot="2" ParentModule="Local">
        <Communications>
          <Connections>
            <Connection Name="Output" RPI="10000" Type="Output" Priority="High" Unicast="true" OutputRedundantOwner="false"/>
          </Connections>
        </Communications>
      </Module>
    </Modules>
    <Tags><Tag Name="Start" TagType="Base" DataType="BOOL"/></Tags>
    <Programs>
      <Program Name="MainProgram" MainRoutineName="Main">
        <Routines><Routine Name="Main" Type="RLL"><RLLContent>
          <Rung Number="0"><Text><![CDATA[XIC(Start)OTE(Start);]]></Text></Rung>
        </RLLContent></Routine></Routines>
      </Program>
    </Programs>
  </Controller>
</RSLogix5000Content>`;

const results = [];
const check = (label, cond, detail = "") => {
  results.push(!!cond);
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${detail ? "  - " + String(detail).replace(/\s+/g, " ").slice(0, 140) : ""}`);
};

const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
const page = await context.newPage();
page.on("pageerror", (error) => console.log("PAGEERROR:", error.message));

try {
  await page.goto(URL, { waitUntil: "networkidle" });
  await importL5XText(page, MODULE_CONNECTIONS_L5X, "module-connections.L5X");
  await dismissToasts(page);

  await page.locator('.esco-ribbon__tab:has-text("View")').click();
  await page.locator('.esco-ribbon-menu__item:has-text("Model Summary")').click();
  await page.locator('.esco-model__subheading:has-text("Module Connection Metadata")').waitFor({ timeout: 8000 });
  const text = await page.locator(".esco-model").innerText();

  check("Model Summary exposes module connection metadata section", /Module Connection Metadata/i.test(text), text);
  check("module connection review lists imported connection rows", /DI_01/i.test(text) && /Data: Input, 20 ms/i.test(text) && /EventIn: Input, 5 ms/i.test(text), text);
  check("module connection review lists output connection metadata", /DO_01/i.test(text) && /Output: Output, 10 ms/i.test(text), text);
  check("module connection review summarizes priority/event/unicast metadata", /3 module connections?/i.test(text) && /priority/i.test(text) && /event/i.test(text) && /unicast/i.test(text) && /multicast/i.test(text), text);
  check(
    "module connection review keeps offline boundaries visible",
    /RPI scheduling/i.test(text) &&
      /event dispatch/i.test(text) &&
      /multicast enforcement/i.test(text) &&
      /controller communication/i.test(text) &&
      /connection major faults/i.test(text),
    text,
  );

  const passed = results.filter(Boolean).length;
  console.log(`\nSUMMARY: ${passed}/${results.length} checks passed`);
  process.exitCode = passed === results.length ? 0 : 1;
} catch (error) {
  console.log("ERROR:", error.message);
  process.exitCode = 1;
} finally {
  await context.close();
  await browser.close();
}
