/**
 * CIP elementary data type decoding for tag reads.
 *
 * Read Tag replies open with a u16 type code: an elementary CIP type code for
 * atomics, or the structure marker 0x02A0 followed by a u16 structure handle
 * (template instance CRC) for structures. The Logix STRING family is the one
 * structure this read-only scaffold decodes today; unknown structures are
 * surfaced as raw bytes — honestly undecoded, never guessed.
 *
 * PURE byte codec; no I/O. Decoding only: this package builds no tag-write
 * payloads by design (read-only milestone).
 */

import { ByteReader } from "../bytes";

export const CipType = {
  BOOL: 0xc1,
  SINT: 0xc2,
  INT: 0xc3,
  DINT: 0xc4,
  LINT: 0xc5,
  USINT: 0xc6,
  UINT: 0xc7,
  UDINT: 0xc8,
  ULINT: 0xc9,
  REAL: 0xca,
  LREAL: 0xcb,
  BYTE: 0xd1,
  WORD: 0xd2,
  DWORD: 0xd3,
  LWORD: 0xd4,
} as const;

/** Marker type code introducing a structure value in a Read Tag reply. */
export const STRUCTURE_TYPE_CODE = 0x02a0;

/** Structure handle of the standard Logix STRING (DINT LEN + SINT[82] DATA). */
export const LOGIX_STRING_STRUCTURE_HANDLE = 0x0fce;

const TYPE_NAMES: Readonly<Record<number, string>> = {
  [CipType.BOOL]: "BOOL",
  [CipType.SINT]: "SINT",
  [CipType.INT]: "INT",
  [CipType.DINT]: "DINT",
  [CipType.LINT]: "LINT",
  [CipType.USINT]: "USINT",
  [CipType.UINT]: "UINT",
  [CipType.UDINT]: "UDINT",
  [CipType.ULINT]: "ULINT",
  [CipType.REAL]: "REAL",
  [CipType.LREAL]: "LREAL",
  [CipType.BYTE]: "BYTE",
  [CipType.WORD]: "WORD",
  [CipType.DWORD]: "DWORD",
  [CipType.LWORD]: "LWORD",
};

export function cipTypeName(typeCode: number): string {
  if (typeCode === STRUCTURE_TYPE_CODE) return "STRUCT";
  return TYPE_NAMES[typeCode] ?? `0x${typeCode.toString(16).padStart(4, "0")}`;
}

const SCALAR_SIZES: Readonly<Record<number, number>> = {
  [CipType.BOOL]: 1,
  [CipType.SINT]: 1,
  [CipType.INT]: 2,
  [CipType.DINT]: 4,
  [CipType.LINT]: 8,
  [CipType.USINT]: 1,
  [CipType.UINT]: 2,
  [CipType.UDINT]: 4,
  [CipType.ULINT]: 8,
  [CipType.REAL]: 4,
  [CipType.LREAL]: 8,
  [CipType.BYTE]: 1,
  [CipType.WORD]: 2,
  [CipType.DWORD]: 4,
  [CipType.LWORD]: 8,
};

/** Byte size of one element of an atomic type, or undefined when unknown. */
export function cipScalarSize(typeCode: number): number | undefined {
  return SCALAR_SIZES[typeCode];
}

export type CipScalar = number | bigint | boolean | string;

export interface DecodedTagValue {
  /** Elementary type code, or {@link STRUCTURE_TYPE_CODE} for structures. */
  typeCode: number;
  typeName: string;
  /** Present only for structures. */
  structureHandle?: number;
  /**
   * Decoded value: a scalar for one element, an array for multi-element atomic
   * reads, a string for Logix STRINGs, or raw bytes for structures this
   * scaffold cannot decode yet.
   */
  value: CipScalar | readonly CipScalar[] | Uint8Array;
  elementCount: number;
}

function decodeScalar(typeCode: number, reader: ByteReader): CipScalar {
  switch (typeCode) {
    case CipType.BOOL:
      return reader.u8() !== 0;
    case CipType.SINT:
      return reader.i8();
    case CipType.INT:
      return reader.i16();
    case CipType.DINT:
      return reader.i32();
    case CipType.LINT:
      return reader.i64();
    case CipType.USINT:
    case CipType.BYTE:
      return reader.u8();
    case CipType.UINT:
    case CipType.WORD:
      return reader.u16();
    case CipType.UDINT:
    case CipType.DWORD:
      return reader.u32();
    case CipType.ULINT:
    case CipType.LWORD:
      return reader.u64();
    case CipType.REAL:
      return reader.f32();
    case CipType.LREAL:
      return reader.f64();
    default:
      throw new RangeError(`no scalar decoder for CIP type ${cipTypeName(typeCode)}`);
  }
}

/**
 * Decodes the typed payload of a Read Tag reply (type code prefix included).
 */
export function decodeTypedValue(bytes: Uint8Array): DecodedTagValue {
  const reader = new ByteReader(bytes);
  const typeCode = reader.u16();

  if (typeCode === STRUCTURE_TYPE_CODE) {
    const structureHandle = reader.u16();
    if (structureHandle === LOGIX_STRING_STRUCTURE_HANDLE) {
      return {
        typeCode,
        typeName: "STRING",
        structureHandle,
        value: decodeLogixString(reader),
        elementCount: 1,
      };
    }
    // Unknown template: return raw member bytes rather than pretending to
    // understand the layout. Template decoding is a later, explicit slice.
    return {
      typeCode,
      typeName: "STRUCT",
      structureHandle,
      value: reader.rest(),
      elementCount: 1,
    };
  }

  const size = cipScalarSize(typeCode);
  if (size === undefined) {
    throw new RangeError(`unsupported CIP type code 0x${typeCode.toString(16)} in tag reply`);
  }
  if (reader.remaining() % size !== 0) {
    throw new RangeError(
      `tag reply has ${reader.remaining()} value byte(s), not a multiple of ${size} for ${cipTypeName(typeCode)}`,
    );
  }
  const elementCount = reader.remaining() / size;
  if (elementCount === 0) {
    throw new RangeError(`tag reply for ${cipTypeName(typeCode)} carries no value bytes`);
  }
  if (elementCount === 1) {
    return { typeCode, typeName: cipTypeName(typeCode), value: decodeScalar(typeCode, reader), elementCount };
  }
  const values: CipScalar[] = [];
  for (let i = 0; i < elementCount; i += 1) values.push(decodeScalar(typeCode, reader));
  return { typeCode, typeName: cipTypeName(typeCode), value: values, elementCount };
}

/** Logix STRING body: DINT LEN, then DATA bytes (replies may pad to 82). */
function decodeLogixString(reader: ByteReader): string {
  const length = reader.i32();
  if (length < 0 || length > reader.remaining()) {
    throw new RangeError(
      `Logix STRING claims ${length} byte(s) but only ${reader.remaining()} follow`,
    );
  }
  return reader.ascii(length);
}
