/**
 * ESCO Simulation Lab — offline boundary and original-IP guardrails.
 *
 * Every artifact the Simulation Lab produces is virtual and offline. This
 * module centralises the boundary statements and copyright-safe labels so the
 * UI, exports, reports, and tests all reference one source of truth.
 *
 * Boundaries enforced everywhere in this package:
 *  - Offline / virtual only. No real controller, no upload/download, no go
 *    online, no online edits, no physical-controller communication.
 *  - No .ACD support and no vendor proprietary binary formats.
 *  - Compatibility helpers are ESCO-owned review/export aids only; they never
 *    embed, reproduce, or convert vendor UI, icons, sample projects, layouts,
 *    wording, file formats, or assets.
 */

/** The single offline-only boundary statement shown across the Simulation Lab. */
export const SIM_LAB_OFFLINE_BOUNDARY =
  "ESCO Simulation Lab runs offline and virtual only. It models controllers, " +
  "devices, tags, logic, HMI, and scenarios entirely in software. It never " +
  "communicates with a physical controller and performs no upload, download, " +
  "go-online, or online-edit operation. All fault injection and signals are " +
  "simulated. Review every result in a sandbox before any production use.";

/** Short banner variant for compact UI placements. */
export const SIM_LAB_OFFLINE_BADGE = "Offline Simulation Only";

/** Notice embedded into every Simulation Lab export/report for provenance. */
export const SIM_LAB_GENERATED_NOTICE =
  "Generated offline by ESCO Simulation Lab. This is an ESCO-native, virtual " +
  "simulation artifact for review only — not controller-verified, never " +
  "produced from or written to a proprietary binary project file, and never " +
  "involving any controller communication.";

/** Marker proving an artifact never touched real hardware or vendor binaries. */
export interface SimOfflineEvidence {
  generatedOffline: true;
  realControllerIo: false;
  proprietaryBinaryTouched: false;
  acdSupported: false;
  notice: string;
}

export const SIM_OFFLINE_EVIDENCE: SimOfflineEvidence = {
  generatedOffline: true,
  realControllerIo: false,
  proprietaryBinaryTouched: false,
  acdSupported: false,
  notice: SIM_LAB_GENERATED_NOTICE,
};

/**
 * Operations that are intentionally blocked because they require a physical
 * controller. The UI surfaces these so every "real PLC" action is visibly
 * documented as unsupported in the offline lab.
 */
export const SIM_BLOCKED_REAL_OPERATIONS = [
  { id: "go-online", label: "Go Online", reason: "Requires a physical controller link." },
  { id: "download", label: "Download to Controller", reason: "Requires a physical controller link." },
  { id: "upload", label: "Upload from Controller", reason: "Requires a physical controller link." },
  { id: "online-edit", label: "Online Edit", reason: "Requires a running physical controller." },
  { id: "firmware", label: "Firmware Update", reason: "Requires a physical controller." },
  { id: "acd-open", label: "Open .ACD Project", reason: "Proprietary binary format is not supported." },
] as const;

export type SimBlockedRealOperationId = (typeof SIM_BLOCKED_REAL_OPERATIONS)[number]["id"];

/**
 * Copyright-safe, ESCO-owned labels for the compatibility review/export
 * helpers. These are the only names used; they describe ESCO review aids and
 * deliberately avoid copying any vendor product naming, file formats, or UI.
 */
export const SIM_COMPAT_LABELS = {
  hmiRuntime: "ESCO HMI Runtime",
  scadaExport: "SCADA Compatibility Export",
  opcUa: "OPC UA Simulator",
  ignitionReview: "Ignition Gateway Export Review",
  optixReview: "Optix Migration Review",
  modbusTcp: "Modbus TCP Simulator",
  mqttSparkplug: "MQTT / Sparkplug Simulator",
} as const;

export type SimCompatHelperId = keyof typeof SIM_COMPAT_LABELS;
