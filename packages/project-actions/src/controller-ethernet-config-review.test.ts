import { createController, createProject } from "@esco/core";
import { describe, expect, it } from "vitest";
import { controllerEthernetConfigReviewReport } from "./controller-ethernet-config-review";

describe("controllerEthernetConfigReviewReport", () => {
  it("projects imported EtherNet/IP configuration with explicit offline boundaries", () => {
    const project = createProject("EthernetProject");
    const controller = createController(project.id, "EthernetCtl");
    controller.ethernetConfig = {
      internetProtocol: {
        attributes: {
          ConfigType: "Manual",
          IPAddress: "192.168.1.10",
          SubnetMask: "255.255.255.0",
          Gateway: "192.168.1.1",
          HostName: "line1",
        },
      },
      ports: [
        {
          id: "port-1",
          attributes: {
            Port: "1",
            PortEnabled: "Enabled",
            AutoNegotiateEnabled: "Enabled",
            InterfaceSpeed: "100",
            DuplexMode: "Full",
          },
        },
      ],
      network: {
        attributes: {
          SupervisorModeEnabled: "Enabled",
          SupervisorPrecedence: "100",
          BeaconInterval: "400",
          BeaconTimeout: "1960",
          VLANID: "10",
        },
      },
    };
    project.controllers.push(controller);

    const report = controllerEthernetConfigReviewReport(project);

    expect(report.configuredControllerCount).toBe(1);
    expect(report.ethernetPortCount).toBe(1);
    expect(report.reviewableCount).toBe(1);
    expect(report.issueCount).toBe(0);
    expect(report.rows[0]).toMatchObject({
      controllerName: "EthernetCtl",
      configType: "Manual",
      ipAddress: "192.168.1.10",
      subnetMask: "255.255.255.0",
      hostName: "line1",
      supervisorPrecedence: "100",
      vlanId: "10",
      controllerCommunicationModelled: false,
      ipSettingApplyModelled: false,
      networkBrowseModelled: false,
      livePortStateModelled: false,
      networkDiagnosticsModelled: false,
    });
    expect(report.rows[0]?.ports[0]).toMatchObject({
      port: "1",
      interfaceSpeed: "100",
      duplexMode: "Full",
      duplicate: false,
    });
    expect(report.rows[0]?.boundaries).toContain("no-ip-setting-apply");
  });

  it("flags malformed EtherNet/IP configuration rows", () => {
    const project = createProject("EthernetProject");
    const controller = createController(project.id, "EthernetCtl");
    controller.ethernetConfig = {
      internetProtocol: {
        attributes: {
          ConfigType: "Manual",
          IPAddress: "999.1.1.1",
        },
      },
      ports: [
        { id: "port-1", attributes: { Port: "1", InterfaceSpeed: "5", DuplexMode: "Sideways" } },
        { id: "port-2", attributes: { Port: "1", InterfaceSpeed: "100", DuplexMode: "Full" } },
      ],
      network: {
        attributes: {
          SupervisorPrecedence: "300",
          BeaconInterval: "99",
          BeaconTimeout: "199",
          VLANID: "5000",
        },
      },
    };
    project.controllers.push(controller);

    const report = controllerEthernetConfigReviewReport(project);

    expect(report.issueCount).toBe(1);
    expect(report.manualIpMissingAddressCount).toBe(1);
    expect(report.invalidIpAddressCount).toBe(1);
    expect(report.duplicateEthernetPortCount).toBe(1);
    expect(report.invalidInterfaceSpeedCount).toBe(1);
    expect(report.invalidDuplexModeCount).toBe(1);
    expect(report.invalidVlanIdCount).toBe(1);
    expect(report.invalidRingTimingCount).toBe(1);
    expect(report.rows[0]?.issues).toEqual([
      "manual-ip-missing-address",
      "invalid-ip-address",
      "duplicate-ethernet-port",
      "invalid-interface-speed",
      "invalid-duplex-mode",
      "invalid-vlan-id",
      "invalid-ring-timing",
    ]);
    expect(report.rows[0]?.ports[0]?.duplicate).toBe(true);
    expect(report.rows[0]?.ports[0]?.issues).toEqual(["invalid-interface-speed", "invalid-duplex-mode"]);
  });
});
