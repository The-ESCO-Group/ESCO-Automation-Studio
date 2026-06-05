import { createController, createProgram, createProject, createTag, type ControllerTrend } from "@esco/core";
import { describe, expect, it } from "vitest";
import { createControllerTrend, deleteControllerTrend } from "./controller-trend-actions";

function fixture() {
  const project = createProject("Trend Actions");
  const controller = createController(project.id, "TrendCtl");
  controller.controllerTags.push(createTag(controller.id, "LineSpeed", "REAL"));
  const program = createProgram(controller.id, "MainProgram");
  program.programTags.push(createTag(controller.id, "ProgramTemp", "REAL", { scope: "program", programId: program.id }));
  controller.programs.push(program);
  project.controllers.push(controller);
  return { project, controllerId: controller.id };
}

describe("controller trend actions", () => {
  it("creates a uniquely named offline trend and seeds the first available tag as a pen", () => {
    const { project, controllerId } = fixture();
    const result = createControllerTrend(project, { controllerId });

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({ controllerId, trendName: "Trend_1", seededPenName: "LineSpeed" });
    expect(project.controllers[0].trends).toHaveLength(0);
    const trend = result.project.controllers[0].trends?.[0];
    expect(trend).toMatchObject({
      name: "Trend_1",
      description: "Offline controller trend definition.",
      pens: [{ name: "LineSpeed", description: "Seeded from LineSpeed" }],
    });
    expect(result.findings).toBeDefined();
  });

  it("honors explicit names and can create an empty review trend without seeding a pen", () => {
    const { project, controllerId } = fixture();
    const result = createControllerTrend(project, {
      controllerId,
      name: "CheckoutTrend",
      description: "Commissioning review",
      seedFirstTag: false,
    });

    expect(result.ok).toBe(true);
    expect(result.project.controllers[0].trends?.[0]).toMatchObject({
      name: "CheckoutTrend",
      description: "Commissioning review",
      pens: [],
    });
  });

  it("rejects invalid, duplicate, and missing-controller trend creates without mutating", () => {
    const { project, controllerId } = fixture();
    const existing: ControllerTrend = { id: "trend-existing", name: "Trend_1", pens: [] };
    const withExisting = {
      ...project,
      controllers: project.controllers.map((controller) => ({ ...controller, trends: [existing] })),
    };

    expect(createControllerTrend(project, { controllerId, name: "Bad__Trend" }).error).toMatch(/Invalid trend/i);
    expect(createControllerTrend(withExisting, { controllerId, name: "Trend_1" }).error).toMatch(/already exists/i);
    expect(createControllerTrend(project, { controllerId: "missing-controller" }).error).toMatch(/not found/i);
    expect(project.controllers[0].trends).toHaveLength(0);
  });

  it("deletes one trend while preserving neighboring trend metadata", () => {
    const { project, controllerId } = fixture();
    const first = createControllerTrend(project, { controllerId, name: "Trend_1" });
    const second = createControllerTrend(first.project, { controllerId, name: "Trend_2", seedFirstTag: false });

    const removed = deleteControllerTrend(second.project, { controllerId, trendId: first.data!.trendId });
    expect(removed.ok).toBe(true);
    expect(removed.data).toMatchObject({ trendName: "Trend_1" });
    expect(removed.project.controllers[0].trends?.map((trend) => trend.name)).toEqual(["Trend_2"]);
  });

  it("rejects missing trend deletes without mutating the project", () => {
    const { project, controllerId } = fixture();
    const created = createControllerTrend(project, { controllerId });

    const missing = deleteControllerTrend(created.project, { controllerId, trendId: "missing-trend" });
    expect(missing.ok).toBe(false);
    expect(missing.error).toMatch(/not found/i);
    expect(missing.project).toBe(created.project);
  });
});
