import { chromium } from "playwright-core";
import { URL, dismissToasts, importL5XText } from "./helpers.mjs";

const CONNECTION_METADATA_L5X = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0" TargetName="ConnectionMetadata_E2E" ContentType="Controller">
  <Controller Use="Target" Name="ConnectionMetadata_E2E" ProcessorType="1756-L85E" CanUseRPIFromProducer="true">
    <Tags>
      <Tag Name="ProdSpeed" TagType="Produced" DataType="DINT" ExternalAccess="Read/Write">
        <ProduceInfo ProduceCount="3" UnicastPermitted="true" ProgrammaticallySendEventTrigger="false"/>
      </Tag>
      <Tag Name="ConsSpeed" TagType="Consumed" DataType="DINT" ExternalAccess="Read Only">
        <ConsumeInfo Producer="RemoteCtl" RemoteTag="ProdSpeed" RemoteInstance="0" RPI="20" Unicast="true"/>
      </Tag>
      <Tag Name="Start" TagType="Base" DataType="BOOL"/>
    </Tags>
    <Programs>
      <Program Name="ProducerProgram">
        <Parameters>
          <Parameter Name="ProducedSpeed" DataType="DINT" Usage="Output" ExternalAccess="Read Only"/>
        </Parameters>
        <Routines/>
      </Program>
      <Program Name="ConsumerProgram">
        <Parameters>
          <Parameter Name="SpeedCommand" DataType="DINT" Usage="Input" Required="true"/>
        </Parameters>
        <Routines/>
      </Program>
    </Programs>
    <ParameterConnections>
      <ParameterConnection EndPoint1="ProducerProgram.ProducedSpeed" EndPoint2="ConsumerProgram.SpeedCommand"/>
    </ParameterConnections>
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
  await importL5XText(page, CONNECTION_METADATA_L5X, "connection-metadata.L5X");
  await dismissToasts(page);

  await page.locator('.esco-ribbon__tab:has-text("View")').click();
  await page.locator('.esco-ribbon-menu__item:has-text("Model Summary")').click();
  await page.locator('.esco-model__subheading:has-text("Produced / Consumed Tag Connections")').waitFor({ timeout: 8000 });
  await page.locator('.esco-model__subheading:has-text("Program Parameter Connections")').waitFor({ timeout: 8000 });
  const text = await page.locator(".esco-model").innerText();

  check("Model Summary exposes produced/consumed tag connection section", /Produced \/ Consumed Tag Connections/i.test(text), text);
  check("produced tag metadata is visible", /ProdSpeed/i.test(text) && /3 consumers?/i.test(text) && /produced unicast: permitted/i.test(text), text);
  check("consumed tag producer, remote tag, RPI, and unicast metadata are visible", /ConsSpeed/i.test(text) && /RemoteCtl\/ProdSpeed/i.test(text) && /RPI 20 ms/i.test(text) && /unicast/i.test(text), text);
  check("controller RPI-source metadata is visible", /CanUseRPIFromProducer=true/i.test(text) && /effective=producer/i.test(text), text);
  check("program parameter connection row is visible", /Program Parameter Connections/i.test(text) && /ProducerProgram\.ProducedSpeed -> ConsumerProgram\.SpeedCommand/i.test(text) && /DINT Output to DINT Input/i.test(text), text);
  check(
    "connection metadata boundaries stay offline-only",
    /Produced\/consumed tag connections/i.test(text) &&
      /remote controller browse/i.test(text) &&
      /RPI negotiation/i.test(text) &&
      /RPI scheduling/i.test(text) &&
      /Runtime parameter transfer/i.test(text) &&
      /controller-verified binding/i.test(text) &&
      /controller communication/i.test(text),
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
