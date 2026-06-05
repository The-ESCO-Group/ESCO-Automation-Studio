import type { PlcProject } from "@esco/core";
import type { ValidationFinding, ValidationRule } from "./types";

/**
 * An I/O module connection's input delivery and production settings
 * (`<Communications><Connections><Connection InputConnectionType>` /
 * `InputProductionTrigger`) must each be one of the fixed tokens the controller editor accepts.
 * `InputConnectionType` selects how the controller receives the connection's
 * input data — `Multicast` (shared with other owners/listeners), `Unicast`
 * (point-to-point), or `Null` (the connection carries no input) — and
 * `InputProductionTrigger` selects what causes the producer to send that data —
 * `Cyclic` (at the RPI), `COS` (on change of state), or `Application` (when the
 * application asks). The controller editor offers only those choices on the connection's
 * Connection tab and stores each as an enumerated token, so a connection
 * carrying any other string will not verify ("invalid value" on the module).
 *
 * The importer (`extractStructure.ts`) copies `InputConnectionType` and
 * `InputProductionTrigger` verbatim whenever they are present, and the exporter
 * (`exportL5X.ts`) writes them back unchanged, so a value authored offline — or
 * surviving from a hand-edited L5X — round-trips exactly as written and fails
 * verify there. A connection with neither attribute is left
 * alone: the absent attribute means "use the connection default", which is
 * always one of the valid values, and the importer only sets each field when
 * its attribute is actually present.
 *
 * This is the input-QoS companion to `module-connection-rpi` (which guards the
 * same connection's requested packet interval) and `module-electronic-keying`
 * (which range-checks a module's keying token): those catch a non-positive RPI
 * and an out-of-set keying, this catches the two input-connection tokens range
 * checked at verify time. Both comparisons are exact and case-sensitive:
 * "multicast" and "Multi Cast" are rejected,
 * since the controller stores each as a fixed enumerated token, not free text.
 */
const VALID_INPUT_CONNECTION_TYPES = ["Multicast", "Unicast", "Null"] as const;
const VALID_INPUT_PRODUCTION_TRIGGERS = ["Cyclic", "COS", "Application"] as const;

export const moduleConnectionInputConfig: ValidationRule = {
  id: "module-connection-input-config",
  name: "Module connection input configuration",
  category: "project-structure",
  severity: "error",
  run({ project }: { project: PlcProject }) {
    const findings: ValidationFinding[] = [];
    for (const controller of project.controllers) {
      for (const module of controller.ioConfiguration.modules) {
        for (const connection of module.connections ?? []) {
          const label = connection.name ? `connection "${connection.name}"` : "a connection";
          const inputType = connection.inputConnectionType;
          // Absent attribute = inherit the connection default; only a present,
          // out-of-set token is a verify error.
          if (
            inputType != null &&
            !VALID_INPUT_CONNECTION_TYPES.includes(inputType as (typeof VALID_INPUT_CONNECTION_TYPES)[number])
          ) {
            findings.push({
              ruleId: "module-connection-input-config",
              severity: "error",
              message: `I/O module "${module.name}" has ${label} with input connection type "${inputType}"; controller-editor rules accept only ${VALID_INPUT_CONNECTION_TYPES.join(", ")}.`,
              target: `${controller.name}/${module.name}`,
            });
          }
          const trigger = connection.inputProductionTrigger;
          if (
            trigger != null &&
            !VALID_INPUT_PRODUCTION_TRIGGERS.includes(trigger as (typeof VALID_INPUT_PRODUCTION_TRIGGERS)[number])
          ) {
            findings.push({
              ruleId: "module-connection-input-config",
              severity: "error",
              message: `I/O module "${module.name}" has ${label} with input production trigger "${trigger}"; controller-editor rules accept only ${VALID_INPUT_PRODUCTION_TRIGGERS.join(", ")}.`,
              target: `${controller.name}/${module.name}`,
            });
          }
        }
      }
    }
    return findings;
  },
};
