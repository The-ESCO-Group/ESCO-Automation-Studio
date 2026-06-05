import type { PlcProject } from "@esco/core";
import type { ValidationFinding, ValidationRule } from "./types";

/**
 * An I/O module connection's requested packet interval
 * (`<Communications><Connections><Connection RPI>`) must be a positive value.
 * The RPI is the rate (in microseconds) at which the controller exchanges the
 * connection's input/output data with the module; the connection is scheduled
 * around it, so Studio 5000 range-checks it at verify time and rejects a module
 * whose connection RPI is zero or negative ("The requested packet interval (RPI)
 * is invalid" — the connection cannot be scheduled). A positive interval is the
 * one bound that holds for every module and network; the upper end is
 * module/connection-specific (a fast analog card and a slow remote rack accept
 * very different maxima), so this rule deliberately checks only the
 * universally-true lower bound to avoid false-positiving a legitimately imported
 * file — the same conservative scope as `consumed-tag-rpi` and
 * `event-task-trigger`.
 *
 * The importer (`extractStructure.ts`) keeps `RPI` whenever it parses as a
 * *finite* number — it does **not** require it to be positive — and the exporter
 * (`exportL5X.ts`) writes `connection.rpi` back unchanged, so a zero/negative
 * interval authored offline, or surviving from a hand-edited L5X, round-trips to
 * Studio 5000 exactly as written and fails verify there. This is the I/O-module
 * companion to `consumed-tag-rpi`, which guards the very same attribute on a
 * consumed tag's `<ConsumeInfo>` but never inspects a module's
 * `<Communications>` connections; together they close the RPI gap on both kinds
 * of scheduled connection. It sits alongside `module-slot-conflict`,
 * `duplicate-module-name`, and `module-electronic-keying` (which guard a
 * module's slot, name, and keying) as the per-connection attribute check.
 *
 * A connection with no RPI attribute is left alone — the absent attribute means
 * "use the connection default", which is always in range, and the importer only
 * sets the field when the attribute is actually present and finite.
 */
export const moduleConnectionRpi: ValidationRule = {
  id: "module-connection-rpi",
  name: "Module connection RPI",
  category: "project-structure",
  severity: "error",
  run({ project }: { project: PlcProject }) {
    const findings: ValidationFinding[] = [];
    for (const controller of project.controllers) {
      for (const module of controller.ioConfiguration.modules) {
        for (const connection of module.connections ?? []) {
          const rpi = connection.rpi;
          // Absent RPI = inherit the connection default; only a present,
          // non-positive value is a verify error.
          if (rpi == null) continue;
          if (rpi <= 0) {
            const label = connection.name ? `connection "${connection.name}"` : "a connection";
            findings.push({
              ruleId: "module-connection-rpi",
              severity: "error",
              message: `I/O module "${module.name}" has ${label} with a requested packet interval of ${rpi} µs; controller connection rules require a positive RPI for a module connection.`,
              target: `${controller.name}/${module.name}`,
            });
          }
        }
      }
    }
    return findings;
  },
};
