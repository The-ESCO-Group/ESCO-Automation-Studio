import type { Controller, PlcProject, Program, Routine, Tag, UserDefinedType } from "@esco/core";
import type { CompareDifference, CompareResult, ControllerIdentity } from "./types";

export const PROJECT_SIGNATURE_ALGORITHM = "esco-sha256-stable-project-v1";

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stable(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const rotr = (value: number, bits: number): number => ((value >>> bits) | (value << (32 - bits))) >>> 0;
const hex8 = (value: number): string => (value >>> 0).toString(16).padStart(8, "0");

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
    for (let index = 0; index < 16; index += 1) w[index] = view.getUint32(chunk + index * 4);
    for (let index = 16; index < 64; index += 1) {
      const w15 = w[index - 15]!;
      const w2 = w[index - 2]!;
      const s0 = rotr(w15, 7) ^ rotr(w15, 18) ^ (w15 >>> 3);
      const s1 = rotr(w2, 17) ^ rotr(w2, 19) ^ (w2 >>> 10);
      w[index] = (w[index - 16]! + s0 + w[index - 7]! + s1) >>> 0;
    }

    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let index = 0; index < 64; index += 1) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + ch + SHA256_K[index]! + w[index]!) >>> 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + temp1) >>> 0; d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }

    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
  }

  return hex8(h0) + hex8(h1) + hex8(h2) + hex8(h3) + hex8(h4) + hex8(h5) + hex8(h6) + hex8(h7);
}

function scrubGeneratedIds(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrubGeneratedIds);
  if (value && typeof value === "object") {
    const record: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (key === "id" || key.endsWith("Id")) continue;
      record[key] = scrubGeneratedIds(entry);
    }
    return record;
  }
  return value;
}

function tagSignature(tag: Tag): Record<string, unknown> {
  return {
    name: tag.name,
    dataType: tag.dataType,
    scope: tag.scope,
    value: tag.value,
  };
}

function routineSignature(routine: Routine): Record<string, unknown> {
  return {
    name: routine.name,
    language: routine.language,
    structuredText: routine.structuredText,
    sourceText: routine.sourceText,
    ladder: scrubGeneratedIds(routine.ladder),
  };
}

function programSignature(program: Program): Record<string, unknown> {
  const routineNameById = new Map(program.routines.map((routine) => [routine.id, routine.name]));
  return {
    name: program.name,
    mainRoutine: program.mainRoutineId ? routineNameById.get(program.mainRoutineId) : undefined,
    faultRoutine: program.faultRoutineId ? routineNameById.get(program.faultRoutineId) : undefined,
    inhibited: program.inhibited,
    safetyClass: program.safetyClass,
    useAsFolder: program.useAsFolder,
    parameters: (program.parameters ?? []).map((parameter) => ({
      name: parameter.name,
      dataType: parameter.dataType,
      usage: parameter.usage,
      required: parameter.required,
      dimensions: parameter.dimensions ?? (parameter.dimension !== undefined ? [parameter.dimension] : undefined),
    })).sort(byName),
    programTags: program.programTags.map(tagSignature).sort(byName),
    routines: program.routines.map(routineSignature).sort(byName),
  };
}

function dataTypeSignature(dataType: UserDefinedType): Record<string, unknown> {
  return {
    name: dataType.name,
    family: dataType.family,
    safetyClass: dataType.safetyClass,
    members: dataType.members.map((member) => ({
      name: member.name,
      dataType: member.dataType,
      dimensions: member.dimensions ?? (member.dimension !== undefined ? [member.dimension] : undefined),
      radix: member.radix,
    })).sort(byName),
  };
}

function controllerSignature(controller: Controller | undefined): Record<string, unknown> {
  const programNameById = new Map((controller?.programs ?? []).map((program) => [program.id, program.name]));
  return {
    name: controller?.name,
    processorType: controller?.processorType,
    firmwareRevision: controller?.firmwareRevision,
    catalogNumber: controller?.catalogNumber,
    safetyInfo: scrubGeneratedIds(controller?.safetyInfo),
    redundancyInfo: scrubGeneratedIds(controller?.redundancyInfo),
    tasks: (controller?.tasks ?? []).map((task) => ({
      name: task.name,
      type: task.type,
      periodMs: task.periodMs,
      priority: task.priority,
      inhibited: task.inhibited,
      scheduledPrograms: task.scheduledProgramIds.map((id) => programNameById.get(id) ?? id).sort(),
    })).sort(byName),
    tags: (controller?.controllerTags ?? []).map(tagSignature).sort((a, b) => {
      const left = typeof a.name === "string" ? a.name : "";
      const right = typeof b.name === "string" ? b.name : "";
      return left.localeCompare(right);
    }),
    programs: (controller?.programs ?? []).map(programSignature).sort(byName),
    dataTypes: (controller?.dataTypes ?? []).map(dataTypeSignature).sort(byName),
    addOnInstructions: (controller?.addOnInstructions ?? []).map((aoi) => ({
      name: aoi.name,
      revision: aoi.revision,
      vendor: aoi.vendor,
      parameters: aoi.parameters.map((parameter) => ({
        name: parameter.name,
        dataType: parameter.dataType,
        usage: parameter.usage,
        required: parameter.required,
        dimensions: parameter.dimensions ?? (parameter.dimension !== undefined ? [parameter.dimension] : undefined),
      })).sort(byName),
      localTags: aoi.localTags.map((tag) => ({
        name: tag.name,
        dataType: tag.dataType,
        dimensions: tag.dimensions ?? (tag.dimension !== undefined ? [tag.dimension] : undefined),
      })).sort(byName),
      routines: (aoi.routines ?? []).map(routineSignature).sort(byName),
    })).sort(byName),
  };
}

