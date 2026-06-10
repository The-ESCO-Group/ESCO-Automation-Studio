import { describe, expect, it } from "vitest";
import { concatBytes, toHex } from "../bytes";
import { hexToBytes } from "../testing/hex";
import {
  EnipCommand,
  EnipStatus,
  encodeEncapsulation,
} from "../enip/encapsulation";
import { CpfItemType, encodeCpf, encodeSendRRDataPayload, decodeSendRRDataPayload, extractUnconnectedData } from "../enip/cpf";
import { CipResponseError } from "../cip/message-router";
import { backplaneRoute, encodeUnconnectedSendRequest } from "../cip/unconnected-send";
import {
  encodeMultipleServicePacket,
  encodeMultipleServiceReply,
} from "../cip/multi-service";
import { buildForwardCloseRequest, buildForwardOpenRequest } from "../cip/forward-open";
import { encodeSendUnitDataPayload, decodeSendUnitDataPayload } from "../enip/cpf";
import { buildReadTagFragmentedRequest, buildReadTagRequest } from "../logix/read-tag";
import { buildTagListRequest } from "../logix/tag-list";
import { LogixSessionCore } from "./session-core";

const HANDLE = 0x1234;

function registerReply(handle = HANDLE, status = 0): Uint8Array {
  return encodeEncapsulation({
    command: EnipCommand.RegisterSession,
    sessionHandle: handle,
    status,
    data: hexToBytes("01 00 00 00"),
  });
}

/** Wraps a message-router response as the SendRRData reply frame. */
function ucmmReply(responseHex: string, handle = HANDLE, status = 0): Uint8Array {
  return encodeEncapsulation({
    command: EnipCommand.SendRRData,
    sessionHandle: handle,
    status,
    data: encodeSendRRDataPayload(hexToBytes(responseHex)),
  });
}

/** Unwraps the CIP request bytes from an outbound SendRRData frame. */
function cipRequestOf(frame: Uint8Array): Uint8Array {
  // 24-byte encapsulation header, then SendRRData payload.
  const payload = decodeSendRRDataPayload(frame.slice(24));
  return extractUnconnectedData(payload.items);
}

async function microtasks(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
}

async function openSession(): Promise<LogixSessionCore> {
  const session = new LogixSessionCore();
  const opened = session.open();
  expect(session.takeOutbound()).toHaveLength(1);
  session.receive(registerReply());
  await opened;
  return session;
}

describe("session lifecycle", () => {
  it("opens with the golden RegisterSession frame and stores the handle", async () => {
    const session = new LogixSessionCore();
    expect(session.state).toBe("idle");
    const opened = session.open();
    expect(session.state).toBe("registering");

    const frames = session.takeOutbound();
    expect(frames).toHaveLength(1);
    expect(toHex(frames[0])).toBe(
      "65 00 04 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 01 00 00 00",
    );

    session.receive(registerReply());
    const reply = await opened;
    expect(reply.sessionHandle).toBe(HANDLE);
    expect(session.state).toBe("ready");
    expect(session.sessionHandle).toBe(HANDLE);
  });

  it("rejects a second open and requests before open", async () => {
    const session = await openSession();
    await expect(session.open()).rejects.toThrow(/expected idle/);

    const fresh = new LogixSessionCore();
    await expect(fresh.readIdentityObject()).rejects.toThrow(/not opened/);
  });

  it("close emits UnregisterSession and rejects pending work", async () => {
    const session = await openSession();
    const pending = session.readTag("Count");
    session.takeOutbound(); // in-flight read frame
    session.close();

    const frames = session.takeOutbound();
    expect(frames).toHaveLength(1);
    expect(toHex(frames[0])).toBe(
      "66 00 00 00 34 12 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00",
    );
    await expect(pending).rejects.toThrow(/closed by client/);
    expect(session.state).toBe("closed");

    // Frames received after close are ignored, not dispatched.
    session.receive(ucmmReply("cc 00 00 00 c4 00 01 00 00 00"));
    expect(session.state).toBe("closed");
  });

  it("fail rejects everything and poisons later requests", async () => {
    const session = await openSession();
    const pending = session.readTag("Count");
    session.fail(new Error("socket reset"));
    await expect(pending).rejects.toThrow(/socket reset/);
    expect(session.state).toBe("failed");
    await expect(session.readTag("Other")).rejects.toThrow(/session failed/);
  });
});

