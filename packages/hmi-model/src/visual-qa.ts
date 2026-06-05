import { getHmiElementDefinition } from "./registry";
import type { HmiGraphicElement, HmiProject, HmiSurfaceBase, HmiSurfaceKind, HmiValidationSeverity } from "./types";

export type HmiVisualQaComplexity = "empty" | "simple" | "standard" | "complex";

export interface HmiVisualQaIssue {
  ruleId: string;
  severity: HmiValidationSeverity;
  message: string;
  target: string;
  elementIds: string[];
}

export interface HmiVisualQaCoverage {
  processObjects: number;
  alarmObjects: number;
  trendObjects: number;
  navigationObjects: number;
  diagnosticsObjects: number;
  dataLogDefinitions: number;
  recipeDefinitions: number;
  securedSurfaces: number;
  hmiButtonControls: number;
}

export interface HmiSurfaceVisualQa {
  id: string;
  kind: HmiSurfaceKind;
  name: string;
  width: number;
  height: number;
  elementCount: number;
  complexity: HmiVisualQaComplexity;
  scaling: "native" | "scaled" | "oversized";
  runtimePreviewElementCount: number;
  modelOnlyElementCount: number;
  unsupportedElementCount: number;
  outOfBoundsCount: number;
  overlapCount: number;
  smallTouchTargetCount: number;
  tinyTextCount: number;
  issueCount: number;
  issues: HmiVisualQaIssue[];
}

export interface HmiVisualQaReport {
  targetDeviceName: string;
  targetWidth: number;
  targetHeight: number;
  surfaceCount: number;
  complexSurfaceCount: number;
  issueCount: number;
  errorCount: number;
  warningCount: number;
  coverage: HmiVisualQaCoverage;
  surfaces: HmiSurfaceVisualQa[];
}

interface Rect {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

const PROCESS_TYPE_IDS = new Set([
  "common.button",
  "common.numeric-display",
  "common.numeric-input",
  "common.indicator-lamp",
  "common.multistate-indicator",
  "common.hmi-button-control",
]);

function surfaces(project: HmiProject): HmiSurfaceBase[] {
  return [...project.screens, ...project.popups, project.systemBanner];
}

function finiteRect(element: HmiGraphicElement): Rect | undefined {
  const { x, y, width, height } = element.geometry;
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return undefined;
  return { id: element.id, x, y, width, height };
}

function overlapArea(left: Rect, right: Rect): number {
  const x = Math.max(0, Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x));
  const y = Math.max(0, Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y));
  return x * y;
}

function issue(
  ruleId: string,
  severity: HmiValidationSeverity,
  message: string,
  target: string,
  elementIds: string[] = [],
): HmiVisualQaIssue {
  return { ruleId, severity, message, target, elementIds };
}

function textValue(element: HmiGraphicElement): string {
  const value = element.properties.text ?? element.properties.label ?? element.properties.title ?? element.name;
  return typeof value === "string" ? value : String(value ?? "");
}

function isTouchElement(element: HmiGraphicElement): boolean {
  const definition = getHmiElementDefinition(element.typeId);
  return Boolean(definition?.events.length || element.events.length || /button|input|control|menu/i.test(element.typeId));
}

function scalingFor(surface: HmiSurfaceBase, project: HmiProject): HmiSurfaceVisualQa["scaling"] {
  if (surface.width === project.targetDevice.width && surface.height === project.targetDevice.height) return "native";
  if (surface.width > project.targetDevice.width || surface.height > project.targetDevice.height) return "oversized";
  return "scaled";
}

function complexityFor(surface: HmiSurfaceBase, coverage: HmiVisualQaCoverage): HmiVisualQaComplexity {
  if (surface.elements.length === 0) return "empty";
  if (surface.elements.length >= 8) return "complex";
  const families = [
    coverage.processObjects > 0,
    coverage.alarmObjects > 0,
    coverage.trendObjects > 0,
    coverage.dataLogDefinitions > 0,
    coverage.recipeDefinitions > 0,
    coverage.navigationObjects > 0,
    coverage.diagnosticsObjects > 0,
  ].filter(Boolean).length;
  if (surface.elements.length >= 4 && families >= 3) return "complex";
  if (surface.elements.length >= 5 && families >= 2) return "complex";
  if (surface.elements.length >= 3 || families >= 2) return "standard";
  return "simple";
}

function coverageFor(project: HmiProject, surface: HmiSurfaceBase): HmiVisualQaCoverage {
  return {
    processObjects: surface.elements.filter((element) => PROCESS_TYPE_IDS.has(element.typeId)).length,
    alarmObjects: surface.elements.filter((element) => element.typeId.startsWith("alarms.")).length,
    trendObjects: surface.elements.filter((element) => element.typeId.startsWith("trends.")).length,
    navigationObjects: surface.elements.filter((element) => element.typeId.startsWith("navigation.")).length,
    diagnosticsObjects: surface.elements.filter((element) => element.typeId.includes("diagnostic")).length,
    dataLogDefinitions: project.dataLogs.length,
    recipeDefinitions: project.recipes?.length ?? 0,
    securedSurfaces: surface.securityRoleIds.length > 0 ? 1 : 0,
    hmiButtonControls: surface.elements.filter((element) => element.typeId === "common.hmi-button-control").length,
  };
}

