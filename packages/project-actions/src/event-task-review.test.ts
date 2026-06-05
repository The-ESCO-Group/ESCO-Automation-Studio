import { describe, expect, it } from "vitest";
import { createContinuousTask, createController, createProgram, createProject, createTag } from "@esco/core";
import { eventTaskReviewReport } from "./event-task-review";

describe("eventTaskReviewReport", () => {
  it("reviews imported EVENT task trigger metadata and resolves controller trigger tags", () => {
    const project = createProject("Event Review");
    const controller = createController(project.id, "EventCtl");
    const program = createProgram(controller.id, "EventProgram");
    const task = createContinuousTask(controller.id, "ConsumedDataTask", [program.id]);
    task.type = "event";
    task.priority = 10;
    task.watchdogMs = 500;
    task.disableUpdateOutputs = true;
    task.eventInfo = {
      eventTrigger: "Consumed Tag Connection",
      eventTag: "RemoteData",
      enableTimeout: false,
    };
    controller.controllerTags.push(createTag(controller.id, "RemoteData", "DINT"));
    controller.programs.push(program);
    controller.tasks.push(task);
    project.controllers.push(controller);

    const report = eventTaskReviewReport(project);
    expect(report.eventTaskCount).toBe(1);
    expect(report.taskWithEventInfoCount).toBe(1);
    expect(report.timeoutMetadataCount).toBe(1);
    expect(report.timeoutEnabledCount).toBe(0);
    expect(report.reviewableCount).toBe(1);
    expect(report.issueCount).toBe(0);
    expect(report.tagBoundCount).toBe(1);
    expect(report.resolvedTagCount).toBe(1);
    expect(report.rows[0]).toMatchObject({
      controllerName: "EventCtl",
      taskName: "ConsumedDataTask",
      taskType: "event",
      eventInfoPresent: true,
      eventTrigger: "Consumed Tag Connection",
      eventTag: "RemoteData",
      enableTimeout: false,
      enableTimeoutPresent: true,
      scheduledProgramCount: 1,
      priority: 10,
      watchdogMs: 500,
      outputUpdateDisabled: true,
      eventSchedulingModelled: false,
      triggerMonitoringModelled: false,
      eventInstructionDispatchModelled: false,
      eventTimeoutWatchdogModelled: false,
      tagReference: {
        path: "RemoteData",
        baseTag: "RemoteData",
        scope: "controller",
        resolved: true,
        tagName: "RemoteData",
        dataType: "DINT",
      },
    });
    expect(report.rows[0]?.boundaries).toEqual(expect.arrayContaining([
      "no-controller-event-scheduling",
      "no-event-trigger-monitoring",
      "no-event-instruction-dispatch",
      "no-event-timeout-watchdog",
      "no-consumed-tag-trigger-transfer",
    ]));
  });

  it("treats EVENT Instruction Only triggers as reviewable without a tag binding", () => {
    const project = createProject("Instruction Event");
    const controller = createController(project.id, "Ctl");
    const task = createContinuousTask(controller.id, "InstructionOnly");
    task.type = "event";
    task.eventInfo = { eventTrigger: "EVENT Instruction Only", enableTimeout: true };
    controller.tasks.push(task);
    project.controllers.push(controller);

    const report = eventTaskReviewReport(project);
    expect(report.rows[0]).toMatchObject({
      taskName: "InstructionOnly",
      eventTrigger: "EVENT Instruction Only",
      enableTimeout: true,
      enableTimeoutPresent: true,
      status: "reviewable",
      tagReference: undefined,
      issues: [],
    });
    expect(report.taskWithEventInfoCount).toBe(1);
    expect(report.timeoutMetadataCount).toBe(1);
    expect(report.timeoutEnabledCount).toBe(1);
    expect(report.tagBoundCount).toBe(0);
  });

  it("counts imported EnableTimeout metadata even when no trigger is imported", () => {
    const project = createProject("Timeout Only");
    const controller = createController(project.id, "Ctl");
    const task = createContinuousTask(controller.id, "TimeoutOnly");
    task.type = "event";
    task.eventInfo = { enableTimeout: false };
    controller.tasks.push(task);
    project.controllers.push(controller);

    const report = eventTaskReviewReport(project);
    expect(report.taskWithEventInfoCount).toBe(1);
    expect(report.timeoutMetadataCount).toBe(1);
    expect(report.timeoutEnabledCount).toBe(0);
    expect(report.rows[0]).toMatchObject({
      taskName: "TimeoutOnly",
      eventInfoPresent: true,
      enableTimeout: false,
      enableTimeoutPresent: true,
      status: "needs-attention",
      issues: ["missing-event-trigger"],
      eventTimeoutWatchdogModelled: false,
    });
    expect(report.rows[0]?.boundaries).toContain("no-event-timeout-watchdog");
  });

  it("flags missing triggers, missing event tags, unresolved tags, and non-event EventInfo", () => {
    const project = createProject("Event Issues");
    const controller = createController(project.id, "Ctl");
    const missingTrigger = createContinuousTask(controller.id, "MissingTrigger");
    missingTrigger.type = "event";

    const missingTag = createContinuousTask(controller.id, "MissingTag");
    missingTag.type = "event";
    missingTag.eventInfo = { eventTrigger: "Consumed Tag Connection" };

    const unresolved = createContinuousTask(controller.id, "UnresolvedTag");
    unresolved.type = "event";
    unresolved.eventInfo = { eventTrigger: "Module Input Data State Change", eventTag: "Local:1:I.Data" };

    const wrongType = createContinuousTask(controller.id, "PeriodicWithEventInfo");
    wrongType.type = "periodic";
    wrongType.eventInfo = { eventTrigger: "EVENT Instruction Only" };

    controller.tasks.push(missingTrigger, missingTag, unresolved, wrongType);
    project.controllers.push(controller);

    const report = eventTaskReviewReport(project);
    expect(report.eventTaskCount).toBe(3);
    expect(report.issueCount).toBe(4);
    expect(report.missingTriggerCount).toBe(1);
    expect(report.missingTagCount).toBe(1);
    expect(report.unresolvedTagCount).toBe(1);
    expect(report.nonEventInfoCount).toBe(1);
    expect(report.rows.map((row) => row.issues)).toEqual([
      ["missing-event-trigger"],
      ["missing-event-tag"],
      ["unresolved-event-tag"],
      ["event-info-on-non-event-task"],
    ]);
    expect(report.rows.find((row) => row.taskName === "UnresolvedTag")?.tagReference).toMatchObject({
      path: "Local:1:I.Data",
      baseTag: "Local:1:I",
      scope: "unresolved",
      resolved: false,
    });
    expect(report.rows.find((row) => row.taskName === "UnresolvedTag")?.boundaries).toContain("no-module-input-state-change-monitor");
    expect(report.warnings.join("\n")).toMatch(/missing event trigger/);
    expect(report.warnings.join("\n")).toMatch(/EventInfo is attached/);
  });
});
