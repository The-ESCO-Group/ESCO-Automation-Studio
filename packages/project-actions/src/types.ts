import type {
  ExternalAccess,
  PlcProject,
  RoutineLanguage,
  TagComment,
  TagEngineeringUnit,
  TaskType,
} from "@esco/core";
import type { LadderBranch } from "@esco/ladder";
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
  /** Human-facing evidence and next steps for offline workflow receipts. */
  receipt?: ProjectActionReceipt;
  error?: string;
}

export type ProjectActionReceiptStatus = "succeeded" | "warnings" | "failed";
export type ProjectActionEvidenceStatus = "ok" | "warning" | "error" | "info";

export interface ProjectActionEvidence {
  label: string;
  detail: string;
  status?: ProjectActionEvidenceStatus;
  source?: string;
}

export interface ProjectActionNextStep {
  label: string;
  detail?: string;
  recommended?: boolean;
}

export interface ProjectActionReceipt {
  title: string;
  summary: string;
  status: ProjectActionReceiptStatus;
  evidence: ProjectActionEvidence[];
  warnings: string[];
  nextSteps: ProjectActionNextStep[];
}

export interface CreateTagInput {
  name: string;
  /**
   * Data type to create. Accepted values resolve the same way as tag retyping:
   * Logix atomic types, predefined structured/model-only types, project UDTs,
   * or AOIs. Omitted/blank defaults to BOOL.
   */
  dataType?: string;
  /** First-dimension length for legacy single-dimensional arrays. */
  dimension?: number;
  /** Full Logix array dimensions, e.g. DINT[4,8] -> [4, 8]. */
  dimensions?: number[];
  scope?: "controller" | "program";
  programId?: string;
  description?: string;
  /** Studio 5000 ExternalAccess metadata. */
  externalAccess?: ExternalAccess;
  /** Studio 5000 Constant flag; validation rejects logic writes to constant tags. */
  constant?: boolean;
}

export interface TagScopeSelector {
  /** Target Logix scope. Omit only when the tag name is unique across scopes. */
  scope?: "controller" | "program";
  /** Required when targeting a program-scoped tag. */
  programId?: string;
}

export interface RenameTagInput extends TagScopeSelector {
  from: string;
  to: string;
}

export interface DeleteTagInput extends TagScopeSelector {
  name: string;
}

export interface SetTagDescriptionInput extends TagScopeSelector {
  name: string;
  description: string;
}

export interface SetTagDimensionsInput extends TagScopeSelector {
  name: string;
  /** First-dimension length for legacy single-dimensional arrays; 0 clears dimensions. */
  dimension?: number;
  /** Full Logix array dimensions; [] clears dimensions. */
  dimensions?: number[];
}

export interface SetTagDataTypeInput extends TagScopeSelector {
  name: string;
  /**
   * New data type: a Logix atomic type, a predefined structured/model-only
   * type (TIMER/COUNTER/MODULE/...), a project UDT, or an AOI. The stored value
   * is reset to the new type's default; dimensions and metadata are preserved.
   */
  dataType: string;
}

export interface SetTagMetadataInput extends TagScopeSelector {
  name: string;
  /** Set to read-write/read-only/none; blank clears authored metadata. */
  externalAccess?: ExternalAccess | "";
  /** True sets Constant, false clears it. */
  constant?: boolean;
  /**
   * Display radix / Studio 5000 "Style" (e.g. "Decimal", "Hex", "Binary",
   * "ASCII", "Float"); case-insensitive. Blank clears it. Display-only metadata
   * that round-trips through L5X export; it never changes the stored value.
   */
  radix?: string;
}

export interface SetTagAliasInput extends TagScopeSelector {
  name: string;
  /** Base tag, or a member/element path of one (e.g. "Motor.Run"); blank clears the alias. */
  aliasFor?: string;
}

export interface SetTagCommentsInput extends TagScopeSelector {
  name: string;
  /** Per-element/member comments, keyed by Logix operand path. Empty array clears comments. */
  comments: TagComment[];
}

export interface SetTagEngineeringUnitsInput extends TagScopeSelector {
  name: string;
  /** Per-element/member engineering units, keyed by Logix operand path. Empty array clears units. */
  engineeringUnits: TagEngineeringUnit[];
}

export interface SetProjectPropertiesInput {
  name: string;
  description?: string;
}

export interface SetControllerPropertiesInput {
  controllerId: string;
  name: string;
  processorType?: string;
  catalogNumber?: string;
  firmwareRevision?: string;
  chassis?: string;
  slot?: number;
  faultRoutineName?: string;
  powerUpRoutineName?: string;
  /**
   * Studio 5000 communication path metadata (the `CommPath`/`CommDriver`
   * attributes on the `<Controller>` element), e.g.
   * "AB_ETHIP-1\\192.168.1.10\\Backplane\\0" and "AB_ETHIP-1". Editable offline
   * project metadata only; blank clears the authored value. Never used to
   * connect to, go online with, or talk to a controller (this tool is
   * offline-only) — it is preserved verbatim so the path survives
   * export -> import.
   */
  commPath?: string;
  commDriver?: string;
}

export interface IoModuleConnectionInput {
  name?: string;
  rpi?: number;
  type?: string;
  priority?: string;
  unicast?: boolean;
  inputConnectionType?: string;
  inputProductionTrigger?: string;
  outputRedundantOwner?: boolean;
}

