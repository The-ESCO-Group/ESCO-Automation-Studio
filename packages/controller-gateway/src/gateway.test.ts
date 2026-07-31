import { describe, expect, it } from "vitest";
import type { PlcProject } from "@esco/core";
import { createDefaultControllerDrivers, L5XSyncDriver, SimulatorGatewayDriver } from "./drivers";
import { ControllerGateway, describeControllerDriver } from "./gateway";
import { PROJECT_SIGNATURE_ALGORITHM, compareControllerIdentity, localProjectIdentity } from "./identity";
import { ONLINE_CONNECTION_STATE_LABELS, type ControllerDriver, type ControllerDriverKind, type SubscriptionHandle } from "./types";

const project = (name = "Line1"): PlcProject => ({
  id: "project-1",
  name,
  createdAt: "2026-06-05T00:00:00.000Z",
  updatedAt: "2026-06-05T00:00:00.000Z",
  controllers: [
    {
      id: "controller-1",
      projectId: "project-1",
      name: "PLC_1",
      processorType: "ControlLogix 5580",
      firmwareRevision: "36.011",
      tasks: [],
      programs: [],
      controllerTags: [
        { id: "tag-1", controllerId: "controller-1", name: "StartPB", dataType: "BOOL", scope: "controller", value: false },
        { id: "tag-2", controllerId: "controller-1", name: "SpeedCmd", dataType: "DINT", scope: "controller", value: 10 },
      ],
      dataTypes: [],
      addOnInstructions: [],
      ioConfiguration: { modules: [] },
      trends: [],
      quickWatchLists: [],
      parameterConnections: [],
    },
  ],
});

const matchedSimulator = (localProject = project()): SimulatorGatewayDriver => new SimulatorGatewayDriver({
  identity: localProjectIdentity(localProject),
  allowWrites: true,
  tags: [
    { name: "StartPB", dataType: "BOOL", value: false, writable: true },
    { name: "SpeedCmd", dataType: "DINT", value: 10, writable: true },
  ],
});

const capabilityDisabledDriver = (localProject = project()): ControllerDriver => {
  const identity = localProjectIdentity(localProject);
  return {
    id: "capability-disabled",
    name: "Capability Disabled Driver",
    kind: "simulator",
    capabilities: {
      canConnect: true,
      canReadStatus: false,
      canReadFaults: false,
      canBrowseTags: false,
      canReadTags: false,
      canBatchReadTags: false,
      canSubscribeTags: false,
      canUploadSnapshot: false,
      canCompareProject: false,
    },
    async connect() {
      return { ok: true, state: "online-readonly", message: "Connected with all read actions capability-disabled.", identity };
    },
    async disconnect() {},
    async getIdentity() {
      return identity;
    },
    async getStatus() {
      return { state: "online-readonly", connected: true, health: "ok", message: "Status should be gated.", updatedAt: "t" };
    },
    async getFaults() {
      return [];
    },
    async browseTags() {
      return [{ name: "Hidden", dataType: "BOOL", writable: false, sourceDriver: "simulator" }];
    },
    async readTag(tagName) {
      return { tagName, value: true, dataType: "BOOL", quality: "good", timestamp: "t", sourceDriver: "simulator" };
    },
    async readTags(tagNames) {
      return {
        values: tagNames.map((tagName) => ({ tagName, value: true, dataType: "BOOL", quality: "good", timestamp: "t", sourceDriver: "simulator" })),
        errors: {},
      };
    },
    async subscribeTags() {
      return { id: "hidden-sub", unsubscribe: async () => undefined };
    },
    async uploadSnapshot() {
      return { id: "hidden-snapshot", capturedAt: "t", sourceDriver: "simulator", identity, tags: [] };
    },
    async compareProject(compareProject) {
      return compareControllerIdentity(localProjectIdentity(compareProject), identity);
    },
  };
};

const statusHealthDriver = (localProject = project()): { driver: ControllerDriver; setConnected(value: boolean): void; disconnects(): number } => {
  const identity = localProjectIdentity(localProject);
  let connected = true;
  let disconnectCount = 0;
  return {
    setConnected(value: boolean): void {
      connected = value;
    },
    disconnects(): number {
      return disconnectCount;
    },
    driver: {
      id: "status-health",
      name: "Status Health Driver",
      kind: "simulator",
      async connect() {
        return { ok: true, state: "online-readonly", message: "Connected for status health.", identity };
      },
      async getIdentity() {
        return identity;
      },
      async getStatus() {
        return connected
          ? { state: "online-readonly", connected: true, health: "ok", message: "Heartbeat ok.", updatedAt: "t" }
          : { state: "disconnected", connected: false, health: "warning", message: "Heartbeat failed.", updatedAt: "t" };
      },
      async disconnect() {
        connected = false;
        disconnectCount += 1;
      },
      async getFaults() {
        return [];
      },
      async readTag(tagName) {
        return { tagName, value: true, dataType: "BOOL", quality: "good", timestamp: "t", sourceDriver: "simulator" };
      },
    },
  };
};

