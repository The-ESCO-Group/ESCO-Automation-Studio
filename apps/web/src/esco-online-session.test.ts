import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ConnectionResult,
  ControllerDriverSummary,
  FaultInfo,
  OnlineAuditEntry,
  OnlineSnapshot,
  ProjectSnapshot,
  TagDefinition,
  TagValue,
} from "./gateway-contract";
import { GatewayApiError } from "./gateway-client";
import { EscoOnlineSession, type GatewayClientLike } from "./esco-online-session";

const OFFLINE_SNAPSHOT: OnlineSnapshot = { state: "offline", readOnly: true };
const SOFTWARE_WIRED_EVIDENCE: ControllerDriverSummary["connectionEvidence"] = {
  transportValidation: "software-wired",
  realControllerIo: true,
  hardwareValidated: false,
  verified: false,
  label: "Software-wired, not field-validated",
  message: "Software route only.",
  limitations: ["No hardware validation evidence."],
};
const READONLY_SNAPSHOT: OnlineSnapshot = {
  state: "online-readonly",
  driverId: "ethernetip-cip-readonly",
  driverName: "ESCO EtherNet/IP CIP Read-Only Driver",
  capabilities: readOnlyCapabilities(),
  connectionEvidence: SOFTWARE_WIRED_EVIDENCE,
  readOnly: true,
  readOnlyReason: "Public ESCO online mode is read-only.",
};

function okConnect(): ConnectionResult {
  return {
    ok: true,
    state: "online-readonly",
    message: "Read-only EtherNet/IP session.",
    identity: { productName: "1769-L33E", vendor: "Rockwell Automation/Allen-Bradley" },
  };
}

function readOnlyCapabilities(): ControllerDriverSummary["capabilities"] {
  return {
    canConnect: true,
    canReadStatus: true,
    canReadFaults: true,
    canBrowseTags: true,
    canReadTags: true,
    canBatchReadTags: true,
    canSubscribeTags: true,
    canUploadSnapshot: false,
    canCompareProject: true,
    canWriteTags: false,
    canDownloadProject: false,
    canOnlineEdit: false,
    canForceTags: false,
    canModeChange: false,
    canClearFaults: false,
  };
}

function driverSummary(
  id: string,
  name: string,
  kind: ControllerDriverSummary["kind"],
): ControllerDriverSummary {
  return {
    id,
    name,
    kind,
    capabilities: readOnlyCapabilities(),
    connectionEvidence: SOFTWARE_WIRED_EVIDENCE,
    readOnly: true,
    safetyNote: "Public ESCO online mode is read-only.",
  };
}

