import { describe, expect, it } from "vitest";
import { createController, createProgram, createProject, createRoutine, type PlcProject } from "@esco/core";
import { exportL5X } from "./exportL5X";
import { importL5X } from "./index";

/** Build a single-program project carrying one Structured Text routine. */
function projectWithST(name: string, source: string | undefined): PlcProject {
  const project = createProject("ST Edge");
  const controller = createController(project.id, "Ctl");
  const program = createProgram(controller.id, "MainProgram");
  const routine = createRoutine(program.id, name, "structured-text");
  routine.structuredText = source;
  program.routines.push(routine);
  controller.programs.push(program);
  project.controllers.push(controller);
  return project;
}

function firstRoutine(project: PlcProject) {
  return project.controllers[0]!.programs[0]!.routines[0]!;
}

describe("L5X export — Structured Text edge cases", () => {
  it("exports an empty ST routine as <STContent/> and re-imports it as ST (never a stub)", () => {
    const { xml, warnings } = exportL5X(projectWithST("EmptyST", ""));
    expect(xml).toContain("<STContent/>");
    expect(warnings.some((w) => w.includes("EmptyST") && w.includes("stub"))).toBe(false);

    const routine = firstRoutine(importL5X(xml).project);
    expect(routine.name).toBe("EmptyST");
    expect(routine.language).toBe("structured-text");
  });

  it("treats an undefined-source ST routine the same as empty (no stub)", () => {
    const { xml, warnings } = exportL5X(projectWithST("BlankST", undefined));
    expect(xml).toContain("<STContent/>");
    expect(warnings.some((w) => w.includes("stub"))).toBe(false);
    expect(firstRoutine(importL5X(xml).project).language).toBe("structured-text");
  });

  it("preserves XML-special characters in ST source through CDATA round-trip", () => {
    const source = "IF A < B AND C > D THEN\nFlag := TRUE;\nEND_IF;";
    const { xml } = exportL5X(projectWithST("CmpST", source));
    const routine = firstRoutine(importL5X(xml).project);
    expect(routine.structuredText).toContain("A < B AND C > D");
    expect(routine.structuredText).toContain("Flag := TRUE;");
  });

  it("keeps a literal ']]>' sequence intact across the CDATA round-trip", () => {
    const source = "X := 1; (* edge ]]> case *)";
    const { xml } = exportL5X(projectWithST("CdataST", source));
    expect(() => importL5X(xml)).not.toThrow();
    expect(firstRoutine(importL5X(xml).project).structuredText).toContain("]]>");
  });

  it("round-trips multi-line ST content line by line", () => {
    const source = "A := 1;\nB := 2;\nC := 3;";
    const { xml } = exportL5X(projectWithST("MultiST", source));
    expect(firstRoutine(importL5X(xml).project).structuredText).toBe(source);
  });
});

describe("L5X import — Structured Text syntax warnings", () => {
  const stRoutineXml = (name: string, lines: string[]): string => `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0">
  <Controller Use="Target" Name="C">
    <Programs>
      <Program Name="P" MainRoutineName="${name}">
        <Routines>
          <Routine Name="${name}" Type="ST">
            <STContent>
${lines.map((l, i) => `              <Line Number="${i}"><![CDATA[${l}]]></Line>`).join("\n")}
            </STContent>
          </Routine>
        </Routines>
      </Program>
    </Programs>
  </Controller>
</RSLogix5000Content>`;

  it("warns about a structurally broken ST routine (missing END_IF) without throwing", () => {
    const xml = stRoutineXml("BadST", ["IF Start THEN", "  X := 1;"]);
    const { warnings } = importL5X(xml);
    expect(warnings.some((w) => w.includes("BadST") && w.includes("syntax") && w.includes("END_IF"))).toBe(true);
  });

  it("does not emit syntax warnings for well-formed ST (only the import capability note)", () => {
    const xml = stRoutineXml("GoodST", ["IF Start THEN", "  X := 1;", "END_IF;"]);
    const { warnings } = importL5X(xml);
    expect(warnings.some((w) => w.includes("GoodST") && w.includes("syntax"))).toBe(false);
    expect(warnings.some((w) => w.includes("GoodST") && w.includes("limited offline execution subset"))).toBe(true);
  });
});