const connectStatusDisconnectedDriver = (localProject = project()): { driver: ControllerDriver; disconnects(): number } => {
  const identity = localProjectIdentity(localProject);
  let disconnectCount = 0;
  return {
    disconnects(): number {
      return disconnectCount;
    },
    driver: {
      id: "connect-status-disconnected",
      name: "Connect Status Disconnected Driver",
      kind: "simulator",
      async connect() {
        return {
          ok: true,
          state: "online-readonly",
          message: "Connect returned ok with disconnected status.",
          identity,
          status: {
            state: "disconnected",
            connected: false,
            health: "warning",
            message: "Initial heartbeat failed.",
            updatedAt: "t",
          },
        };
      },
      async disconnect() {
        disconnectCount += 1;
      },
      async getIdentity() {
        return identity;
      },
      async getStatus() {
        throw new Error("status should not be requested after failed connect");
      },
      async getFaults() {
        return [];
      },
      async readTag(tagName) {
        return { tagName, value: true, dataType: "BOOL", quality: "good", timestamp: "t", sourceDriver: "simulator" };
      },
    },
  };
};

const identityTagDriver = (values: Record<string, boolean | number | string | null>): ControllerDriver => ({
  id: "identity-tags",
  name: "Identity Tag Driver",
  kind: "ethernetip",
  async connect() {
    return {
      ok: true,
      state: "online-readonly",
      message: "Connected for read-only identity tag proof.",
      identity: {
        controllerType: "ControlLogix 5580",
        firmwareRevision: "36.011",
        productName: "1756-L85E",
      },
    };
  },
  async disconnect() {},
  async getIdentity() {
    return {
      controllerType: "ControlLogix 5580",
      firmwareRevision: "36.011",
      productName: "1756-L85E",
    };
  },
  async getStatus() {
    return { state: "online-readonly", connected: true, health: "ok", message: "Identity tag driver online.", updatedAt: "t" };
  },
  async getFaults() {
    return [];
  },
  async readTag(tagName) {
    if (!(tagName in values)) throw new Error(`Unknown proof tag: ${tagName}`);
    return {
      tagName,
      value: values[tagName],
      dataType: "STRING",
      quality: "good",
      timestamp: "t",
      sourceDriver: "ethernetip",
    };
  },
});

describe("Goal B online state model", () => {
  it("contains every B1 state label", () => {
    expect(Object.values(ONLINE_CONNECTION_STATE_LABELS)).toEqual([
      "Offline",
      "Connecting",
      "Online Read-Only",
      "Online Matched",
      "Online Mismatched",
      "Online Monitor",
      "Online Controlled Write",
      "Faulted",
      "Disconnected",
    ]);
  });
});

