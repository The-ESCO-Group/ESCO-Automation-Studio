/**
 * ESCO Virtual Controller — offline driver / simulation session.
 *
 * This is an ESCO-owned, fully offline controller backend. It is NOT a link to
 * real hardware and never claims to be: every state is branded "ESCO Virtual
 * Controller", "Offline Driver", or "Simulation Session". What it provides is a
 * real, stateful IDE-style session — Set Path, Go Online, Download, Upload,
 * controller mode changes, fault handling, connection health, and an activity
 * log — backed by a deterministic in-memory virtual controller.
 *
 * It is intentionally separate from the hardware safety gate in `session.ts`
 * (which refuses to ever touch a real controller). This module models a *virtual*
 * controller, so it can legitimately reach an "online" state — against the
 * simulation backend, never against hardware.
 *
 * Pure and framework-free: deterministic, no timers, no real I/O. `now()` is
 * injectable so sessions are reproducible in tests.
 */

import { createId, nowIso } from "@esco/shared";

// ---------------------------------------------------------------------------
// State + data model
// ---------------------------------------------------------------------------

export type VirtualControllerState =
  | "disconnected"
  | "browsing"
  | "path-selected"
  | "connecting"
  | "online"
  | "monitoring"
  | "uploading"
  | "downloading"
  | "faulted"
  | "error";

export const VIRTUAL_STATE_LABELS: Record<VirtualControllerState, string> = {
  disconnected: "Disconnected",
  browsing: "Selecting Path…",
  "path-selected": "Path Selected",
  connecting: "Connecting…",
  online: "Online (Virtual)",
  monitoring: "Monitoring (Virtual)",
  uploading: "Uploading…",
  downloading: "Downloading…",
  faulted: "Faulted (Virtual)",
  error: "Session Error",
};

export type ControllerMode = "program" | "run" | "remote-program" | "remote-run";

export const CONTROLLER_MODE_LABELS: Record<ControllerMode, string> = {
  program: "Program",
  run: "Run",
  "remote-program": "Remote Program",
  "remote-run": "Remote Run",
};

/** True for modes where the controller is scanning logic (edits are guarded). */
export function isRunMode(mode: ControllerMode): boolean {
  return mode === "run" || mode === "remote-run";
}

export type ConnectionHealth = "unknown" | "healthy" | "degraded" | "lost";

export type CommPathKind = "ethernet-ip" | "local-emulation" | "usb-virtual";

export interface CommPath {
  id: string;
  /** Full Who-Active style label. */
  label: string;
  kind: CommPathKind;
  address?: string;
  slot?: number;
}

/** Identity reported by the virtual controller at the selected path. */
export interface VirtualControllerIdentity {
  name: string;
  catalogNumber: string;
  serialNumber: string;
  firmwareRevision: string;
  vendor: "ESCO Automation";
}

export type MatchStatus = "matched" | "mismatch" | "no-project";

export type FaultSeverity = "info" | "minor" | "major";
export type FaultSource = "validation" | "download" | "session" | "mismatch" | "mode";

export interface VirtualFault {
  id: string;
  code: string;
  severity: FaultSeverity;
  source: FaultSource;
  message: string;
  at: string;
  /** Whether Clear Faults can dismiss it (validation faults clear on a clean download). */
  clearable: boolean;
}

export type LogLevel = "info" | "success" | "warning" | "error";

export interface SessionLogEntry {
  id: string;
  at: string;
  level: LogLevel;
  /** The session action this entry belongs to (e.g. "download", "go-online"). */
  action: string;
  message: string;
}

/** A snapshot of the project stored in the virtual controller after a download. */
export interface ControllerSnapshot {
  projectId: string;
  projectName: string;
  /** Content signature/checksum of the downloaded project. */
  signature: string;
  /** Optional reference to a runtime/snapshot artifact (e.g. an .easruntime handle). */
  snapshotRef?: string;
  /**
   * The serialized project image stored on the virtual controller, so Upload can
   * reconstruct/inspect the project structure. Opaque to this package.
   */
  payload?: string;
  downloadedAt: string;
  /** Compiled counts captured at download time, for upload reconstruction/inspection. */
  summary: ControllerSnapshotSummary;
}

export interface ControllerSnapshotSummary {
  controllerName: string;
  taskCount: number;
  programCount: number;
  routineCount: number;
  tagCount: number;
}

