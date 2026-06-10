import { afterEach, describe, expect, it } from "vitest";
import {
  CipResponseError,
  EnipCommand,
  bytesEqual,
  buildReadTagFragmentedRequest,
  buildReadTagRequest,
  buildTagListRequest,
  buildIdentityRequest,
  toHex,
} from "@esco/driver-ethernetip";
import { FakeLogixServer, type FakeLogixServerOptions } from "./testing/fake-logix-server";
import { LogixTcpClient } from "./tcp-client";

function hexToBytes(hex: string): Uint8Array {
  return Uint8Array.from(hex.trim().split(/\s+/).map((pair) => Number.parseInt(pair, 16)));
}

const cleanups: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    await cleanups.pop()?.();
  }
});

async function startServer(options: FakeLogixServerOptions): Promise<{
  server: FakeLogixServer;
  port: number;
}> {
  const server = new FakeLogixServer(options);
  const port = await server.listen();
  cleanups.push(() => server.close());
  return { server, port };
}

async function connectedClient(
  options: FakeLogixServerOptions,
  clientOverrides: Partial<{ requestTimeoutMs: number }> = {},
): Promise<{ server: FakeLogixServer; client: LogixTcpClient }> {
  const { server, port } = await startServer(options);
  const client = new LogixTcpClient({
    host: "127.0.0.1",
    port,
    connectTimeoutMs: 2000,
    requestTimeoutMs: clientOverrides.requestTimeoutMs ?? 2000,
  });
  cleanups.push(() => client.close());
  await client.connect();
  return { server, client };
}

describe("connect/close lifecycle", () => {
  it("registers a session over real loopback TCP", async () => {
    const { client } = await connectedClient({
      handleCip: () => undefined,
      sessionHandle: 0x42,
    });
    expect(client.state).toBe("ready");
    expect(client.sessionHandle).toBe(0x42);
  });

  it("rejects when nothing is listening", async () => {
    const { server, port } = await startServer({ handleCip: () => undefined });
    await server.close();
    const client = new LogixTcpClient({ host: "127.0.0.1", port, connectTimeoutMs: 2000 });
    await expect(client.connect()).rejects.toThrow();
    expect(client.state).toBe("idle");
  });

  it("close sends UnregisterSession and ends in the closed state", async () => {
    const { server, client } = await connectedClient({ handleCip: () => undefined });
    client.close();
    expect(client.state).toBe("closed");
    // Wait for the unregister frame to land server-side.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(server.commands).toContain(EnipCommand.UnregisterSession);
  });

  it("a registration failure surfaces and poisons the session", async () => {
    const { server, port } = await startServer({
      handleCip: () => undefined,
      registerStatus: 0x69, // unsupported protocol version
    });
    void server;
    const client = new LogixTcpClient({ host: "127.0.0.1", port, connectTimeoutMs: 2000 });
    cleanups.push(() => client.close());
    await expect(client.connect()).rejects.toThrow(/unsupported encapsulation protocol/);
    expect(client.state).toBe("failed");
  });
});

