import { describe, expect, it } from "vitest";
import { createController, createProject, type IoModule } from "@esco/core";
import { moduleConnectionReviewReport } from "./module-connection-review";

function module(input: Partial<IoModule> & Pick<IoModule, "id" | "name">): IoModule {
  return {
    id: input.id,
    name: input.name,
    catalogNumber: input.catalogNumber ?? "1756-IB16",
    slot: input.slot,
    inhibited: input.inhibited,
    majorFault: input.majorFault,
    connections: input.connections,
    ports: input.ports ?? [{ id: "1", type: "Backplane", address: String(input.slot ?? 0) }],
  };
}

describe("moduleConnectionReviewReport", () => {
  it("reviews imported module connection type, RPI, EventID, and unicast metadata with offline boundaries", () => {
    const project = createProject("Module Connection Review");
    const controller = createController(project.id, "Ctl");
    controller.ioConfiguration.modules.push(
      module({
        id: "di",
        name: "DI_01",
        slot: 1,
        majorFault: true,
        connections: [
          { name: "Data", rpi: 20000, type: "Input", priority: "Scheduled", eventId: 0, unicast: false },
          { name: "Output", rpi: 10000, type: "Output", priority: "High", eventId: 7, unicast: true },
        ],
      }),
    );
    project.controllers.push(controller);

    const report = moduleConnectionReviewReport(project);
    expect(report.moduleCount).toBe(1);
    expect(report.moduleWithConnectionsCount).toBe(1);
    expect(report.connectionCount).toBe(2);
    expect(report.inputCount).toBe(1);
    expect(report.outputCount).toBe(1);
    expect(report.priorityMetadataCount).toBe(2);
    expect(report.eventIdMetadataCount).toBe(2);
    expect(report.unicastCount).toBe(1);
    expect(report.multicastCount).toBe(1);
    expect(report.issueCount).toBe(0);
    expect(report.rows[0]).toMatchObject({
      controllerName: "Ctl",
      moduleName: "DI_01",
      catalogNumber: "1756-IB16",
      slot: 1,
      majorFaultOnConnectionLoss: true,
      status: "reviewable",
      moduleConnectionModelled: false,
      rpiSchedulingModelled: false,
      connectionPrioritySchedulingModelled: false,
      eventTriggeredConnectionDispatchModelled: false,
      unicastMulticastEnforced: false,
      connectionMajorFaultModelled: false,
    });
    expect(report.rows[0]?.connections).toEqual([
      expect.objectContaining({ name: "Data", type: "Input", priority: "Scheduled", eventId: 0, rpiMicroseconds: 20000, rpiMs: 20, unicast: false, issues: [] }),
      expect.objectContaining({ name: "Output", type: "Output", priority: "High", eventId: 7, rpiMicroseconds: 10000, rpiMs: 10, unicast: true, issues: [] }),
    ]);
    expect(report.rows[0]?.boundaries).toEqual(expect.arrayContaining([
      "no-controller-communication",
      "no-module-connection",
      "no-rpi-scheduling",
      "no-connection-priority-scheduling",
      "no-event-triggered-connection-dispatch",
      "no-unicast-multicast-enforcement",
      "no-connection-major-fault",
    ]));
  });

  it("reports modules without connection metadata as empty review rows", () => {
    const project = createProject("Empty Module Connections");
    const controller = createController(project.id, "Ctl");
    controller.ioConfiguration.modules.push(module({ id: "local", name: "Local" }));
    project.controllers.push(controller);

    const report = moduleConnectionReviewReport(project);
    expect(report.moduleCount).toBe(1);
    expect(report.emptyModuleCount).toBe(1);
    expect(report.connectionCount).toBe(0);
    expect(report.priorityMetadataCount).toBe(0);
    expect(report.eventIdMetadataCount).toBe(0);
    expect(report.rows[0]).toMatchObject({
      moduleName: "Local",
      status: "empty",
      connections: [],
      message: "I/O module \"Local\" has no imported module connection metadata to review.",
    });
  });

  it("flags malformed hand-edited connection metadata", () => {
    const project = createProject("Bad Module Connections");
    const controller = createController(project.id, "Ctl");
    controller.ioConfiguration.modules.push(
      module({
        id: "bad",
        name: "BadModule",
        connections: [
          { type: "Input", rpi: 10000 },
          { name: "NoType", rpi: 10000 },
          { name: "NoRpi", type: "Input" },
          { name: "BadRpi", type: "Input", rpi: 0 },
          { name: "Data", type: "Input", rpi: 10000 },
          { name: "data", type: "Output", rpi: 20000 },
        ],
      }),
    );
    project.controllers.push(controller);

    const report = moduleConnectionReviewReport(project);
    expect(report.issueCount).toBe(1);
    expect(report.connectionIssueCount).toBe(6);
    expect(report.missingNameCount).toBe(1);
    expect(report.missingTypeCount).toBe(1);
    expect(report.missingRpiCount).toBe(1);
    expect(report.invalidRpiCount).toBe(1);
    expect(report.duplicateNameCount).toBe(2);
    expect(report.rows[0]?.status).toBe("needs-attention");
    expect(report.rows[0]?.issues).toEqual([
      "missing-name",
      "missing-type",
      "missing-rpi",
      "invalid-rpi",
      "duplicate-name",
    ]);
    expect(report.rows[0]?.connections.map((connection) => connection.issues)).toEqual([
      ["missing-name"],
      ["missing-type"],
      ["missing-rpi"],
      ["invalid-rpi"],
      ["duplicate-name"],
      ["duplicate-name"],
    ]);
    expect(report.warnings[0]).toMatch(/missing connection name/);
    expect(report.warnings[0]).toMatch(/duplicate connection name/);
  });
});
