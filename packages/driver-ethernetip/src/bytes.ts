/**
 * Little-endian byte cursor helpers for the ESCO EtherNet/IP / CIP codecs.
 *
 * CIP and the EtherNet/IP encapsulation layer encode multi-byte integers
 * little-endian unless a field explicitly says otherwise (the only big-endian
 * field this package touches is the sockaddr blob inside ListIdentity items).
 *
 * Pure `Uint8Array`/`DataView` — no Node `Buffer`, no I/O, no platform APIs —
 * so every codec built on top stays deterministic and unit-testable anywhere.
 */

/** Growable little-endian writer. `toBytes()` returns a copy of the written region. */
export class ByteWriter {
  private buf: Uint8Array;
  private view: DataView;
  private len = 0;

  constructor(initialCapacity = 64) {
    this.buf = new Uint8Array(Math.max(initialCapacity, 8));
    this.view = new DataView(this.buf.buffer);
  }

  get length(): number {
    return this.len;
  }

  private ensure(extra: number): void {
    if (this.len + extra <= this.buf.length) return;
    let next = this.buf.length * 2;
    while (next < this.len + extra) next *= 2;
    const grown = new Uint8Array(next);
    grown.set(this.buf.subarray(0, this.len));
    this.buf = grown;
    this.view = new DataView(grown.buffer);
  }

  u8(value: number): this {
    assertUint(value, 0xff, "u8");
    this.ensure(1);
    this.view.setUint8(this.len, value);
    this.len += 1;
    return this;
  }

  u16(value: number): this {
    assertUint(value, 0xffff, "u16");
    this.ensure(2);
    this.view.setUint16(this.len, value, true);
    this.len += 2;
    return this;
  }

  u32(value: number): this {
    assertUint(value, 0xffff_ffff, "u32");
    this.ensure(4);
    this.view.setUint32(this.len, value, true);
    this.len += 4;
    return this;
  }

  bytes(data: Uint8Array | readonly number[]): this {
    const src = data instanceof Uint8Array ? data : Uint8Array.from(data);
    this.ensure(src.length);
    this.buf.set(src, this.len);
    this.len += src.length;
    return this;
  }

  /** Writes raw ASCII characters (no length prefix). Throws on non-ASCII input. */
  ascii(text: string): this {
    this.ensure(text.length);
    for (let i = 0; i < text.length; i += 1) {
      const code = text.charCodeAt(i);
      if (code > 0x7f) {
        throw new RangeError(`ascii: non-ASCII character ${JSON.stringify(text[i])} at index ${i}`);
      }
      this.buf[this.len] = code;
      this.len += 1;
    }
    return this;
  }

  toBytes(): Uint8Array {
    return this.buf.slice(0, this.len);
  }
}

/** Bounds-checked little-endian reader over an immutable byte window. */
export class ByteReader {
  private pos: number;

  constructor(
    private readonly data: Uint8Array,
    offset = 0,
  ) {
    if (offset < 0 || offset > data.length) {
      throw new RangeError(`ByteReader: offset ${offset} outside buffer of ${data.length} bytes`);
    }
    this.pos = offset;
  }

  get position(): number {
    return this.pos;
  }

  remaining(): number {
    return this.data.length - this.pos;
  }

  private take(count: number, what: string): number {
    if (count > this.remaining()) {
      throw new RangeError(
        `ByteReader: needed ${count} byte(s) for ${what} at offset ${this.pos}, only ${this.remaining()} remain`,
      );
    }
    const at = this.pos;
    this.pos += count;
    return at;
  }

  u8(): number {
    const at = this.take(1, "u8");
    return this.data[at];
  }

  u16(): number {
    const at = this.take(2, "u16");
    return new DataView(this.data.buffer, this.data.byteOffset + at, 2).getUint16(0, true);
  }

  u32(): number {
    const at = this.take(4, "u32");
    return new DataView(this.data.buffer, this.data.byteOffset + at, 4).getUint32(0, true);
  }

  i8(): number {
    const at = this.take(1, "i8");
    return new DataView(this.data.buffer, this.data.byteOffset + at, 1).getInt8(0);
  }

  i16(): number {
    const at = this.take(2, "i16");
    return new DataView(this.data.buffer, this.data.byteOffset + at, 2).getInt16(0, true);
  }

  i32(): number {
    const at = this.take(4, "i32");
    return new DataView(this.data.buffer, this.data.byteOffset + at, 4).getInt32(0, true);
  }

  i64(): bigint {
    const at = this.take(8, "i64");
    return new DataView(this.data.buffer, this.data.byteOffset + at, 8).getBigInt64(0, true);
  }

  u64(): bigint {
    const at = this.take(8, "u64");
    return new DataView(this.data.buffer, this.data.byteOffset + at, 8).getBigUint64(0, true);
  }

  f32(): number {
    const at = this.take(4, "f32");
    return new DataView(this.data.buffer, this.data.byteOffset + at, 4).getFloat32(0, true);
  }

  f64(): number {
    const at = this.take(8, "f64");
    return new DataView(this.data.buffer, this.data.byteOffset + at, 8).getFloat64(0, true);
  }

  bytes(count: number): Uint8Array {
    const at = this.take(count, "bytes");
    return this.data.slice(at, at + count);
  }

  ascii(count: number): string {
    const at = this.take(count, "ascii");
    let out = "";
    for (let i = 0; i < count; i += 1) out += String.fromCharCode(this.data[at + i]);
    return out;
  }

  skip(count: number): void {
    this.take(count, "skip");
  }

  /** Remaining bytes as a copy, without advancing. */
  rest(): Uint8Array {
    return this.data.slice(this.pos);
  }
}

function assertUint(value: number, max: number, label: string): void {
  if (!Number.isInteger(value) || value < 0 || value > max) {
    throw new RangeError(`${label}: value ${value} out of range 0..${max}`);
  }
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/** Hex dump (lowercase, space-separated) used by tests and error messages. */
export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(" ");
}

export function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
