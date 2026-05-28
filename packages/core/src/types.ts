/**
 * PLC domain model for a Studio 5000-style project.
 *
 * This is the single source of truth for the project structure. The UI,
 * simulator, validator, importer, and AI assistant must all build on these
 * types rather than defining their own.
 */

export type RoutineLanguage =
  | "ladder"
  | "structured-text"
  | "function-block"
  | "sfc";

export type TagScope = "controller" | "program";

export type ExternalAccess = "read-write" | "read-only" | "none";

export type TaskType = "continuous" | "periodic" | "event";

export interface PlcProject {
  id: string;
  name: string;
  description?: string;
  controllers: Controller[];
  createdAt: string;
  updatedAt: string;
}

export interface Controller {
  id: string;
  projectId: string;
  name: string;
  processorType?: string;
  firmwareRevision?: string;

  tasks: Task[];
  programs: Program[];
  controllerTags: Tag[];
  dataTypes: UserDefinedType[];
  addOnInstructions: AddOnInstruction[];
  ioConfiguration: IOConfiguration;
}

export interface Task {
  id: string;
  controllerId: string;
  name: string;
  type: TaskType;
  periodMs?: number;
  priority?: number;
  scheduledProgramIds: string[];
}

export interface Program {
  id: string;
  controllerId: string;
  name: string;
  description?: string;
  mainRoutineId?: string;
  faultRoutineId?: string;
  routines: Routine[];
  programTags: Tag[];
}

export interface Routine {
  id: string;
  programId: string;
  name: string;
  description?: string;
  language: RoutineLanguage;
  /** Populated for ladder routines. Typed loosely here to avoid a hard dependency on @esco/ladder. */
  ladder?: unknown;
  structuredText?: string;
}

export interface Tag {
  id: string;
  controllerId: string;
  programId?: string;

  name: string;
  scope: TagScope;
  dataType: string;

  /** First-dimension length for a single-dimension array tag (e.g. DINT[8] → 8). */
  dimension?: number;

  description?: string;
  value?: unknown;
  aliasFor?: string;

  externalAccess?: ExternalAccess;
}

export interface UserDefinedType {
  id: string;
  name: string;
  description?: string;
  members: UdtMember[];
}

export interface UdtMember {
  name: string;
  dataType: string;
  /** First-dimension length when the member is an array. */
  dimension?: number;
  description?: string;
}

/** An Add-On Instruction parameter (Input / Output / InOut). */
export interface AoiParameter {
  name: string;
  dataType: string;
  /** Parameter usage: "Input" | "Output" | "InOut" (as imported). */
  usage?: string;
  required?: boolean;
  defaultValue?: string;
  description?: string;
}

/** A local (private) tag inside an Add-On Instruction. */
export interface AoiLocalTag {
  name: string;
  dataType: string;
  description?: string;
}

export interface AddOnInstruction {
  id: string;
  name: string;
  description?: string;
  revision?: string;
  /** Safety/source signature ID, when the export includes one. */
  signature?: string;
  /** True when the AOI is source-protected, so its logic is not available to inspect. */
  protected?: boolean;
  /** Raw source-protection type (e.g. "Protected"), when present. */
  protectionType?: string;
  parameters: AoiParameter[];
  localTags: AoiLocalTag[];
  /** Names of the AOI's imported routines (logic), read-only. */
  routineNames: string[];
}

export interface IOConfiguration {
  modules: IoModule[];
}

export interface IoModule {
  id: string;
  name: string;
  catalogNumber?: string;
  slot?: number;
  description?: string;
  parentModule?: string;
  commPath?: string;
}
