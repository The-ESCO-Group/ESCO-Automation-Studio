import { createController, createProject } from "@esco/core";
import { describe, expect, it } from "vitest";
import { controllerCommPortReviewReport } from "./controller-comm-port-review";

describe("controllerCommPortReviewReport", () => {
  it("projects imported serial communication ports with explicit offline boundaries", () => {
    const project = createProject("SerialProject");
    const controller = createController(project.id, "SerialCtl");
    controller.commPorts = {
      serialPorts: [
        {
          id: "serial-0",
          attributes: {
            Channel: "0",
            BaudRate: "19200",
            Parity: "No Parity",
            DataBits: "8 Bits of Data",
            StopBits: "1 Stop Bit",
            ComDriverId: "DF1",
            ControlLine: "No Handshake",
          },
          protocols: [
            { id: "ascii-0", elementName: "ASCII", attributes: { AppendCharacter1: "13" } },
            { id: "df1-0", elementName: "DF1", attributes: { ACKTimeout: "50" } },
          ],
        },
      ],
    };
    project.controllers.push(controller);

    const report = controllerCommPortReviewReport(project);

    expect(report.configuredControllerCount).toBe(1);
    expect(report.serialPortCount).toBe(1);
    expect(report.protocolCount).toBe(2);
    expect(report.reviewableCount).toBe(1);
    expect(report.issueCount).toBe(0);
    expect(report.rows[0]).toMatchObject({
      controllerName: "SerialCtl",
      serialPortCount: 1,
      protocolCount: 2,
      controllerCommunicationModelled: false,
      serialPortAccessModelled: false,
      df1RuntimeModelled: false,
      asciiChannelHardwareModelled: false,
      liveChannelStatusModelled: false,
    });
    expect(report.rows[0]?.ports[0]).toMatchObject({
      channel: "0",
      baudRate: "19200",
      dataBits: "8 Bits of Data",
      stopBits: "1 Stop Bit",
      controlLine: "No Handshake",
      comDriverId: "DF1",
      protocolNames: ["ASCII", "DF1"],
      duplicate: false,
    });
    expect(report.rows[0]?.boundaries).toContain("no-serial-port-access");
  });

  it("flags malformed serial communication settings", () => {
    const project = createProject("SerialProject");
    const controller = createController(project.id, "SerialCtl");
    controller.commPorts = {
      serialPorts: [
        {
          id: "serial-0",
          attributes: {
            Channel: "0",
            BaudRate: "fast",
            DataBits: "9 Bits of Data",
            StopBits: "3 Stop Bits",
          },
          protocols: [],
        },
        {
          id: "serial-1",
          attributes: {
            Channel: "0",
            BaudRate: "9600",
            DataBits: "8",
            StopBits: "1",
          },
          protocols: [{ id: "df1-1", elementName: "DF1", attributes: {} }],
        },
      ],
    };
    project.controllers.push(controller);

    const report = controllerCommPortReviewReport(project);

    expect(report.issueCount).toBe(1);
    expect(report.duplicateSerialChannelCount).toBe(1);
    expect(report.missingSerialProtocolCount).toBe(1);
    expect(report.invalidBaudRateCount).toBe(1);
    expect(report.invalidDataBitsCount).toBe(1);
    expect(report.invalidStopBitsCount).toBe(1);
    expect(report.rows[0]?.issues).toEqual([
      "duplicate-serial-channel",
      "missing-serial-protocol",
      "invalid-baud-rate",
      "invalid-data-bits",
      "invalid-stop-bits",
    ]);
    expect(report.rows[0]?.ports[0]?.duplicate).toBe(true);
    expect(report.rows[0]?.ports[0]?.issues).toEqual([
      "duplicate-serial-channel",
      "missing-serial-protocol",
      "invalid-baud-rate",
      "invalid-data-bits",
      "invalid-stop-bits",
    ]);
  });
});
