import { describe, expect, it } from "vitest";
import {
  createController,
  createProject,
  createRoutine,
  type AddOnInstruction,
  type PlcProject,
  type Routine,
} from "@esco/core";
import { createLadderRoutine, createNode, createRung } from "@esco/ladder";
import { createDefaultEngine } from "./index";

/** A ladder routine whose rung calls each named AOI (a call node carries the AOI name as its type). */
function callRoutine(aoiId: string, calls: string[]): Routine {
  const routine = createRoutine(aoiId, "Logic", "ladder");
  const ladder = createLadderRoutine();
  ladder.rungs.push(createRung(routine.id, 0, calls.map((name) => createNode(name))));
  routine.ladder = ladder;
  return routine;
}

function aoi(name: string, calls: string[], opts: { protected?: boolean } = {}): AddOnInstruction {
  return {
    id: `aoi-${name}`,
    name,
    parameters: [],
    localTags: [],
    routineNames: [],
    protected: opts.protected,
    routines: calls.length ? [callRoutine(`aoi-${name}`, calls)] : [],
  };
}

function projectWithAois(...aois: AddOnInstruction[]): PlcProject {
  const project = createProject("Cell");
  const controller = createController(project.id, "Ctrl");
  controller.addOnInstructions.push(...aois);
  project.controllers.push(controller);
  return project;
}

const findings = (project: PlcProject) =>
  createDefaultEngine()
    .run(project)
    .filter((f) => f.ruleId === "circular-aoi-reference");

describe("circular-aoi-reference", () => {
  it("does not flag an acyclic AOI call graph", () => {
    expect(findings(projectWithAois(aoi("A", ["B"]), aoi("B", [])))).toHaveLength(0);
  });

  it("flags an AOI that calls itself directly", () => {
    const result = findings(projectWithAois(aoi("Foo", ["Foo"])));
    expect(result).toHaveLength(1);
    expect(result[0].severity).toBe("error");
    expect(result[0].message).toContain("calls itself");
    expect(result[0].target).toBe("Ctrl/Foo");
  });

  it("flags every AOI on an indirect cycle and names the path", () => {
    const result = findings(projectWithAois(aoi("A", ["B"]), aoi("B", ["A"])));
    expect(result).toHaveLength(2);
    expect(result.every((f) => f.message.includes("circular Add-On Instruction reference"))).toBe(true);
    expect(result.some((f) => f.message.includes("A → B → A") || f.message.includes("B → A → B"))).toBe(true);
  });

  it("resolves call targets case-insensitively", () => {
    const result = findings(projectWithAois(aoi("Pump", ["PUMP"])));
    expect(result).toHaveLength(1);
    expect(result[0].message).toContain("calls itself");
  });

  it("treats a protected AOI as opaque, so a cycle routed through it is not detected", () => {
    // B is source-protected: it exposes no inspectable logic, so its call back to
    // A is invisible and the A -> B -> A cycle cannot be anchored.
    const result = findings(projectWithAois(aoi("A", ["B"]), aoi("B", ["A"], { protected: true })));
    expect(result).toHaveLength(0);
  });
});
