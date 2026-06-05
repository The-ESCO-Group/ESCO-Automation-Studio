import type { PlcProject } from "@esco/core";
import type { ValidationFinding, ValidationRule } from "./types";

/**
 * A CIP Safety port's Safety Network Number (SNN) must be a well-formed,
 * configured value. Studio 5000 stamps a unique SNN onto every CIP Safety port
 * — the controller's backplane/Ethernet ports and each CIP Safety I/O module —
 * and writes it into the L5X `Port` as `SafetyNetwork="16#0000_05a2_4567_89ab"`:
 * a base-16 literal holding the 64-bit SNN, the hex digits grouped by
 * underscores for readability. The SNN uniquely identifies the safety subnet a
 * device belongs to, and the originator includes it in the safety-connection
 * open request; the target only accepts the connection when the SNN matches.
 * Two failure modes survive a round-trip but cannot verify against a controller:
 *
 *  - **A malformed value.** Anything that is not a `16#` hexadecimal literal —
 *    a missing/altered radix prefix, non-hex characters, or an empty payload —
 *    is not a Safety Network Number Studio 5000 can produce, and a value longer
 *    than the 64-bit (16 hex digit) field overflows it. Either way the safety
 *    connection has no usable SNN to match.
 *
 *  - **An unset (all-zero) value.** `16#0000_0000_0000_0000` is the
 *    uninitialised SNN. Studio 5000 will not let a CIP Safety device join a
 *    safety connection until a non-zero SNN is set ("Set Safety Network
 *    Number"); a port left at all-zeros has never been assigned to a subnet and
 *    the connection cannot be established.
 *
 * The importer (`extractStructure.ts`) copies `SafetyNetwork` onto
 * {@link IoPort.safetyNetwork} only when the attribute is present, and the
 * exporter (`exportL5X.ts`) writes it straight back, so a malformed or zero SNN
 * carried in from a hand-edited L5X round-trips to Studio 5000 exactly as
 * written and fails there. Standard (non-safety) ports never carry the
 * attribute, so the presence of `safetyNetwork` is itself the signal that this
 * is a safety port worth checking — ports with no SNN are left untouched. This
 * is the safety-subnet companion to `module-keying-revision` and
 * `module-electronic-keying`, which guard the electronic-keying profile but
 * never look at the safety network number.
 *
 * Reported as an error because the safety connection cannot verify until a
 * valid, configured SNN is supplied.
 */

/** Maximum hex digits in Logix's 64-bit Safety Network Number field. */
const MAX_SNN_HEX_DIGITS = 16;

export const moduleSafetyNetworkNumber: ValidationRule = {
  id: "module-safety-network-number",
  name: "Module safety network number",
  category: "safety",
  severity: "error",
  run({ project }: { project: PlcProject }) {
    const findings: ValidationFinding[] = [];
    for (const controller of project.controllers) {
      for (const module of controller.ioConfiguration.modules) {
        for (const port of module.ports ?? []) {
          const raw = port.safetyNetwork;
          // Only safety ports carry a SafetyNetwork; an absent attribute means a
          // standard port that is not this rule's concern.
          if (raw == null || raw.trim() === "") continue;

          const value = raw.trim();
          const portLabel = port.id != null && port.id !== "" ? ` port ${port.id}` : "";
          const target = `${controller.name}/${module.name}`;

          // Logix always writes the SNN as a base-16 literal; the digits are
          // grouped by underscores purely for readability (placement is not
          // significant), so strip them before validating the payload.
          const match = /^16#([0-9a-fA-F_]+)$/.exec(value);
          const digits = match ? match[1].replace(/_/g, "") : "";
          if (!match || digits === "") {
            findings.push({
              ruleId: "module-safety-network-number",
              severity: "error",
              message: `I/O module "${module.name}"${portLabel} has Safety Network Number "${value}", which is not a valid 16# hexadecimal value; the safety connection will not verify.`,
              target,
            });
            continue;
          }

          if (digits.length > MAX_SNN_HEX_DIGITS) {
            findings.push({
              ruleId: "module-safety-network-number",
              severity: "error",
              message: `I/O module "${module.name}"${portLabel} has Safety Network Number "${value}", which exceeds the 64-bit (${MAX_SNN_HEX_DIGITS} hex digit) Safety Network Number range.`,
              target,
            });
            continue;
          }

          if (/^0+$/.test(digits)) {
            findings.push({
              ruleId: "module-safety-network-number",
              severity: "error",
              message: `I/O module "${module.name}"${portLabel} has an unset (all-zero) Safety Network Number; a CIP Safety port requires a configured SNN before the safety connection can verify.`,
              target,
            });
          }
        }
      }
    }
    return findings;
  },
};
