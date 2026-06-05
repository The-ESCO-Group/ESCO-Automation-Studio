/**
 * ESCO-owned compatibility review and offline-export helpers.
 *
 * These helpers are original ESCO review aids. They map the ESCO-native device
 * map and virtual tags into neutral, ESCO-owned target representations and
 * report mapping readiness, missing items, unsupported items, and export notes.
 *
 * They never reproduce, embed, or convert any vendor UI, icons, sample projects,
 * layouts, wording, file formats, or assets, and they never open a real network
 * endpoint — the OPC UA / Modbus TCP / MQTT-Sparkplug "simulators" are
 * in-memory, offline address/topic mappers with a modeled connection log only.
 */

import {
  SIM_COMPAT_LABELS,
  SIM_LAB_GENERATED_NOTICE,
  SIM_OFFLINE_EVIDENCE,
  type SimCompatHelperId,
  type SimOfflineEvidence,
} from "./boundary";
import { slugId } from "./ids";
import { collectAllTags } from "./tags";
import type { SimProject, SimValidationFinding, SimVirtualTag } from "./types";

export type SimCompatItemStatus = "ready" | "missing" | "unsupported";

export interface SimCompatItem {
  source: string;
  mapped: string;
  dataType: string;
  status: SimCompatItemStatus;
  note?: string;
}

export interface SimCompatReview {
  helper: SimCompatHelperId;
  label: string;
  notice: string;
  offline: SimOfflineEvidence;
  readiness: { total: number; ready: number; missing: number; unsupported: number; percentReady: number };
  items: SimCompatItem[];
  missing: string[];
  unsupported: string[];
  exportNotes: string[];
  connectionLog: string[];
}

interface CompatBuildConfig {
  helper: SimCompatHelperId;
  map: (tag: SimVirtualTag, index: number) => { mapped: string; status?: SimCompatItemStatus; note?: string };
  unsupported: string[];
  exportNotes: string[];
  connectionLog: (count: number) => string[];
}

function buildReview(project: SimProject, config: CompatBuildConfig): SimCompatReview {
  const tags = collectAllTags(project);
  const items: SimCompatItem[] = tags.map((tag, index) => {
    const result = config.map(tag, index);
    const item: SimCompatItem = {
      source: tag.name,
      mapped: result.mapped,
      dataType: tag.dataType,
      status: result.status ?? "ready",
    };
    if (result.note) item.note = result.note;
    return item;
  });
  const missing = items.filter((i) => i.status === "missing").map((i) => i.source);
  const unsupportedItems = items.filter((i) => i.status === "unsupported").map((i) => i.source);
  const ready = items.filter((i) => i.status === "ready").length;
  const total = items.length;
  return {
    helper: config.helper,
    label: SIM_COMPAT_LABELS[config.helper],
    notice: SIM_LAB_GENERATED_NOTICE,
    offline: SIM_OFFLINE_EVIDENCE,
    readiness: {
      total,
      ready,
      missing: missing.length,
      unsupported: unsupportedItems.length,
      percentReady: total === 0 ? 0 : Math.round((ready / total) * 100),
    },
    items,
    missing,
    unsupported: config.unsupported.concat(unsupportedItems.map((s) => `Unsupported mapping for ${s}.`)),
    exportNotes: config.exportNotes,
    connectionLog: config.connectionLog(total),
  };
}

function metricSuffix(tag: SimVirtualTag): string {
  const idx = tag.name.indexOf("_");
  return idx >= 0 ? tag.name.slice(idx + 1) : tag.name;
}

// ---------------------------------------------------------------------------
// ESCO HMI Runtime mapping (native runtime tag binding)
// ---------------------------------------------------------------------------

export function buildHmiRuntimeReview(project: SimProject): SimCompatReview {
  return buildReview(project, {
    helper: "hmiRuntime",
    map: (tag) => ({ mapped: `runtime://esco-hmi/${tag.name}` }),
    unsupported: [],
    exportNotes: ["Binds ESCO HMI Runtime widgets directly to the live simulation tag database (offline preview)."],
    connectionLog: (n) => ["ESCO HMI Runtime preview attached to the simulation engine.", `Bound ${n} tags for live read.`],
  });
}

// ---------------------------------------------------------------------------
// SCADA Compatibility Export
// ---------------------------------------------------------------------------

