import type { AoiParameter, PlcProject } from "@esco/core";
import type { ValidationFinding, ValidationRule } from "./types";

/**
 * An Add-On Instruction's read-only `Constant="true"` flag is only valid on an
 * **Input** parameter. Input parameters pass by value and may be pinned as a
 * read-only constant (exactly like a controller/program constant tag), but an
 * Output or InOut parameter is written by the AOI body — Output is copied out at
 * the call boundary and InOut aliases the caller's tag in place — so neither can
 * be declared constant. Studio 5000 rejects the offending definition at verify
 * time; the parameter must drop `Constant` (or, if it really is a read-only
 * input, be declared `Input`).
 *
 * AOI parameters are imported read-only metadata (`extractAddOnInstructions`
 * reads `<Parameter ... Constant="true">` verbatim and the exporter writes it
 * back unchanged), so a constant Output/InOut parameter authored offline — or
 * set on an L5X assembled elsewhere — survives a round-trip and reaches Studio
 * 5000 as a verify error. The parameter interface is public metadata that
 * survives source protection, so this check applies to every AOI, protected or
 * not — it never needs the (possibly unavailable) logic body. It is the
 * read-only-flag companion to `aoi-parameter-type` (Input/Output atomic-type
 * check) and mirrors the existing tag/program-parameter constant handling.
 *
 * The check is deliberately conservative to avoid false positives on
 * legitimately-imported files: it fires only when it can positively prove the
 * constant flag is set on a non-Input parameter — a parameter whose usage is
 * missing or unrecognized is left alone (a clean Studio export never writes
 * `Constant="true"` on an Output or InOut parameter, so well-formed files never
 * trigger it).
 */

function isConstantViolation(parameter: AoiParameter): "Output" | "InOut" | null {
  if (parameter.constant !== true) return null;
  const usage = parameter.usage?.trim().toLowerCase();
  if (usage === "output") return "Output";
  if (usage === "inout") return "InOut";
  return null;
}

export const aoiParameterConstant: ValidationRule = {
  id: "aoi-parameter-constant",
  name: "AOI constant parameter usage",
  category: "type",
  severity: "error",
  run({ project }: { project: PlcProject }) {
    const findings: ValidationFinding[] = [];
    for (const controller of project.controllers) {
      for (const aoi of controller.addOnInstructions) {
        for (const parameter of aoi.parameters) {
          const usageLabel = isConstantViolation(parameter);
          if (!usageLabel) continue;
          findings.push({
            ruleId: "aoi-parameter-constant",
            severity: "error",
            message: `AOI "${aoi.name}" ${usageLabel} parameter "${parameter.name}" is marked Constant; controller-editor rules allow the read-only Constant flag only on Input parameters, because an Output/InOut parameter is written by the instruction.`,
            target: `${controller.name}/${aoi.name}.${parameter.name}`,
          });
        }
      }
    }
    return findings;
  },
};
