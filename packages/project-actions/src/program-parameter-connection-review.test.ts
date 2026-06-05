import { createController, createProgram, createProject } from "@esco/core";
import { describe, expect, it } from "vitest";
import { programParameterConnectionReviewReport } from "./program-parameter-connection-review";

describe("programParameterConnectionReviewReport", () => {
  it("resolves imported program parameter connections with explicit offline boundaries", () => {
    const project = createProject("ParamProject");
    const controller = createController(project.id, "ParamCtl");
    const producer = createProgram(controller.id, "ProducerProgram");
    producer.parameters = [
      { name: "ProducedSpeed", dataType: "DINT", usage: "Output", externalAccess: "read-only" },
    ];
    const consumer = createProgram(controller.id, "ConsumerProgram");
    consumer.parameters = [
      { name: "SpeedCommand", dataType: "DINT", usage: "Input", required: true },
    ];
    controller.programs.push(producer, consumer);
    controller.parameterConnections = [
      {
        id: "param-connection-1",
        endPoint1: "ProducerProgram.ProducedSpeed",
        endPoint2: "ConsumerProgram.SpeedCommand",
      },
    ];
    project.controllers.push(controller);

    const report = programParameterConnectionReviewReport(project);

    expect(report.connectionCount).toBe(1);
    expect(report.reviewableCount).toBe(1);
    expect(report.issueCount).toBe(0);
    expect(report.rows[0]).toMatchObject({
      controllerName: "ParamCtl",
      connectionModelled: false,
      runtimeTransferModelled: false,
      controllerVerified: false,
      downloadPreflightModelled: false,
    });
    expect(report.rows[0]?.endPoint1).toMatchObject({
      programName: "ProducerProgram",
      parameterName: "ProducedSpeed",
      dataType: "DINT",
      usage: "Output",
      resolved: true,
    });
    expect(report.rows[0]?.endPoint2).toMatchObject({
      programName: "ConsumerProgram",
      parameterName: "SpeedCommand",
      dataType: "DINT",
      usage: "Input",
      required: true,
      resolved: true,
    });
    expect(report.rows[0]?.boundaries).toContain("no-runtime-parameter-transfer");
  });

  it("flags malformed, unresolved, duplicate, and incompatible connections", () => {
    const project = createProject("ParamProject");
    const controller = createController(project.id, "ParamCtl");
    const producer = createProgram(controller.id, "ProducerProgram");
    producer.parameters = [{ name: "ProducedSpeed", dataType: "DINT", usage: "Output" }];
    const consumer = createProgram(controller.id, "ConsumerProgram");
    consumer.parameters = [{ name: "SpeedCommand", dataType: "REAL", usage: "Input" }];
    controller.programs.push(producer, consumer);
    controller.parameterConnections = [
      {
        id: "param-connection-1",
        endPoint1: "ProducerProgram.ProducedSpeed",
        endPoint2: "ConsumerProgram.SpeedCommand",
      },
      {
        id: "param-connection-2",
        endPoint1: "ConsumerProgram.SpeedCommand",
        endPoint2: "ProducerProgram.ProducedSpeed",
      },
      { id: "param-connection-3", endPoint1: "BadEndpoint", endPoint2: "" },
      {
        id: "param-connection-4",
        endPoint1: "MissingProgram.Value",
        endPoint2: "ProducerProgram.MissingParameter",
      },
    ];
    project.controllers.push(controller);

    const report = programParameterConnectionReviewReport(project);

    expect(report.connectionCount).toBe(4);
    expect(report.issueCount).toBe(4);
    expect(report.duplicateConnectionCount).toBe(2);
    expect(report.incompatibleDataTypeCount).toBe(2);
    expect(report.malformedEndpointCount).toBe(1);
    expect(report.missingEndpointCount).toBe(1);
    expect(report.unresolvedProgramCount).toBe(1);
    expect(report.unresolvedParameterCount).toBe(1);
    expect(report.rows[0]?.issues).toEqual(["duplicate-connection", "incompatible-data-type"]);
    expect(report.rows[2]?.issues).toEqual(["malformed-endpoint", "missing-endpoint"]);
    expect(report.rows[3]?.issues).toEqual(["unresolved-program", "unresolved-parameter"]);
  });
});
