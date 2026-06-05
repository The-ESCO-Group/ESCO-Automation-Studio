import { describe, expect, it } from "vitest";
import { createController, createProgram, createProject, createTag, type Tag } from "@esco/core";
import { tagConnectionReviewReport } from "./tag-connection-review";

function producedTag(controllerId: string, name: string, produceCount = 4): Tag {
  const tag = createTag(controllerId, name, "DINT");
  tag.produced = true;
  tag.produceInfo = {
    produceCount,
    unicastPermitted: true,
    programmaticallySendEventTrigger: false,
  };
  return tag;
}

function consumedTag(controllerId: string, name: string): Tag {
  const tag = createTag(controllerId, name, "DINT");
  tag.consumed = true;
  tag.consumeInfo = {
    producer: "RemoteCtl",
    remoteTag: "SourceTag",
    remoteInstance: "42",
    rpi: 20,
    unicast: true,
  };
  return tag;
}

describe("tagConnectionReviewReport", () => {
  it("reviews produced and consumed connection tags with offline boundaries", () => {
    const project = createProject("Connection Review");
    const controller = createController(project.id, "Ctl");
    controller.controllerTags.push(
      producedTag(controller.id, "ProducedValue", 8),
      consumedTag(controller.id, "ConsumedValue"),
      createTag(controller.id, "Plain", "DINT"),
    );
    project.controllers.push(controller);

    const report = tagConnectionReviewReport(project);
    expect(report.rows).toHaveLength(2);
    expect(report.producedCount).toBe(1);
    expect(report.consumedCount).toBe(1);
    expect(report.invalidCount).toBe(0);
    expect(report.warnings).toEqual([]);
    expect(report.rows.find((row) => row.role === "produced")).toMatchObject({
      tagName: "ProducedValue",
      produceCount: 8,
      unicastPermitted: true,
      connectionModelled: false,
      dataTransferModelled: false,
      status: "reviewable",
    });
    expect(report.rows.find((row) => row.role === "consumed")).toMatchObject({
      tagName: "ConsumedValue",
      producer: "RemoteCtl",
      remoteTag: "SourceTag",
      remoteInstance: "42",
      rpi: 20,
      unicast: true,
      status: "reviewable",
    });
    expect(report.rows.find((row) => row.role === "consumed")?.boundaries).toEqual(expect.arrayContaining([
      "no-controller-communication",
      "no-consumed-tag-connection",
      "no-rpi-scheduling",
    ]));
  });

  it("flags missing consumed bindings and invalid produced consumer counts", () => {
    const project = createProject("Connection Issues");
    const controller = createController(project.id, "Ctl");
    const missing = consumedTag(controller.id, "MissingRemote");
    missing.consumeInfo = {};
    const invalidRpi = consumedTag(controller.id, "BadRpi");
    invalidRpi.consumeInfo!.rpi = 0;
    controller.controllerTags.push(producedTag(controller.id, "TooMany", 257), missing, invalidRpi);
    project.controllers.push(controller);

    const report = tagConnectionReviewReport(project);
    expect(report.invalidCount).toBe(3);
    expect(report.invalidProduceCount).toBe(1);
    expect(report.invalidConsumedRpiCount).toBe(1);
    expect(report.missingProducerCount).toBe(1);
    expect(report.missingRemoteTagCount).toBe(1);
    expect(report.rows.find((row) => row.tagName === "TooMany")?.issues).toEqual(["invalid-produce-count"]);
    expect(report.rows.find((row) => row.tagName === "MissingRemote")?.issues).toEqual([
      "missing-producing-controller",
      "missing-remote-tag",
    ]);
    expect(report.rows.find((row) => row.tagName === "BadRpi")).toMatchObject({
      rpi: 0,
      issues: ["invalid-consumed-rpi"],
    });
    expect(report.warnings.join("\n")).toMatch(/produce count/);
    expect(report.warnings.join("\n")).toMatch(/RPI must be positive/);
    expect(report.warnings.join("\n")).toMatch(/missing producing controller/);
  });

  it("reports program-scoped and conflicting connection tags", () => {
    const project = createProject("Connection Scope");
    const controller = createController(project.id, "Ctl");
    const program = createProgram(controller.id, "Line1");
    const scoped = producedTag(controller.id, "ScopedProduced", 4);
    scoped.scope = "program";
    scoped.programId = program.id;
    program.programTags.push(scoped);
    const conflicting = producedTag(controller.id, "Both", 4);
    conflicting.consumed = true;
    conflicting.consumeInfo = { producer: "RemoteCtl", remoteTag: "RemoteBoth" };
    controller.controllerTags.push(conflicting);
    controller.programs.push(program);
    project.controllers.push(controller);

    const report = tagConnectionReviewReport(project);
    expect(report.conflictingCount).toBe(1);
    expect(report.programScopedCount).toBe(1);
    expect(report.invalidCount).toBe(2);
    expect(report.rows.find((row) => row.tagName === "Both")).toMatchObject({
      role: "conflicting",
      issues: ["both-produced-and-consumed"],
    });
    expect(report.rows.find((row) => row.tagName === "ScopedProduced")).toMatchObject({
      scope: "program",
      programName: "Line1",
      issues: ["program-scoped"],
    });
  });
});