describe("UCMM pipeline", () => {
  it("reads a DINT tag end to end with the expected frame bytes", async () => {
    const session = await openSession();
    const read = session.readTag("Count");

    const frames = session.takeOutbound();
    expect(frames).toHaveLength(1);
    expect(toHex(cipRequestOf(frames[0]))).toBe(toHex(buildReadTagRequest("Count")));
    // Session handle is stamped into the encapsulation header (offset 4).
    expect(toHex(frames[0].slice(4, 8))).toBe("34 12 00 00");

    session.receive(ucmmReply("cc 00 00 00 c4 00 d2 04 00 00"));
    const result = await read;
    expect(result.typeName).toBe("DINT");
    expect(result.value).toBe(1234);
    expect(result.partial).toBe(false);
  });

  it("serializes concurrent requests: one frame in flight at a time", async () => {
    const session = await openSession();
    const first = session.readTag("A");
    const second = session.readTag("B");

    expect(session.takeOutbound()).toHaveLength(1);
    expect(session.pendingRequestCount).toBe(2);

    session.receive(ucmmReply("cc 00 00 00 c4 00 01 00 00 00"));
    await microtasks();
    const nextFrames = session.takeOutbound();
    expect(nextFrames).toHaveLength(1);
    expect(toHex(cipRequestOf(nextFrames[0]))).toBe(toHex(buildReadTagRequest("B")));

    session.receive(ucmmReply("cc 00 00 00 c4 00 02 00 00 00"));
    expect((await first).value).toBe(1);
    expect((await second).value).toBe(2);
  });

  it("holds UCMM requests queued during registration until the handle exists", async () => {
    const session = new LogixSessionCore();
    const opened = session.open();
    const read = session.readTag("Count");

    expect(session.takeOutbound()).toHaveLength(1); // register only — no UCMM yet
    session.receive(registerReply());
    await opened;
    await microtasks();

    const frames = session.takeOutbound();
    expect(frames).toHaveLength(1);
    expect(toHex(cipRequestOf(frames[0]))).toBe(toHex(buildReadTagRequest("Count")));
    session.receive(ucmmReply("cc 00 00 00 c4 00 2a 00 00 00"));
    expect((await read).value).toBe(42);
  });

  it("wraps requests in Unconnected Send when a route is given", async () => {
    const session = await openSession();
    const read = session.readTag("Count", 1, { route: backplaneRoute(0) });

    const frames = session.takeOutbound();
    expect(toHex(cipRequestOf(frames[0]))).toBe(
      toHex(encodeUnconnectedSendRequest(buildReadTagRequest("Count"), backplaneRoute(0))),
    );

    session.receive(ucmmReply("cc 00 00 00 c4 00 d2 04 00 00"));
    expect((await read).value).toBe(1234);
  });

  it("a CIP error rejects that request but keeps the session usable", async () => {
    const session = await openSession();
    const missing = session.readTag("Missing");
    session.takeOutbound();
    session.receive(ucmmReply("cc 00 05 01 07 21"));
    await expect(missing).rejects.toThrow(CipResponseError);
    await expect(missing).rejects.toThrow(/path destination unknown/);
    expect(session.state).toBe("ready");

    const ok = session.readTag("Count");
    await microtasks();
    session.takeOutbound();
    session.receive(ucmmReply("cc 00 00 00 c4 00 01 00 00 00"));
    expect((await ok).value).toBe(1);
  });

  it("an encapsulation-level error poisons the session", async () => {
    const session = await openSession();
    const read = session.readTag("Count");
    session.takeOutbound();
    session.receive(ucmmReply("cc 00 00 00", HANDLE, EnipStatus.InvalidSessionHandle));
    await expect(read).rejects.toThrow(/invalid session handle/);
    expect(session.state).toBe("failed");
  });

  it("an unexpected packet with nothing in flight is a protocol violation", async () => {
    const session = await openSession();
    session.receive(ucmmReply("cc 00 00 00 c4 00 01 00 00 00"));
    expect(session.state).toBe("failed");
    await expect(session.readTag("Count")).rejects.toThrow(/session failed/);
  });

  it("a reply with the wrong command fails the session", async () => {
    const session = await openSession();
    const read = session.readTag("Count");
    session.takeOutbound();
    session.receive(
      encodeEncapsulation({ command: EnipCommand.ListIdentity, data: encodeCpf([]) }),
    );
    await expect(read).rejects.toThrow(/protocol violation/);
    expect(session.state).toBe("failed");
  });
});

