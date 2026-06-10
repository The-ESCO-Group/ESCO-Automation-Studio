import type {
  BlockedReason,
  CommandAvailability,
  CommandRisk,
  ConnectionState,
  ControllerCommand,
  ControllerCommandKind,
  TransportCapabilities,
} from "./types";
import { isConnectedState } from "./types";

/**
 * The guarded controller commands and the pure logic that decides whether each
 * one may run. This is where "visible but safely blocked" is enforced: a command
 * is always describable (so the UI can show it), but {@link evaluateCommand}
 * returns `available: false` with a precise reason unless every safety condition
 * holds.
 */

export const NETWORK_BROWSER_COMMAND: ControllerCommand = {
  kind: "network-browser",
  label: "Controller Route Browser",
  description: "Browse ESCO controller routes and communication paths through a verified workstation/controller transport.",
  requiresRealIo: true,
  isWrite: false,
  requiresConfirmation: false,
};

export const SELECT_RECENT_PATH_COMMAND: ControllerCommand = {
  kind: "select-recent-path",
  label: "Saved Controller Path",
  description: "Select a saved controller communication path for online operations.",
  requiresRealIo: true,
  isWrite: false,
  requiresConfirmation: false,
};

export const PATH_DIAGNOSTICS_COMMAND: ControllerCommand = {
  kind: "path-diagnostics",
  label: "Path Diagnostics",
  description: "Inspect controller path routing and transport readiness before online operations.",
  requiresRealIo: true,
  isWrite: false,
  requiresConfirmation: false,
};

export const UPLOAD_COMMAND: ControllerCommand = {
  kind: "upload",
  label: "Upload from Controller",
  description: "Read the running program and tag values from a connected controller into the project.",
  requiresRealIo: true,
  isWrite: false,
  requiresConfirmation: true,
};

export const GO_ONLINE_COMMAND: ControllerCommand = {
  kind: "go-online",
  label: "Go Online",
  description: "Open a live session to a real controller. Requires a tested, verified transport.",
  requiresRealIo: true,
  isWrite: false,
  requiresConfirmation: true,
};

export const GO_OFFLINE_COMMAND: ControllerCommand = {
  kind: "go-offline",
  label: "Go Offline",
  description: "Disconnect the active session and return the workstation to Offline Simulation.",
  requiresRealIo: false,
  isWrite: false,
  requiresConfirmation: false,
};

export const MONITOR_COMMAND: ControllerCommand = {
  kind: "monitor",
  label: "Monitor Controller",
  description: "Read live tag values from a connected controller without writing logic.",
  requiresRealIo: true,
  isWrite: false,
  requiresConfirmation: false,
};

export const DOWNLOAD_COMMAND: ControllerCommand = {
  kind: "download",
  label: "Download to Controller",
  description: "Write this project to a controller and put it in Run mode. Destructive — overwrites the controller program.",
  requiresRealIo: true,
  isWrite: true,
  requiresConfirmation: true,
};

export const ONLINE_EDIT_COMMAND: ControllerCommand = {
  kind: "online-edit",
  label: "Online Edit (Accept/Assemble)",
  description: "Edit logic in a running controller and accept/assemble the change live.",
  requiresRealIo: true,
  isWrite: true,
  requiresConfirmation: true,
};

export const TEST_EDITS_COMMAND: ControllerCommand = {
  kind: "test-edits",
  label: "Test Edits",
  description: "Put pending online edits into Test mode on a running controller.",
  requiresRealIo: true,
  isWrite: true,
  requiresConfirmation: true,
};

export const ASSEMBLE_EDITS_COMMAND: ControllerCommand = {
  kind: "assemble-edits",
  label: "Assemble Edits",
  description: "Assemble tested online edits into the running controller logic.",
  requiresRealIo: true,
  isWrite: true,
  requiresConfirmation: true,
};

export const FINALIZE_EDITS_COMMAND: ControllerCommand = {
  kind: "finalize-edits",
  label: "Finalize All Edits",
  description: "Finalize all accepted online edits and remove edit-zone tracking from the controller.",
  requiresRealIo: true,
  isWrite: true,
  requiresConfirmation: true,
};

export const CANCEL_EDITS_COMMAND: ControllerCommand = {
  kind: "cancel-edits",
  label: "Cancel Edits",
  description: "Cancel pending online edits on the controller and return logic to the last assembled state.",
  requiresRealIo: true,
  isWrite: true,
  requiresConfirmation: true,
};

export const PROGRAM_MODE_COMMAND: ControllerCommand = {
  kind: "program-mode",
  label: "Program Mode",
  description: "Request Program mode on a connected controller.",
  requiresRealIo: true,
  isWrite: true,
  requiresConfirmation: true,
};

export const RUN_MODE_COMMAND: ControllerCommand = {
  kind: "run-mode",
  label: "Run Mode",
  description: "Request Run mode on a connected controller.",
  requiresRealIo: true,
  isWrite: true,
  requiresConfirmation: true,
};

