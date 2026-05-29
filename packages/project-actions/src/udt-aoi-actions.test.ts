import { describe, expect, it } from "vitest";
import {
  createController,
  createProject,
  type AddOnInstruction,
  type PlcProject,
  type UserDefinedType,
} from "@esco/core";
import {
  addAoiLocalTag,
  addAoiParameter,
  addUdtMember,
  removeAoiParameter,
  removeUdtMember,
  updateAoiParameter,
  updateUdtMember,
} from "./index";

const UDT: UserDefinedType = {
  id: "udt_motor",
  name: "MotorUdt",
  members: [{ name: "Run", dataType: "BOOL" }],
};

const AOI: AddOnInstruction = {
  id: "aoi_scale",
  name: "Scale",
  parameters: [{ name: "EnableIn", dataType: "BOOL", usage: "Input" }],
  localTags: [],
  routineNames: ["Logic"],
};

const PROTECTED_AOI: AddOnInstruction = {
  id: "aoi_locked",
  name: "Locked",
  protected: true,
  protectionType: "Protected",
  parameters: [],
  localTags: [],
  routineNames: [],
};

function fixture(): PlcProject {
  const project = createProject("Cell");
  const controller = createController(project.id, "C1");
  controller.dataTypes.push(structuredClone(UDT));
  controller.addOnInstructions.push(structuredClone(AOI), structuredClone(PROTECTED_AOI));
  return { ...project, controllers: [controller] };
}

const udtOf = (project: PlcProject) => project.controllers[0].dataTypes[0];
const aoiOf = (project: PlcProject) => project.controllers[0].addOnInstructions[0];

describe("UDT member actions", () => {
  it("adds a member with an array dimension", () => {
    const result = addUdtMember(fixture(), {
      udtId: "udt_motor",
      member: { name: "History", dataType: "DINT", dimension: 8 },
    });
    expect(result.ok).toBe(true);
    const member = udtOf(result.project).members.find((m) => m.name === "History");
    expect(member?.dimension).toBe(8);
  });

  it("rejects duplicate, invalid, and self-referential members", () => {
    expect(addUdtMember(fixture(), { udtId: "udt_motor", member: { name: "Run", dataType: "BOOL" } }).ok).toBe(false);
    expect(addUdtMember(fixture(), { udtId: "udt_motor", member: { name: "1bad", dataType: "BOOL" } }).ok).toBe(false);
    const selfRef = addUdtMember(fixture(), { udtId: "udt_motor", member: { name: "Nested", dataType: "MotorUdt" } });
    expect(selfRef.ok).toBe(false);
    expect(selfRef.error).toMatch(/own UDT/i);
  });

  it("renames a member but rejects collision with another member", () => {
    const seeded = addUdtMember(fixture(), { udtId: "udt_motor", member: { name: "Speed", dataType: "DINT" } });
    const renamed = updateUdtMember(seeded.project, { udtId: "udt_motor", memberName: "Speed", patch: { name: "Velocity" } });
    expect(renamed.ok).toBe(true);
    expect(udtOf(renamed.project).members.some((m) => m.name === "Velocity")).toBe(true);

    const collide = updateUdtMember(seeded.project, { udtId: "udt_motor", memberName: "Speed", patch: { name: "Run" } });
    expect(collide.ok).toBe(false);
  });

  it("removes a member and rejects removing a missing one", () => {
    const result = removeUdtMember(fixture(), { udtId: "udt_motor", memberName: "Run" });
    expect(result.ok).toBe(true);
    expect(udtOf(result.project).members).toHaveLength(0);
    expect(removeUdtMember(fixture(), { udtId: "udt_motor", memberName: "Ghost" }).ok).toBe(false);
  });
});

describe("AOI parameter and local-tag actions", () => {
  it("adds a parameter and a local tag", () => {
    const withParam = addAoiParameter(fixture(), {
      aoiId: "aoi_scale",
      parameter: { name: "InValue", dataType: "REAL", usage: "Input" },
    });
    expect(withParam.ok).toBe(true);
    const withLocal = addAoiLocalTag(withParam.project, {
      aoiId: "aoi_scale",
      localTag: { name: "Scratch", dataType: "REAL" },
    });
    expect(withLocal.ok).toBe(true);
    expect(aoiOf(withLocal.project).parameters.some((p) => p.name === "InValue")).toBe(true);
    expect(aoiOf(withLocal.project).localTags.some((t) => t.name === "Scratch")).toBe(true);
  });

  it("enforces a shared parameter/local-tag name space", () => {
    const withParam = addAoiParameter(fixture(), { aoiId: "aoi_scale", parameter: { name: "Shared", dataType: "REAL" } });
    const clash = addAoiLocalTag(withParam.project, { aoiId: "aoi_scale", localTag: { name: "Shared", dataType: "REAL" } });
    expect(clash.ok).toBe(false);
    expect(clash.error).toMatch(/already exists/i);
  });

  it("refuses to edit a source-protected AOI", () => {
    const result = addAoiParameter(fixture(), { aoiId: "aoi_locked", parameter: { name: "X", dataType: "BOOL" } });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/source-protected/i);
  });

  it("updates and removes a parameter", () => {
    const updated = updateAoiParameter(fixture(), {
      aoiId: "aoi_scale",
      parameterName: "EnableIn",
      patch: { description: "Enable input", required: true },
    });
    expect(updated.ok).toBe(true);
    expect(aoiOf(updated.project).parameters[0]?.description).toBe("Enable input");
    expect(aoiOf(updated.project).parameters[0]?.required).toBe(true);

    const removed = removeAoiParameter(updated.project, { aoiId: "aoi_scale", parameterName: "EnableIn" });
    expect(removed.ok).toBe(true);
    expect(aoiOf(removed.project).parameters).toHaveLength(0);
  });
});
