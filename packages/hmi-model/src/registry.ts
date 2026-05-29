import type { HmiElementDefinition } from "./types";

export const HMI_ELEMENT_DEFINITIONS: HmiElementDefinition[] = [
  {
    typeId: "common.button",
    displayName: "Button",
    category: "common",
    defaultGeometry: { x: 80, y: 80, width: 180, height: 48 },
    defaultStyle: { fill: "#4f46e5", stroke: "#3730a3", textColor: "#ffffff", fontSize: 14 },
    properties: [
      { name: "label", label: "Label", dataType: "string", defaultValue: "Button" },
      { name: "enabled", label: "Enabled", dataType: "boolean", defaultValue: true, bindable: true },
    ],
    events: ["press", "release"],
    runtimeSupport: "runtime-preview",
    description: "Operator button with press/release event hooks.",
  },
  {
    typeId: "common.numeric-display",
    displayName: "Numeric Display",
    category: "common",
    defaultGeometry: { x: 80, y: 150, width: 150, height: 38 },
    defaultStyle: { fill: "#ffffff", stroke: "#c8d0e6", textColor: "#111827", fontSize: 14 },
    properties: [
      { name: "label", label: "Label", dataType: "string", defaultValue: "Value" },
      { name: "value", label: "Value", dataType: "tag-path", bindable: true },
      { name: "precision", label: "Precision", dataType: "number", defaultValue: 0 },
    ],
    events: [],
    runtimeSupport: "runtime-preview",
    description: "Read-only numeric process value display.",
  },
  {
    typeId: "common.numeric-input",
    displayName: "Numeric Input",
    category: "common",
    defaultGeometry: { x: 80, y: 205, width: 160, height: 42 },
    defaultStyle: { fill: "#ffffff", stroke: "#aab5d6", textColor: "#111827", fontSize: 14 },
    properties: [
      { name: "label", label: "Label", dataType: "string", defaultValue: "Setpoint" },
      { name: "value", label: "Value", dataType: "tag-path", bindable: true },
      { name: "min", label: "Minimum", dataType: "number", defaultValue: 0 },
      { name: "max", label: "Maximum", dataType: "number", defaultValue: 100 },
    ],
    events: ["value-change"],
    runtimeSupport: "runtime-preview",
    description: "Numeric operator input bound to a tag or expression.",
  },
  {
    typeId: "common.text-display",
    displayName: "Text Display",
    category: "common",
    defaultGeometry: { x: 280, y: 80, width: 220, height: 36 },
    defaultStyle: { fill: "transparent", textColor: "#111827", fontSize: 18 },
    properties: [
      { name: "text", label: "Text", dataType: "string", defaultValue: "Text Display", bindable: true },
      { name: "multiline", label: "Multiline", dataType: "boolean", defaultValue: false },
    ],
    events: [],
    runtimeSupport: "runtime-preview",
    description: "Static or bound operator text.",
  },
  {
    typeId: "trends.trend-chart",
    displayName: "Trend Chart",
    category: "trends",
    defaultGeometry: { x: 280, y: 150, width: 320, height: 180 },
    defaultStyle: { fill: "#ffffff", stroke: "#c8d0e6", textColor: "#111827", fontSize: 12 },
    properties: [
      { name: "title", label: "Title", dataType: "string", defaultValue: "Trend" },
      { name: "timeRangeSeconds", label: "Time Range", dataType: "number", defaultValue: 300 },
    ],
    events: [],
    runtimeSupport: "model-only",
    description: "Trend chart model with traces and sampling configuration.",
  },
  {
    typeId: "alarms.alarm-summary",
    displayName: "Alarm Summary",
    category: "alarms",
    defaultGeometry: { x: 80, y: 280, width: 420, height: 160 },
    defaultStyle: { fill: "#ffffff", stroke: "#f79009", textColor: "#111827", fontSize: 12 },
    properties: [
      { name: "title", label: "Title", dataType: "string", defaultValue: "Alarm Summary" },
      { name: "filter", label: "Filter", dataType: "string", defaultValue: "" },
    ],
    events: [],
    runtimeSupport: "model-only",
    description: "Alarm summary table configuration preserved for HMI verification.",
  },
  {
    typeId: "navigation.menu",
    displayName: "Navigation Menu",
    category: "navigation",
    defaultGeometry: { x: 0, y: 0, width: 180, height: 480 },
    defaultStyle: { fill: "#f7f8fc", stroke: "#d9def2", textColor: "#111827", fontSize: 13 },
    properties: [
      { name: "orientation", label: "Orientation", dataType: "string", defaultValue: "vertical" },
      { name: "homeScreenId", label: "Home Screen", dataType: "screen-id", bindable: false },
    ],
    events: ["press"],
    runtimeSupport: "runtime-preview",
    description: "Screen navigation menu driven by project screen hierarchy.",
  },
  {
    typeId: "media.image-placeholder",
    displayName: "Image Placeholder",
    category: "media",
    defaultGeometry: { x: 540, y: 80, width: 180, height: 120 },
    defaultStyle: { fill: "#f8fafc", stroke: "#c8d0e6", textColor: "#667085", fontSize: 12 },
    properties: [
      { name: "assetId", label: "Image Asset", dataType: "asset-id" },
      { name: "altText", label: "Alt Text", dataType: "string", defaultValue: "Image" },
    ],
    events: [],
    runtimeSupport: "runtime-preview",
    description: "Image/PDF asset placeholder with missing-asset validation.",
  },
];

export const HMI_ELEMENT_REGISTRY = new Map(
  HMI_ELEMENT_DEFINITIONS.map((definition) => [definition.typeId, definition]),
);

export function getHmiElementDefinition(typeId: string): HmiElementDefinition | undefined {
  return HMI_ELEMENT_REGISTRY.get(typeId);
}

export function hmiElementDefinitionsByCategory(): Record<string, HmiElementDefinition[]> {
  return HMI_ELEMENT_DEFINITIONS.reduce<Record<string, HmiElementDefinition[]>>((groups, definition) => {
    groups[definition.category] = [...(groups[definition.category] ?? []), definition];
    return groups;
  }, {});
}