export const REMOTE_PROGRAM_MODE_COMMAND: ControllerCommand = {
  kind: "remote-program-mode",
  label: "Remote Program",
  description: "Request Remote Program mode on a connected controller through a verified path.",
  requiresRealIo: true,
  isWrite: true,
  requiresConfirmation: true,
};

export const REMOTE_RUN_MODE_COMMAND: ControllerCommand = {
  kind: "remote-run-mode",
  label: "Remote Run",
  description: "Request Remote Run mode on a connected controller through a verified path.",
  requiresRealIo: true,
  isWrite: true,
  requiresConfirmation: true,
};

export const TEST_MODE_COMMAND: ControllerCommand = {
  kind: "test-mode",
  label: "Test Mode",
  description: "Request Test mode on a connected controller.",
  requiresRealIo: true,
  isWrite: true,
  requiresConfirmation: true,
};

export const LOCK_CONTROLLER_COMMAND: ControllerCommand = {
  kind: "lock-controller",
  label: "Lock Controller",
  description: "Lock a connected controller to prevent unauthorized changes.",
  requiresRealIo: true,
  isWrite: true,
  requiresConfirmation: true,
};

export const CLEAR_FAULTS_COMMAND: ControllerCommand = {
  kind: "clear-faults",
  label: "Clear Faults",
  description: "Clear controller faults on a connected controller.",
  requiresRealIo: true,
  isWrite: true,
  requiresConfirmation: true,
};

export const FAULT_DIAGNOSTICS_COMMAND: ControllerCommand = {
  kind: "fault-diagnostics",
  label: "Fault Diagnostics",
  description: "Read live controller fault status and diagnostic context through a verified path.",
  requiresRealIo: true,
  isWrite: false,
  requiresConfirmation: false,
};

export const GO_TO_FAULTS_COMMAND: ControllerCommand = {
  kind: "go-to-faults",
  label: "Go To Faults",
  description: "Read live fault status and navigate to the controller fault context.",
  requiresRealIo: true,
  isWrite: false,
  requiresConfirmation: false,
};

export const CONTROLLER_COMMANDS: Record<ControllerCommandKind, ControllerCommand> = {
  "network-browser": NETWORK_BROWSER_COMMAND,
  "select-recent-path": SELECT_RECENT_PATH_COMMAND,
  "path-diagnostics": PATH_DIAGNOSTICS_COMMAND,
  "go-online": GO_ONLINE_COMMAND,
  "go-offline": GO_OFFLINE_COMMAND,
  monitor: MONITOR_COMMAND,
  upload: UPLOAD_COMMAND,
  download: DOWNLOAD_COMMAND,
  "online-edit": ONLINE_EDIT_COMMAND,
  "test-edits": TEST_EDITS_COMMAND,
  "assemble-edits": ASSEMBLE_EDITS_COMMAND,
  "finalize-edits": FINALIZE_EDITS_COMMAND,
  "cancel-edits": CANCEL_EDITS_COMMAND,
  "program-mode": PROGRAM_MODE_COMMAND,
  "run-mode": RUN_MODE_COMMAND,
  "remote-program-mode": REMOTE_PROGRAM_MODE_COMMAND,
  "remote-run-mode": REMOTE_RUN_MODE_COMMAND,
  "test-mode": TEST_MODE_COMMAND,
  "lock-controller": LOCK_CONTROLLER_COMMAND,
  "clear-faults": CLEAR_FAULTS_COMMAND,
  "fault-diagnostics": FAULT_DIAGNOSTICS_COMMAND,
  "go-to-faults": GO_TO_FAULTS_COMMAND,
};

export const CONTROLLER_COMMAND_LIST: readonly ControllerCommand[] = [
  NETWORK_BROWSER_COMMAND,
  SELECT_RECENT_PATH_COMMAND,
  PATH_DIAGNOSTICS_COMMAND,
  GO_ONLINE_COMMAND,
  GO_OFFLINE_COMMAND,
  MONITOR_COMMAND,
  UPLOAD_COMMAND,
  DOWNLOAD_COMMAND,
  ONLINE_EDIT_COMMAND,
  TEST_EDITS_COMMAND,
  ASSEMBLE_EDITS_COMMAND,
  FINALIZE_EDITS_COMMAND,
  CANCEL_EDITS_COMMAND,
  PROGRAM_MODE_COMMAND,
  RUN_MODE_COMMAND,
  REMOTE_PROGRAM_MODE_COMMAND,
  REMOTE_RUN_MODE_COMMAND,
  TEST_MODE_COMMAND,
  LOCK_CONTROLLER_COMMAND,
  CLEAR_FAULTS_COMMAND,
  FAULT_DIAGNOSTICS_COMMAND,
  GO_TO_FAULTS_COMMAND,
];

export interface CommandContext {
  state: ConnectionState;
  capabilities: TransportCapabilities;
  /** Whether the user has explicitly confirmed this destructive/real action. */
  confirmed?: boolean;
}

/**
 * Commands that overwrite the running program / live logic or change run state.
 * These are the "destructive" tier — never just a write to a data table.
 */