describe("ControllerGateway driver registry", () => {
  it("registers the required Goal B driver paths", () => {
    const kinds = new Set<ControllerDriverKind>(createDefaultControllerDrivers().map((driver) => driver.kind));
    expect(kinds).toEqual(new Set(["simulator", "opcua", "opcda", "ethernetip", "l5x"]));
  });

  it("publishes honest public capability summaries for drivers", () => {
    const summaries = new ControllerGateway(createDefaultControllerDrivers()).listDriverSummaries();
    const simulator = summaries.find((driver) => driver.id === "esco-simulator");
    expect(simulator?.capabilities).toMatchObject({
      canConnect: true,
      canBrowseTags: true,
      canReadTags: true,
      canSubscribeTags: true,
      canUploadSnapshot: true,
      canCompareProject: true,
      canWriteTags: false,
      canDownloadProject: false,
      canOnlineEdit: false,
      canForceTags: false,
    });
    expect(simulator?.readOnly).toBe(true);
    expect(simulator?.safetyNote).toContain("read-only");
    expect(simulator?.connectionEvidence).toMatchObject({
      transportValidation: "software-wired",
      realControllerIo: false,
      hardwareValidated: false,
      verified: true,
    });

    const opcuaPlaceholder = summaries.find((driver) => driver.id === "opcua-generic-readonly");
    expect(opcuaPlaceholder?.capabilities.canConnect).toBe(false);
    expect(opcuaPlaceholder?.capabilities.canReadTags).toBe(false);
    expect(opcuaPlaceholder?.connectionEvidence.transportValidation).toBe("none");

    const l5x = summaries.find((driver) => driver.id === "l5x-sync");
    expect(l5x?.capabilities).toMatchObject({
      canConnect: true,
      canReadStatus: true,
      canReadFaults: false,
      canBrowseTags: true,
      canReadTags: true,
      canUploadSnapshot: true,
    });
    expect(l5x?.connectionEvidence.label).toBe("Offline snapshot");

    const direct = describeControllerDriver(matchedSimulator());
    expect(direct.capabilities.canUploadSnapshot).toBe(true);
    expect(direct.capabilities.canWriteTags).toBe(false);
    expect(direct.connectionEvidence.label).toContain("simulator");
  });

  it("keeps real driver placeholders routed through the gateway but disconnected until adapters exist", async () => {
    const gateway = new ControllerGateway(createDefaultControllerDrivers());
    const result = await gateway.connect("opcua-generic-readonly", { endpointUrl: "opc.tcp://example.invalid:4840" }, project());
    expect(result.ok).toBe(false);
    expect(gateway.snapshot().state).toBe("disconnected");
    expect(result.message).toContain("no live controller transport");
    expect(result.connectionEvidence).toMatchObject({ transportValidation: "none", realControllerIo: false });
    expect(gateway.snapshot().readOnlyReason).toContain("no live controller transport");
    expect(gateway.auditLog.at(-1)).toMatchObject({
      action: "connect",
      result: "blocked",
      details: {
        capability: "canConnect",
        driverName: "Generic OPC UA Read-Only Placeholder",
        connectionEvidence: { transportValidation: "none", realControllerIo: false },
      },
    });
  });

  it("blocks canConnect=false drivers before invoking transport connect", async () => {
    let transportConnectCalled = false;
    const identity = localProjectIdentity(project());
    const driver: ControllerDriver = {
      id: "placeholder-with-connect",
      name: "Placeholder With Connect",
      kind: "ethernetip",
      capabilities: {
        canConnect: false,
        canReadStatus: false,
        canReadFaults: false,
        canBrowseTags: false,
        canReadTags: false,
        canBatchReadTags: false,
        canSubscribeTags: false,
        canUploadSnapshot: false,
        canCompareProject: false,
      },
      async connect() {
        transportConnectCalled = true;
        return { ok: true, state: "online-matched", message: "This transport should not run.", identity };
      },
      async disconnect() {},
      async getIdentity() {
        throw new Error("identity should not be requested");
      },
      async getStatus() {
        throw new Error("status should not be requested");
      },
      async getFaults() {
        throw new Error("faults should not be requested");
      },
      async readTag() {
        throw new Error("tags should not be requested");
      },
    };
    const gateway = new ControllerGateway([driver]);

    const result = await gateway.connect("placeholder-with-connect", {}, project());

    expect(transportConnectCalled).toBe(false);
    expect(result).toMatchObject({
      ok: false,
      state: "disconnected",
      message: expect.stringContaining("no live controller transport"),
      connectionEvidence: { transportValidation: "none", realControllerIo: false },
    });
    expect(gateway.snapshot()).toMatchObject({
      state: "disconnected",
      driverId: "placeholder-with-connect",
      readOnly: true,
      readOnlyReason: expect.stringContaining("no live controller transport"),
      capabilities: { canConnect: false },
    });
    expect(gateway.auditLog).toEqual([
      expect.objectContaining({
        action: "connect",
        result: "blocked",
        details: expect.objectContaining({
          capability: "canConnect",
          driverName: "Placeholder With Connect",
          connectionEvidence: expect.objectContaining({ transportValidation: "none", realControllerIo: false }),
        }),
      }),
    ]);
  });

  it("rejects drivers that report ok connect with disconnected initial status", async () => {
    const driver = connectStatusDisconnectedDriver();
    const gateway = new ControllerGateway([driver.driver]);

    const result = await gateway.connect("connect-status-disconnected", {}, project());

    expect(result).toMatchObject({
      ok: false,
      state: "disconnected",
      message: expect.stringContaining("reported disconnected during connect"),
      status: {
        state: "disconnected",
        connected: false,
        health: "warning",
      },
    });
    expect(driver.disconnects()).toBe(1);
    expect(gateway.snapshot()).toMatchObject({
      state: "disconnected",
      readOnly: true,
      readOnlyReason: "Controller status reports the session is disconnected.",
    });
    expect(gateway.auditLog.at(-1)).toMatchObject({
      action: "connect",
      result: "failed",
      state: "disconnected",
      details: expect.objectContaining({
        status: { state: "disconnected", connected: false, health: "warning" },
      }),
    });
  });
});

