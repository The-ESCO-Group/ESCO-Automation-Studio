import type { IoModule, PlcProject } from "@esco/core";
import type { ValidationFinding, ValidationRule } from "./types";

/**
 * Every I/O module in a controller's configuration must have a unique name.
 * A module's name is the prefix of its module-defined tags (`Local:1:I`,
 * `Remote_DI:I`, …) and the node identifier in the I/O tree, so Logix treats it
 * as a controller-scoped identifier: two modules sharing a name would map to the
 * same tag namespace, and Studio 5000 reports a verify error ("name is already
 * in use") and will not verify until one is renamed.
 *
 * The importer (`toDomainProject.ts`) copies each module's `Name` verbatim and
 * the exporter (`exportL5X.ts`) writes it back unchanged, so a name collision
 * assembled offline — or carried in from a hand-edited L5X — survives a
 * round-trip and reaches Studio 5000 as a verify error. This is the name-side
 * companion to `module-slot-conflict`: that rule catches two modules in the same
 * *slot*, this one catches two modules with the same *name*. The cases are
 * independent — two modules can have unique names but collide on slot, or hold
 * distinct slots yet share a name — and a name collision is caught even for
 * network-addressed modules that occupy no slot at all (the EN2T-style devices
 * that `module-slot-conflict` deliberately skips), which is the one place a
 * slot check can never reach.
 *
 * Logix identifiers are case-insensitive, so two modules whose names differ only
 * in case ("Pump" vs "PUMP") still collide; names are compared upper-cased, the
 * same normalization the duplicate-data-type and member checks in `rules.ts`
 * apply. The project-actions `ioModuleReviewReport` keys its modules by name in a
 * `Map`, which silently collapses a duplicate rather than reporting it, so this
 * verify rule is the only place the collision surfaces offline.
 */
export const duplicateModuleName: ValidationRule = {
  id: "duplicate-module-name",
  name: "Duplicate module name",
  category: "project-structure",
  severity: "error",
  run({ project }: { project: PlcProject }) {
    const findings: ValidationFinding[] = [];
    for (const controller of project.controllers) {
      // First module seen at each upper-cased name; later modules with the same
      // name collide. A blank/whitespace-only name is not a usable identifier and
      // is left to the importer's own handling rather than reported as a clash.
      const occupant = new Map<string, IoModule>();
      for (const module of controller.ioConfiguration.modules) {
        const trimmed = module.name?.trim();
        if (!trimmed) continue;
        const key = trimmed.toUpperCase();
        const first = occupant.get(key);
        if (!first) {
          occupant.set(key, module);
          continue;
        }
        findings.push({
          ruleId: "duplicate-module-name",
          severity: "error",
          message: `I/O module "${module.name}" reuses a name already held by "${first.name}"; module names must be unique within a controller's I/O configuration.`,
          target: `${controller.name}/${module.name}`,
        });
      }
    }
    return findings;
  },
};
