/**
 * Central ESCO-native file format registry and JSON helpers.
 *
 * These formats are owned by ESCO Automation Studio. They are open JSON
 * artifacts, not proprietary binary project files and not controller-online
 * workflows. L5X remains an offline interchange boundary; ESCO-native project
 * and package paths use the `.eas*` family below.
 */

export type EscoNativeFormatKind =
  | "project"
  | "controller"
  | "tags"
  | "routine"
  | "io"
  | "hmi"
  | "library"
  | "snapshot"
  | "exchange"
  | "runtime"
  | "package";

export type EscoFormatStatus = "implemented" | "schema-registered" | "name-registered";

export type EscoNativeExtension =
  | ".easproj"
  | ".easctrl"
  | ".eastags"
  | ".easroutine"
  | ".easio"
  | ".eashmi"
  | ".easlib"
  | ".eassnap"
  | ".easx"
  | ".easruntime"
  | ".easpkg";

export interface EscoFileFormat {
  kind: EscoNativeFormatKind;
  extension: EscoNativeExtension;
  /** Older or compatibility names accepted on load, but not emitted by new exports. */
  aliases?: readonly string[];
  name: string;
  /** What the format is for, in ESCO terms. */
  role: string;
  status: EscoFormatStatus;
  schemaVersion: number;
  schemaId: string;
  mediaType: string;
}

export const EASPROJ_EXTENSION = ".easproj";
export const EASCTRL_EXTENSION = ".easctrl";
export const EASTAGS_EXTENSION = ".eastags";
export const EASROUTINE_EXTENSION = ".easroutine";
export const EASIO_EXTENSION = ".easio";
export const EASHMI_EXTENSION = ".eashmi";
export const EASLIB_EXTENSION = ".easlib";
export const EASSNAPSHOT_EXTENSION = ".eassnap";
export const EASX_EXTENSION = ".easx";
export const EASRUNTIME_EXTENSION = ".easruntime";
export const EASPKG_EXTENSION = ".easpkg";
export const EASRT_LEGACY_EXTENSION = ".easrt";
export const PLCPROJ_JSON_LEGACY_EXTENSION = ".plcproj.json";

export const ESCO_NATIVE_SCHEMA_VERSION = 1;
export const ESCO_NATIVE_PRODUCER = "ESCO Automation Studio";
export const ESCO_NATIVE_CHECKSUM_ALGORITHM = "sha256" as const;

/**
 * The central ESCO-native file-format registry. "Schema-registered" means the
 * extension, top-level envelope, checksum, and deterministic serialization rules
 * are reserved and validated here; feature-complete authoring workflows can land
 * later without pretending to support proprietary controller files.
 */
export const ESCO_FILE_FORMATS: readonly EscoFileFormat[] = [
  {
    kind: "project",
    extension: EASPROJ_EXTENSION,
    aliases: [PLCPROJ_JSON_LEGACY_EXTENSION],
    name: "ESCO Automation Studio Project",
    role: "Editable ESCO project of record",
    status: "implemented",
    schemaVersion: ESCO_NATIVE_SCHEMA_VERSION,
    schemaId: "https://schemas.esco.studio/native/easproj.v1.json",
    mediaType: "application/vnd.esco.project+json",
  },
  {
    kind: "controller",
    extension: EASCTRL_EXTENSION,
    name: "ESCO Controller",
    role: "Offline controller definition and contained logic references",
    status: "schema-registered",
    schemaVersion: ESCO_NATIVE_SCHEMA_VERSION,
    schemaId: "https://schemas.esco.studio/native/easctrl.v1.json",
    mediaType: "application/vnd.esco.controller+json",
  },
  {
    kind: "tags",
    extension: EASTAGS_EXTENSION,
    name: "ESCO Tag Set",
    role: "Controller/program tag set",
    status: "schema-registered",
    schemaVersion: ESCO_NATIVE_SCHEMA_VERSION,
    schemaId: "https://schemas.esco.studio/native/eastags.v1.json",
    mediaType: "application/vnd.esco.tags+json",
  },
  {
    kind: "routine",
    extension: EASROUTINE_EXTENSION,
    name: "ESCO Routine",
    role: "Single routine source and metadata",
    status: "schema-registered",
    schemaVersion: ESCO_NATIVE_SCHEMA_VERSION,
    schemaId: "https://schemas.esco.studio/native/easroutine.v1.json",
    mediaType: "application/vnd.esco.routine+json",
  },
  {
    kind: "io",
    extension: EASIO_EXTENSION,
    name: "ESCO I/O Configuration",
    role: "Offline I/O module tree and connection metadata",
    status: "schema-registered",
    schemaVersion: ESCO_NATIVE_SCHEMA_VERSION,
    schemaId: "https://schemas.esco.studio/native/easio.v1.json",
    mediaType: "application/vnd.esco.io+json",
  },
  {
    kind: "hmi",
    extension: EASHMI_EXTENSION,
    name: "ESCO HMI Application",
    role: "HMI screens, bindings, navigation, and local runtime assets",
    status: "schema-registered",
    schemaVersion: ESCO_NATIVE_SCHEMA_VERSION,
    schemaId: "https://schemas.esco.studio/native/eashmi.v1.json",
    mediaType: "application/vnd.esco.hmi+json",
  },
  {
    kind: "library",
    extension: EASLIB_EXTENSION,
    name: "ESCO Automation Library",
    role: "Reusable routines, data types, tags, HMI assets, and metadata",
    status: "implemented",
    schemaVersion: ESCO_NATIVE_SCHEMA_VERSION,
    schemaId: "https://schemas.esco.studio/native/easlib.v1.json",
    mediaType: "application/vnd.esco.library+json",
  },
  {
    kind: "snapshot",
    extension: EASSNAPSHOT_EXTENSION,
    name: "ESCO Project Snapshot",
    role: "Restorable offline project snapshot with project/HMI state and checksum",
    status: "implemented",
    schemaVersion: ESCO_NATIVE_SCHEMA_VERSION,
    schemaId: "https://schemas.esco.studio/native/eassnap.v1.json",
    mediaType: "application/vnd.esco.snapshot+json",
  },
  {
    kind: "exchange",
    extension: EASX_EXTENSION,
    name: "ESCO Exchange",
    role: "Portable editable ESCO project exchange with explicit offline boundaries",
    status: "implemented",
    schemaVersion: ESCO_NATIVE_SCHEMA_VERSION,
    schemaId: "https://schemas.esco.studio/native/easx.v1.json",
    mediaType: "application/vnd.esco.exchange+json",
  },
  {
    kind: "runtime",
    extension: EASRUNTIME_EXTENSION,
    aliases: [EASRT_LEGACY_EXTENSION],
    name: "ESCO Automation Studio Runtime",
    role: "Compiled offline runtime artifact",
    status: "implemented",
    schemaVersion: ESCO_NATIVE_SCHEMA_VERSION,
    schemaId: "https://schemas.esco.studio/native/easruntime.v1.json",
    mediaType: "application/vnd.esco.runtime+json",
  },
  {
    kind: "package",
    extension: EASPKG_EXTENSION,
    name: "ESCO Automation Package",
    role: "Deterministic embedded package for ESCO-native artifacts",
    status: "implemented",
    schemaVersion: ESCO_NATIVE_SCHEMA_VERSION,
    schemaId: "https://schemas.esco.studio/native/easpkg.v1.json",
    mediaType: "application/vnd.esco.package+json",
  },
] as const;

