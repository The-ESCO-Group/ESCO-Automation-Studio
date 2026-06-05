/**
 * ESCO-native `.easruntime` runtime artifact.
 *
 * These formats are owned by ESCO Automation Studio. They are not proprietary
 * controller-project files and do not mirror any vendor-native controller-file
 * structure; they are open, inspectable, ESCO-defined JSON. The implemented runtime format
 * is `.easruntime` (ESCO Automation Studio Runtime): a compiled,
 * execution-oriented snapshot of an ESCO project, with a content checksum for
 * integrity. Legacy `.easrt` files are accepted on load only.
 *
 * This module owns the format constants, the runtime type model, a dependency-free
 * SHA-256 checksum (works in the browser and Node), and the serialize / parse /
 * validate plumbing. The runtime *compiler* lives in `runtime-build.ts`.
 */

import type { RoutineLanguage } from "@esco/core";
import type { HmiProject } from "@esco/hmi-model";
import type { InstructionFidelityStatus } from "@esco/instructions";
import {
  canonicalJson,
  EASRUNTIME_EXTENSION,
  fileNameMatchesEscoNativeFormat,
  serializeNativeJson,
} from "./native-format";

export const EASRT_FORMAT_NAME = "ESCO Automation Studio Runtime";
/** Canonical runtime extension emitted by new exports. */
export const EASRT_EXTENSION = EASRUNTIME_EXTENSION;
/** On-disk runtime schema version. Files above this are rejected. */
export const EASRT_SCHEMA_VERSION = 1;
/** Version of the ESCO runtime compiler that produced the artifact. */
export const EASRT_RUNTIME_VERSION = "1.0.0";
export const EASRT_CHECKSUM_ALGORITHM = "sha256" as const;

// ---------------------------------------------------------------------------
// Runtime type model
// ---------------------------------------------------------------------------

export type RuntimeScalar = boolean | number | string;

/** A flattened, execution-oriented routine payload. */
export type RuntimeRoutinePayload =
  | { kind: "ladder"; rungs: { number: number; text: string; comment?: string }[] }
  | { kind: "structured-text"; lines: string[] }
  | { kind: "graphical"; language: RoutineLanguage; preserved: boolean; note: string }
  | { kind: "empty" };

export interface RuntimeRoutine {
  id: string;
  name: string;
  language: RoutineLanguage;
  /** Position of this routine in the compiled controller execution order (-1 = not scheduled). */
  executionIndex: number;
  /** True when this routine is the simulator-executable scan set. */
  scheduled: boolean;
  /** True when the offline runtime/simulator can execute this routine's language. */
  executable: boolean;
  payload: RuntimeRoutinePayload;
}

export interface RuntimeProgram {
  id: string;
  name: string;
  mainRoutineId?: string;
  faultRoutineId?: string;
  inhibited: boolean;
  routines: RuntimeRoutine[];
}

export interface RuntimeTask {
  id: string;
  name: string;
  type: string;
  periodMs?: number;
  priority?: number;
  watchdogMs?: number;
  inhibited: boolean;
  /** Ordered scheduled programs for this task. */
  programs: RuntimeProgram[];
}

export interface RuntimeTag {
  /** Canonical runtime value path (e.g. "Tag" or "Program:ProgramName.Tag"). */
  path: string;
  name: string;
  scope: "controller" | "program";
  programName?: string;
  dataType: string;
  dimensions?: number[];
  /** Power-up value for this tag (scalar paths only; arrays/structs expand in `initialValues`). */
  initialValue?: RuntimeScalar;
  constant?: boolean;
  radix?: string;
  externalAccess?: string;
  description?: string;
}

export interface RuntimeIoPort {
  id?: string;
  type?: string;
  address?: string;
  upstream?: boolean;
  busSize?: number;
  safetyNetwork?: string;
}

export interface RuntimeModuleConnection {
  name?: string;
  rpi?: number;
  type?: string;
  priority?: string;
  unicast?: boolean;
  eventId?: number;
  programmaticallySendEventTrigger?: boolean;
  inputConnectionType?: string;
  inputProductionTrigger?: string;
  outputRedundantOwner?: boolean;
}

export interface RuntimeModuleProfileChannel {
  id?: string;
  label?: string;
  direction?: string;
  signal?: string;
  enabled?: boolean;
  dataFormat?: string;
  range?: string;
  diagnostic?: string;
}

