/**
 * TEST-ONLY in-process fake EtherNet/IP target, built from the ESCO codecs in
 * `@esco/driver-ethernetip` (server side of the same public-spec protocol).
 *
 * It exists so the TCP transport can be exercised over real loopback sockets
 * without any hardware or vendor software. IT IS NOT A CONTROLLER EMULATOR —
 * it answers with exactly the canned CIP responses a test scripts, nothing
 * more. Passing against it proves transport mechanics only, never hardware
 * validation (`verified` stays false everywhere).
 */

import { createServer, type Server, type Socket } from "node:net";
import {
  ByteReader,
  ByteWriter,
  EnipCommand,
  EnipStreamFramer,
  SERVICE_FORWARD_CLOSE,
  SERVICE_FORWARD_OPEN,
  SERVICE_LARGE_FORWARD_OPEN,
  encodeCpf,
  encodeEncapsulation,
  encodeSendRRDataPayload,
  encodeSendUnitDataPayload,
  decodeSendRRDataPayload,
  decodeSendUnitDataPayload,
  extractUnconnectedData,
  type EncapsulationPacket,
} from "@esco/driver-ethernetip";

export interface FakeLogixServerOptions {
  /**
   * Maps one CIP message-router request to its response bytes. Return
   * `undefined` to send no reply (for timeout tests).
   */
  handleCip: (request: Uint8Array) => Uint8Array | undefined;
  /** Session handle the fake target assigns. */
  sessionHandle?: number;
  /** Encapsulation status for the RegisterSession reply (0 = success). */
  registerStatus?: number;
  /** Raw CPF item data for ListIdentity replies (type 0x000c). */
  listIdentityItem?: Uint8Array;
  /** When set, replies are written in two chunks to exercise stream framing. */
  splitReplies?: boolean;
}

export class FakeLogixServer {
  private server: Server | undefined;
  private readonly sockets = new Set<Socket>();
  /** Every CIP request the server saw, in order (the embedded message-router request). */
  readonly cipRequests: Uint8Array[] = [];
  /** Encapsulation commands received, in order (for unregister assertions). */
  readonly commands: number[] = [];
  /** Forward Open count — lets tests assert connected mode was negotiated. */
  forwardOpenCount = 0;
  forwardCloseCount = 0;
  /** Active connected channel: target-assigned O→T id ↔ originator T→O id. */
  private connection: { otId: number; toId: number } | undefined;
  private nextOtId = 0x1a2b0001;

  constructor(private readonly options: FakeLogixServerOptions) {}