/** Fully scriptable fake client; every method overridable per test. */
function fakeClient(overrides: Partial<GatewayClientLike> = {}): GatewayClientLike {
  return {
    authContext: async () => ({
      mode: "local-dev",
      authenticated: true,
      user: { id: "local-dev", displayName: "Local Developer" },
      roles: ["developer"],
      permissions: ["gateway:read", "gateway:connect", "project:read", "project:write"],
      summary: "Local development auth is active; gateway routes are open on this machine.",
      nextStep: "Set ESCO_API_AUTH_TOKEN before hosting this API outside local development.",
    }),
    listDrivers: async () => [
      driverSummary("esco-simulator", "Sim", "simulator"),
      driverSummary("ethernetip-cip-readonly", "ESCO EtherNet/IP", "ethernetip"),
    ],
    validationReadiness: async () => ({
      generatedAt: "2026-06-15T00:00:00.000Z",
      driverCount: 2,
      realControllerRouteCount: 1,
      hardwareValidatedRouteCount: 0,
      readOnlyReleaseEligibleRouteCount: 1,
      destructiveOperationsEnabled: false,
      summary: "No real-controller route has lab or field validation evidence attached yet.",
      nextStep: "Run hardware validation.",
      drivers: [
        {
          driverId: "ethernetip-cip-readonly",
          driverName: "ESCO EtherNet/IP",
          kind: "ethernetip",
          transportValidation: "software-wired",
          realControllerIo: true,
          hardwareValidated: false,
          verified: false,
          readOnlyReleaseEligible: false,
          destructiveOperationsBlocked: true,
          summary: "Real-controller route is software-wired only.",
          gates: [],
        },
      ],
    }),
    siteGatewayPolicy: async () => ({
      generatedAt: "2026-06-15T00:00:00.000Z",
      mode: "local-dev-direct",
      requiredForRealControllerIo: false,
      directControllerConnectionsAllowed: true,
      configuredGatewayCount: 0,
      connectedGatewayCount: 0,
      gateways: [],
      summary: "Local development policy allows direct read-only controller routes from the API host.",
      nextStep: "Enable site-gateway policy in hosted deployments.",
    }),
    session: async () => OFFLINE_SNAPSHOT,
    connect: async () => okConnect(),
    disconnect: async () => ({ ok: true }),
    identity: async () => ({ productName: "1769-L33E", firmwareRevision: "36.011", vendor: "Rockwell Automation/Allen-Bradley" }),
    projectIdentity: async () => ({
      controllerName: "PLC_1",
      controllerType: "ControlLogix 5580",
      projectName: "Line1",
      projectSignature: "esco-sha256-stable-project-v1:abc",
      projectSignatureAlgorithm: "esco-sha256-stable-project-v1",
      projectSignatureSource: "local-esco-project",
    }),
    projectIdentityProofTags: async () => ({
      schema: "esco.identityProofTags.v1",
      generatedAt: "2026-06-15T00:00:00.000Z",
      format: "studio5000-l5x-controller-tags",
      fileName: "Line1-identity-proof-tags.L5X",
      l5x: "<RSLogix5000Content/>",
      identity: {
        controllerName: "PLC_1",
        projectName: "Line1",
        projectSignature: "esco-sha256-stable-project-v1:abc",
        projectSignatureAlgorithm: "esco-sha256-stable-project-v1",
      },
      identityTags: {
        controllerName: "ESCO_ControllerName",
        controllerType: "ESCO_ControllerType",
        firmwareRevision: "ESCO_FirmwareRevision",
        projectName: "ESCO_ProjectName",
        projectSignature: "ESCO_ProjectSignatureDigest",
        projectSignatureAlgorithm: "ESCO_ProjectSignatureAlgorithm",
      },
      rows: [],
      installSteps: [],
      warnings: [],
      evidence: {
        generatedOffline: true,
        physicalControllerWrite: false,
        proprietaryBinaryTouched: false,
        purpose: "read-only-controller-identity-proof",
      },
    }),
    status: async () => ({ snapshot: READONLY_SNAPSHOT, status: undefined }),
    faults: async () => [],
    browseTags: async () => [],
    readTag: async (tagName) =>
      ({ tagName, value: 1234, quality: "good", timestamp: "t", sourceDriver: "ethernetip" }) as TagValue,
    readTags: async (tagNames) => ({
      values: tagNames.map(
        (tagName) =>
          ({ tagName, value: 1, quality: "good", timestamp: "t", sourceDriver: "ethernetip" }) as TagValue,
      ),
      errors: {},
    }),
    subscribeTags: (tagNames, onValue) => {
      for (const tagName of tagNames) {
        onValue({ tagName, value: 1, quality: "good", timestamp: "t", sourceDriver: "ethernetip" } as TagValue);
      }
      return { close: vi.fn() };
    },
    compareProject: async () => ({
      state: "unknown",
      matched: false,
      differences: [],
      message: "Controller match cannot be proven; defaulting to read-only.",
    }),
    uploadSnapshot: async () =>
      ({
        id: "snap-1",
        capturedAt: "t",
        sourceDriver: "ethernetip",
        identity: {},
        tags: [
          { tagName: "Count", value: 99, quality: "good", timestamp: "t", sourceDriver: "ethernetip" } as TagValue,
        ],
      }) as ProjectSnapshot,
    audit: async () => [],
    ...overrides,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("availability", () => {
  it("marks the API available and stores drivers + snapshot", async () => {
    const session = new EscoOnlineSession(fakeClient());
    await session.refreshAvailability();
    const state = session.getState();
    expect(state.apiAvailable).toBe(true);
    expect(state.authContext?.authenticated).toBe(true);
    expect(state.authContext?.mode).toBe("local-dev");
    expect(state.drivers.map((driver) => driver.id)).toContain("ethernetip-cip-readonly");
    expect(state.snapshot?.state).toBe("offline");
    expect(state.validationReadiness?.hardwareValidatedRouteCount).toBe(0);
    expect(state.validationReadiness?.drivers[0]?.readOnlyReleaseEligible).toBe(false);
    expect(state.siteGatewayPolicy?.mode).toBe("local-dev-direct");
    expect(state.siteGatewayPolicy?.directControllerConnectionsAllowed).toBe(true);
    expect(state.busy).toBe(false);
  });

  it("marks the API unavailable with actionable guidance on network failure", async () => {
    const session = new EscoOnlineSession(
      fakeClient({
        listDrivers: async () => {
          throw new TypeError("fetch failed");
        },
      }),
    );
    await session.refreshAvailability();
    const state = session.getState();
    expect(state.apiAvailable).toBe(false);
    expect(state.authContext?.authenticated).toBe(true);
    expect(state.validationReadiness).toBeUndefined();
    expect(state.siteGatewayPolicy).toBeUndefined();
    expect(state.lastError).toContain("unreachable");
    expect(state.lastError).toContain("pnpm --filter @esco/api dev");
  });
});

describe("connect / disconnect", () => {
  it("stores the connect result, identity, and fresh snapshot", async () => {
    const session = new EscoOnlineSession(
      fakeClient({ session: async () => READONLY_SNAPSHOT }),
    );
    const result = await session.connect("ethernetip-cip-readonly", {
      endpointUrl: "192.168.1.10",
    });
    expect(result?.ok).toBe(true);
    const state = session.getState();
    expect(state.snapshot?.state).toBe("online-readonly");
    expect(state.snapshot?.readOnly).toBe(true);
    expect(state.identity?.productName).toBe("1769-L33E");
    expect(state.lastError).toBeUndefined();
  });

  it("keeps failed connects as renderable results, not exceptions", async () => {
    const failed: ConnectionResult = {
      ok: false,
      state: "disconnected",
      message: "EtherNet/IP connect to 10.0.0.9:44818 failed: timeout",
    };
    const session = new EscoOnlineSession(fakeClient({ connect: async () => failed }));
    const result = await session.connect("ethernetip-cip-readonly", { endpointUrl: "10.0.0.9" });
    expect(result?.ok).toBe(false);
    const state = session.getState();
    expect(state.lastConnectResult?.ok).toBe(false);
    expect(state.lastError).toContain("failed: timeout");
  });

  it("keeps the UI session disconnected when connect status fails closed", async () => {
    const failed: ConnectionResult = {
      ok: false,
      state: "disconnected",
      message: "OPC UA connect to opc.tcp://host failed read-only heartbeat: missing ns=0;i=2258",
      status: {
        state: "disconnected",
        connected: false,
        health: "warning",
        message: "OPC UA read-only session heartbeat failed: missing ns=0;i=2258",
        updatedAt: "t",
      },
    };
    const disconnectedSnapshot: OnlineSnapshot = { state: "disconnected", readOnly: true };
    const session = new EscoOnlineSession(
      fakeClient({
        connect: async () => failed,
        session: async () => disconnectedSnapshot,
      }),
    );

    const result = await session.connect("opcua-generic-readonly", { endpointUrl: "opc.tcp://host" });

    expect(result?.ok).toBe(false);
    const state = session.getState();
    expect(state.snapshot?.state).toBe("disconnected");
    expect(state.lastConnectResult?.status).toMatchObject({
      state: "disconnected",
      connected: false,
      health: "warning",
    });
    expect(state.lastError).toContain("failed read-only heartbeat");
  });

  it("clears stale per-session data on connect and disconnect", async () => {
    const session = new EscoOnlineSession(
      fakeClient({
        browseTags: async () =>
          [{ name: "Pump", dataType: "DINT", writable: false, sourceDriver: "ethernetip" }] as TagDefinition[],
      }),
    );
    await session.browseTags();
    await session.readTag("Pump");
    expect(session.getState().tags).toHaveLength(1);
    expect(Object.keys(session.getState().tagValues)).toEqual(["Pump"]);

    await session.connect("ethernetip-cip-readonly", { endpointUrl: "10.0.0.1" });
    expect(session.getState().tags).toEqual([]);
    expect(session.getState().tagValues).toEqual({});

    await session.browseTags();
    await session.disconnect();
    const state = session.getState();
    expect(state.tags).toEqual([]);
    expect(state.identity).toBeUndefined();
    expect(state.status).toBeUndefined();
  });
});

describe("status, faults, tags, audit", () => {
  it("refreshes status and reads faults only when online", async () => {
    const faults: FaultInfo[] = [
      {
        id: "cip-major-recoverable",
        severity: "major",
        message: "Major recoverable fault",
        source: "CIP Identity",
        timestamp: "t",
        clearable: false,
      },
    ];
    const online = new EscoOnlineSession(
      fakeClient({
        status: async () => ({
          snapshot: READONLY_SNAPSHOT,
          status: {
            state: "online-readonly",
            connected: true,
            health: "faulted",
            message: "faulted",
            updatedAt: "t",
          },
        }),
        faults: async () => faults,
      }),
    );
    await online.refreshStatus();
    expect(online.getState().status?.health).toBe("faulted");
    expect(online.getState().faults).toHaveLength(1);

    let faultCalls = 0;
    const offline = new EscoOnlineSession(
      fakeClient({
        status: async () => ({ snapshot: OFFLINE_SNAPSHOT, status: undefined }),
        faults: async () => {
          faultCalls += 1;
          return [];
        },
      }),
    );
    await offline.refreshStatus();
    expect(faultCalls).toBe(0); // never asks an offline session for faults
  });

  it("does not ask for faults when the active driver capability says fault reads are unavailable", async () => {
    let faultCalls = 0;
    const session = new EscoOnlineSession(
      fakeClient({
        status: async () => ({
          snapshot: {
            ...READONLY_SNAPSHOT,
            capabilities: { ...readOnlyCapabilities(), canReadFaults: false },
          },
          status: {
            state: "online-readonly",
            connected: true,
            health: "ok",
            message: "OPC UA status only",
            updatedAt: "t",
          },
        }),
        faults: async () => {
          faultCalls += 1;
          throw new GatewayApiError(409, "Generic OPC UA does not support fault reads.");
        },
      }),
    );

    await session.refreshStatus();

    expect(faultCalls).toBe(0);
    expect(session.getState().faults).toEqual([]);
    expect(session.getState().lastError).toBeUndefined();
  });

  it("caches read tag values per tag name", async () => {
    const session = new EscoOnlineSession(fakeClient());
    await session.readTag("Count");
    await session.readTag("Other");
    const values = session.getState().tagValues;
    expect(values["Count"]?.value).toBe(1234);
    expect(Object.keys(values).sort()).toEqual(["Count", "Other"]);
  });

  it("surfaces gateway errors with the server message", async () => {
    const session = new EscoOnlineSession(
      fakeClient({
        readTag: async () => {
          throw new GatewayApiError(409, "Controller Gateway is not online.");
        },
      }),
    );
    const value = await session.readTag("Count");
    expect(value).toBeUndefined();
    expect(session.getState().lastError).toBe("Controller Gateway is not online.");
  });

  it("marks a watched row bad/stale when a single tag read fails", async () => {
    const session = new EscoOnlineSession(
      fakeClient({
        readTag: async () => {
          throw new GatewayApiError(409, "Unknown tag: Count");
        },
      }),
    );
    await session.readTag("Count");
    expect(session.getState().tagErrors["Count"]).toBe("Unknown tag: Count");
    expect(session.getState().staleTagReasons["Count"]).toBe("stale: read failed");
  });

  it("stores the audit trail", async () => {
    const audit: OnlineAuditEntry[] = [
      { id: "1", at: "t", action: "connect", state: "online-readonly", result: "ran", message: "ok" },
    ];
    const session = new EscoOnlineSession(fakeClient({ audit: async () => audit }));
    await session.refreshAudit();
    expect(session.getState().audit).toHaveLength(1);
  });

  it("refreshes controller identity through the gateway", async () => {
    const session = new EscoOnlineSession(
      fakeClient({
        identity: async () => ({ productName: "1756-L85E", firmwareRevision: "36.011", vendor: "Rockwell Automation/Allen-Bradley" }),
        session: async () => READONLY_SNAPSHOT,
      }),
    );
    const identity = await session.refreshIdentity();
    expect(identity?.productName).toBe("1756-L85E");
    expect(session.getState().identity?.firmwareRevision).toBe("36.011");
    expect(session.getState().snapshot?.state).toBe("online-readonly");
    expect(session.getState().lastError).toBeUndefined();
  });

  it("runs explicit local-project compare after refreshing online identity evidence", async () => {
    const calls: string[] = [];
    const session = new EscoOnlineSession(
      fakeClient({
        identity: async () => {
          calls.push("identity");
          return { productName: "1756-L85E", projectName: "Online", firmwareRevision: "36.011" };
        },
        compareProject: async () => {
          calls.push("compare");
          return {
            state: "mismatched",
            matched: false,
            differences: [{ field: "projectName", local: "Local", online: "Online", severity: "blocking" }],
            message: "Controller identity does not match the local project; writes stay blocked.",
          };
        },
        session: async () => ({
          ...READONLY_SNAPSHOT,
          state: "online-mismatched",
          readOnly: true,
        }),
      }),
    );
    const result = await session.compareProject({ id: "p", name: "Local", controllers: [] } as never);
    expect(result?.state).toBe("mismatched");
    expect(calls).toEqual(["identity", "compare"]);
    expect(session.getState().identity?.projectName).toBe("Online");
    expect(session.getState().compareResult?.differences[0].field).toBe("projectName");
    expect(session.getState().snapshot?.state).toBe("online-mismatched");
  });

  it("computes local project identity/signature for proof-tag setup", async () => {
    const session = new EscoOnlineSession(
      fakeClient({
        projectIdentity: async () => ({
          controllerName: "PLC_1",
          controllerType: "ControlLogix 5580",
          firmwareRevision: "36.011",
          projectName: "Line1",
          projectSignature: "esco-sha256-stable-project-v1:abc123",
          projectSignatureAlgorithm: "esco-sha256-stable-project-v1",
          projectSignatureSource: "local-esco-project",
        }),
      }),
    );

    const identity = await session.refreshLocalProjectIdentity({ id: "p", name: "Line1", controllers: [] } as never);

    expect(identity?.projectSignature).toBe("esco-sha256-stable-project-v1:abc123");
    expect(session.getState().localProjectIdentity).toMatchObject({
      controllerName: "PLC_1",
      projectSignatureAlgorithm: "esco-sha256-stable-project-v1",
    });
    expect(session.getState().lastError).toBeUndefined();
  });

  it("exports offline proof-tag L5X and refreshes local identity from the bundle", async () => {
    const session = new EscoOnlineSession(
      fakeClient({
        projectIdentityProofTags: async () => ({
          schema: "esco.identityProofTags.v1",
          generatedAt: "2026-06-15T00:00:00.000Z",
          format: "studio5000-l5x-controller-tags",
          fileName: "Line1-identity-proof-tags.L5X",
          l5x: "<RSLogix5000Content/>",
          identity: {
            controllerName: "PLC_1",
            projectName: "Line1",
            projectSignature: "esco-sha256-stable-project-v1:abc123",
            projectSignatureAlgorithm: "esco-sha256-stable-project-v1",
          },
          identityTags: {
            controllerName: "ESCO_ControllerName",
            controllerType: "ESCO_ControllerType",
            firmwareRevision: "ESCO_FirmwareRevision",
            projectName: "ESCO_ProjectName",
            projectSignature: "ESCO_ProjectSignatureDigest",
            projectSignatureAlgorithm: "ESCO_ProjectSignatureAlgorithm",
          },
          rows: [
            {
              field: "projectSignature",
              label: "Project signature digest",
              tagName: "ESCO_ProjectSignatureDigest",
              dataType: "STRING",
              value: "abc123",
              description: "ESCO online identity proof - Project signature digest",
            },
          ],
          installSteps: ["Review offline."],
          warnings: [],
          evidence: {
            generatedOffline: true,
            physicalControllerWrite: false,
            proprietaryBinaryTouched: false,
            purpose: "read-only-controller-identity-proof",
          },
        }),
      }),
    );

    const bundle = await session.exportIdentityProofTags({ id: "p", name: "Line1", controllers: [] } as never);

    expect(bundle?.fileName).toBe("Line1-identity-proof-tags.L5X");
    expect(bundle?.rows[0]?.tagName).toBe("ESCO_ProjectSignatureDigest");
    expect(session.getState().localProjectIdentity?.projectSignature).toBe("esco-sha256-stable-project-v1:abc123");
    expect(session.getState().lastError).toBeUndefined();
  });

  it("uploads a read-only snapshot and merges its tag values into the monitor cache", async () => {
    const session = new EscoOnlineSession(fakeClient());
    const uploaded = await session.uploadSnapshot();
    expect(uploaded?.id).toBe("snap-1");
    expect(session.getState().uploadedSnapshot?.tags).toHaveLength(1);
    expect(session.getState().tagValues["Count"]?.value).toBe(99);
  });
});

describe("batched reads and polling", () => {
  it("merges batch values and reports per-tag errors", async () => {
    const session = new EscoOnlineSession(
      fakeClient({
        readTags: async () => ({
          values: [
            { tagName: "Count", value: 9, quality: "good", timestamp: "t", sourceDriver: "ethernetip" } as TagValue,
          ],
          errors: { Missing: "path destination unknown (tag or object not found)" },
        }),
      }),
    );
    const result = await session.readTags(["Count", "Missing"]);
    expect(result?.values).toHaveLength(1);
    expect(session.getState().tagValues["Count"]?.value).toBe(9);
    expect(session.getState().tagErrors["Missing"]).toContain("path destination");
    expect(session.getState().lastError).toBeUndefined(); // per-tag ≠ transport
  });

  it("marks watched tags stale on transport failure and clears them on a good sample", async () => {
    let fail = true;
    const session = new EscoOnlineSession(
      fakeClient({
        readTags: async (tagNames) => {
          if (fail) throw new GatewayApiError(409, "Controller Gateway is not online.");
          return {
            values: tagNames.map(
              (tagName) =>
                ({ tagName, value: 14, quality: "good", timestamp: "t2", sourceDriver: "ethernetip" }) as TagValue,
            ),
            errors: {},
          };
        },
      }),
    );

    const failed = await session.readTags(["Count"]);
    expect(failed).toBeUndefined();
    expect(session.getState().staleTagReasons["Count"]).toBe("stale: gateway disconnected");
    expect(session.getState().lastError).toBe("Controller Gateway is not online.");

    fail = false;
    const result = await session.readTags(["Count"]);
    expect(result?.values[0].value).toBe(14);
    expect(session.getState().staleTagReasons["Count"]).toBeUndefined();
    expect(session.getState().tagValues["Count"]?.quality).toBe("good");
  });

  it("ignores a late polling sample after the watch is stopped", async () => {
    vi.useFakeTimers();
    let resolveRead: ((result: { values: TagValue[]; errors: Record<string, string> }) => void) | undefined;
    const session = new EscoOnlineSession(
      fakeClient({
        readTags: async () =>
          new Promise((resolve) => {
            resolveRead = resolve;
          }),
      }),
    );

    session.startTagPolling(["Count"], 1000);
    await vi.advanceTimersByTimeAsync(10);
    expect(session.getState().polling).toBeDefined();

    session.stopTagPolling();
    expect(session.getState().staleTagReasons["Count"]).toBe("stale: watch stopped");

    resolveRead?.({
      values: [
        { tagName: "Count", value: 99, quality: "good", timestamp: "late", sourceDriver: "ethernetip" } as TagValue,
      ],
      errors: {},
    });
    await vi.advanceTimersByTimeAsync(10);

    expect(session.getState().tagValues["Count"]).toBeUndefined();
    expect(session.getState().staleTagReasons["Count"]).toBe("stale: watch stopped");
  });

  it("marks only changed values after the first successful sample", async () => {
    let sample = 0;
    const session = new EscoOnlineSession(
      fakeClient({
        readTags: async () => {
          sample += 1;
          return {
            values: [
              {
                tagName: "Count",
                value: sample === 1 ? 10 : 11,
                quality: "good",
                timestamp: `t${sample}`,
                sourceDriver: "ethernetip",
              } as TagValue,
              {
                tagName: "Running",
                value: true,
                quality: "good",
                timestamp: `t${sample}`,
                sourceDriver: "ethernetip",
              } as TagValue,
            ],
            errors: {},
          };
        },
      }),
    );
    await session.readTags(["Count", "Running"]);
    expect(session.getState().changedTagNames).toEqual([]);

    await session.readTags(["Count", "Running"]);
    expect(session.getState().changedTagNames).toEqual(["Count"]);
  });

  it("clears a per-tag batch error when a single read succeeds", async () => {
    const session = new EscoOnlineSession(
      fakeClient({
        readTags: async () => ({
          values: [],
          errors: { Missing: "path destination unknown" },
        }),
        readTag: async (tagName) =>
          ({ tagName, value: 7, quality: "good", timestamp: "t", sourceDriver: "ethernetip" }) as TagValue,
      }),
    );
    await session.readTags(["Missing"]);
    expect(session.getState().tagErrors["Missing"]).toContain("path destination");

    await session.readTag("Missing");
    expect(session.getState().tagErrors["Missing"]).toBeUndefined();
    expect(session.getState().tagValues["Missing"]?.value).toBe(7);
  });

  it("polls on an interval, samples immediately, and stops cleanly", async () => {
    vi.useFakeTimers();
    let batches = 0;
    const session = new EscoOnlineSession(
      fakeClient({
        readTags: async (tagNames) => {
          batches += 1;
          return {
            values: tagNames.map(
              (tagName) =>
                ({ tagName, value: batches, quality: "good", timestamp: "t", sourceDriver: "ethernetip" }) as TagValue,
            ),
            errors: {},
          };
        },
      }),
    );
    session.startTagPolling(["Count"], 1000);
    expect(session.getState().polling).toEqual({ names: ["Count"], intervalMs: 1000 });
    await vi.advanceTimersByTimeAsync(10); // immediate first sample
    expect(batches).toBe(1);
    await vi.advanceTimersByTimeAsync(2000);
    expect(batches).toBe(3);
    expect(session.getState().tagValues["Count"]?.value).toBe(3);

    session.stopTagPolling();
    expect(session.getState().polling).toBeUndefined();
    expect(session.getState().staleTagReasons["Count"]).toBe("stale: watch stopped");
    await vi.advanceTimersByTimeAsync(5000);
    expect(batches).toBe(3); // no further ticks
  });

  it("self-stops after three consecutive transport failures", async () => {
    vi.useFakeTimers();
    const session = new EscoOnlineSession(
      fakeClient({
        readTags: async () => {
          throw new GatewayApiError(409, "Controller Gateway is not online.");
        },
      }),
    );
    session.startTagPolling(["Count"], 1000);
    await vi.advanceTimersByTimeAsync(10);
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(session.getState().polling).toBeUndefined();
    expect(session.getState().staleTagReasons["Count"]).toBe("stale: gateway disconnected");
    expect(session.getState().lastError).toContain("watch stopped after 3");
  });

  it("disconnect stops an active polling loop", async () => {
    vi.useFakeTimers();
    const session = new EscoOnlineSession(fakeClient());
    session.startTagPolling(["Count"], 1000);
    await vi.advanceTimersByTimeAsync(10);
    expect(session.getState().polling).toBeDefined();
    await session.disconnect();
    expect(session.getState().polling).toBeUndefined();
  });

  it("refresh status stops active polling when the gateway reports disconnected", async () => {
    vi.useFakeTimers();
    let batches = 0;
    const session = new EscoOnlineSession(
      fakeClient({
        readTags: async (tagNames) => {
          batches += 1;
          return {
            values: tagNames.map(
              (tagName) =>
                ({ tagName, value: batches, quality: "good", timestamp: "t", sourceDriver: "ethernetip" }) as TagValue,
            ),
            errors: {},
          };
        },
        status: async () => ({
          snapshot: { state: "disconnected", readOnly: true },
          status: {
            state: "disconnected",
            connected: false,
            health: "warning",
            message: "Read-only heartbeat failed.",
            updatedAt: "t",
          },
        }),
      }),
    );

    session.startTagPolling(["Count"], 1000);
    await vi.advanceTimersByTimeAsync(10);
    expect(batches).toBe(1);

    await session.refreshStatus();

    expect(session.getState().snapshot?.state).toBe("disconnected");
    expect(session.getState().polling).toBeUndefined();
    expect(session.getState().staleTagReasons["Count"]).toBe("stale: session disconnected");
    await vi.advanceTimersByTimeAsync(3000);
    expect(batches).toBe(1);
  });

  it("streams tag values, clears stale tag errors, and closes cleanly", async () => {
    const close = vi.fn();
    let pushValue: ((value: TagValue) => void) | undefined;
    const session = new EscoOnlineSession(
      fakeClient({
        readTags: async () => ({
          values: [],
          errors: { Count: "previous path destination unknown" },
        }),
        subscribeTags: (tagNames, onValue) => {
          pushValue = onValue;
          for (const tagName of tagNames) {
            onValue({ tagName, value: 10, quality: "good", timestamp: "t1", sourceDriver: "simulator" } as TagValue);
          }
          return { close };
        },
      }),
    );
    await session.readTags(["Count"]);
    expect(session.getState().tagErrors["Count"]).toContain("previous");

    session.startTagStream([" Count ", "Count", ""]);
    expect(session.getState().streaming).toEqual({ names: ["Count"] });
    expect(session.getState().tagValues["Count"]?.value).toBe(10);
    expect(session.getState().tagErrors["Count"]).toBeUndefined();

    pushValue?.({ tagName: "Count", value: 11, quality: "good", timestamp: "t2", sourceDriver: "simulator" } as TagValue);
    expect(session.getState().tagValues["Count"]?.value).toBe(11);
    expect(session.getState().changedTagNames).toEqual(["Count"]);

    session.stopTagStream();
    expect(close).toHaveBeenCalledTimes(1);
    expect(session.getState().streaming).toBeUndefined();
    expect(session.getState().staleTagReasons["Count"]).toBe("stale: watch stopped");
  });

  it("marks streamed tags stale when the gateway stream reports a disconnect", () => {
    let pushError: ((message: string) => void) | undefined;
    const close = vi.fn();
    const session = new EscoOnlineSession(
      fakeClient({
        subscribeTags: (tagNames, onValue, onError) => {
          pushError = onError;
          for (const tagName of tagNames) {
            onValue({ tagName, value: 10, quality: "good", timestamp: "t1", sourceDriver: "simulator" } as TagValue);
          }
          return { close };
        },
      }),
    );

    session.startTagStream(["Count"]);
    expect(session.getState().staleTagReasons["Count"]).toBeUndefined();

    pushError?.("Gateway tag stream disconnected.");
    expect(session.getState().streaming).toBeUndefined();
    expect(session.getState().staleTagReasons["Count"]).toBe("stale: stream disconnected");
    expect(session.getState().lastError).toBe("Gateway tag stream disconnected.");
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("refresh status closes an active stream when the controller is faulted", async () => {
    const close = vi.fn();
    const session = new EscoOnlineSession(
      fakeClient({
        subscribeTags: (tagNames, onValue) => {
          for (const tagName of tagNames) {
            onValue({ tagName, value: 10, quality: "good", timestamp: "t1", sourceDriver: "simulator" } as TagValue);
          }
          return { close };
        },
        status: async () => ({
          snapshot: READONLY_SNAPSHOT,
          status: {
            state: "faulted",
            connected: true,
            health: "faulted",
            message: "Controller reports a major fault.",
            updatedAt: "t",
          },
        }),
      }),
    );

    session.startTagStream(["Count"]);
    expect(session.getState().streaming).toBeDefined();

    await session.refreshStatus();

    expect(close).toHaveBeenCalledTimes(1);
    expect(session.getState().streaming).toBeUndefined();
    expect(session.getState().staleTagReasons["Count"]).toBe("stale: controller faulted");
    expect(session.getState().status?.health).toBe("faulted");
  });

  it("surfaces unsupported tag streams and leaves polling available", () => {
    const session = new EscoOnlineSession(
      fakeClient({
        subscribeTags: () => {
          throw new GatewayApiError(409, "EtherNet/IP driver does not support tag subscriptions.");
        },
      }),
    );
    session.startTagStream(["Count"]);
    expect(session.getState().streaming).toBeUndefined();
    expect(session.getState().lastError).toContain("does not support tag subscriptions");
    session.startTagPolling(["Count"], 1000);
    expect(session.getState().polling?.names).toEqual(["Count"]);
    session.stopTagPolling();
  });

  it("disconnect stops an active stream", async () => {
    const close = vi.fn();
    const session = new EscoOnlineSession(
      fakeClient({
        subscribeTags: () => ({ close }),
      }),
    );
    session.startTagStream(["Count"]);
    expect(session.getState().streaming).toBeDefined();
    await session.disconnect();
    expect(close).toHaveBeenCalledTimes(1);
    expect(session.getState().streaming).toBeUndefined();
  });

  it("restarting polling replaces the previous loop", async () => {
    vi.useFakeTimers();
    const seen: string[][] = [];
    const session = new EscoOnlineSession(
      fakeClient({
        readTags: async (tagNames) => {
          seen.push([...tagNames]);
          return { values: [], errors: {} };
        },
      }),
    );
    session.startTagPolling(["A"], 1000);
    await vi.advanceTimersByTimeAsync(10);
    session.startTagPolling(["B"], 1000);
    await vi.advanceTimersByTimeAsync(1010);
    session.stopTagPolling();
    expect(seen.flat()).not.toContain("A".repeat(2)); // sanity
    const afterRestart = seen.slice(1).flat();
    expect(afterRestart.every((name) => name === "B")).toBe(true);
  });
});

describe("state mechanics", () => {
  it("notifies subscribers on every change and toggles busy", async () => {
    const session = new EscoOnlineSession(fakeClient());
    const busySeen: boolean[] = [];
    const unsubscribe = session.subscribe(() => busySeen.push(session.getState().busy));
    await session.refreshAudit();
    expect(busySeen[0]).toBe(true); // run() raised busy first
    expect(busySeen[busySeen.length - 1]).toBe(false);
    unsubscribe();
    const countAfter = busySeen.length;
    await session.refreshAudit();
    expect(busySeen.length).toBe(countAfter); // unsubscribed
  });

  it("exposes no write-capable surface (read-only milestone guard)", () => {
    const session = new EscoOnlineSession(fakeClient());
    const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(session));
    const writeLike = methods.filter((name) =>
      /(write|force|download|onlineEdit|modeChange|clearFault)/i.test(name),
    );
    expect(writeLike).toEqual([]);
  });
});
