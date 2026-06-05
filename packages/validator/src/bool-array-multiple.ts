import { arrayDimensionsOf, type PlcProject } from "@esco/core";
import type { ValidationFinding, ValidationRule } from "./types";

/**
 * A Logix BOOL array's dimension must be a multiple of 32. BOOLs are packed into
 * 32-bit words in the controller's tag-memory layout, so an array of BOOLs is
 * allocated a whole number of words: Studio 5000 rejects a declaration such as
 * `BOOL[10]` at verify time ("the array dimension must be a multiple of 32") and
 * snaps the field to the next multiple of 32 when you author it in the tag
 * editor. This is the BOOL-specific declaration-time companion to
 * `array-dimension-limit` (which only bounds the *rank* at three) — neither it
 * nor the runtime subscript checks in `ladder-operands` look at the *size* of a
 * BOOL dimension.
 *
 * Scope mirrors `array-dimension-limit`: controller/program tags, UDT members,
 * and AOI local tags — the surfaces that carry their own type declaration. Only
 * **one-dimensional** BOOL arrays are checked; the multiple-of-32 packing rule
 * for higher-rank BOOL arrays is left untouched to avoid false positives, since
 * Logix applies it per-dimension in ways this offline model does not pin down.
 * A scalar BOOL (no dimensions) is always legal and is left alone. The data type
 * is matched case-insensitively, as Logix treats type names. Reported as an
 * error because the tag/type will not verify until the dimension is corrected.
 */
export const boolArrayMultiple: ValidationRule = {
  id: "bool-array-multiple",
  name: "BOOL array dimension multiple of 32",
  category: "syntax",
  severity: "error",
  run({ project }: { project: PlcProject }) {
    const findings: ValidationFinding[] = [];
    const WORD_BITS = 32;

    const check = (
      kind: string,
      name: string,
      value: { dataType: string; dimension?: number; dimensions?: readonly number[] },
      target: string,
    ): void => {
      if (value.dataType?.toUpperCase() !== "BOOL") return;
      const dimensions = arrayDimensionsOf(value);
      // Only 1-D BOOL arrays are pinned down here (see header note).
      if (dimensions.length !== 1) return;
      const length = dimensions[0]!;
      if (length % WORD_BITS !== 0) {
        findings.push({
          ruleId: "bool-array-multiple",
          severity: "error",
          message: `${kind} "${name}" is a BOOL array of ${length}; a BOOL array dimension must be a multiple of ${WORD_BITS}.`,
          target,
        });
      }
    };

    for (const controller of project.controllers) {
      for (const tag of controller.controllerTags) {
        check("Controller tag", tag.name, tag, controller.name);
      }
      for (const program of controller.programs) {
        for (const tag of program.programTags) {
          check("Program tag", tag.name, tag, `${controller.name}/${program.name}`);
        }
      }
      for (const udt of controller.dataTypes) {
        for (const member of udt.members) {
          check(`Member of "${udt.name}"`, member.name, member, `${controller.name}/${udt.name}`);
        }
      }
      for (const aoi of controller.addOnInstructions) {
        for (const localTag of aoi.localTags) {
          check(`Local tag of "${aoi.name}"`, localTag.name, localTag, `${controller.name}/${aoi.name}`);
        }
      }
    }
    return findings;
  },
};
