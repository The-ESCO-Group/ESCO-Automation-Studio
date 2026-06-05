import type { PlcProject } from "@esco/core";
import type { ValidationFinding, ValidationRule } from "./types";

/**
 * A tag, UDT member, or AOI parameter / local tag may only carry a display
 * Radix that is valid for its atomic data type. Studio 5000 enforces this at
 * verify time ("Invalid radix for this data type"): a REAL/LREAL displays only
 * as Float or Exponential, an integer (SINT/INT/DINT/LINT) as
 * Binary/Octal/Decimal/Hex/ASCII (LINT additionally as Date/Time), and a BOOL
 * only as Binary or Decimal. A cross-domain mismatch — Float on a DINT, Hex on
 * a REAL, ASCII on a BOOL — is rejected.
 *
 * The model preserves `radix` verbatim as imported (it is display-only metadata,
 * mirrored across {@link Tag}, {@link UdtMember}, {@link AoiParameter}, and
 * {@link AoiLocalTag}) and the exporter writes it back unchanged, so a radix that
 * was edited offline — or set on an L5X assembled elsewhere — survives a
 * round-trip and reaches Studio 5000 as a verify error. No existing rule checks
 * the radix/type relationship; this is the radix companion to the declaration
 * checks `array-dimension-limit` (dimensions) and `alias-external-access`
 * (access), reported as an error because the tag/type will not verify until the
 * radix is corrected.
 *
 * The check is deliberately conservative to avoid false positives on
 * legitimately-imported files: it fires only when both the data type is a known
 * atomic (the verbatim L5X type, not the collapsed offline atom — `INT`/`SINT`/
 * `LINT` are kept distinct) and the radix normalizes to a recognized Logix
 * display style. Structured/UDT/STRING/alias types and unrecognized or absent
 * radices (`NullType`, blank) are skipped — Logix leaves those display-only and
 * does not constrain them the same way.
 */

// Allowed display radices per atomic data type, normalized (lower-cased, spaces
// stripped). Mirrors the Style options Studio 5000 offers per type.
const ALLOWED_RADICES: Record<string, ReadonlySet<string>> = {
  BOOL: new Set(["binary", "decimal"]),
  SINT: new Set(["binary", "octal", "decimal", "hex", "ascii"]),
  INT: new Set(["binary", "octal", "decimal", "hex", "ascii"]),
  DINT: new Set(["binary", "octal", "decimal", "hex", "ascii"]),
  // LINT additionally supports the Date/Time styles.
  LINT: new Set(["binary", "octal", "decimal", "hex", "ascii", "date/time", "date/time(ns)"]),
  REAL: new Set(["float", "exponential"]),
  LREAL: new Set(["float", "exponential"]),
};

// Every radix string the matrix above recognizes. A radix outside this set
// (e.g. "NullType", "Custom", blank) is left alone rather than reported.
const RECOGNIZED_RADICES: ReadonlySet<string> = new Set(
  Object.values(ALLOWED_RADICES).flatMap((set) => [...set]),
);

// Logix display-style spelling for each normalized radix token, used to phrase
// the "Logix permits …" list in the finding message.
const RADIX_LABELS: Record<string, string> = {
  binary: "Binary",
  octal: "Octal",
  decimal: "Decimal",
  hex: "Hex",
  ascii: "ASCII",
  float: "Float",
  exponential: "Exponential",
  "date/time": "Date/Time",
  "date/time(ns)": "Date/Time (ns)",
};

function normalizeRadix(radix: string): string {
  return radix.toLowerCase().replace(/\s+/g, "");
}

interface RadixBearer {
  dataType: string;
  radix?: string;
}

/**
 * Returns the verify-error message for an invalid radix/type pairing, or null
 * when the pairing is valid or out of scope (unknown type, unrecognized radix).
 */
function radixError(entity: RadixBearer): { authored: string; allowed: ReadonlySet<string> } | null {
  if (!entity.radix) return null;
  const allowed = ALLOWED_RADICES[entity.dataType.toUpperCase()];
  if (!allowed) return null;
  const normalized = normalizeRadix(entity.radix);
  if (!RECOGNIZED_RADICES.has(normalized)) return null;
  if (allowed.has(normalized)) return null;
  return { authored: entity.radix, allowed };
}

export const radixDataType: ValidationRule = {
  id: "radix-data-type",
  name: "Radix matches data type",
  category: "type",
  severity: "error",
  run({ project }: { project: PlcProject }) {
    const findings: ValidationFinding[] = [];
    const report = (entity: RadixBearer, kind: string, name: string, target: string): void => {
      const error = radixError(entity);
      if (!error) return;
      findings.push({
        ruleId: "radix-data-type",
        severity: "error",
        message: `${kind} "${name}" displays as ${error.authored}, which is not a valid radix for a ${entity.dataType}; controller display rules permit ${[...error.allowed].map((radix) => RADIX_LABELS[radix] ?? radix).join(", ")}.`,
        target,
      });
    };

    for (const controller of project.controllers) {
      for (const tag of controller.controllerTags) {
        report(tag, "Tag", tag.name, `${controller.name}/${tag.name}`);
      }
      for (const program of controller.programs) {
        for (const tag of program.programTags) {
          report(tag, "Tag", tag.name, `${controller.name}/${program.name}/${tag.name}`);
        }
      }
      for (const udt of controller.dataTypes) {
        for (const member of udt.members) {
          report(member, "Member", `${udt.name}.${member.name}`, `${controller.name}/${udt.name}.${member.name}`);
        }
      }
      for (const aoi of controller.addOnInstructions) {
        for (const parameter of aoi.parameters) {
          report(parameter, "Parameter", `${aoi.name}.${parameter.name}`, `${controller.name}/${aoi.name}.${parameter.name}`);
        }
        for (const localTag of aoi.localTags) {
          report(localTag, "Local tag", `${aoi.name}.${localTag.name}`, `${controller.name}/${aoi.name}.${localTag.name}`);
        }
      }
    }
    return findings;
  },
};
