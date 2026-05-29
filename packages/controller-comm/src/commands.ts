import type {
  BlockedReason,
  CommandAvailability,
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

export const CONTROLLER_COMMANDS: Record<
  Extract<ControllerCommandKind, "go-online" | "monitor" | "upload" | "download" | "online-edit">,
  ControllerCommand
> = {
  "go-online": GO_ONLINE_COMMAND,
  monitor: MONITOR_COMMAND,
  upload: UPLOAD_COMMAND,
  download: DOWNLOAD_COMMAND,
  "online-edit": ONLINE_EDIT_COMMAND,
};

export interface CommandContext {
  state: ConnectionState;
  capabilities: TransportCapabilities;
  /** Whether the user has explicitly confirmed this destructive/real action. */
  confirmed?: boolean;
}

const EXPLAIN: Record<NonNullable<BlockedReason>, string> = {
  "model-only":
    "The active controller context is model-only: preserved for review, not simulated, and not connected to hardware.",
  "no-real-transport":
    "No tested controller transport is configured. Real go-online/upload/download/online-edit is unavailable in this build.",
  "not-connected": "Connect to a controller before running this command.",
  "safety-unverified":
    "The selected transport's controller link has not been validated against tested hardware. Blocked for safety.",
  "safety-blocked-state": "The session is in a Safety Blocked state. Resolve it before continuing.",
  "needs-confirmation": "This action must be explicitly confirmed before it can run.",
  faulted: "The session is faulted. Reconnect before running this command.",
};

/**
 * Decide whether a command may run right now. Pure. The ordering matters: the
 * "no real transport / unverified" gate is checked before connection or
 * confirmation so the UI always explains the real blocker honestly.
 */
export function evaluateCommand(command: ControllerCommand, ctx: CommandContext): CommandAvailability {
  const block = (reason: NonNullable<BlockedReason>): CommandAvailability => ({
    command,
    available: false,
    blocked: true,
    reason,
    explanation: EXPLAIN[reason],
  });

  if (ctx.state === "model-only") return block("model-only");

  if (command.requiresRealIo) {
    // Hard safety gate: a real action needs a transport that can actually reach a
    // controller AND has been verified against tested hardware. Neither shipped
    // transport qualifies, so these are always blocked in this build.
    if (!ctx.capabilities.realControllerIo) return block("no-real-transport");
    if (!ctx.capabilities.verified) return block("safety-unverified");
    if (command.isWrite && !ctx.capabilities.canWrite) return block("safety-unverified");
  }

  if (ctx.state === "safety-blocked") return block("safety-blocked-state");
  if (ctx.state === "faulted") return block("faulted");

  if (command.requiresRealIo && !isConnectedState(ctx.state)) return block("not-connected");

  if (command.requiresConfirmation && !ctx.confirmed) return block("needs-confirmation");

  return {
    command,
    available: true,
    blocked: false,
    reason: null,
    explanation: `${command.label} is available.`,
  };
}