describe("ControllerGateway match safety", () => {
  it("defaults to read-only when required controller identity evidence is missing", () => {
    const localIdentity = localProjectIdentity(project());
    const compare = compareControllerIdentity(localIdentity, {
      ...localIdentity,
      controllerName: undefined,
    });

    expect(compare.state).toBe("unknown");
    expect(compare.matched).toBe(false);
    expect(compare.message).toContain("Required controller identity evidence is missing");
    expect(compare.differences).toContainEqual(
      expect.objectContaining({ field: "controllerName", local: "PLC_1", online: undefined, severity: "blocking" }),
    );
  });

  it("uses configured read-only identity tags to prove the local project match", async () => {
    const localProject = project();
    const localIdentity = localProjectIdentity(localProject);
    const gateway = new ControllerGateway([
      identityTagDriver({
        EscoControllerName: localIdentity.controllerName ?? "",
        EscoControllerType: localIdentity.controllerType ?? "",
        EscoProjectName: localIdentity.projectName ?? "",
        EscoProjectSignature: (localIdentity.projectSignature ?? "").split(":").at(1) ?? "",
        EscoProjectSignatureAlgorithm: localIdentity.projectSignatureAlgorithm ?? "",
      }),
    ]);

    const result = await gateway.connect(
      "identity-tags",
      {
        identityTags: {
          controllerName: "EscoControllerName",
          controllerType: "EscoControllerType",
          projectName: "EscoProjectName",
          projectSignature: "EscoProjectSignature",
          projectSignatureAlgorithm: "EscoProjectSignatureAlgorithm",
        },
      },
      localProject,
    );

    expect(result.ok).toBe(true);
    expect(result.state).toBe("online-matched");
    expect(result.compare?.matched).toBe(true);
    expect(result.identity).toMatchObject({
      controllerName: "PLC_1",
      controllerType: "ControlLogix 5580",
      projectName: "Line1",
      projectSignature: localIdentity.projectSignature,
      projectSignatureAlgorithm: PROJECT_SIGNATURE_ALGORITHM,
      projectSignatureSource: "controller-tag:EscoProjectSignature",
    });
    expect(gateway.snapshot().readOnly).toBe(true);
    expect(gateway.snapshot().capabilities?.canWriteTags).toBe(false);
    expect(gateway.auditLog.find((entry) => entry.action === "identity-evidence")).toMatchObject({
      result: "ran",
      details: {
        applied: {
          controllerName: "EscoControllerName",
          controllerType: "EscoControllerType",
          projectName: "EscoProjectName",
          projectSignature: "EscoProjectSignature",
          projectSignatureAlgorithm: "EscoProjectSignatureAlgorithm",
        },
      },
    });
  });

  it("keeps identity-tag sessions read-only when configured proof tags are missing", async () => {
    const localProject = project();
    const localIdentity = localProjectIdentity(localProject);
    const gateway = new ControllerGateway([
      identityTagDriver({
        EscoControllerName: localIdentity.controllerName ?? "",
        EscoControllerType: localIdentity.controllerType ?? "",
        EscoProjectName: localIdentity.projectName ?? "",
      }),
    ]);

    const result = await gateway.connect(
      "identity-tags",
      {
        identityTags: {
          controllerName: "EscoControllerName",
          controllerType: "EscoControllerType",
          projectName: "EscoProjectName",
          projectSignature: "MissingSignatureTag",
        },
      },
      localProject,
    );

    expect(result.ok).toBe(true);
    expect(result.state).toBe("online-readonly");
    expect(result.compare?.state).toBe("unknown");
    expect(result.compare?.differences).toContainEqual(
      expect.objectContaining({ field: "projectSignature", online: undefined, severity: "blocking" }),
    );
    expect(gateway.snapshot().readOnly).toBe(true);
    expect(gateway.auditLog.find((entry) => entry.action === "identity-evidence")).toMatchObject({
      result: "ran",
      details: {
        failed: { projectSignature: "Unknown proof tag: MissingSignatureTag" },
      },
    });
  });

  it("goes Online Matched only when identity/signature proves the local project matches", async () => {
    const localProject = project();
    const gateway = new ControllerGateway([matchedSimulator(localProject)]);
    const result = await gateway.connect("esco-simulator", {}, localProject);
    expect(result.ok).toBe(true);
    expect(gateway.snapshot().state).toBe("online-matched");
    expect(gateway.snapshot().readOnly).toBe(true);
    expect(gateway.snapshot().capabilities?.canWriteTags).toBe(false);
    expect(gateway.snapshot().connectionEvidence).toMatchObject({
      transportValidation: "software-wired",
      realControllerIo: false,
      hardwareValidated: false,
    });
    expect(gateway.snapshot().readOnlyReason).toContain("Public ESCO online mode is read-only");
    expect(result.compare?.matched).toBe(true);
  });

  it("recomputes match proof from fresh identity and downgrades stale matched sessions", async () => {
    const localProject = project();
    const mutableIdentity = localProjectIdentity(localProject);
    const gateway = new ControllerGateway([
      new SimulatorGatewayDriver({
        identity: mutableIdentity,
        tags: [{ name: "StartPB", dataType: "BOOL", value: false, writable: true }],
        allowWrites: true,
      }),
    ]);
    await gateway.connect("esco-simulator", {}, localProject);
    expect(gateway.snapshot().state).toBe("online-matched");

    mutableIdentity.projectName = "DifferentOnlineProject";
    await gateway.getIdentity();

    expect(gateway.snapshot().state).toBe("online-mismatched");
    expect(gateway.snapshot().compare?.matched).toBe(false);
    expect(gateway.snapshot().compare?.differences).toContainEqual(
      expect.objectContaining({ field: "projectName", local: "Line1", online: "DifferentOnlineProject" }),
    );
    expect(gateway.snapshot().readOnly).toBe(true);
  });

  it("defaults to read-only when no local project is available to prove a match", async () => {
    const gateway = new ControllerGateway([matchedSimulator()]);
    const result = await gateway.connect("esco-simulator");
    expect(result.ok).toBe(true);
    expect(gateway.snapshot().state).toBe("online-readonly");
    expect(gateway.snapshot().readOnly).toBe(true);
  });

  it("keeps a session read-only when the controller cannot prove every required B5 identity field", async () => {
    const localProject = project();
    const incompleteIdentity = {
      ...localProjectIdentity(localProject),
      controllerType: undefined,
    };
    const gateway = new ControllerGateway([
      new SimulatorGatewayDriver({
        identity: incompleteIdentity,
        tags: [{ name: "StartPB", dataType: "BOOL", value: false, writable: true }],
        allowWrites: true,
      }),
    ]);

    const result = await gateway.connect("esco-simulator", {}, localProject);

    expect(result.ok).toBe(true);
    expect(result.state).toBe("online-readonly");
    expect(result.compare?.state).toBe("unknown");
    expect(result.compare?.matched).toBe(false);
    expect(result.compare?.differences).toContainEqual(
      expect.objectContaining({ field: "controllerType", local: "ControlLogix 5580", online: undefined }),
    );
    expect(gateway.snapshot().readOnly).toBe(true);
  });

  it("goes Online Mismatched and stays read-only when the controller identity differs", async () => {
    const gateway = new ControllerGateway([matchedSimulator(project("DifferentOnlineProject"))]);
    const result = await gateway.connect("esco-simulator", {}, project("LocalProject"));
    expect(result.ok).toBe(true);
    expect(gateway.snapshot().state).toBe("online-mismatched");
    expect(result.compare?.differences.some((entry) => entry.field === "projectName")).toBe(true);
    expect(gateway.snapshot().readOnly).toBe(true);
  });

  it("treats routine/program structure changes as project-signature mismatches", async () => {
    const onlineProject: PlcProject = {
      ...project("Line1"),
      controllers: [
        {
          ...project("Line1").controllers[0],
          programs: [
            {
              id: "program-1",
              controllerId: "controller-1",
              name: "MainProgram",
              routines: [
                {
                  id: "routine-1",
                  programId: "program-1",
                  name: "MainRoutine",
                  language: "structured-text",
                  structuredText: "SpeedCmd := 10;",
                },
              ],
              programTags: [],
            },
          ],
        },
      ],
    };
    const localProject: PlcProject = {
      ...onlineProject,
      controllers: [
        {
          ...onlineProject.controllers[0],
          programs: [
            {
              ...onlineProject.controllers[0].programs[0],
              routines: [
                {
                  ...onlineProject.controllers[0].programs[0].routines[0],
                  id: "different-generated-id",
                  structuredText: "SpeedCmd := 11;",
                },
              ],
            },
          ],
        },
      ],
    };
    const gateway = new ControllerGateway([matchedSimulator(onlineProject)]);

    const result = await gateway.connect("esco-simulator", {}, localProject);

    expect(result.ok).toBe(true);
    expect(gateway.snapshot().state).toBe("online-mismatched");
    expect(result.compare?.differences).toEqual([
      expect.objectContaining({ field: "projectSignature", severity: "blocking" }),
    ]);
    expect(gateway.snapshot().readOnly).toBe(true);
  });

  it("ignores generated routine ids when project structure is otherwise equivalent", () => {
    const left: PlcProject = {
      ...project("Line1"),
      controllers: [
        {
          ...project("Line1").controllers[0],
          programs: [
            {
              id: "program-left",
              controllerId: "controller-1",
              name: "MainProgram",
              routines: [
                {
                  id: "routine-left",
                  programId: "program-left",
                  name: "MainRoutine",
                  language: "structured-text",
                  structuredText: "SpeedCmd := 10;",
                },
              ],
              programTags: [],
            },
          ],
        },
      ],
    };
    const right: PlcProject = {
      ...left,
      controllers: [
        {
          ...left.controllers[0],
          programs: [
            {
              ...left.controllers[0].programs[0],
              id: "program-right",
              routines: [
                {
                  ...left.controllers[0].programs[0].routines[0],
                  id: "routine-right",
                  programId: "program-right",
                },
              ],
            },
          ],
        },
      ],
    };

    expect(localProjectIdentity(left).projectSignature).toBe(localProjectIdentity(right).projectSignature);
  });

  it("uses a SHA-256 stable-project signature with explicit algorithm metadata", () => {
    const identity = localProjectIdentity(project());
    expect(identity.projectSignature).toMatch(
      new RegExp(`^${PROJECT_SIGNATURE_ALGORITHM}:[a-f0-9]{64}$`),
    );
    expect(identity.projectSignatureAlgorithm).toBe(PROJECT_SIGNATURE_ALGORITHM);
    expect(identity.projectSignatureSource).toBe("local-esco-project");
  });
});

