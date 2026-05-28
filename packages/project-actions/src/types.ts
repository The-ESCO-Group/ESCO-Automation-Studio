import type { PlcProject, RoutineLanguage } from "@esco/core";
import type { ValidationFinding } from "@esco/validator";

/**
 * The result of a controlled project action. Actions never throw for expected
 * failures and never mutate the input project; they return a new project plus
 * validation findings and optional data so callers (UI today, AI later) can
 * react safely.
 */
export interface ProjectActionResult<T = unknown> {
  ok: boolean;
  /** The resulting project (unchanged from input when `ok` is false). */
  project: PlcProject;
  data?: T;
  findings?: ValidationFinding[];
  warnings?: string[];
  error?: string;
}

export interface CreateTagInput {
  name: string;
  dataType?: string;
  scope?: "controller" | "program";
  programId?: string;
  description?: string;
}

export interface RenameTagInput {
  from: string;
  to: string;
}

export interface DeleteTagInput {
  name: string;
}

export interface SetTagDescriptionInput {
  name: string;
  description: string;
}

export interface CreateRoutineInput {
  programId: string;
  name: string;
  language?: RoutineLanguage;
}

export interface AddRungInput {
  routineId: string;
  comment?: string;
}

export interface DeleteRungInput {
  routineId: string;
  rungId: string;
}

export interface AddInstructionInput {
  routineId: string;
  rungId: string;
  instructionType: string;
}

export interface AddRungFromTextInput {
  routineId: string;
  /** Logix neutral rung text, e.g. "XIC(StartPB)XIO(StopPB)OTE(MotorRun)". */
  text: string;
  comment?: string;
}

export interface RemoveInstructionInput {
  routineId: string;
  rungId: string;
  nodeId: string;
}

export interface UpdateOperandInput {
  routineId: string;
  rungId: string;
  nodeId: string;
  index?: number;
  value: string;
}

export interface ScanOptions {
  routineId?: string;
  deltaMs?: number;
}
