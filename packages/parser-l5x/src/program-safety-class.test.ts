import { describe, expect, it } from "vitest";
import { exportL5X } from "./exportL5X";
import { importL5X } from "./index";

// Safety controllers partition not only tags but whole programs into Safety /
// Standard via the `Class` attribute on <Program>. Like the tag partition, it is
// display/organisational metadata (never used here to drive a safety task), but
// it must survive export -> import so the partition is not silently lost when an
// engineer round-trips a GuardLogix project.
const XML = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0">
  <Controller Use="Target" Name="SafetyCtl" ProcessorType="1756-L8SP" MajorRev="33" MinorRev="11">
    <Programs>
      <Program Name="SafetyTaskProg" Class="Safety">
        <Routines>
          <Routine Name="MainRoutine" Type="RLL"><RLLContent/></Routine>
        </Routines>
      </Program>
      <Program Name="StandardProg" Class="Standard">
        <Routines>
          <Routine Name="MainRoutine" Type="RLL"><RLLContent/></Routine>
        </Routines>
      </Program>
      <Program Name="PlainProg">
        <Routines>
          <Routine Name="MainRoutine" Type="RLL"><RLLContent/></Routine>
        </Routines>
      </Program>
    </Programs>
  </Controller>
</RSLogix5000Content>`;

describe("importL5X — program safety class", () => {
  const programsOf = (xml: string) => {
    const controller = importL5X(xml).project.controllers[0]!;
    return (name: string) => controller.programs.find((p) => p.name === name)!;
  };

  it("imports the Program Class attribute as safetyClass", () => {
    const program = programsOf(XML);
    expect(program("SafetyTaskProg").safetyClass).toBe("Safety");
    expect(program("StandardProg").safetyClass).toBe("Standard");
    expect(program("PlainProg").safetyClass).toBeUndefined();
  });

  it("round-trips the program safety partition through export -> import", () => {
    const { xml } = exportL5X(importL5X(XML).project);
    const program = programsOf(xml);
    expect(program("SafetyTaskProg").safetyClass).toBe("Safety");
    expect(program("StandardProg").safetyClass).toBe("Standard");
    expect(program("PlainProg").safetyClass).toBeUndefined();
  });
});