export const ESCO_NATIVE_EXTENSIONS = ESCO_FILE_FORMATS.map((format) => format.extension);

export type EscoComponentArtifactKind =
  | "component-controller"
  | "component-tag"
  | "component-routine"
  | "component-program"
  | "component-task"
  | "component-data-type"
  | "component-custom-instruction"
  | "component-device"
  | "component-device-tree"
  | "component-assets"
  | "component-trend";

export type EscoArtifactFormatKind = EscoNativeFormatKind | EscoComponentArtifactKind;

export interface EscoArtifactFormat {
  kind: EscoArtifactFormatKind;
  extension: string;
  aliases?: readonly string[];
  name: string;
  role: string;
  mediaType: string;
}

export const ESCO_COMPONENT_ARTIFACT_FORMATS: readonly EscoArtifactFormat[] = [
  {
    kind: "component-controller",
    extension: ".esco-controller.json",
    name: "ESCO Controller Component",
    role: "Offline controller component export",
    mediaType: "application/vnd.esco.component+json",
  },
  {
    kind: "component-tag",
    extension: ".esco-tag.json",
    name: "ESCO Tag Component",
    role: "Offline tag component export",
    mediaType: "application/vnd.esco.component+json",
  },
  {
    kind: "component-routine",
    extension: ".esco-routine.json",
    name: "ESCO Routine Component",
    role: "Offline routine component export",
    mediaType: "application/vnd.esco.component+json",
  },
  {
    kind: "component-program",
    extension: ".esco-program.json",
    name: "ESCO Program Component",
    role: "Offline program component export",
    mediaType: "application/vnd.esco.component+json",
  },
  {
    kind: "component-task",
    extension: ".esco-task.json",
    name: "ESCO Task Component",
    role: "Offline task component export",
    mediaType: "application/vnd.esco.component+json",
  },
  {
    kind: "component-data-type",
    extension: ".esco-data-type.json",
    name: "ESCO Data Type Component",
    role: "Offline data type component export",
    mediaType: "application/vnd.esco.component+json",
  },
  {
    kind: "component-custom-instruction",
    extension: ".esco-custom-instruction.json",
    name: "ESCO Custom Instruction Component",
    role: "Offline custom instruction component export",
    mediaType: "application/vnd.esco.component+json",
  },
  {
    kind: "component-device",
    extension: ".esco-device.json",
    name: "ESCO Device Component",
    role: "Offline device definition component export",
    mediaType: "application/vnd.esco.component+json",
  },
  {
    kind: "component-device-tree",
    extension: ".esco-devices.json",
    name: "ESCO Device Tree Component",
    role: "Offline device tree component export",
    mediaType: "application/vnd.esco.component+json",
  },
  {
    kind: "component-assets",
    extension: ".esco-assets.json",
    aliases: [".esco-assets"],
    name: "ESCO Controller Assets Bundle",
    role: "Offline controller assets bundle export",
    mediaType: "application/vnd.esco.component+json",
  },
  {
    kind: "component-trend",
    extension: ".esco-trend.json",
    aliases: [".esco-trend"],
    name: "ESCO Controller Trend Bundle",
    role: "Offline controller trend bundle export",
    mediaType: "application/vnd.esco.component+json",
  },
];

export const ESCO_ARTIFACT_FORMATS: readonly EscoArtifactFormat[] = [
  ...ESCO_FILE_FORMATS,
  ...ESCO_COMPONENT_ARTIFACT_FORMATS,
];

export const ESCO_ARTIFACT_EXTENSIONS = ESCO_ARTIFACT_FORMATS.map((format) => format.extension);

export interface EscoNativeSchemaDescriptor {
  kind: EscoNativeFormatKind;
  schemaId: string;
  title: string;
  extension: EscoNativeExtension;
  schemaVersion: number;
  requiredTopLevel: readonly string[];
  checksumScope: string;
}

export const ESCO_NATIVE_JSON_SCHEMAS: Readonly<Record<EscoNativeFormatKind, EscoNativeSchemaDescriptor>> =
  ESCO_FILE_FORMATS.reduce((schemas, format) => {
    schemas[format.kind] = {
      kind: format.kind,
      schemaId: format.schemaId,
      title: format.name,
      extension: format.extension,
      schemaVersion: format.schemaVersion,
      requiredTopLevel:
        format.kind === "package"
          ? ["formatName", "extension", "schemaVersion", "packageVersion", "createdBy", "createdAt", "entries"]
          : ["formatName", "extension", "schemaVersion", "native", "payload"],
      checksumScope: format.kind === "package" ? "entry text content" : "payload",
    };
    return schemas;
  }, {} as Record<EscoNativeFormatKind, EscoNativeSchemaDescriptor>);

