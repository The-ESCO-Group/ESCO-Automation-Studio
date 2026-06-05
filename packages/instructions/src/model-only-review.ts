import type { LadderNode, OperandKind } from "@esco/ladder";
import {
  supportLevel,
  instructionFidelity,
  instructionFidelityLabel,
  supportLevelLabel,
  type InstructionCategory,
  type InstructionDefinition,
  type InstructionFidelityStatus,
  type InstructionOperandDefinition,
} from "./types";

export type ModelOnlyInstructionBoundary =
  | "pass-through-rung-power"
  | "no-runtime-tag-memory-access"
  | "no-controller-communication"
  | "no-message-execution"
  | "no-cip-message-connection"
  | "no-remote-data-transfer"
  | "no-message-control-status-update"
  | "no-system-value-transfer"
  | "no-controller-object-attribute-read"
  | "no-controller-object-attribute-write"
  | "no-serial-port-access"
  | "no-ascii-handshake-line-read"
  | "no-ascii-handshake-line-write"
  | "no-ascii-handshake-mask-application"
  | "no-serial-control-status-update"
  | "no-process-loop-execution"
  | "no-pid-algorithm-execution"
  | "no-process-variable-sampling"
  | "no-control-variable-output"
  | "no-loop-update-scheduling"
  | "no-process-status-or-alarm-update"
  | "no-manual-cascade-or-tieback-handling"
  | "no-closed-loop-tuning"
  | "no-signal-conditioning-or-totalizer-calculation"
  | "no-motion-command"
  | "no-motion-planner-execution"
  | "no-axis-state-update"
  | "no-drive-command"
  | "no-motion-feedback"
  | "no-coordinate-system-transform"
  | "no-motion-group-coordination"
  | "no-cam-or-gear-evaluation"
  | "no-motion-event-watch-or-registration"
  | "no-safety-evaluation"
  | "no-alarm-evaluation"
  | "no-alarm-condition-evaluation"
  | "no-alarm-status-update"
  | "no-alarm-latch-or-acknowledge"
  | "no-alarm-deadband-or-delay-timing"
  | "no-phase-state-engine"
  | "no-phase-command-dispatch"
  | "no-phase-failure-handling"
  | "no-phase-ownership-arbitration"
  | "no-phase-external-request"
  | "no-sfc-state-engine"
  | "no-sfc-step-reset"
  | "no-sfc-chart-pause"
  | "no-sfc-transition-marking"
  | "no-sequencer-file-comparison"
  | "no-sequencer-status-update"
  | "no-asynchronous-task-or-interrupt-trigger";

export type ModelOnlyOperandRole = "tag" | "keyword" | "routine" | "expression" | "literal";

export interface ModelOnlyInstructionReviewOperand {
  index: number;
  name: string;
  label: string;
  value: string;
  kind: OperandKind;
  required: boolean;
  declared: boolean;
  missing: boolean;
  role: ModelOnlyOperandRole;
  declaredDirection: "read" | "write";
  allowedTypes?: string[];
}

export interface ModelOnlyInstructionReview {
  instructionType: string;
  displayName: string;
  category: InstructionCategory;
  description: string;
  supportLevel: "model-only";
  supportLabel: string;
  fidelityStatus: InstructionFidelityStatus;
  fidelityLabel: string;
  fidelitySummary: string;
  fidelityLimitations: string[];
  rungBehavior: "pass-through";
  boundaries: ModelOnlyInstructionBoundary[];
  operands: ModelOnlyInstructionReviewOperand[];
  runtimeEffects: {
    tagMemoryAccess: false;
    controllerCommunication: false;
    messageExecution: false;
    cipMessageConnection: false;
    remoteDataTransfer: false;
    messageControlStatusUpdate: false;
    systemValueTransfer: false;
    controllerObjectAttributeRead: false;
    controllerObjectAttributeWrite: false;
    serialPortAccess: false;
    asciiHandshakeLineRead: false;
    asciiHandshakeLineWrite: false;
    asciiHandshakeMaskApplication: false;
    serialControlStatusUpdate: false;
    processLoopExecution: false;
    pidAlgorithmExecution: false;
    processVariableSampling: false;
    controlVariableOutput: false;
    loopUpdateScheduling: false;
    processStatusOrAlarmUpdate: false;
    manualCascadeOrTiebackHandling: false;
    closedLoopTuning: false;
    signalConditioningOrTotalizerCalculation: false;
    motionCommand: false;
    motionPlannerExecution: false;
    axisStateUpdate: false;
    driveCommand: false;
    motionFeedback: false;
    coordinateSystemTransform: false;
    motionGroupCoordination: false;
    camOrGearEvaluation: false;
    motionEventWatchOrRegistration: false;
    safetyEvaluation: false;
    alarmEvaluation: false;
    alarmConditionEvaluation: false;
    alarmStatusUpdate: false;
    alarmLatchOrAcknowledge: false;
    alarmDeadbandOrDelayTiming: false;
    phaseStateEngine: false;
    phaseCommandDispatch: false;
    phaseFailureHandling: false;
    phaseOwnershipArbitration: false;
    phaseExternalRequest: false;
    sfcStateEngine: false;
    sfcStepReset: false;
    sfcChartPause: false;
    sfcTransitionMarking: false;
    sequencerFileComparison: false;
    sequencerStatusUpdate: false;
    asynchronousTaskOrInterruptTrigger: false;
  };
  notes: string[];
}

