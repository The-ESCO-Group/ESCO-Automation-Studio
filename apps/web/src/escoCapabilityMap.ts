import type { ControllerCommandKind } from "@esco/controller-comm";

export const ESCO_CAPABILITY_STATUSES = [
  "implemented",
  "partial",
  "simulation-only",
  "model-only",
  "review-only",
  "planned",
  "unsupported",
] as const;

export type EscoCapabilityStatus = (typeof ESCO_CAPABILITY_STATUSES)[number];

export interface EscoCapabilityArea {
  id: string;
  area: string;
  status: EscoCapabilityStatus;
  label: string;
  summary: string;
  visibleIn: string;
  next: string;
  commandKinds?: readonly ControllerCommandKind[];
}

export const ESCO_CAPABILITY_STATUS_LABELS: Record<EscoCapabilityStatus, string> = {
  implemented: "Implemented",
  partial: "Partial",
  "simulation-only": "Simulation-only",
  "model-only": "Model-only",
  "review-only": "Review-only",
  planned: "Planned",
  unsupported: "Unsupported",
};

export const ESCO_CAPABILITY_STATUS_SUMMARY: Record<EscoCapabilityStatus, string> = {
  implemented: "Shipped and usable in the offline IDE.",
  partial: "Usable for a meaningful subset, with known gaps.",
  "simulation-only": "Runs only against ESCO's offline simulation/virtual backend.",
  "model-only": "Stored and editable as project metadata, not executable controller behavior.",
  "review-only": "Imported or derived for inspection and round-trip review only.",
  planned: "Future work; no usable implementation ships in this build.",
  unsupported: "Not available in this build and never faked.",
};

const NO_VERIFIED_TRANSPORT =
  "No tested real-controller transport ships in this build, so this command is visible for workflow parity only.";

