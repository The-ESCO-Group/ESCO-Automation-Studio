import type { PlcProject } from "@esco/core";
import type { ValidationFinding, ValidationRule } from "./types";

/** Runs a set of rules against a project and collects findings. */
export class ValidationEngine {
  private rules: ValidationRule[] = [];

  add(rule: ValidationRule): this {
    this.rules.push(rule);
    return this;
  }

  run(project: PlcProject): ValidationFinding[] {
    const findings: ValidationFinding[] = [];
    for (const rule of this.rules) {
      findings.push(...rule.run({ project }));
    }
    return findings;
  }
}