const PHASE_TYPES = new Set(["PSC", "PCMD", "POVR", "PPD", "PFL", "PCLF", "PATT", "PDET", "PXRQ", "PRNP"]);
// Granular phase runtime behaviours, grouped exactly as phase.ts sections them.
// Each PhaseManager block performs a distinct slice of the state engine on a
// controller; the offline review states which slice does not run, not just the
// umbrella "no phase state engine". None of it is simulated — faking a phase
// state change would misrepresent how the program runs on a controller.
const PHASE_COMMAND_TYPES = new Set(["PSC", "PCMD", "POVR", "PPD"]); // state-complete / command / override / pause signals to the state machine
const PHASE_FAILURE_TYPES = new Set(["PFL", "PCLF"]); // raise / clear phase failure status
const PHASE_OWNERSHIP_TYPES = new Set(["PATT", "PDET"]); // attach / detach program ownership of a phase
const PHASE_EXTERNAL_TYPES = new Set(["PXRQ", "PRNP"]); // external sequencer / FactoryTalk Batch request and parameter handshake
const SFC_TYPES = new Set(["SFR", "SFP", "EOT"]);
// Granular SFC runtime behaviours, grouped exactly as sfc.ts sections them. Each
// RLL-side SFC control block performs a distinct slice of the chart's
// step/transition engine on a controller; the offline review states which slice
// does not run, not just the umbrella "no SFC state engine". None of it is
// simulated — faking a step reset or chart pause would misrepresent how the
// program runs on a controller (mirrors the phase granularity above).
const SFC_STEP_RESET_TYPES = new Set(["SFR"]); // reset the named SFC routine to a step
const SFC_CHART_PAUSE_TYPES = new Set(["SFP"]); // pause the named SFC routine
const SFC_TRANSITION_TYPES = new Set(["EOT"]); // mark the end of a transition
const ASYNC_TYPES = new Set(["EVENT", "UID", "UIE"]);
const PID_LOOP_TYPES = new Set(["PID", "PIDE"]);
const COORDINATED_MOTION_TYPES = new Set(["MCCD", "MCLM", "MCLP", "MCSR", "MCCM", "MCSD", "MCS", "MCT", "MCTP"]);
const MOTION_GROUP_TYPES = new Set(["MGS", "MGSD", "MGSR", "MGSP"]);
// Includes MCSV (Motion Calculate Slave Values): it evaluates the active cam
// profile to compute a slave axis's position/velocity/acceleration at a master
// value, and MCCP (Motion Calculate Cam Profile): it builds a cam-profile array
// from a set of cam points. Both evaluate the cam, so the offline review asserts
// the same no-cam-or-gear-evaluation guarantee as the gear/cam-arming blocks —
// the cam is never evaluated offline.
const CAM_OR_GEAR_MOTION_TYPES = new Set(["MAG", "MAPC", "MATC", "MAOC", "MDOC", "MCSV", "MCCP"]);
const EVENT_WATCH_MOTION_TYPES = new Set(["MAW", "MAR", "MDW", "MDR", "MAOC", "MDOC"]);

