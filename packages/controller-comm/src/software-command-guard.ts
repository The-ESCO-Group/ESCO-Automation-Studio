import type { CommandRisk } from "./types";
import {
  CONTROLLER_MODE_LABELS,
  isRunMode,
  type ControllerMode,
  type VirtualSessionSnapshot,
} from "./virtual-controller";

export type SoftwareCommandKind =
  | "virtual-go-online"
  | "virtual-monitor"
  | "virtual-download"
  | "virtual-upload"
  | "virtual-mode-program"
  | "virtual-mode-run"
  | "virtual-mode-remote-program"
  | "virtual-mode-remote-run"
  | "virtual-clear-faults"
  | "soft-download-runtime"
  | "soft-upload-runtime"
  | "soft-restore-runtime";

export type SoftwareGuardCheckId =
  | "no-physical-hardware"
  | "virtual-path-selected"
  | "project-open"
  | "project-valid"
  | "online"
  | "downloaded-image-present"
  | "image-matched"
  | "virtual-faults-present"
  | "soft-runtime-loaded"
  | "rollback-backup-available";

export type SoftwareGuardCheckLevel = "required" | "advisory";

export interface SoftwareCommandGuardContext {
  snapshot: Pick<
    VirtualSessionSnapshot,
    "path" | "online" | "snapshot" | "matchStatus" | "faults"
  >;
  projectOpen: boolean;
  projectValid: boolean;
  projectErrors?: string[];
  softControllerRuntimeLoaded?: boolean;
  softControllerBackupAvailable?: boolean;
}

export interface SoftwareCommandDefinition {
  kind: SoftwareCommandKind;
  label: string;
  description: string;
  risk: CommandRisk;
}

export interface SoftwareGuardCheck {
  id: SoftwareGuardCheckId;
  label: string;
  level: SoftwareGuardCheckLevel;
  passed: boolean;
  detail: string;
}

export interface SoftwareCommandGuardRow {
  commandKind: SoftwareCommandKind;
  label: string;
  description: string;
  risk: CommandRisk;
  available: boolean;
  firstBlocker: SoftwareGuardCheckId | null;
  checks: SoftwareGuardCheck[];
  summary: string;
}

export interface SoftwareCommandGuardReport {
  softwareOnly: true;
  totalSoftwareCommands: number;
  availableSoftwareCommands: number;
  blockedSoftwareCommands: number;
  advisoryWarningCount: number;
  rows: SoftwareCommandGuardRow[];
  message: string;
}

const MODE_COMMANDS: Array<[SoftwareCommandKind, ControllerMode]> = [
  ["virtual-mode-program", "program"],
  ["virtual-mode-run", "run"],
  ["virtual-mode-remote-program", "remote-program"],
  ["virtual-mode-remote-run", "remote-run"],
];

export const SOFTWARE_COMMAND_LIST: readonly SoftwareCommandDefinition[] = [
  {
    kind: "virtual-go-online",
    label: "Go Online (Virtual)",
    description: "Open a software-only online session against the ESCO Virtual Controller.",
    risk: "read",
  },
  {
    kind: "virtual-monitor",
    label: "Monitor (Virtual)",
    description: "Read live values from the ESCO Virtual Controller software session.",
    risk: "read",
  },
  {
    kind: "virtual-download",
    label: "Download to Virtual",
    description: "Load the open project into the ESCO Virtual Controller snapshot.",
    risk: "destructive",
  },
  {
    kind: "virtual-upload",
    label: "Upload from Virtual",
    description: "Read the downloaded ESCO Virtual Controller snapshot back into the app.",
    risk: "read",
  },
  ...MODE_COMMANDS.map(
    ([kind, mode]): SoftwareCommandDefinition => ({
      kind,
      label: `${CONTROLLER_MODE_LABELS[mode]} (Virtual)`,
      description: `Change the ESCO Virtual Controller mode to ${CONTROLLER_MODE_LABELS[mode]}.`,
      risk: isRunMode(mode) ? "destructive" : "write",
    }),
  ),
  {
    kind: "virtual-clear-faults",
    label: "Clear Virtual Faults",
    description: "Clear active clearable faults from the ESCO Virtual Controller.",
    risk: "write",
  },
  {
    kind: "soft-download-runtime",
    label: "Download Runtime to ESCO SoftController",
    description: "Build and load the open project's runtime into the local ESCO SoftController.",
    risk: "destructive",
  },
  {
    kind: "soft-upload-runtime",
    label: "Upload from ESCO SoftController",
    description: "Read the local ESCO SoftController runtime image for preview and reconstruction.",
    risk: "read",
  },
  {
    kind: "soft-restore-runtime",
    label: "Restore Previous Runtime",
    description: "Restore the previous local ESCO SoftController runtime backup.",
    risk: "destructive",
  },
] as const;

