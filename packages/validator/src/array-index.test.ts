import { describe, expect, it } from "vitest";
import { createController, createProgram, createProject, createRoutine, createTag } from "@esco/core";
import { createLadderRoutine, createNode, createRung, tagOperand } from "@esco/ladder";
import { createDefaultEngine } from "./index";

type TestTag = { name: string; type: string; dimension?: number; dimensions?: number[] };

/**
 * A project whose Main routine references `path` via an XIC, with `tag` declared
 * at controller scope (optionally with an array `dimension`).
 */
function projectIndexing(path: string, tag: TestTag, extraTags: TestTag[] = []) {
  const project = createProject("ArrCtl");
  const controller = createController(project.id, "ArrCtl");
  for (const candidate of [tag, ...extraTags]) {
    controller.controllerTags.push(
      createTag(controller.id, candidate.name, candidate.type, {
        ...(candidate.dimension ? { dimension: candidate.dimension } : {}),
        ...(candidate.dimensions ? { dimensions: candidate.dimensions } : {}),
      }),
    );
  }
  const program = createProgram(controller.id, "MainProgram");
  const routine = createRoutine(program.id, "Main", "ladder");
  program.mainRoutineId = routine.id;
  const ladder = createLadderRoutine();
  ladder.rungs.push(createRung(ladder.id, 0, [createNode("XIC", [tagOperand("tag", path)])]));
  routine.ladder = ladder;
  program.routines.push(routine);
  controller.programs.push(program);
  project.controllers.push(controller);
  return project;
}

const findings = (project: ReturnType<typeof projectIndexing>) => createDefaultEngine().run(project);

