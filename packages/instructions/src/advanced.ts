import type {
  InstructionCategory,
  InstructionDefinition,
  InstructionFidelityStatus,
  InstructionOperandDefinition,
} from "./types";

/**
 * Model-only advanced instructions: message, alarm, motion, and asynchronous
 * task/interrupt families. They are registered so real L5X imports parse,
 * render, and validate (as info, never an error) instead of being flagged
 * "unsupported", and so their operands are preserved on the rung. None of them
 * are simulated —
 * each is a safe pass-through (returns the rung-in condition unchanged) and none
 * touches a controller. Keyword-only blocks (for example GSV/SSV class and
 * attribute names) leave their operands declared as labels so the
 * validator never mistakes a keyword operand for an undefined tag; the motion and
 * alarm families declare review operands (the commanded axis / the backing alarm
 * tag) so the owned object surfaces in cross-reference as a destructive reference
 * — see the helpers below.
 *
 * PID / PIDE and the rest of the process-control family now live in process.ts
 * (registered model-only), and the GuardLogix safety family in safety.ts. The
 * canonical "unknown unsupported" example used by tests and fixtures is the
 * vendor token `XUNKNOWN`, which is intentionally never registered.
 */

function modelOnly(
  type: string,
  displayName: string,
  category: InstructionCategory,
  description: string,
  operands: InstructionOperandDefinition[] = [],
  fidelityStatus: InstructionFidelityStatus = "model-only",
): InstructionDefinition {
  return {
    type,
    displayName,
    category,
    description,
    operands,
    fidelity: {
      status: fidelityStatus,
      summary: description,
      limitations: [
        "pass-through rung execution only",
        "no runtime tag-memory side effects",
        "no controller or hardware side effects",
      ],
    },
    modelOnly: true,
    validate: () => [],
    execute: (_node, ctx) => ctx.rungIn,
    render: { symbol: type, style: "box" },
  };
}

const keywordOperand = (name: string, label: string, required = true): InstructionOperandDefinition => ({
  name,
  label,
  required,
  isLabelRef: true,
});

/**
 * Motion review operands. Every motion instruction names the motion object it
 * commands as its first operand — an Axis, a Coordinate System, or a Motion
 * Group — and the single-axis / simple-coordinated / group forms name a Motion
 * Control tag (the MOTION_INSTRUCTION status structure whose .DN/.ER/.PC bits
 * surrounding logic reads) as the second. Declaring these as review operands
 * surfaces them in the property panel and tag cross-reference (as destructive
 * references) without making the block executable: operand validation is
 * skipped for model-only instructions, so they never produce false "undefined
 * tag" findings, and the executor stays a strict pass-through. The gear/cam
 * (MAG/MAPC), transform (MCT) and slave-value (MCSV) forms reorder their
 * operands, so only their leading motion object is declared.
 */
const motionObject = (name: string, label: string): InstructionOperandDefinition => ({
  name,
  label,
  required: true,
  direction: "write",
});
const motionControl: InstructionOperandDefinition = {
  name: "motionControl",
  label: "Motion Control",
  required: true,
  direction: "write",
};
const axisOperands: InstructionOperandDefinition[] = [motionObject("axis", "Axis"), { ...motionControl }];

// --- Message / system value (NO controller communication) ---
export const MSG = modelOnly(
  "MSG",
  "Message",
  "message",
  "Message (model-only): preserved and displayed; never communicates with a controller and is not simulated.",
  [{ name: "message", label: "Message", required: true, allowedTypes: ["MESSAGE"], direction: "write" }],
);
export const GSV = modelOnly(
  "GSV",
  "Get System Value",
  "message",
  "Get System Value (model-only): preserved and displayed; not simulated.",
  [
    keywordOperand("className", "Class Name"),
    keywordOperand("instanceName", "Instance Name", false),
    keywordOperand("attributeName", "Attribute Name"),
    { name: "dest", label: "Dest", required: true, direction: "write" },
  ],
);
export const SSV = modelOnly(
  "SSV",
  "Set System Value",
  "message",
  "Set System Value (model-only): preserved and displayed; not simulated.",
  [
    keywordOperand("className", "Class Name"),
    keywordOperand("instanceName", "Instance Name", false),
    keywordOperand("attributeName", "Attribute Name"),
    { name: "source", label: "Source", required: true, direction: "read" },
  ],
);

