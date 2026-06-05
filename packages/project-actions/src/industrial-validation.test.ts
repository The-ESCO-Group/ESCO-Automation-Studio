import { describe, expect, it } from "vitest";
import {
  createContinuousTask,
  createController,
  createProgram,
  createProject,
  createRoutine,
  createTag,
  type IoModule,
  type PlcProject,
} from "@esco/core";
import { validateIndustrialProject, type IndustrialValidationFinding, type IndustrialValidationRuleId } from "./industrial-validation";

function ioModule(input: Partial<IoModule> & Pick<IoModule, "id" | "name">): IoModule {
  return {
    id: input.id,
    name: input.name,
    catalogNumber: input.catalogNumber ?? "1756-IB16",
    slot: input.slot,
    parentModule: input.parentModule,
    parentPortId: input.parentPortId,
    commPath: input.commPath,
    productType: input.productType,
    vendor: input.vendor,
    ports: input.ports,
    connections: input.connections,
  };
}

function cleanProject(): PlcProject {
  const project = createProject("ESCO Packaging Cell");
  const controller = createController(project.id, "LineCtl");
  controller.ethernetConfig = {
    internetProtocol: {
      attributes: {
        ConfigType: "Manual",
        IPAddress: "192.168.10.10",
        SubnetMask: "255.255.255.0",
        Gateway: "192.168.10.1",
      },
    },
    ports: [{ id: "enet-1", attributes: { Port: "1", InterfaceSpeed: "1000", DuplexMode: "Full" } }],
  };

  const start = createTag(controller.id, "StartPB", "BOOL");
  const runAlias = createTag(controller.id, "RunCmd", "BOOL");
  runAlias.aliasFor = "StartPB";
  const producedData = createTag(controller.id, "RemoteData", "DINT");
  producedData.consumed = true;
  producedData.consumeInfo = { producer: "UpstreamCtl", remoteTag: "CellData", rpi: 20 };
  controller.controllerTags.push(start, runAlias, producedData);

  const program = createProgram(controller.id, "MainProgram");
  const main = createRoutine(program.id, "Main", "ladder");
  program.mainRoutineId = main.id;
  program.routines.push(main);
  program.programTags.push(createTag(controller.id, "LocalMode", "DINT", { scope: "program", programId: program.id }));
  controller.programs.push(program);
  controller.tasks.push(createContinuousTask(controller.id, "MainTask", [program.id]));

  controller.ioConfiguration.modules.push(
    ioModule({
      id: "local",
      name: "Local",
      catalogNumber: "1756-L85E",
      slot: 0,
      ports: [{ id: "1", type: "Backplane", address: "0", busSize: 17 }],
    }),
    ioModule({
      id: "enet",
      name: "RemoteENet",
      catalogNumber: "1756-EN2T",
      slot: 1,
      parentModule: "Local",
      parentPortId: "1",
      ports: [{ id: "eth1", type: "Ethernet", address: "192.168.10.20" }],
      connections: [{ name: "Data", type: "Input", rpi: 20000 }],
    }),
  );

  project.controllers.push(controller);
  return project;
}

function problemProject(): PlcProject {
  const project = createProject("ESCO Validation Problems");
  const controller = createController(project.id, "LineCtl");
  controller.ethernetConfig = {
    internetProtocol: {
      attributes: {
        ConfigType: "Manual",
        Gateway: "999.1.1.1",
      },
    },
    ports: [{ id: "enet-1", attributes: { Port: "1" } }],
  };

  const start = createTag(controller.id, "StartPB", "BOOL");
  const duplicateStart = createTag(controller.id, "startpb", "BOOL");
  const aliasMissing = createTag(controller.id, "MissingAlias", "ALIAS");
  aliasMissing.aliasFor = "MissingBase";
  const aliasA = createTag(controller.id, "AliasA", "BOOL");
  const aliasB = createTag(controller.id, "AliasB", "BOOL");
  aliasA.aliasFor = "AliasB";
  aliasB.aliasFor = "AliasA";
  const invalidConsumed = createTag(controller.id, "BadConsumed", "DINT");
  invalidConsumed.consumed = true;
  invalidConsumed.consumeInfo = { producer: "Upstream", remoteTag: "Data", rpi: 0 };
  const missingConsumed = createTag(controller.id, "MissingConsumedRpi", "DINT");
  missingConsumed.consumed = true;
  missingConsumed.consumeInfo = { producer: "Upstream", remoteTag: "Data" };
  controller.controllerTags.push(
    start,
    duplicateStart,
    aliasMissing,
    aliasA,
    aliasB,
    invalidConsumed,
    missingConsumed,
  );

  const badMain = createProgram(controller.id, "BadMainProgram");
  badMain.mainRoutineId = "missing-routine";
  badMain.routines.push(createRoutine(badMain.id, "LoadedRoutine", "ladder"));

  const noMain = createProgram(controller.id, "NoMainProgram");
  noMain.routines.push(createRoutine(noMain.id, "CandidateMain", "ladder"));
  noMain.programTags.push(
    createTag(controller.id, "LocalCmd", "BOOL", { scope: "program", programId: noMain.id }),
    createTag(controller.id, "localcmd", "BOOL", { scope: "program", programId: noMain.id }),
  );

  const unscheduled = createProgram(controller.id, "UnscheduledProgram");
  unscheduled.routines.push(createRoutine(unscheduled.id, "Idle", "ladder"));
  controller.programs.push(badMain, noMain, unscheduled);

  const badPeriodic = createContinuousTask(controller.id, "BadPeriodic", [
    badMain.id,
    noMain.id,
    "missing-program",
  ]);
  badPeriodic.type = "periodic";
  badPeriodic.periodMs = 0;
  const emptyTask = createContinuousTask(controller.id, "EmptyTask");
  controller.tasks.push(badPeriodic, emptyTask);

  controller.ioConfiguration.modules.push(
    ioModule({
      id: "local",
      name: "Local",
      slot: 0,
      ports: [
        { id: "1", type: "Backplane", address: "0", busSize: 2 },
        { id: "2", type: "Backplane", address: "1" },
      ],
    }),
    ioModule({ id: "di-a", name: "DI_A", slot: 1, parentModule: "Local", parentPortId: "1" }),
    ioModule({ id: "di-b", name: "DI_B", slot: 1, parentModule: "Local", parentPortId: "1" }),
    ioModule({ id: "over-slot", name: "OverSlot", slot: 3, parentModule: "Local", parentPortId: "1" }),
    ioModule({ id: "negative", name: "NegativeSlot", slot: -1 }),
    ioModule({ id: "missing-parent", name: "RemoteMissingParent", slot: 2, parentModule: "MissingRack" }),
    ioModule({ id: "missing-port", name: "RemoteMissingPort", slot: 2, parentModule: "Local", parentPortId: "9" }),
    ioModule({ id: "self-parent", name: "SelfParent", slot: 4, parentModule: "SelfParent" }),
    ioModule({
      id: "missing-ip",
      name: "RemoteENet",
      catalogNumber: "1756-EN2T",
      slot: 5,
      parentModule: "Local",
      parentPortId: "2",
      ports: [{ id: "eth1", type: "Ethernet" }],
      connections: [
        { name: "Data", type: "Input", rpi: 0 },
        { name: "Status", type: "Input" },
      ],
    }),
    ioModule({
      id: "bad-ip",
      name: "BadIPAdapter",
      catalogNumber: "5069-AENTR",
      slot: 6,
      parentModule: "Local",
      parentPortId: "2",
      ports: [{ id: "eth1", type: "Ethernet", address: "999.1.1.1" }],
    }),
  );

  project.controllers.push(controller);
  return project;
}