export interface IoModuleSetupTagInput {
  name: string;
  dataType?: string;
  description?: string;
  externalAccess?: ExternalAccess;
}

export interface AddIoModuleInput {
  controllerId: string;
  name: string;
  catalogNumber?: string;
  slot?: number;
  description?: string;
  parentModule?: string;
  parentPortId?: string;
  commPath?: string;
  vendor?: string;
  productType?: string;
  productCode?: string;
  majorRevision?: string;
  minorRevision?: string;
  electronicKeying?: string;
  inhibited?: boolean;
  connection?: IoModuleConnectionInput;
  setupTags?: IoModuleSetupTagInput[];
}

export interface UpdateIoModuleInput extends AddIoModuleInput {
  moduleId: string;
}

export interface RemoveIoModuleInput {
  controllerId: string;
  moduleId: string;
}

export interface SetTaskPropertiesInput {
  taskId: string;
  name: string;
  type: TaskType;
  periodMs?: number;
  priority?: number;
  watchdogMs?: number;
  inhibited?: boolean;
  disableUpdateOutputs?: boolean;
  scheduledProgramIds?: string[];
}

export interface SetProgramPropertiesInput {
  programId: string;
  name: string;
  description?: string;
  mainRoutineId?: string;
  faultRoutineId?: string;
  inhibited?: boolean;
}

export interface CreateProgramInput {
  controllerId: string;
  name: string;
  description?: string;
  scheduledTaskId?: string;
}

export interface CreateTaskInput {
  controllerId: string;
  name: string;
  type: TaskType;
  periodMs?: number;
  priority?: number;
  watchdogMs?: number;
  inhibited?: boolean;
  disableUpdateOutputs?: boolean;
  scheduledProgramIds?: string[];
}

export interface CreateControllerTrendInput {
  controllerId: string;
  name?: string;
  description?: string;
  seedFirstTag?: boolean;
}

export interface DeleteControllerTrendInput {
  controllerId: string;
  trendId: string;
}

export interface DeleteTaskInput {
  taskId: string;
}

export interface DeleteProgramInput {
  programId: string;
}

export interface CreateRoutineInput {
  programId: string;
  name: string;
  language?: RoutineLanguage;
}

export interface DeleteRoutineInput {
  routineId: string;
}

export interface DeleteUdtInput {
  udtId: string;
}

export interface DeleteAoiInput {
  aoiId: string;
}

export interface SetStructuredTextInput {
  routineId: string;
  source: string;
}

export interface AddRungInput {
  routineId: string;
  comment?: string;
}

export interface DeleteRungInput {
  routineId: string;
  rungId: string;
}

export interface DuplicateRungInput {
  routineId: string;
  rungId: string;
}

export interface PasteRungInput {
  routineId: string;
  /** A branch root to clone into a new rung (e.g. a copied rung's root). */
  root: LadderBranch;
  comment?: string;
  /**
   * Anchor rung for a relative paste. When set with `position`, the pasted rung
   * lands directly above/below this rung; otherwise the rung is appended to the
   * end of the routine (the historical default).
   */
  rungId?: string;
  position?: "above" | "below";
}

/** Insert a new (empty) rung directly above or below an existing rung. */
export interface InsertRungInput {
  routineId: string;
  rungId: string;
  position: "above" | "below";
  comment?: string;
}

/** Insert an instruction immediately before or after an existing instruction. */
export interface InsertInstructionInput {
  routineId: string;
  rungId: string;
  /** The existing instruction the new one is placed relative to. */
  nodeId: string;
  instructionType: string;
  position: "before" | "after";
}

/** Validate a single rung in isolation (offline rung verify). */
export interface VerifyRungInput {
  routineId: string;
  rungId: string;
}

/** Collect cross-reference results for the tags used on a single rung. */
export interface CrossReferenceRungInput {
  routineId: string;
  rungId: string;
}

export interface SetRungCommentInput {
  routineId: string;
  rungId: string;
  comment: string;
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

/** Target a rung for a branch-structure edit (add parallel branch / add leg). */
export interface BranchInput {
  routineId: string;
  rungId: string;
  /** Branch to operate on (defaults to the rung root). Pass a leg id to nest. */
  branchId?: string;
}

export interface RemoveBranchLegInput {
  routineId: string;
  rungId: string;
  branchId: string;
}

export interface AddInstructionToBranchInput {
  routineId: string;
  rungId: string;
  branchId: string;
  instructionType: string;
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
  /** Forced tag values: applied before and after logic, so a force wins the scan. */
  forces?: Record<string, boolean | number | string>;
  /**
   * Software-only one-shot event task triggers consumed by the offline scheduler.
   * Values may be task scan keys, task ids, task names, or "Controller/Task".
   * This never dispatches hardware events or controller EVENT instructions.
   */
  simulatedEventTaskTriggers?: readonly string[];
}

export interface SetRoutinePropertiesInput {
  routineId: string;
  /**
   * New routine name; omit to leave unchanged. Renaming remaps every
   * routine-reference operand (JSR/FOR/SFC) within the same program, since
   * Logix routine calls are program-local.
   */
  name?: string;
  /** New description; omit to leave unchanged, pass "" to clear. */
  description?: string;
}