export interface RuntimeIoModule {
  name: string;
  catalogNumber?: string;
  slot?: number;
  description?: string;
  parentModule?: string;
  parentPortId?: string;
  commPath?: string;
  vendor?: string;
  productType?: string;
  productCode?: string;
  major?: string;
  minor?: string;
  electronicKeying?: string;
  inhibited?: boolean;
  majorFault?: boolean;
  ports?: RuntimeIoPort[];
  connections?: RuntimeModuleConnection[];
  profileChannels?: RuntimeModuleProfileChannel[];
  /** Number of module profile channels referenced (catalog/profile reference count). */
  profileChannelCount?: number;
  /** Number of I/O connections bound on this module. */
  connectionCount?: number;
}

export interface RuntimeUdtMember {
  name: string;
  dataType: string;
  dimension?: number;
  dimensions?: number[];
  description?: string;
  radix?: string;
  externalAccess?: string;
  hidden?: boolean;
  target?: string;
  bitNumber?: number;
}

export interface RuntimeDataType {
  id: string;
  name: string;
  description?: string;
  family?: string;
  safetyClass?: string;
  members: RuntimeUdtMember[];
}

export interface RuntimeAoiParameter {
  name: string;
  dataType: string;
  usage?: string;
  required?: boolean;
  dimension?: number;
  dimensions?: number[];
  visible?: boolean;
  defaultValue?: string;
  description?: string;
  radix?: string;
  externalAccess?: string;
  constant?: boolean;
}

export interface RuntimeAoiLocalTag {
  name: string;
  dataType: string;
  dimension?: number;
  dimensions?: number[];
  description?: string;
  radix?: string;
  externalAccess?: string;
}

export interface RuntimeAddOnInstruction {
  id: string;
  name: string;
  description?: string;
  revision?: string;
  revisionExtension?: string;
  softwareRevision?: string;
  vendor?: string;
  signature?: string;
  createdDate?: string;
  createdBy?: string;
  editedDate?: string;
  editedBy?: string;
  revisionNote?: string;
  additionalHelpText?: string;
  protected?: boolean;
  protectionType?: string;
  safetyClass?: string;
  executePrescan?: boolean;
  executePostscan?: boolean;
  executeEnableInFalse?: boolean;
  parameters: RuntimeAoiParameter[];
  localTags: RuntimeAoiLocalTag[];
  routineNames: string[];
  /** Imported AOI logic bodies, when the source project made them available. */
  routines?: RuntimeRoutine[];
}

export interface RuntimeController {
  id: string;
  name: string;
  processorType?: string;
  catalogNumber?: string;
  firmwareRevision?: string;
  /** Ordered task execution model. */
  tasks: RuntimeTask[];
  /** I/O binding metadata (module catalog/profile references). */
  io: RuntimeIoModule[];
  /** UDT definitions preserved for upload/runtime inspection and tag layout. */
  dataTypes: RuntimeDataType[];
  /** AOI definitions preserved for inspection; execution gaps are reported as warnings. */
  addOnInstructions: RuntimeAddOnInstruction[];
}

/** Optional HMI runtime references, included only when the project carries HMI data. */
export interface RuntimeHmi {
  screenCount: number;
  /** Screen surface names, sorted for deterministic output. */
  screenNames: string[];
  /**
   * Full ESCO HMI project snapshot, when this runtime was compiled from an
   * HMI project. Legacy runtimes may contain only the summary fields above.
   */
  projectSnapshot?: HmiProject;
  /** Popup surface count, when an HMI project is supplied. */
  popupCount?: number;
  /** Number of controller references the HMI binds against. */
  controllerReferenceCount?: number;
  /** Total property bindings across every HMI surface element. */
  bindingCount?: number;
  /** Number of offline HMI recipe definitions preserved in the runtime snapshot. */
  recipeCount?: number;
  /**
   * HMI references preserved for review but not driven by the offline runtime:
   * unsupported graphic-element types, non-runtime-preview commands, and
   * unsupported-content items. The runtime never fakes their behavior.
   */
  unsupportedCount?: number;
}

export type RuntimeInstructionSourceLanguage = "ladder" | "structured-text";

