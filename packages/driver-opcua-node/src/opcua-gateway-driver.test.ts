import { describe, expect, it, vi } from "vitest";
import type {
  OpcUaBrowseNode,
  OpcUaClientAdapter,
  OpcUaDriverConfig,
  OpcUaReadResult,
  OpcUaSessionAdapter,
} from "./opcua-gateway-driver";
import { OpcUaGatewayDriver } from "./opcua-gateway-driver";

class FakeOpcUaSession implements OpcUaSessionAdapter {
  closed = false;
  readCount = 0;
  batchReadCount = 0;
  failBatchReads = false;
  unsubscribeCount = 0;
  readonly subscriptionCallbacks: Array<(tagName: string, value: OpcUaReadResult) => void> = [];

  constructor(
    private readonly reads: Record<string, OpcUaReadResult>,
    private readonly browseMap: Record<string, OpcUaBrowseNode[]>,
  ) {}

  async readNode(nodeId: string): Promise<OpcUaReadResult> {
    this.readCount += 1;
    return this.lookup(nodeId);
  }

  async readNodes(nodeIds: readonly string[]): Promise<OpcUaReadResult[]> {
    this.batchReadCount += 1;
    if (this.failBatchReads) throw new Error("batch read service failed");
    return nodeIds.map((nodeId) => this.lookup(nodeId));
  }

  private lookup(nodeId: string): OpcUaReadResult {
    const value = this.reads[nodeId];
    if (!value) throw new Error(`missing node ${nodeId}`);
    return value;
  }

  setRead(nodeId: string, value: OpcUaReadResult): void {
    this.reads[nodeId] = value;
  }

  deleteRead(nodeId: string): void {
    delete this.reads[nodeId];
  }

  async browse(nodeId: string): Promise<OpcUaBrowseNode[]> {
    return this.browseMap[nodeId] ?? [];
  }