function addCategoryBoundaries(def: InstructionDefinition, boundaries: Set<ModelOnlyInstructionBoundary>): void {
  const type = def.type.toUpperCase();
  const description = def.description.toLowerCase();

  if (def.category === "message") boundaries.add("no-controller-communication");
  if (type === "MSG") {
    boundaries.add("no-message-execution");
    boundaries.add("no-cip-message-connection");
    boundaries.add("no-remote-data-transfer");
    boundaries.add("no-message-control-status-update");
  }
  if (type === "GSV") boundaries.add("no-controller-object-attribute-read");
  if (type === "SSV") boundaries.add("no-controller-object-attribute-write");
  if (def.category === "process") {
    boundaries.add("no-process-loop-execution");
    boundaries.add("no-loop-update-scheduling");
    boundaries.add("no-process-status-or-alarm-update");
    boundaries.add("no-closed-loop-tuning");
    if (PID_LOOP_TYPES.has(type)) {
      boundaries.add("no-pid-algorithm-execution");
      boundaries.add("no-process-variable-sampling");
      boundaries.add("no-control-variable-output");
      boundaries.add("no-manual-cascade-or-tieback-handling");
    } else {
      boundaries.add("no-signal-conditioning-or-totalizer-calculation");
    }
  }
  if (def.category === "motion") {
    boundaries.add("no-motion-command");
    boundaries.add("no-motion-planner-execution");
    boundaries.add("no-axis-state-update");
    boundaries.add("no-drive-command");
    boundaries.add("no-motion-feedback");
    if (COORDINATED_MOTION_TYPES.has(type)) {
      boundaries.add("no-coordinate-system-transform");
      boundaries.add("no-motion-group-coordination");
    }
    if (MOTION_GROUP_TYPES.has(type)) boundaries.add("no-motion-group-coordination");
    if (CAM_OR_GEAR_MOTION_TYPES.has(type)) boundaries.add("no-cam-or-gear-evaluation");
    if (EVENT_WATCH_MOTION_TYPES.has(type)) boundaries.add("no-motion-event-watch-or-registration");
  }
  if (def.category === "sequencer") {
    // Future model-only sequencer blocks should state the two distinct runtime
    // behaviours they do not perform: masked file comparison and CONTROL status
    // updates. The core SQO/SQI/SQC/SQL family is executable in sequencer.ts.
    boundaries.add("no-sequencer-file-comparison");
    boundaries.add("no-sequencer-status-update");
  }
  if (def.category === "safety") boundaries.add("no-safety-evaluation");
  if (def.category === "alarm") {
    // ALMA/ALMD are model-only. Mirror the process/motion granularity: assert
    // each distinct runtime behaviour the alarm block performs on a controller
    // — comparing the input against its limits/condition, driving the alarm
    // status bits, latch/acknowledge handling, and deadband/on-off-delay timing
    // — so the offline review states none of them happen, not just the umbrella
    // "no alarm evaluation". Offline alarming has no controller-faithful
    // execution and must never be faked.
    boundaries.add("no-alarm-evaluation");
    boundaries.add("no-alarm-condition-evaluation");
    boundaries.add("no-alarm-status-update");
    boundaries.add("no-alarm-latch-or-acknowledge");
    boundaries.add("no-alarm-deadband-or-delay-timing");
  }

  if (type === "GSV" || type === "SSV") boundaries.add("no-system-value-transfer");
  if (description.includes("serial port")) boundaries.add("no-serial-port-access");
  if (type === "AHL") {
    // AHL drives the physical serial handshake lines, so it asserts the
    // serial-port offline guarantee explicitly by type — not only via the
    // description heuristic above, which would silently drop this
    // safety-relevant boundary if the instruction's description text changed.
    boundaries.add("no-serial-port-access");
    boundaries.add("no-ascii-handshake-line-read");
    boundaries.add("no-ascii-handshake-line-write");
    boundaries.add("no-ascii-handshake-mask-application");
    boundaries.add("no-serial-control-status-update");
  }
  if (PHASE_TYPES.has(type) || description.includes("phasemanager")) {
    boundaries.add("no-phase-state-engine");
    if (PHASE_COMMAND_TYPES.has(type)) boundaries.add("no-phase-command-dispatch");
    if (PHASE_FAILURE_TYPES.has(type)) boundaries.add("no-phase-failure-handling");
    if (PHASE_OWNERSHIP_TYPES.has(type)) boundaries.add("no-phase-ownership-arbitration");
    if (PHASE_EXTERNAL_TYPES.has(type)) boundaries.add("no-phase-external-request");
  }
  if (SFC_TYPES.has(type) || description.includes("sfc step")) {
    boundaries.add("no-sfc-state-engine");
    if (SFC_STEP_RESET_TYPES.has(type)) boundaries.add("no-sfc-step-reset");
    if (SFC_CHART_PAUSE_TYPES.has(type)) boundaries.add("no-sfc-chart-pause");
    if (SFC_TRANSITION_TYPES.has(type)) boundaries.add("no-sfc-transition-marking");
  }
  if (ASYNC_TYPES.has(type) || description.includes("event task") || description.includes("interrupt scheduling")) {
    boundaries.add("no-asynchronous-task-or-interrupt-trigger");
  }
}