/** The full, serializable session state surfaced to the UI. */
export interface VirtualSessionSnapshot {
  state: VirtualControllerState;
  stateLabel: string;
  path: CommPath | null;
  recentPaths: CommPath[];
  identity: VirtualControllerIdentity | null;
  mode: ControllerMode;
  modeLabel: string;
  health: ConnectionHealth;
  online: boolean;
  monitoring: boolean;
  /** True when the controller is scanning (Run/Remote Run) and edits must be guarded. */
  editsLocked: boolean;
  matchStatus: MatchStatus | null;
  lastOnlineAt?: string;
  lastUploadAt?: string;
  lastDownloadAt?: string;
  onlineSignature?: string;
  snapshot: ControllerSnapshot | null;
  faults: VirtualFault[];
  warnings: string[];
  log: SessionLogEntry[];
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/** Project identity for Go Online comparison. */
export interface ProjectIdentity {
  projectId: string;
  projectName: string;
  signature: string;
}

/** Project payload for Download (carries validation outcome + compiled summary). */
export interface ProjectDownloadInput extends ProjectIdentity {
  /** False when validation found hard (error-severity) problems — blocks download. */
  valid: boolean;
  /** Blocking validation error messages (when `valid` is false). */
  errors: string[];
  summary: ControllerSnapshotSummary;
  /** Optional reference to a runtime/snapshot artifact stored alongside. */
  snapshotRef?: string;
  /** Serialized project image stored on the virtual controller (opaque to this package). */
  payload?: string;
}

export interface VirtualActionResult {
  ok: boolean;
  level: LogLevel;
  message: string;
  snapshot: VirtualSessionSnapshot;
}

/** What `upload` returns so the host can reconstruct/inspect the project. */
export interface UploadResult extends VirtualActionResult {
  uploaded: ControllerSnapshot | null;
}

// ---------------------------------------------------------------------------
// Realistic ESCO virtual communication paths
// ---------------------------------------------------------------------------

export const ESCO_VIRTUAL_PATHS: readonly CommPath[] = [
  {
    id: "ethernet-ip-enbt-slot0",
    label: "EtherNet/IP \\ 192.168.1.10 \\ ESCO-ENBT \\ Backplane \\ Slot 0: ESCO Controller",
    kind: "ethernet-ip",
    address: "192.168.1.10",
    slot: 0,
  },
  {
    id: "local-emulation-slot0",
    label: "Local Emulation \\ Virtual Backplane \\ Slot 0: ESCO Emulated Controller",
    kind: "local-emulation",
    slot: 0,
  },
  {
    id: "usb-virtual",
    label: "USB \\ ESCO Virtual Controller",
    kind: "usb-virtual",
  },
] as const;

function identityForPath(path: CommPath): VirtualControllerIdentity {
  const base = {
    catalogNumber: "ESCO-VC1",
    firmwareRevision: "1.0",
    vendor: "ESCO Automation" as const,
  };
  switch (path.kind) {
    case "ethernet-ip":
      return { ...base, name: "ESCO_Controller", catalogNumber: "ESCO-ENBT-VC1", serialNumber: "VC-EIP-0001" };
    case "local-emulation":
      return { ...base, name: "ESCO_Emulated", serialNumber: "VC-EMU-0001" };
    case "usb-virtual":
    default:
      return { ...base, name: "ESCO_USB_VC", serialNumber: "VC-USB-0001" };
  }
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

export interface VirtualControllerOptions {
  now?: () => string;
  recentPaths?: CommPath[];
  /** Bound on retained log entries (FIFO). Defaults to 200. */
  logLimit?: number;
}

const DEFAULT_LOG_LIMIT = 200;

/**
 * The ESCO Virtual Controller session. A deterministic in-memory state machine
 * that behaves like a real IDE online session against an offline/virtual backend.
 */
export class VirtualControllerSession {
  private state: VirtualControllerState = "disconnected";
  private path: CommPath | null = null;
  private recentPaths: CommPath[];
  private identity: VirtualControllerIdentity | null = null;
  private mode: ControllerMode = "program";
  private health: ConnectionHealth = "unknown";
  private matchStatus: MatchStatus | null = null;
  private lastOnlineAt?: string;
  private lastUploadAt?: string;
  private lastDownloadAt?: string;
  private onlineSignature?: string;
  private snapshot: ControllerSnapshot | null = null;
  private faults: VirtualFault[] = [];
  private warnings: string[] = [];
  private log: SessionLogEntry[] = [];
  private readonly now: () => string;
  private readonly logLimit: number;

  constructor(options: VirtualControllerOptions = {}) {
    this.now = options.now ?? nowIso;
    this.recentPaths = options.recentPaths ? [...options.recentPaths] : [];
    this.logLimit = options.logLimit ?? DEFAULT_LOG_LIMIT;
  }

  // --- snapshot ------------------------------------------------------------

  getSnapshot(): VirtualSessionSnapshot {
    const online = this.state === "online" || this.state === "monitoring";
    return {
      state: this.state,
      stateLabel: VIRTUAL_STATE_LABELS[this.state],
      path: this.path,
      recentPaths: [...this.recentPaths],
      identity: this.identity,
      mode: this.mode,
      modeLabel: CONTROLLER_MODE_LABELS[this.mode],
      health: this.health,
      online,
      monitoring: this.state === "monitoring",
      editsLocked: online && isRunMode(this.mode),
      matchStatus: this.matchStatus,
      ...(this.lastOnlineAt ? { lastOnlineAt: this.lastOnlineAt } : {}),
      ...(this.lastUploadAt ? { lastUploadAt: this.lastUploadAt } : {}),
      ...(this.lastDownloadAt ? { lastDownloadAt: this.lastDownloadAt } : {}),
      ...(this.onlineSignature ? { onlineSignature: this.onlineSignature } : {}),
      snapshot: this.snapshot,
      faults: [...this.faults],
      warnings: [...this.warnings],
      log: [...this.log],
    };
  }

  availablePaths(): CommPath[] {
    const recents = this.recentPaths.map((path) => path.id);
    const catalog = ESCO_VIRTUAL_PATHS.filter((path) => !recents.includes(path.id));
    return [...this.recentPaths, ...catalog];
  }

  // --- helpers -------------------------------------------------------------

  private record(action: string, level: LogLevel, message: string): void {
    this.log.push({ id: createId("vclog"), at: this.now(), level, action, message });
    if (this.log.length > this.logLimit) this.log = this.log.slice(this.log.length - this.logLimit);
  }

  private result(ok: boolean, level: LogLevel, message: string): VirtualActionResult {
    return { ok, level, message, snapshot: this.getSnapshot() };
  }

  private addFault(fault: Omit<VirtualFault, "id" | "at">): void {
    this.faults.push({ ...fault, id: createId("vcflt"), at: this.now() });
  }

  private clearFaultsBySource(source: FaultSource): void {
    this.faults = this.faults.filter((fault) => fault.source !== source);
  }

  // --- Set Path ------------------------------------------------------------

  /** Enter the path browser (Who Active). */
  beginBrowsing(): VirtualActionResult {
    if (this.state === "online" || this.state === "monitoring") {
      return this.result(false, "warning", "Go Offline before changing the communication path.");
    }
    this.state = "browsing";
    this.record("set-path", "info", "Opened Who Active — select an ESCO virtual communication path.");
    return this.result(true, "info", "Select an ESCO Virtual Controller path.");
  }

  selectPath(pathId: string): VirtualActionResult {
    const path =
      this.recentPaths.find((candidate) => candidate.id === pathId) ??
      ESCO_VIRTUAL_PATHS.find((candidate) => candidate.id === pathId);
    if (!path) {
      this.state = this.path ? "path-selected" : "disconnected";
      return this.result(false, "error", `Unknown communication path "${pathId}".`);
    }
    this.path = path;
    this.identity = identityForPath(path);
    this.state = "path-selected";
    this.health = "unknown";
    this.recentPaths = [path, ...this.recentPaths.filter((candidate) => candidate.id !== path.id)].slice(0, 6);
    this.record("set-path", "success", `Selected path: ${path.label}`);
    return this.result(true, "success", `Path selected — ${this.identity.name} at ${path.label}.`);
  }

  // --- Go Online -----------------------------------------------------------

  /**
   * Go Online against the virtual controller. Requires a selected path. Compares
   * the offline project signature to the downloaded controller snapshot and
   * reports matched / mismatch / no-project.
   */
  goOnline(project: ProjectIdentity | null): VirtualActionResult {
    if (!this.path) {
      this.state = "disconnected";
      this.record("go-online", "warning", "Go Online requires a communication path. Opening Who Active.");
      return this.result(false, "warning", "No communication path selected. Use Set Path / Who Active first.");
    }

    this.state = "connecting";
    this.record("go-online", "info", `Connecting to ${this.identity?.name ?? "ESCO Virtual Controller"}…`);

    this.state = "online";
    this.health = "healthy";
    this.lastOnlineAt = this.now();
    this.clearFaultsBySource("mismatch");

    if (!this.snapshot) {
      this.matchStatus = "no-project";
      this.addFault({
        code: "VC-NOPROJ",
        severity: "minor",
        source: "session",
        message: "No project has been downloaded to the ESCO Virtual Controller. Download to commission it.",
        clearable: true,
      });
      this.record("go-online", "warning", "Online — virtual controller is empty (no project downloaded).");
      return this.result(true, "warning", "Online (Virtual) — no project downloaded. Download to commission the controller.");
    }

    if (project && project.signature === this.snapshot.signature) {
      this.matchStatus = "matched";
      this.record("go-online", "success", `Online — offline project matches the controller (signature ${shortSig(project.signature)}).`);
      return this.result(true, "success", `Online (Virtual) — project matches the controller.`);
    }

    this.matchStatus = "mismatch";
    this.addFault({
      code: "VC-MISMATCH",
      severity: "minor",
      source: "mismatch",
      message: project
        ? `Offline project (${shortSig(project.signature)}) differs from the controller (${shortSig(this.snapshot.signature)}). Upload or Download to reconcile.`
        : "No offline project is open to compare against the controller.",
      clearable: true,
    });
    this.record("go-online", "warning", "Online — offline project differs from the controller image.");
    return this.result(true, "warning", "Online (Virtual) — offline project differs from the controller. Upload or Download to reconcile.");
  }

  goOffline(): VirtualActionResult {
    this.state = "disconnected";
    this.health = "unknown";
    this.matchStatus = null;
    this.mode = "program";
    this.record("go-offline", "info", "Went offline from the ESCO Virtual Controller.");
    return this.result(true, "info", "Offline — disconnected from the ESCO Virtual Controller.");
  }

  monitor(): VirtualActionResult {
    if (this.state !== "online" && this.state !== "monitoring") {
      return this.result(false, "warning", "Go Online before entering Monitor mode.");
    }
    this.state = "monitoring";
    this.health = "healthy";
    this.record("monitor", "info", "Entered Monitor mode (live virtual values).");
    return this.result(true, "success", "Monitoring (Virtual) — watching live values.");
  }

  // --- Download ------------------------------------------------------------

  /**
   * Download the offline project into the virtual controller. Requires a path,
   * blocks on hard validation errors, stores a snapshot/signature, and goes
   * online with a matched image.
   */
  download(project: ProjectDownloadInput | null): VirtualActionResult {
    if (!this.path) {
      this.record("download", "warning", "Download requires a communication path.");
      return this.result(false, "warning", "No communication path selected. Use Set Path / Who Active first.");
    }
    if (!project) {
      this.record("download", "error", "Download requires an open project.");
      return this.result(false, "error", "No project is open to download.");
    }
    if (!project.valid) {
      this.state = "faulted";
      this.clearFaultsBySource("validation");
      for (const message of project.errors.slice(0, 10)) {
        this.addFault({ code: "VC-VALIDATION", severity: "major", source: "validation", message, clearable: true });
      }
      if (project.errors.length === 0) {
        this.addFault({ code: "VC-VALIDATION", severity: "major", source: "validation", message: "Project validation reported blocking errors.", clearable: true });
      }
      this.record("download", "error", `Download blocked — project validation has ${project.errors.length || "blocking"} error(s).`);
      return this.result(false, "error", "Download blocked: resolve project validation errors first.");
    }

    this.state = "downloading";
    this.record("download", "info", `Downloading "${project.projectName}" to ${this.identity?.name ?? "ESCO Virtual Controller"}…`);

    const downloadedAt = this.now();
    this.snapshot = {
      projectId: project.projectId,
      projectName: project.projectName,
      signature: project.signature,
      ...(project.snapshotRef ? { snapshotRef: project.snapshotRef } : {}),
      ...(project.payload ? { payload: project.payload } : {}),
      downloadedAt,
      summary: project.summary,
    };
    this.onlineSignature = project.signature;
    this.lastDownloadAt = downloadedAt;
    this.matchStatus = "matched";
    this.clearFaultsBySource("validation");
    this.clearFaultsBySource("mismatch");
    this.clearFaultsBySource("session");

    // After a successful download the controller is online in Program mode.
    this.state = "online";
    this.health = "healthy";
    this.lastOnlineAt = downloadedAt;
    this.mode = "program";
    this.record(
      "download",
      "success",
      `Downloaded "${project.projectName}" (signature ${shortSig(project.signature)}). Controller online in Program mode.`,
    );
    return this.result(true, "success", `Downloaded "${project.projectName}" to the ESCO Virtual Controller. Now online (Program).`);
  }

  // --- Upload --------------------------------------------------------------

  /**
   * Upload the project image from the virtual controller. Requires a path and an
   * existing snapshot; returns the stored snapshot so the host can reconstruct /
   * inspect the project.
   */
  upload(): UploadResult {
    const base = (ok: boolean, level: LogLevel, message: string): UploadResult => ({
      ...this.result(ok, level, message),
      uploaded: ok ? this.snapshot : null,
    });
    if (!this.path) {
      this.record("upload", "warning", "Upload requires a communication path.");
      return base(false, "warning", "No communication path selected. Use Set Path / Who Active first.");
    }
    if (!this.snapshot) {
      this.record("upload", "warning", "Upload found no project image on the virtual controller.");
      return base(false, "warning", "Nothing to upload — the ESCO Virtual Controller has no downloaded project. Download first.");
    }

    this.state = "uploading";
    this.record("upload", "info", `Uploading "${this.snapshot.projectName}" from the virtual controller…`);

    this.lastUploadAt = this.now();
    this.state = "online";
    this.health = "healthy";
    this.lastOnlineAt = this.lastUploadAt;
    this.matchStatus = "matched";
    this.record(
      "upload",
      "success",
      `Uploaded "${this.snapshot.projectName}" (signature ${shortSig(this.snapshot.signature)}) from the virtual controller.`,
    );
    return base(true, "success", `Uploaded "${this.snapshot.projectName}" from the ESCO Virtual Controller.`);
  }

  // --- Mode changes --------------------------------------------------------

  setMode(mode: ControllerMode): VirtualActionResult {
    if (this.state !== "online" && this.state !== "monitoring") {
      this.record("mode", "warning", `Mode change to ${CONTROLLER_MODE_LABELS[mode]} requires an online session.`);
      return this.result(false, "warning", `Go Online before changing to ${CONTROLLER_MODE_LABELS[mode]} mode.`);
    }
    if (isRunMode(mode) && !this.snapshot) {
      this.addFault({
        code: "VC-NORUN",
        severity: "minor",
        source: "mode",
        message: `${CONTROLLER_MODE_LABELS[mode]} mode requires a downloaded project. Download first.`,
        clearable: true,
      });
      this.record("mode", "warning", `${CONTROLLER_MODE_LABELS[mode]} blocked — no downloaded project.`);
      return this.result(false, "warning", `${CONTROLLER_MODE_LABELS[mode]} mode requires a downloaded project. Download first.`);
    }
    if (isRunMode(mode) && this.matchStatus === "mismatch") {
      this.record("mode", "warning", `${CONTROLLER_MODE_LABELS[mode]} blocked — offline project differs from the controller.`);
      return this.result(false, "warning", `${CONTROLLER_MODE_LABELS[mode]} blocked: offline project differs from the controller. Download to reconcile.`);
    }
    this.mode = mode;
    this.record("mode", "success", `Controller mode set to ${CONTROLLER_MODE_LABELS[mode]}.`);
    const note = isRunMode(mode)
      ? `${CONTROLLER_MODE_LABELS[mode]} — destructive edits are guarded (read-only) while scanning.`
      : `${CONTROLLER_MODE_LABELS[mode]} — edits allowed.`;
    return this.result(true, "success", note);
  }

  // --- Faults --------------------------------------------------------------

  clearFaults(): VirtualActionResult {
    const before = this.faults.length;
    const cleared = this.faults.filter((fault) => fault.clearable).length;
    this.faults = this.faults.filter((fault) => !fault.clearable);
    if (this.state === "faulted") {
      this.state = this.snapshot ? "online" : this.path ? "path-selected" : "disconnected";
      if (this.state === "online") {
        this.health = "healthy";
        this.lastOnlineAt = this.now();
      }
    }
    if (before === 0) {
      this.record("clear-faults", "info", "No faults to clear.");
      return this.result(true, "info", "No active faults on the ESCO Virtual Controller.");
    }
    this.record("clear-faults", "success", `Cleared ${cleared} fault(s) on the virtual controller.`);
    return this.result(true, "success", `Cleared ${cleared} fault(s).${cleared < before ? ` ${before - cleared} non-clearable fault(s) remain.` : ""}`);
  }
}

function shortSig(signature: string): string {
  return signature ? signature.slice(0, 12) : "unknown";
}
