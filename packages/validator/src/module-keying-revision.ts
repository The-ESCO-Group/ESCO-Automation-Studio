import type { PlcProject } from "@esco/core";
import type { ValidationFinding, ValidationRule } from "./types";

/**
 * Electronic keying that compares revisions requires a revision to compare
 * against. When an I/O module's `ElectronicKeying` is `ExactMatch` or
 * `CompatibleModule`, the controller checks the physical module's firmware
 * revision against the configured profile before it opens the connection —
 * `ExactMatch` demands the major *and* minor revision match, `CompatibleModule`
 * demands the major match and the minor be compatible. A keyed profile is
 * therefore only meaningful with a major and minor revision attached, and
 * Studio 5000 populates both from the module catalog whenever keying is set to
 * either value. A module that asks for `ExactMatch`/`CompatibleModule` keying
 * but carries no `Major`/`Minor` revision has an incomplete keyed profile and
 * will not verify ("revision must be specified" — the controller has nothing to
 * key against). `Disabled` keying performs no comparison, so it needs no
 * revision and is left alone.
 *
 * The importer (`extractStructure.ts`) sets `majorRevision`/`minorRevision` only
 * when the module's `Major`/`Minor` attributes are present, and the exporter
 * (`exportL5X.ts`) writes the keying back as the canonical `<EKey State=.../>`,
 * so a keyed module whose revision was dropped offline — or surviving from a
 * hand-edited L5X — round-trips to Studio 5000 exactly as written and fails
 * verify there. This is the revision companion to `module-electronic-keying`,
 * which guards the keying *token* itself (`ExactMatch` / `CompatibleModule` /
 * `Disabled`) but never checks that a comparing key has something to compare:
 * this rule closes that one remaining consistency gap. Modules with no keying
 * attribute (inherit the catalog default) and `Disabled`-keyed modules are
 * untouched, and an out-of-set keying string is left for `module-electronic-keying`
 * to flag rather than double-reported here.
 *
 * Reported as an error because the keyed connection cannot verify until a
 * revision is supplied or keying is set to `Disabled`.
 */
const isBlank = (value: string | undefined): boolean => value == null || value.trim() === "";

export const moduleKeyingRevision: ValidationRule = {
  id: "module-keying-revision",
  name: "Module keying revision",
  category: "project-structure",
  severity: "error",
  run({ project }: { project: PlcProject }) {
    const findings: ValidationFinding[] = [];
    for (const controller of project.controllers) {
      for (const module of controller.ioConfiguration.modules) {
        const keying = module.electronicKeying;
        // Only the two comparing keys require a revision; an absent attribute
        // (catalog default), "Disabled", or an out-of-set value (left for
        // `module-electronic-keying`) are not this rule's concern.
        if (keying !== "ExactMatch" && keying !== "CompatibleModule") continue;

        const missing: string[] = [];
        if (isBlank(module.majorRevision)) missing.push("major");
        if (isBlank(module.minorRevision)) missing.push("minor");
        if (missing.length === 0) continue;

        const missingLabel =
          missing.length === 2 ? "no module revision" : `no ${missing[0]} revision`;
        findings.push({
          ruleId: "module-keying-revision",
          severity: "error",
          message: `I/O module "${module.name}" uses ${keying} electronic keying but specifies ${missingLabel}; a comparing key requires a major and minor revision to verify against.`,
          target: `${controller.name}/${module.name}`,
        });
      }
    }
    return findings;
  },
};
