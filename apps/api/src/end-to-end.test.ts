/**
 * GOAL B END-TO-END PROOF (no hardware, no Rockwell software):
 *
 *   EscoGatewayClient (web Session Manager client, apps/web)
 *     → real HTTP → createApiServer (apps/api)
 *       → GatewayHost → ControllerGateway (@esco/controller-gateway)
 *         → EthernetIpGatewayDriver (@esco/driver-ethernetip-node)
 *           → LogixTcpClient → LogixSessionCore → ESCO codecs
 *             → real TCP 127.0.0.1 → FakeLogixServer (canned CIP replies)
 *
 * Every layer is the production implementation except the controller itself.
 * Passing here proves the ESCO-owned chain wires together — it does NOT
 * prove hardware validation, and `verified` remains false everywhere.
 */

import { afterEach, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import { request, type Server } from "node:http";
import {
  ControllerGateway,
  type TagDefinition,
  type TagValue,
} from "@esco/controller-gateway";
import {
  bytesEqual,
  buildIdentityRequest,
  buildReadTagRequest,
  buildTagListRequest,
} from "@esco/driver-ethernetip";
import { FakeLogixServer } from "@esco/driver-ethernetip-node";
import {
  OpcUaGatewayDriver,
  type OpcUaBrowseNode,
  type OpcUaClientAdapter,
  type OpcUaDriverConfig,
  type OpcUaReadResult,
  type OpcUaSessionAdapter,
} from "@esco/driver-opcua-node";
import { EscoGatewayClient } from "../../web/src/gateway-client";
import { GatewayHost } from "./gateway-host";
import { createApiServer } from "./server";

function hexToBytes(hex: string): Uint8Array {
  return Uint8Array.from(hex.trim().split(/\s+/).map((pair) => Number.parseInt(pair, 16)));
}

const cleanups: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    await cleanups.pop()?.();
  }
});

function demoCip(request: Uint8Array): Uint8Array | undefined {
  if (bytesEqual(request, buildIdentityRequest())) {
    return hexToBytes(
      "81 00 00 00 01 00 0e 00 96 00 21 0b 00 00 78 56 34 12 09 31 37 36 39 2d 4c 33 33 45",
    );
  }
  if (bytesEqual(request, buildReadTagRequest("Count"))) {
    return hexToBytes("cc 00 00 00 c4 00 d2 04 00 00");
  }
  if (bytesEqual(request, buildTagListRequest(0))) {
    return hexToBytes("d5 00 00 00 01 00 00 00 04 00 50 75 6d 70 c4 00");
  }
  return undefined;
}

async function listenEphemeral(server: Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
  return (server.address() as AddressInfo).port;
}

class FakeOpcUaApiSession implements OpcUaSessionAdapter {
  readonly subscriptionOptions: Array<{ samplingIntervalMs: number }> = [];
  private readonly subscriptions = new Map<
    string,
    {
      nodes: readonly { tagName: string; nodeId: string }[];
      callback: (tagName: string, value: OpcUaReadResult) => void;
    }
  >();

  constructor(
    private readonly reads: Record<string, OpcUaReadResult>,
    private readonly browseMap: Record<string, OpcUaBrowseNode[]>,
  ) {}

  async readNode(nodeId: string): Promise<OpcUaReadResult> {
    return this.lookup(nodeId);
  }

  async readNodes(nodeIds: readonly string[]): Promise<OpcUaReadResult[]> {
    return nodeIds.map((nodeId) => this.lookup(nodeId));
  }

  private lookup(nodeId: string): OpcUaReadResult {
    const value = this.reads[nodeId];
    if (!value) throw new Error(`missing OPC UA node ${nodeId}`);
    return value;
  }

  deleteRead(nodeId: string): void {
    delete this.reads[nodeId];
  }

  async browse(nodeId: string): Promise<OpcUaBrowseNode[]> {
    return this.browseMap[nodeId] ?? [];
  }

