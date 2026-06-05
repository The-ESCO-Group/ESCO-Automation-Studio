import { STRUCTURED_TYPES, arrayDimensionsOf, arrayDimensionSuffix } from "@esco/core";
import type { AoiParameter, PlcProject } from "@esco/core";
import type { ValidationFinding, ValidationRule } from "./types";

/**
 * An Add-On Instruction's Input and Output parameters must be an atomic data
 * type (BOOL / SINT / INT / DINT / LINT / REAL / LREAL): they are passed by
 * value through the instruction face, so Logix does not allow an Input or
 * Output parameter to be an array or a structure (a UDT, a predefined structure
 * such as TIMER/COUNTER/CONTROL, or STRING). Anything that must be passed by
 * reference — an array or a structure — has to be declared **InOut** instead.
 * Studio 5000 rejects the offending definition at verify time ("Parameter
 * '<name>' must be an atomic data type" / "Only InOut parameters can be arrays
 * or structures").
 *
 * AOI parameters are imported read-only metadata (`extractAddOnInstructions`
 * reads `<Parameters><Parameter>` with its verbatim `DataType`, `Usage`, and
 * dimensions) and the exporter writes them back unchanged, so a structured or
 * array Input/Output parameter that was authored offline — or set on an L5X
 * assembled elsewhere — survives a round-trip and reaches Studio 5000 as a
 * verify error. No existing rule checks parameter usage against type; this is
 * the AOI-definition companion to the call-site `missing-aoi-parameter` check
 * and to the declaration checks `radix-data-type` (radix) and
 * `array-dimension-limit` (dimensions), reported as an error because the AOI
 * will not verify until the parameter is changed to InOut (or its type to an
 * atomic).
 *
 * The check is deliberately conservative to avoid false positives on
 * legitimately-imported files: it fires only when it can positively prove the
 * Input/Output parameter is non-atomic — it carries array dimensions, or its
 * type is a known structure (a predefined structured type, STRING, or a UDT
 * defined in the same controller). An unrecognized type name (e.g. an atomic on
 * a controller this build does not model, or a type whose definition was not
 * imported) is left alone. InOut parameters are skipped entirely — they are
 * allowed to be arrays and structures.
 */

function isKnownStructure(dataType: string, udtNamesUpper: ReadonlySet<string>): boolean {
  const upper = dataType.toUpperCase();
  return upper === "STRING" || upper in STRUCTURED_TYPES || udtNamesUpper.has(upper);
}

function violation(
  parameter: AoiParameter,
  udtNamesUpper: ReadonlySet<string>,
): { kind: "array" | "structure"; detail: string } | null {
  const usage = parameter.usage?.toLowerCase();
  if (usage !== "input" && usage !== "output") return null;
  const dimensions = arrayDimensionsOf(parameter);
  if (dimensions.length > 0) {
    return { kind: "array", detail: `${parameter.dataType}${arrayDimensionSuffix(parameter)}` };
  }
  if (isKnownStructure(parameter.dataType, udtNamesUpper)) {
    return { kind: "structure", detail: parameter.dataType };
  }
  return null;
}

export const aoiParameterType: ValidationRule = {
  id: "aoi-parameter-type",
  name: "AOI Input/Output parameter type",
  category: "type",
  severity: "error",
  run({ project }: { project: PlcProject }) {
    const findings: ValidationFinding[] = [];
    for (const controller of project.controllers) {
      const udtNamesUpper = new Set(controller.dataTypes.map((udt) => udt.name.toUpperCase()));
      for (const aoi of controller.addOnInstructions) {
        for (const parameter of aoi.parameters) {
          const error = violation(parameter, udtNamesUpper);
          if (!error) continue;
          const usageLabel = parameter.usage === "Output" ? "Output" : "Input";
          const reason =
            error.kind === "array"
              ? `is an array (${error.detail})`
              : `has structured type "${error.detail}"`;
          findings.push({
            ruleId: "aoi-parameter-type",
            severity: "error",
            message: `AOI "${aoi.name}" ${usageLabel} parameter "${parameter.name}" ${reason}; controller-editor Input and Output parameters must be an atomic type — pass an array or structure through an InOut parameter instead.`,
            target: `${controller.name}/${aoi.name}.${parameter.name}`,
          });
        }
      }
    }
    return findings;
  },
};