describe("indexing a non-array tag is rejected (Studio 5000 offline parity)", () => {
  it("flags a subscript on a scalar tag", () => {
    const scalar = findings(projectIndexing("Flags[2]", { name: "Flags", type: "BOOL" }))
      .filter((f) => f.ruleId === "array-index-on-scalar");
    expect(scalar).toHaveLength(1);
    expect(scalar[0]!.severity).toBe("error");
    expect(scalar[0]!.message).toContain('"Flags"');
    expect(scalar[0]!.message).toContain("Flags[2]");
  });

  it("does not flag an in-range subscript on a declared array", () => {
    const result = findings(projectIndexing("Buffer[2]", { name: "Buffer", type: "DINT", dimension: 4 }));
    expect(result.some((f) => f.ruleId === "array-index-on-scalar")).toBe(false);
    expect(result.some((f) => f.ruleId === "array-index-out-of-range")).toBe(false);
    expect(result.some((f) => f.ruleId === "undefined-tag")).toBe(false);
  });

  it("flags an out-of-range subscript on a declared array (existing rule, unaffected)", () => {
    const result = findings(projectIndexing("Buffer[4]", { name: "Buffer", type: "DINT", dimension: 4 }));
    expect(result.some((f) => f.ruleId === "array-index-out-of-range")).toBe(true);
    expect(result.some((f) => f.ruleId === "array-index-on-scalar")).toBe(false);
  });

  it("flags a negative constant subscript on a declared array", () => {
    const result = findings(projectIndexing("Buffer[-1]", { name: "Buffer", type: "DINT", dimension: 4 }))
      .filter((f) => f.ruleId === "array-index-out-of-range");
    expect(result).toHaveLength(1);
    expect(result[0]!.severity).toBe("error");
    expect(result[0]!.message).toContain("-1");
    expect(result[0]!.message).toContain("negative");
  });

  it("flags a negative constant subscript on one dimension of a multi-dimensional array", () => {
    const result = findings(projectIndexing("Matrix[1,-2]", { name: "Matrix", type: "DINT", dimensions: [2, 3] }))
      .filter((f) => f.ruleId === "array-index-out-of-range");
    expect(result).toHaveLength(1);
    expect(result[0]!.message).toContain("-2");
  });

  it("does not flag a subscript expression that could evaluate negative at runtime", () => {
    // Index-1 is a bounded expression, not a constant; runtime range faults are
    // not an offline verify error, so only its referenced tags are checked.
    const result = findings(projectIndexing("Flags[Index-1]", { name: "Flags", type: "BOOL", dimension: 4 }, [
      { name: "Index", type: "DINT" },
    ]));
    expect(result.some((f) => f.ruleId === "array-index-out-of-range")).toBe(false);
    expect(result.some((f) => f.ruleId === "undefined-tag")).toBe(false);
  });

  it("does not flag a plain scalar reference with no subscript", () => {
    const result = findings(projectIndexing("Flags", { name: "Flags", type: "BOOL" }));
    expect(result.some((f) => f.ruleId === "array-index-on-scalar")).toBe(false);
  });

  it("validates multi-dimensional array subscripts per dimension", () => {
    const good = findings(projectIndexing("Matrix[1,2]", { name: "Matrix", type: "DINT", dimensions: [2, 3] }));
    expect(good.some((f) => f.ruleId === "array-index-out-of-range")).toBe(false);
    expect(good.some((f) => f.ruleId === "array-dimension-mismatch")).toBe(false);

    const bad = findings(projectIndexing("Matrix[1,3]", { name: "Matrix", type: "DINT", dimensions: [2, 3] }));
    expect(bad.some((f) => f.ruleId === "array-index-out-of-range")).toBe(true);
  });

  it("flags the wrong number of subscripts on a multi-dimensional array", () => {
    const result = findings(projectIndexing("Matrix[1]", { name: "Matrix", type: "DINT", dimensions: [2, 3] }));
    expect(result.some((f) => f.ruleId === "array-dimension-mismatch")).toBe(true);
  });

  it("accepts an integer tag as an indirect subscript", () => {
    const result = findings(projectIndexing("Flags[Index]", { name: "Flags", type: "BOOL", dimension: 4 }, [
      { name: "Index", type: "DINT" },
    ]));
    expect(result.some((f) => f.ruleId === "undefined-tag")).toBe(false);
    expect(result.some((f) => f.ruleId === "array-index-type-mismatch")).toBe(false);
    expect(result.some((f) => f.ruleId === "array-dimension-mismatch")).toBe(false);
    expect(result.some((f) => f.ruleId === "array-index-on-scalar")).toBe(false);
  });

  it("validates multi-dimensional indirect subscripts by dimension count", () => {
    const result = findings(projectIndexing("Matrix[Row,Col]", { name: "Matrix", type: "DINT", dimensions: [2, 3] }, [
      { name: "Row", type: "DINT" },
      { name: "Col", type: "DINT" },
    ]));
    expect(result.some((f) => f.ruleId === "undefined-tag")).toBe(false);
    expect(result.some((f) => f.ruleId === "array-index-type-mismatch")).toBe(false);
    expect(result.some((f) => f.ruleId === "array-dimension-mismatch")).toBe(false);
  });

  it("accepts a bounded subscript expression that references integer tags", () => {
    const result = findings(projectIndexing("Flags[Index+1]", { name: "Flags", type: "BOOL", dimension: 4 }, [
      { name: "Index", type: "DINT" },
    ]));
    expect(result.some((f) => f.ruleId === "undefined-tag")).toBe(false);
    expect(result.some((f) => f.ruleId === "array-index-type-mismatch")).toBe(false);
  });

  it("accepts an integer member path as an indirect subscript", () => {
    const project = projectIndexing("Flags[Index.POS]", { name: "Flags", type: "BOOL", dimension: 4 }, [
      { name: "Index", type: "IndexUdt" },
    ]);
    project.controllers[0]!.dataTypes.push({
      id: "dt_index",
      name: "IndexUdt",
      members: [{ name: "POS", dataType: "DINT" }],
    });
    const result = findings(project);
    expect(result.some((f) => f.ruleId === "unknown-member")).toBe(false);
    expect(result.some((f) => f.ruleId === "array-index-type-mismatch")).toBe(false);
  });

  it("flags an unknown indirect subscript tag", () => {
    const result = findings(projectIndexing("Flags[MissingIndex]", { name: "Flags", type: "BOOL", dimension: 4 }));
    expect(result.some((f) => f.ruleId === "undefined-tag")).toBe(true);
  });

  it("flags a non-integer indirect subscript tag", () => {
    const result = findings(projectIndexing("Flags[Name]", { name: "Flags", type: "BOOL", dimension: 4 }, [
      { name: "Name", type: "STRING" },
    ]));
    expect(result.some((f) => f.ruleId === "array-index-type-mismatch")).toBe(true);
  });

  it("flags non-integer tags referenced inside subscript expressions", () => {
    const result = findings(projectIndexing("Flags[Name+1]", { name: "Flags", type: "BOOL", dimension: 4 }, [
      { name: "Name", type: "STRING" },
    ]));
    expect(result.some((f) => f.ruleId === "array-index-type-mismatch")).toBe(true);
  });
});