  /** Starts listening on 127.0.0.1 (ephemeral by default); resolves with the port. */
  listen(port = 0): Promise<number> {
    const server = createServer((socket) => this.serve(socket));
    this.server = server;
    return new Promise<number>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", () => {
        const address = server.address();
        if (address === null || typeof address === "string") {
          reject(new Error("fake server has no TCP address"));
          return;
        }
        resolve(address.port);
      });
    });
  }

  close(): Promise<void> {
    for (const socket of this.sockets) socket.destroy();
    this.sockets.clear();
    const server = this.server;
    this.server = undefined;
    if (!server) return Promise.resolve();
    return new Promise((resolve) => server.close(() => resolve()));
  }

  /** Destroys live connections without closing the listener (drop tests). */
  dropConnections(): void {
    for (const socket of this.sockets) socket.destroy();
    this.sockets.clear();
  }

  private serve(socket: Socket): void {
    this.sockets.add(socket);
    socket.on("close", () => this.sockets.delete(socket));
    const framer = new EnipStreamFramer();
    socket.on("data", (chunk: Uint8Array) => {
      for (const packet of framer.feed(chunk)) {
        this.commands.push(packet.command);
        const reply = this.replyFor(packet);
        if (reply) this.write(socket, reply);
      }
    });
  }

  private replyFor(packet: EncapsulationPacket): Uint8Array | undefined {
    switch (packet.command) {
      case EnipCommand.RegisterSession:
        return encodeEncapsulation({
          command: EnipCommand.RegisterSession,
          sessionHandle: this.options.sessionHandle ?? 0x0badcafe,
          status: this.options.registerStatus ?? 0,
          data: packet.data, // echo protocol version + option flags
        });
      case EnipCommand.ListIdentity: {
        const item = this.options.listIdentityItem;
        return encodeEncapsulation({
          command: EnipCommand.ListIdentity,
          data: encodeCpf(item ? [{ typeId: 0x000c, data: item }] : []),
        });
      }
      case EnipCommand.SendRRData: {
        const payload = decodeSendRRDataPayload(packet.data);
        const request = extractUnconnectedData(payload.items);
        // Forward Open / Forward Close are connection-management requests, not
        // tag traffic — answer them directly so connected mode is testable.
        const managed = this.maybeHandleConnectionManagement(request);
        if (managed) {
          return encodeEncapsulation({
            command: EnipCommand.SendRRData,
            sessionHandle: packet.sessionHandle,
            data: encodeSendRRDataPayload(managed),
          });
        }
        this.cipRequests.push(request);
        const response = this.options.handleCip(request);
        if (!response) return undefined;
        return encodeEncapsulation({
          command: EnipCommand.SendRRData,
          sessionHandle: packet.sessionHandle,
          data: encodeSendRRDataPayload(response),
        });
      }
      case EnipCommand.SendUnitData: {
        // Connected (class-3) request: unwrap, run the embedded message-router
        // request through handleCip, echo the sequence back.
        const { connectionId, sequence, message } = decodeSendUnitDataPayload(packet.data);
        this.cipRequests.push(message);
        const response = this.options.handleCip(message);
        if (!response) return undefined;
        const replyConnId = this.connection?.toId ?? connectionId;
        return encodeEncapsulation({
          command: EnipCommand.SendUnitData,
          sessionHandle: packet.sessionHandle,
          data: encodeSendUnitDataPayload(replyConnId, sequence, response),
        });
      }
      case EnipCommand.UnregisterSession:
        socketEndSoon(this.sockets, packet); // protocol: peer just closes
        return undefined;
      default:
        return undefined;
    }
  }

  /**
   * Answers Forward Open / Forward Close if `request` is one; returns the
   * message-router response bytes, or undefined to fall through to handleCip.
   */
  private maybeHandleConnectionManagement(request: Uint8Array): Uint8Array | undefined {
    const service = request[0] & 0x7f;
    if (service !== SERVICE_FORWARD_OPEN && service !== SERVICE_LARGE_FORWARD_OPEN && service !== SERVICE_FORWARD_CLOSE) {
      return undefined;
    }
    const reader = new ByteReader(request);
    reader.u8(); // service
    const pathWords = reader.u8();
    reader.skip(pathWords * 2); // EPATH to Connection Manager
    reader.u8(); // priority/time_tick
    reader.u8(); // timeout ticks

    if (service === SERVICE_FORWARD_CLOSE) {
      const connectionSerial = reader.u16();
      const vendorId = reader.u16();
      const originatorSerial = reader.u32();
      this.forwardCloseCount += 1;
      this.connection = undefined;
      const data = new ByteWriter(8);
      data.u16(connectionSerial).u16(vendorId).u32(originatorSerial);
      return messageRouterResponse(SERVICE_FORWARD_CLOSE, data.toBytes());
    }

    // Forward Open: read the fields we must echo, assign an O→T id.
    reader.u32(); // O→T id in request is 0
    const toConnectionId = reader.u32();
    const connectionSerial = reader.u16();
    const vendorId = reader.u16();
    const originatorSerial = reader.u32();
    const otConnectionId = this.nextOtId++;
    this.connection = { otId: otConnectionId, toId: toConnectionId };
    this.forwardOpenCount += 1;

    const data = new ByteWriter(26);
    data.u32(otConnectionId);
    data.u32(toConnectionId);
    data.u16(connectionSerial);
    data.u16(vendorId);
    data.u32(originatorSerial);
    data.u32(0x00204001); // O→T API granted
    data.u32(0x00204001); // T→O API granted
    data.u8(0); // application reply size (words)
    data.u8(0); // reserved
    return messageRouterResponse(service, data.toBytes());
  }

  private write(socket: Socket, frame: Uint8Array): void {
    if (this.options.splitReplies && frame.length > 4) {
      const mid = Math.floor(frame.length / 2);
      socket.write(frame.slice(0, mid));
      // Flush the tail on the next tick so the client genuinely sees two
      // TCP segments and must reassemble.
      setImmediate(() => {
        if (!socket.destroyed) socket.write(frame.slice(mid));
      });
      return;
    }
    socket.write(frame);
  }
}

/** Wraps reply data in a CIP message-router response (reply service, 0 status). */
function messageRouterResponse(service: number, data: Uint8Array): Uint8Array {
  const writer = new ByteWriter(4 + data.length);
  writer.u8(service | 0x80);
  writer.u8(0x00); // reserved
  writer.u8(0x00); // general status: success
  writer.u8(0x00); // additional status words
  writer.bytes(data);
  return writer.toBytes();
}

function socketEndSoon(sockets: Set<Socket>, _packet: EncapsulationPacket): void {
  // The real protocol closes the TCP connection on UnregisterSession; tests
  // assert via `commands`, and the client is already ending its side.
  for (const socket of sockets) {
    setImmediate(() => socket.end());
  }
}