function byName(left: Record<string, unknown>, right: Record<string, unknown>): number {
  const a = typeof left.name === "string" ? left.name : "";
  const b = typeof right.name === "string" ? right.name : "";
  return a.localeCompare(b);
}

export function localProjectSignature(project: PlcProject): string {
  const digest = sha256Hex(stable({
    name: project.name,
    controllers: project.controllers.map(controllerSignature),
  }));
  return `${PROJECT_SIGNATURE_ALGORITHM}:${digest}`;
}

export function localProjectIdentity(project: PlcProject): ControllerIdentity {
  const controller = project.controllers[0];
  return {
    controllerName: controller?.name,
    controllerType: controller?.processorType ?? controller?.catalogNumber,
    firmwareRevision: controller?.firmwareRevision,
    projectName: project.name,
    projectSignature: localProjectSignature(project),
    projectSignatureAlgorithm: PROJECT_SIGNATURE_ALGORITHM,
    projectSignatureSource: "local-esco-project",
    vendor: "ESCO",
    productName: "ESCO Automation Studio Project",
  };
}

function diff(
  differences: CompareDifference[],
  field: CompareDifference["field"],
  local: string | undefined,
  online: string | undefined,
  severity: CompareDifference["severity"],
): void {
  if (local && online && local !== online) {
    differences.push({ field, local, online, severity });
  }
}

function requireProof(
  differences: CompareDifference[],
  field: CompareDifference["field"],
  local: string | undefined,
  online: string | undefined,
): boolean {
  if (local && online) return true;
  differences.push({ field, local, online, severity: "blocking" });
  return false;
}

export function compareControllerIdentity(
  localIdentity: ControllerIdentity | undefined,
  controllerIdentity: ControllerIdentity | undefined,
): CompareResult {
  if (!localIdentity || !controllerIdentity) {
    return {
      state: "unknown",
      matched: false,
      localIdentity,
      controllerIdentity,
      differences: [],
      message: "Controller match cannot be proven; defaulting to read-only.",
    };
  }

  const differences: CompareDifference[] = [];
  const requiredEvidencePresent = [
    requireProof(differences, "controllerName", localIdentity.controllerName, controllerIdentity.controllerName),
    requireProof(differences, "controllerType", localIdentity.controllerType, controllerIdentity.controllerType),
    requireProof(differences, "projectName", localIdentity.projectName, controllerIdentity.projectName),
    requireProof(differences, "projectSignature", localIdentity.projectSignature, controllerIdentity.projectSignature),
  ].every(Boolean);

  diff(differences, "controllerName", localIdentity.controllerName, controllerIdentity.controllerName, "blocking");
  diff(differences, "controllerType", localIdentity.controllerType, controllerIdentity.controllerType, "blocking");
  diff(differences, "firmwareRevision", localIdentity.firmwareRevision, controllerIdentity.firmwareRevision, "warning");
  diff(differences, "projectName", localIdentity.projectName, controllerIdentity.projectName, "blocking");
  diff(differences, "projectSignature", localIdentity.projectSignature, controllerIdentity.projectSignature, "blocking");

  const blockingMismatch = differences.some(
    (entry) => entry.severity === "blocking" && entry.local && entry.online && entry.local !== entry.online,
  );
  if (blockingMismatch) {
    return {
      state: "mismatched",
      matched: false,
      localIdentity,
      controllerIdentity,
      differences,
      message: "Controller identity does not match the local project; writes stay blocked.",
    };
  }

  if (!requiredEvidencePresent) {
    return {
      state: "unknown",
      matched: false,
      localIdentity,
      controllerIdentity,
      differences,
      message: "Required controller identity evidence is missing; defaulting to read-only.",
    };
  }

  return {
    state: "matched",
    matched: true,
    localIdentity,
    controllerIdentity,
    differences,
    message: differences.length
      ? "Controller identity matches with non-blocking warnings."
      : "Controller identity and local project match.",
  };
}
