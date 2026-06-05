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
  removeAoiLocalTag,
  removeAoiParameter,
  removeUdtMember,
  updateAoiLocalTag,
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

  it("adds and updates members with full multi-dimensional array metadata", () => {
    const added = addUdtMember(fixture(), {
      udtId: "udt_motor",
      member: { name: "Recipe", dataType: "DINT", dimensions: [2, 3] },
    });
    expect(added.ok).toBe(true);
    expect(udtOf(added.project).members.find((m) => m.name === "Recipe")).toMatchObject({
      dimension: 2,
      dimensions: [2, 3],
    });

    const updated = updateUdtMember(added.project, {
      udtId: "udt_motor",
      memberName: "Recipe",
      patch: { dimensions: [4, 5] },
    });
    expect(updated.ok).toBe(true);
    expect(udtOf(updated.project).members.find((m) => m.name === "Recipe")).toMatchObject({
      dimension: 4,
      dimensions: [4, 5],
    });

    const cleared = updateUdtMember(updated.project, {
      udtId: "udt_motor",
      memberName: "Recipe",
      patch: { dimensions: [] },
    });
    const member = udtOf(cleared.project).members.find((m) => m.name === "Recipe");
    expect(member?.dimension).toBeUndefined();
    expect(member?.dimensions).toBeUndefined();
  });

  it("rejects duplicate, invalid, and self-referential members", () => {
    expect(addUdtMember(fixture(), { udtId: "udt_motor", member: { name: "Run", dataType: "BOOL" } }).ok).toBe(false);
    expect(addUdtMember(fixture(), { udtId: "udt_motor", member: { name: "1bad", dataType: "BOOL" } }).ok).toBe(false);
    const selfRef = addUdtMember(fixture(), { udtId: "udt_motor", member: { name: "Nested", dataType: "MotorUdt" } });
    expect(selfRef.ok).toBe(false);
    expect(selfRef.error).toMatch(/own UDT/i);
  });

  it("rejects member names that Studio 5000 would reject at edit time", () => {
    const cases = [
      ["Trailing_", /must not end with an underscore/],
      ["Has__Gap", /consecutive underscores/],
      ["M".repeat(41), /limit is 40/],
    ] as const;

    for (const [name, reason] of cases) {
      const result = addUdtMember(fixture(), { udtId: "udt_motor", member: { name, dataType: "BOOL" } });
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(reason);
    }
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

  it("adds and updates AOI local tags with full multi-dimensional array metadata", () => {
    const added = addAoiLocalTag(fixture(), {
      aoiId: "aoi_scale",
      localTag: { name: "Window", dataType: "DINT", dimensions: [2, 3] },
    });
    expect(added.ok).toBe(true);
    expect(aoiOf(added.project).localTags.find((t) => t.name === "Window")).toMatchObject({
      dimension: 2,
      dimensions: [2, 3],
    });

    const updated = updateAoiLocalTag(added.project, {
      aoiId: "aoi_scale",
      localTagName: "Window",
      patch: { dimensions: [4, 5] },
    });
    expect(updated.ok).toBe(true);
    expect(aoiOf(updated.project).localTags.find((t) => t.name === "Window")).toMatchObject({
      dimension: 4,
      dimensions: [4, 5],
    });
  });

  it("enforces a shared parameter/local-tag name space", () => {
    const withParam = addAoiParameter(fixture(), { aoiId: "aoi_scale", parameter: { name: "Shared", dataType: "REAL" } });
    const clash = addAoiLocalTag(withParam.project, { aoiId: "aoi_scale", localTag: { name: "Shared", dataType: "REAL" } });
    expect(clash.ok).toBe(false);
    expect(clash.error).toMatch(/already exists/i);
  });

  it("rejects AOI parameter and local-tag names that Studio 5000 would reject at edit time", () => {
    const badParameter = addAoiParameter(fixture(), {
      aoiId: "aoi_scale",
      parameter: { name: "Param_", dataType: "REAL" },
    });
    expect(badParameter.ok).toBe(false);
    expect(badParameter.error).toMatch(/must not end with an underscore/);

    const longLocal = addAoiLocalTag(fixture(), {
      aoiId: "aoi_scale",
      localTag: { name: "L".repeat(41), dataType: "DINT" },
    });
    expect(longLocal.ok).toBe(false);
    expect(longLocal.error).toMatch(/limit is 40/);

    const gapLocal = updateAoiLocalTag(
      addAoiLocalTag(fixture(), {
        aoiId: "aoi_scale",
        localTag: { name: "Scratch", dataType: "DINT" },
      }).project,
      { aoiId: "aoi_scale", localTagName: "Scratch", patch: { name: "Bad__Name" } },
    );
    expect(gapLocal.ok).toBe(false);
    expect(gapLocal.error).toMatch(/consecutive underscores/);
  });

  it("refuses every parameter/local-tag edit on a source-protected AOI", () => {
    // The shared editableAoi guard must reject EVERY mutation entry point — not
    // just addAoiParameter — and must run before the "not found" check, so a
    // protected AOI is rejected as protected even for a member it never had.
    const edits = [
      () => addAoiParameter(fixture(), { aoiId: "aoi_locked", parameter: { name: "X", dataType: "BOOL" } }),
      () => updateAoiParameter(fixture(), { aoiId: "aoi_locked", parameterName: "EnableIn", patch: { required: true } }),
      () => removeAoiParameter(fixture(), { aoiId: "aoi_locked", parameterName: "EnableIn" }),
      () => addAoiLocalTag(fixture(), { aoiId: "aoi_locked", localTag: { name: "Scratch", dataType: "BOOL" } }),
      () => updateAoiLocalTag(fixture(), { aoiId: "aoi_locked", localTagName: "Scratch", patch: { dataType: "DINT" } }),
      () => removeAoiLocalTag(fixture(), { aoiId: "aoi_locked", localTagName: "Scratch" }),
    ];
    for (const edit of edits) {
      const result = edit();
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/source-protected/i);
      // The guard leaves the project untouched — no partial mutation leaks through.
      expect(result.project.controllers[0].addOnInstructions[1]).toMatchObject({
        id: "aoi_locked",
        protected: true,
        parameters: [],
        localTags: [],
      });
    }
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