export function buildScadaCompatibilityExport(project: SimProject): SimCompatReview {
  return buildReview(project, {
    helper: "scadaExport",
    map: (tag) => ({ mapped: `ESCO_SIM.${tag.name}` }),
    unsupported: ["Live SCADA server binding is out of scope (offline export only)."],
    exportNotes: ["Neutral, ESCO-owned tag address list for review and manual import into a SCADA tag database."],
    connectionLog: (n) => ["SCADA Compatibility Export generated offline.", `Listed ${n} tag addresses.`],
  });
}

// ---------------------------------------------------------------------------
// OPC UA Simulator (offline node map; no real endpoint)
// ---------------------------------------------------------------------------

export function buildOpcUaSimulator(project: SimProject): SimCompatReview {
  return buildReview(project, {
    helper: "opcUa",
    map: (tag) => ({ mapped: `ns=2;s=ESCO.Sim.${tag.name}` }),
    unsupported: [
      "Live OPC UA server endpoint is not opened (offline simulator only).",
      "Security/certificate exchange is not performed offline.",
    ],
    exportNotes: ["Generates an offline OPC UA address-space map (NodeIds) from the simulation tags."],
    connectionLog: (n) => [
      "OPC UA Simulator initialized in offline mode.",
      "Virtual endpoint: opc.tcp://offline-sim (no socket opened).",
      `Exposed ${n} virtual nodes.`,
    ],
  });
}

// ---------------------------------------------------------------------------
// Modbus TCP Simulator (offline register map; no real socket)
// ---------------------------------------------------------------------------

export function buildModbusTcpSimulator(project: SimProject): SimCompatReview {
  let coil = 1;
  let holding = 40001;
  return buildReview(project, {
    helper: "modbusTcp",
    map: (tag) => {
      if (tag.dataType === "BOOL") {
        const addr = coil;
        coil += 1;
        return { mapped: `coil ${addr}` };
      }
      const addr = holding;
      holding += 2; // 32-bit value spans two registers
      return { mapped: `holding ${addr}-${addr + 1}`, note: tag.dataType === "REAL" ? "float32" : "int32" };
    },
    unsupported: [
      "Live Modbus TCP socket is not opened (offline simulator only).",
      "Device-specific register maps beyond the generated layout are out of scope.",
    ],
    exportNotes: ["Generates an offline Modbus register map: BOOL → coils, REAL/DINT → holding registers."],
    connectionLog: (n) => [
      "Modbus TCP Simulator initialized in offline mode.",
      "Virtual unit id 1 @ 127.0.0.1:502 (no socket opened).",
      `Mapped ${n} points.`,
    ],
  });
}

// ---------------------------------------------------------------------------
// MQTT / Sparkplug Simulator (offline topic map; no real broker)
// ---------------------------------------------------------------------------

export function buildMqttSparkplugSimulator(project: SimProject): SimCompatReview {
  const group = slugId(project.name) || "sim";
  const deviceById = new Map(project.devices.map((d) => [d.id, d.tag]));
  return buildReview(project, {
    helper: "mqttSparkplug",
    map: (tag) => {
      const device = tag.deviceId ? (deviceById.get(tag.deviceId) ?? "logic") : "logic";
      return { mapped: `esco/sim/${group}/${device}/${metricSuffix(tag)}` };
    },
    unsupported: [
      "Live MQTT broker connection is not opened (offline simulator only).",
      "Sparkplug B birth/death certificates are modeled, not published.",
    ],
    exportNotes: ["Generates an offline Sparkplug-style topic namespace and metric list from the device map."],
    connectionLog: (n) => [
      "MQTT / Sparkplug Simulator initialized in offline mode.",
      `Virtual node: esco/sim/${group} (no broker connection).`,
      `Modeled ${n} metrics.`,
    ],
  });
}

// ---------------------------------------------------------------------------
// Ignition Gateway Export Review (ESCO-owned readiness review)
// ---------------------------------------------------------------------------

export function buildIgnitionGatewayExportReview(project: SimProject): SimCompatReview {
  return buildReview(project, {
    helper: "ignitionReview",
    map: (tag) => ({ mapped: `[ESCO_Sim]${tag.deviceId ? tagFolder(project, tag) : "Logic"}/${metricSuffix(tag)}` }),
    unsupported: [
      "Vendor gateway project archive is not produced (offline review only).",
      "Vendor view layouts, templates, and assets are not generated or copied.",
      "Live gateway publish requires the vendor platform and is out of scope.",
    ],
    exportNotes: [
      "Reviews how ESCO-native tags would fold into a generic tag-provider folder layout.",
      "Use the readiness list to plan a manual tag import on the target platform.",
    ],
    connectionLog: (n) => ["Ignition Gateway Export Review generated offline.", `Reviewed ${n} tags for mapping readiness.`],
  });
}

