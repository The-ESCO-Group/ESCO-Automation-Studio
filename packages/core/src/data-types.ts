/**
 * Built-in PLC data types and the layout of the predefined structured types
 * (TIMER, COUNTER, CONTROL, MESSAGE, process/safety backing blocks,
 * ALARM_DIGITAL/ALARM_ANALOG, MOTION_INSTRUCTION, EQUIPMENT_PHASE,
 * PHASE_INSTRUCTION). Used by the
 * simulator/Watch to seed and display member values, and by the editor to
 * create tags of the right type.
 */

export type AtomicType = "BOOL" | "DINT" | "REAL" | "STRING";

export interface StructMember {
  name: string;
  /** Member atomic type; smaller Logix integers are represented as DINT offline. */
  type: AtomicType;
}

/** Tag data types the editor can create. */
export const TAG_DATA_TYPES = [
  "BOOL",
  "DINT",
  "REAL",
  "STRING",
  "TIMER",
  "COUNTER",
  "CONTROL",
  "MESSAGE",
] as const;
export type TagDataType = (typeof TAG_DATA_TYPES)[number];

const PROCESS_REVIEW_MEMBERS: StructMember[] = [
  { name: "EnableIn", type: "BOOL" },
  { name: "EnableOut", type: "BOOL" },
  { name: "In", type: "REAL" },
  { name: "Out", type: "REAL" },
  { name: "PV", type: "REAL" },
  { name: "CV", type: "REAL" },
  { name: "SP", type: "REAL" },
  { name: "HighLimit", type: "REAL" },
  { name: "LowLimit", type: "REAL" },
  { name: "Status", type: "DINT" },
  { name: "Error", type: "BOOL" },
  { name: "Done", type: "BOOL" },
];

const SAFETY_INPUT_REVIEW_MEMBERS: StructMember[] = [
  { name: "EnableIn", type: "BOOL" },
  { name: "EnableOut", type: "BOOL" },
  { name: "In", type: "BOOL" },
  { name: "In1", type: "BOOL" },
  { name: "In2", type: "BOOL" },
  { name: "Out", type: "BOOL" },
  { name: "O1", type: "BOOL" },
  { name: "O2", type: "BOOL" },
  { name: "ResetRequired", type: "BOOL" },
  { name: "FaultPresent", type: "BOOL" },
  { name: "FaultCode", type: "DINT" },
  { name: "Status", type: "DINT" },
];

const SAFETY_OUTPUT_REVIEW_MEMBERS: StructMember[] = [
  { name: "EnableIn", type: "BOOL" },
  { name: "EnableOut", type: "BOOL" },
  { name: "O1", type: "BOOL" },
  { name: "O2", type: "BOOL" },
  { name: "Feedback1", type: "BOOL" },
  { name: "Feedback2", type: "BOOL" },
  { name: "Out", type: "BOOL" },
  { name: "Ready", type: "BOOL" },
  { name: "FaultPresent", type: "BOOL" },
  { name: "FaultCode", type: "DINT" },
  { name: "Status", type: "DINT" },
];