function operandRole(kind: OperandKind, operandDef: InstructionOperandDefinition | undefined): ModelOnlyOperandRole {
  if (operandDef?.isRoutineRef || kind === "routine") return "routine";
  if (operandDef?.isLabelRef) return "keyword";
  if (operandDef?.isExpression || kind === "expression") return "expression";
  if (kind === "literal") return "literal";
  return "tag";
}

export function modelOnlyBoundaryLabel(boundary: ModelOnlyInstructionBoundary): string {
  switch (boundary) {
    case "pass-through-rung-power":
      return "passes rung power through";
    case "no-runtime-tag-memory-access":
      return "no runtime tag read/write";
    case "no-controller-communication":
      return "no controller communication";
    case "no-message-execution":
      return "no MSG execution";
    case "no-cip-message-connection":
      return "no CIP message connection";
    case "no-remote-data-transfer":
      return "no remote data transfer";
    case "no-message-control-status-update":
      return "no MESSAGE control status update";
    case "no-system-value-transfer":
      return "no system value transfer";
    case "no-controller-object-attribute-read":
      return "no controller object attribute read";
    case "no-controller-object-attribute-write":
      return "no controller object attribute write";
    case "no-serial-port-access":
      return "no serial port access";
    case "no-ascii-handshake-line-read":
      return "no ASCII handshake line read";
    case "no-ascii-handshake-line-write":
      return "no ASCII handshake line write";
    case "no-ascii-handshake-mask-application":
      return "no ASCII handshake mask application";
    case "no-serial-control-status-update":
      return "no serial control/status update";
    case "no-process-loop-execution":
      return "no process loop execution";
    case "no-pid-algorithm-execution":
      return "no PID algorithm execution";
    case "no-process-variable-sampling":
      return "no process variable sampling";
    case "no-control-variable-output":
      return "no control variable output";
    case "no-loop-update-scheduling":
      return "no loop update scheduling";
    case "no-process-status-or-alarm-update":
      return "no process status/alarm update";
    case "no-manual-cascade-or-tieback-handling":
      return "no manual/cascade/tieback handling";
    case "no-closed-loop-tuning":
      return "no closed-loop tuning";
    case "no-signal-conditioning-or-totalizer-calculation":
      return "no signal-conditioning/totalizer calculation";
    case "no-motion-command":
      return "no motion command";
    case "no-motion-planner-execution":
      return "no motion planner execution";
    case "no-axis-state-update":
      return "no axis state update";
    case "no-drive-command":
      return "no drive command";
    case "no-motion-feedback":
      return "no motion feedback";
    case "no-coordinate-system-transform":
      return "no coordinate-system transform";
    case "no-motion-group-coordination":
      return "no motion group coordination";
    case "no-cam-or-gear-evaluation":
      return "no cam/gear evaluation";
    case "no-motion-event-watch-or-registration":
      return "no motion event watch/registration";
    case "no-safety-evaluation":
      return "no safety evaluation";
    case "no-alarm-evaluation":
      return "no alarm evaluation";
    case "no-alarm-condition-evaluation":
      return "no alarm condition/limit evaluation";
    case "no-alarm-status-update":
      return "no alarm status update";
    case "no-alarm-latch-or-acknowledge":
      return "no alarm latch/acknowledge handling";
    case "no-alarm-deadband-or-delay-timing":
      return "no alarm deadband/delay timing";
    case "no-phase-state-engine":
      return "no PhaseManager state engine";
    case "no-phase-command-dispatch":
      return "no phase command dispatch";
    case "no-phase-failure-handling":
      return "no phase failure handling";
    case "no-phase-ownership-arbitration":
      return "no phase ownership arbitration";
    case "no-phase-external-request":
      return "no phase external request";
    case "no-sfc-state-engine":
      return "no SFC step engine";
    case "no-sfc-step-reset":
      return "no SFC step reset";
    case "no-sfc-chart-pause":
      return "no SFC chart pause";
    case "no-sfc-transition-marking":
      return "no SFC transition marking";
    case "no-sequencer-file-comparison":
      return "no sequencer file comparison";
    case "no-sequencer-status-update":
      return "no sequencer control/status update";
    case "no-asynchronous-task-or-interrupt-trigger":
      return "no async task/interrupt trigger";
  }
}

