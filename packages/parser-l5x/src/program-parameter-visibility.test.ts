import { describe, expect, it } from "vitest";
import { exportL5X } from "./exportL5X";
import { importL5X } from "./index";

// A program parameter carries both Required and Visible flags. They are
// independent: here "Setpoint" is required but hidden from the parameter face,
// while "Status" is visible but not required.
const XML = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0">
  <Controller Use="Target" Name="ProgVisCtl" ProcessorType="1756-L85E">
    <Programs>
      <Program Name="MainProgram">
        <Parameters>
          <Parameter Name="Setpoint" DataType="REAL" Usage="Input" Required="true" Visible="false"/>
          <Parameter Name="Status" DataType="DINT" Usage="Output" Required="false" Visible="true"/>
        </Parameters>
        <Routines>
          <Routine Name="MainRoutine" Type="RLL"/>
        </Routines>
      </Program>
    </Programs>
  </Controller>
</RSLogix5000Content>`;

function paramsOf(project: ReturnType<typeof importL5X>["project"]) {
  const params = project.controllers[0]!.programs[0]!.parameters!;
  return {
    setpoint: params.find((p) => p.name === "Setpoint")!,
    status: params.find((p) => p.name === "Status")!,
  };
}

describe("importL5X — program parameter face visibility", () => {
  it("imports the Visible flag independently of Required", () => {
    const { setpoint, status } = paramsOf(importL5X(XML).project);
    expect(setpoint.required).toBe(true);
    expect(setpoint.visible).toBeUndefined();
    expect(status.required).toBeUndefined();
    expect(status.visible).toBe(true);
  });

  it("round-trips the Visible flag through export", () => {
    const { xml } = exportL5X(importL5X(XML).project);
    const { setpoint, status } = paramsOf(importL5X(xml).project);
    expect(setpoint.required).toBe(true);
    expect(setpoint.visible).toBeUndefined();
    expect(status.required).toBeUndefined();
    expect(status.visible).toBe(true);
  });
});