/** Member layout of the predefined structured types. */
export const STRUCTURED_TYPES: Record<string, StructMember[]> = {
  TIMER: [
    { name: "PRE", type: "DINT" },
    { name: "ACC", type: "DINT" },
    { name: "EN", type: "BOOL" },
    { name: "TT", type: "BOOL" },
    { name: "DN", type: "BOOL" },
  ],
  COUNTER: [
    { name: "PRE", type: "DINT" },
    { name: "ACC", type: "DINT" },
    { name: "CU", type: "BOOL" },
    { name: "CD", type: "BOOL" },
    { name: "DN", type: "BOOL" },
    { name: "OV", type: "BOOL" },
    { name: "UN", type: "BOOL" },
  ],
  CONTROL: [
    { name: "EN", type: "BOOL" },
    { name: "EU", type: "BOOL" },
    { name: "DN", type: "BOOL" },
    { name: "EM", type: "BOOL" },
    { name: "FD", type: "BOOL" },
    { name: "IN", type: "BOOL" },
    { name: "UL", type: "BOOL" },
    { name: "ER", type: "BOOL" },
    { name: "LEN", type: "DINT" },
    { name: "POS", type: "DINT" },
  ],
  // MESSAGE control structure (representative offline layout). MSG itself is
  // model-only/no-communication, but these members let imported message control
  // tags scan, validate, and display common status/configuration paths.
  MESSAGE: [
    { name: "FLAGS", type: "DINT" },
    { name: "EW", type: "BOOL" },
    { name: "ER", type: "BOOL" },
    { name: "DN", type: "BOOL" },
    { name: "ST", type: "BOOL" },
    { name: "EN", type: "BOOL" },
    { name: "TO", type: "BOOL" },
    { name: "EN_CC", type: "BOOL" },
    { name: "ERR", type: "DINT" },
    { name: "EXERR", type: "DINT" },
    { name: "REQ_LEN", type: "DINT" },
    { name: "DN_LEN", type: "DINT" },
    { name: "ERR_SRC", type: "DINT" },
    { name: "DestinationLink", type: "DINT" },
    { name: "DestinationNode", type: "DINT" },
    { name: "SourceLink", type: "DINT" },
    { name: "Class", type: "DINT" },
    { name: "Attribute", type: "DINT" },
    { name: "Instance", type: "DINT" },
    { name: "LocalIndex", type: "DINT" },
    { name: "Channel", type: "DINT" },
    { name: "Rack", type: "DINT" },
    { name: "Group", type: "DINT" },
    { name: "Slot", type: "DINT" },
    { name: "Path", type: "STRING" },
    { name: "RemoteIndex", type: "DINT" },
    { name: "RemoteElement", type: "STRING" },
    { name: "UnconnectedTimeout", type: "DINT" },
    { name: "ConnectionRate", type: "DINT" },
    { name: "TimeoutMultiplier", type: "DINT" },
  ],
  // Function-block one-shot structure used by OSRI/OSFI. The public structure
  // exposes the enable/input/output pins; the offline simulator keeps prior
  // input history in its own hidden runtime memory so imported tags keep the
  // documented member surface.
  FBD_ONESHOT: [
    { name: "EnableIn", type: "BOOL" },
    { name: "InputBit", type: "BOOL" },
    { name: "EnableOut", type: "BOOL" },
    { name: "OutputBit", type: "BOOL" },
  ],
  // Classic PID structure (representative subset). Process loops are model-only:
  // the members let the Watch seed/display them and let member-path validation
  // recognise references like PID_01.SP, but the PID instruction is never
  // simulated (see @esco/instructions process.ts). REAL members are modelled as
  // DINT numerics for offline display — there is no controller-faithful math.
  PID: [
    { name: "SP", type: "DINT" },
    { name: "PV", type: "DINT" },
    { name: "OUT", type: "DINT" },
    { name: "KP", type: "DINT" },
    { name: "KI", type: "DINT" },
    { name: "KD", type: "DINT" },
    { name: "ERR", type: "DINT" },
    { name: "MAXO", type: "DINT" },
    { name: "MINO", type: "DINT" },
    { name: "EN", type: "BOOL" },
    { name: "DN", type: "BOOL" },
  ],
  // Enhanced PID (PIDE) function-block structure (representative subset).
  PIDE: [
    { name: "SP", type: "DINT" },
    { name: "PV", type: "DINT" },
    { name: "CV", type: "DINT" },
    { name: "CVEU", type: "DINT" },
    { name: "KP", type: "DINT" },
    { name: "KI", type: "DINT" },
    { name: "KD", type: "DINT" },
    { name: "ERR", type: "DINT" },
    { name: "EN", type: "BOOL" },
    { name: "DN", type: "BOOL" },
  ],
  // Process signal-conditioning/function blocks. These blocks are model-only:
  // the members let Watch/member-path validation recognize common status and
  // value paths while the instructions remain strict pass-through review blocks.
  SCL: PROCESS_REVIEW_MEMBERS,
  TOT: PROCESS_REVIEW_MEMBERS,
  RMPS: PROCESS_REVIEW_MEMBERS,
  DEDT: PROCESS_REVIEW_MEMBERS,
  LDLG: PROCESS_REVIEW_MEMBERS,
  HLL: PROCESS_REVIEW_MEMBERS,
  MUX: PROCESS_REVIEW_MEMBERS,
  SOC: PROCESS_REVIEW_MEMBERS,
  POSP: PROCESS_REVIEW_MEMBERS,
  PMUL: PROCESS_REVIEW_MEMBERS,
  DERV: PROCESS_REVIEW_MEMBERS,
  INTG: PROCESS_REVIEW_MEMBERS,
  HPF: PROCESS_REVIEW_MEMBERS,
  LPF: PROCESS_REVIEW_MEMBERS,
  NTCH: PROCESS_REVIEW_MEMBERS,
  RLIM: PROCESS_REVIEW_MEMBERS,
  SCRV: PROCESS_REVIEW_MEMBERS,
  LDL2: PROCESS_REVIEW_MEMBERS,
  PI: PROCESS_REVIEW_MEMBERS,
  SEL: PROCESS_REVIEW_MEMBERS,
  ESEL: PROCESS_REVIEW_MEMBERS,
  SSUM: PROCESS_REVIEW_MEMBERS,
  SNEG: PROCESS_REVIEW_MEMBERS,
  D2SD: PROCESS_REVIEW_MEMBERS,
  D3SD: PROCESS_REVIEW_MEMBERS,
  FGEN: PROCESS_REVIEW_MEMBERS,
  // Common safety backing structures. These are offline review structures only:
  // they never evaluate a safety function, verify a signature, enforce safety
  // memory, or communicate with a controller.
  ESTOP: SAFETY_INPUT_REVIEW_MEMBERS,
  ESTPI: SAFETY_INPUT_REVIEW_MEMBERS,
  RESET: SAFETY_INPUT_REVIEW_MEMBERS,
  THRS: SAFETY_INPUT_REVIEW_MEMBERS,
  THRSE: SAFETY_INPUT_REVIEW_MEMBERS,
  SMAT: SAFETY_INPUT_REVIEW_MEMBERS,
  SGS: SAFETY_INPUT_REVIEW_MEMBERS,
  DCS: SAFETY_INPUT_REVIEW_MEMBERS,
  DCSTL: SAFETY_INPUT_REVIEW_MEMBERS,
  DCSTM: SAFETY_INPUT_REVIEW_MEMBERS,
  DCM: SAFETY_INPUT_REVIEW_MEMBERS,
  DCI: SAFETY_INPUT_REVIEW_MEMBERS,
  DIN: SAFETY_INPUT_REVIEW_MEMBERS,
  LC: SAFETY_INPUT_REVIEW_MEMBERS,
  MUT: SAFETY_INPUT_REVIEW_MEMBERS,
  FPMS: SAFETY_INPUT_REVIEW_MEMBERS,
  ESI: SAFETY_INPUT_REVIEW_MEMBERS,
  ROUT: SAFETY_OUTPUT_REVIEW_MEMBERS,
  CROUT: SAFETY_OUTPUT_REVIEW_MEMBERS,
  SFX: SAFETY_INPUT_REVIEW_MEMBERS,
  // Digital alarm (ALARM_DIGITAL) structure backing the ALMD instruction
  // (representative subset). ALMD is model-only/not simulated (see
  // @esco/instructions advanced.ts), but modelling its control members lets the
  // Watch seed/display them and lets member-path validation recognise common
  // references like MyAlarm.InAlarm or MyAlarm.Acked instead of flagging them as
  // unknown members. LINT timestamps and DINT/REAL config values are represented
  // as DINT numerics for offline display.
  ALARM_DIGITAL: [
    { name: "In", type: "BOOL" },
    { name: "InAlarm", type: "BOOL" },
    { name: "Acked", type: "BOOL" },
    { name: "InAlarmUnack", type: "BOOL" },
    { name: "AckRequired", type: "BOOL" },
    { name: "Suppressed", type: "BOOL" },
    { name: "Shelved", type: "BOOL" },
    { name: "Disabled", type: "BOOL" },
    { name: "Commissioned", type: "BOOL" },
    { name: "ProgAck", type: "BOOL" },
    { name: "OperAck", type: "BOOL" },
    { name: "ProgReset", type: "BOOL" },
    { name: "OperReset", type: "BOOL" },
    { name: "ProgDisable", type: "BOOL" },
    { name: "OperDisable", type: "BOOL" },
    { name: "ProgEnable", type: "BOOL" },
    { name: "OperEnable", type: "BOOL" },
    { name: "Severity", type: "DINT" },
    { name: "MinDurationPRE", type: "DINT" },
    { name: "AlarmCount", type: "DINT" },
    { name: "Status", type: "DINT" },
  ],
  // Analog alarm (ALARM_ANALOG) structure backing the ALMA instruction
  // (representative subset). Model-only like ALMD above; members are modelled so
  // the Watch and member-path validation recognise the per-threshold status bits
  // and limit/severity configuration paths. Numeric members are DINT offline.
  ALARM_ANALOG: [
    { name: "In", type: "DINT" },
    { name: "InAlarm", type: "BOOL" },
    { name: "HHInAlarm", type: "BOOL" },
    { name: "HInAlarm", type: "BOOL" },
    { name: "LInAlarm", type: "BOOL" },
    { name: "LLInAlarm", type: "BOOL" },
    { name: "ROCPosInAlarm", type: "BOOL" },
    { name: "ROCNegInAlarm", type: "BOOL" },
    { name: "AckRequired", type: "BOOL" },
    { name: "Suppressed", type: "BOOL" },
    { name: "Disabled", type: "BOOL" },
    { name: "Commissioned", type: "BOOL" },
    { name: "HHLimit", type: "DINT" },
    { name: "HLimit", type: "DINT" },
    { name: "LLimit", type: "DINT" },
    { name: "LLLimit", type: "DINT" },
    { name: "Deadband", type: "DINT" },
    { name: "HHSeverity", type: "DINT" },
    { name: "HSeverity", type: "DINT" },
    { name: "LSeverity", type: "DINT" },
    { name: "LLSeverity", type: "DINT" },
  ],
  // Motion control structure (MOTION_INSTRUCTION), the status tag every motion
  // instruction (MSO/MAM/MCLM/…) names as its Motion Control review operand (see
  // @esco/instructions advanced.ts). The motion instructions themselves are
  // model-only/never simulated, but surrounding ladder routinely reads these
  // status bits (.DN/.ER/.PC/.IP) to sequence motion, so modelling the members
  // lets the Watch seed/display them and lets member-path validation recognise
  // references like MoveCtl.DN or MoveCtl.ER instead of flagging them unknown.
  // Numeric error/status members are DINT offline.
  MOTION_INSTRUCTION: [
    { name: "EN", type: "BOOL" },
    { name: "DN", type: "BOOL" },
    { name: "ER", type: "BOOL" },
    { name: "IP", type: "BOOL" },
    { name: "PC", type: "BOOL" },
    { name: "AC", type: "BOOL" },
    { name: "ERR", type: "DINT" },
    { name: "EXERR", type: "DINT" },
    { name: "STATUS", type: "DINT" },
  ],
  // Equipment Phase (EQUIPMENT_PHASE) structure, the phase tag every external
  // command / attach block (PCMD/POVR/PCLF/PATT/PDET) names as its review
  // operand (see @esco/instructions phase.ts). The PhaseManager state machine is
  // model-only/never simulated, but surrounding ladder routinely reads these
  // state bits and codes (.State, .Running, .Held, .Complete, .Failure) to gate
  // sequence flow, so modelling the members lets the Watch seed/display them and
  // lets member-path validation recognise references like MyPhase.State or
  // MyPhase.Complete instead of flagging them as unknown members. Representative
  // subset; state/step/owner codes are DINT numerics for offline display.
  EQUIPMENT_PHASE: [
    { name: "State", type: "DINT" },
    { name: "Substate", type: "DINT" },
    { name: "Running", type: "BOOL" },
    { name: "Holding", type: "BOOL" },
    { name: "Restarting", type: "BOOL" },
    { name: "Stopping", type: "BOOL" },
    { name: "Aborting", type: "BOOL" },
    { name: "Resetting", type: "BOOL" },
    { name: "Idle", type: "BOOL" },
    { name: "Held", type: "BOOL" },
    { name: "Complete", type: "BOOL" },
    { name: "Stopped", type: "BOOL" },
    { name: "Aborted", type: "BOOL" },
    { name: "Paused", type: "BOOL" },
    { name: "PauseEnabled", type: "BOOL" },
    { name: "NewInputParameters", type: "BOOL" },
    { name: "StepIndex", type: "DINT" },
    { name: "Failure", type: "DINT" },
    { name: "AbortingType", type: "DINT" },
    { name: "UnitID", type: "DINT" },
    { name: "Owner", type: "DINT" },
  ],
  // Phase external-request control (PHASE_INSTRUCTION), the control tag PXRQ
  // names as its review operand (see @esco/instructions phase.ts). Like
  // MOTION_INSTRUCTION, PXRQ itself is model-only/never simulated, but
  // surrounding ladder reads these status bits (.EN/.DN/.ER/.IP/.PC) to sequence
  // the external request, so modelling the members lets the Watch seed/display
  // them and lets member-path validation recognise references like Req.DN or
  // Req.ER instead of flagging them unknown. Numeric error members are DINT.
  PHASE_INSTRUCTION: [
    { name: "EN", type: "BOOL" },
    { name: "DN", type: "BOOL" },
    { name: "ER", type: "BOOL" },
    { name: "IP", type: "BOOL" },
    { name: "PC", type: "BOOL" },
    { name: "ERR", type: "DINT" },
    { name: "EXERR", type: "DINT" },
  ],
};