// --- Alarms ---
// Both alarm blocks back an ALARM_ANALOG / ALARM_DIGITAL tag and read an input.
// Neutral text is ALMx(AlarmTag, In, ...command bits): the leading two operands
// are unambiguous, so we declare them as review operands and leave the trailing
// program-command bits (ProgAck / ProgReset / ProgDisable / ProgEnable) to fall
// through to opN — exactly like the reordered motion forms. The alarm tag is the
// object the instruction owns and updates (status bits), so it is declared as a
// destructive (write) reference; In is the read input. Operand validation is
// skipped for model-only instructions, so allowedTypes only informs the editor.
const alarmTag = (type: string): InstructionOperandDefinition => ({
  name: "alarm",
  label: "Alarm Tag",
  required: true,
  allowedTypes: [type],
  direction: "write",
});
const alarmInput: InstructionOperandDefinition = { name: "in", label: "In", required: true, direction: "read" };

export const ALMA = modelOnly(
  "ALMA",
  "Analog Alarm",
  "alarm",
  "Analog Alarm (model-only): preserved and displayed for review; its backing ALARM_ANALOG tag is modelled, but the alarm is never simulated.",
  [alarmTag("ALARM_ANALOG"), { ...alarmInput }],
  "review-only",
);
export const ALMD = modelOnly(
  "ALMD",
  "Digital Alarm",
  "alarm",
  "Digital Alarm (model-only): preserved and displayed for review; its backing ALARM_DIGITAL tag is modelled, but the alarm is never simulated.",
  [alarmTag("ALARM_DIGITAL"), { ...alarmInput }],
  "review-only",
);

// --- Motion (NO real motion control) ---
const motionDesc = (displayName: string): string =>
  `${displayName} (model-only): preserved and displayed for review; no real motion control and not simulated.`;

const motion = (
  type: string,
  displayName: string,
  operands: InstructionOperandDefinition[] = axisOperands,
): InstructionDefinition => modelOnly(type, displayName, "motion", motionDesc(displayName), operands, "review-only");

const coordOperands: InstructionOperandDefinition[] = [
  motionObject("coordinateSystem", "Coordinate System"),
  { ...motionControl },
];
const groupOperands: InstructionOperandDefinition[] = [
  motionObject("motionGroup", "Motion Group"),
  { ...motionControl },
];

// Single-axis motion — (Axis, Motion Control).
export const MSO = motion("MSO", "Motion Servo On");
export const MSF = motion("MSF", "Motion Servo Off");
export const MAM = motion("MAM", "Motion Axis Move");
export const MAJ = motion("MAJ", "Motion Axis Jog");
export const MAS = motion("MAS", "Motion Axis Stop");
export const MCD = motion("MCD", "Motion Change Dynamics");
export const MDO = motion("MDO", "Motion Direct Drive On");
export const MDF = motion("MDF", "Motion Direct Drive Off");
export const MDAC = motion("MDAC", "Motion Drive Axis Control");
export const MAH = motion("MAH", "Motion Axis Home");
export const MHS = motion("MHS", "Motion Home Sequence");
export const MRP = motion("MRP", "Motion Redefine Position");
export const MRAT = motion("MRAT", "Motion Run Axis Tuning");
export const MAAT = motion("MAAT", "Motion Apply Axis Tuning");
// Hookup diagnostics — (Axis, Motion Control[, DiagnosticTest[, ObservedDirection]]).
// The leading two operands match the single-axis form; the trailing test selector
// and observed-direction operands fall through to opN as read references, exactly
// like the conditioning inputs after MRAT's axis/control pair.
export const MRHD = motion("MRHD", "Motion Run Hookup Diagnostics");
export const MAHD = motion("MAHD", "Motion Apply Hookup Diagnostics");
export const MAFR = motion("MAFR", "Motion Axis Fault Reset");
export const MASD = motion("MASD", "Motion Axis Shutdown");
export const MASR = motion("MASR", "Motion Axis Shutdown Reset");
export const MDW = motion("MDW", "Motion Disarm Watch");
export const MDR = motion("MDR", "Motion Disarm Registration");

// Coordinated motion — (Coordinate System, Motion Control).
export const MCCD = motion("MCCD", "Motion Coordinated Change Dynamics", coordOperands);
export const MCLM = motion("MCLM", "Motion Coordinated Linear Move", coordOperands);
export const MCLP = motion("MCLP", "Motion Coordinated Linear Path", coordOperands);
export const MCSR = motion("MCSR", "Motion Coordinated Shutdown Reset", coordOperands);
export const MCCM = motion("MCCM", "Motion Coordinated Circular Move", coordOperands);
export const MCSD = motion("MCSD", "Motion Coordinated Shutdown", coordOperands);
export const MCS = motion("MCS", "Motion Coordinated Stop", coordOperands);
export const MCTP = motion("MCTP", "Motion Calculate Transform Position", coordOperands);

