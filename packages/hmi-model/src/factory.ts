import { createId, nowIso } from "@esco/shared";
import { getHmiElementDefinition } from "./registry";
import type {
  HmiDeviceProfile,
  HmiGraphicElement,
  HmiProject,
  HmiPopup,
  HmiScreen,
  HmiSystemBanner,
} from "./types";

export const PANELVIEW_5310_10_INCH: HmiDeviceProfile = {
  id: "panelview-5310-10w",
  family: "PanelView 5000",
  name: "PanelView 5310 10-inch Wide",
  firmwareRevision: "model-only",
  width: 1280,
  height: 800,
  dpi: 149,
  colorDepth: 24,
  supportsTouch: true,
  supportedFeatures: [
    "screens",
    "popups",
    "system-banner",
    "bindings",
    "events",
    "alarms",
    "trends",
    "data-logs",
    "security",
    "language-packs",
    "runtime-preview",
  ],
  capacity: {
    maxScreens: 250,
    maxElementsPerScreen: 1000,
    maxTrends: 64,
    maxDataLogs: 64,
    storageMb: 512,
  },
};

export const HMI_DEVICE_PROFILES: HmiDeviceProfile[] = [PANELVIEW_5310_10_INCH];

export function createDefaultHmiProject(name = "HMI Project"): HmiProject {
  const ts = nowIso();
  return {
    schemaVersion: 1,
    id: createId("hmi"),
    name,
    targetDevice: PANELVIEW_5310_10_INCH,
    defaultLanguage: "en-US",
    screens: [],
    popups: [],
    systemBanner: createSystemBanner(),
    shortcuts: [],
    assets: [],
    addOnGraphics: [],
    alarmViews: [],
    diagnosticsViews: [],
    trends: [],
    dataLogs: [],
    languagePacks: [
      {
        id: createId("lang"),
        languageId: "en-US",
        displayName: "English (United States)",
        strings: {},
        missingStringIds: [],
      },
    ],
    security: {
      roles: [
        { id: "role_operator", name: "Operator", permissions: ["navigate", "acknowledge-alarms"] },
        { id: "role_engineer", name: "Engineer", permissions: ["navigate", "configure", "acknowledge-alarms"] },
      ],
      users: [],
      guestRoleId: "role_operator",
      autoLogoffSeconds: 900,
      passwordPolicy: { minimumLength: 8, requireComplexity: true },
    },
    unsupportedContent: [],
    createdAt: ts,
    updatedAt: ts,
  };
}

export function createHmiScreen(name: string, device = PANELVIEW_5310_10_INCH): HmiScreen {
  return {
    id: createId("hmiscreen"),
    kind: "screen",
    name,
    width: device.width,
    height: device.height,
    background: "#f7f8fc",
    updateRateMs: 250,
    securityRoleIds: [],
    elements: [],
    navigation: { includeInMenu: true, caption: name },
  };
}

export function createHmiPopup(name: string, width = 520, height = 340): HmiPopup {
  return {
    id: createId("hmipopup"),
    kind: "popup",
    name,
    width,
    height,
    background: "#ffffff",
    updateRateMs: 250,
    securityRoleIds: [],
    elements: [],
    caption: name,
    showCloseButton: true,
    opacity: 1,
    cachePolicy: "none",
  };
}

export function createSystemBanner(): HmiSystemBanner {
  return {
    id: createId("hmibanner"),
    kind: "system-banner",
    name: "System Banner",
    width: PANELVIEW_5310_10_INCH.width,
    height: 72,
    background: "#ffffff",
    updateRateMs: 500,
    securityRoleIds: [],
    elements: [],
    dock: "top",
    restoreDefaultAvailable: true,
  };
}

export function createHmiElement(typeId: string, name?: string, payload?: unknown): HmiGraphicElement {
  const definition = getHmiElementDefinition(typeId);
  if (!definition) {
    return {
      id: createId("hmiel"),
      typeId,
      name: name?.trim() || typeId,
      geometry: { x: 96, y: 96, width: 180, height: 72 },
      zIndex: 0,
      visible: true,
      style: { fill: "#f7f8fc", stroke: "#f04438", textColor: "#111827", fontSize: 12 },
      properties: {},
      bindings: [],
      events: [],
      animations: [],
      unsupported: {
        originalType: typeId,
        preservedPayload: payload,
        readonlyReason: "Element type is not registered in the ESCO HMI element registry.",
      },
    };
  }

  const properties = Object.fromEntries(
    definition.properties
      .filter((property) => property.defaultValue !== undefined)
      .map((property) => [property.name, property.defaultValue]),
  );

  return {
    id: createId("hmiel"),
    typeId,
    name: name?.trim() || definition.displayName,
    geometry: { ...definition.defaultGeometry },
    zIndex: 0,
    visible: true,
    style: definition.defaultStyle ? { ...definition.defaultStyle } : undefined,
    properties,
    bindings: [],
    events: [],
    animations: [],
  };
}

export function touchHmiProject(project: HmiProject): HmiProject {
  return { ...project, updatedAt: nowIso() };
}