describe("Online tag monitor and controlled writes", () => {
  it("enforces read-side capability flags even when a driver exposes optional methods", async () => {
    const localProject = project();
    const gateway = new ControllerGateway([capabilityDisabledDriver(localProject)]);

    const connect = await gateway.connect("capability-disabled", {}, localProject);

    expect(connect.ok).toBe(true);
    expect(connect.state).toBe("online-readonly");
    expect(connect.compare?.matched).toBe(false);
    expect(connect.compare?.message).toContain("cannot be proven");
    expect(gateway.snapshot().capabilities).toMatchObject({
      canReadStatus: false,
      canReadFaults: false,
      canBrowseTags: false,
      canReadTags: false,
      canBatchReadTags: false,
      canSubscribeTags: false,
      canUploadSnapshot: false,
      canCompareProject: false,
    });

    await expect(gateway.getStatus()).rejects.toThrow("does not support status reads");
    await expect(gateway.getFaults()).rejects.toThrow("does not support fault reads");
    await expect(gateway.browseTags()).rejects.toThrow("does not support tag browsing");
    await expect(gateway.readTag("Hidden")).rejects.toThrow("does not support tag reads");
    await expect(gateway.readTags(["Hidden"])).rejects.toThrow("does not support tag reads");
    await expect(gateway.watchTags(["Hidden"], () => undefined)).rejects.toThrow("does not support tag subscriptions");
    await expect(gateway.uploadSnapshot()).rejects.toThrow("does not support upload snapshots");
    await expect(gateway.compareProject(localProject)).rejects.toThrow("does not support project compare");

    const blockedActions = new Set(gateway.auditLog.filter((entry) => entry.result === "blocked").map((entry) => entry.action));
    expect(blockedActions).toEqual(
      new Set(["status", "faults", "browse-tags", "read-tag", "read-tags", "watch-tags", "upload-snapshot", "compare-project"]),
    );
    expect(gateway.auditLog.find((entry) => entry.action === "read-tag")?.details).toMatchObject({
      capability: "canReadTags",
      driverName: "Capability Disabled Driver",
      connectionEvidence: { transportValidation: "software-wired", realControllerIo: false },
    });
    expect(gateway.auditLog.find((entry) => entry.action === "upload-snapshot")?.details).toMatchObject({
      capability: "canUploadSnapshot",
    });
  });

  it("downgrades the gateway snapshot when driver status reports a lost connection", async () => {
    const driver = statusHealthDriver();
    const gateway = new ControllerGateway([driver.driver]);
    await gateway.connect("status-health");
    expect(gateway.snapshot().state).toBe("online-readonly");

    driver.setConnected(false);
    const status = await gateway.getStatus();

    expect(status).toMatchObject({
      state: "disconnected",
      connected: false,
      health: "warning",
    });
    expect(gateway.snapshot()).toMatchObject({
      state: "disconnected",
      readOnly: true,
      readOnlyReason: "Controller status reports the session is disconnected.",
    });
    expect(driver.disconnects()).toBe(1);
    expect(gateway.auditLog.at(-1)).toMatchObject({
      action: "status",
      state: "disconnected",
      message: "Heartbeat failed.",
    });
    await expect(gateway.readTag("Any")).rejects.toThrow("Controller Gateway is not online.");
  });

  it("reads, watches, and uploads values through the gateway", async () => {
    const localProject = project();
    const gateway = new ControllerGateway([matchedSimulator(localProject)]);
    await gateway.connect("esco-simulator", {}, localProject);
    expect((await gateway.browseTags()).map((tag) => tag.name)).toContain("SpeedCmd");
    expect(gateway.auditLog.find((entry) => entry.action === "browse-tags")?.details).toMatchObject({
      tagCount: 2,
      sourceDriver: "simulator",
    });
    expect((await gateway.readTag("SpeedCmd")).quality).toBe("good");
    expect(gateway.auditLog.find((entry) => entry.action === "read-tag")?.details).toMatchObject({
      tagName: "SpeedCmd",
      quality: "good",
      sourceDriver: "simulator",
    });
    const watched: string[] = [];
    const handle = await gateway.watchTags(["StartPB"], (value) => watched.push(`${value.tagName}:${value.value}`));
    expect(gateway.snapshot().state).toBe("online-monitor");
    expect(watched).toEqual(["StartPB:false"]);
    expect(gateway.auditLog.find((entry) => entry.action === "watch-tags")?.details).toMatchObject({
      tagCount: 1,
      subscriptionId: expect.any(String),
    });
    await handle.unsubscribe();
    expect(gateway.snapshot().state).toBe("online-matched");
    expect(gateway.auditLog.at(-1)).toMatchObject({
      action: "watch-tags",
      message: expect.stringContaining("Stopped watching subscription"),
      details: { activeWatchCount: 0 },
    });
    const snapshot = await gateway.uploadSnapshot();
    expect(snapshot.tags).toHaveLength(2);
    expect(snapshot.connectionEvidence).toMatchObject({
      transportValidation: "software-wired",
      realControllerIo: false,
    });
    expect(gateway.auditLog.find((entry) => entry.action === "upload-snapshot")?.details).toMatchObject({
      snapshotId: snapshot.id,
      sourceDriver: "simulator",
      tagCount: 2,
      connectionEvidence: { transportValidation: "software-wired", realControllerIo: false },
    });
  });

  it("keeps Online Monitor until every active watch is unsubscribed", async () => {
    const localProject = project();
    const gateway = new ControllerGateway([matchedSimulator(localProject)]);
    await gateway.connect("esco-simulator", {}, localProject);
    expect(gateway.snapshot().state).toBe("online-matched");

    const first = await gateway.watchTags(["StartPB"], () => undefined);
    const second = await gateway.watchTags(["SpeedCmd"], () => undefined);
    expect(gateway.snapshot().state).toBe("online-monitor");

    await first.unsubscribe();
    expect(gateway.snapshot().state).toBe("online-monitor");

    await second.unsubscribe();
    expect(gateway.snapshot().state).toBe("online-matched");
  });

  it("does not revive an online state when a stale watch handle unsubscribes after disconnect", async () => {
    const localProject = project();
    const gateway = new ControllerGateway([matchedSimulator(localProject)]);
    await gateway.connect("esco-simulator", {}, localProject);
    const handle = await gateway.watchTags(["StartPB"], () => undefined);
    expect(gateway.snapshot().state).toBe("online-monitor");

    await gateway.disconnect();
    expect(gateway.snapshot().state).toBe("disconnected");

    await handle.unsubscribe();
    await handle.unsubscribe();
    expect(gateway.snapshot().state).toBe("disconnected");
  });

  it("keeps controlled writes blocked while the public driver capability contract disables writes", async () => {
    const localProject = project();
    const gateway = new ControllerGateway([matchedSimulator(localProject)]);
    await gateway.connect("esco-simulator", {}, localProject);
    const result = await gateway.controlledWrite({ tagName: "StartPB", value: true, confirmed: true, permission: "granted", reason: "operator-request" });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("capability contract");
    expect((await gateway.readTag("StartPB")).value).toBe(false);
    expect(gateway.auditLog.some((entry) => entry.action === "controlled-write" && entry.result === "blocked")).toBe(true);
  });

  it("blocks controlled writes when the online controller is mismatched", async () => {
    const gateway = new ControllerGateway([matchedSimulator(project("OnlineProject"))]);
    await gateway.connect("esco-simulator", {}, project("LocalProject"));
    const result = await gateway.controlledWrite({ tagName: "StartPB", value: true, confirmed: true, permission: "granted", reason: "test" });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("proven local/controller match");
  });
});

