import type { IoModule, PlcProject } from "@esco/core";
import type { ValidationFinding, ValidationRule } from "./types";

/**
 * Two I/O modules cannot occupy the same slot in the same chassis. Studio 5000
 * verifies that, within a parent module/port (a backplane or a daughter bus),
 * every populated slot is held by at most one module; a second module placed at
 * an already-occupied slot reports a verify error ("module … slot is already in
 * use") and the controller will not verify until the collision is resolved.
 *
 * The importer (`toDomainProject.ts`) copies each module's `Slot` and parent
 * binding (`ParentModule` / `ParentModPortId`) verbatim and the exporter
 * (`exportL5X.ts`) writes them back unchanged, so a slot collision assembled
 * offline — or carried in from a hand-edited L5X — survives a round-trip and
 * reaches Studio 5000 as a verify error. This is the I/O-tree analogue of the
 * single-continuous-task check in `rules.ts`: a project-structure error, because
 * the controller rejects the configuration outright.
 *
 * Two modules collide only when they share the *same slot under the same parent*.
 * Modules under different parents (or on different ports of the same parent) can
 * legitimately reuse a slot number, and a module with no `Slot` (e.g. a network
 * device addressed by IP rather than a backplane position) is not placed in any
 * slot and is skipped. This is the verify-level analogue of the project-actions
 * `ioModuleReviewReport` `duplicate-slot` issue; the slot-key classification is
 * mirrored from that projection (`{parentModule}:{parentPortId}:{slot}`) so the
 * verify rule and the offline triage agree on which modules collide.
 */

/**
 * The occupied-slot key for a module, or undefined when the module is not in a
 * slot. Mirrors `duplicateSlotKey` in the project-actions I/O module review: a
 * module collides with another only when this key matches.
 */
function slotKey(module: IoModule): string | undefined {
  if (module.slot == null) return undefined;
  return `${module.parentModule ?? ""}:${module.parentPortId ?? ""}:${module.slot}`;
}

export const moduleSlotConflict: ValidationRule = {
  id: "module-slot-conflict",
  name: "Module slot conflict",
  category: "project-structure",
  severity: "error",
  run({ project }: { project: PlcProject }) {
    const findings: ValidationFinding[] = [];
    for (const controller of project.controllers) {
      // First module seen at each slot key; later modules at the same key collide.
      const occupant = new Map<string, IoModule>();
      for (const module of controller.ioConfiguration.modules) {
        const key = slotKey(module);
        if (key == null) continue;
        const first = occupant.get(key);
        if (!first) {
          occupant.set(key, module);
          continue;
        }
        const parent = module.parentModule?.trim() ? `parent module "${module.parentModule.trim()}"` : "the local chassis";
        findings.push({
          ruleId: "module-slot-conflict",
          severity: "error",
          message: `I/O module "${module.name}" occupies slot ${module.slot} on ${parent}, already held by "${first.name}"; controller module rules permit only one module per slot.`,
          target: `${controller.name}/${module.name}`,
        });
      }
    }
    return findings;
  },
};