describe("fragmented reads", () => {
  it("reassembles partial transfers and resumes at the right offset", async () => {
    const session = await openSession();
    const read = session.readTag("Big", 3);
    session.takeOutbound();

    // First reply: partial, DINTs [1, 2] → 8 value bytes received.
    session.receive(ucmmReply("cc 00 06 00 c4 00 01 00 00 00 02 00 00 00"));
    await microtasks();
    const continuation = session.takeOutbound();
    expect(continuation).toHaveLength(1);
    expect(toHex(cipRequestOf(continuation[0]))).toBe(
      toHex(buildReadTagFragmentedRequest("Big", 3, 8)),
    );

    // Continuation reply: final fragment, DINT [3] (type prefix repeats).
    session.receive(ucmmReply("d2 00 00 00 c4 00 03 00 00 00"));
    const result = await read;
    expect(result.value).toEqual([1, 2, 3]);
    expect(result.elementCount).toBe(3);
    expect(result.partial).toBe(false);
  });

  it("rejects when a continuation makes no progress", async () => {
    const session = await openSession();
    const read = session.readTag("Big", 3);
    session.takeOutbound();
    session.receive(ucmmReply("cc 00 06 00 c4 00 01 00 00 00"));
    await microtasks();
    session.takeOutbound();
    // Partial again but zero new value bytes — would loop forever.
    session.receive(ucmmReply("d2 00 06 00 c4 00"));
    await expect(read).rejects.toThrow(/made no progress/);
    expect(session.state).toBe("ready"); // per-request failure, not session loss
  });
});

