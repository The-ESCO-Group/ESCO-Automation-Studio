import { describe, expect, it } from "vitest";
import { exportL5X } from "./exportL5X";
import { importL5X } from "./index";

// Studio 5000 lets an AOI Input parameter be marked read-only constant
// (Constant="true"), exactly like a program parameter or a controller/program
// tag. The simulator never enforces constness, but it is an authored setting an
// engineer expects to keep, so it must survive export -> import rather than
// being silently dropped (mirrors program-parameter / tag Constant handling).
// Here "Setpoint" is a constant input while "Feedback" is an ordinary input.
const XML = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0">
  <Controller Use="Target" Name="AoiConstCtl" ProcessorType="1756-L85E">
    <AddOnInstructionDefinitions>
      <AddOnInstructionDefinition Name="LoopAOI" Revision="1.0">
        <Parameters>
          <Parameter Name="Setpoint" DataType="REAL" Usage="Input" Required="true" Constant="true"/>
          <Parameter Name="Feedback" DataType="REAL" Usage="Input" Required="true"/>
        </Parameters>
      </AddOnInstructionDefinition>
    </AddOnInstructionDefinitions>
  </Controller>
</RSLogix5000Content>`;

function paramsOf(project: ReturnType<typeof importL5X>["project"]) {
  const params = project.controllers[0]!.addOnInstructions[0]!.parameters;
  return {
    setpoint: params.find((p) => p.name === "Setpoint")!,
    feedback: params.find((p) => p.name === "Feedback")!,
  };
}

describe("importL5X — AOI parameter Constant flag", () => {
  it("imports the Constant flag on an Input parameter", () => {
    const { setpoint, feedback } = paramsOf(importL5X(XML).project);
    expect(setpoint.constant).toBe(true);
    expect(feedback.constant).toBeUndefined();
  });

  it("round-trips the Constant flag through export -> import", () => {
    const { xml } = exportL5X(importL5X(XML).project);
    const { setpoint, feedback } = paramsOf(importL5X(xml).project);
    expect(setpoint.constant).toBe(true);
    expect(feedback.constant).toBeUndefined();
  });
});