function check(
  id: SoftwareGuardCheckId,
  label: string,
  level: SoftwareGuardCheckLevel,
  passed: boolean,
  detail: string,
): SoftwareGuardCheck {
  return { id, label, level, passed, detail };
}

function noHardwareCheck(): SoftwareGuardCheck {
  return check(
    "no-physical-hardware",
    "No physical hardware transport",
    "required",
    true,
    "This command is routed only to ESCO virtual/software runtime state.",
  );
}

function pathCheck(ctx: SoftwareCommandGuardContext): SoftwareGuardCheck {
  return check(
    "virtual-path-selected",
    "Virtual path selected",
    "required",
    ctx.snapshot.path !== null,
    ctx.snapshot.path ? `Selected: ${ctx.snapshot.path.label}` : "Select an ESCO virtual communication path first.",
  );
}

function projectOpenCheck(ctx: SoftwareCommandGuardContext, level: SoftwareGuardCheckLevel): SoftwareGuardCheck {
  return check(
    "project-open",
    "Project open",
    level,
    ctx.projectOpen,
    ctx.projectOpen ? "An offline project is available." : "Open or create a project before running this command.",
  );
}

function projectValidCheck(ctx: SoftwareCommandGuardContext): SoftwareGuardCheck {
  const errorCount = ctx.projectErrors?.length ?? 0;
  return check(
    "project-valid",
    "Project validation clean",
    "required",
    ctx.projectOpen && ctx.projectValid,
    ctx.projectOpen
      ? ctx.projectValid
        ? "No blocking validation errors are present."
        : `Resolve ${errorCount || "blocking"} validation error(s) first.`
      : "Open or create a project before validating a runtime download.",
  );
}

function onlineCheck(ctx: SoftwareCommandGuardContext): SoftwareGuardCheck {
  return check(
    "online",
    "Virtual session online",
    "required",
    ctx.snapshot.online,
    ctx.snapshot.online ? "The ESCO Virtual Controller is online." : "Go Online (Virtual) first.",
  );
}

function downloadedImageCheck(ctx: SoftwareCommandGuardContext): SoftwareGuardCheck {
  return check(
    "downloaded-image-present",
    "Downloaded image present",
    "required",
    ctx.snapshot.snapshot !== null,
    ctx.snapshot.snapshot
      ? `Image: ${ctx.snapshot.snapshot.projectName}.`
      : "Download a project to the ESCO Virtual Controller first.",
  );
}

function imageMatchedCheck(ctx: SoftwareCommandGuardContext): SoftwareGuardCheck {
  return check(
    "image-matched",
    "Offline project matches virtual image",
    "required",
    ctx.snapshot.matchStatus !== "mismatch",
    ctx.snapshot.matchStatus === "mismatch"
      ? "Upload or Download to reconcile the offline project with the virtual image."
      : "The current virtual image is not marked mismatched.",
  );
}

function virtualFaultsPresentCheck(ctx: SoftwareCommandGuardContext): SoftwareGuardCheck {
  const count = ctx.snapshot.faults.length;
  return check(
    "virtual-faults-present",
    "Virtual faults present",
    "required",
    count > 0,
    count > 0 ? `${count} active fault(s) can be cleared.` : "No active virtual faults are present.",
  );
}

