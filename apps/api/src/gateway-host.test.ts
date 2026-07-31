import { afterEach, describe, expect, it } from "vitest";
import {
  bytesEqual,
  buildIdentityRequest,
  buildReadTagRequest,
  buildTagListRequest,
  encodeMultipleServicePacket,
  encodeMultipleServiceReply,
} from "@esco/driver-ethernetip";
import { FakeLogixServer } from "@esco/driver-ethernetip-node";
import {
  ControllerGateway,
  type CompareResult,
  type ConnectionResult,
  type ControllerDriver,
  type ControllerIdentity,
  type ControllerDriverSummary,
  type DownloadPreflightResult,
  type GatewayValidationReadinessReport,
  type IdentityProofTagExport,
  type OnlineSnapshot,
  type PlcDownloadAdapterDescriptor,
  type ProjectSnapshot,
  type TargetAdapterMetadata,
  type TagDefinition,
  type TagValue,
} from "@esco/controller-gateway";
import type { PlcProject } from "@esco/core";
import { GatewayHost, createBackendControllerDrivers, normalizeGatewaySessionId } from "./gateway-host";
import { SiteGatewayPolicy, type SiteGatewayPolicyReport } from "./site-gateway-policy";

function hexToBytes(hex: string): Uint8Array {
  return Uint8Array.from(hex.trim().split(/\s+/).map((pair) => Number.parseInt(pair, 16)));
}

const cleanups: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    await cleanups.pop()?.();
  }
});

/** Identity + tag database the fake EtherNet/IP target answers with. */
function demoCip(request: Uint8Array): Uint8Array | undefined {
  if (bytesEqual(request, buildIdentityRequest())) {
    return hexToBytes(
      "81 00 00 00 01 00 0e 00 96 00 21 0b 00 00 78 56 34 12 09 31 37 36 39 2d 4c 33 33 45",
    );
  }
  if (bytesEqual(request, buildReadTagRequest("Count"))) {
    return hexToBytes("cc 00 00 00 c4 00 d2 04 00 00");
  }
  if (bytesEqual(request, buildReadTagRequest("Pump"))) {
    return hexToBytes("cc 00 00 00 c4 00 d2 04 00 00");
  }
  if (bytesEqual(request, buildReadTagRequest("Missing"))) {
    return hexToBytes("cc 00 05 01 07 21"); // path destination unknown
  }
  if (
    bytesEqual(
      request,
      encodeMultipleServicePacket([
        buildReadTagRequest("Count"),
        buildReadTagRequest("Missing"),
      ]),
    )
  ) {
    // The driver batches via CIP Multiple Service Packet — answer like a target.
    return encodeMultipleServiceReply(
      [hexToBytes("cc 00 00 00 c4 00 d2 04 00 00"), hexToBytes("cc 00 05 01 07 21")],
      0x1e,
    );
  }
  if (bytesEqual(request, buildTagListRequest(0))) {
    return hexToBytes("d5 00 00 00 01 00 00 00 04 00 50 75 6d 70 c4 00");
  }
  return undefined;
}

async function startFakeTarget(): Promise<number> {
  const server = new FakeLogixServer({ handleCip: demoCip });
  const port = await server.listen();
  cleanups.push(() => server.close());
  return port;
}

function hostWithGateway(): GatewayHost {
  const host = new GatewayHost();
  cleanups.push(async () => {
    await host.closeIdleSessions(0, Number.POSITIVE_INFINITY);
  });
  return host;
}

const localProject = (): PlcProject => ({
  id: "project-1",
  name: "LocalLine",
  createdAt: "2026-06-07T00:00:00.000Z",
  updatedAt: "2026-06-07T00:00:00.000Z",
  controllers: [
    {
      id: "controller-1",
      projectId: "project-1",
      name: "PLC_1",
      processorType: "ControlLogix 5580",
      firmwareRevision: "36.011",
      tasks: [],
      programs: [],
      controllerTags: [],
      dataTypes: [],
      addOnInstructions: [],
      ioConfiguration: { modules: [] },
      trends: [],
      quickWatchLists: [],
      parameterConnections: [],
    },
  ],
});

describe("driver registry", () => {
  it("replaces the EtherNet/IP placeholder with the real backend driver", () => {
    const drivers = createBackendControllerDrivers();
    const ethernetip = drivers.find((driver) => driver.id === "ethernetip-cip-readonly");
    expect(ethernetip?.name).toBe("ESCO EtherNet/IP CIP Read-Only Driver");
    // The simulator stays for offline testing; OPC DA stays a placeholder.
    expect(ethernetip?.name).toBe("ESCO EtherNet/IP CIP Read-Only Driver");
    const opcua = drivers.find((driver) => driver.id === "opcua-generic-readonly");
    expect(opcua?.name).toBe("Generic OPC UA Read-Only Driver");
    expect(drivers.some((driver) => driver.kind === "simulator")).toBe(true);
    expect(drivers.some((driver) => driver.id === "opcda-legacy-placeholder")).toBe(true);
  });
});