describe("L5X import/export/sync driver path", () => {
  it("opens an offline project snapshot and exposes structure through the gateway contract", async () => {
    const localProject: PlcProject = {
      ...project("ImportedL5X"),
      updatedAt: "2026-06-07T12:34:00.000Z",
      provenance: { sourceType: "xml-review-import", importedAt: "2026-06-07T12:00:00.000Z", fileName: "line.L5X" },
      controllers: [
        {
          ...project("ImportedL5X").controllers[0],
          controllerTags: [
            { id: "tag-1", controllerId: "controller-1", name: "StartPB", dataType: "BOOL", scope: "controller", value: true },
          ],
          programs: [
            {
              id: "program-1",
              controllerId: "controller-1",
              name: "MainProgram",
              routines: [],
              programTags: [
                { id: "tag-2", controllerId: "controller-1", programId: "program-1", name: "SpeedCmd", dataType: "DINT", scope: "program", value: 42 },
              ],
            },
          ],
        },
      ],
    };
    const gateway = new ControllerGateway([new L5XSyncDriver()]);

    const connect = await gateway.connect("l5x-sync", {}, localProject);

    expect(connect.ok).toBe(true);
    expect(connect.message).toContain("offline L5X/project snapshot");
    expect(gateway.snapshot().state).toBe("online-matched");
    expect(gateway.snapshot().readOnly).toBe(true);
    expect(gateway.snapshot().capabilities).toMatchObject({
      canConnect: true,
      canBrowseTags: true,
      canReadTags: true,
      canBatchReadTags: true,
      canReadFaults: false,
      canSubscribeTags: false,
      canUploadSnapshot: true,
      canWriteTags: false,
    });
    await expect(gateway.getFaults()).rejects.toThrow("does not support fault reads");
    expect(gateway.auditLog.find((entry) => entry.action === "faults")).toMatchObject({
      result: "blocked",
      details: {
        capability: "canReadFaults",
        driverName: "L5X Import/Export/Sync Layer",
        connectionEvidence: { label: "Offline snapshot", realControllerIo: false },
      },
    });

    const tags = await gateway.browseTags();
    expect(tags).toEqual([
      expect.objectContaining({ name: "StartPB", scope: "controller", writable: false, sourceDriver: "l5x" }),
      expect.objectContaining({ name: "Program:MainProgram.SpeedCmd", scope: "program", writable: false, sourceDriver: "l5x" }),
    ]);

    expect(await gateway.readTag("StartPB")).toMatchObject({
      tagName: "StartPB",
      value: true,
      quality: "stale",
      timestamp: "2026-06-07T12:34:00.000Z",
      sourceDriver: "l5x",
    });
    const batch = await gateway.readTags(["Program:MainProgram.SpeedCmd", "Missing"]);
    expect(batch.values[0]).toMatchObject({ value: 42, sourceDriver: "l5x", quality: "stale" });
    expect(batch.errors["Missing"]).toContain("Unknown L5X snapshot tag");

    const snapshot = await gateway.uploadSnapshot();
    expect(snapshot.sourceDriver).toBe("l5x");
    expect(snapshot.tags).toHaveLength(2);
    expect(snapshot.connectionEvidence?.label).toBe("Offline snapshot");
    expect(snapshot.raw).toMatchObject({ projectName: "ImportedL5X", sourceType: "xml-review-import" });

    const compare = await gateway.compareProject(localProject);
    expect(compare.matched).toBe(true);
  });

  it("refuses L5X sync without an offline project snapshot", async () => {
    const gateway = new ControllerGateway([new L5XSyncDriver()]);
    const result = await gateway.connect("l5x-sync");
    expect(result.ok).toBe(false);
    expect(result.message).toContain("requires an offline ESCO project snapshot");
    expect(gateway.snapshot().state).toBe("disconnected");
  });
});

