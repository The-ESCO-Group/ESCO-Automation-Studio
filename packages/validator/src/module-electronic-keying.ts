import type { PlcProject } from "@esco/core";
import type { ValidationFinding, ValidationRule } from "./types";

/**
 * An I/O module's electronic keying (`ElectronicKeying`) must be one of the
 * supported keying states: `ExactMatch`, `CompatibleModule`, `Disabled`, or
 * imported/custom profile metadata carried as `Custom`.
 * The keying determines how strictly the controller checks the physical
 * module's identity (vendor / product type / catalog / revision) against the
 * configured profile before it opens the connection, and Studio 5000 offers
 * only those three choices in the module's General tab. A module carrying any
 * other keying string will not verify ("invalid value" on the module).
 *
 * The importer (`extractStructure.ts`) copies the `ElectronicKeying` attribute
 * verbatim whenever it is present, and the exporter (`exportL5X.ts`) writes it
 * back unchanged, so a keying value authored offline — or surviving from a
 * hand-edited L5X — round-trips to Studio 5000 exactly as written. A module with
 * no keying attribute is left alone: the absent attribute means "inherit the
 * catalog default", which is always one of the valid values, and the importer
 * only sets the field when the attribute is actually present.
 *
 * This is the value companion to `module-slot-conflict` / `duplicate-module-name`
 * (which guard a module's slot and name): those catch structural collisions in
 * the I/O tree, this catches a single module attribute Studio 5000 range-checks
 * at verify time. The comparison is exact and case-sensitive, matching Logix —
 * "exactmatch" and "Exact Match" are both rejected, since the controller stores
 * the keying as a fixed enumerated token, not free text.
 */
const VALID_KEYING = ["ExactMatch", "CompatibleModule", "Disabled", "Custom"] as const;

export const moduleElectronicKeying: ValidationRule = {
  id: "module-electronic-keying",
  name: "Module electronic keying",
  category: "project-structure",
  severity: "error",
  run({ project }: { project: PlcProject }) {
    const findings: ValidationFinding[] = [];
    for (const controller of project.controllers) {
      for (const module of controller.ioConfiguration.modules) {
        const keying = module.electronicKeying;
        // Absent attribute = inherit the catalog default; only a present,
        // out-of-set value is a verify error.
        if (keying == null) continue;
        if (!VALID_KEYING.includes(keying as (typeof VALID_KEYING)[number])) {
          findings.push({
            ruleId: "module-electronic-keying",
            severity: "error",
            message: `I/O module "${module.name}" has electronic keying "${keying}"; controller module rules accept only ${VALID_KEYING.join(", ")}.`,
            target: `${controller.name}/${module.name}`,
          });
        }
      }
    }
    return findings;
  },
};
