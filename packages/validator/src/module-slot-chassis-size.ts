import type { IoModule, PlcProject } from "@esco/core";
import type { ValidationFinding, ValidationRule } from "./types";

/**
 * A module's slot must fall inside the chassis it is plugged into. A backplane
 * (or daughter bus) port carries a `<Bus Size="N"/>` child giving the chassis
 * slot count; the slots are zero-based, so the only valid positions are
 * `0 … N-1`. Studio 5000 verifies this — a module whose `Slot` is at or beyond
 * the parent chassis size (or negative) reports a verify error ("the slot number
 * is invalid for this chassis") because there is no such physical position, and
 * the controller will not verify until the module is moved into range.
 *
 * The importer (`extractStructure.ts`) copies each module's `Slot` and parent
 * binding (`ParentModule` / `ParentModPortId`) verbatim, and preserves the
 * parent port's `<Bus Size>` as `port.busSize`; the exporter (`exportL5X.ts`)
 * writes them back unchanged, so an out-of-range slot assembled offline — or
 * carried in from a hand-edited L5X — survives a round-trip and reaches Studio
 * 5000 as a verify error. This is the chassis-capacity companion to
 * `module-slot-conflict` (which guards against *two* modules sharing one slot):
 * together they cover both ways a slot assignment can be rejected — a collision
 * with another module, and a position the chassis does not have. The slot/parent
 * resolution (`{parentModule}` by name, then the port whose `Id` matches
 * `parentPortId`) mirrors the project-actions `ioModuleReviewReport`, so the
 * verify rule and the offline triage agree on which chassis a module lives in.
 *
 * Deliberately conservative to avoid false-positiving a legitimately imported
 * file: the rule fires only when the chassis size is actually known. A module is
 * skipped when it has no slot (a network-addressed device occupies no backplane
 * position), no parent binding, an unresolved parent, a parent port that does
 * not declare a `<Bus Size>`, or a non-positive size — in every one of those
 * cases the true capacity is unknown, so no bound can be asserted.
 */

/** The parent chassis port a module is plugged into, or undefined when it cannot be resolved. */
function parentBusSize(module: IoModule, modulesByName: Map<string, IoModule>): number | undefined {
  const parentName = module.parentModule?.trim();
  // A module with no parent (or that names itself) is not seated in another
  // module's chassis; its own bus capacity is not a constraint on its slot.
  if (!parentName || parentName.toUpperCase() === module.name?.trim().toUpperCase()) return undefined;
  const parent = modulesByName.get(parentName.toUpperCase());
  if (!parent) return undefined;
  // The slot indexes the specific parent port the module connects to; without
  // that binding we cannot know which chassis (and which size) applies.
  if (!module.parentPortId) return undefined;
  const port = (parent.ports ?? []).find((p) => p.id === module.parentPortId);
  const size = port?.busSize;
  if (size == null || !Number.isFinite(size) || size <= 0) return undefined;
  return size;
}

export const moduleSlotChassisSize: ValidationRule = {
  id: "module-slot-chassis-size",
  name: "Module slot within chassis size",
  category: "project-structure",
  severity: "error",
  run({ project }: { project: PlcProject }) {
    const findings: ValidationFinding[] = [];
    for (const controller of project.controllers) {
      const modulesByName = new Map(
        controller.ioConfiguration.modules
          .map((module) => [module.name?.trim().toUpperCase(), module] as const)
          .filter(([name]) => Boolean(name)),
      );
      for (const module of controller.ioConfiguration.modules) {
        if (module.slot == null || !Number.isFinite(module.slot)) continue;
        const size = parentBusSize(module, modulesByName);
        if (size == null) continue;
        // Slots are zero-based: a chassis of size N seats slots 0 … N-1.
        if (module.slot < 0 || module.slot >= size) {
          const parent = `parent module "${module.parentModule?.trim()}"`;
          findings.push({
            ruleId: "module-slot-chassis-size",
            severity: "error",
            message: `I/O module "${module.name}" is placed at slot ${module.slot} on ${parent}, whose chassis has ${size} slot${size === 1 ? "" : "s"} (valid slots 0-${size - 1}); controller module rules require a slot within the chassis size.`,
            target: `${controller.name}/${module.name}`,
          });
        }
      }
    }
    return findings;
  },
};