export function getEscoNativeFormat(kind: EscoNativeFormatKind): EscoFileFormat {
  const format = ESCO_FILE_FORMATS.find((candidate) => candidate.kind === kind);
  if (!format) throw new Error(`Unknown ESCO-native format kind: ${kind}`);
  return format;
}

export function findEscoNativeFormatByExtension(fileNameOrExtension: string): EscoFileFormat | undefined {
  const value = fileNameOrExtension.trim().toLowerCase();
  return ESCO_FILE_FORMATS.find((format) =>
    [format.extension, ...(format.aliases ?? [])].some((extension) => value.endsWith(extension)),
  );
}

export function findEscoArtifactFormatByExtension(fileNameOrExtension: string): EscoArtifactFormat | undefined {
  const value = fileNameOrExtension.trim().toLowerCase();
  return ESCO_ARTIFACT_FORMATS.find((format) =>
    [format.extension, ...(format.aliases ?? [])].some((extension) => value.endsWith(extension)),
  );
}

export function fileNameMatchesEscoNativeFormat(
  fileName: string,
  kind: EscoNativeFormatKind,
): boolean {
  const format = getEscoNativeFormat(kind);
  const value = fileName.trim().toLowerCase();
  return [format.extension, ...(format.aliases ?? [])].some((extension) => value.endsWith(extension));
}

export function isEscoNativeFileName(fileName: string): boolean {
  return Boolean(findEscoNativeFormatByExtension(fileName));
}

export function isEscoArtifactFileName(fileName: string): boolean {
  return Boolean(findEscoArtifactFormatByExtension(fileName));
}

export function escoNativeExtensionList(): string {
  return ESCO_NATIVE_EXTENSIONS.join(", ");
}

export function escoArtifactExtensionList(): string {
  return ESCO_ARTIFACT_EXTENSIONS.join(", ");
}

