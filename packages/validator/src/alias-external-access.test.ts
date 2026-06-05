import { describe, expect, it } from "vitest";
import {
  createController,
  createProgram,
  createProject,
  createTag,
  type ExternalAccess,
  type PlcProject,
  type Tag,
} from "@esco/core";
import { createDefaultEngine } from "./index";

/** A controller tag with optional alias target and explicit external access. */
function tag(controllerId: string, name: string, aliasFor?: string, externalAccess?: ExternalAccess): Tag {
  return { ...createTag(controllerId, name, "DINT", { externalAccess }), aliasFor };
}

/** Build a project whose single controller carries the given controller tags. */
function project(make: (controllerId: string) => Tag[]): PlcProject {
  const proj = createProject("Cell");
  const controller = createController(proj.id, "Ctrl");
  controller.controllerTags.push(...make(controller.id));
  proj.controllers.push(controller);
  return proj;
}

const accessFindings = (proj: PlcProject) =>
  createDefaultEngine().run(proj).filter((f) => f.ruleId === "alias-external-access");

describe("alias-external-access", () => {
  it("flags an alias whose access is wider than its base tag", () => {
    const findings = accessFindings(
      project((id) => [tag(id, "Base", undefined, "read-only"), tag(id, "Alias", "Base", "read-write")]),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.severity).toBe("error");
    expect(findings[0]!.message).toContain("Read/Write");
    expect(findings[0]!.message).toContain("Read Only");
    expect(findings[0]!.target).toBe("Ctrl/Alias");
  });

  it("flags a Read Only alias over a None base tag", () => {
    const findings = accessFindings(
      project((id) => [tag(id, "Base", undefined, "none"), tag(id, "Alias", "Base", "read-only")]),
    );
    expect(findings).toHaveLength(1);
  });

  it("does not flag an alias with access equal to or narrower than its base", () => {
    const equal = accessFindings(
      project((id) => [tag(id, "Base", undefined, "read-write"), tag(id, "Alias", "Base", "read-write")]),
    );
    expect(equal).toHaveLength(0);
    const narrower = accessFindings(
      project((id) => [tag(id, "Base", undefined, "read-write"), tag(id, "Alias", "Base", "read-only")]),
    );
    expect(narrower).toHaveLength(0);
  });

  it("does not flag when alias or base leaves external access unset (inherit)", () => {
    const aliasUnset = accessFindings(
      project((id) => [tag(id, "Base", undefined, "read-only"), tag(id, "Alias", "Base")]),
    );
    expect(aliasUnset).toHaveLength(0);
    const baseUnset = accessFindings(
      project((id) => [tag(id, "Base"), tag(id, "Alias", "Base", "read-write")]),
    );
    expect(baseUnset).toHaveLength(0);
  });

  it("resolves a member/element alias target to its base tag", () => {
    const findings = accessFindings(
      project((id) => [tag(id, "Base", undefined, "read-only"), tag(id, "Alias", "Base.Run", "read-write")]),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toContain('base tag "Base"');
  });

  it("flags a program-scoped alias resolving its base in program scope first", () => {
    const proj = createProject("Cell");
    const controller = createController(proj.id, "Ctrl");
    // A controller tag of the same name must not shadow the program-scope base.
    controller.controllerTags.push(tag(controller.id, "Base", undefined, "read-write"));
    const program = createProgram(controller.id, "Main");
    program.programTags.push(
      tag(controller.id, "Base", undefined, "read-only"),
      tag(controller.id, "Alias", "Base", "read-write"),
    );
    controller.programs.push(program);
    proj.controllers.push(controller);

    const findings = accessFindings(proj);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.target).toBe("Ctrl/Main/Alias");
  });

  it("does not flag a non-alias tag with permissive access", () => {
    const findings = accessFindings(project((id) => [tag(id, "Plain", undefined, "read-write")]));
    expect(findings).toHaveLength(0);
  });
});