// Motion group — (Motion Group, Motion Control).
export const MGS = motion("MGS", "Motion Group Stop", groupOperands);
export const MGSD = motion("MGSD", "Motion Group Shutdown", groupOperands);
export const MGSR = motion("MGSR", "Motion Group Shutdown Reset", groupOperands);
export const MGSP = motion("MGSP", "Motion Group Strobe Position", groupOperands);

// Reordered forms — declare only the leading motion object for review. MAW/MAR
// interleave a trigger condition before the Motion Control, and MAOC/MDOC name an
// output-cam execution target (a number, not a tag) second, so only the commanded
// axis / coordinate system is declared and the rest falls through to opN.
export const MCT = motion("MCT", "Motion Coordinated Transform", [motionObject("coordinateSystem", "Coordinate System")]);
export const MCSV = motion("MCSV", "Motion Calculate Slave Values", [motionObject("axis", "Axis")]);
// MCCP — (Motion Control, Cam, Length, Cam Profile, ...). Unlike every other
// motion block, MCCP commands no axis/coordinate-system/group object: it computes
// a cam-profile array from a set of cam points. Its leading operand is therefore
// the Motion Control tag (the MOTION_INSTRUCTION status structure it owns and
// updates), so only that is declared as a write review operand and the cam /
// length / cam-profile operands fall through to opN. It evaluates the cam, so the
// offline review asserts the same no-cam-or-gear-evaluation guarantee as MCSV —
// the cam is never evaluated offline (see model-only-review.ts).
export const MCCP = motion("MCCP", "Motion Calculate Cam Profile", [{ ...motionControl }]);
export const MAG = motion("MAG", "Motion Axis Gear", [motionObject("slaveAxis", "Slave Axis")]);
export const MAPC = motion("MAPC", "Motion Axis Position Cam", [motionObject("slaveAxis", "Slave Axis")]);
export const MAW = motion("MAW", "Motion Arm Watch", [motionObject("axis", "Axis")]);
export const MAR = motion("MAR", "Motion Arm Registration", [motionObject("axis", "Axis")]);
export const MAOC = motion("MAOC", "Motion Arm Output Cam", [motionObject("axis", "Axis")]);
export const MDOC = motion("MDOC", "Motion Disarm Output Cam", [motionObject("axis", "Axis")]);
// Time cam — (Axis, Motion Control[, Direction, CamProfile, ...]). The time-cam
// counterpart to the position cam MAPC, but the cam is driven by time, not a
// master axis, so MATC has no master-axis operand: its Motion Control tag stays
// in the second slot, matching the standard single-axis order (axisOperands).
// The trailing direction / cam-profile operands fall through to opN as reads.
export const MATC = motion("MATC", "Motion Axis Time Cam");

// --- Program control (interrupt scheduling is not simulated offline) ---
export const UID = modelOnly("UID", "User Interrupt Disable", "program-control", "User Interrupt Disable (model-only): interrupt scheduling is not simulated; pass-through.");
export const UIE = modelOnly("UIE", "User Interrupt Enable", "program-control", "User Interrupt Enable (model-only): interrupt scheduling is not simulated; pass-through.");

// EVENT - Trigger Event Task. Fires an event task configured with the
// "EVENT Instruction Only" trigger (the <EventInfo> imported read-only in
// core/types.ts). The offline runtime models scheduled main-routine scanning
// but has no asynchronous task scheduler, so triggering an event task cannot be
// reproduced faithfully and must never be faked: it stays model-only and passes
// the rung condition through. Its sole operand is the Task name — a reference to
// a Task object, not a tag — so it is declared as a keyword operand (like the
// GSV/SSV class/attribute names) to keep cross-reference from mis-classifying
// the task name as a tag read.
export const EVENT = modelOnly(
  "EVENT",
  "Trigger Event Task",
  "program-control",
  "Trigger Event Task (model-only): the offline scan has no asynchronous task scheduler, so the event task is preserved and displayed but never triggered.",
  [keywordOperand("task", "Task")],
);

/** Every model-only advanced instruction, for bulk registration. */
export const ADVANCED_MODEL_ONLY: InstructionDefinition[] = [
  MSG, GSV, SSV,
  ALMA, ALMD,
  MSO, MSF, MAM, MAJ, MAS,
  MCD, MCCD, MCLM, MCLP, MCT, MAG, MAPC, MCSV, MCCP, MCSR, MDO, MDF, MDAC, MAH, MHS, MRP, MRAT, MAAT, MRHD, MAHD, MGS,
  MAFR, MASD, MASR, MDW, MDR,
  MCCM, MCSD, MCS, MCTP,
  MGSD, MGSR, MGSP,
  MAW, MAR, MAOC, MDOC, MATC,
  UID, UIE, EVENT,
];
