import { afterEach, describe, expect, it, vi } from "vitest";
import { ControllerGateway, type ControllerDriver } from "@esco/controller-gateway";
import type { PlcProject } from "@esco/core";
import {
  bytesEqual,
  buildIdentityRequest,
  buildReadTagRequest,
  buildReadTemplateRequest,
  buildTagListRequest,
  buildTemplateAttributesRequest,
  encodeMultipleServicePacket,
  encodeMultipleServiceReply,
  encodeUnconnectedSendRequest,
} from "@esco/driver-ethernetip";
import { FakeLogixServer, type FakeLogixServerOptions } from "./testing/fake-logix-server";
import { ETHERNETIP_GATEWAY_DRIVER_ID, EthernetIpGatewayDriver } from "./gateway-driver";

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

/** Identity + tag database the fake target answers with. */
function demoCip(faulted = false): FakeLogixServerOptions["handleCip"] {
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
    if (bytesEqual(request, buildReadTagRequest("Pair"))) {
      return hexToBytes("cc 00 00 00 c4 00 01 00 00 00 02 00 00 00");
    }
    if (bytesEqual(request, buildReadTagRequest("Name"))) {
      return hexToBytes("cc 00 00 00 a0 02 ce 0f 02 00 00 00 4f 4b");
    }
    if (bytesEqual(request, buildReadTagRequest("Recipe"))) {
      return hexToBytes("cc 00 00 00 a0 02 34 12 aa bb"); // unknown structure
    }
    if (bytesEqual(request, buildReadTagRequest("Pump"))) {
      return hexToBytes("cc 00 00 00 c4 00 d2 04 00 00");
    }
    if (bytesEqual(request, buildReadTagRequest("Program:Main.Flag"))) {
      return hexToBytes("cc 00 00 00 c1 00 ff");
    }
    if (
      bytesEqual(
        request,
        encodeMultipleServicePacket([
          buildReadTagRequest("Pump"),
          buildReadTagRequest("Program:Main.Flag"),
        ]),
      )
    ) {
      return encodeMultipleServiceReply(
        [hexToBytes("cc 00 00 00 c4 00 d2 04 00 00"), hexToBytes("cc 00 00 00 c1 00 ff")],
      );
    }
    if (bytesEqual(request, buildTagListRequest(0))) {
      return hexToBytes(
        "d5 00 00 00 " +
          "01 00 00 00 04 00 50 75 6d 70 c4 00 " + // "Pump" DINT
          "03 00 00 00 04 00 56 61 6c 73 c4 20 " + // "Vals" DINT, 1 dim
          "05 00 00 00 0c 00 50 72 6f 67 72 61 6d 3a 4d 61 69 6e 68 80 " + // "Program:Main"
          "07 00 00 00 06 00 5f 5f 4d 65 74 61 c4 00", // "__Meta" (system)
      );
    }
    if (bytesEqual(request, buildTagListRequest(0, "Program:Main"))) {
      return hexToBytes("d5 00 00 00 02 00 00 00 04 00 46 6c 61 67 c1 00"); // "Flag" BOOL
    }
    return undefined;
  };
}

async function connectedDriver(
  options: FakeLogixServerOptions,
): Promise<{ server: FakeLogixServer; driver: EthernetIpGatewayDriver; port: number }> {
  const { server, port } = await startServer(options);
  const driver = new EthernetIpGatewayDriver({ connectTimeoutMs: 2000, requestTimeoutMs: 2000 });
  cleanups.push(() => driver.disconnect());
  const result = await driver.connect({ endpointUrl: `127.0.0.1:${port}` });
  expect(result.ok).toBe(true);
  return { server, driver, port };
}

