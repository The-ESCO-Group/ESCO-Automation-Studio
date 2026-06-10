import { afterEach, describe, expect, it } from "vitest";
import {
  bytesEqual,
  buildIdentityRequest,
  buildReadTagRequest,
  buildTagListRequest,
} from "@esco/driver-ethernetip";
import { FakeLogixServer, type FakeLogixServerOptions } from "./testing/fake-logix-server";
import {
  EthernetIpReadOnlyComms,
  createEthernetIpReadOnlyTransport,
} from "./readonly-comms";

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

/** CIP handler covering identity + a small tag database for adapter tests. */
function demoControllerCip(faulted = false): FakeLogixServerOptions["handleCip"] {
  const statusBytes = faulted ? "00 04" : "00 00";
  return (request) => {
    if (bytesEqual(request, buildIdentityRequest())) {
      return hexToBytes(
        `81 00 00 00 01 00 0e 00 96 00 21 0b ${statusBytes} 78 56 34 12 09 31 37 36 39 2d 4c 33 33 45`,
      );
    }
    if (bytesEqual(request, buildReadTagRequest("Count"))) {
      return hexToBytes("cc 00 00 00 c4 00 d2 04 00 00");
    }
    if (bytesEqual(request, buildReadTagRequest("Running"))) {
      return hexToBytes("cc 00 00 00 c1 00 ff");
    }
    if (bytesEqual(request, buildReadTagRequest("Name"))) {
      return hexToBytes("cc 00 00 00 a0 02 ce 0f 02 00 00 00 4f 4b");
    }
    if (bytesEqual(request, buildReadTagRequest("Pair"))) {
      return hexToBytes("cc 00 00 00 c4 00 01 00 00 00 02 00 00 00");
    }
    if (bytesEqual(request, buildReadTagRequest("SmallLint"))) {
      return hexToBytes("cc 00 00 00 c5 00 05 00 00 00 00 00 00 00");
    }
    if (bytesEqual(request, buildReadTagRequest("HugeLint"))) {
      return hexToBytes("cc 00 00 00 c5 00 ff ff ff ff ff ff ff 7f");
    }
    if (bytesEqual(request, buildTagListRequest(0))) {
      return hexToBytes(
        "d5 00 00 00 " +
          "01 00 00 00 04 00 50 75 6d 70 c4 00 " + // "Pump" (atomic)
          "05 00 00 00 0c 00 50 72 6f 67 72 61 6d 3a 4d 61 69 6e 68 80 " + // "Program:Main"
          "07 00 00 00 06 00 5f 5f 4d 65 74 61 c4 00", // "__Meta" (system)
      );
    }
    if (bytesEqual(request, buildTagListRequest(0, "Program:Main"))) {
      return hexToBytes("d5 00 00 00 02 00 00 00 04 00 46 6c 61 67 c1 00"); // "Flag"
    }
    return undefined;
  };
}

async function openComms(
  options: FakeLogixServerOptions,
): Promise<{ server: FakeLogixServer; comms: EthernetIpReadOnlyComms }> {
  const { server, port } = await startServer(options);
  const comms = new EthernetIpReadOnlyComms({
    host: "127.0.0.1",
    port,
    connectTimeoutMs: 2000,
    requestTimeoutMs: 2000,
  });
  cleanups.push(() => comms.close());
  const opened = await comms.open();
  expect(opened.ok).toBe(true);
  return { server, comms };
}

