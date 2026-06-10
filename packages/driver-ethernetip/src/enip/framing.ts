/**
 * TCP stream framer for EtherNet/IP encapsulation packets.
 *
 * TCP delivers a byte stream, not message boundaries: one socket "data" event
 * may carry half a packet, one packet, or several packets plus a fragment.
 * This framer accumulates bytes and emits only complete encapsulation packets.
 *
 * PURE: no sockets here — the backend transport feeds chunks in.
 */

import { concatBytes } from "../bytes";
import {
  ENIP_HEADER_SIZE,
  decodeEncapsulation,
  type EncapsulationPacket,
} from "./encapsulation";

export class EnipStreamFramer {
  private pending: Uint8Array = new Uint8Array(0);

  /** Bytes buffered while waiting for the rest of a partial packet. */
  get bufferedBytes(): number {
    return this.pending.length;
  }

  /** Feeds a received chunk; returns every packet completed by it (possibly none). */
  feed(chunk: Uint8Array): EncapsulationPacket[] {
    this.pending = this.pending.length === 0 ? chunk.slice() : concatBytes([this.pending, chunk]);
    const packets: EncapsulationPacket[] = [];
    for (;;) {
      if (this.pending.length < ENIP_HEADER_SIZE) break;
      // Data length lives at byte offset 2 of the header, little-endian u16.
      const dataLength = this.pending[2] | (this.pending[3] << 8);
      const total = ENIP_HEADER_SIZE + dataLength;
      if (this.pending.length < total) break;
      packets.push(decodeEncapsulation(this.pending.slice(0, total)));
      this.pending = this.pending.slice(total);
    }
    return packets;
  }

  /** Drops any partial frame (call when the connection resets). */
  reset(): void {
    this.pending = new Uint8Array(0);
  }
}
