import type { PlcProject } from "@esco/core";

export type ValidationCategory =
  | "syntax"
  | "type"
  | "safety"
  | "best-practice"
  | "runtime"
  | "project-structure";

export type ValidationSeverity = "error" | "warning" | "info";

export interface ValidationFinding {
  ruleId: string;
  severity: ValidationSeverity;
  message: string;
  /** Optional path to the offending element, e.g. controller/program/routine/tag. */
  target?: string;
}

export interface ValidationContext {
  project: PlcProject;
}

export interface ValidationRule {
  id: string;
  name: string;
  category: ValidationCategory;
  severity: ValidationSeverity;
  run(context: ValidationContext): ValidationFinding[];
}
