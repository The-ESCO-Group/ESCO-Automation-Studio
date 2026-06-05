import { describe, expect, it } from "vitest";
import { exportL5X } from "./exportL5X";
import { importL5X } from "./index";

// Studio 5000 lets engineers group programs under organizational folders. Such a
// folder is itself a <Program> carrying UseAsFolder="true" and no main routine.
// It is purely organizational metadata (never scheduled, never executed here),
// but it must survive export -> import so the folder designation is not silently
// turned into an ordinary executable program when an engineer round-trips a
// project.
const XML = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0">
  <Controller Use="Target" Name="FolderCtl" ProcessorType="1756-L8E" MajorRev="33" MinorRev="11">
    <Programs>
      <Program Name="MachineFolder" UseAsFolder="true"/>
      <Program Name="RealProg" UseAsFolder="false" MainRoutineName="MainRoutine">
        <Routines>
          <Routine Name="MainRoutine" Type="RLL"><RLLContent/></Routine>
        </Routines>
      </Program>
    </Programs>
  </Controller>
</RSLogix5000Content>`;

describe("importL5X — program UseAsFolder", () => {
  const programsOf = (xml: string) => {
    const controller = importL5X(xml).project.controllers[0]!;
    return (name: string) => controller.programs.find((p) => p.name === name)!;
  };

  it("imports UseAsFolder as the useAsFolder flag", () => {
    const program = programsOf(XML);
    expect(program("MachineFolder").useAsFolder).toBe(true);
    // UseAsFolder="false" must not set the flag.
    expect(program("RealProg").useAsFolder).toBeUndefined();
  });

  it("round-trips the folder designation through export -> import", () => {
    const exported = exportL5X(importL5X(XML).project).xml;
    expect(exported).toContain('UseAsFolder="true"');
    const program = programsOf(exported);
    expect(program("MachineFolder").useAsFolder).toBe(true);
    expect(program("RealProg").useAsFolder).toBeUndefined();
  });
});
