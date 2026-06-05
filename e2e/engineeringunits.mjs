import { chromium } from "playwright-core";
import { URL, dismissToasts, importL5XText } from "./helpers.mjs";

const ENGINEERING_UNITS_L5X = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0" TargetName="EngineeringUnits_E2E" ContentType="Controller">
  <Controller Use="Target" Name="EngineeringUnits_E2E">
    <DataTypes>
      <DataType Name="MOTOR_UDT">
        <Members>
          <Member Name="Speed" DataType="REAL"/>
          <Member Name="Torque" DataType="REAL"/>
        </Members>
      </DataType>
    </DataTypes>
    <Tags>
      <Tag Name="Pressure" TagType="Base" DataType="REAL">
        <EngineeringUnits>
          <EngineeringUnit Operand=""><![CDATA[psi]]></EngineeringUnit>
        </EngineeringUnits>
      </Tag>
      <Tag Name="Motor" TagType="Base" DataType="MOTOR_UDT">
        <EngineeringUnits>
          <EngineeringUnit Operand=".Speed"><![CDATA[RPM]]></EngineeringUnit>
          <EngineeringUnit Operand=".Torque"><![CDATA[N*m]]></EngineeringUnit>
        </EngineeringUnits>
      </Tag>
      <Tag Name="Flows" TagType="Base" DataType="REAL" Dimensions="3">
        <EngineeringUnits>
          <EngineeringUnit Operand="[0]"><![CDATA[L/min]]></EngineeringUnit>
          <EngineeringUnit Operand="[2]"><![CDATA[gal/min]]></EngineeringUnit>
        </EngineeringUnits>
      </Tag>
    </Tags>
    <Programs>
      <Program Name="Mixing" MainRoutineName="Main">
        <Tags>
          <Tag Name="BatchWeight" TagType="Base" DataType="REAL">
            <EngineeringUnits>
              <EngineeringUnit Operand=""><![CDATA[kg]]></EngineeringUnit>
            </EngineeringUnits>
          </Tag>
        </Tags>
        <Routines>
          <Routine Name="Main" Type="RLL">
            <RLLContent><Rung Number="0"><Text><![CDATA[NOP();]]></Text></Rung></RLLContent>
          </Routine>
        </Routines>
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
  await importL5XText(page, ENGINEERING_UNITS_L5X, "engineering-units.L5X");
  await dismissToasts(page);

  await page.locator('.esco-ribbon__tab:has-text("View")').click();
  await page.locator('.esco-ribbon-menu__item:has-text("Model Summary")').click();
  await page.locator('.esco-model__subheading:has-text("Engineering Units")').waitFor({ timeout: 8000 });
  const text = await page.locator(".esco-model").innerText();

  check("Model Summary exposes engineering unit section", /Engineering Units/i.test(text), text);
  check("tag-level engineering unit is visible", /Pressure/i.test(text) && /unit psi/i.test(text), text);
  check("array element engineering units are visible", /Flows\[0\]/i.test(text) && /L\/min/i.test(text) && /Flows\[2\]/i.test(text) && /gal\/min/i.test(text), text);
  check("UDT member engineering units are visible", /Motor\.Speed/i.test(text) && /RPM/i.test(text) && /Motor\.Torque/i.test(text) && /N\*m/i.test(text), text);
  check("program-scoped engineering unit is visible", /Mixing/i.test(text) && /BatchWeight/i.test(text) && /unit kg/i.test(text), text);
  check("known engineering units show local display previews", /Display preview:\s+12\.35 psi/i.test(text), text);
  check("known engineering units show offline conversion previews", /Conversion preview:\s+12\.35 psi -> .*bar \/ .*kPa/i.test(text), text);
  check("unknown engineering units stay preserved for review", /does not recognize "N\*m"/i.test(text), text);
  check(
    "controller-facing engineering unit boundaries stay blocked",
    /offline conversion path/i.test(text) &&
      /online tag-property edits/i.test(text) &&
      /controller download/i.test(text) &&
      /controller communication remain blocked/i.test(text),
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