describe("EthernetIpReadOnlyComms", () => {
  it("declares conservative read-only capabilities", () => {
    const comms = new EthernetIpReadOnlyComms({ host: "127.0.0.1" });
    expect(comms.capabilities).toEqual({ canRead: true, canMonitor: false, canReadFaults: false });
    expect(comms.displayName).toContain("127.0.0.1:44818");
  });

  it("opens against a live target and reports failures without throwing", async () => {
    const { comms } = await openComms({ handleCip: demoControllerCip() });
    const again = await comms.open();
    expect(again.ok).toBe(false);
    expect(again.message).toContain("already open");

    const { server, port } = await startServer({ handleCip: () => undefined });
    await server.close();
    const dead = new EthernetIpReadOnlyComms({ host: "127.0.0.1", port, connectTimeoutMs: 500 });
    const result = await dead.open();
    expect(result.ok).toBe(false);
    expect(result.message).toContain("failed");
  });

  it("maps controller identity into the seam shape", async () => {
    const { comms } = await openComms({ handleCip: demoControllerCip() });
    const identity = await comms.readIdentity();
    expect(identity).toEqual({
      vendor: "Rockwell Automation/Allen-Bradley",
      productName: "1769-L33E",
      revision: "33.11",
      serialNumber: "12345678",
      controllerMode: undefined, // run/program mode is not read yet — never faked
    });
  });

  it("reports Faulted as the controller mode when fault bits are set", async () => {
    const { comms } = await openComms({ handleCip: demoControllerCip(true) });
    const identity = await comms.readIdentity();
    expect(identity.controllerMode).toBe("Faulted");
  });

  it("reads scalar tags and refuses to mangle non-scalar values", async () => {
    const { comms } = await openComms({ handleCip: demoControllerCip() });
    expect(await comms.readTag("Count")).toBe(1234);
    expect(await comms.readTag("Running")).toBe(true);
    expect(await comms.readTag("Name")).toBe("OK");
    expect(await comms.readTag("SmallLint")).toBe(5);
    expect(await comms.readTag("HugeLint")).toBe("9223372036854775807");
    expect(await comms.readTag("Pair")).toBeUndefined(); // array → no scalar
  });

  it("lists controller and program tags, excluding system symbols", async () => {
    const { comms } = await openComms({ handleCip: demoControllerCip() });
    expect(await comms.listTags()).toEqual(["Pump", "Program:Main.Flag"]);
  });

  it("requires an open link and closes idempotently", async () => {
    const comms = new EthernetIpReadOnlyComms({ host: "127.0.0.1", port: 1 });
    await expect(comms.readTag("Count")).rejects.toThrow(/requires an open link/);

    const { comms: live } = await openComms({ handleCip: demoControllerCip() });
    await live.close();
    await live.close(); // idempotent
    await expect(live.readTag("Count")).rejects.toThrow(/requires an open link/);
  });
});

describe("createEthernetIpReadOnlyTransport", () => {
  it("builds a transport that is unverified and read-only by construction", async () => {
    const { port } = await startServer({ handleCip: demoControllerCip() });
    const transport = createEthernetIpReadOnlyTransport({ host: "127.0.0.1", port });

    expect(transport.capabilities.verified).toBe(false);
    expect(transport.capabilities.canWrite).toBe(false);
    expect(transport.capabilities.realControllerIo).toBe(true);
    expect(transport.capabilities.canRead).toBe(true);
    expect(transport.capabilities.canMonitor).toBe(false);

    const result = await transport.connect();
    expect(result.ok).toBe(true);
    // canMonitor is false, so the honest report is read-only, and the
    // controller-comm safety gate will still route to safety-blocked because
    // verified is false — that is the designed behavior, not a bug.
    expect(result.reportedState).toBe("connected-readonly");
    await transport.disconnect();
  });

  it("reports an unreachable target as connected-unavailable", async () => {
    const { server, port } = await startServer({ handleCip: () => undefined });
    await server.close();
    const transport = createEthernetIpReadOnlyTransport({
      host: "127.0.0.1",
      port,
      connectTimeoutMs: 500,
    });
    const result = await transport.connect();
    expect(result.ok).toBe(false);
    expect(result.reportedState).toBe("connected-unavailable");
  });

  it("exposes no verified parameter anywhere in the factory surface", () => {
    // The factory signature takes only comms options; this assertion guards
    // against someone "helpfully" adding a verified flag to it later.
    expect(createEthernetIpReadOnlyTransport.length).toBe(1);
  });
});