/** A distinct ladder/ST opcode that the offline runtime preserves but does not execute. */
export interface RuntimePreservedInstruction {
  type: string;
  status: InstructionFidelityStatus;
  /** Occurrences of this opcode across all compiled ladder/ST routines. */
  count: number;
  /** Routine languages where this opcode was found, sorted for deterministic output. */
  sourceLanguages: RuntimeInstructionSourceLanguage[];
  /** Short, user-facing note on what the offline runtime does with this opcode. */
  summary: string;
}

/**
 * Honest accounting of how faithfully the compiled ladder/ST logic can be executed
 * offline. Built from the ESCO instruction catalog; project-defined AOIs with an
 * executable RLL body count as executable, protected/bodyless AOIs as preserved.
 */
export interface RuntimeInstructionFidelity {
  /** Total ladder/ST instruction occurrences inspected across the build. */
  total: number;
  /** Occurrences the offline runtime simulates (executable-simulation/-partial). */
  executable: number;
  /** Occurrences preserved for review but never simulated (model-only + review-only). */
  modelOnly: number;
  /** Occurrences not in the instruction catalog; preserved verbatim, never executed. */
  unsupported: number;
  /** Occurrence counts keyed by catalog fidelity status (stable, all keys present). */
  byStatus: Record<InstructionFidelityStatus, number>;
  /** Distinct preserved/unsupported opcodes, sorted by type for deterministic output. */
  preserved: RuntimePreservedInstruction[];
}

export interface RuntimeBuildSummary {
  controllerCount: number;
  taskCount: number;
  programCount: number;
  routineCount: number;
  rungCount: number;
  tagCount: number;
  ioModuleCount: number;
  /** Routine ids in compiled scan order across all controllers. */
  executionOrder: string[];
  /** How faithfully the compiled instructions execute offline (never fakes execution). */
  instructionFidelity: RuntimeInstructionFidelity;
  /** Non-blocking notes about anything compiled with caveats. */
  warnings: string[];
  /** Validation findings grouped by severity (informational; errors block the build). */
  validation: { error: number; warning: number; info: number };
}

/** The runtime payload (everything except the file-level checksum envelope). */
export interface EscoRuntime {
  formatName: typeof EASRT_FORMAT_NAME;
  extension: typeof EASRT_EXTENSION;
  schemaVersion: number;
  runtimeVersion: string;
  /** ESCO-native provenance — never sourced from a proprietary controller file. */
  provenance: {
    source: "esco-native";
    builtBy: "ESCO Automation Studio";
    appVersion: string;
    builtAt: string;
  };
  identity: {
    projectId: string;
    projectName: string;
    description?: string;
  };
  controllers: RuntimeController[];
  tags: RuntimeTag[];
  /** Power-up tag value map (simulation-ready runtime state). */
  initialValues: Record<string, RuntimeScalar>;
  hmi?: RuntimeHmi;
  build: RuntimeBuildSummary;
}

/** The `.easruntime` file envelope: the runtime payload plus an integrity checksum. */
export interface EscoRuntimeFile {
  formatName: typeof EASRT_FORMAT_NAME;
  extension: typeof EASRT_EXTENSION;
  schemaVersion: number;
  checksum: { algorithm: typeof EASRT_CHECKSUM_ALGORITHM; value: string };
  runtime: EscoRuntime;
}

// ---------------------------------------------------------------------------
// SHA-256 (dependency-free; browser + Node). Standard FIPS 180-4 implementation.
// ---------------------------------------------------------------------------

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