describe("read-only operations over TCP", () => {
  it("reads a DINT tag end to end", async () => {
    const { server, client } = await connectedClient({
      handleCip: (request) =>
        bytesEqual(request, buildReadTagRequest("Count"))
          ? hexToBytes("cc 00 00 00 c4 00 d2 04 00 00")
          : undefined,
    });
    const result = await client.readTag("Count");
    expect(result.typeName).toBe("DINT");
    expect(result.value).toBe(1234);
    expect(server.cipRequests).toHaveLength(1);
  });

  it("reassembles split TCP segments (stream framing under fire)", async () => {
    const { client } = await connectedClient({
      splitReplies: true,
      handleCip: () => hexToBytes("cc 00 00 00 c4 00 0f 00 00 00"),
    });
    const result = await client.readTag("Count");
    expect(result.value).toBe(15);
  });

  it("continues fragmented reads across the wire", async () => {
    const { server, client } = await connectedClient({
      handleCip: (request) => {
        if (bytesEqual(request, buildReadTagRequest("Big", 3))) {
          return hexToBytes("cc 00 06 00 c4 00 01 00 00 00 02 00 00 00");
        }
        if (bytesEqual(request, buildReadTagFragmentedRequest("Big", 3, 8))) {
          return hexToBytes("d2 00 00 00 c4 00 03 00 00 00");
        }
        return undefined;
      },
    });
    const result = await client.readTag("Big", 3);
    expect(result.value).toEqual([1, 2, 3]);
    expect(server.cipRequests).toHaveLength(2);
  });

  it("pages the tag list and surfaces symbols", async () => {
    const { client } = await connectedClient({
      handleCip: (request) => {
        if (bytesEqual(request, buildTagListRequest(0))) {
          return hexToBytes("d5 00 06 00 01 00 00 00 04 00 50 75 6d 70 c4 00");
        }
        if (bytesEqual(request, buildTagListRequest(2))) {
          return hexToBytes("d5 00 00 00 0c 00 00 00 04 00 46 6c 61 67 c1 00");
        }
        return undefined;
      },
    });
    const symbols = await client.listTags();
    expect(symbols.map((symbol) => symbol.name)).toEqual(["Pump", "Flag"]);
  });

  it("reads the identity object", async () => {
    const { client } = await connectedClient({
      handleCip: (request) =>
        bytesEqual(request, buildIdentityRequest())
          ? hexToBytes(
              "81 00 00 00 01 00 0e 00 96 00 21 0b 00 00 78 56 34 12 09 31 37 36 39 2d 4c 33 33 45",
            )
          : undefined,
    });
    const identity = await client.readIdentityObject();
    expect(identity.productName).toBe("1769-L33E");
    expect(identity.revision).toBe("33.11");
  });

  it("answers ListIdentity through the same connection", async () => {
    const { client } = await connectedClient({
      handleCip: () => undefined,
      listIdentityItem: hexToBytes(
        "01 00 00 02 af 12 c0 a8 01 0a 00 00 00 00 00 00 00 00 " +
          "01 00 0e 00 96 00 21 0b 60 00 78 56 34 12 09 31 37 36 39 2d 4c 33 33 45 03",
      ),
    });
    const info = await client.listIdentity();
    expect(info.productName).toBe("1769-L33E");
    expect(info.state).toBe(3);
  });

  it("CIP errors reject the request but keep the connection usable", async () => {
    const { client } = await connectedClient({
      handleCip: (request) =>
        toHex(request).includes("4d 69 73 73 69 6e 67") // "Missing"
          ? hexToBytes("cc 00 05 01 07 21")
          : hexToBytes("cc 00 00 00 c4 00 01 00 00 00"),
    });
    await expect(client.readTag("Missing")).rejects.toThrow(CipResponseError);
    expect(client.state).toBe("ready");
    expect((await client.readTag("Count")).value).toBe(1);
  });

  it("serializes concurrent requests over one connection", async () => {
    const { server, client } = await connectedClient({
      handleCip: (request) =>
        bytesEqual(request, buildReadTagRequest("A"))
          ? hexToBytes("cc 00 00 00 c4 00 01 00 00 00")
          : hexToBytes("cc 00 00 00 c4 00 02 00 00 00"),
    });
    const [first, second] = await Promise.all([client.readTag("A"), client.readTag("B")]);
    expect(first.value).toBe(1);
    expect(second.value).toBe(2);
    expect(server.cipRequests).toHaveLength(2);
  });
});

describe("failure handling", () => {
  it("fails pending requests when the target stops responding", async () => {
    const { client } = await connectedClient(
      { handleCip: () => undefined }, // swallow every CIP request
      { requestTimeoutMs: 150 },
    );
    await expect(client.readTag("Count")).rejects.toThrow(/no response/);
    expect(client.state).toBe("failed");
  });

  it("fails pending requests when the connection drops mid-flight", async () => {
    const { server, client } = await connectedClient({
      handleCip: () => {
        // Kill the connection instead of answering.
        setImmediate(() => server.dropConnections());
        return undefined;
      },
    });
    await expect(client.readTag("Count")).rejects.toThrow(/closed by peer|no response/);
    expect(client.state).toBe("failed");
  });
});

describe("connected (class-3) messaging over loopback", () => {
  it("opens a channel, reads through SendUnitData, and closes cleanly", async () => {
    const { server, port } = await startServer({
      handleCip: (request) =>
        bytesEqual(request, buildReadTagRequest("Count"))
          ? hexToBytes("cc 00 00 00 c4 00 d2 04 00 00")
          : undefined,
    });
    const client = new LogixTcpClient({ host: "127.0.0.1", port, connectTimeoutMs: 2000 });
    cleanups.push(() => client.close());
    await client.connect();

    // Reach the session core through the client's public connected API.
    const reply = await client.openConnected({
      connectionSerial: 0x2222,
      vendorId: 0x004d,
      originatorSerial: 0x778899aa,
    });
    expect(server.forwardOpenCount).toBe(1);
    expect(reply.otConnectionId).toBeGreaterThan(0);
    expect(client.isConnectedMode).toBe(true);

    // This read now travels as a connected SendUnitData request.
    const value = await client.readTag("Count");
    expect(value.value).toBe(1234);

    await client.closeConnected();
    expect(server.forwardCloseCount).toBe(1);
    expect(client.isConnectedMode).toBe(false);
  });
});

describe("read-only by construction", () => {
  it("exports no controller-mutating or write-capable surface", async () => {
    const pkg = await import("./index");
    const mutating = Object.keys(pkg).filter((name) =>
      /(write|download|onlineEdit|modeChange|clearFault|force|setAttribute)/i.test(name),
    );
    expect(mutating).toEqual([]);
  });
});