/**
 * A driver whose `subscribeTags()` setup is held open until the test resolves
 * or rejects it, with the inner handle's unsubscribe and disconnect calls
 * counted — lets us drive the pending-subscription race deterministically.
 */
function delayedSubscribeDriver(localProject = project()): {
  driver: ControllerDriver;
  resolve(id?: string): void;
  reject(reason: unknown): void;
  unsubscribeCalls(): number;
  disconnects(): number;
} {
  const identity = localProjectIdentity(localProject);
  let resolveSubscribe: ((handle: SubscriptionHandle) => void) | undefined;
  let rejectSubscribe: ((reason: unknown) => void) | undefined;
  let unsubscribeCalls = 0;
  let disconnectCount = 0;
  const driver: ControllerDriver = {
    id: "delayed-subscribe",
    name: "Delayed Subscribe Driver",
    kind: "simulator",
    capabilities: {
      canConnect: true,
      canReadStatus: true,
      canReadFaults: true,
      canReadTags: true,
      canSubscribeTags: true,
      canCompareProject: true,
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
      return { state: "online-readonly", connected: true, health: "ok", message: "ok", updatedAt: "t" };
    },
    async getFaults() {
      return [];
    },
    async readTag(tagName) {
      return { tagName, value: 1, dataType: "DINT", quality: "good", timestamp: "t", sourceDriver: "simulator" };
    },
    subscribeTags() {
      return new Promise<SubscriptionHandle>((resolve, reject) => {
        resolveSubscribe = resolve;
        rejectSubscribe = reject;
      });
    },
  };
  return {
    driver,
    resolve(id = "delayed-sub"): void {
      resolveSubscribe?.({
        id,
        unsubscribe: async () => {
          unsubscribeCalls += 1;
        },
      });
    },
    reject(reason: unknown): void {
      rejectSubscribe?.(reason);
    },
    unsubscribeCalls: () => unsubscribeCalls,
    disconnects: () => disconnectCount,
  };
}