/** SHA-256 of a UTF-8 string, returned as lowercase hex. */
export function sha256Hex(message: string): string {
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

/** The exact bytes a runtime payload is checksummed over (stable key order). */
export function runtimeChecksumInput(runtime: EscoRuntime): string {
  return canonicalJson(runtime);
}

/** Compute the integrity checksum of a runtime payload. */
export function runtimeChecksum(runtime: EscoRuntime): string {
  return sha256Hex(runtimeChecksumInput(runtime));
}

// ---------------------------------------------------------------------------
// Serialize / parse / validate
// ---------------------------------------------------------------------------

/** Serialize a runtime payload into `.easruntime` file text (pretty JSON with checksum). */
export function serializeRuntime(runtime: EscoRuntime): string {
  const file: EscoRuntimeFile = {
    formatName: EASRT_FORMAT_NAME,
    extension: EASRT_EXTENSION,
    schemaVersion: runtime.schemaVersion,
    checksum: { algorithm: EASRT_CHECKSUM_ALGORITHM, value: runtimeChecksum(runtime) },
    runtime,
  };
  return serializeNativeJson(file);
}

/** True when a file name carries the ESCO runtime extension. */
export function isEscoRuntimeFileName(fileName: string): boolean {
  return fileNameMatchesEscoNativeFormat(fileName, "runtime");
}

export interface LoadRuntimeResult {
  ok: boolean;
  runtime?: EscoRuntime;
  checksum?: { expected: string; actual: string; valid: boolean };
  error?: string;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Parse and verify `.easruntime` file text. Rejects malformed JSON, wrong format,
 * unsupported schema versions, and checksum mismatches. `fileName` (optional)
 * is validated against the `.easruntime` extension when provided. Legacy
 * `.easrt` filenames are accepted on load for compatibility.
 */
export function parseRuntimeFile(text: string, fileName?: string): LoadRuntimeResult {
  if (fileName !== undefined && !isEscoRuntimeFileName(fileName)) {
    return {
      ok: false,
      error: `Not an ESCO Runtime file: "${fileName}" must use the ${EASRT_EXTENSION} extension.`,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: "Corrupt ESCO Runtime: the file is not valid JSON." };
  }
  if (!isObject(parsed)) {
    return { ok: false, error: "Corrupt ESCO Runtime: expected a runtime file object." };
  }
  if (parsed.formatName !== EASRT_FORMAT_NAME) {
    return { ok: false, error: `Not an ESCO Runtime file: missing "${EASRT_FORMAT_NAME}" format marker.` };
  }
  if (typeof parsed.extension !== "string" || !isEscoRuntimeFileName(parsed.extension)) {
    return { ok: false, error: `Corrupt ESCO Runtime: expected extension ${EASRT_EXTENSION}.` };
  }
  if (typeof parsed.schemaVersion !== "number") {
    return { ok: false, error: "Corrupt ESCO Runtime: missing schema version." };
  }
  if (parsed.schemaVersion > EASRT_SCHEMA_VERSION) {
    return {
      ok: false,
      error: `Unsupported ESCO Runtime schema version ${parsed.schemaVersion} (this build supports up to ${EASRT_SCHEMA_VERSION}). Update ESCO Automation Studio.`,
    };
  }
  if (!isObject(parsed.runtime)) {
    return { ok: false, error: "Corrupt ESCO Runtime: missing runtime payload." };
  }
  const checksumNode = parsed.checksum;
  if (
    !isObject(checksumNode) ||
    checksumNode.algorithm !== EASRT_CHECKSUM_ALGORITHM ||
    typeof checksumNode.value !== "string"
  ) {
    return { ok: false, error: "Corrupt ESCO Runtime: missing integrity checksum." };
  }

  const runtime = parsed.runtime as unknown as EscoRuntime;
  if (typeof runtime.schemaVersion !== "number" || runtime.schemaVersion > EASRT_SCHEMA_VERSION) {
    return {
      ok: false,
      error: `Unsupported ESCO Runtime payload schema version ${String(runtime.schemaVersion)} (this build supports up to ${EASRT_SCHEMA_VERSION}). Update ESCO Automation Studio.`,
    };
  }
  if (typeof runtime.extension !== "string" || !isEscoRuntimeFileName(runtime.extension)) {
    return { ok: false, error: `Corrupt ESCO Runtime: expected runtime extension ${EASRT_EXTENSION}.` };
  }
  const expected = String(checksumNode.value);
  const actual = runtimeChecksum(runtime);
  const legacyActual = sha256Hex(JSON.stringify(runtime));
  if (expected !== actual) {
    if (expected !== legacyActual) {
      return {
        ok: false,
        checksum: { expected, actual, valid: false },
        error: "ESCO Runtime integrity check failed: the checksum does not match the runtime content (the file is corrupt or was modified).",
      };
    }
  }

  if (runtime.provenance?.source !== "esco-native") {
    return { ok: false, error: "Corrupt ESCO Runtime: provenance is not ESCO-native." };
  }

  return { ok: true, runtime, checksum: { expected, actual: expected === actual ? actual : legacyActual, valid: true } };
}