  async subscribe(
    _nodes: readonly { tagName: string; nodeId: string }[],
    callback: (tagName: string, value: OpcUaReadResult) => void,
  ) {
    this.subscriptionCallbacks.push(callback);
    return {
      id: "fake-opcua-sub",
      unsubscribe: vi.fn(async () => {
        this.unsubscribeCount += 1;
      }),
    };
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

class FakeOpcUaAdapter implements OpcUaClientAdapter {
  readonly configs: OpcUaDriverConfig[] = [];

  constructor(readonly session: FakeOpcUaSession) {}

  async connect(config: OpcUaDriverConfig): Promise<OpcUaSessionAdapter> {
    this.configs.push(config);
    return this.session;
  }
}

function fakeAdapter(options: { browseDataTypes?: boolean } = {}): FakeOpcUaAdapter {
  const browseDataTypes = options.browseDataTypes ?? true;
  const reads: Record<string, OpcUaReadResult> = {
    "ns=0;i=2261": { nodeId: "ns=0;i=2261", value: "Linx Gateway", dataType: "String", statusCode: "Good" },
    "ns=0;i=2263": { nodeId: "ns=0;i=2263", value: "ESCO Test", dataType: "String", statusCode: "Good" },
    "ns=0;i=2264": { nodeId: "ns=0;i=2264", value: "1.2.3", dataType: "String", statusCode: "Good" },
    "ns=0;i=2265": { nodeId: "ns=0;i=2265", value: "456", dataType: "String", statusCode: "Good" },
    "ns=0;i=2258": {
      nodeId: "ns=0;i=2258",
      value: "2026-06-07T18:00:00.000Z",
      dataType: "DateTime",
      statusCode: "Good",
    },
    "ns=2;s=Line.Running": {
      nodeId: "ns=2;s=Line.Running",
      value: true,
      dataType: "Boolean",
      statusCode: "Good",
      sourceTimestamp: "2026-06-07T18:00:00.000Z",
    },
    "ns=2;s=Line.Count": {
      nodeId: "ns=2;s=Line.Count",
      value: 42,
      dataType: "Int32",
      statusCode: "Good",
      sourceTimestamp: "2026-06-07T18:00:01.000Z",
    },
    "ns=2;s=Line.Struct": {
      nodeId: "ns=2;s=Line.Struct",
      value: { Good: true, Nested: { unsupported: true } },
      dataType: "ExtensionObject",
      statusCode: "Good",
    },
    "ns=2;s=Line.BadStruct": {
      nodeId: "ns=2;s=Line.BadStruct",
      value: { Nested: { unsupported: true } },
      dataType: "ExtensionObject",
      statusCode: "BadCommunicationError",
    },
  };
  const browseMap: Record<string, OpcUaBrowseNode[]> = {
    ObjectsFolder: [
      { nodeId: "ns=2;s=Line", browseName: "Line", nodeClass: "Object" },
    ],
    "ns=2;s=Line": [
      {
        nodeId: "ns=2;s=Line.Running",
        browseName: "Running",
        nodeClass: "Variable",
        dataType: browseDataTypes ? "Boolean" : undefined,
      },
      {
        nodeId: "ns=2;s=Line.Count",
        browseName: "Count",
        nodeClass: "Variable",
        dataType: browseDataTypes ? "Int32" : undefined,
      },
    ],
  };
  return new FakeOpcUaAdapter(new FakeOpcUaSession(reads, browseMap));
}

describe("OpcUaGatewayDriver", () => {
  it("connects read-only and maps standard OPC UA server identity", async () => {
    const adapter = fakeAdapter();
    const driver = new OpcUaGatewayDriver(adapter);

    const result = await driver.connect({ endpointUrl: "opc.tcp://127.0.0.1:4840" });

    expect(result.ok).toBe(true);
    expect(result.state).toBe("online-readonly");
    expect(result.identity).toMatchObject({
      vendor: "ESCO Test",
      productName: "Linx Gateway",
      firmwareRevision: "1.2.3 456",
    });
    expect(result.message).toContain("writes remain read-only");
    expect(result.status).toMatchObject({
      state: "online-readonly",
      connected: true,
      health: "ok",
      message: "OPC UA read-only session heartbeat is healthy.",
      diagnostics: [
        expect.objectContaining({
          id: "opcua-heartbeat-quality",
          severity: "info",
          evidence: expect.arrayContaining(["nodeId=ns=0;i=2258", "statusCode=Good"]),
        }),
      ],
    });
    expect(driver.capabilities).toMatchObject({
      canReadFaults: false,
      canBrowseTags: true,
      canReadTags: true,
      canSubscribeTags: true,
      canUploadSnapshot: false,
    });
    await expect(driver.getFaults()).rejects.toThrow("fault reads are not implemented");
  });

  it("reports warning status when the OPC UA heartbeat returns bad quality", async () => {
    const adapter = fakeAdapter();
    adapter.session.setRead("ns=0;i=2258", {
      nodeId: "ns=0;i=2258",
      value: "2026-06-07T18:00:00.000Z",
      dataType: "DateTime",
      statusCode: "BadCommunicationError",
    });
    const driver = new OpcUaGatewayDriver(adapter);
    await driver.connect({ endpointUrl: "opc.tcp://127.0.0.1:4840" });

    await expect(driver.getStatus()).resolves.toMatchObject({
      state: "online-readonly",
      connected: true,
      health: "warning",
      message: "OPC UA read-only session heartbeat quality is bad.",
      diagnostics: [
        expect.objectContaining({
          id: "opcua-heartbeat-quality",
          severity: "warning",
          evidence: expect.arrayContaining(["statusCode=BadCommunicationError"]),
        }),
      ],
    });
  });

  it("fails OPC UA connect when the initial heartbeat cannot be read", async () => {
    const adapter = fakeAdapter();
    adapter.session.deleteRead("ns=0;i=2258");
    const driver = new OpcUaGatewayDriver(adapter);

    const result = await driver.connect({ endpointUrl: "opc.tcp://127.0.0.1:4840" });

    expect(result).toMatchObject({
      ok: false,
      state: "disconnected",
      message: expect.stringContaining("failed read-only heartbeat"),
      status: {
        state: "disconnected",
        connected: false,
        health: "warning",
        diagnostics: [
          expect.objectContaining({
            id: "opcua-heartbeat-read-failed",
            evidence: expect.arrayContaining(["nodeId=ns=0;i=2258", "read=failed"]),
          }),
        ],
      },
    });
    expect(adapter.session.closed).toBe(true);
    await expect(driver.getStatus()).resolves.toMatchObject({
      state: "disconnected",
      connected: false,
      health: "unknown",
    });
  });

  it("reports disconnected status when the OPC UA heartbeat cannot be read", async () => {
    const adapter = fakeAdapter();
    const driver = new OpcUaGatewayDriver(adapter);
    await driver.connect({ endpointUrl: "opc.tcp://127.0.0.1:4840" });
    adapter.session.deleteRead("ns=0;i=2258");

    await expect(driver.getStatus()).resolves.toMatchObject({
      state: "disconnected",
      connected: false,
      health: "warning",
      message: expect.stringContaining("heartbeat failed"),
    });
  });

  it("validates endpoint config without throwing", async () => {
    const driver = new OpcUaGatewayDriver(fakeAdapter());
    await expect(driver.connect({})).resolves.toMatchObject({ ok: false, message: "OPC UA endpointUrl is required." });
    await expect(driver.connect({ endpointUrl: "http://127.0.0.1:4840" })).resolves.toMatchObject({
      ok: false,
      message: "OPC UA endpointUrl must start with opc.tcp://.",
    });
    await expect(
      driver.connect({ endpointUrl: "opc.tcp://127.0.0.1:4840", securityPolicy: "Basic256Sha256" }),
    ).resolves.toMatchObject({
      ok: false,
      message: expect.stringContaining("securityPolicy is not implemented"),
    });
  });

  it("browses OPC UA variables into read-only ESCO tag definitions", async () => {
    const driver = new OpcUaGatewayDriver(fakeAdapter());
    await driver.connect({ endpointUrl: "opc.tcp://127.0.0.1:4840" });

    const tags = await driver.browseTags();

    expect(tags).toEqual([
      {
        name: "Line.Running",
        dataType: "BOOL",
        writable: false,
        sourceDriver: "opcua",
        address: "ns=2;s=Line.Running",
      },
      {
        name: "Line.Count",
        dataType: "DINT",
        writable: false,
        sourceDriver: "opcua",
        address: "ns=2;s=Line.Count",
      },
    ]);
  });

  it("infers browsed OPC UA variable data types with read-only probes when references omit them", async () => {
    const adapter = fakeAdapter({ browseDataTypes: false });
    const driver = new OpcUaGatewayDriver(adapter);
    await driver.connect({ endpointUrl: "opc.tcp://127.0.0.1:4840" });
    const readsBeforeBrowse = adapter.session.readCount;

    const tags = await driver.browseTags();

    expect(tags.map((tag) => [tag.name, tag.dataType])).toEqual([
      ["Line.Running", "BOOL"],
      ["Line.Count", "DINT"],
    ]);
    expect(adapter.session.readCount).toBeGreaterThan(readsBeforeBrowse);
  });

  it("reads browsed tags and direct node ids with quality and timestamps", async () => {
    const driver = new OpcUaGatewayDriver(fakeAdapter());
    await driver.connect({ endpointUrl: "opc.tcp://127.0.0.1:4840" });
    await driver.browseTags();

    const running = await driver.readTag("Line.Running");
    expect(running).toMatchObject({
      tagName: "Line.Running",
      value: true,
      dataType: "BOOL",
      quality: "good",
      timestamp: "2026-06-07T18:00:00.000Z",
      sourceDriver: "opcua",
    });

    const direct = await driver.readTag("ns=2;s=Line.Count");
    expect(direct.value).toBe(42);
    expect(direct.tagName).toBe("ns=2;s=Line.Count");
  });

  it("supports explicit node maps for known tag names", async () => {
    const driver = new OpcUaGatewayDriver(fakeAdapter());
    await driver.connect({
      endpointUrl: "opc.tcp://127.0.0.1:4840",
      nodeMap: { MotorRunning: "ns=2;s=Line.Running" },
    });

    expect((await driver.browseTags()).map((tag) => tag.name)).toContain("MotorRunning");
    expect((await driver.browseTags()).find((tag) => tag.name === "MotorRunning")).toMatchObject({
      dataType: "BOOL",
      address: "ns=2;s=Line.Running",
    });
    expect((await driver.readTag("MotorRunning")).value).toBe(true);
  });

  it("batch reads OPC UA mapped tags through one adapter multi-node call", async () => {
    const adapter = fakeAdapter();
    const driver = new OpcUaGatewayDriver(adapter);
    await driver.connect({
      endpointUrl: "opc.tcp://127.0.0.1:4840",
      nodeMap: {
        MotorRunning: "ns=2;s=Line.Running",
        Count: "ns=2;s=Line.Count",
      },
    });
    const singleReadsBefore = adapter.session.readCount;

    const result = await driver.readTags(["MotorRunning", "Count"]);

    expect(result.errors).toEqual({});
    expect(result.values.map((value) => [value.tagName, value.value, value.dataType])).toEqual([
      ["MotorRunning", true, "BOOL"],
      ["Count", 42, "DINT"],
    ]);
    expect(adapter.session.batchReadCount).toBe(1);
    expect(adapter.session.readCount).toBe(singleReadsBefore);
  });

  it("falls back to individual OPC UA reads when a batch service call fails", async () => {
    const adapter = fakeAdapter();
    const driver = new OpcUaGatewayDriver(adapter);
    await driver.connect({
      endpointUrl: "opc.tcp://127.0.0.1:4840",
      nodeMap: {
        MotorRunning: "ns=2;s=Line.Running",
        Count: "ns=2;s=Line.Count",
      },
    });
    adapter.session.failBatchReads = true;
    const singleReadsBefore = adapter.session.readCount;

    const result = await driver.readTags(["MotorRunning", "Count"]);

    expect(result.errors).toEqual({});
    expect(result.values.map((value) => [value.tagName, value.value])).toEqual([
      ["MotorRunning", true],
      ["Count", 42],
    ]);
    expect(adapter.session.batchReadCount).toBe(1);
    expect(adapter.session.readCount).toBe(singleReadsBefore + 2);
  });

  it("keeps valid OPC UA batch rows when another requested tag cannot be resolved", async () => {
    const adapter = fakeAdapter();
    const driver = new OpcUaGatewayDriver(adapter);
    await driver.connect({
      endpointUrl: "opc.tcp://127.0.0.1:4840",
      nodeMap: { MotorRunning: "ns=2;s=Line.Running" },
    });

    const result = await driver.readTags(["MotorRunning", "UnknownTag"]);

    expect(result.values).toHaveLength(1);
    expect(result.values[0]).toMatchObject({ tagName: "MotorRunning", value: true });
    expect(result.errors["UnknownTag"]).toContain("Unknown OPC UA tag");
    expect(adapter.session.batchReadCount).toBe(1);
  });

  it("reports per-tag fallback errors when one mapped OPC UA node cannot be read", async () => {
    const adapter = fakeAdapter();
    const driver = new OpcUaGatewayDriver(adapter);
    await driver.connect({
      endpointUrl: "opc.tcp://127.0.0.1:4840",
      nodeMap: {
        MotorRunning: "ns=2;s=Line.Running",
        MissingNode: "ns=2;s=Line.Missing",
      },
    });
    adapter.session.failBatchReads = true;

    const result = await driver.readTags(["MotorRunning", "MissingNode"]);

    expect(result.values).toHaveLength(1);
    expect(result.values[0]).toMatchObject({ tagName: "MotorRunning", value: true });
    expect(result.errors["MissingNode"]).toContain("missing node ns=2;s=Line.Missing");
    expect(adapter.session.batchReadCount).toBe(1);
  });

  it("subscribes through the read-only OPC UA monitored-item seam", async () => {
    const adapter = fakeAdapter();
    const driver = new OpcUaGatewayDriver(adapter);
    await driver.connect({
      endpointUrl: "opc.tcp://127.0.0.1:4840",
      nodeMap: { MotorRunning: "ns=2;s=Line.Running" },
      samplingIntervalMs: 250,
    });
    const received: unknown[] = [];

    const handle = await driver.subscribeTags(["MotorRunning"], (value) => received.push(value));

    expect(handle.id).toBe("fake-opcua-sub");
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ tagName: "MotorRunning", value: true, quality: "good" });
    expect(adapter.session.readCount).toBeGreaterThan(0);
  });

  it("terminates OPC UA subscriptions on unsubscribe and disconnect", async () => {
    const adapter = fakeAdapter();
    const driver = new OpcUaGatewayDriver(adapter);
    await driver.connect({
      endpointUrl: "opc.tcp://127.0.0.1:4840",
      nodeMap: {
        MotorRunning: "ns=2;s=Line.Running",
        Count: "ns=2;s=Line.Count",
      },
    });

    const first = await driver.subscribeTags(["MotorRunning"], () => undefined);
    await first.unsubscribe();
    await first.unsubscribe();
    expect(adapter.session.unsubscribeCount).toBe(1);

    await driver.subscribeTags(["Count"], () => undefined);
    await driver.disconnect();

    expect(adapter.session.unsubscribeCount).toBe(2);
    expect(adapter.session.closed).toBe(true);
  });

  it("marks unsupported structured values as uncertain instead of guessing", async () => {
    const driver = new OpcUaGatewayDriver(fakeAdapter());
    await driver.connect({ endpointUrl: "opc.tcp://127.0.0.1:4840" });

    const value = await driver.readTag("ns=2;s=Line.Struct");

    expect(value.quality).toBe("uncertain");
    expect(value.value).toEqual({ Good: true, Nested: null });
  });

  it("preserves bad OPC UA status over unsupported payload uncertainty", async () => {
    const driver = new OpcUaGatewayDriver(fakeAdapter());
    await driver.connect({ endpointUrl: "opc.tcp://127.0.0.1:4840" });

    const value = await driver.readTag("ns=2;s=Line.BadStruct");

    expect(value.quality).toBe("bad");
    expect(value.value).toEqual({ Nested: null });
  });

  it("exposes no write, upload, or compare surface", () => {
    const driver = new OpcUaGatewayDriver(fakeAdapter());
    const surface = driver as unknown as {
      writeTag?: unknown;
      uploadSnapshot?: unknown;
      compareProject?: unknown;
    };
    expect(typeof surface.writeTag).toBe("undefined");
    expect(typeof surface.uploadSnapshot).toBe("undefined");
    expect(typeof surface.compareProject).toBe("undefined");
  });
});
