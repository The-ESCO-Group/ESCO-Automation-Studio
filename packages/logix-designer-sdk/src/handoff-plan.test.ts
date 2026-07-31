import { describe, expect, it } from "vitest";
import { buildLogixDesignerSdkHandoffPlan } from "./handoff-plan";

describe("buildLogixDesignerSdkHandoffPlan", () => {
  it("builds a probe-only plan without requiring project paths", () => {
    const plan = buildLogixDesignerSdkHandoffPlan();

    expect(plan.status).toBe("ready-to-stage");
    expect(plan.operation).toBe("probe-only");
    expect(plan.missingInputs).toEqual([]);
    expect(plan.scriptBundle.pythonProbe).toContain("logix_designer_sdk.logix_project");
    expect(plan.blockedOperations).toContain("go-online");
  });

  it("reports missing inputs for an open/export handoff", () => {
    const plan = buildLogixDesignerSdkHandoffPlan({ operation: "open-export-l5x" });

    expect(plan.status).toBe("needs-input");
    expect(plan.requiredInputs).toEqual(["sourceProjectPath", "outputPath"]);
    expect(plan.missingInputs).toEqual(["sourceProjectPath", "outputPath"]);
  });

  it("stages a conversion manifest when the sandbox inputs are present", () => {
    const plan = buildLogixDesignerSdkHandoffPlan({
      operation: "convert-project",
      sourceProjectPath: "C:\\sandbox\\line.L5X",
      outputPath: "C:\\sandbox\\line-v36.L5X",
      targetMajorRevision: 36,
    });

    expect(plan.status).toBe("ready-to-stage");
    expect(plan.scriptBundle.runnerManifest).toMatchObject({
      schema: "esco.logixDesignerSdk.runner.v1",
      dryRun: true,
      operation: "convert-project",
      sourceProjectPath: "C:\\sandbox\\line.L5X",
      outputPath: "C:\\sandbox\\line-v36.L5X",
      targetMajorRevision: 36,
    });
  });

  it("blocks plans that request controller transfer", () => {
    const plan = buildLogixDesignerSdkHandoffPlan({ allowControllerTransfer: true });

    expect(plan.status).toBe("blocked");
    expect(plan.blockedOperations[0]).toBe("requested-controller-transfer");
    expect(plan.boundary).toContain("does not open a PLC connection");
  });
});
