import { describe, expect, it } from "vitest";
import { createController, createProject, createTag, type PlcProject, type Tag } from "@esco/core";
import { createDefaultEngine } from "./index";

/** A controller tag with an optional alias target. */
function tag(controllerId: string, name: string, aliasFor?: string): Tag {
  return { ...createTag(controllerId, name, "DINT"), aliasFor };
}

/** Build a project whose single controller carries the given controller tags. */
function project(make: (controllerId: string) => Tag[]): PlcProject {
  const proj = createProject("Cell");
  const controller = createController(proj.id, "Ctrl");
  controller.controllerTags.push(...make(controller.id));
  proj.controllers.push(controller);
  return proj;
}

const aliasFindings = (proj: PlcProject) =>
  createDefaultEngine().run(proj).filter((f) => f.ruleId === "circular-alias");

describe("circular-alias", () => {
  it("flags a tag aliased to itself", () => {
    const findings = aliasFindings(project((id) => [tag(id, "A", "A")]));
    expect(findings).toHaveLength(1);
    expect(findings[0]!.severity).toBe("error");
    expect(findings[0]!.message).toContain("A → A");
    expect(findings[0]!.target).toBe("Ctrl");
  });

  it("flags an indirect two-tag cycle once", () => {
    const findings = aliasFindings(project((id) => [tag(id, "A", "B"), tag(id, "B", "A")]));
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toContain("circular alias chain");
    // The cycle reads back to its start regardless of which node was walked first.
    expect(findings[0]!.message).toMatch(/A → B → A|B → A → B/);
  });

  it("flags a three-tag cycle through member/element alias targets", () => {
    const findings = aliasFindings(
      project((id) => [tag(id, "A", "B.Run"), tag(id, "B", "C[2]"), tag(id, "C", "A")]),
    );
    expect(findings).toHaveLength(1);
  });

  it("reports only the cycle, not a tail leading into it", () => {
    // Tail T -> A, then A -> B -> A is the actual cycle.
    const findings = aliasFindings(
      project((id) => [tag(id, "T", "A"), tag(id, "A", "B"), tag(id, "B", "A")]),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).not.toContain("T");
    expect(findings[0]!.message).toMatch(/A → B → A|B → A → B/);
  });

  it("does not flag an acyclic alias chain ending at a base tag", () => {
    const findings = aliasFindings(
      project((id) => [tag(id, "A", "B"), tag(id, "B", "C"), tag(id, "C")]),
    );
    expect(findings).toHaveLength(0);
  });
});