export function nativeFormatLabel(format: EscoFileFormat): string {
  const aliases = format.aliases?.length ? ` (also reads ${format.aliases.join(", ")})` : "";
  return `${format.name} (${format.extension})${aliases}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function canonicalizeForJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => (item === undefined ? null : canonicalizeForJson(item)));
  }
  if (!isRecord(value)) return value;
  const output: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort((a, b) => a.localeCompare(b))) {
    const child = value[key];
    if (child === undefined || typeof child === "function" || typeof child === "symbol") continue;
    output[key] = canonicalizeForJson(child);
  }
  return output;
}

/** Canonical JSON with lexically sorted object keys and preserved array order. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalizeForJson(value));
}

/** Pretty deterministic JSON text for ESCO-native files. Ends with a newline. */
export function serializeNativeJson(value: unknown): string {
  return `${JSON.stringify(canonicalizeForJson(value), null, 2)}\n`;
}

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const rotr = (x: number, n: number): number => ((x >>> n) | (x << (32 - n))) >>> 0;
const hex8 = (x: number): string => (x >>> 0).toString(16).padStart(8, "0");

function sha256Hex(message: string): string {
  const bytes = new TextEncoder().encode(message);
  const length = bytes.length;
  const bitLength = length * 8;
  const withOne = length + 1;
  const pad = (56 - (withOne % 64) + 64) % 64;
  const total = withOne + pad + 8;

  const buffer = new Uint8Array(total);
  buffer.set(bytes);
  buffer[length] = 0x80;
  const view = new DataView(buffer.buffer);
  view.setUint32(total - 8, Math.floor(bitLength / 0x100000000));
  view.setUint32(total - 4, bitLength >>> 0);

  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
  const w = new Uint32Array(64);

  for (let chunk = 0; chunk < total; chunk += 64) {
    for (let t = 0; t < 16; t += 1) w[t] = view.getUint32(chunk + t * 4);
    for (let t = 16; t < 64; t += 1) {
      const w15 = w[t - 15]!;
      const w2 = w[t - 2]!;
      const s0 = rotr(w15, 7) ^ rotr(w15, 18) ^ (w15 >>> 3);
      const s1 = rotr(w2, 17) ^ rotr(w2, 19) ^ (w2 >>> 10);
      w[t] = (w[t - 16]! + s0 + w[t - 7]! + s1) >>> 0;
    }

    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let t = 0; t < 64; t += 1) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + K[t]! + w[t]!) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + temp1) >>> 0; d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }

    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
  }

  return hex8(h0) + hex8(h1) + hex8(h2) + hex8(h3) + hex8(h4) + hex8(h5) + hex8(h6) + hex8(h7);
}

export interface EscoNativeChecksum {
  algorithm: typeof ESCO_NATIVE_CHECKSUM_ALGORITHM;
  value: string;
}

export interface EscoNativeFileEnvelope<TPayload = unknown> {
  formatName: string;
  extension: EscoNativeExtension;
  schemaVersion: number;
  native: {
    kind: EscoNativeFormatKind;
    producedBy: typeof ESCO_NATIVE_PRODUCER;
    createdAt: string;
    checksum: EscoNativeChecksum;
  };
  payload: TPayload;
}

export interface CreateNativeFileOptions {
  createdAt?: string;
}

export function createNativeFileEnvelope<TPayload>(
  kind: EscoNativeFormatKind,
  payload: TPayload,
  options: CreateNativeFileOptions = {},
): EscoNativeFileEnvelope<TPayload> {
  const format = getEscoNativeFormat(kind);
  return {
    formatName: format.name,
    extension: format.extension,
    schemaVersion: format.schemaVersion,
    native: {
      kind,
      producedBy: ESCO_NATIVE_PRODUCER,
      createdAt: options.createdAt ?? new Date().toISOString(),
      checksum: { algorithm: ESCO_NATIVE_CHECKSUM_ALGORITHM, value: sha256Hex(canonicalJson(payload)) },
    },
    payload,
  };
}

export function serializeNativeFileEnvelope(file: EscoNativeFileEnvelope): string {
  return serializeNativeJson(file);
}

export interface NativeFileValidationOptions {
  expectedKind?: EscoNativeFormatKind;
  fileName?: string;
}

export interface NativeFileValidationResult<TPayload = unknown> {
  ok: boolean;
  file?: EscoNativeFileEnvelope<TPayload>;
  format?: EscoFileFormat;
  checksum?: { expected: string; actual: string; valid: boolean };
  errors: string[];
  error?: string;
}

function invalidNativeResult<TPayload>(
  errors: string[],
  format?: EscoFileFormat,
  checksum?: { expected: string; actual: string; valid: boolean },
): NativeFileValidationResult<TPayload> {
  return { ok: false, format, checksum, errors, error: errors.join(" ") };
}

function checksumLooksValid(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value);
}

export function validateNativeFileEnvelope<TPayload = unknown>(
  value: unknown,
  options: NativeFileValidationOptions = {},
): NativeFileValidationResult<TPayload> {
  const errors: string[] = [];
  const formatFromName = options.fileName ? findEscoNativeFormatByExtension(options.fileName) : undefined;
  if (options.fileName && !formatFromName) {
    errors.push(
      `Not an ESCO-native file: "${options.fileName}" must use one of ${escoNativeExtensionList()}. ` +
        "Controller interchange/binary formats are not ESCO-native project/package files.",
    );
  }
  if (!isRecord(value)) {
    errors.push("Corrupt ESCO-native file: expected a JSON object.");
    return invalidNativeResult(errors, formatFromName);
  }

  const native = value.native;
  const kind = isRecord(native) && typeof native.kind === "string" ? native.kind : undefined;
  const format =
    (kind ? ESCO_FILE_FORMATS.find((candidate) => candidate.kind === kind) : undefined) ??
    (typeof value.extension === "string" ? findEscoNativeFormatByExtension(value.extension) : undefined) ??
    formatFromName;

  if (!format) {
    errors.push("Corrupt ESCO-native file: missing or unknown format kind/extension.");
    return invalidNativeResult(errors, formatFromName);
  }
  if (options.expectedKind && format.kind !== options.expectedKind) {
    errors.push(`Expected ${getEscoNativeFormat(options.expectedKind).name}, found ${format.name}.`);
  }
  if (formatFromName && formatFromName.kind !== format.kind) {
    errors.push(`File extension "${options.fileName}" does not match the ${format.name} envelope.`);
  }
  if (value.formatName !== format.name) {
    errors.push(`Corrupt ESCO-native file: expected formatName "${format.name}".`);
  }
  if (typeof value.extension !== "string" || !fileNameMatchesEscoNativeFormat(value.extension, format.kind)) {
    errors.push(`Corrupt ESCO-native file: expected extension ${format.extension}.`);
  }
  if (typeof value.schemaVersion !== "number") {
    errors.push("Corrupt ESCO-native file: missing schema version.");
  } else if (value.schemaVersion > format.schemaVersion) {
    errors.push(
      `Unsupported ${format.name} schema version ${value.schemaVersion} ` +
        `(this build supports up to ${format.schemaVersion}).`,
    );
  }
  if (!isRecord(native)) {
    errors.push("Corrupt ESCO-native file: missing native metadata.");
  } else {
    if (native.kind !== format.kind) errors.push(`Corrupt ESCO-native file: expected native.kind "${format.kind}".`);
    if (native.producedBy !== ESCO_NATIVE_PRODUCER) {
      errors.push(`Corrupt ESCO-native file: expected producer "${ESCO_NATIVE_PRODUCER}".`);
    }
    if (typeof native.createdAt !== "string") errors.push("Corrupt ESCO-native file: missing creation timestamp.");
  }
  if (!("payload" in value)) errors.push("Corrupt ESCO-native file: missing payload.");

  const checksumNode = isRecord(native) ? native.checksum : undefined;
  let checksum: { expected: string; actual: string; valid: boolean } | undefined;
  if (!isRecord(checksumNode) || checksumNode.algorithm !== ESCO_NATIVE_CHECKSUM_ALGORITHM || typeof checksumNode.value !== "string") {
    errors.push("Corrupt ESCO-native file: missing payload checksum.");
  } else {
    const expected = checksumNode.value;
    const actual = sha256Hex(canonicalJson(value.payload));
    checksum = { expected, actual, valid: expected === actual };
    if (!checksumLooksValid(expected)) errors.push("Corrupt ESCO-native file: checksum is not a lowercase SHA-256 hex value.");
    if (expected !== actual) errors.push("ESCO-native integrity check failed: checksum does not match the payload.");
  }

  if (errors.length) return invalidNativeResult(errors, format, checksum);
  return {
    ok: true,
    file: value as unknown as EscoNativeFileEnvelope<TPayload>,
    format,
    checksum,
    errors: [],
  };
}

export function parseNativeFileEnvelope<TPayload = unknown>(
  text: string,
  options: NativeFileValidationOptions = {},
): NativeFileValidationResult<TPayload> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return invalidNativeResult(["Corrupt ESCO-native file: the file is not valid JSON."]);
  }
  return validateNativeFileEnvelope<TPayload>(parsed, options);
}

export interface EscoPackageManifestEntry {
  path: string;
  format: EscoArtifactFormatKind;
  extension: string;
  bytes: number;
  checksum: EscoNativeChecksum;
}

export interface EscoPackageManifest {
  formatName: "ESCO Automation Package";
  extension: typeof EASPKG_EXTENSION;
  schemaVersion: number;
  packageVersion: string;
  createdBy: typeof ESCO_NATIVE_PRODUCER;
  createdAt: string;
  entries: EscoPackageManifestEntry[];
}

export interface EscoPackageArtifact {
  path: string;
  text: string;
}

export interface EscoPackageFile extends EscoPackageManifest {
  contentMode: "embedded";
  artifacts: EscoPackageArtifact[];
  packageChecksum: EscoNativeChecksum;
}

export interface EscoPackageEntryInput {
  path: string;
  text: string;
}

export interface CreateEscoPackageManifestOptions {
  createdAt?: string;
  packageVersion?: string;
}

function normalizePackagePath(path: string): string {
  const normalized = path.trim().replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized) throw new Error("Package entry path cannot be empty.");
  if (normalized.split("/").includes("..")) {
    throw new Error(`Package entry "${path}" cannot contain parent-directory segments.`);
  }
  return normalized;
}

function extensionForPath(path: string, format: { extension: string; aliases?: readonly string[] }): string {
  const lower = path.toLowerCase();
  return [format.extension, ...(format.aliases ?? [])].find((extension) => lower.endsWith(extension)) ?? format.extension;
}

function requireUniquePackagePaths(paths: readonly string[]): void {
  const seen = new Set<string>();
  for (const path of paths) {
    const key = path.toLowerCase();
    if (seen.has(key)) throw new Error(`Package entry path "${path}" is duplicated.`);
    seen.add(key);
  }
}

export function createEscoPackageManifest(
  entries: readonly EscoPackageEntryInput[],
  options: CreateEscoPackageManifestOptions = {},
): EscoPackageManifest {
  const normalizedEntries = entries.map((entry) => ({ ...entry, path: normalizePackagePath(entry.path) }));
  requireUniquePackagePaths(normalizedEntries.map((entry) => entry.path));

  const manifestEntries = normalizedEntries.map((entry): EscoPackageManifestEntry => {
    const path = normalizePackagePath(entry.path);
    const format = findEscoArtifactFormatByExtension(path);
    if (!format) {
      throw new Error(
        `Package entry "${entry.path}" is not an ESCO artifact. Use ${escoArtifactExtensionList()} artifacts in .easpkg packages.`,
      );
    }
    return {
      path,
      format: format.kind,
      extension: extensionForPath(path, format),
      bytes: new TextEncoder().encode(entry.text).length,
      checksum: { algorithm: ESCO_NATIVE_CHECKSUM_ALGORITHM, value: sha256Hex(entry.text) },
    };
  });

  return {
    formatName: "ESCO Automation Package",
    extension: EASPKG_EXTENSION,
    schemaVersion: getEscoNativeFormat("package").schemaVersion,
    packageVersion: options.packageVersion ?? "1.0.0",
    createdBy: ESCO_NATIVE_PRODUCER,
    createdAt: options.createdAt ?? new Date().toISOString(),
    entries: manifestEntries.sort((left, right) => left.path.localeCompare(right.path)),
  };
}

export function serializeEscoPackageManifest(manifest: EscoPackageManifest): string {
  return serializeNativeJson(manifest);
}

function packageChecksumPayload(file: Omit<EscoPackageFile, "packageChecksum">): unknown {
  return {
    artifacts: file.artifacts,
    contentMode: file.contentMode,
    createdAt: file.createdAt,
    createdBy: file.createdBy,
    entries: file.entries,
    extension: file.extension,
    formatName: file.formatName,
    packageVersion: file.packageVersion,
    schemaVersion: file.schemaVersion,
  };
}

export function createEscoPackage(
  entries: readonly EscoPackageEntryInput[],
  options: CreateEscoPackageManifestOptions = {},
): EscoPackageFile {
  const manifest = createEscoPackageManifest(entries, options);
  const textByPath = new Map(entries.map((entry) => [normalizePackagePath(entry.path).toLowerCase(), entry.text]));
  const fileWithoutChecksum: Omit<EscoPackageFile, "packageChecksum"> = {
    ...manifest,
    contentMode: "embedded",
    artifacts: manifest.entries.map((entry) => ({
      path: entry.path,
      text: textByPath.get(entry.path.toLowerCase()) ?? "",
    })),
  };
  return {
    ...fileWithoutChecksum,
    packageChecksum: {
      algorithm: ESCO_NATIVE_CHECKSUM_ALGORITHM,
      value: sha256Hex(canonicalJson(packageChecksumPayload(fileWithoutChecksum))),
    },
  };
}

export function serializeEscoPackage(file: EscoPackageFile): string {
  return serializeNativeJson(file);
}

export interface PackageManifestValidationResult {
  ok: boolean;
  manifest?: EscoPackageManifest;
  packageFile?: EscoPackageFile;
  embeddedContent: boolean;
  packageChecksum?: { expected: string; actual: string; valid: boolean };
  errors: string[];
  error?: string;
}

function invalidPackageManifest(errors: string[]): PackageManifestValidationResult {
  return { ok: false, embeddedContent: false, errors, error: errors.join(" ") };
}

export function validateEscoPackageManifest(value: unknown): PackageManifestValidationResult {
  const errors: string[] = [];
  const packageFormat = getEscoNativeFormat("package");
  if (!isRecord(value)) return invalidPackageManifest(["Corrupt ESCO package manifest: expected a JSON object."]);
  if (value.formatName !== packageFormat.name) errors.push(`Expected formatName "${packageFormat.name}".`);
  if (value.extension !== EASPKG_EXTENSION) errors.push(`Expected extension ${EASPKG_EXTENSION}.`);
  if (typeof value.schemaVersion !== "number") {
    errors.push("Missing package schema version.");
  } else if (value.schemaVersion > packageFormat.schemaVersion) {
    errors.push(`Unsupported ESCO package schema version ${value.schemaVersion}.`);
  }
  if (value.createdBy !== ESCO_NATIVE_PRODUCER) errors.push(`Expected package producer "${ESCO_NATIVE_PRODUCER}".`);
  if (typeof value.createdAt !== "string") errors.push("Missing package creation timestamp.");
  if (typeof value.packageVersion !== "string") errors.push("Missing package version.");
  if (!Array.isArray(value.entries)) {
    errors.push("Package manifest entries must be an array.");
  } else {
    const paths = value.entries.map((entry) => (isRecord(entry) && typeof entry.path === "string" ? entry.path : ""));
    const sortedPaths = [...paths].sort((left, right) => left.localeCompare(right));
    if (paths.some((path, index) => path !== sortedPaths[index])) {
      errors.push("Package manifest entries must be sorted by path for deterministic output.");
    }
    const seenPaths = new Set<string>();
    for (const entry of value.entries) {
      if (!isRecord(entry)) {
        errors.push("Package manifest entry must be an object.");
        continue;
      }
      if (typeof entry.path !== "string" || !entry.path) {
        errors.push("Package manifest entry is missing a path.");
      } else {
        try {
          const normalizedPath = normalizePackagePath(entry.path);
          if (normalizedPath !== entry.path) errors.push(`Package entry "${entry.path}" path is not normalized.`);
          const pathKey = normalizedPath.toLowerCase();
          if (seenPaths.has(pathKey)) errors.push(`Package entry "${entry.path}" is duplicated.`);
          seenPaths.add(pathKey);
        } catch (error) {
          errors.push(error instanceof Error ? error.message : `Package entry "${entry.path}" has an invalid path.`);
        }
      }
      const entryFormat = typeof entry.path === "string" ? findEscoArtifactFormatByExtension(entry.path) : undefined;
      if (!entryFormat) errors.push(`Package entry "${String(entry.path)}" is not an ESCO artifact.`);
      if (entryFormat && entry.format !== entryFormat.kind) {
        errors.push(`Package entry "${entry.path}" format does not match its extension.`);
      }
      if (typeof entry.bytes !== "number" || entry.bytes < 0) errors.push(`Package entry "${String(entry.path)}" has invalid byte count.`);
      const checksum = entry.checksum;
      if (!isRecord(checksum) || checksum.algorithm !== ESCO_NATIVE_CHECKSUM_ALGORITHM || typeof checksum.value !== "string") {
        errors.push(`Package entry "${String(entry.path)}" is missing a SHA-256 checksum.`);
      } else if (!checksumLooksValid(checksum.value)) {
        errors.push(`Package entry "${String(entry.path)}" checksum is not a lowercase SHA-256 hex value.`);
      }
    }
  }
  if (errors.length) return invalidPackageManifest(errors);

  const manifest = value as unknown as EscoPackageManifest;
  const embeddedContent = "artifacts" in value || "contentMode" in value || "packageChecksum" in value;
  if (!embeddedContent) return { ok: true, manifest, embeddedContent: false, errors: [] };

  const embeddedErrors: string[] = [];
  if (value.contentMode !== "embedded") embeddedErrors.push('ESCO package embedded content must set contentMode to "embedded".');

  const artifacts = value.artifacts;
  if (!Array.isArray(artifacts)) {
    embeddedErrors.push("ESCO package embedded artifacts must be an array.");
  } else {
    const artifactPaths = artifacts.map((artifact) =>
      isRecord(artifact) && typeof artifact.path === "string" ? artifact.path : "",
    );
    const sortedArtifactPaths = [...artifactPaths].sort((left, right) => left.localeCompare(right));
    if (artifactPaths.some((path, index) => path !== sortedArtifactPaths[index])) {
      embeddedErrors.push("ESCO package embedded artifacts must be sorted by path for deterministic output.");
    }

    const artifactByPath = new Map<string, { path: string; text: string }>();
    for (const artifact of artifacts) {
      if (!isRecord(artifact)) {
        embeddedErrors.push("ESCO package embedded artifact must be an object.");
        continue;
      }
      if (typeof artifact.path !== "string" || !artifact.path) {
        embeddedErrors.push("ESCO package embedded artifact is missing a path.");
        continue;
      }
      if (typeof artifact.text !== "string") {
        embeddedErrors.push(`ESCO package embedded artifact "${artifact.path}" is missing text content.`);
        continue;
      }
      try {
        const normalizedPath = normalizePackagePath(artifact.path);
        if (normalizedPath !== artifact.path) embeddedErrors.push(`ESCO package artifact "${artifact.path}" path is not normalized.`);
        const key = normalizedPath.toLowerCase();
        if (artifactByPath.has(key)) embeddedErrors.push(`ESCO package artifact "${artifact.path}" is duplicated.`);
        artifactByPath.set(key, { path: normalizedPath, text: artifact.text });
      } catch (error) {
        embeddedErrors.push(error instanceof Error ? error.message : `ESCO package artifact "${artifact.path}" has an invalid path.`);
      }
    }

    for (const entry of manifest.entries) {
      const artifact = artifactByPath.get(entry.path.toLowerCase());
      if (!artifact) {
        embeddedErrors.push(`ESCO package entry "${entry.path}" has no embedded artifact content.`);
        continue;
      }
      const actualBytes = new TextEncoder().encode(artifact.text).length;
      const actualChecksum = sha256Hex(artifact.text);
      if (entry.bytes !== actualBytes) {
        embeddedErrors.push(`ESCO package entry "${entry.path}" byte count does not match embedded content.`);
      }
      if (entry.checksum.value !== actualChecksum) {
        embeddedErrors.push(`ESCO package entry "${entry.path}" checksum does not match embedded content.`);
      }
    }

    for (const artifact of artifactByPath.values()) {
      if (!manifest.entries.some((entry) => entry.path.toLowerCase() === artifact.path.toLowerCase())) {
        embeddedErrors.push(`ESCO package artifact "${artifact.path}" has no manifest entry.`);
      }
      if (!findEscoArtifactFormatByExtension(artifact.path)) {
        embeddedErrors.push(`ESCO package artifact "${artifact.path}" is not an ESCO artifact.`);
      }
    }
  }

  const checksumNode = value.packageChecksum;
  let packageChecksum: { expected: string; actual: string; valid: boolean } | undefined;
  if (!isRecord(checksumNode) || checksumNode.algorithm !== ESCO_NATIVE_CHECKSUM_ALGORITHM || typeof checksumNode.value !== "string") {
    embeddedErrors.push("ESCO package is missing an embedded-content SHA-256 checksum.");
  } else {
    const expected = checksumNode.value;
    const checksumInput = value as unknown as EscoPackageFile;
    const fileWithoutChecksum: Omit<EscoPackageFile, "packageChecksum"> = {
      formatName: checksumInput.formatName,
      extension: checksumInput.extension,
      schemaVersion: checksumInput.schemaVersion,
      packageVersion: checksumInput.packageVersion,
      createdBy: checksumInput.createdBy,
      createdAt: checksumInput.createdAt,
      entries: checksumInput.entries,
      contentMode: checksumInput.contentMode,
      artifacts: checksumInput.artifacts,
    };
    const actual = sha256Hex(canonicalJson(packageChecksumPayload(fileWithoutChecksum)));
    packageChecksum = { expected, actual, valid: expected === actual };
    if (!checksumLooksValid(expected)) embeddedErrors.push("ESCO package checksum is not a lowercase SHA-256 hex value.");
    if (expected !== actual) embeddedErrors.push("ESCO package integrity check failed: checksum does not match embedded content.");
  }

  if (embeddedErrors.length) {
    return {
      ok: false,
      manifest,
      embeddedContent: true,
      packageChecksum,
      errors: embeddedErrors,
      error: embeddedErrors.join(" "),
    };
  }
  return {
    ok: true,
    manifest,
    packageFile: value as unknown as EscoPackageFile,
    embeddedContent: true,
    packageChecksum,
    errors: [],
  };
}

export function parseEscoPackageManifest(text: string): PackageManifestValidationResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return invalidPackageManifest(["Corrupt ESCO package manifest: the file is not valid JSON."]);
  }
  return validateEscoPackageManifest(parsed);
}

export interface EscoPackageExtractionResult {
  ok: boolean;
  manifest?: EscoPackageManifest;
  packageFile?: EscoPackageFile;
  artifacts: EscoPackageArtifact[];
  packageChecksum?: { expected: string; actual: string; valid: boolean };
  errors: string[];
  error?: string;
}

export function parseEscoPackage(text: string): PackageManifestValidationResult {
  return parseEscoPackageManifest(text);
}

export function extractEscoPackageArtifacts(text: string): EscoPackageExtractionResult {
  const parsed = parseEscoPackage(text);
  if (!parsed.ok || !parsed.manifest) {
    return { ok: false, artifacts: [], errors: parsed.errors, error: parsed.error };
  }
  if (!parsed.packageFile) {
    const errors = ["ESCO package is manifest-only and does not contain embedded artifacts to extract."];
    return {
      ok: false,
      manifest: parsed.manifest,
      artifacts: [],
      packageChecksum: parsed.packageChecksum,
      errors,
      error: errors.join(" "),
    };
  }
  return {
    ok: true,
    manifest: parsed.manifest,
    packageFile: parsed.packageFile,
    artifacts: parsed.packageFile.artifacts.map((artifact) => ({ ...artifact })),
    packageChecksum: parsed.packageChecksum,
    errors: [],
  };
}

export type EscoArtifactValidationType =
  | "native-envelope"
  | "runtime"
  | "package"
  | "component"
  | "controller-assets";

export interface EscoArtifactValidationSummary {
  validationType: EscoArtifactValidationType;
  formatName: string;
  kind: string;
  extension: string;
  fileName?: string;
  checksumValid?: boolean;
  entryCount?: number;
  embeddedContent?: boolean;
  embeddedContentCount?: number;
  packageChecksumValid?: boolean;
  payloadCount?: number;
  details: string[];
  nonMutating: true;
}

export interface EscoArtifactValidationResult {
  ok: boolean;
  format?: EscoArtifactFormat;
  summary?: EscoArtifactValidationSummary;
  checksum?: { expected: string; actual: string; valid: boolean };
  errors: string[];
  error?: string;
}

function invalidArtifactResult(
  errors: string[],
  format?: EscoArtifactFormat,
  checksum?: { expected: string; actual: string; valid: boolean },
): EscoArtifactValidationResult {
  return { ok: false, format, checksum, errors, error: errors.join(" ") };
}

function payloadCount(payload: unknown): number {
  if (Array.isArray(payload)) return payload.length;
  if (payload === undefined || payload === null) return 0;
  if (isRecord(payload) && Array.isArray(payload.modules)) return payload.modules.length;
  return 1;
}

const COMPONENT_KIND_BY_ARTIFACT: Readonly<Record<EscoComponentArtifactKind, readonly string[]>> = {
  "component-controller": ["controller"],
  "component-tag": ["tag"],
  "component-routine": ["routine"],
  "component-program": ["program"],
  "component-task": ["task"],
  "component-data-type": ["data-type"],
  "component-custom-instruction": ["custom-instruction"],
  "component-device": ["device-definition"],
  "component-device-tree": ["device-tree"],
  "component-assets": ["add-on-instructions", "user-defined-data-types", "controller-trends"],
  "component-trend": ["controller-trend"],
};

function isComponentArtifactKind(kind: EscoArtifactFormatKind): kind is EscoComponentArtifactKind {
  return kind.startsWith("component-");
}

function validateRuntimeArtifact(
  value: Record<string, unknown>,
  format: EscoArtifactFormat | undefined,
  fileName?: string,
): EscoArtifactValidationResult {
  const runtimeFormat = getEscoNativeFormat("runtime");
  const errors: string[] = [];
  if (value.formatName !== runtimeFormat.name) errors.push(`Expected formatName "${runtimeFormat.name}".`);
  if (typeof value.extension !== "string" || !fileNameMatchesEscoNativeFormat(value.extension, "runtime")) {
    errors.push(`Expected runtime extension ${runtimeFormat.extension}.`);
  }
  if (typeof value.schemaVersion !== "number") {
    errors.push("Missing runtime schema version.");
  } else if (value.schemaVersion > runtimeFormat.schemaVersion) {
    errors.push(`Unsupported ESCO Runtime schema version ${value.schemaVersion}.`);
  }
  if (!isRecord(value.runtime)) errors.push("Missing runtime payload.");

  const checksumNode = value.checksum;
  let checksum: { expected: string; actual: string; valid: boolean } | undefined;
  if (!isRecord(checksumNode) || checksumNode.algorithm !== ESCO_NATIVE_CHECKSUM_ALGORITHM || typeof checksumNode.value !== "string") {
    errors.push("Missing runtime SHA-256 checksum.");
  } else if (isRecord(value.runtime)) {
    const expected = checksumNode.value;
    const actual = sha256Hex(canonicalJson(value.runtime));
    checksum = { expected, actual, valid: expected === actual };
    if (!checksumLooksValid(expected)) errors.push("Runtime checksum is not a lowercase SHA-256 hex value.");
    if (expected !== actual) errors.push("ESCO Runtime integrity check failed: checksum does not match the runtime payload.");
  }
  if (isRecord(value.runtime)) {
    const provenance = value.runtime.provenance;
    if (!isRecord(provenance) || provenance.source !== "esco-native") {
      errors.push("Runtime provenance is not ESCO-native.");
    }
  }

  if (errors.length) return invalidArtifactResult(errors, format, checksum);
  const runtime = value.runtime as Record<string, unknown>;
  const build = isRecord(runtime.build) ? runtime.build : {};
  return {
    ok: true,
    format,
    checksum,
    errors: [],
    summary: {
      validationType: "runtime",
      formatName: runtimeFormat.name,
      kind: "runtime",
      extension: runtimeFormat.extension,
      ...(fileName ? { fileName } : {}),
      checksumValid: checksum?.valid,
      details: [
        `${Number(build.controllerCount ?? 0)} controller(s)`,
        `${Number(build.routineCount ?? 0)} routine(s)`,
        `${Number(build.tagCount ?? 0)} tag(s)`,
      ],
      nonMutating: true,
    },
  };
}

function validateComponentArtifact(
  value: Record<string, unknown>,
  format: EscoArtifactFormat | undefined,
  fileName?: string,
): EscoArtifactValidationResult {
  const errors: string[] = [];
  const componentFormat = value.format;
  const componentKind = typeof value.kind === "string" ? value.kind : "";
  const expectedKinds = format && isComponentArtifactKind(format.kind) ? COMPONENT_KIND_BY_ARTIFACT[format.kind] : undefined;

  if (componentFormat !== "esco.component.export.v1" && componentFormat !== "esco.controller-assets.export.v1") {
    errors.push("Expected an ESCO component export or controller assets bundle.");
  }
  if (!componentKind) errors.push("Missing component kind.");
  if (expectedKinds && !expectedKinds.includes(componentKind)) {
    errors.push(`File suffix expects ${expectedKinds.join(" or ")} content, found ${componentKind || "unknown"}.`);
  }
  if (componentFormat === "esco.component.export.v1") {
    if (typeof value.name !== "string" || !value.name.trim()) errors.push("Component export is missing a name.");
    if (!isRecord(value.dependencies)) errors.push("Component export is missing dependency metadata.");
    if (!("payload" in value)) errors.push("Component export is missing a payload.");
  } else if (componentFormat === "esco.controller-assets.export.v1") {
    if (!("payload" in value)) errors.push("Controller assets bundle is missing a payload.");
  }
  if (errors.length) return invalidArtifactResult(errors, format);

  const count = payloadCount(value.payload);
  const name = typeof value.name === "string" ? value.name : componentKind;
  return {
    ok: true,
    format,
    errors: [],
    summary: {
      validationType: componentFormat === "esco.controller-assets.export.v1" ? "controller-assets" : "component",
      formatName:
        componentFormat === "esco.controller-assets.export.v1"
          ? "ESCO Controller Assets Bundle"
          : "ESCO Component Export",
      kind: componentKind,
      extension: format?.extension ?? "component-json",
      ...(fileName ? { fileName } : {}),
      payloadCount: count,
      details: [`${count} payload item(s)`, `name: ${name}`],
      nonMutating: true,
    },
  };
}

function parseArtifactJson(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, error: "Corrupt ESCO artifact: the file is not valid JSON." };
  }
}

export function validateEscoNativeArtifact(text: string, fileName?: string): EscoArtifactValidationResult {
  const format = fileName ? findEscoArtifactFormatByExtension(fileName) : undefined;
  if (fileName && !format) {
    return invalidArtifactResult([
      `Not an ESCO artifact: "${fileName}" must use one of ${escoArtifactExtensionList()}.`,
    ]);
  }

  const parsed = parseArtifactJson(text);
  if (!parsed.ok) return invalidArtifactResult([parsed.error], format);
  if (!isRecord(parsed.value)) return invalidArtifactResult(["Corrupt ESCO artifact: expected a JSON object."], format);

  const value = parsed.value;
  if (format?.kind === "package" || value.formatName === getEscoNativeFormat("package").name) {
    const result = validateEscoPackageManifest(value);
    if (!result.ok || !result.manifest) return invalidArtifactResult(result.errors, format, result.packageChecksum);
    const embeddedLabel = result.embeddedContent ? "embedded verified" : "manifest only";
    return {
      ok: true,
      format,
      checksum: result.packageChecksum,
      errors: [],
      summary: {
        validationType: "package",
        formatName: getEscoNativeFormat("package").name,
        kind: "package",
        extension: EASPKG_EXTENSION,
        ...(fileName ? { fileName } : {}),
        entryCount: result.manifest.entries.length,
        embeddedContent: result.embeddedContent,
        ...(result.packageFile ? { embeddedContentCount: result.packageFile.artifacts.length } : {}),
        ...(result.packageChecksum ? { packageChecksumValid: result.packageChecksum.valid } : {}),
        details: result.manifest.entries.map((entry) => `${entry.path} (${entry.extension}, ${entry.bytes} bytes, ${embeddedLabel})`),
        nonMutating: true,
      },
    };
  }

  if (format?.kind === "runtime" || value.formatName === getEscoNativeFormat("runtime").name) {
    return validateRuntimeArtifact(value, format, fileName);
  }

  if ((format && isComponentArtifactKind(format.kind)) || value.format === "esco.component.export.v1" || value.format === "esco.controller-assets.export.v1") {
    return validateComponentArtifact(value, format, fileName);
  }

  const native = parseNativeFileEnvelope(text, fileName ? { fileName } : {});
  if (!native.ok || !native.file || !native.format) {
    return invalidArtifactResult(native.errors.length ? native.errors : ["Unrecognized ESCO artifact."], format);
  }
  return {
    ok: true,
    format: native.format,
    checksum: native.checksum,
    errors: [],
    summary: {
      validationType: "native-envelope",
      formatName: native.format.name,
      kind: native.format.kind,
      extension: native.format.extension,
      ...(fileName ? { fileName } : {}),
      checksumValid: native.checksum?.valid,
      details: [native.format.role],
      nonMutating: true,
    },
  };
}