describe("gateway session ids", () => {
  it("normalizes client session ids to a bounded header/query-safe key", () => {
    expect(normalizeGatewaySessionId(undefined)).toBe("default");
    expect(normalizeGatewaySessionId("   ")).toBe("default");
    expect(normalizeGatewaySessionId("  web-client.1:line-a  ")).toBe("web-client.1:line-a");
    expect(normalizeGatewaySessionId("client one/line#2")).toBe("client_one_line_2");
    expect(normalizeGatewaySessionId("x".repeat(140))).toHaveLength(128);
  });
});

describe("GatewayHost routing", () => {
  it("ignores non-gateway paths and 404s unknown gateway routes", async () => {
    const host = hostWithGateway();
    expect(await host.handle("GET", "/health", undefined)).toBeUndefined();
    expect(await host.handle("GET", "/api/other", undefined)).toBeUndefined();
    const unknown = await host.handle("GET", "/api/gateway/nope", undefined);
    expect(unknown?.status).toBe(404);
  });

  it("lists drivers and the offline session snapshot", async () => {
    const host = hostWithGateway();
    const drivers = await host.handle("GET", "/api/gateway/drivers", undefined);
    expect(drivers?.status).toBe(200);
    const driverSummaries = drivers?.body as ControllerDriverSummary[];
    expect(driverSummaries.map((d) => d.id)).toContain(
      "ethernetip-cip-readonly",
    );
    const ethernetip = driverSummaries.find((driver) => driver.id === "ethernetip-cip-readonly");
    expect(ethernetip?.capabilities).toMatchObject({
      canConnect: true,
      canBrowseTags: true,
      canReadTags: true,
      canBatchReadTags: true,
      canSubscribeTags: true,
      canUploadSnapshot: true,
      canWriteTags: false,
      canDownloadProject: false,
      canOnlineEdit: false,
      canForceTags: false,
      canModeChange: false,
      canClearFaults: false,
    });
    expect(ethernetip?.readOnly).toBe(true);
    expect(ethernetip?.connectionEvidence).toMatchObject({
      transportValidation: "software-wired",
      realControllerIo: true,
      hardwareValidated: false,
      verified: false,
    });
    const opcua = driverSummaries.find((driver) => driver.id === "opcua-generic-readonly");
    expect(opcua?.capabilities).toMatchObject({
      canConnect: true,
      canReadStatus: true,
      canReadFaults: false,
      canBrowseTags: true,
      canReadTags: true,
      canSubscribeTags: true,
      canWriteTags: false,
    });
    expect(opcua?.connectionEvidence.message).toContain("FactoryTalk Linx Gateway");

    const session = await host.handle("GET", "/api/gateway/session", undefined);
    expect((session?.body as OnlineSnapshot).state).toBe("offline");
    expect((session?.body as OnlineSnapshot).readOnly).toBe(true);
    expect((session?.body as OnlineSnapshot).sessionId).toBe("default");
  });

  it("reports gateway validation readiness without enabling real hardware routes", async () => {
    const host = hostWithGateway();
    const response = await host.handle("GET", "/api/gateway/validation-readiness", undefined);

    expect(response?.status).toBe(200);
    const report = response?.body as GatewayValidationReadinessReport;
    const ethernetip = report.drivers.find((driver) => driver.driverId === "ethernetip-cip-readonly");
    const simulator = report.drivers.find((driver) => driver.driverId === "esco-simulator");
    expect(report.destructiveOperationsEnabled).toBe(false);
    expect(report.hardwareValidatedRouteCount).toBe(0);
    expect(ethernetip?.readOnlyReleaseEligible).toBe(false);
    expect(ethernetip?.gates.find((gate) => gate.id === "hardware-validation-evidence")?.state).toBe("blocked");
    expect(simulator?.readOnlyReleaseEligible).toBe(true);
  });

  it("reports the site-gateway policy without enabling physical controller access", async () => {
    const host = hostWithGateway();
    const response = await host.handle("GET", "/api/gateway/site-gateways", undefined);

    expect(response?.status).toBe(200);
    const policy = response?.body as SiteGatewayPolicyReport;
    expect(policy.mode).toBe("local-dev-direct");
    expect(policy.requiredForRealControllerIo).toBe(false);
    expect(policy.directControllerConnectionsAllowed).toBe(true);
    expect(policy.summary).toContain("Local development");
  });

  it("blocks real-controller routes when hosted policy requires a site gateway", async () => {
    const policy = new SiteGatewayPolicy({ mode: "site-gateway-required", gateways: [] });
    const host = new GatewayHost(undefined, () => Date.now(), policy);
    cleanups.push(async () => {
      await host.closeIdleSessions(0, Number.POSITIVE_INFINITY);
    });

    const blocked = await host.handle("POST", "/api/gateway/session/connect", {
      driverId: "ethernetip-cip-readonly",
      config: { endpointUrl: "10.10.1.20" },
    });
    const simulator = await host.handle("POST", "/api/gateway/session/connect", {
      driverId: "esco-simulator",
      config: {},
    });

    expect(blocked?.status).toBe(502);
    expect(blocked?.body as ConnectionResult).toMatchObject({
      ok: false,
      state: "disconnected",
      connectionEvidence: { realControllerIo: true },
    });
    expect((blocked?.body as ConnectionResult).message).toContain("require a registered site gateway");
    expect(simulator?.status).toBe(200);
  });

  it("allows a real-controller route through a connected matching site gateway", async () => {
    const port = await startFakeTarget();
    const policy = new SiteGatewayPolicy({
      mode: "site-gateway-required",
      gateways: [
        {
          id: "site-a",
          name: "Line A Site Gateway",
          status: "connected",
          location: "Lab",
          allowedDriverKinds: ["ethernetip"],
          allowedEndpointPatterns: ["127.0.0.1"],
          readOnlyOnly: true,
          notes: "Test-only local gateway policy.",
        },
      ],
    });
    const host = new GatewayHost(undefined, () => Date.now(), policy);
    cleanups.push(async () => {
      await host.closeIdleSessions(0, Number.POSITIVE_INFINITY);
    });

    const connect = await host.handle("POST", "/api/gateway/session/connect", {
      driverId: "ethernetip-cip-readonly",
      config: { endpointUrl: `127.0.0.1:${port}`, siteGatewayId: "site-a" },
    });

    expect(connect?.status).toBe(200);
    expect(connect?.body as ConnectionResult).toMatchObject({
      ok: true,
      state: "online-readonly",
      connectionEvidence: {
        realControllerIo: true,
        hardwareValidated: false,
        verified: false,
      },
    });
  });

  it("lists inert vendor-neutral target adapters as metadata only", async () => {
    const host = hostWithGateway();
    const response = await host.handle("GET", "/api/gateway/target-adapters", undefined);

    expect(response?.status).toBe(200);
    const adapters = response?.body as TargetAdapterMetadata[];
    expect(adapters.map((adapter) => adapter.id)).toContain("allen-bradley-logix");
    expect(adapters.map((adapter) => adapter.id)).toContain("siemens-s7");
    expect(adapters.every((adapter) => adapter.executionAvailable === false)).toBe(true);
    expect(adapters.every((adapter) => adapter.physicalDownloadEnabled === false)).toBe(true);
    expect(adapters.every((adapter) => adapter.verified === false)).toBe(true);
    expect(adapters.every((adapter) => adapter.safety.physicalDownloadEnabled === false)).toBe(true);
    expect(adapters.every((adapter) => adapter.capabilities.physicalDownload === false)).toBe(true);
    expect(adapters.every((adapter) => Object.values(adapter).every((value) => typeof value !== "function"))).toBe(true);

    const legacy = await host.handle("GET", "/api/gateway/download-adapters", undefined);
    expect(legacy?.status).toBe(200);
    expect((legacy?.body as PlcDownloadAdapterDescriptor[])[0]).toMatchObject(adapters[0]);
  });

  it("computes local ESCO project identity without allocating an online session", async () => {
    let created = 0;
    const host = new GatewayHost(() => {
      created += 1;
      return new ControllerGateway(createBackendControllerDrivers());
    });

    const response = await host.handle("POST", "/api/gateway/project-identity", {
      localProject: localProject(),
    }, "client-proof");

    expect(response?.status).toBe(200);
    const identity = response?.body as ControllerIdentity;
    expect(identity).toMatchObject({
      controllerName: "PLC_1",
      controllerType: "ControlLogix 5580",
      firmwareRevision: "36.011",
      projectName: "LocalLine",
      projectSignatureAlgorithm: "esco-sha256-stable-project-v1",
      projectSignatureSource: "local-esco-project",
    });
    expect(identity.projectSignature).toMatch(/^esco-sha256-stable-project-v1:[a-f0-9]{64}$/);
    expect(created).toBe(0);
  });

  it("generates offline L5X identity proof tags without allocating an online session", async () => {
    let created = 0;
    const host = new GatewayHost(() => {
      created += 1;
      return new ControllerGateway(createBackendControllerDrivers());
    });

    const response = await host.handle("POST", "/api/gateway/project-identity/proof-tags", {
      localProject: localProject(),
    }, "client-proof");

    expect(response?.status).toBe(200);
    const bundle = response?.body as IdentityProofTagExport;
    expect(bundle).toMatchObject({
      schema: "esco.identityProofTags.v1",
      format: "studio5000-l5x-controller-tags",
      fileName: "LocalLine-identity-proof-tags.L5X",
      identityTags: {
        projectSignature: "ESCO_ProjectSignatureDigest",
        projectSignatureAlgorithm: "ESCO_ProjectSignatureAlgorithm",
      },
      evidence: {
        generatedOffline: true,
        physicalControllerWrite: false,
        proprietaryBinaryTouched: false,
      },
    });
    expect(bundle.rows.find((row) => row.field === "projectSignature")?.value).toMatch(/^[a-f0-9]{64}$/);
    expect(bundle.l5x).toContain('TargetType="Tag"');
    expect(bundle.l5x).toContain('<Tags Use="Target">');
    expect(bundle.l5x).toContain('Name="ESCO_ProjectSignatureDigest"');
    expect(bundle.l5x).toContain('Format="String" Length="64"');
    expect(bundle.installSteps.join(" ")).toContain("Import the controller-scope tags");
    expect(created).toBe(0);
  });

  it("returns blocked structured download preflight without enabling the download route", async () => {
    const host = hostWithGateway();

    const preflight = await host.handle("POST", "/api/gateway/download/preflight", {
      targetAdapterId: "allen-bradley-logix",
    });
    const download = await host.handle("POST", "/api/gateway/download", { targetAdapterId: "allen-bradley-logix" });

    expect(preflight?.status).toBe(200);
    expect(preflight?.body as DownloadPreflightResult).toMatchObject({
      targetAdapterId: "allen-bradley-logix",
      ok: false,
      physicalDownloadAllowed: false,
      executionAvailable: false,
      physicalDownloadEnabled: false,
      verified: false,
      defaultMode: "read-only",
      riskLevel: "critical",
    });
    expect(((preflight?.body as DownloadPreflightResult).blockers.join(" "))).toContain("Physical PLC download is blocked");
    expect((preflight?.body as DownloadPreflightResult).gateResults.length).toBeGreaterThan(0);
    expect((preflight?.body as DownloadPreflightResult).gateResults.every((gate) => gate.state !== "passed")).toBe(true);
    expect(download?.status).toBe(405);
  });

  it("ignores client-supplied target safety flags during download preflight", async () => {
    const host = hostWithGateway();

    const preflight = await host.handle("POST", "/api/gateway/download/preflight", {
      targetAdapterId: "allen-bradley-logix",
      capabilities: { physicalDownload: true },
      safety: {
        executionAvailable: true,
        physicalDownloadEnabled: true,
        verified: true,
        defaultMode: "download-capable",
        riskLevel: "low",
      },
      physicalDownloadAllowed: true,
      confirmed: true,
    });

    expect(preflight?.status).toBe(200);
    expect(preflight?.body as DownloadPreflightResult).toMatchObject({
      ok: false,
      physicalDownloadAllowed: false,
      executionAvailable: false,
      physicalDownloadEnabled: false,
      verified: false,
      defaultMode: "read-only",
      riskLevel: "critical",
    });
    expect((preflight?.body as DownloadPreflightResult).gateResults.every((gate) => gate.state !== "passed")).toBe(true);
  });

  it("validates connect input and surfaces offline errors as JSON", async () => {
    const host = hostWithGateway();
    expect((await host.handle("POST", "/api/gateway/session/connect", undefined))?.status).toBe(400);
    expect((await host.handle("POST", "/api/gateway/session/connect", { driverId: 7 }))?.status).toBe(400);
    expect((await host.handle("GET", "/api/gateway/identity", undefined))?.status).toBe(409);
    expect((await host.handle("GET", "/api/gateway/tags/read", undefined))?.status).toBe(400);
  });

  it("isolates online sessions by ESCO client session id", async () => {
    const host = hostWithGateway();
    const firstConnect = await host.handle("POST", "/api/gateway/session/connect", {
      driverId: "esco-simulator",
      config: {},
    }, "client-a");
    expect(firstConnect?.status).toBe(200);

    const first = await host.handle("GET", "/api/gateway/session", undefined, "client-a");
    const second = await host.handle("GET", "/api/gateway/session", undefined, "client-b");

    expect((first?.body as OnlineSnapshot).state).toBe("online-readonly");
    expect((first?.body as OnlineSnapshot).sessionId).toBe("client-a");
    expect((second?.body as OnlineSnapshot).state).toBe("offline");
    expect((second?.body as OnlineSnapshot).sessionId).toBe("client-b");
  });

  it("uses a single shared session when constructed with a prebuilt gateway", async () => {
    const host = new GatewayHost(new ControllerGateway(createBackendControllerDrivers()));
    cleanups.push(async () => {
      await host.closeIdleSessions(0, Number.POSITIVE_INFINITY);
    });

    const connect = await host.handle("POST", "/api/gateway/session/connect", {
      driverId: "esco-simulator",
      config: {},
    }, "client-a");
    expect(connect?.status).toBe(200);

    const second = await host.handle("GET", "/api/gateway/session", undefined, "client-b");
    expect((second?.body as OnlineSnapshot).state).toBe("online-readonly");
    expect((second?.body as OnlineSnapshot).sessionId).toBe("default");
    expect(await host.closeIdleSessions(0, Number.POSITIVE_INFINITY)).toBe(1);
  });

  it("keeps backend watch state scoped to the requesting session id", async () => {
    const host = hostWithGateway();
    await host.handle("POST", "/api/gateway/session/connect", {
      driverId: "esco-simulator",
      config: {},
    }, "client-a");
    const handle = await host.subscribeTags(["Conveyor.RunFeedback"], () => undefined, "client-a");

    const first = await host.handle("GET", "/api/gateway/session", undefined, "client-a");
    const second = await host.handle("GET", "/api/gateway/session", undefined, "client-b");
    expect((first?.body as OnlineSnapshot).state).toBe("online-monitor");
    expect((second?.body as OnlineSnapshot).state).toBe("offline");

    await handle.unsubscribe();
  });

  it("keeps Online Monitor active until the final backend watch closes", async () => {
    const host = hostWithGateway();
    await host.handle("POST", "/api/gateway/session/connect", {
      driverId: "esco-simulator",
      config: {},
    }, "client-a");
    const first = await host.subscribeTags(["Conveyor.RunFeedback"], () => undefined, "client-a");
    const second = await host.subscribeTags(["Sorter.BoxCount"], () => undefined, "client-a");

    expect(((await host.handle("GET", "/api/gateway/session", undefined, "client-a"))?.body as OnlineSnapshot).state).toBe(
      "online-monitor",
    );
    await first.unsubscribe();
    await first.unsubscribe();
    expect(((await host.handle("GET", "/api/gateway/session", undefined, "client-a"))?.body as OnlineSnapshot).state).toBe(
      "online-monitor",
    );

    await second.unsubscribe();
    expect(((await host.handle("GET", "/api/gateway/session", undefined, "client-a"))?.body as OnlineSnapshot).state).toBe(
      "online-readonly",
    );
  });

  it("closes and recreates idle client gateway sessions", async () => {
    let now = 1_000;
    let created = 0;
    const host = new GatewayHost(() => {
      created += 1;
      return new ControllerGateway(createBackendControllerDrivers());
    }, () => now);
    cleanups.push(async () => {
      await host.closeIdleSessions(0, Number.POSITIVE_INFINITY);
    });

    await host.handle("GET", "/api/gateway/session", undefined, "client-a");
    await host.handle("GET", "/api/gateway/session", undefined, "client-b");
    expect(created).toBe(2);

    expect(await host.closeIdleSessions(500, 1_200)).toBe(0);
    expect(created).toBe(2);

    expect(await host.closeIdleSessions(500, 1_600)).toBe(2);
    await host.handle("GET", "/api/gateway/session", undefined, "client-a");
    expect(created).toBe(3);
  });

  it("does not close an idle-looking session while a tag watch is active", async () => {
    let now = 1_000;
    let created = 0;
    const host = new GatewayHost(() => {
      created += 1;
      return new ControllerGateway(createBackendControllerDrivers());
    }, () => now);
    cleanups.push(async () => {
      await host.closeIdleSessions(0, Number.POSITIVE_INFINITY);
    });

    await host.handle("POST", "/api/gateway/session/connect", {
      driverId: "esco-simulator",
      config: {},
    }, "client-a");
    const handle = await host.subscribeTags(["Conveyor.RunFeedback"], () => undefined, "client-a");

    now = 10_000;
    expect(await host.closeIdleSessions(1, now)).toBe(0);
    const stillActive = await host.handle("GET", "/api/gateway/session", undefined, "client-a");
    expect((stillActive?.body as OnlineSnapshot).state).toBe("online-monitor");

    await handle.unsubscribe();
    now += 2;
    expect(await host.closeIdleSessions(1, now)).toBe(1);

    const recreated = await host.handle("GET", "/api/gateway/session", undefined, "client-a");
    expect(created).toBe(2);
    expect((recreated?.body as OnlineSnapshot).state).toBe("offline");
  });

  it("does not close a session while a backend tag subscription is still pending", async () => {
    let now = 1_000;
    let created = 0;
    let disconnectCount = 0;
    let resolveSubscribe:
      | ((handle: { id: string; unsubscribe: () => Promise<void> }) => void)
      | undefined;
    const identity = {
      controllerName: "SLOW_SUB",
      controllerType: "ESCO Test Driver",
      projectName: "Pending Watch",
      projectSignature: "pending-watch",
    };
    const driver: ControllerDriver = {
      id: "slow-subscribe",
      name: "Slow Subscribe Driver",
      kind: "simulator",
      capabilities: {
        canConnect: true,
        canReadStatus: true,
        canReadFaults: true,
        canReadTags: true,
        canSubscribeTags: true,
      },
      async connect() {
        return { ok: true, state: "online-readonly", message: "Connected for delayed watch.", identity };
      },
      async disconnect() {
        disconnectCount += 1;
      },
      async getIdentity() {
        return identity;
      },
      async getStatus() {
        return {
          state: "online-readonly",
          connected: true,
          health: "ok",
          message: "Connected.",
          updatedAt: "t",
        };
      },
      async getFaults() {
        return [];
      },
      async readTag(tagName) {
        return { tagName, value: 1, quality: "good", timestamp: "t", sourceDriver: "simulator" };
      },
      async subscribeTags() {
        return new Promise((resolve) => {
          resolveSubscribe = resolve;
        });
      },
    };
    const host = new GatewayHost(() => {
      created += 1;
      return new ControllerGateway([driver]);
    }, () => now);
    cleanups.push(async () => {
      await host.closeIdleSessions(0, Number.POSITIVE_INFINITY);
    });

    await host.handle("POST", "/api/gateway/session/connect", {
      driverId: "slow-subscribe",
      config: {},
    }, "client-a");
    const pendingHandle = host.subscribeTags(["Count"], () => undefined, "client-a");

    now = 10_000;
    expect(await host.closeIdleSessions(1, now)).toBe(0);
    expect(disconnectCount).toBe(0);
    expect(created).toBe(1);

    resolveSubscribe?.({ id: "delayed-sub", unsubscribe: async () => undefined });
    const handle = await pendingHandle;
    await handle.unsubscribe();
    now += 2;

    expect(await host.closeIdleSessions(1, now)).toBe(1);
    expect(disconnectCount).toBe(1);
  });

  it("decrements pending backend tag subscriptions when watch setup fails", async () => {
    let now = 1_000;
    let disconnectCount = 0;
    const identity = {
      controllerName: "FAIL_SUB",
      controllerType: "ESCO Test Driver",
      projectName: "Failing Watch",
      projectSignature: "failing-watch",
    };
    const driver: ControllerDriver = {
      id: "failing-subscribe",
      name: "Failing Subscribe Driver",
      kind: "simulator",
      capabilities: {
        canConnect: true,
        canReadStatus: true,
        canReadFaults: true,
        canReadTags: true,
        canSubscribeTags: true,
      },
      async connect() {
        return { ok: true, state: "online-readonly", message: "Connected for failing watch.", identity };
      },
      async disconnect() {
        disconnectCount += 1;
      },
      async getIdentity() {
        return identity;
      },
      async getStatus() {
        return {
          state: "online-readonly",
          connected: true,
          health: "ok",
          message: "Connected.",
          updatedAt: "t",
        };
      },
      async getFaults() {
        return [];
      },
      async readTag(tagName) {
        return { tagName, value: 1, quality: "good", timestamp: "t", sourceDriver: "simulator" };
      },
      async subscribeTags() {
        throw new Error("watch setup failed");
      },
    };
    const host = new GatewayHost(() => new ControllerGateway([driver]), () => now);
    cleanups.push(async () => {
      await host.closeIdleSessions(0, Number.POSITIVE_INFINITY);
    });

    await host.handle("POST", "/api/gateway/session/connect", {
      driverId: "failing-subscribe",
      config: {},
    }, "client-a");

    await expect(host.subscribeTags(["Count"], () => undefined, "client-a")).rejects.toThrow("watch setup failed");
    now = 10_000;

    expect(await host.closeIdleSessions(1, now)).toBe(1);
    expect(disconnectCount).toBe(1);
  });

  it("validates batch read input", async () => {
    const host = hostWithGateway();
    expect((await host.handle("POST", "/api/gateway/tags/read-batch", undefined))?.status).toBe(400);
    expect((await host.handle("POST", "/api/gateway/tags/read-batch", { names: [] }))?.status).toBe(400);
    expect((await host.handle("POST", "/api/gateway/tags/read-batch", { names: [7] }))?.status).toBe(400);
    expect(
      (
        await host.handle("POST", "/api/gateway/tags/read-batch", {
          names: Array.from({ length: 201 }, (_, index) => `T${index}`),
        })
      )?.status,
    ).toBe(400);
  });

  it("validates compare input", async () => {
    const host = hostWithGateway();
    expect((await host.handle("POST", "/api/gateway/compare", undefined))?.status).toBe(400);
    expect((await host.handle("POST", "/api/gateway/compare", { localProject: null }))?.status).toBe(400);
    expect((await host.handle("POST", "/api/gateway/project-identity", undefined))?.status).toBe(400);
    expect((await host.handle("POST", "/api/gateway/project-identity", { localProject: null }))?.status).toBe(400);
    expect((await host.handle("POST", "/api/gateway/project-identity/proof-tags", undefined))?.status).toBe(400);
    expect((await host.handle("POST", "/api/gateway/project-identity/proof-tags", { localProject: null }))?.status).toBe(400);
  });

  it("refuses write routes explicitly in the read-only milestone", async () => {
    const host = hostWithGateway();
    const write = await host.handle("POST", "/api/gateway/write", { tagName: "Count", value: 1 });
    expect(write?.status).toBe(405);
    expect((write?.body as { error: string }).error).toContain("read-only milestone");
    const download = await host.handle("POST", "/api/gateway/download", { target: "allen-bradley-logix" });
    expect(download?.status).toBe(405);
    expect((download?.body as { error: string }).error).toContain("Physical PLC download");
  });

  it("does not allocate gateway sessions for refused or unknown routes", async () => {
    let created = 0;
    const host = new GatewayHost(() => {
      created += 1;
      return new ControllerGateway(createBackendControllerDrivers());
    });

    const unknown = await host.handle("GET", "/api/gateway/nope", undefined, "client-a");
    const adapters = await host.handle("GET", "/api/gateway/target-adapters", undefined, "client-adapters");
    const preflight = await host.handle(
      "POST",
      "/api/gateway/download/preflight",
      { targetAdapterId: "allen-bradley-logix" },
      "client-preflight",
    );
    const identity = await host.handle(
      "POST",
      "/api/gateway/project-identity",
      { localProject: localProject() },
      "client-project-identity",
    );
    const proofTags = await host.handle(
      "POST",
      "/api/gateway/project-identity/proof-tags",
      { localProject: localProject() },
      "client-proof-tags",
    );
    const futureTargetDownload = await host.handle(
      "POST",
      "/api/gateway/target-adapters/allen-bradley-logix/download",
      {},
      "client-target-download",
    );
    const futureLegacyDownload = await host.handle(
      "POST",
      "/api/gateway/download-adapters/allen-bradley-logix/download",
      {},
      "client-legacy-download",
    );
    const write = await host.handle("POST", "/api/gateway/write", { tagName: "Count", value: 1 }, "client-b");
    const tagWrite = await host.handle("POST", "/api/gateway/tags/write", { tagName: "Count", value: 1 }, "client-c");
    const download = await host.handle("POST", "/api/gateway/download", { target: "allen-bradley-logix" }, "client-d");

    expect(unknown?.status).toBe(404);
    expect(adapters?.status).toBe(200);
    expect(preflight?.status).toBe(200);
    expect(identity?.status).toBe(200);
    expect(proofTags?.status).toBe(200);
    expect(futureTargetDownload?.status).toBe(404);
    expect(futureLegacyDownload?.status).toBe(404);
    expect(write?.status).toBe(405);
    expect(tagWrite?.status).toBe(405);
    expect(download?.status).toBe(405);
    expect(created).toBe(0);
  });

  it("reports failed connects with the driver's failure result", async () => {
    const host = hostWithGateway();
    const result = await host.handle("POST", "/api/gateway/session/connect", {
      driverId: "ethernetip-cip-readonly",
      config: { endpointUrl: "" },
    });
    expect(result?.status).toBe(502);
    expect((result?.body as ConnectionResult).ok).toBe(false);
  });

  it("routes generic OPC UA through the backend driver and keeps it read-only", async () => {
    const host = hostWithGateway();
    const missingEndpoint = await host.handle("POST", "/api/gateway/session/connect", {
      driverId: "opcua-generic-readonly",
      config: {},
    });
    expect(missingEndpoint?.status).toBe(502);
    expect((missingEndpoint?.body as ConnectionResult).message).toContain("OPC UA endpointUrl is required");

    const invalidScheme = await host.handle("POST", "/api/gateway/session/connect", {
      driverId: "opcua-generic-readonly",
      config: { endpointUrl: "http://127.0.0.1:4840" },
    });
    expect(invalidScheme?.status).toBe(502);
    expect((invalidScheme?.body as ConnectionResult).message).toContain("opc.tcp://");

    const write = await host.handle("POST", "/api/gateway/tags/write", { tagName: "Motor", value: true });
    expect(write?.status).toBe(405);
  });
});

