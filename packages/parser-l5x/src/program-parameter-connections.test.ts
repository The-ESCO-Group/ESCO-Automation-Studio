import { describe, expect, it } from "vitest";
import { exportL5X } from "./exportL5X";
import { importL5X } from "./index";

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0" TargetName="ParamCtl" ContentType="Controller">
  <Controller Use="Target" Name="ParamCtl" ProcessorType="1756-L85E">
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
    <Tasks/>
    <ParameterConnections>
      <ParameterConnection EndPoint1="ProducerProgram.ProducedSpeed" EndPoint2="ConsumerProgram.SpeedCommand"/>
    </ParameterConnections>
  </Controller>
</RSLogix5000Content>`;

describe("importL5X/exportL5X - program parameter connections", () => {
  it("imports ParameterConnection endpoints", () => {
    const controller = importL5X(XML).project.controllers[0]!;

    expect(controller.parameterConnections).toHaveLength(1);
    expect(controller.parameterConnections?.[0]).toMatchObject({
      endPoint1: "ProducerProgram.ProducedSpeed",
      endPoint2: "ConsumerProgram.SpeedCommand",
    });
  });

  it("round-trips ParameterConnections through review-only L5X export", () => {
    const { project: p1 } = importL5X(XML);
    const { xml, warnings } = exportL5X(p1);

    expect(xml).toContain("<ParameterConnections>");
    expect(xml).toContain("<ParameterConnection");
    expect(xml).toContain('EndPoint1="ProducerProgram.ProducedSpeed"');
    expect(xml).toContain('EndPoint2="ConsumerProgram.SpeedCommand"');
    expect(warnings.some((warning) => warning.includes("Program parameter connections"))).toBe(true);

    const connection = importL5X(xml).project.controllers[0]!.parameterConnections?.[0]!;
    expect(connection.endPoint1).toBe("ProducerProgram.ProducedSpeed");
    expect(connection.endPoint2).toBe("ConsumerProgram.SpeedCommand");
  });
});
