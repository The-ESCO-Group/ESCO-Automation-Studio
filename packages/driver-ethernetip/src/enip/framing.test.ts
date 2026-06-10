import { describe, expect, it } from "vitest";
import { concatBytes } from "../bytes";
import { EnipStreamFramer } from "./framing";
import { EnipCommand, encodeEncapsulation, encodeRegisterSessionRequest } from "./encapsulation";
import { hexToBytes } from "../testing/hex";

describe("EnipStreamFramer", () => {
  it("reassembles packets split across arbitrary chunk boundaries", () => {
    const first = encodeRegisterSessionRequest(); // 28 bytes
    const second = encodeEncapsulation({
      command: EnipCommand.SendRRData,
      sessionHandle: 7,
      data: hexToBytes("01 02 03"),
    }); // 27 bytes
    const stream = concatBytes([first, second]);

    const framer = new EnipStreamFramer();
    expect(framer.feed(stream.slice(0, 10))).toHaveLength(0);
    expect(framer.bufferedBytes).toBe(10);

    const fromSecondChunk = framer.feed(stream.slice(10, 40));
    expect(fromSecondChunk).toHaveLength(1);
    expect(fromSecondChunk[0].command).toBe(EnipCommand.RegisterSession);

    const fromThirdChunk = framer.feed(stream.slice(40));
    expect(fromThirdChunk).toHaveLength(1);
    expect(fromThirdChunk[0].command).toBe(EnipCommand.SendRRData);
    expect(fromThirdChunk[0].sessionHandle).toBe(7);
    expect(framer.bufferedBytes).toBe(0);
  });

  it("emits multiple packets from a single chunk", () => {
    const packet = encodeRegisterSessionRequest();
    const framer = new EnipStreamFramer();
    const packets = framer.feed(concatBytes([packet, packet, packet]));
    expect(packets).toHaveLength(3);
  });

  it("reset drops a partial frame", () => {
    const framer = new EnipStreamFramer();
    framer.feed(encodeRegisterSessionRequest().slice(0, 12));
    expect(framer.bufferedBytes).toBe(12);
    framer.reset();
    expect(framer.bufferedBytes).toBe(0);
    // A fresh, complete packet still parses after the reset.
    expect(framer.feed(encodeRegisterSessionRequest())).toHaveLength(1);
  });
});
