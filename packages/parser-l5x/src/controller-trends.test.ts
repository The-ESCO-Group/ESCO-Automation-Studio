import { describe, expect, it } from "vitest";
import { exportL5X } from "./exportL5X";
import { importL5X } from "./index";

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0" TargetName="TrendCtl" ContentType="Controller">
  <Controller Use="Target" Name="TrendCtl" ProcessorType="1756-L85E">
    <Trends>
      <Trend Name="PumpTrend" SamplePeriod="10" NumberOfCaptures="2" CaptureSizeType="Samples" CaptureSize="60000" StartTriggerType="No Trigger" StopTriggerType="No Trigger" TrendxVersion="5.2">
        <Description><![CDATA[Pump pressure checkout]]></Description>
        <Template>[208,207,17,224]</Template>
        <Pens>
          <Pen Name="PumpPressure" Color="16#00ff_0000" Visible="true" Width="2" Type="Analog" Style="0" Marker="0" Min="0.0" Max="100.0" EngUnits="psi">
            <Description><![CDATA[Discharge pressure]]></Description>
          </Pen>
          <Pen Name="PumpRunning" Color="16#0000_ff00" Visible="false" Width="1" Type="Digital" Style="1" Marker="4" Min="0" Max="1"/>
        </Pens>
      </Trend>
    </Trends>
    <Tags>
      <Tag Name="PumpPressure" TagType="Base" DataType="REAL"/>
      <Tag Name="PumpRunning" TagType="Base" DataType="BOOL"/>
    </Tags>
    <Programs/>
    <Tasks/>
  </Controller>
</RSLogix5000Content>`;

describe("importL5X/exportL5X - controller trends", () => {
  it("imports controller trend attributes, template payload, and pen definitions", () => {
    const controller = importL5X(XML).project.controllers[0]!;
    const trend = controller.trends?.[0]!;

    expect(trend.name).toBe("PumpTrend");
    expect(trend.description).toBe("Pump pressure checkout");
    expect(trend.attributes?.SamplePeriod).toBe("10");
    expect(trend.attributes?.CaptureSizeType).toBe("Samples");
    expect(trend.attributes?.TrendxVersion).toBe("5.2");
    expect(trend.template).toBe("[208,207,17,224]");
    expect(trend.pens).toHaveLength(2);
    expect(trend.pens[0]).toMatchObject({
      name: "PumpPressure",
      description: "Discharge pressure",
      attributes: {
        Color: "16#00ff_0000",
        Visible: "true",
        Width: "2",
        Type: "Analog",
        EngUnits: "psi",
      },
    });
    expect(trend.pens[1]?.attributes?.Type).toBe("Digital");
  });

  it("round-trips controller trends through review-only L5X export", () => {
    const { project: p1 } = importL5X(XML);
    const { xml, warnings } = exportL5X(p1);
    expect(xml).toContain("<Trends>");
    expect(xml).toContain('Name="PumpTrend"');
    expect(xml).toContain('SamplePeriod="10"');
    expect(xml).toContain('Name="PumpPressure"');
    expect(xml).toContain('EngUnits="psi"');
    expect(warnings.some((warning) => warning.includes("PumpTrend") && warning.includes("offline review"))).toBe(true);

    const trend = importL5X(xml).project.controllers[0]!.trends?.[0]!;
    expect(trend.attributes?.NumberOfCaptures).toBe("2");
    expect(trend.template).toBe("[208,207,17,224]");
    expect(trend.pens.map((pen) => pen.name)).toEqual(["PumpPressure", "PumpRunning"]);
    expect(trend.pens[0]?.attributes?.Color).toBe("16#00ff_0000");
  });
});
