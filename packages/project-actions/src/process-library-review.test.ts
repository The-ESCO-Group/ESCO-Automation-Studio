import { describe, expect, it } from "vitest";
import { createController, createProgram, createProject, createTag, type AddOnInstruction, type UserDefinedType } from "@esco/core";
import { processLibraryReviewReport } from "./process-library-review";

function projectWithProcessObjects() {
  const project = createProject("Process Objects");
  const controller = createController(project.id, "ProcessCtl");
  const program = createProgram(controller.id, "Area01");

  const pAin: AddOnInstruction = {
    id: "aoi-pain",
    name: "P_AIn",
    vendor: "Example Process Library",
    revision: "5.01",
    protected: true,
    signature: "12345",
    parameters: [
      { name: "Inp_PV", dataType: "REAL", usage: "Input" },
      { name: "Sts", dataType: "DINT", usage: "Output" },
    ],
    localTags: [{ name: "Cfg", dataType: "DINT" }],
    routineNames: ["Logic"],
  };
  const pValve: UserDefinedType = {
    id: "udt-pvlv",
    name: "PVLV",
    description: "Valve process object",
    members: [
      { name: "Cmd_Open", dataType: "BOOL" },
      { name: "Sts_Opened", dataType: "BOOL" },
      { name: "Alm_Fail", dataType: "BOOL" },
    ],
  };

  controller.addOnInstructions.push(pAin);
  controller.dataTypes.push(pValve);
  controller.controllerTags.push(createTag(controller.id, "AI101", "P_AIn"));
  program.programTags.push(createTag(controller.id, "XV101", "PVLV", { scope: "program", programId: program.id }));
  program.programTags.push(createTag(controller.id, "MissingObj", "raP_Unknown", { scope: "program", programId: program.id }));
  controller.programs.push(program);
  project.controllers.push(controller);
  return project;
}

describe("processLibraryReviewReport", () => {
  it("detects process AOI/UDT definitions and tag instances with explicit boundaries", () => {
    const report = processLibraryReviewReport(projectWithProcessObjects());

    expect(report.objectCount).toBe(5);
    expect(report.aoiDefinitionCount).toBe(1);
    expect(report.udtDefinitionCount).toBe(1);
    expect(report.tagInstanceCount).toBe(3);
    expect(report.protectedAoiCount).toBe(1);
    expect(report.boundaries).toContain("no-process-object-execution");
    expect(report.boundaries).toContain("no-vendor-faceplate-runtime");
    expect(report.prefixCounts).toEqual([
      { key: "P_", count: 2 },
      { key: "PVLV", count: 2 },
      { key: "raP_", count: 1 },
    ]);

    const aoi = report.rows.find((row) => row.kind === "aoi-definition" && row.name === "P_AIn")!;
    expect(aoi.status).toBe("metadata-only");
    expect(aoi.parameterCount).toBe(2);
    expect(aoi.localTagCount).toBe(1);
    expect(aoi.tagInstanceCount).toBe(1);
    expect(aoi.vendor).toBe("Example Process Library");
    expect(aoi.issues).toContain("source-protected-aoi");
    expect(aoi.representativeFields).toContain("Inp_PV: REAL");

    const udt = report.rows.find((row) => row.kind === "udt-definition" && row.name === "PVLV")!;
    expect(udt.status).toBe("reviewable");
    expect(udt.memberCount).toBe(3);
    expect(udt.category).toBe("valve");
    expect(udt.representativeFields).toContain("Alm_Fail: BOOL");

    const missing = report.rows.find((row) => row.name === "MissingObj")!;
    expect(missing.status).toBe("needs-attention");
    expect(missing.issues).toContain("missing-definition");
    expect(report.warnings.some((warning) => /MissingObj/.test(warning))).toBe(true);
  });

  it("returns an empty report for projects without process-library naming signals", () => {
    const project = createProject("Plain");
    const controller = createController(project.id, "PlainCtl");
    controller.controllerTags.push(createTag(controller.id, "MotorRun", "BOOL"));
    project.controllers.push(controller);

    const report = processLibraryReviewReport(project);
    expect(report.objectCount).toBe(0);
    expect(report.rows).toEqual([]);
    expect(report.prefixCounts).toEqual([]);
    expect(report.warnings).toEqual([]);
  });
});