describe("batched tag reads (Multiple Service Packet)", () => {
  /** SendRRData reply frame from raw message-router response bytes. */
  function ucmmReplyRaw(responseBytes: Uint8Array, handle = HANDLE): Uint8Array {
    return encodeEncapsulation({
      command: EnipCommand.SendRRData,
      sessionHandle: handle,
      data: encodeSendRRDataPayload(responseBytes),
    });
  }

  it("sends one multi-service frame for a chunk and splits per-tag results", async () => {
    const session = await openSession();
    const batch = session.readTagsBatch(["A", "B"]);

    const frames = session.takeOutbound();
    expect(frames).toHaveLength(1);
    expect(toHex(cipRequestOf(frames[0]))).toBe(
      toHex(encodeMultipleServicePacket([buildReadTagRequest("A"), buildReadTagRequest("B")])),
    );

    session.receive(
      ucmmReplyRaw(
        encodeMultipleServiceReply(
          [hexToBytes("cc 00 00 00 c4 00 01 00 00 00"), hexToBytes("cc 00 05 01 07 21")],
          0x1e,
        ),
      ),
    );
    const outcome = await batch;
    expect(outcome.results["A"]?.value).toBe(1);
    expect(outcome.results["B"]).toBeUndefined();
    expect(outcome.errors["B"]).toContain("path destination unknown");
  });

  it("chunks large batches and sends single tags unwrapped", async () => {
    const session = await openSession();
    const batch = session.readTagsBatch(["A", "B", "C"], { chunkSize: 2 });

    // Chunk 1: multi-service for A+B.
    session.receive(
      ucmmReplyRaw(
        encodeMultipleServiceReply([
          hexToBytes("cc 00 00 00 c4 00 01 00 00 00"),
          hexToBytes("cc 00 00 00 c4 00 02 00 00 00"),
        ]),
      ),
    );
    await microtasks();
    // Chunk 2 has one tag: a plain Read Tag request, not a wrapper.
    const frames = session.takeOutbound();
    const last = frames[frames.length - 1];
    expect(toHex(cipRequestOf(last))).toBe(toHex(buildReadTagRequest("C")));
    session.receive(ucmmReplyRaw(hexToBytes("cc 00 00 00 c4 00 03 00 00 00")));

    const outcome = await batch;
    expect(outcome.results["A"]?.value).toBe(1);
    expect(outcome.results["B"]?.value).toBe(2);
    expect(outcome.results["C"]?.value).toBe(3);
  });

  it("falls back to per-tag reads when the target rejects multi-service", async () => {
    const session = await openSession();
    const batch = session.readTagsBatch(["A", "B"]);
    session.takeOutbound();

    // Outer failure: service not supported.
    session.receive(ucmmReplyRaw(hexToBytes("8a 00 08 00")));
    await microtasks();
    const sequentialA = session.takeOutbound();
    expect(toHex(cipRequestOf(sequentialA[0]))).toBe(toHex(buildReadTagRequest("A")));
    session.receive(ucmmReplyRaw(hexToBytes("cc 00 00 00 c4 00 0a 00 00 00")));
    await microtasks();
    const sequentialB = session.takeOutbound();
    expect(toHex(cipRequestOf(sequentialB[0]))).toBe(toHex(buildReadTagRequest("B")));
    session.receive(ucmmReplyRaw(hexToBytes("cc 00 00 00 c4 00 0b 00 00 00")));

    const outcome = await batch;
    expect(outcome.results["A"]?.value).toBe(10);
    expect(outcome.results["B"]?.value).toBe(11);
    expect(outcome.errors).toEqual({});
  });

  it("re-reads embedded partial transfers through the fragmented path", async () => {
    const session = await openSession();
    const batch = session.readTagsBatch(["Big", "Small"]);
    session.takeOutbound();

    session.receive(
      ucmmReplyRaw(
        encodeMultipleServiceReply(
          [
            // Embedded partial → triggers a dedicated fragmented re-read.
            concatBytes([hexToBytes("cc 00 06 00 c4 00 01 00 00 00")]),
            hexToBytes("cc 00 00 00 c4 00 05 00 00 00"),
          ],
          0x1e,
        ),
      ),
    );
    await microtasks();
    const reRead = session.takeOutbound();
    expect(toHex(cipRequestOf(reRead[0]))).toBe(toHex(buildReadTagRequest("Big")));
    session.receive(ucmmReplyRaw(hexToBytes("cc 00 00 00 c4 00 63 00 00 00")));

    const outcome = await batch;
    expect(outcome.results["Big"]?.value).toBe(99);
    expect(outcome.results["Small"]?.value).toBe(5);
  });

  it("reports invalid tag addresses without sending anything for them", async () => {
    const session = await openSession();
    const batch = session.readTagsBatch(["Good", "Bad-Name"]);
    const frames = session.takeOutbound();
    // Only "Good" made it to the wire (single tag → plain request).
    expect(frames).toHaveLength(1);
    expect(toHex(cipRequestOf(frames[0]))).toBe(toHex(buildReadTagRequest("Good")));
    session.receive(ucmmReplyRaw(hexToBytes("cc 00 00 00 c4 00 01 00 00 00")));
    const outcome = await batch;
    expect(outcome.results["Good"]?.value).toBe(1);
    expect(outcome.errors["Bad-Name"]).toContain("invalid tag path component");
  });
});