describe("EthernetIpGatewayDriver", () => {
  it("connects read-only and maps identity without project fields", async () => {
    const { driver } = await connectedDriver({ handleCip: demoCip() });

    const identity = await driver.getIdentity();
    expect(identity.vendor).toBe("Rockwell Automation/Allen-Bradley");
    expect(identity.productName).toBe("1769-L33E");
    expect(identity.controllerType).toBe("1769-L33E");
    expect(identity.firmwareRevision).toBe("33.11");
    expect(identity.serialNumber).toBe("12345678");
    // Project fields stay absent — the wire cannot prove them.
    expect(identity.controllerName).toBeUndefined();
    expect(identity.projectName).toBeUndefined();
    expect(identity.projectSignature).toBeUndefined();
  });

  it("rejects bad endpoint or route configuration without throwing", async () => {
    const driver = new EthernetIpGatewayDriver();
    const missing = await driver.connect({});
    expect(missing.ok).toBe(false);
    expect(missing.message).toContain("endpoint is required");

    const malformed = await driver.connect({ endpointUrl: "host with spaces" });
    expect(malformed.ok).toBe(false);

    const badPort = await driver.connect({ endpointUrl: "127.0.0.1:99999" });
    expect(badPort.ok).toBe(false);

    const { port } = await startServer({ handleCip: demoCip() });
    const badRoute = await driver.connect({ endpointUrl: `127.0.0.1:${port}`, path: "1,0,2" });
    expect(badRoute.ok).toBe(false);
    expect(badRoute.message).toContain("route path");
  });

  it("reports unreachable targets as a failed connection result", async () => {
    const { server, port } = await startServer({ handleCip: demoCip() });
    await server.close();
    const driver = new EthernetIpGatewayDriver({ connectTimeoutMs: 500 });
    const result = await driver.connect({ endpointUrl: `127.0.0.1:${port}` });
    expect(result.ok).toBe(false);
    expect(result.state).toBe("disconnected");
    expect(result.message).toContain("failed");
  });

  it("routes requests through Unconnected Send when a CIP path is configured", async () => {
    const wrappedIdentity = encodeUnconnectedSendRequest(buildIdentityRequest(), [
      { port: 1, link: 0 },
    ]);
    const { server, port } = await startServer({
      handleCip: (request) =>
        bytesEqual(request, wrappedIdentity)
          ? hexToBytes(
              "81 00 00 00 01 00 0e 00 96 00 21 0b 00 00 78 56 34 12 09 31 37 36 39 2d 4c 33 33 45",
            )
          : undefined,
    });
    const driver = new EthernetIpGatewayDriver({ connectTimeoutMs: 2000, requestTimeoutMs: 2000 });
    cleanups.push(() => driver.disconnect());
    const result = await driver.connect({ endpointUrl: `127.0.0.1:${port}`, path: "1,0" });
    expect(result.ok).toBe(true);
    expect(server.cipRequests.some((req) => bytesEqual(req, wrappedIdentity))).toBe(true);
  });

  it("browses controller and program tags with honest types and writable:false", async () => {
    const { driver } = await connectedDriver({ handleCip: demoCip() });
    const tags = await driver.browseTags();
    expect(tags).toEqual([
      { name: "Pump", dataType: "DINT", scope: "controller", writable: false, sourceDriver: "ethernetip" },
      { name: "Vals", dataType: "DINT[]", scope: "controller", writable: false, sourceDriver: "ethernetip" },
      { name: "Program:Main.Flag", dataType: "BOOL", scope: "program", writable: false, sourceDriver: "ethernetip" },
    ]);
  });

  it("reads tags with honest quality per value shape", async () => {
    const { driver } = await connectedDriver({ handleCip: demoCip() });

    const scalar = await driver.readTag("Count");
    expect(scalar.value).toBe(1234);
    expect(scalar.dataType).toBe("DINT");
    expect(scalar.quality).toBe("good");

    const array = await driver.readTag("Pair");
    expect(array.value).toEqual([1, 2]);

    const text = await driver.readTag("Name");
    expect(text.value).toBe("OK");
    expect(text.dataType).toBe("STRING");

    const struct = await driver.readTag("Recipe");
    expect(struct.value).toBeNull();
    expect(struct.quality).toBe("uncertain"); // undecoded UDT — no fake value
  });

  it("negotiates connected messaging when enabled, reads over it, closes politely", async () => {
    const { server, port } = await startServer({ handleCip: demoCip() });
    const driver = new EthernetIpGatewayDriver({
      connectTimeoutMs: 2000,
      requestTimeoutMs: 2000,
      connectedMessaging: true,
    });
    cleanups.push(() => driver.disconnect());

    const result = await driver.connect({ endpointUrl: `127.0.0.1:${port}` });
    expect(result.ok).toBe(true);
    expect(result.message).toContain("Connected (class-3) messaging negotiated");
    expect(driver.connectedMessagingActive).toBe(true);
    expect(server.forwardOpenCount).toBe(1);

    // A read now travels over the connected channel; value still correct.
    expect((await driver.readTag("Count")).value).toBe(1234);

    await driver.disconnect();
    expect(server.forwardCloseCount).toBe(1);
    expect(driver.connectedMessagingActive).toBe(false);
  });

  it("stays on UCMM by default and does not Forward Open", async () => {
    const { server, driver } = await connectedDriver({ handleCip: demoCip() });
    expect(driver.connectedMessagingActive).toBe(false);
    expect(server.forwardOpenCount).toBe(0);
    expect((await driver.readTag("Count")).value).toBe(1234);
  });

  it("decodes structure tags through their templates (with caching)", async () => {
    // Target: tag list exposes "Mix" as a structure with template 0x123;
    // template 0x123 = "MyUdt" { Count: DINT @0, Flag: BOOL bit1 @4 },
    // structure handle 0x0FCE; reads return handle 0x0FCE + 8 value bytes.
    const handleCip = (request: Uint8Array): Uint8Array | undefined => {
      if (bytesEqual(request, buildIdentityRequest())) {
        return hexToBytes(
          "81 00 00 00 01 00 0e 00 96 00 21 0b 00 00 78 56 34 12 09 31 37 36 39 2d 4c 33 33 45",
        );
      }
      if (bytesEqual(request, buildTagListRequest(0))) {
        return hexToBytes("d5 00 00 00 05 00 00 00 03 00 4d 69 78 23 81"); // "Mix" struct
      }
      if (bytesEqual(request, buildReadTagRequest("Mix"))) {
        return hexToBytes("cc 00 00 00 a0 02 34 12 d2 04 00 00 02 00 00 00");
      }
      if (bytesEqual(request, buildTemplateAttributesRequest(0x123))) {
        return hexToBytes(
          "83 00 00 00 04 00 " +
            "04 00 00 00 1e 00 00 00 05 00 00 00 08 00 00 00 " +
            "02 00 00 00 02 00 01 00 00 00 34 12",
        );
      }
      if (bytesEqual(request, buildReadTemplateRequest(0x123, 0, 99))) {
        return hexToBytes(
          "cc 00 00 00 " +
            "00 00 c4 00 00 00 00 00 01 00 c1 00 04 00 00 00 " +
            "4d 79 55 64 74 3b 6e 00 43 6f 75 6e 74 00 46 6c 61 67 00",
        );
      }
      return undefined;
    };
    const { server, driver } = await connectedDriver({ handleCip });

    const first = await driver.readTag("Mix");
    expect(first.dataType).toBe("MyUdt");
    expect(first.quality).toBe("good");
    expect(first.value).toEqual({ Count: 1234, Flag: true });

    const second = await driver.readTag("Mix");
    expect(second.value).toEqual({ Count: 1234, Flag: true });

    // identity + read1 + lazy tag list + template attrs + template read + read2
    // — the symbol table and the template were each fetched exactly once.
    expect(server.cipRequests).toHaveLength(6);
  });

  it("decodes nested structures recursively with dotted member paths", async () => {
    const handleCip = (request: Uint8Array): Uint8Array | undefined => {
      if (bytesEqual(request, buildIdentityRequest())) {
        return hexToBytes(
          "81 00 00 00 01 00 0e 00 96 00 21 0b 00 00 78 56 34 12 09 31 37 36 39 2d 4c 33 33 45",
        );
      }
      if (bytesEqual(request, buildTagListRequest(0))) {
        return hexToBytes("d5 00 00 00 06 00 00 00 04 00 4d 69 78 32 24 81"); // "Mix2" → template 0x124
      }
      if (bytesEqual(request, buildReadTagRequest("Mix2"))) {
        return hexToBytes("cc 00 00 00 a0 02 22 22 07 00 00 00 09 00 00 00");
      }
      if (bytesEqual(request, buildTemplateAttributesRequest(0x124))) {
        return hexToBytes(
          "83 00 00 00 04 00 04 00 00 00 1e 00 00 00 05 00 00 00 08 00 00 00 " +
            "02 00 00 00 02 00 01 00 00 00 22 22",
        );
      }
      if (bytesEqual(request, buildReadTemplateRequest(0x124, 0, 99))) {
        return hexToBytes(
          "cc 00 00 00 " +
            "00 00 25 81 00 00 00 00 " + // Inner (template 0x125) @0
            "00 00 c4 00 04 00 00 00 " + // Total DINT @4
            "4f 3b 6e 00 49 6e 6e 65 72 00 54 6f 74 61 6c 00",
        );
      }
      if (bytesEqual(request, buildTemplateAttributesRequest(0x125))) {
        return hexToBytes(
          "83 00 00 00 04 00 04 00 00 00 1e 00 00 00 05 00 00 00 04 00 00 00 " +
            "02 00 00 00 01 00 01 00 00 00 33 33",
        );
      }
      if (bytesEqual(request, buildReadTemplateRequest(0x125, 0, 99))) {
        return hexToBytes(
          "cc 00 00 00 00 00 c4 00 00 00 00 00 49 3b 6e 00 43 6f 75 6e 74 00",
        );
      }
      return undefined;
    };
    const { server, driver } = await connectedDriver({ handleCip });

    const value = await driver.readTag("Mix2");
    expect(value.dataType).toBe("O");
    expect(value.quality).toBe("good");
    expect(value.value).toEqual({ "Inner.Count": 7, Total: 9 });
    // identity + read + tag list + 2×(attrs + template read) = 7 requests;
    // both templates were fetched as one closure.
    expect(server.cipRequests).toHaveLength(7);
  });

  it("refuses to decode when the structure handle does not match the template", async () => {
    const handleCip = (request: Uint8Array): Uint8Array | undefined => {
      if (bytesEqual(request, buildIdentityRequest())) {
        return hexToBytes(
          "81 00 00 00 01 00 0e 00 96 00 21 0b 00 00 78 56 34 12 09 31 37 36 39 2d 4c 33 33 45",
        );
      }
      if (bytesEqual(request, buildTagListRequest(0))) {
        return hexToBytes("d5 00 00 00 05 00 00 00 03 00 4d 69 78 23 81");
      }
      if (bytesEqual(request, buildReadTagRequest("Mix"))) {
        // Handle 0x9999 ≠ template CRC 0x0FCE — decoding must refuse.
        return hexToBytes("cc 00 00 00 a0 02 99 99 d2 04 00 00 02 00 00 00");
      }
      if (bytesEqual(request, buildTemplateAttributesRequest(0x123))) {
        return hexToBytes(
          "83 00 00 00 04 00 " +
            "04 00 00 00 1e 00 00 00 05 00 00 00 08 00 00 00 " +
            "02 00 00 00 02 00 01 00 00 00 34 12",
        );
      }
      if (bytesEqual(request, buildReadTemplateRequest(0x123, 0, 99))) {
        return hexToBytes(
          "cc 00 00 00 " +
            "00 00 c4 00 00 00 00 00 01 00 c1 00 04 00 00 00 " +
            "4d 79 55 64 74 3b 6e 00 43 6f 75 6e 74 00 46 6c 61 67 00",
        );
      }
      return undefined;
    };
    const { driver } = await connectedDriver({ handleCip });
    const value = await driver.readTag("Mix");
    expect(value.value).toBeNull(); // never decoded with the wrong template
    expect(value.quality).toBe("uncertain");
  });

  it("batch-reads tags in one Multiple Service Packet round trip", async () => {
    const multiRequest = encodeMultipleServicePacket([
      buildReadTagRequest("Count"),
      buildReadTagRequest("Missing"),
    ]);
    const { server, driver } = await connectedDriver({
      handleCip: (request) => {
        if (bytesEqual(request, buildIdentityRequest())) {
          return hexToBytes(
            "81 00 00 00 01 00 0e 00 96 00 21 0b 00 00 78 56 34 12 09 31 37 36 39 2d 4c 33 33 45",
          );
        }
        if (bytesEqual(request, multiRequest)) {
          return encodeMultipleServiceReply(
            [hexToBytes("cc 00 00 00 c4 00 d2 04 00 00"), hexToBytes("cc 00 05 01 07 21")],
            0x1e,
          );
        }
        return undefined;
      },
    });

    const result = await driver.readTags(["Count", "Missing"]);
    expect(result.values).toHaveLength(1);
    expect(result.values[0]).toMatchObject({ tagName: "Count", value: 1234, quality: "good" });
    expect(result.errors["Missing"]).toContain("path destination unknown");
    // One identity request (connect) + ONE multi-service request — not two reads.
    expect(server.cipRequests).toHaveLength(2);
  });

  it("reports the keyswitch position as the controller mode", async () => {
    const { driver } = await connectedDriver({
      handleCip: (request) =>
        bytesEqual(request, buildIdentityRequest())
          ? hexToBytes(
              // status bytes "60 30" (low, high) → Remote Run
              "81 00 00 00 01 00 0e 00 96 00 21 0b 60 30 78 56 34 12 09 31 37 36 39 2d 4c 33 33 45",
            )
          : undefined,
    });
    const status = await driver.getStatus();
    expect(status.mode).toBe("Remote Run");
    expect(status.health).toBe("ok");
    expect(status.diagnostics?.find((diagnostic) => diagnostic.id === "cip-identity-status-word")).toMatchObject({
      severity: "info",
      label: "CIP identity status word",
      evidence: expect.arrayContaining(["status=0x3060", "mode=Remote Run"]),
    });
  });

  it("surfaces identity fault bits as device-level faults", async () => {
    const { driver } = await connectedDriver({ handleCip: demoCip(true) });
    const faults = await driver.getFaults();
    expect(faults).toHaveLength(1);
    expect(faults[0].id).toBe("cip-major-recoverable");
    expect(faults[0].severity).toBe("major");
    expect(faults[0].clearable).toBe(false);
    expect(faults[0].evidence).toEqual(expect.arrayContaining(["status=0x0400", "faultBits=majorRecoverable"]));
    expect(faults[0].recommendation).toContain("approved plant workflow");

    const status = await driver.getStatus();
    expect(status.health).toBe("faulted");
    expect(status.mode).toBe("Faulted");
    expect(status.diagnostics?.map((diagnostic) => diagnostic.id)).toEqual(
      expect.arrayContaining(["cip-identity-status-word", "cip-major-recoverable"]),
    );

    const { driver: clean } = await connectedDriver({ handleCip: demoCip(false) });
    expect(await clean.getFaults()).toEqual([]);
  });

  it("uploads a read-only Allen-Bradley tag snapshot without enabling writes", async () => {
    const { driver } = await connectedDriver({ handleCip: demoCip() });

    const snapshot = await driver.uploadSnapshot();

    expect(snapshot.sourceDriver).toBe("ethernetip");
    expect(snapshot.identity.productName).toBe("1769-L33E");
    expect(snapshot.connectionEvidence).toMatchObject({
      realControllerIo: true,
      hardwareValidated: false,
      verified: false,
    });
    expect(snapshot.tags).toEqual([
      expect.objectContaining({ tagName: "Pump", dataType: "DINT", value: 1234, quality: "good" }),
      expect.objectContaining({ tagName: "Program:Main.Flag", dataType: "BOOL", value: true, quality: "good" }),
    ]);
    expect(snapshot.raw).toMatchObject({
      kind: "allen-bradley-read-only-tag-snapshot",
      browsedTagCount: 3,
      sampledTagCount: 2,
      requestedSampleCount: 2,
      skippedTagCount: 1,
      sampledTagLimit: 200,
      truncated: false,
      readErrors: {},
      note: expect.stringContaining("not a Rockwell ACD"),
    });
  });

  it("exposes no write or compare surface (snapshot and subscriptions stay read-only)", async () => {
    const driver: ControllerDriver = new EthernetIpGatewayDriver();
    expect(driver.writeTag).toBeUndefined();
    expect(typeof driver.uploadSnapshot).toBe("function");
    expect(driver.compareProject).toBeUndefined();
    expect(typeof driver.subscribeTags).toBe("function"); // read-only watch path
  });

  it("subscribes via polling: initial sample, change-driven emits, clean unsubscribe", async () => {
    let countBytes = "d2 04 00 00"; // 1234
    const { port } = await startServer({
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
    const driver = new EthernetIpGatewayDriver({
      connectTimeoutMs: 2000,
      requestTimeoutMs: 2000,
      subscribePollIntervalMs: 40,
    });
    cleanups.push(() => driver.disconnect());
    expect((await driver.connect({ endpointUrl: `127.0.0.1:${port}` })).ok).toBe(true);

    const received: Array<{ tagName: string; value: unknown }> = [];
    const handle = await (driver as ControllerDriver).subscribeTags!(["Count"], (value) => {
      received.push({ tagName: value.tagName, value: value.value });
    });

    // Initial sample arrived before the handle resolved.
    expect(received).toEqual([{ tagName: "Count", value: 1234 }]);

    // Several poll ticks with an unchanged value do not re-emit.
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(received).toHaveLength(1);

    // A change emits exactly once.
    countBytes = "2e 16 00 00"; // 5678
    await vi.waitFor(() => expect(received).toHaveLength(2), { timeout: 2000 });
    expect(received[1]).toEqual({ tagName: "Count", value: 5678 });

    // Unsubscribe stops the loop.
    await handle.unsubscribe();
    countBytes = "01 00 00 00";
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(received).toHaveLength(2);
  });

  it("disconnect stops active subscriptions", async () => {
    const { port } = await startServer({
      handleCip: (request) =>
        bytesEqual(request, buildIdentityRequest())
          ? hexToBytes(
              "81 00 00 00 01 00 0e 00 96 00 21 0b 00 00 78 56 34 12 09 31 37 36 39 2d 4c 33 33 45",
            )
          : bytesEqual(request, buildReadTagRequest("Count"))
            ? hexToBytes("cc 00 00 00 c4 00 01 00 00 00")
            : undefined,
    });
    const driver = new EthernetIpGatewayDriver({
      connectTimeoutMs: 2000,
      requestTimeoutMs: 2000,
      subscribePollIntervalMs: 40,
    });
    cleanups.push(() => driver.disconnect());
    expect((await driver.connect({ endpointUrl: `127.0.0.1:${port}` })).ok).toBe(true);

    const received: string[] = [];
    await (driver as ControllerDriver).subscribeTags!(["Count"], (value) =>
      received.push(value.tagName),
    );
    expect(received).toHaveLength(1);
    await driver.disconnect();
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(received).toHaveLength(1); // no further polls after disconnect
  });

  it("reports a lost TCP session as faulted status, never stale-connected", async () => {
    const { server, driver } = await connectedDriver({ handleCip: demoCip() });
    expect((await driver.getStatus()).state).toBe("online-readonly");

    server.dropConnections(); // peer drops mid-session
    await vi.waitFor(
      async () => {
        const status = await driver.getStatus();
        expect(status.state).toBe("faulted");
      },
      { timeout: 2000 },
    );
    const status = await driver.getStatus();
    expect(status.connected).toBe(false);
    expect(status.health).toBe("faulted");
    expect(status.message).toContain("was lost");
    expect(status.message).toContain("reconnect");
  });

  it("disconnect is idempotent and downgrades status", async () => {
    const { driver } = await connectedDriver({ handleCip: demoCip() });
    await driver.disconnect();
    await driver.disconnect();
    const status = await driver.getStatus();
    expect(status.connected).toBe(false);
    expect(status.state).toBe("disconnected");
    await expect(driver.readTag("Count")).rejects.toThrow(/requires a connected/);
  });
});

describe("gateway integration — Goal B rule 7", () => {
  it("lands in Online Read-Only when no local project is open", async () => {
    const { port } = await startServer({ handleCip: demoCip() });
    const driver = new EthernetIpGatewayDriver({ connectTimeoutMs: 2000, requestTimeoutMs: 2000 });
    cleanups.push(() => driver.disconnect());
    const gateway = new ControllerGateway([driver]);

    const result = await gateway.connect(ETHERNETIP_GATEWAY_DRIVER_ID, {
      endpointUrl: `127.0.0.1:${port}`,
    });
    expect(result.ok).toBe(true);
    expect(result.state).toBe("online-readonly");
    expect(gateway.snapshot().readOnly).toBe(true);

    // Reads flow UI → gateway → driver → wire; never UI → driver.
    const value = await gateway.readTag("Count");
    expect(value.value).toBe(1234);
  });

  it("can never reach online-matched: the wire cannot prove the project", async () => {
    const { port } = await startServer({ handleCip: demoCip() });
    const driver = new EthernetIpGatewayDriver({ connectTimeoutMs: 2000, requestTimeoutMs: 2000 });
    cleanups.push(() => driver.disconnect());
    const gateway = new ControllerGateway([driver]);

    const localProject = {
      name: "WaterSkid",
      controllers: [
        {
          name: "PLC01",
          processorType: "1769-L33E", // even a matching type must not unlock writes
          firmwareRevision: "33.11",
          controllerTags: [],
        },
      ],
    } as unknown as PlcProject;

    const result = await gateway.connect(
      ETHERNETIP_GATEWAY_DRIVER_ID,
      { endpointUrl: `127.0.0.1:${port}` },
      localProject,
    );
    expect(result.ok).toBe(true);
    expect(result.state).toBe("online-readonly"); // NOT online-matched
    expect(result.compare?.matched).toBe(false);
    expect(result.compare?.message).toContain("read-only");

    const write = await gateway.controlledWrite({
      tagName: "Count",
      value: 5,
      confirmed: true,
      permission: "granted",
      reason: "test attempt that must be blocked",
    });
    expect(write.ok).toBe(false);
    expect(write.message).toContain("proven local/controller match");
  });
});
