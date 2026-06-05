import { baseTagName } from "@esco/instructions";
import type { ExternalAccess, Tag } from "@esco/core";
import type { ValidationFinding, ValidationRule } from "./types";

/**
 * An alias tag's External Access may not be more permissive than the External
 * Access of the base tag it points at. The alias is just another name for the
 * base storage, so Logix will not let a project widen access through an alias —
 * e.g. exposing a Read Only base tag as Read/Write via an alias. Studio 5000
 * enforces this both when you edit the alias and again at verify time ("External
 * Access for an alias tag cannot be greater than that of the base tag").
 *
 * `setTagAlias` validates the base tag and rejects cycles, but does not check the
 * access relationship, and an L5X built elsewhere can carry the mismatch in. The
 * exporter writes each tag's `ExternalAccess` verbatim, so an offline edit that
 * raises an alias above its base survives a round-trip and reaches Studio 5000 as
 * a verify error. This is the access-side companion to `alias-target-missing`
 * (missing base) and `circular-alias` (unresolvable chain).
 *
 * Access ranks none < Read Only < Read/Write. The check fires only when both the
 * alias and its resolved base carry an explicit `externalAccess`: an unset value
 * means "inherit", which Logix resolves to the base's own access and so can never
 * exceed it. The base is resolved with Logix scope precedence — a program alias
 * resolves its base in the program first, then controller scope — and only the
 * immediate base is compared, because each link in a chain is bounded by the next
 * (so a transitive violation surfaces at the link that introduces it). Missing or
 * circular targets are left to `alias-target-missing` / `circular-alias`.
 */
const ACCESS_RANK: Record<ExternalAccess, number> = {
  none: 0,
  "read-only": 1,
  "read-write": 2,
};

const ACCESS_LABEL: Record<ExternalAccess, string> = {
  none: "None",
  "read-only": "Read Only",
  "read-write": "Read/Write",
};

export const aliasExternalAccess: ValidationRule = {
  id: "alias-external-access",
  name: "Alias external access",
  category: "type",
  severity: "error",
  run({ project }) {
    const findings: ValidationFinding[] = [];
    for (const controller of project.controllers) {
      const controllerByName = new Map<string, Tag>();
      for (const tag of controller.controllerTags) controllerByName.set(tag.name, tag);

      const check = (alias: Tag, scopeByName: Map<string, Tag>, target: string): void => {
        if (!alias.aliasFor || alias.externalAccess == null) return;
        const baseName = baseTagName(alias.aliasFor);
        if (!baseName) return;
        // Program aliases resolve the base in program scope first, then controller.
        const base = scopeByName.get(baseName) ?? controllerByName.get(baseName);
        if (!base || base.externalAccess == null) return;
        if (ACCESS_RANK[alias.externalAccess] > ACCESS_RANK[base.externalAccess]) {
          findings.push({
            ruleId: "alias-external-access",
            severity: "error",
            message: `Alias "${alias.name}" has external access ${ACCESS_LABEL[alias.externalAccess]}, wider than its base tag "${base.name}" (${ACCESS_LABEL[base.externalAccess]}); an alias cannot grant more access than its base tag.`,
            target,
          });
        }
      };

      for (const tag of controller.controllerTags) {
        check(tag, controllerByName, `${controller.name}/${tag.name}`);
      }
      for (const program of controller.programs) {
        const programByName = new Map<string, Tag>();
        for (const tag of program.programTags) programByName.set(tag.name, tag);
        for (const tag of program.programTags) {
          check(tag, programByName, `${controller.name}/${program.name}/${tag.name}`);
        }
      }
    }
    return findings;
  },
};