const DESTRUCTIVE_COMMAND_KINDS = new Set<ControllerCommandKind>([
  "download",
  "online-edit",
  "test-edits",
  "assemble-edits",
  "finalize-edits",
  "cancel-edits",
  "program-mode",
  "run-mode",
  "remote-program-mode",
  "remote-run-mode",
  "test-mode",
]);

/** Classify a command as read / write / destructive for badging and audit. */
export function commandRisk(command: ControllerCommand): CommandRisk {
  if (!command.isWrite) return "read";
  return DESTRUCTIVE_COMMAND_KINDS.has(command.kind) ? "destructive" : "write";
}

/**
 * The exact next setup step that would unblock each blocked reason. This is the
 * "required next step" the Controller panel shows so a blocked command is never a
 * dead end — it always tells the engineer what to configure.
 */
const NEXT_STEP: Record<NonNullable<BlockedReason>, string> = {
  "model-only":
    "Leave model-only review: open an executable routine or switch to Offline Simulation before issuing controller commands.",
  "no-real-transport":
    "Install and select a verified ESCO controller transport. No tested transport ships in this build, so hardware commands stay disabled.",
  "not-connected":
    "Go Online to a controller through a verified transport before running this command.",
  "safety-unverified":
    "Validate the selected transport against tested hardware so its controller link is marked verified.",
  "safety-blocked-state":
    "Clear the Safety Blocked condition: review the connection audit, then re-select a safe transport.",
  "capability-missing":
    "Select a verified transport that explicitly supports this command. Monitor-only links do not enable browse, upload, write, or online-edit commands.",
  "needs-confirmation": "Confirm the action explicitly to proceed.",
  faulted: "Reconnect the session to clear the faulted state, then retry.",
};

/** The concrete next step to enable a command, or a confirmation note when available. */
export function nextStepFor(reason: BlockedReason): string {
  return reason ? NEXT_STEP[reason] : "Command is available to run.";
}

const EXPLAIN: Record<NonNullable<BlockedReason>, string> = {
  "model-only":
    "The active controller context is model-only: preserved for review, not simulated, and not connected to hardware.",
  "no-real-transport":
    "No tested controller transport is configured. Real controller communication commands are unavailable in this build.",
  "not-connected": "Connect to a controller before running this command.",
  "safety-unverified":
    "The selected transport's controller link has not been validated against tested hardware. Blocked for safety.",
  "safety-blocked-state": "The session is in a Safety Blocked state. Resolve it before continuing.",
  "capability-missing": "The verified transport does not expose the specific capability required by this command.",
  "needs-confirmation": "This action must be explicitly confirmed before it can run.",
  faulted: "The session is faulted. Reconnect before running this command.",
};

function hasReadCapability(command: ControllerCommand, capabilities: TransportCapabilities): boolean {
  switch (command.kind) {
    case "network-browser":
      return capabilities.canBrowseNetwork === true;
    case "select-recent-path":
      return capabilities.canSelectPath === true;
    case "path-diagnostics":
      return capabilities.canPathDiagnostics === true;
    case "upload":
      return capabilities.canUpload === true;
    case "monitor":
      return capabilities.canMonitor ?? capabilities.canRead;
    case "fault-diagnostics":
    case "go-to-faults":
      return capabilities.canReadFaults ?? capabilities.canMonitor ?? capabilities.canRead;
    case "go-online":
      return capabilities.canRead;
    default:
      return capabilities.canRead;
  }
}

/**
 * Decide whether a command may run right now. Pure. The ordering matters: the
 * "no real transport / unverified" gate is checked before connection or
 * confirmation so the UI always explains the real blocker honestly.
 */
export function evaluateCommand(command: ControllerCommand, ctx: CommandContext): CommandAvailability {
  const risk = commandRisk(command);
  const block = (reason: NonNullable<BlockedReason>): CommandAvailability => ({
    command,
    available: false,
    blocked: true,
    reason,
    explanation: EXPLAIN[reason],
    risk,
    nextStep: nextStepFor(reason),
  });

  if (command.requiresRealIo && ctx.state === "model-only") return block("model-only");

  if (command.requiresRealIo) {
    // Hard safety gate: a real action needs a transport that can actually reach a
    // controller AND has been verified against tested hardware. Neither shipped
    // transport qualifies, so these are always blocked in this build.
    if (!ctx.capabilities.realControllerIo) return block("no-real-transport");
    if (!ctx.capabilities.verified) return block("safety-unverified");
    if (command.isWrite && !ctx.capabilities.canWrite) return block("capability-missing");
    if (!command.isWrite && !hasReadCapability(command, ctx.capabilities)) return block("capability-missing");
  }

  if (command.requiresRealIo && ctx.state === "safety-blocked") return block("safety-blocked-state");
  if (command.requiresRealIo && ctx.state === "faulted") return block("faulted");

  if (command.requiresRealIo && !isConnectedState(ctx.state)) return block("not-connected");

  if (command.requiresConfirmation && !ctx.confirmed) return block("needs-confirmation");

  return {
    command,
    available: true,
    blocked: false,
    reason: null,
    explanation: `${command.label} is available.`,
    risk,
    nextStep: nextStepFor(null),
  };
}