describe("full stack: HTTP host → gateway → ESCO driver → TCP → target", () => {
  it("connects read-only, reads status/faults/tags, and audits every step", async () => {
    const port = await startFakeTarget();
    const host = hostWithGateway();

    const connect = await host.handle("POST", "/api/gateway/session/connect", {
      driverId: "ethernetip-cip-readonly",
      config: { endpointUrl: `127.0.0.1:${port}` },
    });
    expect(connect?.status).toBe(200);
    const connectResult = connect?.body as ConnectionResult;
    expect(connectResult.state).toBe("online-readonly"); // rule 7 default
    expect(connectResult.identity?.productName).toBe("1769-L33E");
    expect(connectResult.connectionEvidence).toMatchObject({
      realControllerIo: true,
      hardwareValidated: false,
      verified: false,
    });

    const session = await host.handle("GET", "/api/gateway/session", undefined);
    expect((session?.body as OnlineSnapshot).readOnly).toBe(true);
    expect((session?.body as OnlineSnapshot).capabilities?.canWriteTags).toBe(false);
    expect((session?.body as OnlineSnapshot).connectionEvidence?.label).toContain("not field-validated");
    expect((session?.body as OnlineSnapshot).readOnlyReason).toContain("read-only");

    const identity = await host.handle("GET", "/api/gateway/identity", undefined);
    expect(identity?.status).toBe(200);
    expect((identity?.body as { productName?: string }).productName).toBe("1769-L33E");

    const status = await host.handle("GET", "/api/gateway/status", undefined);
    const statusBody = status?.body as { snapshot: OnlineSnapshot; status?: { health: string; state: string } };
    expect(statusBody.snapshot.sessionId).toBe("default");
    expect(statusBody.status?.state).toBe("online-readonly");
    expect(statusBody.status?.health).toBe("ok");

    const faults = await host.handle("GET", "/api/gateway/faults", undefined);
    expect(faults?.body).toEqual([]);

    const tags = await host.handle("GET", "/api/gateway/tags", undefined);
    expect((tags?.body as TagDefinition[])[0]).toMatchObject({ name: "Pump", writable: false });

    const read = await host.handle("GET", "/api/gateway/tags/read?name=Count", undefined);
    expect((read?.body as TagValue).value).toBe(1234);

    const batch = await host.handle("POST", "/api/gateway/tags/read-batch", {
      names: ["Count", "Missing"],
    });
    expect(batch?.status).toBe(200);
    const batchBody = batch?.body as { values: TagValue[]; errors: Record<string, string> };
    expect(batchBody.values).toHaveLength(1);
    expect(batchBody.values[0].value).toBe(1234);
    expect(Object.keys(batchBody.errors)).toEqual(["Missing"]);
    expect(batchBody.errors["Missing"]).toContain("path destination unknown");

    const upload = await host.handle("POST", "/api/gateway/snapshot/upload", undefined);
    expect(upload?.status).toBe(200);
    const uploaded = upload?.body as ProjectSnapshot;
    expect(uploaded.sourceDriver).toBe("ethernetip");
    expect(uploaded.connectionEvidence?.realControllerIo).toBe(true);
    expect(uploaded.tags).toEqual([
      expect.objectContaining({ tagName: "Pump", value: 1234, dataType: "DINT", quality: "good" }),
    ]);
    expect(uploaded.raw).toMatchObject({
      kind: "allen-bradley-read-only-tag-snapshot",
      browsedTagCount: 1,
      sampledTagCount: 1,
      readErrors: {},
    });

    const audit = await host.handle("GET", "/api/gateway/audit", undefined);
    const actions = (audit?.body as Array<{ action: string }>).map((entry) => entry.action);
    expect(actions).toContain("connect");
    expect(actions).toContain("identity");
    expect(actions).toContain("status");
    expect(actions).toContain("faults");
    expect(actions).toContain("upload-snapshot");

    const disconnect = await host.handle("POST", "/api/gateway/session/disconnect", undefined);
    expect(disconnect?.status).toBe(200);
    const after = await host.handle("GET", "/api/gateway/session", undefined);
    expect((after?.body as OnlineSnapshot).state).toBe("disconnected");
  });

  it("simulator driver remains available for offline testing through the same routes", async () => {
    const host = hostWithGateway();
    const connect = await host.handle("POST", "/api/gateway/session/connect", {
      driverId: "esco-simulator",
      config: {},
    });
    expect(connect?.status).toBe(200);
    expect((connect?.body as ConnectionResult).ok).toBe(true);
    const status = await host.handle("GET", "/api/gateway/status", undefined);
    const statusBody = status?.body as { status?: { mode?: string } };
    expect(statusBody.status?.mode).toBe("Simulator");

    const compare = await host.handle("POST", "/api/gateway/compare", { localProject: localProject() });
    expect(compare?.status).toBe(200);
    expect((compare?.body as CompareResult).matched).toBe(false);

    const upload = await host.handle("POST", "/api/gateway/snapshot/upload", undefined);
    expect(upload?.status).toBe(200);
    expect((upload?.body as ProjectSnapshot).tags.length).toBeGreaterThan(0);
    expect((upload?.body as ProjectSnapshot).connectionEvidence?.realControllerIo).toBe(false);
  });

  it("leaves Online Monitor when a backend subscription handle is closed", async () => {
    const host = hostWithGateway();
    await host.handle("POST", "/api/gateway/session/connect", {
      driverId: "esco-simulator",
      config: {},
    });
    const values: TagValue[] = [];
    const handle = await host.subscribeTags(["Conveyor.RunFeedback"], (value) => values.push(value));

    const monitoring = await host.handle("GET", "/api/gateway/session", undefined);
    expect((monitoring?.body as OnlineSnapshot).state).toBe("online-monitor");
    expect(values[0]).toMatchObject({ tagName: "Conveyor.RunFeedback" });

    await handle.unsubscribe();

    const after = await host.handle("GET", "/api/gateway/session", undefined);
    expect((after?.body as OnlineSnapshot).state).toBe("online-readonly");
  });

  it("opens the L5X sync path as an offline project snapshot through gateway routes", async () => {
    const host = hostWithGateway();
    const offlineProject = localProject();
    offlineProject.controllers[0].controllerTags = [
      {
        id: "tag-1",
        controllerId: "controller-1",
        name: "BatchCount",
        dataType: "DINT",
        scope: "controller",
        value: 5,
      },
    ];

    const connect = await host.handle("POST", "/api/gateway/session/connect", {
      driverId: "l5x-sync",
      config: {},
      localProject: offlineProject,
    });
    expect(connect?.status).toBe(200);
    expect((connect?.body as ConnectionResult).message).toContain("offline L5X/project snapshot");

    const session = await host.handle("GET", "/api/gateway/session", undefined);
    const snapshot = session?.body as OnlineSnapshot;
    expect(snapshot.driverId).toBe("l5x-sync");
    expect(snapshot.readOnly).toBe(true);
    expect(snapshot.capabilities).toMatchObject({
      canBrowseTags: true,
      canReadTags: true,
      canBatchReadTags: true,
      canSubscribeTags: false,
      canUploadSnapshot: true,
      canWriteTags: false,
    });

    const tags = await host.handle("GET", "/api/gateway/tags", undefined);
    expect((tags?.body as TagDefinition[])[0]).toMatchObject({
      name: "BatchCount",
      writable: false,
      sourceDriver: "l5x",
    });

    const read = await host.handle("GET", "/api/gateway/tags/read?name=BatchCount", undefined);
    expect(read?.status).toBe(200);
    expect(read?.body).toMatchObject({ tagName: "BatchCount", value: 5, quality: "stale", sourceDriver: "l5x" });

    const upload = await host.handle("POST", "/api/gateway/snapshot/upload", undefined);
    expect(upload?.status).toBe(200);
    expect((upload?.body as ProjectSnapshot).sourceDriver).toBe("l5x");
    expect((upload?.body as ProjectSnapshot).connectionEvidence?.label).toBe("Offline snapshot");
    expect((upload?.body as ProjectSnapshot).raw).toMatchObject({ projectName: "LocalLine" });
  });
});
