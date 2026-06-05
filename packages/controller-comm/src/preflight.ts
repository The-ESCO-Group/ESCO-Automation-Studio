import type { CommandContext } from "./commands";
import { isConnectedState, type BlockedReason, type ControllerCommand } from "./types";

/**
 * Commissioning preflight — the honest, *enumerated* form of the command gate.
 *
 * {@link evaluateCommand} short-circuits on the first failing safety condition and
 * returns one reason. That is the right behaviour for "may this run?", but a
 * commissioning / go-online workflow wants to show the operator EVERY gate and
 * which ones are still red — without ever implying a step is satisfied when it is
 * not. {@link commissioningPreflight} walks the same gates, in the same order, and
 * reports each one's pass/fail. By construction `firstBlocker` equals the reason
 * {@link evaluateCommand} would return (a test pins this invariant), so this can
 * never disagree with the gate or fabricate readiness.
 */

export interface PreflightCheck {
  id: string;
  label: string;
  passed: boolean;
  /** The blocked-reason this gate enforces when it fails. */
  blocker: NonNullable<BlockedReason>;
  detail: string;
}

export interface PreflightReport {
  command: ControllerCommand;
  checks: PreflightCheck[];
  /** True only when every applicable gate passed (the command may run). */
  cleared: boolean;
  /** The first failing gate's reason, or null when cleared. */
  firstBlocker: BlockedReason;
}

/**
 * Produce the ordered list of safety gates for a command and whether each passes
 * under `ctx`. Pure. The gate order mirrors {@link evaluateCommand} exactly so the
 * first failing check is the same reason that function would block on.
 */
export function commissioningPreflight(command: ControllerCommand, ctx: CommandContext): PreflightReport {
  const checks: PreflightCheck[] = [];
  const add = (
    id: string,
    label: string,
    passed: boolean,
    blocker: NonNullable<BlockedReason>,
    detail: string,
  ): void => {
    checks.push({ id, label, passed, blocker, detail });
  };

  if (!command.requiresRealIo) {
    add(
      "local-session-action",
      "Local session action only",
      true,
      "no-real-transport",
      "This action does not require controller transport or hardware communication.",
    );
  }

  if (command.requiresRealIo) {
    // 1. The active context must not be model-only (review-only, never connected).
    add(
      "not-model-only",
      "Active context is not model-only",
      ctx.state !== "model-only",
      "model-only",
      "Model-only content is preserved for review; it is not simulated or connected.",
    );
    // 2. A transport that can actually reach a controller must be present.
    add(
      "real-transport",
      "A real controller transport is present",
      ctx.capabilities.realControllerIo,
      "no-real-transport",
      "No tested controller transport is configured in this build.",
    );
    // 3. That transport must be validated against tested hardware.
    add(
      "verified",
      "Transport is verified against tested hardware",
      ctx.capabilities.verified,
      "safety-unverified",
      "The controller link has not been validated against tested hardware.",
    );
    // 4. The transport must expose the command-specific read/write capability.
    if (command.isWrite) {
      add(
        "write-capable",
        "Transport can write to the controller",
        ctx.capabilities.canWrite,
        "capability-missing",
        "This transport is read-only; it cannot perform controller write or mode-change commands.",
      );
    } else {
      const readCapability =
        command.kind === "network-browser"
          ? ctx.capabilities.canBrowseNetwork === true
          : command.kind === "select-recent-path"
            ? ctx.capabilities.canSelectPath === true
            : command.kind === "path-diagnostics"
              ? ctx.capabilities.canPathDiagnostics === true
              : command.kind === "upload"
                ? ctx.capabilities.canUpload === true
                : command.kind === "monitor"
                  ? (ctx.capabilities.canMonitor ?? ctx.capabilities.canRead)
                  : command.kind === "fault-diagnostics" || command.kind === "go-to-faults"
                    ? (ctx.capabilities.canReadFaults ?? ctx.capabilities.canMonitor ?? ctx.capabilities.canRead)
                    : ctx.capabilities.canRead;
      add(
        "read-capable",
        "Transport supports this read command",
        readCapability,
        "capability-missing",
        "The selected transport must explicitly support this read command; monitor-only links do not imply browse, path diagnostics, or upload.",
      );
    }

    // 5/6. The session must not be in a safety-blocked or faulted state.
    add(
      "not-safety-blocked",
      "Session is not in a Safety Blocked state",
      ctx.state !== "safety-blocked",
      "safety-blocked-state",
      "Resolve the Safety Blocked state before continuing.",
    );
    add(
      "not-faulted",
      "Session is not faulted",
      ctx.state !== "faulted",
      "faulted",
      "Reconnect before running this command.",
    );

    // 7. Real commands require a live controller connection.
    add(
      "connected",
      "Connected to a controller",
      isConnectedState(ctx.state),
      "not-connected",
      "Connect to a controller before running this command.",
    );
  }

  // 8. Confirmation-required commands need explicit operator confirmation.
  if (command.requiresConfirmation) {
    add(
      "confirmed",
      "Operator has explicitly confirmed this action",
      ctx.confirmed === true,
      "needs-confirmation",
      "This action must be explicitly confirmed before it can run.",
    );
  }

  const firstFailed = checks.find((check) => !check.passed);
  return {
    command,
    checks,
    cleared: firstFailed === undefined,
    firstBlocker: firstFailed ? firstFailed.blocker : null,
  };
}

/** One-line summary suitable for a status line / toast. */
export function preflightSummary(report: PreflightReport): string {
  const passed = report.checks.filter((c) => c.passed).length;
  const total = report.checks.length;
  if (report.cleared) return `${report.command.label}: all ${total} safety checks passed.`;
  const blocker = report.checks.find((c) => !c.passed);
  return `${report.command.label}: ${passed}/${total} checks passed — blocked: ${blocker?.detail ?? "unknown"}`;
}
