import { describe, expect, it } from "vitest";
import { SimulatorGatewayDriver } from "./drivers";
import {
  InMemoryExecutableTargetAdapterRegistry,
  listPlcDownloadAdapters,
  listTargetAdapterMetadata,
  MetadataOnlyTargetAdapterRegistry,
  PLC_DOWNLOAD_ADAPTERS,
  PLC_DOWNLOAD_REQUIRED_GATES,
  TARGET_ADAPTER_REQUIRED_GATES,
  targetAdapterAllowsPhysicalDownload,
} from "./download-adapters";
import { describeControllerDriver } from "./gateway";
import type { DownloadPreflightResult, TargetAdapter } from "./types";

describe("vendor-neutral PLC download adapter registry", () => {
  it("lists planned PLC-family target packs without exposing execution handles", () => {
    const adapters = listPlcDownloadAdapters();

    expect(adapters.map((adapter) => adapter.id)).toEqual([
      "esco-runtime",
      "allen-bradley-logix",
      "siemens-s7",
      "codesys-iec",
      "beckhoff-twincat",
      "schneider-modicon",
      "omron-nx-nj",
      "mitsubishi-melsec",
      "ge-emerson-pac",
      "generic-opcua-data",
      "generic-modbus-data",
      "generic-mqtt-sparkplug",
    ]);
    expect(adapters.find((adapter) => adapter.id === "allen-bradley-logix")).toMatchObject({
      vendor: "allen-bradley",
      strategy: "ethernetip-cip-planned",
      validationState: "software-wired",
      physicalDownloadEnabled: false,
      verified: false,
    });
    expect(adapters.find((adapter) => adapter.id === "siemens-s7")).toMatchObject({
      vendor: "siemens",
      validationState: "planned",
      physicalDownloadEnabled: false,
    });

    for (const adapter of adapters) {
      expect(adapter.executionAvailable).toBe(false);
      expect(adapter.physicalDownloadEnabled).toBe(false);
      expect(adapter.verified).toBe(false);
      expect(adapter.executionAvailable).toBe(adapter.safety.executionAvailable);
      expect(adapter.physicalDownloadEnabled).toBe(adapter.safety.physicalDownloadEnabled);
      expect(adapter.verified).toBe(adapter.safety.verified);
      expect(adapter.capabilities.physicalDownload).toBe(false);
      if (adapter.realControllerIo) {
        expect(adapter.safety.defaultMode).toBe("read-only");
        expect(adapter.safety.riskLevel).toBe("critical");
      }
      expect(adapter.requiredGates).toEqual([...PLC_DOWNLOAD_REQUIRED_GATES]);
      expect(adapter.requiredGates).toEqual([...TARGET_ADAPTER_REQUIRED_GATES]);
      expect(targetAdapterAllowsPhysicalDownload(adapter)).toBe(false);
      expect(Object.values(adapter).some((value) => typeof value === "function")).toBe(false);
    }
  });

  it("returns defensive copies so callers cannot mutate the registry", () => {
    const first = listTargetAdapterMetadata();
    first[0].families.push("Mutated");
    first[0].requiredGates.length = 0;
    first[0].capabilities.physicalDownload = true;
    first[0].safety.verified = true;

    const second = listPlcDownloadAdapters();

    expect(second[0].families).not.toContain("Mutated");
    expect(second[0].requiredGates).toEqual([...PLC_DOWNLOAD_REQUIRED_GATES]);
    expect(second[0].capabilities.physicalDownload).toBe(false);
    expect(second[0].safety.verified).toBe(false);
    expect(PLC_DOWNLOAD_ADAPTERS[0].families).not.toContain("Mutated");
  });

  it("returns a structured blocked download preflight for metadata-only target adapters", async () => {
    const registry = new MetadataOnlyTargetAdapterRegistry();

    const preflight = await registry.preflightDownload({ targetAdapterId: "allen-bradley-logix" });

    expect(preflight).toMatchObject({
      targetAdapterId: "allen-bradley-logix",
      ok: false,
      physicalDownloadAllowed: false,
      executionAvailable: false,
      physicalDownloadEnabled: false,
      verified: false,
      defaultMode: "read-only",
      riskLevel: "critical",
    });
    expect(preflight.blockers.join(" ")).toContain("Physical PLC download is blocked");
    expect(preflight.requiredGates).toEqual([...TARGET_ADAPTER_REQUIRED_GATES]);
    expect(preflight.gateResults).toHaveLength(TARGET_ADAPTER_REQUIRED_GATES.length);
    expect(preflight.gateResults.every((gate) => gate.required)).toBe(true);
    expect(preflight.gateResults.every((gate) => gate.state === "blocked")).toBe(true);
    expect(preflight.gateResults[0]).toMatchObject({
      gate: "adapter-policy-approval",
      state: "blocked",
    });
  });

  it("does not call executable adapters until backend metadata is verified and download-enabled", async () => {
    const metadata = listTargetAdapterMetadata().find((adapter) => adapter.id === "allen-bradley-logix");
    expect(metadata).toBeDefined();
    let called = false;
    const executable: TargetAdapter = {
      metadata: metadata!,
      async preflightDownload(): Promise<DownloadPreflightResult> {
        called = true;
        return {
          targetAdapterId: metadata!.id,
          ok: true,
          physicalDownloadAllowed: true,
          executionAvailable: true,
          physicalDownloadEnabled: true,
          verified: true,
          defaultMode: "download-capable",
          riskLevel: "critical",
          requiredGates: [],
          gateResults: [],
          blockers: [],
          warnings: [],
          message: "Should not be reached with blocked backend metadata.",
          checkedAt: "t",
        };
      },
    };
    const registry = new InMemoryExecutableTargetAdapterRegistry();
    registry.register(executable);

    const preflight = await registry.preflightDownload({ targetAdapterId: metadata!.id });

    expect(called).toBe(false);
    expect(preflight.ok).toBe(false);
    expect(preflight.physicalDownloadAllowed).toBe(false);
    expect(preflight.blockers.length).toBeGreaterThan(0);
  });

  it("does not enable the gateway public download capability", () => {
    const simulator = new SimulatorGatewayDriver({
      identity: {
        controllerName: "ESCO_SIM",
        controllerType: "ESCO Virtual Controller",
        projectName: "Simulator",
        projectSignature: "simulator",
      },
      allowWrites: true,
    });

    const summary = describeControllerDriver(simulator);

    expect(summary.capabilities.canDownloadProject).toBe(false);
    expect(summary.capabilities.canWriteTags).toBe(false);
    expect(summary.safetyNote).toContain("read-only");
  });
});
