import { describe, expect, it } from "vitest";
import { createController, createProject, type IoModule } from "@esco/core";
import { ioModuleReviewReport } from "./io-module-review";

interface ProfileChannel {
  id?: string;
  label?: string;
  direction?: string;
  signal?: string;
  enabled?: boolean;
  dataFormat?: string;
  range?: string;
  diagnostic?: string;
}

type ProfiledIoModule = IoModule & { profileChannels?: ProfileChannel[] };

function module(input: Partial<ProfiledIoModule> & Pick<IoModule, "id" | "name">): ProfiledIoModule {
  const row: ProfiledIoModule = {
    id: input.id,
    name: input.name,
    catalogNumber: input.catalogNumber ?? "1756-IB16",
    slot: input.slot,
    description: input.description,
    parentModule: input.parentModule,
    parentPortId: input.parentPortId,
    commPath: input.commPath,
    vendor: input.vendor,
    productType: input.productType,
    productCode: input.productCode,
    majorRevision: input.majorRevision,
    minorRevision: input.minorRevision,
    electronicKeying: input.electronicKeying,
    inhibited: input.inhibited,
    majorFault: input.majorFault,
    ports: input.ports ?? [{ id: "1", type: "Backplane", address: String(input.slot ?? 0) }],
    connections: input.connections,
  };
  if (input.profileChannels) row.profileChannels = input.profileChannels;
  return row;
}

