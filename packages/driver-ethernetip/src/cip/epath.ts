/**
 * CIP EPATH (padded path) codec: logical segments for object addressing,
 * ANSI extended symbolic segments for Logix tag names, member segments for
 * array elements, and simple port segments for backplane routing.
 *
 * PURE byte codec; no I/O. Written from public CIP segment encoding rules.
 */

import { ByteWriter } from "../bytes";

export type EpathSegment =
  | { kind: "class"; value: number }
  | { kind: "instance"; value: number }
  | { kind: "attribute"; value: number }
  /** Logical member segment — used for array element indices in tag paths. */
  | { kind: "member"; value: number }
  /** ANSI extended symbolic segment — a Logix tag/program/structure name. */
  | { kind: "symbol"; name: string }
  /** Simple port segment (port ≤ 14, one-byte link address), e.g. backplane/slot. */
  | { kind: "port"; port: number; link: number };

export const classSegment = (value: number): EpathSegment => ({ kind: "class", value });
export const instanceSegment = (value: number): EpathSegment => ({ kind: "instance", value });
export const attributeSegment = (value: number): EpathSegment => ({ kind: "attribute", value });
export const memberSegment = (value: number): EpathSegment => ({ kind: "member", value });
export const symbolSegment = (name: string): EpathSegment => ({ kind: "symbol", name });
export const portSegment = (port: number, link: number): EpathSegment => ({ kind: "port", port, link });

export interface EncodedEpath {
  /** Raw padded-path bytes (always an even count). */
  path: Uint8Array;
  /** Path length in 16-bit words, as CIP requests express it. */
  wordCount: number;
}

export function encodePaddedEpath(segments: readonly EpathSegment[]): EncodedEpath {
  const writer = new ByteWriter();
  for (const segment of segments) {
    switch (segment.kind) {
      case "class":
        writeLogical(writer, 0x20, segment.value, "class", false);
        break;
      case "instance":
        writeLogical(writer, 0x24, segment.value, "instance", true);
        break;
      case "attribute":
        writeLogical(writer, 0x30, segment.value, "attribute", false);
        break;
      case "member":
        writeLogical(writer, 0x28, segment.value, "member", true);
        break;
      case "symbol":
        writeSymbol(writer, segment.name);
        break;
      case "port":
        writePort(writer, segment.port, segment.link);
        break;
    }
  }
  const path = writer.toBytes();
  // Every segment encoder above pads to an even byte count, so this cannot
  // fire unless a new segment kind forgets to.
  if (path.length % 2 !== 0) {
    throw new RangeError(`internal: padded EPATH ended on an odd byte count (${path.length})`);
  }
  return { path, wordCount: path.length / 2 };
}

function writeLogical(
  writer: ByteWriter,
  baseByte: number,
  value: number,
  label: string,
  allow32Bit: boolean,
): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${label} segment value must be a non-negative integer, got ${value}`);
  }
  if (value <= 0xff) {
    writer.u8(baseByte).u8(value);
  } else if (value <= 0xffff) {
    // 16-bit logical format: segment byte | 0x01, pad byte, then u16.
    writer.u8(baseByte | 0x01).u8(0x00).u16(value);
  } else if (allow32Bit && value <= 0xffff_ffff) {
    writer.u8(baseByte | 0x02).u8(0x00).u32(value);
  } else {
    throw new RangeError(`${label} segment value ${value} exceeds the encodable range`);
  }
}

function writeSymbol(writer: ByteWriter, name: string): void {
  if (name.length === 0) {
    throw new RangeError("symbolic segment name must not be empty");
  }
  if (name.length > 0xff) {
    throw new RangeError(`symbolic segment name exceeds 255 characters: ${name.length}`);
  }
  writer.u8(0x91); // ANSI extended symbolic segment
  writer.u8(name.length);
  writer.ascii(name);
  if (name.length % 2 !== 0) writer.u8(0x00); // pad to a word boundary
}

function writePort(writer: ByteWriter, port: number, link: number): void {
  if (!Number.isInteger(port) || port < 1 || port > 14) {
    throw new RangeError(`simple port segment supports ports 1..14, got ${port}`);
  }
  if (!Number.isInteger(link) || link < 0 || link > 0xff) {
    throw new RangeError(`simple port segment link address must be 0..255, got ${link}`);
  }
  writer.u8(port).u8(link);
}

/**
 * Parses a Logix tag address into EPATH segments.
 *
 * Supported forms:
 *   "Motor1"                              — controller-scope tag
 *   "Program:MainProgram.RunCmd"          — program-scope tag
 *   "Recipe.Steps[3].Setpoint"            — nested members and array elements
 *   "Grid[1,2]"                           — multi-dimensional elements
 *
 * NOT yet supported (rejected, not silently mangled): bit-level addressing
 * ("Word.3") — bit extraction belongs to the value layer, not the path.
 */
export function tagAddressToSegments(tagAddress: string): EpathSegment[] {
  const trimmed = tagAddress.trim();
  if (trimmed.length === 0) {
    throw new RangeError("tag address must not be empty");
  }
  const segments: EpathSegment[] = [];
  for (const part of splitTagAddress(trimmed)) {
    const match = /^([A-Za-z_:][A-Za-z0-9_:]*)((?:\[\d+(?:,\d+)*\])?)$/.exec(part);
    if (!match) {
      if (/^\d+$/.test(part)) {
        throw new RangeError(
          `bit-level member ".${part}" is not supported in tag paths yet — read the parent word instead`,
        );
      }
      throw new RangeError(`invalid tag path component ${JSON.stringify(part)} in ${JSON.stringify(tagAddress)}`);
    }
    const [, name, subscript] = match;
    segments.push(symbolSegment(name));
    if (subscript) {
      for (const index of subscript.slice(1, -1).split(",")) {
        segments.push(memberSegment(Number.parseInt(index, 10)));
      }
    }
  }
  return segments;
}

function splitTagAddress(address: string): string[] {
  const parts = address.split(".");
  if (parts.some((part) => part.length === 0)) {
    throw new RangeError(`tag address has an empty component: ${JSON.stringify(address)}`);
  }
  return parts;
}