export function isStructuredType(dataType: string): boolean {
  return dataType in STRUCTURED_TYPES;
}

export function isBooleanType(dataType: string): boolean {
  return dataType === "BOOL";
}

export function isNumericType(dataType: string): boolean {
  return dataType === "DINT" || dataType === "REAL";
}

/** Member definitions for a structured type, or [] for atomic types. */
export function memberDefs(dataType: string): StructMember[] {
  return STRUCTURED_TYPES[dataType] ?? [];
}

/** Normalize a Logix array dimension list, dropping invalid/empty dimensions. */
export function normalizeArrayDimensions(dimensions: number | readonly number[] | undefined): number[] {
  const raw = Array.isArray(dimensions) ? dimensions : dimensions == null ? [] : [dimensions];
  return raw
    .map((dimension) => Math.floor(Number(dimension)))
    .filter((dimension) => Number.isFinite(dimension) && dimension > 0);
}

/** Return full dimensions for a tag/member that still carries the legacy first dimension. */
export function arrayDimensionsOf(value: { dimension?: number; dimensions?: readonly number[] }): number[] {
  const full = normalizeArrayDimensions(value.dimensions);
  return full.length > 0 ? full : normalizeArrayDimensions(value.dimension);
}

/** Human-readable Logix suffix for a tag/member declaration, e.g. `[4,8]`. */
export function arrayDimensionSuffix(value: { dimension?: number; dimensions?: readonly number[] }): string {
  const dimensions = arrayDimensionsOf(value);
  return dimensions.length > 0 ? `[${dimensions.join(",")}]` : "";
}