describe("ioModuleReviewReport", () => {
  it("reviews imported I/O module identity, ports, keying, inhibit, and MajorFault metadata", () => {
    const project = createProject("I/O Review");
    const controller = createController(project.id, "Ctl");
    controller.ioConfiguration.modules.push(
      module({
        id: "local",
        name: "Local",
        catalogNumber: "1756-L85E",
        slot: 0,
        electronicKeying: "CompatibleModule",
        majorRevision: "33",
        minorRevision: "11",
        majorFault: true,
        ports: [{ id: "1", type: "ICP", address: "0", upstream: false, busSize: 17 }],
      }),
      module({
        id: "di",
        name: "DI_01",
        slot: 1,
        parentModule: "Local",
        parentPortId: "1",
        inhibited: true,
        commPath: "Local,1",
      }),
    );
    project.controllers.push(controller);

    const report = ioModuleReviewReport(project);
    expect(report.moduleCount).toBe(2);
    expect(report.reviewableCount).toBe(2);
    expect(report.inhibitedCount).toBe(1);
    expect(report.majorFaultCount).toBe(1);
    expect(report.issueCount).toBe(0);
    expect(report.rows[0]).toMatchObject({
      name: "Local",
      catalogNumber: "1756-L85E",
      majorFaultOnConnectionLoss: true,
      connectionModelled: false,
      electronicKeyingEnforced: false,
      majorFaultInjected: false,
    });
    expect(report.rows[0]?.boundaries).toEqual(expect.arrayContaining([
      "no-controller-communication",
      "no-module-connection",
      "no-electronic-keying-enforcement",
      "no-major-fault-injection",
    ]));
    expect(report.rows[1]).toMatchObject({
      name: "DI_01",
      status: "inhibited",
      parentModule: "Local",
      parentPortId: "1",
      commPath: "Local,1",
    });
  });

  it("flags missing parent topology, parent ports, catalog numbers, and ports", () => {
    const project = createProject("I/O Issues");
    const controller = createController(project.id, "Ctl");
    controller.ioConfiguration.modules.push(
      module({ id: "local", name: "Local", ports: [{ id: "1", type: "ICP", address: "0" }] }),
      module({
        id: "missing-parent",
        name: "RemoteA",
        parentModule: "Missing",
        parentPortId: "1",
        ports: [],
      }),
      module({
        id: "missing-port",
        name: "RemoteB",
        parentModule: "Local",
        parentPortId: "9",
        catalogNumber: "",
      }),
    );
    project.controllers.push(controller);

    const report = ioModuleReviewReport(project);
    expect(report.issueCount).toBe(2);
    expect(report.missingParentCount).toBe(2);
    expect(report.rows.find((row) => row.name === "RemoteA")?.issues).toEqual([
      "no-ports",
      "missing-parent-module",
    ]);
    expect(report.rows.find((row) => row.name === "RemoteB")?.issues).toEqual([
      "missing-catalog-number",
      "missing-parent-port",
    ]);
    expect(report.warnings.join("\n")).toMatch(/missing parent module/);
    expect(report.warnings.join("\n")).toMatch(/missing catalog number/);
  });

  it("flags duplicate slots under the same parent and port", () => {
    const project = createProject("I/O Duplicate Slots");
    const controller = createController(project.id, "Ctl");
    controller.ioConfiguration.modules.push(
      module({ id: "local", name: "Local", ports: [{ id: "1", type: "ICP", address: "0" }] }),
      module({ id: "di-a", name: "DI_A", slot: 2, parentModule: "Local", parentPortId: "1" }),
      module({ id: "di-b", name: "DI_B", slot: 2, parentModule: "Local", parentPortId: "1" }),
      module({ id: "di-c", name: "DI_C", slot: 2, parentModule: "Local", parentPortId: "2" }),
    );
    project.controllers.push(controller);

    const report = ioModuleReviewReport(project);
    expect(report.duplicateSlotCount).toBe(2);
    expect(report.rows.find((row) => row.name === "DI_A")?.issues).toContain("duplicate-slot");
    expect(report.rows.find((row) => row.name === "DI_B")?.issues).toContain("duplicate-slot");
    expect(report.rows.find((row) => row.name === "DI_C")?.issues).not.toContain("duplicate-slot");
  });

  it("reviews imported module profile channel metadata without modelling profile downloads", () => {
    const project = createProject("I/O Profile Review");
    const controller = createController(project.id, "Ctl");
    controller.ioConfiguration.modules.push(
      module({
        id: "ai",
        name: "AI_01",
        catalogNumber: "1756-IF8",
        slot: 3,
        profileChannels: [
          {
            id: "Ch0",
            label: "Channel 0",
            direction: "Input",
            signal: "4-20 mA",
            enabled: true,
            dataFormat: "Float",
            range: "4-20 mA",
            diagnostic: "Open-wire detection",
          },
          {
            id: "Ch1",
            label: "Channel 1",
            direction: "Input",
            signal: "RTD",
            enabled: false,
            dataFormat: "Engineering Units",
            range: "RTD",
            diagnostic: "Disabled spare",
          },
        ],
      }),
    );
    project.controllers.push(controller);

    const report = ioModuleReviewReport(project);

    expect(report.profileChannelModuleCount).toBe(1);
    expect(report.disabledProfileChannelCount).toBe(1);
    expect(report.rows[0]).toMatchObject({
      name: "AI_01",
      profileChannelCount: 2,
      disabledProfileChannelCount: 1,
      profileChannelConfigurationDownloaded: false,
      profileChannels: [
        {
          id: "Ch0",
          label: "Channel 0",
          signal: "4-20 mA",
          range: "4-20 mA",
          diagnostic: "Open-wire detection",
        },
        {
          id: "Ch1",
          label: "Channel 1",
          enabled: false,
          dataFormat: "Engineering Units",
        },
      ],
    });
    expect(report.rows[0]?.boundaries).toContain("no-profile-channel-configuration-download");
    expect(report.rows[0]?.message).toContain("profile-channel metadata is reviewable offline");
  });

  it("surfaces synthetic offline diagnostics for connection and keying metadata", () => {
    const project = createProject("I/O Synthetic Diagnostics");
    const controller = createController(project.id, "Ctl");
    controller.ioConfiguration.modules.push(
      module({
        id: "adapter",
        name: "Adapter_01",
        catalogNumber: "1756-EN2T",
        slot: 4,
        electronicKeying: "ExactMatch",
        majorRevision: "5",
        minorRevision: "",
        connections: [
          {
            name: "Input",
            type: "Input",
            rpi: 0,
            inputConnectionType: "AnalogOnly",
            inputProductionTrigger: "BadTrigger",
          },
        ],
      }),
      module({
        id: "generic",
        name: "Generic_01",
        catalogNumber: "GENERIC-ETHERNET",
        slot: 5,
        electronicKeying: "Disabled",
        profileChannels: [{ id: "Ch0", label: "Channel 0", enabled: false }],
      }),
    );
    project.controllers.push(controller);

    const report = ioModuleReviewReport(project);
    const adapter = report.rows.find((row) => row.name === "Adapter_01")!;
    const generic = report.rows.find((row) => row.name === "Generic_01")!;

    expect(adapter.status).toBe("needs-attention");
    expect(adapter.issues).toEqual([
      "invalid-rpi",
      "invalid-input-connection-type",
      "invalid-input-production-trigger",
      "missing-keying-revision",
    ]);
    expect(adapter.connections[0]).toMatchObject({
      name: "Input",
      rpi: 0,
      status: "invalid",
      inputConnectionType: "AnalogOnly",
      inputProductionTrigger: "BadTrigger",
    });
    expect(adapter.diagnosticErrorCount).toBeGreaterThanOrEqual(2);
    expect(adapter.diagnostics.map((row) => row.label)).toEqual(expect.arrayContaining([
      "Connection Input",
      "Missing keying revision",
      "No channel table",
      "Offline profile review",
    ]));

    expect(generic.status).toBe("reviewable");
    expect(generic.diagnosticWarningCount).toBeGreaterThanOrEqual(3);
    expect(generic.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: "warning", label: "No connection metadata" }),
      expect.objectContaining({ status: "warning", label: "Electronic keying disabled" }),
      expect.objectContaining({ status: "warning", label: "Channel profile loaded" }),
    ]));
    expect(report.connectionMetadataCount).toBe(1);
    expect(report.diagnosticErrorCount).toBe(adapter.diagnosticErrorCount);
    expect(report.diagnosticWarningCount).toBe(adapter.diagnosticWarningCount + generic.diagnosticWarningCount);
  });

  it("classifies specialty AOP-style module profiles for offline review only", () => {
    const project = createProject("Advanced Module Profiles");
    const controller = createController(project.id, "Ctl");
    controller.ioConfiguration.modules.push(
      module({ id: "drive", name: "Drive_01", catalogNumber: "PowerFlex 755", productType: "AC Drive" }),
      module({ id: "hart", name: "HART_AI", catalogNumber: "1756-IF8IH", productType: "HART Analog Input" }),
      module({ id: "bridge", name: "EN2T", catalogNumber: "1756-EN2T", productType: "EtherNet/IP Bridge" }),
      module({ id: "flex", name: "FlexAI", catalogNumber: "5094-IF8", productType: "FLEX 5000 Analog Input" }),
      module({ id: "flex-hart", name: "FlexHart", catalogNumber: "5094-IF8IH", productType: "FLEX 5000 HART Analog Input" }),
    );
    project.controllers.push(controller);

    const report = ioModuleReviewReport(project);
    expect(report.advancedProfileModuleCount).toBe(5);
    expect(report.driveProfileCount).toBe(1);
    expect(report.flex5000ProfileCount).toBe(2);
    expect(report.hartProfileCount).toBe(2);
    expect(report.bridgeProfileCount).toBe(1);

    const drive = report.rows.find((row) => row.name === "Drive_01")!;
    expect(drive).toMatchObject({
      advancedProfileFamily: "drive",
      advancedProfileSignals: ["drive"],
      advancedProfileLabel: "AC drive profile",
      advancedProfileReviewable: true,
      connectionModelled: false,
      profileChannelConfigurationDownloaded: false,
    });
    expect(drive.message).toMatch(/no live AOP profile download/i);
    expect(drive.diagnostics.some((diagnostic) =>
      diagnostic.source === "advanced-profile" &&
      /does not download an AOP profile/i.test(diagnostic.detail)
    )).toBe(true);

    expect(report.rows.find((row) => row.name === "HART_AI")?.advancedProfileFamily).toBe("hart");
    expect(report.rows.find((row) => row.name === "EN2T")?.advancedProfileFamily).toBe("bridge");
    expect(report.rows.find((row) => row.name === "FlexAI")?.advancedProfileFamily).toBe("flex-5000");
    expect(report.rows.find((row) => row.name === "FlexHart")).toMatchObject({
      advancedProfileFamily: "hart",
      advancedProfileSignals: ["flex-5000", "hart"],
    });
  });
});