export const ESCO_CAPABILITY_AREAS: readonly EscoCapabilityArea[] = [
  {
    id: "ladder-editor",
    area: "Ladder, tags, and branches",
    status: "implemented",
    label: "Offline IDE",
    summary: "Rungs, nested branches, tag edits, undo/redo, verify, watch, trace, forces, and compare are live in the IDE.",
    visibleIn: "Routine editor, Tags, Watch, Trace, Forces, Compare",
    next: "Harden the remaining complex branch shapes that imported controller projects can include but this AST still flattens.",
  },
  {
    id: "structured-text",
    area: "Structured Text",
    status: "partial",
    label: "Executable subset",
    summary: "ST source opens, verifies, round-trips through L5X, and simulates assignments, expressions, flow, loops, CASE, and JSR/SBR/RET.",
    visibleIn: "Routine editor and Diagnostics",
    next: "Finish remaining function-call forms, scan-phase behavior, fault/status details, and firmware-specific conversions.",
  },
  {
    id: "instruction-simulation",
    area: "Instruction simulation",
    status: "simulation-only",
    label: "Offline scan model",
    summary: "Bit, timer/counter, math, compare, file/array, sequencer, shift, string/ASCII, conversion, and routine-control families execute offline.",
    visibleIn: "Routine editor, Watch, Trace, Task Monitor",
    next: "Move selected process, message, motion, alarm, and safety families from review-only toward executable behavior.",
  },
  {
    id: "xml-review-import",
    area: "XML review import",
    status: "partial",
    label: "Open XML import",
    summary: "XML review import preserves broad controller, tag, task, AOI, UDT, module, trend, quick watch, network, and serial metadata.",
    visibleIn: "Import summary, Project Explorer, Structure views, Properties",
    next: "Tighten fidelity for deeper AOI routine metadata, module/port rows, safety/signature data, and edge branch shapes.",
  },
  {
    id: "xml-review-export",
    area: "XML review export",
    status: "review-only",
    label: "Best-effort XML",
    summary: "XML review export writes review artifacts from the offline model and does not claim controller-ready equivalence.",
    visibleIn: "File menu, export actions, compatibility notes",
    next: "Broaden round-trip coverage and keep export warnings explicit where fidelity is incomplete.",
  },
  {
    id: "binary-project-import",
    area: "Proprietary binary project files",
    status: "unsupported",
    label: "Not supported",
    summary: "Proprietary binary controller-project files, including `.ACD`, are not read, written, compiled, decompiled, uploaded, downloaded, converted, or faked.",
    visibleIn: "Import guard, About, Help",
    next: "Use an approved open review/export format, then import that review file into ESCO Automation Studio.",
  },
  {
    id: "offline-simulation",
    area: "Offline simulation",
    status: "simulation-only",
    label: "Local scan",
    summary: "The scan engine, watch values, forces, trace, trends, and task monitor run locally against an approximate offline model.",
    visibleIn: "Watch, Forces, Trace, Trend, Task Monitor, status bar",
    next: "Document timing differences and move unsupported instruction families into explicit model-only review.",
  },
  {
    id: "virtual-controller-session",
    area: "ESCO Virtual Controller",
    status: "simulation-only",
    label: "Virtual backend",
    summary: "Set Path, Go Online, Upload, Download, mode changes, and faults run only against an ESCO in-memory virtual controller.",
    visibleIn: "Controller dock",
    next: "Keep labels virtual/offline and separate this workflow from any future verified hardware transport.",
  },
  {
    id: "hmi-preview",
    area: "HMI preview",
    status: "model-only",
    label: "Runtime preview",
    summary: "Screens, popups, bindings, alarms, diagnostics, trends, data logs, language packs, security metadata, and packages are modeled offline.",
    visibleIn: "HMI Designer and verification panels",
    next: "Add vendor-native import/transfer coverage and deeper pixel/runtime fidelity for operator-terminal workflows.",
  },
  {
    id: "io-module-catalog",
    area: "I/O module catalog",
    status: "model-only",
    label: "Offline profile edit",
    summary: "Module definitions, channels, keying, RPI, ports, and chassis layout are edited as project metadata; no module is discovered on a network.",
    visibleIn: "I/O Configuration, New Module, Module Properties",
    next: "Keep network discovery disabled until a verified browse transport exists.",
  },
  {
    id: "module-discovery",
    area: "Module discovery",
    status: "unsupported",
    label: "No network scan",
    summary: "Physical module discovery and network browse do not run in this build; catalog filtering is offline only.",
    visibleIn: "New Module dialog, I/O context menu",
    next: "Require a verified controller/network transport before scanning devices.",
    commandKinds: ["network-browser"],
  },
  {
    id: "real-go-online",
    area: "Hardware Go Online",
    status: "unsupported",
    label: "Unsupported hardware",
    summary: NO_VERIFIED_TRANSPORT,
    visibleIn: "Ribbon, Communications menu, Controller dock, organizer context menu",
    next: "Use Offline Simulation or the ESCO Virtual Controller. Real Go Online requires a verified hardware transport.",
    commandKinds: ["go-online"],
  },
  {
    id: "verified-readonly-monitor",
    area: "Verified read-only monitor",
    status: "planned",
    label: "Future read-only online",
    summary:
      "A future verified read-only transport may monitor live tag values and read fault/status diagnostics without enabling upload, download, mode changes, online edits, physical forces, or network browse.",
    visibleIn: "Controller dock, Status bar, Communications menu",
    next: "Implement and hardware-validate a monitor-only transport with explicit monitor/fault-read capabilities before enabling this lane.",
    commandKinds: ["monitor", "fault-diagnostics", "go-to-faults"],
  },
  {
    id: "real-transfer",
    area: "Hardware upload/download",
    status: "unsupported",
    label: "Unsupported hardware",
    summary: NO_VERIFIED_TRANSPORT,
    visibleIn: "Ribbon, Communications menu, Controller dock, organizer context menu",
    next: "Use virtual Upload/Download only for offline review. Real controller transfer requires a verified transport and commissioning preflight.",
    commandKinds: ["upload", "download"],
  },
  {
    id: "online-edits",
    area: "Online edits",
    status: "unsupported",
    label: "Unsupported hardware",
    summary: "Online edit test/assemble/finalize/cancel commands are unsupported for real hardware in this build; they are preserved as review concepts and never change a running controller.",
    visibleIn: "Ribbon, Communications menu, routine edit lifecycle labels",
    next: "Use offline edit review and apply changes through licensed external PLC engineering software after external verification.",
    commandKinds: ["online-edit", "test-edits", "assemble-edits", "finalize-edits", "cancel-edits"],
  },
  {
    id: "mode-changes",
    area: "Hardware mode changes",
    status: "unsupported",
    label: "Unsupported hardware",
    summary: "Run, Program, Remote Run, Remote Program, and Test mode requests are blocked for real controllers.",
    visibleIn: "Ribbon mode pills, Communications menu, Controller dock",
    next: "Use the ESCO Virtual Controller for simulation-only mode behavior. Hardware mode changes require a verified controller transport.",
    commandKinds: ["program-mode", "run-mode", "remote-program-mode", "remote-run-mode", "test-mode"],
  },
  {
    id: "hardware-faults",
    area: "Hardware faults",
    status: "unsupported",
    label: "Unsupported hardware",
    summary: "Clear Faults remains a hardware write and is blocked for real controllers. Fault reads move through the future verified read-only monitor lane.",
    visibleIn: "Ribbon flags, Communications menu, Controller dock",
    next: "Use diagnostics for offline validation and virtual faults for simulation. Live fault access requires a verified transport.",
    commandKinds: ["clear-faults"],
  },
  {
    id: "network-browse",
    area: "Network browse / Who Active",
    status: "unsupported",
    label: "Unsupported hardware",
    summary: "Who Active, Select Recent Path, and path diagnostics do not browse physical networks in this build.",
    visibleIn: "Ribbon path controls, Communications menu, Status bar, organizer context menu",
    next: "Select virtual paths in the ESCO Virtual Controller or add a verified network browse transport in a future release.",
    commandKinds: ["network-browser", "select-recent-path", "path-diagnostics"],
  },
  {
    area: "Process, motion, message, alarm, safety",
    id: "advanced-instruction-review",
    status: "review-only",
    label: "Model-only review",
    summary: "PID/PIDE, MSG/GSV/SSV, motion, alarm, PhaseManager, ESCO safety, and ASCII hardware handshake blocks parse and expose boundaries.",
    visibleIn: "Properties, Diagnostics, review projections",
    next: "Implement firmware-faithful execution for carefully selected families without pretending hardware behavior exists offline.",
  },
  {
    id: "verified-controller-transport",
    area: "Verified controller transport",
    status: "planned",
    label: "Future safety gate",
    summary: "A real controller driver, identity verification, commissioning workflow, and destructive-action preflight are future work.",
    visibleIn: "Controller dock preflight explanations",
    next: "Do not enable hardware commands until a transport is tested against real hardware and marked verified.",
  },
  {
    id: "desktop-release",
    area: "Desktop release",
    status: "partial",
    label: "Packaged shell baseline",
    summary: "The Windows shell has native open/save, guarded offline capability checks, CSP hardening, and credential-store backed AI keys.",
    visibleIn: "Desktop startup and project file dialogs",
    next: "Finish Microsoft Entra sign-in, code signing, installer, and distribution validation.",
  },
];