  async subscribe(
    nodes: readonly { tagName: string; nodeId: string }[],
    callback: (tagName: string, value: OpcUaReadResult) => void,
    options: { samplingIntervalMs: number },
  ) {
    const id = `fake-opcua-api-sub-${this.subscriptions.size}`;
    this.subscriptionOptions.push(options);
    this.subscriptions.set(id, { nodes, callback });
    for (const node of nodes) callback(node.tagName, await this.readNode(node.nodeId));
    return {
      id,
      unsubscribe: async () => {
        this.subscriptions.delete(id);
      },
    };
  }

  emit(nodeId: string, value: OpcUaReadResult): void {
    this.reads[nodeId] = value;
    for (const subscription of this.subscriptions.values()) {
      for (const node of subscription.nodes) {
        if (node.nodeId === nodeId) subscription.callback(node.tagName, value);
      }
    }
  }

  async close(): Promise<void> {
    this.subscriptions.clear();
  }
}

class FakeOpcUaApiAdapter implements OpcUaClientAdapter {
  readonly configs: OpcUaDriverConfig[] = [];

  constructor(readonly session: FakeOpcUaApiSession) {}

  async connect(config: OpcUaDriverConfig): Promise<OpcUaSessionAdapter> {
    this.configs.push(config);
    return this.session;
  }
}

function createOpcUaApiServer(): {
  server: Server;
  session: FakeOpcUaApiSession;
  adapter: FakeOpcUaApiAdapter;
} {
  const session = new FakeOpcUaApiSession(
    {
      "ns=0;i=2261": { nodeId: "ns=0;i=2261", value: "FactoryTalk Linx Gateway", dataType: "String", statusCode: "Good" },
      "ns=0;i=2263": { nodeId: "ns=0;i=2263", value: "ESCO OPC UA Lab", dataType: "String", statusCode: "Good" },
      "ns=0;i=2264": { nodeId: "ns=0;i=2264", value: "6.7.8", dataType: "String", statusCode: "Good" },
      "ns=0;i=2265": { nodeId: "ns=0;i=2265", value: "91011", dataType: "String", statusCode: "Good" },
      "ns=0;i=2258": {
        nodeId: "ns=0;i=2258",
        value: "2026-06-07T19:00:00.000Z",
        dataType: "DateTime",
        statusCode: "Good",
      },
      "ns=2;s=Packaging.LineReady": {
        nodeId: "ns=2;s=Packaging.LineReady",
        value: true,
        dataType: "Boolean",
        statusCode: "Good",
        sourceTimestamp: "2026-06-07T19:00:00.000Z",
      },
      "ns=2;s=Packaging.BoxCount": {
        nodeId: "ns=2;s=Packaging.BoxCount",
        value: 5,
        dataType: "Int32",
        statusCode: "Good",
        sourceTimestamp: "2026-06-07T19:00:01.000Z",
      },
    },
    {
      ObjectsFolder: [{ nodeId: "ns=2;s=Packaging", browseName: "Packaging", nodeClass: "Object" }],
      "ns=2;s=Packaging": [
        {
          nodeId: "ns=2;s=Packaging.LineReady",
          browseName: "LineReady",
          nodeClass: "Variable",
          dataType: "Boolean",
        },
        {
          nodeId: "ns=2;s=Packaging.BoxCount",
          browseName: "BoxCount",
          nodeClass: "Variable",
          dataType: "Int32",
        },
      ],
    },
  );
  const adapter = new FakeOpcUaApiAdapter(session);
  const driver = new OpcUaGatewayDriver(adapter);
  const host = new GatewayHost(new ControllerGateway([driver]));
  return { server: createApiServer(host), session, adapter };
}

