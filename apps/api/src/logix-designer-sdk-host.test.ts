import { describe, expect, it } from "vitest";
import type { LogixDesignerSdkHandoffPlan } from "@esco/logix-designer-sdk";
import { LogixDesignerSdkHost } from "./logix-designer-sdk-host";

describe("LogixDesignerSdkHost", () => {
  it("ignores non-SDK routes", async () => {
    const host = new LogixDesignerSdkHost();

    expect(await host.handle("GET", "/health", undefined)).toBeUndefined();
  });

  it("returns a guarded handoff preflight plan", async () => {
    const host = new LogixDesignerSdkHost();
    const response = await host.handle("POST", "/api/logix-designer-sdk/handoff/preflight", {
      operation: "open-export-l5x",
      sourceProjectPath: "C:\\sandbox\\line.L5X",
      outputPath: "C:\\sandbox\\line-reviewed.L5X",
    });

    expect(response?.status).toBe(200);
    const plan = response?.body as LogixDesignerSdkHandoffPlan;
    expect(plan.status).toBe("ready-to-stage");
    expect(plan.blockedOperations).toContain("download-project-to-controller");
    expect(plan.scriptBundle.runnerManifest.dryRun).toBe(true);
  });

  it("rejects malformed preflight bodies", async () => {
    const host = new LogixDesignerSdkHost();
    const response = await host.handle("POST", "/api/logix-designer-sdk/handoff/preflight", []);

    expect(response?.status).toBe(400);
  });

  it("keeps controller-transfer routes closed", async () => {
    const host = new LogixDesignerSdkHost();
    const response = await host.handle("POST", "/api/logix-designer-sdk/download", {});

    expect(response?.status).toBe(405);
    expect(JSON.stringify(response?.body)).toContain("controller-transfer routes are intentionally not exposed");
  });
});