describe("pending watch subscription hardening", () => {
  it("treats a pending watch setup as live and transfers it to an active watch on success", async () => {
    const localProject = project();
    const sub = delayedSubscribeDriver(localProject);
    const gateway = new ControllerGateway([sub.driver]);
    await gateway.connect("delayed-subscribe", {}, localProject);
    expect(gateway.snapshot().state).toBe("online-matched");

    const pending = gateway.watchTags(["StartPB"], () => undefined);
    // Setup is still in flight: the session must not flip to monitor yet, and
    // it must still read as a live online session (not idle/torn down).
    expect(gateway.snapshot().state).toBe("online-matched");

    sub.resolve("live-sub");
    const handle = await pending;
    expect(gateway.snapshot().state).toBe("online-monitor");

    await handle.unsubscribe();
    expect(gateway.snapshot().state).toBe("online-matched");
    expect(sub.unsubscribeCalls()).toBe(1);
  });

  it("discards a watch that resolves after disconnect without reviving the session or leaking the handle", async () => {
    const localProject = project();
    const sub = delayedSubscribeDriver(localProject);
    const gateway = new ControllerGateway([sub.driver]);
    await gateway.connect("delayed-subscribe", {}, localProject);

    const pending = gateway.watchTags(["StartPB"], () => undefined);
    await gateway.disconnect();
    expect(gateway.snapshot().state).toBe("disconnected");

    // The slow subscription only now completes — after the session is gone.
    sub.resolve("stale-sub");
    const handle = await pending;

    // Stale handle: it must close the inner subscription exactly once and never
    // revive online state.
    expect(gateway.snapshot().state).toBe("disconnected");
    expect(sub.unsubscribeCalls()).toBe(1);
    expect(
      gateway.auditLog.some(
        (entry) =>
          entry.action === "watch-tags" &&
          entry.result === "blocked" &&
          entry.message.includes("resolved after the session ended"),
      ),
    ).toBe(true);

    // The returned handle is inert: unsubscribing again is a safe no-op (no
    // double close, no state change).
    await handle.unsubscribe();
    expect(sub.unsubscribeCalls()).toBe(1);
    expect(gateway.snapshot().state).toBe("disconnected");
  });

  it("releases the pending slot when setup fails so later watches still work", async () => {
    const localProject = project();
    const sub = delayedSubscribeDriver(localProject);
    const gateway = new ControllerGateway([sub.driver]);
    await gateway.connect("delayed-subscribe", {}, localProject);

    const failing = gateway.watchTags(["StartPB"], () => undefined);
    sub.reject(new Error("subscription refused"));
    await expect(failing).rejects.toThrow("subscription refused");
    expect(gateway.snapshot().state).toBe("online-matched");
    expect(
      gateway.auditLog.some((entry) => entry.action === "watch-tags" && entry.result === "failed"),
    ).toBe(true);

    // A failed setup must not corrupt the pending count: a fresh watch still
    // transitions cleanly to Online Monitor and back.
    const pending = gateway.watchTags(["SpeedCmd"], () => undefined);
    sub.resolve("recovered-sub");
    const handle = await pending;
    expect(gateway.snapshot().state).toBe("online-monitor");

    await handle.unsubscribe();
    expect(gateway.snapshot().state).toBe("online-matched");
    expect(sub.unsubscribeCalls()).toBe(1);
  });
});