/**
 * Project the IDE-facing review state for an instruction that is intentionally
 * preserved but not simulated. Operand directions are review/cross-reference
 * roles only: the offline executor must remain a strict pass-through.
 */
export function describeModelOnlyInstructionReview(
  def: InstructionDefinition | undefined,
  node: LadderNode,
): ModelOnlyInstructionReview | undefined {
  if (supportLevel(def) !== "model-only" || !def) return undefined;
  const fidelity = instructionFidelity(def);

  const boundaries = new Set<ModelOnlyInstructionBoundary>([
    "pass-through-rung-power",
    "no-runtime-tag-memory-access",
  ]);
  addCategoryBoundaries(def, boundaries);

  const count = Math.max(def.operands.length, node.operands.length);
  const operands: ModelOnlyInstructionReviewOperand[] = [];
  for (let index = 0; index < count; index += 1) {
    const operandDef = def.operands[index];
    const operand = node.operands[index];
    const value = operand?.value?.trim() ?? "";
    operands.push({
      index,
      name: operandDef?.name ?? operand?.name ?? `op${index}`,
      label: operandDef?.label ?? operand?.name ?? `op${index}`,
      value,
      kind: operand?.kind ?? "tag",
      required: operandDef?.required ?? false,
      declared: Boolean(operandDef),
      missing: Boolean(operandDef?.required && !value),
      role: operandRole(operand?.kind ?? "tag", operandDef),
      declaredDirection: operandDef?.direction ?? "read",
      ...(operandDef?.allowedTypes ? { allowedTypes: [...operandDef.allowedTypes] } : {}),
    });
  }

  return {
    instructionType: def.type,
    displayName: def.displayName,
    category: def.category,
    description: def.description,
    supportLevel: "model-only",
    supportLabel: supportLevelLabel("model-only"),
    fidelityStatus: fidelity.status,
    fidelityLabel: instructionFidelityLabel(fidelity.status),
    fidelitySummary: fidelity.summary,
    fidelityLimitations: [...(fidelity.limitations ?? [])],
    rungBehavior: "pass-through",
    boundaries: [...boundaries],
    operands,
    runtimeEffects: {
      tagMemoryAccess: false,
      controllerCommunication: false,
      messageExecution: false,
      cipMessageConnection: false,
      remoteDataTransfer: false,
      messageControlStatusUpdate: false,
      systemValueTransfer: false,
      controllerObjectAttributeRead: false,
      controllerObjectAttributeWrite: false,
      serialPortAccess: false,
      asciiHandshakeLineRead: false,
      asciiHandshakeLineWrite: false,
      asciiHandshakeMaskApplication: false,
      serialControlStatusUpdate: false,
      processLoopExecution: false,
      pidAlgorithmExecution: false,
      processVariableSampling: false,
      controlVariableOutput: false,
      loopUpdateScheduling: false,
      processStatusOrAlarmUpdate: false,
      manualCascadeOrTiebackHandling: false,
      closedLoopTuning: false,
      signalConditioningOrTotalizerCalculation: false,
      motionCommand: false,
      motionPlannerExecution: false,
      axisStateUpdate: false,
      driveCommand: false,
      motionFeedback: false,
      coordinateSystemTransform: false,
      motionGroupCoordination: false,
      camOrGearEvaluation: false,
      motionEventWatchOrRegistration: false,
      safetyEvaluation: false,
      alarmEvaluation: false,
      alarmConditionEvaluation: false,
      alarmStatusUpdate: false,
      alarmLatchOrAcknowledge: false,
      alarmDeadbandOrDelayTiming: false,
      phaseStateEngine: false,
      phaseCommandDispatch: false,
      phaseFailureHandling: false,
      phaseOwnershipArbitration: false,
      phaseExternalRequest: false,
      sfcStateEngine: false,
      sfcStepReset: false,
      sfcChartPause: false,
      sfcTransitionMarking: false,
      sequencerFileComparison: false,
      sequencerStatusUpdate: false,
      asynchronousTaskOrInterruptTrigger: false,
    },
    notes: [
      "Registered for offline review and round-trip preservation.",
      "Execution returns the rung-in condition unchanged.",
      "Operand directions describe review/cross-reference roles only, not simulator side effects.",
    ],
  };
}