export type EscoCapabilityCounts = Record<EscoCapabilityStatus, number>;

function emptyCapabilityCounts(): EscoCapabilityCounts {
  return Object.fromEntries(ESCO_CAPABILITY_STATUSES.map((status) => [status, 0])) as EscoCapabilityCounts;
}

export function escoCapabilityCounts(
  areas: readonly EscoCapabilityArea[] = ESCO_CAPABILITY_AREAS,
): EscoCapabilityCounts {
  return areas.reduce((counts, area) => {
    counts[area.status] += 1;
    return counts;
  }, emptyCapabilityCounts());
}

export function escoCapabilityById(id: string): EscoCapabilityArea | undefined {
  return ESCO_CAPABILITY_AREAS.find((area) => area.id === id);
}

export function escoCapabilitiesByStatus(status: EscoCapabilityStatus): EscoCapabilityArea[] {
  return ESCO_CAPABILITY_AREAS.filter((area) => area.status === status);
}

export const ESCO_CONTROLLER_COMMAND_CAPABILITY: Partial<Record<ControllerCommandKind, string>> = {
  "network-browser": "network-browse",
  "select-recent-path": "network-browse",
  "path-diagnostics": "network-browse",
  "go-online": "real-go-online",
  monitor: "verified-readonly-monitor",
  upload: "real-transfer",
  download: "real-transfer",
  "online-edit": "online-edits",
  "test-edits": "online-edits",
  "assemble-edits": "online-edits",
  "finalize-edits": "online-edits",
  "cancel-edits": "online-edits",
  "program-mode": "mode-changes",
  "run-mode": "mode-changes",
  "remote-program-mode": "mode-changes",
  "remote-run-mode": "mode-changes",
  "test-mode": "mode-changes",
  "lock-controller": "mode-changes",
  "clear-faults": "hardware-faults",
  "fault-diagnostics": "verified-readonly-monitor",
  "go-to-faults": "verified-readonly-monitor",
};

export function escoControllerCommandCapability(
  commandKind: ControllerCommandKind,
): EscoCapabilityArea | undefined {
  const id = ESCO_CONTROLLER_COMMAND_CAPABILITY[commandKind];
  return id ? escoCapabilityById(id) : undefined;
}

export function escoControllerCommandDisplayLabel(
  commandKind: ControllerCommandKind,
  fallback: string,
): string {
  const capability = escoControllerCommandCapability(commandKind);
  if (!capability) return fallback;
  if (capability.status === "unsupported") return `${fallback} (Unsupported)`;
  if (capability.status === "planned") return `${fallback} (Future)`;
  if (capability.status === "simulation-only") return `${fallback} (Virtual)`;
  return fallback;
}

export function escoControllerCommandUnavailableTitle(
  commandKind: ControllerCommandKind,
  fallback = "This command is unavailable in this build.",
): string {
  const capability = escoControllerCommandCapability(commandKind);
  if (!capability) return fallback;
  return `${capability.area}: ${capability.summary} Required next step: ${capability.next}`;
}
