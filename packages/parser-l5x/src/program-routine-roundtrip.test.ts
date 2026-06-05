import { describe, expect, it } from "vitest";
import { exportL5X } from "./exportL5X";
import { importL5X } from "./index";

/**
 * Round-trip coverage for *program-scoped* non-ladder routines.
 *
 * The AOI-body fixtures already cover Structured Text / Function Block routines
 * nested under an Add-On Instruction, but those exercise the AOI export path. A
 * plain `<Program>` routine flows through `writeRoutines` -> `writeRoutine` (and
 * `extractRoutines` on the way back in), which had no non-ladder round-trip test.
 * These lock in that an imported ST/FBD program routine survives
 * import -> export -> import with its language and preserved source intact.
 */
describe("exportL5X — program-scoped non-ladder routine round trip", () => {
  it("preserves a Structured Text program routine's source and language", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0">
  <Controller Use="Target" Name="StRoutineCtl" ProcessorType="1756-L85E">
    <Programs>
      <Program Name="MainProgram" MainRoutineName="Calc">
        <Routines>
          <Routine Name="Calc" Type="ST"><STContent>
            <Line Number="0"><![CDATA[Total := A + B;]]></Line>
            <Line Number="1"><![CDATA[Done := Total > 0;]]></Line>
          </STContent></Routine>
        </Routines>
      </Program>
    </Programs>
  </Controller>
</RSLogix5000Content>`;

    // Assert on the FIRST import too: a symmetric drop on both sides would still
    // satisfy a round-trip-stability check, so it would not catch a lost body.
    const { project: p1 } = importL5X(xml);
    const calc1 = p1.controllers[0]!.programs[0]!.routines.find((r) => r.name === "Calc")!;
    expect(calc1.language).toBe("structured-text");
    expect(calc1.structuredText).toBe("Total := A + B;\nDone := Total > 0;");

    const { xml: exported } = exportL5X(p1);
    expect(exported).toContain('<Routine Name="Calc" Type="ST">');
    expect(exported).toContain("Total := A + B;");
    expect(exported).toContain("Done := Total > 0;");

    const { project: p2 } = importL5X(exported);
    const calc2 = p2.controllers[0]!.programs[0]!.routines.find((r) => r.name === "Calc")!;
    expect(calc2.language).toBe("structured-text");
    expect(calc2.structuredText).toBe("Total := A + B;\nDone := Total > 0;");
  });

  it("preserves a Function Block program routine's body and language", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0">
  <Controller Use="Target" Name="FbdRoutineCtl" ProcessorType="1756-L85E">
    <Programs>
      <Program Name="MainProgram" MainRoutineName="Diagram">
        <Routines>
          <Routine Name="Diagram" Type="FBD"><FBDContent SheetSize="Letter - 8.5 x 11 in">
            <Sheet Number="1"><Blocks/></Sheet>
          </FBDContent></Routine>
        </Routines>
      </Program>
    </Programs>
  </Controller>
</RSLogix5000Content>`;

    const { project: p1 } = importL5X(xml);
    const diagram1 = p1.controllers[0]!.programs[0]!.routines.find((r) => r.name === "Diagram")!;
    expect(diagram1.language).toBe("function-block");
    expect(diagram1.sourceText).toContain("<FBDContent");

    const { xml: exported } = exportL5X(p1);
    expect(exported).toContain('<Routine Name="Diagram" Type="FBD">');
    expect(exported).toContain("<FBDContent");

    const { project: p2 } = importL5X(exported);
    const diagram2 = p2.controllers[0]!.programs[0]!.routines.find((r) => r.name === "Diagram")!;
    expect(diagram2.language).toBe("function-block");
    expect(diagram2.sourceText).toContain("<FBDContent");
  });
});