/** Element value-paths for an array tag: `Name[0]` … or `Name[0,0]` … for multi-dim arrays. */
export function arrayElementNames(name: string, dimensions: number | readonly number[]): string[] {
  const normalized = normalizeArrayDimensions(dimensions);
  if (normalized.length === 0) return [];
  const paths: string[] = [];
  const walk = (indices: number[], depth: number): void => {
    if (depth === normalized.length) {
      paths.push(`${name}[${indices.join(",")}]`);
      return;
    }
    for (let index = 0; index < normalized[depth]!; index += 1) {
      walk([...indices, index], depth + 1);
    }
  };
  walk([], 0);
  return paths;
}

/**
 * Parse an array element reference into its base tag and index.
 *  - "MyArray[3]" → { base: "MyArray", index: 3 }
 *  - "MyArray[1,2]" → { base: "MyArray", index: 1, indices: [1, 2] }
 *  - "Plain" / "Tag.Member" → null
 */
export function parseArrayIndex(operand: string): { base: string; index: number; indices: number[] } | null {
  const match = operand.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)\[([0-9,\s]+)\]$/);
  if (!match) return null;
  const indices = match[2]!.split(",").map((part) => Number(part.trim()));
  if (indices.some((index) => !Number.isInteger(index) || index < 0)) return null;
  return { base: match[1]!, index: indices[0] ?? 0, indices };
}
