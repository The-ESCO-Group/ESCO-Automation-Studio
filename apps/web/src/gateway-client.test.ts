import { describe, expect, it } from "vitest";
import type { ControllerDriverSummary } from "./gateway-contract";
import { EscoGatewayClient, GatewayApiError } from "./gateway-client";

interface RecordedCall {
  url: string;
  method?: string;
  headers?: HeadersInit;
  body?: string;
}

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  readonly listeners = new Map<string, Array<(event: { data: string }) => void>>();
  onerror: (() => void) | null = null;
  closed = false;

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: EventListener): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener as unknown as (event: { data: string }) => void);
    this.listeners.set(type, listeners);
  }

  close(): void {
    this.closed = true;
  }

  emit(type: string, data: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ data: JSON.stringify(data) });
    }
  }
}

function stubFetch(
  responder: (call: RecordedCall) => { status: number; body: unknown },
): { fetchImpl: typeof fetch; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: RecordedCall = {
      url: String(input),
      method: init?.method,
      headers: init?.headers,
      body: typeof init?.body === "string" ? init.body : undefined,
    };
    calls.push(call);
    const result = responder(call);
    return new Response(JSON.stringify(result.body), {
      status: result.status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

const simulatorDriver: ControllerDriverSummary = {
  id: "esco-simulator",
  name: "Sim",
  kind: "simulator",
  readOnly: true,
  safetyNote: "Public ESCO online mode is read-only.",
  connectionEvidence: {
    transportValidation: "software-wired",
    realControllerIo: false,
    hardwareValidated: false,
    verified: true,
    label: "ESCO software simulator",
    message: "Simulator only.",
    limitations: ["No physical controller I/O."],
  },
  capabilities: {
    canConnect: true,
    canReadStatus: true,
    canReadFaults: true,
    canBrowseTags: true,
    canReadTags: true,
    canBatchReadTags: false,
    canSubscribeTags: true,
    canUploadSnapshot: true,
    canCompareProject: true,
    canWriteTags: false,
    canDownloadProject: false,
    canOnlineEdit: false,
    canForceTags: false,
    canModeChange: false,
    canClearFaults: false,
  },
};

describe("EscoGatewayClient", () => {
  it("normalizes the base URL and issues GET requests", async () => {
    const { fetchImpl, calls } = stubFetch(() => ({
      status: 200,
      body: [simulatorDriver],
    }));
    const client = new EscoGatewayClient({ baseUrl: "http://api.local:4000///", fetchImpl, sessionId: "client-a" });
    const drivers = await client.listDrivers();
    expect(drivers[0].id).toBe("esco-simulator");
    expect(drivers[0].capabilities.canWriteTags).toBe(false);
    expect(drivers[0].capabilities.canUploadSnapshot).toBe(true);
    expect(calls[0].url).toBe("http://api.local:4000/api/gateway/drivers");
    expect(calls[0].method).toBe("GET");
    expect(calls[0].headers).toMatchObject({ "x-esco-session-id": "client-a" });
  });

  it("posts connect bodies and returns failed connects without throwing", async () => {
    const failed = { ok: false, state: "disconnected", message: "unreachable" };
    const { fetchImpl, calls } = stubFetch(() => ({ status: 502, body: failed }));
    const client = new EscoGatewayClient({ baseUrl: "http://api.local", fetchImpl, sessionId: "client-a" });

    const result = await client.connect("ethernetip-cip-readonly", {
      endpointUrl: "192.168.1.10",
    });
    expect(result.ok).toBe(false);
    expect(result.message).toBe("unreachable");

    expect(calls[0].method).toBe("POST");
    expect(calls[0].url).toBe("http://api.local/api/gateway/session/connect");
    expect(JSON.parse(calls[0].body ?? "{}")).toEqual({
      driverId: "ethernetip-cip-readonly",
      config: { endpointUrl: "192.168.1.10" },
    });
  });

  it("URL-encodes tag names on reads", async () => {
    const { fetchImpl, calls } = stubFetch(() => ({
      status: 200,
      body: { tagName: "Program:Main.Flag", value: true, quality: "good" },
    }));
    const client = new EscoGatewayClient({ baseUrl: "http://api.local", fetchImpl, sessionId: "client-a" });
    const value = await client.readTag("Program:Main.Flag");
    expect(value.value).toBe(true);
    expect(calls[0].url).toBe(
      "http://api.local/api/gateway/tags/read?name=Program%3AMain.Flag",
    );
  });

  it("posts batched reads to the read-batch route", async () => {
    const { fetchImpl, calls } = stubFetch(() => ({
      status: 200,
      body: { values: [], errors: { Missing: "path destination unknown" } },
    }));
    const client = new EscoGatewayClient({ baseUrl: "http://api.local", fetchImpl, sessionId: "client-a" });
    const result = await client.readTags(["Count", "Missing"]);
    expect(result.errors["Missing"]).toContain("path destination");
    expect(calls[0].method).toBe("POST");
    expect(calls[0].url).toBe("http://api.local/api/gateway/tags/read-batch");
    expect(JSON.parse(calls[0].body ?? "{}")).toEqual({ names: ["Count", "Missing"] });
  });

  it("reads vendor-neutral target adapter metadata without exposing download execution", async () => {
    const { fetchImpl, calls } = stubFetch(() => ({
      status: 200,
      body: [
        {
          id: "allen-bradley-logix",
          name: "Allen-Bradley Logix",
          vendor: "allen-bradley",
          families: ["ControlLogix"],
          strategy: "ethernetip-cip-planned",
          validationState: "software-wired",
          capabilities: {
            projectModelImport: true,
            projectModelExport: true,
            validate: true,
            compile: false,
            compareOfflineOnline: true,
            backup: true,
            uploadSnapshot: true,
            physicalDownload: false,
            onlineMonitor: true,
            onlineTagRead: true,
            onlineTagWrite: false,
            onlineEdit: false,
            modeChange: false,
            faultReset: false,
            ioTreeRead: true,
            ioTreeWrite: false,
            safetyControllerSupport: false,
            motionSupport: false,
          },
          safety: {
            executionAvailable: false,
            physicalDownloadEnabled: false,
            verified: false,
            requiresBackupBeforeDownload: true,
            requiresCompareBeforeDownload: true,
            requiresExplicitUserApproval: true,
            supportsDryRun: false,
            defaultMode: "read-only",
            riskLevel: "critical",
            safetyMessage: "Blocked.",
          },
          executionAvailable: false,
          physicalDownloadEnabled: false,
          verified: false,
          realControllerIo: true,
          notes: "Read-only only.",
          requiredGates: ["operator-confirmation"],
        },
      ],
    }));
    const client = new EscoGatewayClient({ baseUrl: "http://api.local", fetchImpl, sessionId: "client-a" });

    const adapters = await client.listTargetAdapters();

    expect(adapters[0]).toMatchObject({
      id: "allen-bradley-logix",
      physicalDownloadEnabled: false,
      verified: false,
      safety: { physicalDownloadEnabled: false, riskLevel: "critical" },
      capabilities: { physicalDownload: false },
    });
    expect(calls[0].method).toBe("GET");
    expect(calls[0].url).toBe("http://api.local/api/gateway/target-adapters");
  });

  it("requests backend download preflight without exposing a download execution method", async () => {
    const { fetchImpl, calls } = stubFetch(() => ({
      status: 200,
      body: {
        targetAdapterId: "allen-bradley-logix",
        ok: false,
        physicalDownloadAllowed: false,
        executionAvailable: false,
        physicalDownloadEnabled: false,
        verified: false,
        defaultMode: "read-only",
        riskLevel: "critical",
        requiredGates: ["operator-confirmation"],
        gateResults: [
          {
            gate: "operator-confirmation",
            state: "blocked",
            required: true,
            message: "Physical PLC download is blocked.",
          },
        ],
        blockers: ["Physical PLC download is blocked."],
        warnings: [],
        message: "Download preflight blocked.",
        checkedAt: "t",
      },
    }));
    const client = new EscoGatewayClient({ baseUrl: "http://api.local", fetchImpl, sessionId: "client-a" });

    const preflight = await client.targetAdapterPreflight("allen-bradley-logix");

    expect(preflight.physicalDownloadAllowed).toBe(false);
    expect(preflight.riskLevel).toBe("critical");
    expect(calls[0].method).toBe("POST");
    expect(calls[0].url).toBe("http://api.local/api/gateway/download/preflight");
    expect(JSON.parse(calls[0].body ?? "{}")).toEqual({ targetAdapterId: "allen-bradley-logix" });
  });

  it("reads controller identity through the gateway", async () => {
    const { fetchImpl, calls } = stubFetch(() => ({
      status: 200,
      body: { productName: "1756-L85E", firmwareRevision: "36.011" },
    }));
    const client = new EscoGatewayClient({ baseUrl: "http://api.local", fetchImpl, sessionId: "client-a" });
    const identity = await client.identity();
    expect(identity.productName).toBe("1756-L85E");
    expect(calls[0].method).toBe("GET");
    expect(calls[0].url).toBe("http://api.local/api/gateway/identity");
  });

  it("opens a read-only tag stream and parses tag/error events", () => {
    FakeEventSource.instances = [];
    const values: unknown[] = [];
    const errors: string[] = [];
    const client = new EscoGatewayClient({
      baseUrl: "http://api.local",
      sessionId: "stream-client",
      eventSourceImpl: FakeEventSource as unknown as new (url: string) => EventSource,
    });

    const handle = client.subscribeTags(["Program:Main.Flag", "Count"], (value) => values.push(value), (message) => errors.push(message));
    const source = FakeEventSource.instances[0];

    expect(source.url).toBe("http://api.local/api/gateway/tags/subscribe?session=stream-client&name=Program%3AMain.Flag&name=Count");
    source.emit("tag", {
      tagName: "Count",
      value: 7,
      quality: "good",
      timestamp: "t",
      sourceDriver: "simulator",
    });
    source.emit("error-message", { error: "Driver does not support tag subscriptions." });
    source.onerror?.();

    expect(values).toEqual([
      {
        tagName: "Count",
        value: 7,
        quality: "good",
        timestamp: "t",
        sourceDriver: "simulator",
      },
    ]);
    expect(errors).toEqual([
      "Driver does not support tag subscriptions.",
    ]);
    expect(source.closed).toBe(true);
    handle.close();
    expect(source.closed).toBe(true);
  });

  it("posts local project compare bodies and uploads read-only snapshots", async () => {
    const project = { id: "p1", name: "Line1", controllers: [] };
    const { fetchImpl, calls } = stubFetch((call) => {
      if (call.url.endsWith("/api/gateway/compare")) {
        return { status: 200, body: { state: "unknown", matched: false, differences: [], message: "read-only" } };
      }
      return {
        status: 200,
        body: { id: "snap-1", capturedAt: "t", sourceDriver: "simulator", identity: {}, tags: [] },
      };
    });
    const client = new EscoGatewayClient({ baseUrl: "http://api.local", fetchImpl });

    const compare = await client.compareProject(project as never);
    const snapshot = await client.uploadSnapshot();

    expect(compare.state).toBe("unknown");
    expect(snapshot.id).toBe("snap-1");
    expect(calls[0].url).toBe("http://api.local/api/gateway/compare");
    expect(JSON.parse(calls[0].body ?? "{}")).toEqual({ localProject: project });
    expect(calls[1].url).toBe("http://api.local/api/gateway/snapshot/upload");
    expect(calls[1].method).toBe("POST");
  });

  it("maps API errors to GatewayApiError with the server message", async () => {
    const { fetchImpl } = stubFetch(() => ({
      status: 409,
      body: { error: "Controller Gateway is not online." },
    }));
    const client = new EscoGatewayClient({ baseUrl: "http://api.local", fetchImpl });
    await expect(client.identity()).rejects.toThrow(GatewayApiError);
    await expect(client.identity()).rejects.toThrow("Controller Gateway is not online.");
  });

  it("treats unexpected connect payloads as errors", async () => {
    const { fetchImpl } = stubFetch(() => ({ status: 400, body: { error: "bad driverId" } }));
    const client = new EscoGatewayClient({ baseUrl: "http://api.local", fetchImpl });
    await expect(client.connect("")).rejects.toThrow("bad driverId");
  });

  it("throws a clear error on non-JSON responses", async () => {
    const fetchImpl = (async () =>
      new Response("<html>proxy error</html>", { status: 200 })) as typeof fetch;
    const client = new EscoGatewayClient({ baseUrl: "http://api.local", fetchImpl });
    await expect(client.session()).rejects.toThrow(/non-JSON/);
  });

  it("exposes no write-capable surface (read-only milestone guard)", () => {
    const client = new EscoGatewayClient({ baseUrl: "http://api.local" });
    const methods = [
      ...Object.getOwnPropertyNames(Object.getPrototypeOf(client)),
      ...Object.keys(client),
    ];
    const writeLike = methods.filter((name) =>
      /(write|force|download|onlineEdit|modeChange|clearFault)/i.test(name),
    );
    expect(writeLike).toEqual([]);
  });
});
