import type { PlcProject, Tag } from "@esco/core";
import type { ValidationFinding, ValidationRule } from "./types";

/**
 * A consumed tag's requested packet interval (`<ConsumeInfo RPI>`) must be a
 * positive value. The RPI is the rate at which the consuming controller asks the
 * producer to send the tag; the connection is scheduled around it, so Studio 5000
 * range-checks it at verify time and rejects a consumed tag whose RPI is zero or
 * negative ("RPI is invalid" / the connection cannot be scheduled). A positive
 * interval is the one bound that holds for every network and module — the upper
 * end is connection-specific, so this rule deliberately checks only the
 * universally-true lower bound to avoid false-positiving a legitimately imported
 * file (mirroring the conservative scope of `event-task-trigger`).
 *
 * The importer (`extractTags.ts`) keeps `RPI` whenever it parses as a *finite*
 * number — it does **not** require it to be positive — and the exporter
 * (`exportL5X.ts`) writes `consumeInfo.rpi` back unchanged, so a zero/negative
 * interval authored offline, or surviving from a hand-edited L5X, round-trips to
 * Studio 5000 exactly as written and fails verify there. This is the RPI
 * companion to `produced-consumed-tag`, which guards the producer / remote-tag /
 * produce-count of the same connection metadata but never inspects the consumed
 * RPI; this rule closes that one remaining attribute. A consumed tag with no RPI
 * attribute is left alone — the absent attribute means "use the connection
 * default", which is always in range, and the importer only sets the field when
 * the attribute is actually present and finite.
 */
export const consumedTagRpi: ValidationRule = {
  id: "consumed-tag-rpi",
  name: "Consumed tag RPI",
  category: "project-structure",
  severity: "error",
  run({ project }: { project: PlcProject }) {
    const findings: ValidationFinding[] = [];

    const check = (tag: Tag, controllerName: string, programName: string | undefined): void => {
      if (!tag.consumed) return;
      const rpi = tag.consumeInfo?.rpi;
      // Absent RPI = inherit the connection default; only a present, non-positive
      // value is a verify error.
      if (rpi == null) return;
      if (rpi <= 0) {
        const target = programName
          ? `${controllerName}/${programName}/${tag.name}`
          : `${controllerName}/${tag.name}`;
        findings.push({
          ruleId: "consumed-tag-rpi",
          severity: "error",
          message: `Consumed tag "${tag.name}" has a requested packet interval of ${rpi} ms; controller-editor rules require a positive RPI for a consumed connection.`,
          target,
        });
      }
    };

    for (const controller of project.controllers) {
      for (const tag of controller.controllerTags) {
        check(tag, controller.name, undefined);
      }
      for (const program of controller.programs) {
        for (const tag of program.programTags) {
          check(tag, controller.name, program.name);
        }
      }
    }
    return findings;
  },
};