function softRuntimeLoadedCheck(ctx: SoftwareCommandGuardContext): SoftwareGuardCheck {
  return check(
    "soft-runtime-loaded",
    "SoftController runtime loaded",
    "required",
    ctx.softControllerRuntimeLoaded === true,
    ctx.softControllerRuntimeLoaded
      ? "A local ESCO SoftController runtime image is loaded."
      : "Download a runtime to the ESCO SoftController first.",
  );
}

function rollbackBackupCheck(ctx: SoftwareCommandGuardContext): SoftwareGuardCheck {
  return check(
    "rollback-backup-available",
    "Rollback backup available",
    "required",
    ctx.softControllerBackupAvailable === true,
    ctx.softControllerBackupAvailable
      ? "A previous local runtime image can be restored."
      : "No previous local runtime backup is available.",
  );
}

function checksFor(command: SoftwareCommandDefinition, ctx: SoftwareCommandGuardContext): SoftwareGuardCheck[] {
  const checks: SoftwareGuardCheck[] = [noHardwareCheck()];

  switch (command.kind) {
    case "virtual-go-online":
      checks.push(pathCheck(ctx), projectOpenCheck(ctx, "advisory"));
      break;
    case "virtual-monitor":
      checks.push(onlineCheck(ctx));
      break;
    case "virtual-download":
      checks.push(pathCheck(ctx), projectOpenCheck(ctx, "required"), projectValidCheck(ctx));
      break;
    case "virtual-upload":
      checks.push(pathCheck(ctx), downloadedImageCheck(ctx));
      break;
    case "virtual-mode-program":
    case "virtual-mode-remote-program":
      checks.push(onlineCheck(ctx));
      break;
    case "virtual-mode-run":
    case "virtual-mode-remote-run":
      checks.push(onlineCheck(ctx), downloadedImageCheck(ctx), imageMatchedCheck(ctx));
      break;
    case "virtual-clear-faults":
      checks.push(virtualFaultsPresentCheck(ctx));
      break;
    case "soft-download-runtime":
      checks.push(projectOpenCheck(ctx, "required"), projectValidCheck(ctx));
      break;
    case "soft-upload-runtime":
      checks.push(softRuntimeLoadedCheck(ctx));
      break;
    case "soft-restore-runtime":
      checks.push(rollbackBackupCheck(ctx));
      break;
  }

  return checks;
}

function summarize(command: SoftwareCommandDefinition, checks: SoftwareGuardCheck[]): string {
  const required = checks.filter((item) => item.level === "required");
  const passed = required.filter((item) => item.passed).length;
  const firstBlocker = required.find((item) => !item.passed);
  if (!firstBlocker) return `${command.label}: ${passed}/${required.length} required software checks passed.`;
  return `${command.label}: ${passed}/${required.length} required software checks passed - blocked: ${firstBlocker.detail}`;
}

export function softwareCommandGuardReport(ctx: SoftwareCommandGuardContext): SoftwareCommandGuardReport {
  const rows = SOFTWARE_COMMAND_LIST.map((command): SoftwareCommandGuardRow => {
    const checks = checksFor(command, ctx);
    const firstBlocker = checks.find((item) => item.level === "required" && !item.passed)?.id ?? null;
    return {
      commandKind: command.kind,
      label: command.label,
      description: command.description,
      risk: command.risk,
      available: firstBlocker === null,
      firstBlocker,
      checks,
      summary: summarize(command, checks),
    };
  });
  const availableSoftwareCommands = rows.filter((row) => row.available).length;
  const advisoryWarningCount = rows.reduce(
    (sum, row) => sum + row.checks.filter((item) => item.level === "advisory" && !item.passed).length,
    0,
  );

  return {
    softwareOnly: true,
    totalSoftwareCommands: rows.length,
    availableSoftwareCommands,
    blockedSoftwareCommands: rows.length - availableSoftwareCommands,
    advisoryWarningCount,
    rows,
    message: `${availableSoftwareCommands}/${rows.length} ESCO virtual/software commands are ready; physical hardware is excluded from every row.`,
  };
}