describe("connected (class-3) mode", () => {
  const CHANNEL = {
    originatorConnectionId: 0x45531111,
    connectionSerial: 0x1111,
    vendorId: 0x004d,
    originatorSerial: 0x778899aa,
  };

  function forwardOpenReplyFrame(): Uint8Array {
    // otId 0xAABBCCDD, echoes our toId/serial/vendor/origSerial, APIs.
    return encodeEncapsulation({
      command: EnipCommand.SendRRData,
      sessionHandle: HANDLE,
      data: encodeSendRRDataPayload(
        hexToBytes(
          "d4 00 00 00 dd cc bb aa 11 11 53 45 11 11 4d 00 aa 99 88 77 " +
            "01 40 20 00 01 40 20 00 00 00",
        ),
      ),
    });
  }

  function connectedReplyFrame(sequence: number, responseHex: string): Uint8Array {
    return encodeEncapsulation({
      command: EnipCommand.SendUnitData,
      sessionHandle: HANDLE,
      data: encodeSendUnitDataPayload(CHANNEL.originatorConnectionId, sequence, hexToBytes(responseHex)),
    });
  }

  async function openConnectedSession(): Promise<LogixSessionCore> {
    const session = await openSession();
    const opening = session.openConnected(CHANNEL);
    const frames = session.takeOutbound();
    expect(toHex(cipRequestOf(frames[0]))).toBe(
      toHex(buildForwardOpenRequest({ ...CHANNEL })),
    );
    session.receive(forwardOpenReplyFrame());
    const reply = await opening;
    expect(reply.otConnectionId).toBe(0xaabbccdd);
    expect(session.isConnectedMode).toBe(true);
    return session;
  }

  it("opens a channel and routes reads through SendUnitData with sequences", async () => {
    const session = await openConnectedSession();

    const read = session.readTag("Count");
    const frames = session.takeOutbound();
    // Frame is SendUnitData (0x70) addressed with the target-assigned O→T id.
    expect(frames[0][0] | (frames[0][1] << 8)).toBe(EnipCommand.SendUnitData);
    const payload = decodeSendUnitDataPayload(frames[0].slice(24));
    expect(payload.connectionId).toBe(0xaabbccdd);
    expect(payload.sequence).toBe(1);
    expect(toHex(payload.message)).toBe(toHex(buildReadTagRequest("Count")));

    session.receive(connectedReplyFrame(1, "cc 00 00 00 c4 00 d2 04 00 00"));
    expect((await read).value).toBe(1234);

    // Second request increments the sequence.
    const second = session.readTag("Count");
    await microtasks();
    const nextFrames = session.takeOutbound();
    expect(decodeSendUnitDataPayload(nextFrames[0].slice(24)).sequence).toBe(2);
    session.receive(connectedReplyFrame(2, "cc 00 00 00 c4 00 01 00 00 00"));
    expect((await second).value).toBe(1);
  });

  it("fails the session honestly on a sequence mismatch", async () => {
    const session = await openConnectedSession();
    const read = session.readTag("Count");
    session.takeOutbound();
    session.receive(connectedReplyFrame(99, "cc 00 00 00 c4 00 01 00 00 00"));
    await expect(read).rejects.toThrow(/sequence 99 does not match request 1/);
    expect(session.state).toBe("failed");
  });

  it("a refused Forward Open leaves the session usable over UCMM", async () => {
    const session = await openSession();
    const opening = session.openConnected(CHANNEL);
    session.takeOutbound();
    // CIP 0x01 connection failure with extended status.
    session.receive(
      encodeEncapsulation({
        command: EnipCommand.SendRRData,
        sessionHandle: HANDLE,
        data: encodeSendRRDataPayload(hexToBytes("d4 00 01 01 00 01")),
      }),
    );
    await expect(opening).rejects.toThrow(/connection failure/);
    expect(session.isConnectedMode).toBe(false);
    expect(session.state).toBe("ready");

    // Reads still flow via plain UCMM.
    const read = session.readTag("Count");
    await microtasks();
    const frames = session.takeOutbound();
    expect(frames[0][0] | (frames[0][1] << 8)).toBe(EnipCommand.SendRRData);
    session.receive(
      encodeEncapsulation({
        command: EnipCommand.SendRRData,
        sessionHandle: HANDLE,
        data: encodeSendRRDataPayload(hexToBytes("cc 00 00 00 c4 00 2a 00 00 00")),
      }),
    );
    expect((await read).value).toBe(42);
  });

  it("closeConnected sends Forward Close via UCMM and reverts routing", async () => {
    const session = await openConnectedSession();
    const closing = session.closeConnected();
    await microtasks();
    const frames = session.takeOutbound();
    expect(frames[0][0] | (frames[0][1] << 8)).toBe(EnipCommand.SendRRData); // UCMM
    expect(toHex(cipRequestOf(frames[0]))).toBe(
      toHex(
        buildForwardCloseRequest({
          connectionSerial: CHANNEL.connectionSerial,
          vendorId: CHANNEL.vendorId,
          originatorSerial: CHANNEL.originatorSerial,
        }),
      ),
    );
    session.receive(
      encodeEncapsulation({
        command: EnipCommand.SendRRData,
        sessionHandle: HANDLE,
        data: encodeSendRRDataPayload(hexToBytes("ce 00 00 00 11 11 4d 00 aa 99 88 77 00 00")),
      }),
    );
    await closing;
    expect(session.isConnectedMode).toBe(false);
  });

  it("rejects opening a second channel while one is active", async () => {
    const session = await openConnectedSession();
    await expect(session.openConnected(CHANNEL)).rejects.toThrow(/already open/);
  });
});

