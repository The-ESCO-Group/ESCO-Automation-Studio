import { describe, expect, it } from "vitest";
import { toHex } from "../bytes";
import { hexToBytes } from "../testing/hex";
import {
  EnipCommand,
  EnipStatus,
  decodeEncapsulation,
  decodeRegisterSessionReply,
  encodeEncapsulation,
  encodeListIdentityRequest,
  encodeRegisterSessionRequest,
  encodeUnregisterSessionRequest,
  enipStatusMessage,
} from "./encapsulation";

const REGISTER_SESSION_REQUEST =
  "65 00 04 00 00 00 00 00 00 00 00 00 " + // command, length, session, status
  "00 00 00 00 00 00 00 00 " + // sender context
  "00 00 00 00 " + // options
  "01 00 00 00"; // protocol version 1, option flags 0

describe("encapsulation codec", () => {
  it("encodes a RegisterSession request to the golden bytes", () => {
    expect(toHex(encodeRegisterSessionRequest())).toBe(REGISTER_SESSION_REQUEST);
  });

  it("round-trips an arbitrary packet", () => {
    const context = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]);
    const data = hexToBytes("aa bb");
    const packet = decodeEncapsulation(
      encodeEncapsulation({
        command: EnipCommand.SendRRData,
        sessionHandle: 0x11223344,
        senderContext: context,
        data,
      }),
    );
    expect(packet.command).toBe(EnipCommand.SendRRData);
    expect(packet.sessionHandle).toBe(0x11223344);
    expect(packet.status).toBe(0);
    expect(toHex(packet.senderContext)).toBe("01 02 03 04 05 06 07 08");
    expect(toHex(packet.data)).toBe("aa bb");
  });

  it("decodes a RegisterSession reply and surfaces the session handle", () => {
    const reply = decodeEncapsulation(
      encodeEncapsulation({
        command: EnipCommand.RegisterSession,
        sessionHandle: 0xdeadbeef,
        data: hexToBytes("01 00 00 00"),
      }),
    );
    const session = decodeRegisterSessionReply(reply);
    expect(session.sessionHandle).toBe(0xdeadbeef);
    expect(session.protocolVersion).toBe(1);
    expect(session.optionFlags).toBe(0);
  });

  it("rejects a RegisterSession reply with a failure status", () => {
    const reply = decodeEncapsulation(
      encodeEncapsulation({
        command: EnipCommand.RegisterSession,
        status: EnipStatus.UnsupportedProtocolVersion,
        data: hexToBytes("01 00 00 00"),
      }),
    );
    expect(() => decodeRegisterSessionReply(reply)).toThrow(/unsupported encapsulation protocol/);
  });

  it("encodes UnregisterSession and ListIdentity with empty bodies", () => {
    const unregister = decodeEncapsulation(encodeUnregisterSessionRequest(0x42));
    expect(unregister.command).toBe(EnipCommand.UnregisterSession);
    expect(unregister.sessionHandle).toBe(0x42);
    expect(unregister.data.length).toBe(0);

    const listIdentity = decodeEncapsulation(encodeListIdentityRequest());
    expect(listIdentity.command).toBe(EnipCommand.ListIdentity);
    expect(listIdentity.data.length).toBe(0);
  });

  it("rejects malformed packets", () => {
    expect(() => decodeEncapsulation(hexToBytes("65 00"))).toThrow(/at least 24/);
    // Header advertises 4 data bytes but only 2 follow.
    const bad = hexToBytes(REGISTER_SESSION_REQUEST).slice(0, 26);
    expect(() => decodeEncapsulation(bad)).toThrow(/advertises 4 data byte/);
    expect(() =>
      encodeEncapsulation({ command: 0x65, senderContext: new Uint8Array(7) }),
    ).toThrow(/exactly 8 bytes/);
  });

  it("names known statuses and falls back for unknown ones", () => {
    expect(enipStatusMessage(EnipStatus.InvalidSessionHandle)).toBe("invalid session handle");
    expect(enipStatusMessage(0x1234)).toContain("0x1234");
  });
});
