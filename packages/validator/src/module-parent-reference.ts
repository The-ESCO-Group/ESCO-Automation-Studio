import type { IoModule, PlcProject } from "@esco/core";
import type { ValidationFinding, ValidationRule } from "./types";

/**
 * Every I/O module that is not at the root of the tree binds to its parent by
 * name (`ParentModule`) and, for a chassis/backplane parent, to a specific port
 * on that parent (`ParentModPortId`). Studio 5000 places each module under the
 * named parent on the named port; if the parent module does not exist in the
 * configuration, or the named port is not one the parent exposes, the module has
 * no home in the I/O tree and the controller will not verify ("parent module …
 * could not be found" / an invalid connection). Deleting or renaming a parent
 * module offline — or hand-editing an L5X — is exactly what leaves a child
 * pointing at a parent that no longer resolves.
 *
 * The importer (`extractStructure.ts`) copies each module's `ParentModule` and
 * `ParentModPortId` verbatim and the exporter (`exportL5X.ts`) writes them back
 * unchanged, so a dangling parent binding survives a round-trip and reaches
 * Studio 5000 as a verify error. This is the I/O-tree analogue of the
 * `dangling-routine-reference` / `dangling-scheduled-program` reference-integrity
 * checks in `rules.ts`, and the verify-level companion to `module-slot-conflict`
 * (which catches two modules sharing a *slot*) and `duplicate-module-name` (two
 * modules sharing a *name*) — none of those notice a child whose parent is gone.
 *
 * The two failure modes mirror the `missing-parent-module` / `missing-parent-port`
 * issues that the project-actions `ioModuleReviewReport` already surfaces in the
 * offline I/O triage, so the verify rule and the triage agree on which modules
 * are orphaned. The classification follows that projection: a module is only
 * checked when it actually names a parent (a root module — e.g. the controller's
 * own "Local" module — carries no `ParentModule` and is skipped), and a module
 * naming *itself* as parent is treated as a self-reference root rather than a
 * dangle. Logix identifiers are case-insensitive, so the parent name is resolved
 * upper-cased — the same normalization `duplicate-module-name` applies — which
 * means a `ParentModule` differing only in case from an existing module ("local"
 * vs "Local") resolves rather than being mis-flagged.
 */

/** Port ids the module exposes (a child binds to one of these by `ParentModPortId`). */
function portIds(module: IoModule | undefined): Set<string> {
  return new Set((module?.ports ?? []).map((port) => port.id).filter((id): id is string => Boolean(id)));
}

export const moduleParentReference: ValidationRule = {
  id: "module-parent-reference",
  name: "Module parent reference",
  category: "project-structure",
  severity: "error",
  run({ project }: { project: PlcProject }) {
    const findings: ValidationFinding[] = [];
    for (const controller of project.controllers) {
      const modules = controller.ioConfiguration.modules;
      // Case-insensitive name -> module lookup (Logix identifiers are case-insensitive).
      const byName = new Map<string, IoModule>();
      for (const module of modules) {
        const trimmed = module.name?.trim();
        if (trimmed) byName.set(trimmed.toUpperCase(), module);
      }

      for (const module of modules) {
        const parentName = module.parentModule?.trim();
        // No parent named -> a root module (e.g. "Local"); nothing to resolve.
        if (!parentName) continue;
        // A module naming itself is a self-reference root, not a dangling parent.
        if (parentName.toUpperCase() === module.name?.trim().toUpperCase()) continue;

        const parent = byName.get(parentName.toUpperCase());
        if (!parent) {
          findings.push({
            ruleId: "module-parent-reference",
            severity: "error",
            message: `I/O module "${module.name}" names parent module "${parentName}", which does not exist in the controller's I/O configuration; the module is orphaned and the tree will not verify.`,
            target: `${controller.name}/${module.name}`,
          });
          continue;
        }

        if (module.parentPortId && !portIds(parent).has(module.parentPortId)) {
          findings.push({
            ruleId: "module-parent-reference",
            severity: "error",
            message: `I/O module "${module.name}" binds to port ${module.parentPortId} on parent module "${parent.name}", which exposes no such port; the connection is invalid.`,
            target: `${controller.name}/${module.name}`,
          });
        }
      }
    }
    return findings;
  },
};