function mergeCoverage(rows: HmiVisualQaCoverage[]): HmiVisualQaCoverage {
  return rows.reduce<HmiVisualQaCoverage>(
    (sum, row) => ({
      processObjects: sum.processObjects + row.processObjects,
      alarmObjects: sum.alarmObjects + row.alarmObjects,
      trendObjects: sum.trendObjects + row.trendObjects,
      navigationObjects: sum.navigationObjects + row.navigationObjects,
      diagnosticsObjects: sum.diagnosticsObjects + row.diagnosticsObjects,
      dataLogDefinitions: Math.max(sum.dataLogDefinitions, row.dataLogDefinitions),
      recipeDefinitions: Math.max(sum.recipeDefinitions, row.recipeDefinitions),
      securedSurfaces: sum.securedSurfaces + row.securedSurfaces,
      hmiButtonControls: sum.hmiButtonControls + row.hmiButtonControls,
    }),
    {
      processObjects: 0,
      alarmObjects: 0,
      trendObjects: 0,
      navigationObjects: 0,
      diagnosticsObjects: 0,
      dataLogDefinitions: 0,
      recipeDefinitions: 0,
      securedSurfaces: 0,
      hmiButtonControls: 0,
    },
  );
}

function surfaceVisualQa(project: HmiProject, surface: HmiSurfaceBase): HmiSurfaceVisualQa {
  const issues: HmiVisualQaIssue[] = [];
  const coverage = coverageFor(project, surface);
  const rects = surface.elements.flatMap((element) => {
    const rect = finiteRect(element);
    return rect ? [rect] : [];
  });

  for (const element of surface.elements) {
    const target = `hmi/${surface.kind}:${surface.id}/element:${element.id}`;
    const definition = getHmiElementDefinition(element.typeId);
    const rect = finiteRect(element);
    if (!definition || element.unsupported) {
      issues.push(issue("hmi-visual-qa-unsupported-element", "warning", `Unsupported element "${element.name}" is read-only.`, target, [element.id]));
    } else if (definition.runtimeSupport === "model-only") {
      issues.push(issue("hmi-visual-qa-model-only-element", "info", `${definition.displayName} is model-only in offline runtime preview.`, target, [element.id]));
    }
    if (!rect) continue;
    if (rect.x < 0 || rect.y < 0 || rect.x + rect.width > surface.width || rect.y + rect.height > surface.height) {
      issues.push(issue("hmi-visual-qa-out-of-bounds", "warning", `Element "${element.name}" extends outside the ${surface.kind}.`, target, [element.id]));
    }
    if (isTouchElement(element) && (rect.width < 44 || rect.height < 32)) {
      issues.push(issue("hmi-visual-qa-small-touch-target", "warning", `Element "${element.name}" has a small operator touch target.`, target, [element.id]));
    }
    if ((element.style?.fontSize ?? 12) < 10 || (textValue(element).length >= 18 && rect.width < 120)) {
      issues.push(issue("hmi-visual-qa-text-fit-risk", "warning", `Element "${element.name}" may have cramped operator text.`, target, [element.id]));
    }
  }

  for (let leftIndex = 0; leftIndex < rects.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < rects.length; rightIndex += 1) {
      const left = rects[leftIndex]!;
      const right = rects[rightIndex]!;
      if (overlapArea(left, right) >= 400) {
        issues.push(
          issue(
            "hmi-visual-qa-overlap",
            "warning",
            "Visible elements overlap enough to hide operator context.",
            `hmi/${surface.kind}:${surface.id}/elements`,
            [left.id, right.id],
          ),
        );
      }
    }
  }

  const runtimePreviewElementCount = surface.elements.filter(
    (element) => getHmiElementDefinition(element.typeId)?.runtimeSupport === "runtime-preview" && !element.unsupported,
  ).length;
  const modelOnlyElementCount = surface.elements.filter(
    (element) => getHmiElementDefinition(element.typeId)?.runtimeSupport === "model-only" && !element.unsupported,
  ).length;
  const unsupportedElementCount = surface.elements.filter((element) => !getHmiElementDefinition(element.typeId) || element.unsupported).length;

  return {
    id: surface.id,
    kind: surface.kind,
    name: surface.name,
    width: surface.width,
    height: surface.height,
    elementCount: surface.elements.length,
    complexity: complexityFor(surface, coverage),
    scaling: scalingFor(surface, project),
    runtimePreviewElementCount,
    modelOnlyElementCount,
    unsupportedElementCount,
    outOfBoundsCount: issues.filter((row) => row.ruleId === "hmi-visual-qa-out-of-bounds").length,
    overlapCount: issues.filter((row) => row.ruleId === "hmi-visual-qa-overlap").length,
    smallTouchTargetCount: issues.filter((row) => row.ruleId === "hmi-visual-qa-small-touch-target").length,
    tinyTextCount: issues.filter((row) => row.ruleId === "hmi-visual-qa-text-fit-risk").length,
    issueCount: issues.length,
    issues,
  };
}

export function hmiVisualQaReport(project: HmiProject): HmiVisualQaReport {
  const surfaceRows = surfaces(project).map((surface) => surfaceVisualQa(project, surface));
  const coverage = mergeCoverage(surfaces(project).map((surface) => coverageFor(project, surface)));
  const allIssues = surfaceRows.flatMap((surface) => surface.issues);
  return {
    targetDeviceName: project.targetDevice.name,
    targetWidth: project.targetDevice.width,
    targetHeight: project.targetDevice.height,
    surfaceCount: surfaceRows.length,
    complexSurfaceCount: surfaceRows.filter((surface) => surface.complexity === "complex").length,
    issueCount: allIssues.length,
    errorCount: allIssues.filter((issueRow) => issueRow.severity === "error").length,
    warningCount: allIssues.filter((issueRow) => issueRow.severity === "warning").length,
    coverage,
    surfaces: surfaceRows,
  };
}
