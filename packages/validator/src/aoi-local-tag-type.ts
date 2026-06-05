import { arrayDimensionSuffix, arrayDimensionsOf } from "@esco/core";
import type { AoiLocalTag, PlcProject } from "@esco/core";
import type { ValidationFinding, ValidationRule } from "./types";

const BANNED_LOCAL_TAG_TYPES = new Set([
  "ALARM_ANALOG",
  "ALARM_DIGITAL",
  "MESSAGE",
  "MODULE",
  "MOTION_GROUP",
  "MOTION_INSTRUCTION",
  "COORDINATE_SYSTEM",
  "CAM",
  "CAM_PROFILE",
  "OUTPUT_CAM",
  "OUTPUT_COMPENSATION",
]);

/**
 * Controller-editor rules allow ordinary private local tags inside AOI
 * definitions, but reject local tags that must be shared with controller/runtime objects:
 * MESSAGE, MODULE, ALARM_ANALOG, ALARM_DIGITAL, and motion data types must be
 * passed as InOut parameters instead. AOI local tags also follow UDT-style array
 * limits and can only be single-dimensional arrays.
 */

function normalizedType(localTag: AoiLocalTag): string {
  return localTag.dataType.trim().toUpperCase();
}

function isMotionLocalTagType(type: string): boolean {
  return type === "AXIS" || type.startsWith("AXIS_") || BANNED_LOCAL_TAG_TYPES.has(type);
}

export const aoiLocalTagType: ValidationRule = {
  id: "aoi-local-tag-type",
  name: "AOI local tag type",
  category: "type",
  severity: "error",
  run({ project }: { project: PlcProject }) {
    const findings: ValidationFinding[] = [];

    for (const controller of project.controllers) {
      for (const aoi of controller.addOnInstructions) {
        for (const localTag of aoi.localTags) {
          const target = `${controller.name}/${aoi.name}.${localTag.name}`;
          const dimensions = arrayDimensionsOf(localTag);
          if (dimensions.length > 1) {
            findings.push({
              ruleId: "aoi-local-tag-type",
              severity: "error",
              message: `AOI "${aoi.name}" local tag "${localTag.name}" is declared as ${localTag.dataType}${arrayDimensionSuffix(localTag)}; controller-editor rules permit only single-dimension arrays for Add-On Instruction local tags.`,
              target,
            });
          }

          const type = normalizedType(localTag);
          if (isMotionLocalTagType(type)) {
            findings.push({
              ruleId: "aoi-local-tag-type",
              severity: "error",
              message: `AOI "${aoi.name}" local tag "${localTag.name}" uses data type "${localTag.dataType}"; controller-editor rules do not allow MESSAGE, MODULE, alarm, or motion data types as Add-On Instruction local tags. Pass this data through an InOut parameter instead.`,
              target,
            });
          }
        }
      }
    }

    return findings;
  },
};