// ---------------------------------------------------------------------------
// Optix Migration Review (ESCO-owned readiness review)
// ---------------------------------------------------------------------------

export function buildOptixMigrationReview(project: SimProject): SimCompatReview {
  return buildReview(project, {
    helper: "optixReview",
    map: (tag) => ({ mapped: `Objects/EscoSim/${tag.deviceId ? tagFolder(project, tag) : "Logic"}/${metricSuffix(tag)}` }),
    unsupported: [
      "Vendor project file is not produced (offline migration review only).",
      "Vendor screen/widget assets and navigation are not copied.",
      "Runtime deployment requires the vendor platform.",
    ],
    exportNotes: [
      "Reviews how ESCO-native tags would map to a generic object-model node path.",
      "Use the readiness list to plan a manual model rebuild on the target platform.",
    ],
    connectionLog: (n) => ["Optix Migration Review generated offline.", `Reviewed ${n} tags for migration readiness.`],
  });
}

function tagFolder(project: SimProject, tag: SimVirtualTag): string {
  const device = project.devices.find((d) => d.id === tag.deviceId);
  return device ? device.tag : "Logic";
}

// ---------------------------------------------------------------------------
// Registry + dispatch + validation
// ---------------------------------------------------------------------------

export interface SimCompatHelperInfo {
  id: SimCompatHelperId;
  label: string;
  description: string;
}

export const COMPAT_HELPERS: readonly SimCompatHelperInfo[] = [
  { id: "hmiRuntime", label: SIM_COMPAT_LABELS.hmiRuntime, description: "Bind ESCO HMI Runtime widgets to live simulation tags." },
  { id: "scadaExport", label: SIM_COMPAT_LABELS.scadaExport, description: "Neutral ESCO-owned SCADA tag address list." },
  { id: "opcUa", label: SIM_COMPAT_LABELS.opcUa, description: "Offline OPC UA node-id address space." },
  { id: "modbusTcp", label: SIM_COMPAT_LABELS.modbusTcp, description: "Offline Modbus register map." },
  { id: "mqttSparkplug", label: SIM_COMPAT_LABELS.mqttSparkplug, description: "Offline Sparkplug-style topic namespace." },
  { id: "ignitionReview", label: SIM_COMPAT_LABELS.ignitionReview, description: "Readiness review for a manual gateway tag import." },
  { id: "optixReview", label: SIM_COMPAT_LABELS.optixReview, description: "Readiness review for a manual object-model rebuild." },
] as const;

export function buildCompatReview(project: SimProject, helper: SimCompatHelperId): SimCompatReview {
  switch (helper) {
    case "hmiRuntime":
      return buildHmiRuntimeReview(project);
    case "scadaExport":
      return buildScadaCompatibilityExport(project);
    case "opcUa":
      return buildOpcUaSimulator(project);
    case "modbusTcp":
      return buildModbusTcpSimulator(project);
    case "mqttSparkplug":
      return buildMqttSparkplugSimulator(project);
    case "ignitionReview":
      return buildIgnitionGatewayExportReview(project);
    case "optixReview":
      return buildOptixMigrationReview(project);
  }
}

/** Surface unsupported/missing compat items as diagnostics findings. */
export function compatExportFindings(review: SimCompatReview): SimValidationFinding[] {
  const findings: SimValidationFinding[] = [];
  for (const note of review.unsupported) {
    findings.push({ ruleId: "compat-unsupported", severity: "info", message: `${review.label}: ${note}`, target: review.helper });
  }
  for (const item of review.missing) {
    findings.push({ ruleId: "compat-missing", severity: "warning", message: `${review.label}: missing mapping for ${item}.`, target: review.helper });
  }
  return findings;
}

/** Serialize a compat review to ESCO-native JSON. */
export function compatReviewToJson(review: SimCompatReview): string {
  return JSON.stringify(review, null, 2);
}

/** Serialize a compat review's mapping table to CSV. */
export function compatReviewToCsv(review: SimCompatReview): string {
  const rows: string[][] = [["Source Tag", "Mapped", "Data Type", "Status", "Note"]];
  for (const item of review.items) rows.push([item.source, item.mapped, item.dataType, item.status, item.note ?? ""]);
  const csvCell = (value: string): string => (/[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}