describe("Goal B end to end: web client → API → gateway → driver → wire", () => {
  it("runs the full read-only flow through every ESCO layer", async () => {
    const target = new FakeLogixServer({ handleCip: demoCip });
    const targetPort = await target.listen();
    cleanups.push(() => target.close());

    const apiPort = await listenEphemeral(createApiServer());
    const sessionId = "e2e-full-readonly-flow";
    const client = new EscoGatewayClient({ baseUrl: `http://127.0.0.1:${apiPort}`, sessionId });

    // The UI's driver list shows the real EtherNet/IP path on the backend.
    const drivers = await client.listDrivers();
    expect(drivers.map((driver) => driver.id)).toContain("ethernetip-cip-readonly");

    // Connect lands in Online Read-Only (rule 7 — no project match proof).
    const connect = await client.connect("ethernetip-cip-readonly", {
      endpointUrl: `127.0.0.1:${targetPort}`,
    });
    expect(connect.ok).toBe(true);
    expect(connect.state).toBe("online-readonly");
    expect(connect.identity?.productName).toBe("1769-L33E");

    const session = await client.session();
    expect(session.readOnly).toBe(true);

    const status = await client.status();
    expect(status.status?.health).toBe("ok");

    expect(await client.faults()).toEqual([]);

    const tags = await client.browseTags();
    expect(tags[0]).toMatchObject({ name: "Pump", dataType: "DINT", writable: false });

    const value = await client.readTag("Count");
    expect(value.value).toBe(1234);
    expect(value.quality).toBe("good");

    // Every step above is in the audit trail.
    const audit = await client.audit();
    const actions = audit.map((entry) => entry.action);
    for (const expected of ["connect", "status", "faults"]) {
      expect(actions).toContain(expected);
    }

    const disconnect = await client.disconnect();
    expect(disconnect.ok).toBe(true);
    expect((await client.session()).state).toBe("disconnected");
  });

  it("isolates HTTP gateway sessions per ESCO web client id", async () => {
    const apiPort = await listenEphemeral(createApiServer());
    const first = new EscoGatewayClient({ baseUrl: `http://127.0.0.1:${apiPort}`, sessionId: "client-a" });
    const second = new EscoGatewayClient({ baseUrl: `http://127.0.0.1:${apiPort}`, sessionId: "client-b" });

    await first.connect("esco-simulator");

    expect(await first.session()).toMatchObject({ state: "online-readonly" });
    expect(await second.session()).toMatchObject({ state: "offline" });
  });

  it("uses the same normalized session id rules for JSON routes and SSE streams", async () => {
    const host = new GatewayHost();
    cleanups.push(async () => {
      await host.closeIdleSessions(0, Number.POSITIVE_INFINITY);
    });
    const apiPort = await listenEphemeral(createApiServer(host, { sessionCleanupIntervalMs: 0 }));
    const base = `http://127.0.0.1:${apiPort}`;

    const connect = await fetch(`${base}/api/gateway/session/connect`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-esco-session-id": "client one/line#2",
      },
      body: JSON.stringify({ driverId: "esco-simulator", config: {} }),
    });
    expect(connect.status).toBe(200);

    const normalized = await fetch(`${base}/api/gateway/session?session=client_one_line_2`);
    expect(await normalized.json()).toMatchObject({ state: "online-readonly" });

    const queryBeatsHeader = await fetch(`${base}/api/gateway/session?session=query-client`, {
      headers: { "x-esco-session-id": "client_one_line_2" },
    });
    expect(await queryBeatsHeader.json()).toMatchObject({ state: "offline" });

    const blankQueryFallsBackToHeader = await fetch(`${base}/api/gateway/session?session=%20%20`, {
      headers: { "x-esco-session-id": "client_one_line_2" },
    });
    expect(await blankQueryFallsBackToHeader.json()).toMatchObject({ state: "online-readonly" });

    const sseQueryBeatsHeader = await fetch(`${base}/api/gateway/tags/subscribe?session=query-client&name=Conveyor.RunFeedback`, {
      headers: { "x-esco-session-id": "client_one_line_2" },
    });
    expect(await sseQueryBeatsHeader.text()).toContain("No controller driver is selected.");
  });

  it("runs the OPC UA read-only route through API routes and SSE subscriptions", async () => {
    const { server, session, adapter } = createOpcUaApiServer();
    const apiPort = await listenEphemeral(server);
    const client = new EscoGatewayClient({ baseUrl: `http://127.0.0.1:${apiPort}` });
    const opcUaConfig: OpcUaDriverConfig = {
      endpointUrl: "opc.tcp://127.0.0.1:4840",
      samplingIntervalMs: 125,
    };

    const connect = await client.connect("opcua-generic-readonly", opcUaConfig);
    expect(connect.ok).toBe(true);
    expect(connect.state).toBe("online-readonly");
    expect(connect.identity).toMatchObject({
      vendor: "ESCO OPC UA Lab",
      productName: "FactoryTalk Linx Gateway",
      firmwareRevision: "6.7.8 91011",
    });
    expect(connect.message).toContain("writes remain read-only");
    expect(adapter.configs[0]).toMatchObject({
      endpointUrl: "opc.tcp://127.0.0.1:4840",
      samplingIntervalMs: 125,
    });

    const snapshot = await client.session();
    expect(snapshot.readOnly).toBe(true);
    expect(snapshot.capabilities).toMatchObject({
      canReadFaults: false,
      canBrowseTags: true,
      canReadTags: true,
      canSubscribeTags: true,
      canUploadSnapshot: false,
      canWriteTags: false,
      canDownloadProject: false,
      canOnlineEdit: false,
      canForceTags: false,
    });

    const opcUaStatus = await client.status();
    expect(opcUaStatus.status).toMatchObject({
      state: "online-readonly",
      connected: true,
      health: "ok",
      message: "OPC UA read-only session heartbeat is healthy.",
    });

    const faults = await fetch(`http://127.0.0.1:${apiPort}/api/gateway/faults`);
    expect(faults.status).toBe(409);
    expect(await faults.text()).toContain("does not support fault reads");

    const identity = await client.identity();
    expect(identity.productName).toBe("FactoryTalk Linx Gateway");

    const tags = await client.browseTags();
    expect(tags).toEqual([
      expect.objectContaining<TagDefinition>({
        name: "Packaging.LineReady",
        dataType: "BOOL",
        writable: false,
        sourceDriver: "opcua",
        address: "ns=2;s=Packaging.LineReady",
      }),
      expect.objectContaining<TagDefinition>({
        name: "Packaging.BoxCount",
        dataType: "DINT",
        writable: false,
        sourceDriver: "opcua",
        address: "ns=2;s=Packaging.BoxCount",
      }),
    ]);

    const directRead = await client.readTag("Packaging.BoxCount");
    expect(directRead).toMatchObject<TagValue>({
      tagName: "Packaging.BoxCount",
      value: 5,
      dataType: "DINT",
      quality: "good",
      timestamp: "2026-06-07T19:00:01.000Z",
      sourceDriver: "opcua",
    });

    const batch = await client.readTags(["Packaging.LineReady", "Packaging.BoxCount"]);
    expect(batch.errors).toEqual({});
    expect(batch.values.map((value) => value.tagName)).toEqual(["Packaging.LineReady", "Packaging.BoxCount"]);

    const upload = await fetch(`http://127.0.0.1:${apiPort}/api/gateway/snapshot/upload`, { method: "POST" });
    expect(upload.status).toBe(409);
    expect(await upload.text()).toContain("does not support upload snapshots");

    const response = await fetch(
      `http://127.0.0.1:${apiPort}/api/gateway/tags/subscribe?name=Packaging.BoxCount`,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let text = "";
    const readUntil = async (predicate: () => boolean): Promise<void> => {
      for (let attempt = 0; attempt < 6 && !predicate(); attempt += 1) {
        const chunk = await Promise.race([
          reader.read(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("timed out waiting for OPC UA SSE event")), 1000),
          ),
        ]);
        if (chunk.done) break;
        text += decoder.decode(chunk.value, { stream: true });
      }
    };

    try {
      await readUntil(() => text.includes('"value":5'));
      expect(text).toContain("event: tag");
      expect(text).toContain('"tagName":"Packaging.BoxCount"');
      expect(session.subscriptionOptions[0]).toEqual({ samplingIntervalMs: 125 });

      session.emit("ns=2;s=Packaging.BoxCount", {
        nodeId: "ns=2;s=Packaging.BoxCount",
        value: 6,
        dataType: "Int32",
        statusCode: "Good",
        sourceTimestamp: "2026-06-07T19:00:02.000Z",
      });
      await readUntil(() => text.includes('"value":6'));
      expect(text).toContain('"timestamp":"2026-06-07T19:00:02.000Z"');
    } finally {
      await reader.cancel().catch(() => undefined);
      await client.disconnect();
    }
  });

  it("downgrades the gateway snapshot when OPC UA status heartbeat fails through HTTP", async () => {
    const { server, session } = createOpcUaApiServer();
    const apiPort = await listenEphemeral(server);
    const client = new EscoGatewayClient({ baseUrl: `http://127.0.0.1:${apiPort}` });

    const connect = await client.connect("opcua-generic-readonly", {
      endpointUrl: "opc.tcp://127.0.0.1:4840",
    });
    expect(connect.ok).toBe(true);
    session.deleteRead("ns=0;i=2258");

    const status = await client.status();

    expect(status.status).toMatchObject({
      state: "disconnected",
      connected: false,
      health: "warning",
    });
    expect(status.snapshot).toMatchObject({
      state: "disconnected",
      readOnly: true,
      readOnlyReason: "Controller status reports the session is disconnected.",
    });
  });

  it("refuses OPC UA connect when the initial read-only heartbeat fails through HTTP", async () => {
    const { server, session } = createOpcUaApiServer();
    const apiPort = await listenEphemeral(server);
    const client = new EscoGatewayClient({ baseUrl: `http://127.0.0.1:${apiPort}` });
    session.deleteRead("ns=0;i=2258");

    const connect = await client.connect("opcua-generic-readonly", {
      endpointUrl: "opc.tcp://127.0.0.1:4840",
    });

    expect(connect).toMatchObject({
      ok: false,
      state: "disconnected",
      message: expect.stringContaining("failed read-only heartbeat"),
      status: {
        state: "disconnected",
        connected: false,
        health: "warning",
      },
    });
    expect(await client.session()).toMatchObject({
      state: "disconnected",
      readOnly: true,
    });
  });

  it("surfaces failed connects to the client as results, not crashes", async () => {
    const apiPort = await listenEphemeral(createApiServer());
    const sessionId = "e2e-failed-connect";
    const client = new EscoGatewayClient({ baseUrl: `http://127.0.0.1:${apiPort}`, sessionId });
    const result = await client.connect("ethernetip-cip-readonly", { endpointUrl: "" });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("endpoint is required");
  });

  it("streams EtherNet/IP tag values over SSE via the polling-backed subscription", async () => {
    // Mutable target value: the polling subscription must emit the initial
    // sample AND the change, end to end through HTTP SSE → gateway →
    // EtherNet/IP driver → TCP.
    let countBytes = "d2 04 00 00"; // 1234
    const target = new FakeLogixServer({
      handleCip: (request) => {
        if (bytesEqual(request, buildIdentityRequest())) {
          return hexToBytes(
            "81 00 00 00 01 00 0e 00 96 00 21 0b 00 00 78 56 34 12 09 31 37 36 39 2d 4c 33 33 45",
          );
        }
        if (bytesEqual(request, buildReadTagRequest("Count"))) {
          return hexToBytes(`cc 00 00 00 c4 00 ${countBytes}`);
        }
        return undefined;
      },
    });
    const targetPort = await target.listen();
    cleanups.push(() => target.close());

    const apiPort = await listenEphemeral(createApiServer());
    const sessionId = "e2e-enip-sse";
    const client = new EscoGatewayClient({ baseUrl: `http://127.0.0.1:${apiPort}`, sessionId });
    const connect = await client.connect("ethernetip-cip-readonly", {
      endpointUrl: `127.0.0.1:${targetPort}`,
    });
    expect(connect.ok).toBe(true);

    const response = await fetch(
      `http://127.0.0.1:${apiPort}/api/gateway/tags/subscribe?session=${encodeURIComponent(sessionId)}&name=Count`,
    );
    expect(response.status).toBe(200);
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let text = "";
    const readUntil = async (predicate: () => boolean, attempts: number): Promise<void> => {
      for (let attempt = 0; attempt < attempts && !predicate(); attempt += 1) {
        const chunk = await Promise.race([
          reader.read(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("timed out waiting for SSE tag event")), 2500),
          ),
        ]);
        if (chunk.done) break;
        text += decoder.decode(chunk.value, { stream: true });
      }
    };

    try {
      // Initial sample from the real EtherNet/IP read path.
      await readUntil(() => text.includes("1234"), 4);
      expect(text).toContain("event: tag");
      expect(text).toContain('"tagName":"Count"');
      expect(text).toContain("1234");

      // Change the target value; the next poll tick must stream the change.
      countBytes = "2e 16 00 00"; // 5678
      await readUntil(() => text.includes("5678"), 6);
      expect(text).toContain("5678");
    } finally {
      await reader.cancel().catch(() => undefined);
      await client.disconnect();
    }
  });

  it("streams simulator tag values over the gateway SSE subscription route", async () => {
    const apiPort = await listenEphemeral(createApiServer());
    const sessionId = "e2e-simulator-sse";
    const client = new EscoGatewayClient({ baseUrl: `http://127.0.0.1:${apiPort}`, sessionId });
    const connect = await client.connect("esco-simulator", {});
    expect(connect.ok).toBe(true);

    const response = await fetch(
      `http://127.0.0.1:${apiPort}/api/gateway/tags/subscribe?session=${encodeURIComponent(sessionId)}&name=Conveyor.RunFeedback`,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(response.body).toBeTruthy();

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let text = "";
    try {
      for (let attempt = 0; attempt < 4 && !text.includes("Conveyor.RunFeedback"); attempt += 1) {
        const chunk = await Promise.race([
          reader.read(),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timed out waiting for SSE tag")), 1000)),
        ]);
        if (chunk.done) break;
        text += decoder.decode(chunk.value, { stream: true });
      }
    } finally {
      await reader.cancel().catch(() => undefined);
    }

    expect(text).toContain("event: tag");
    expect(text).toContain("Conveyor.RunFeedback");
    expect(text).toContain('"quality":"good"');
    await client.disconnect();
  });

  it("rejects oversized SSE watch lists instead of silently truncating", async () => {
    const apiPort = await listenEphemeral(createApiServer());
    const query = Array.from({ length: 201 }, (_, index) => `name=T${index}`).join("&");
    const response = await fetch(`http://127.0.0.1:${apiPort}/api/gateway/tags/subscribe?${query}`);
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain("event: error-message");
    expect(text).toContain("at most 200 tags");
  });

  it("unsubscribes delayed SSE handles when the client closes before subscribe resolves", async () => {
    const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    let resolveSubscribe:
      | ((handle: { id: string; unsubscribe: () => Promise<void> }) => void)
      | undefined;
    let markStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    let unsubscribeCount = 0;
    const fakeHost = {
      handle: async () => undefined,
      subscribeTags: () =>
        new Promise((resolve) => {
          resolveSubscribe = resolve;
          markStarted?.();
        }),
    } as unknown as GatewayHost;
    const apiPort = await listenEphemeral(createApiServer(fakeHost, { sessionCleanupIntervalMs: 0 }));
    const req = request({
      hostname: "127.0.0.1",
      port: apiPort,
      path: "/api/gateway/tags/subscribe?name=Delayed",
      method: "GET",
    });
    req.on("error", () => undefined);
    req.end();

    await started;
    req.destroy();
    await delay(25);
    resolveSubscribe?.({
      id: "delayed",
      unsubscribe: async () => {
        unsubscribeCount += 1;
      },
    });

    for (let attempt = 0; attempt < 10 && unsubscribeCount === 0; attempt += 1) {
      await delay(20);
    }
    expect(unsubscribeCount).toBe(1);
  });
});