describe("template reads", () => {
  function ucmmReplyRaw2(responseBytes: Uint8Array, handle = HANDLE): Uint8Array {
    return encodeEncapsulation({
      command: EnipCommand.SendRRData,
      sessionHandle: handle,
      data: encodeSendRRDataPayload(responseBytes),
    });
  }

  const ATTRS_REPLY =
    "83 00 00 00 04 00 " +
    "04 00 00 00 1e 00 00 00 " + // definition size 30 words → read 99 bytes
    "05 00 00 00 08 00 00 00 " +
    "02 00 00 00 02 00 " +
    "01 00 00 00 ce 0f";

  const DEFINITION_HEX =
    "00 00 c4 00 00 00 00 00 01 00 c1 00 04 00 00 00 " +
    "4d 79 55 64 74 3b 6e 00 43 6f 75 6e 74 00 46 6c 61 67 00";

  it("reads attributes then pages the definition until complete", async () => {
    const session = await openSession();
    const promise = session.readTemplate(0x123);

    // 1) attributes request
    const attrFrames = session.takeOutbound();
    expect(toHex(cipRequestOf(attrFrames[0]))).toBe(
      "03 03 20 6c 25 00 23 01 04 00 04 00 05 00 02 00 01 00",
    );
    session.receive(ucmmReplyRaw2(hexToBytes(ATTRS_REPLY)));
    await microtasks();

    // 2) first definition read: offset 0, full 99 bytes requested
    const readFrames = session.takeOutbound();
    expect(toHex(cipRequestOf(readFrames[0]))).toBe(
      "4c 03 20 6c 25 00 23 01 00 00 00 00 63 00",
    );
    const definition = hexToBytes(DEFINITION_HEX);
    // Reply with the first 16 bytes as a partial transfer…
    session.receive(
      ucmmReplyRaw2(concatBytes([hexToBytes("cc 00 06 00"), definition.slice(0, 16)])),
    );
    await microtasks();

    // 3) continuation: offset 16, remaining 83 bytes
    const continueFrames = session.takeOutbound();
    expect(toHex(cipRequestOf(continueFrames[0]))).toBe(
      "4c 03 20 6c 25 00 23 01 10 00 00 00 53 00",
    );
    session.receive(
      ucmmReplyRaw2(concatBytes([hexToBytes("cc 00 00 00"), definition.slice(16)])),
    );

    const template = await promise;
    expect(template.name).toBe("MyUdt");
    expect(template.structureHandle).toBe(0x0fce);
    expect(template.members.map((member) => member.name)).toEqual(["Count", "Flag"]);
  });

  it("rejects when a definition read makes no progress", async () => {
    const session = await openSession();
    const promise = session.readTemplate(0x123);
    session.takeOutbound();
    session.receive(ucmmReplyRaw2(hexToBytes(ATTRS_REPLY)));
    await microtasks();
    session.takeOutbound();
    session.receive(ucmmReplyRaw2(hexToBytes("cc 00 06 00"))); // partial, zero bytes
    await expect(promise).rejects.toThrow(/no progress/);
  });
});