function byRule(findings: IndustrialValidationFinding[], ruleId: IndustrialValidationRuleId): IndustrialValidationFinding[] {
  return findings.filter((finding) => finding.ruleId === ruleId);
}

describe("validateIndustrialProject", () => {
  it("passes a complete ESCO project fixture without findings", () => {
    const report = validateIndustrialProject(cleanProject());

    expect(report.findings).toEqual([]);
    expect(report.summary).toMatchObject({
      findingCount: 0,
      errorCount: 0,
      warningCount: 0,
      suggestionCount: 0,
      controllerCount: 1,
      taskCount: 1,
      moduleCount: 2,
    });
    expect(report.modelLimits).toEqual(expect.arrayContaining([
      expect.objectContaining({ ruleId: "module-parent-compatibility" }),
      expect.objectContaining({ ruleId: "missing-network-address" }),
    ]));
  });

  it("reports duplicate tags, alias issues, task gaps, module topology, network, and RPI problems", () => {
    const report = validateIndustrialProject(problemProject());
    const messages = report.findings.map((finding) => finding.message).join("\n");

    expect(report.summary.errorCount).toBeGreaterThan(0);
    expect(report.summary.warningCount).toBeGreaterThan(0);
    expect(report.summary.suggestionCount).toBeGreaterThan(0);

    expect(byRule(report.findings, "duplicate-tag")).toHaveLength(2);
    expect(messages).toMatch(/duplicate controller tag names/);
    expect(messages).toMatch(/duplicate program "NoMainProgram" tag names/);

    expect(byRule(report.findings, "undefined-alias").some((finding) => finding.message.includes("MissingBase"))).toBe(true);
    expect(byRule(report.findings, "alias-cycle")).toHaveLength(2);

    expect(byRule(report.findings, "missing-task-schedule").some((finding) => finding.severity === "error")).toBe(true);
    expect(byRule(report.findings, "missing-task-schedule").some((finding) => finding.message.includes("EmptyTask"))).toBe(true);
    expect(byRule(report.findings, "missing-main-routine").some((finding) => finding.severity === "error")).toBe(true);
    expect(byRule(report.findings, "missing-main-routine").some((finding) => finding.severity === "suggestion")).toBe(true);
    expect(byRule(report.findings, "invalid-update-rate")).toHaveLength(1);

    expect(byRule(report.findings, "invalid-module-slot").length).toBeGreaterThanOrEqual(2);
    expect(byRule(report.findings, "duplicate-module-slot")).toHaveLength(1);
    expect(byRule(report.findings, "module-parent-compatibility").length).toBeGreaterThanOrEqual(3);
    expect(messages).toMatch(/missing parent module "MissingRack"/);
    expect(messages).toMatch(/missing parent port "9"/);
    expect(messages).toMatch(/cannot use itself as its parent module/);

    expect(byRule(report.findings, "missing-network-address").length).toBeGreaterThanOrEqual(2);
    expect(byRule(report.findings, "invalid-network-address").length).toBeGreaterThanOrEqual(2);
    expect(byRule(report.findings, "missing-rpi").length).toBeGreaterThanOrEqual(2);
    expect(byRule(report.findings, "invalid-rpi").length).toBeGreaterThanOrEqual(2);

    expect(report.errors.every((finding) => finding.severity === "error")).toBe(true);
    expect(report.warnings.every((finding) => finding.severity === "warning")).toBe(true);
    expect(report.suggestions.every((finding) => finding.severity === "suggestion")).toBe(true);
  });
});
