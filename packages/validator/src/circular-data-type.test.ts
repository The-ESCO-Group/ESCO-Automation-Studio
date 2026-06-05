import { describe, expect, it } from "vitest";
import {
  createController,
  createProject,
  type PlcProject,
  type UserDefinedType,
} from "@esco/core";
import { createDefaultEngine } from "./index";

/** Build a project whose single controller carries the given UDTs. */
function project(udts: UserDefinedType[]): PlcProject {
  const proj = createProject("Cell");
  const controller = createController(proj.id, "Ctrl");
  for (const udt of udts) controller.dataTypes.push(udt);
  proj.controllers.push(controller);
  return proj;
}

const cycleFindings = (proj: PlcProject) =>
  createDefaultEngine().run(proj).filter((f) => f.ruleId === "circular-data-type");

describe("circular-data-type", () => {
  it("flags a UDT with a member of its own type", () => {
    const findings = cycleFindings(
      project([
        {
          id: "udt-node",
          name: "Node",
          members: [
            { name: "Value", dataType: "DINT" },
            { name: "Next", dataType: "Node" },
          ],
        },
      ]),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("error");
    expect(findings[0].message).toContain('member "Next"');
    expect(findings[0].message).toContain("cannot contain itself");
    expect(findings[0].target).toBe("Ctrl/Node");
  });

  it("flags an indirect cycle through an intermediary UDT", () => {
    const findings = cycleFindings(
      project([
        {
          id: "udt-a",
          name: "TypeA",
          members: [{ name: "B", dataType: "TypeB" }],
        },
        {
          id: "udt-b",
          name: "TypeB",
          members: [{ name: "A", dataType: "TypeA" }],
        },
      ]),
    );
    // Both types are part of the cycle and each fails to verify.
    expect(findings).toHaveLength(2);
    expect(findings.every((f) => f.severity === "error")).toBe(true);
    const forA = findings.find((f) => f.target === "Ctrl/TypeA");
    expect(forA?.message).toContain("circular data-type definition");
    expect(forA?.message).toContain("TypeA → TypeB → TypeA");
  });

  it("follows the element type through a member array", () => {
    const findings = cycleFindings(
      project([
        {
          id: "udt-node",
          name: "Node",
          members: [{ name: "Children", dataType: "Node", dimension: 4, dimensions: [4] }],
        },
      ]),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain('member "Children"');
  });

  it("matches type names case-insensitively, as Logix does", () => {
    const findings = cycleFindings(
      project([
        {
          id: "udt-node",
          name: "Node",
          members: [{ name: "Next", dataType: "node" }],
        },
      ]),
    );
    expect(findings).toHaveLength(1);
  });

  it("does not flag an acyclic UDT graph", () => {
    const findings = cycleFindings(
      project([
        {
          id: "udt-outer",
          name: "Outer",
          members: [
            { name: "Inner", dataType: "Inner" },
            { name: "Count", dataType: "DINT" },
          ],
        },
        {
          id: "udt-inner",
          name: "Inner",
          members: [{ name: "Flag", dataType: "BOOL" }],
        },
      ]),
    );
    expect(findings).toHaveLength(0);
  });
});