describe("tag browsing", () => {
  it("follows tag-list pagination to the end", async () => {
    const session = await openSession();
    const tags = session.listTags();
    session.takeOutbound();

    // Page 1: partial, instances 1 ("Pump") and 10 ("Tank1" struct).
    session.receive(
      ucmmReply(
        "d5 00 06 00 01 00 00 00 04 00 50 75 6d 70 c4 00 0a 00 00 00 05 00 54 61 6e 6b 31 23 a1",
      ),
    );
    await microtasks();
    const pageTwoFrames = session.takeOutbound();
    expect(toHex(cipRequestOf(pageTwoFrames[0]))).toBe(toHex(buildTagListRequest(11)));

    // Page 2: final, instance 12 ("Flag").
    session.receive(ucmmReply("d5 00 00 00 0c 00 00 00 04 00 46 6c 61 67 c1 00"));
    const symbols = await tags;
    expect(symbols.map((symbol) => symbol.name)).toEqual(["Pump", "Tank1", "Flag"]);
  });

  it("browseAllTags recurses into program scopes", async () => {
    const session = await openSession();
    const browse = session.browseAllTags();
    session.takeOutbound();

    // Controller scope: a program symbol and one controller tag.
    session.receive(
      ucmmReply(
        "d5 00 00 00 05 00 00 00 0c 00 50 72 6f 67 72 61 6d 3a 4d 61 69 6e 68 80 01 00 00 00 04 00 50 75 6d 70 c4 00",
      ),
    );
    await microtasks();
    const programFrames = session.takeOutbound();
    expect(toHex(cipRequestOf(programFrames[0]))).toBe(
      toHex(buildTagListRequest(0, "Program:Main")),
    );

    // Program scope: one BOOL tag.
    session.receive(ucmmReply("d5 00 00 00 02 00 00 00 04 00 46 6c 61 67 c1 00"));
    const result = await browse;
    expect(result.controller.map((symbol) => symbol.name)).toEqual(["Program:Main", "Pump"]);
    expect(Object.keys(result.programs)).toEqual(["Program:Main"]);
    expect(result.programs["Program:Main"][0].name).toBe("Flag");
  });
});

describe("identity", () => {
  it("reads the Identity object over UCMM", async () => {
    const session = await openSession();
    const identity = session.readIdentityObject();
    session.takeOutbound();
    session.receive(
      ucmmReply("81 00 00 00 01 00 0e 00 96 00 21 0b 00 00 78 56 34 12 09 31 37 36 39 2d 4c 33 33 45"),
    );
    const result = await identity;
    expect(result.productName).toBe("1769-L33E");
    expect(result.vendorName).toBe("Rockwell Automation/Allen-Bradley");
    expect(result.faulted).toBe(false);
  });

  it("parses a ListIdentity reply through the same pipeline", async () => {
    const session = await openSession();
    const info = session.listIdentity();
    session.takeOutbound();
    session.receive(
      encodeEncapsulation({
        command: EnipCommand.ListIdentity,
        data: encodeCpf([
          {
            typeId: CpfItemType.ListIdentityResponse,
            data: hexToBytes(
              "01 00 00 02 af 12 c0 a8 01 0a 00 00 00 00 00 00 00 00 " +
                "01 00 0e 00 96 00 21 0b 60 00 78 56 34 12 09 31 37 36 39 2d 4c 33 33 45 03",
            ),
          },
        ]),
      }),
    );
    const result = await info;
    expect(result.productName).toBe("1769-L33E");
    expect(result.state).toBe(3);
  });
});
