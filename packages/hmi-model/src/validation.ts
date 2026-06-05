import { getHmiElementDefinition } from "./registry";
import { hmiNavigationModel } from "./navigation";
import { hmiControllerReferenceTagPaths } from "./controller-reference";
import { hmiUsageCapacityReport } from "./usage-capacity";
import { hmiSystemTagDataType, hmiSystemTagPaths } from "./system-tags";
import type {
  HmiBindingSource,
  HmiCommand,
  HmiControllerReferenceSourceKind,
  HmiControllerReferenceSyncStatus,
  HmiElementPropertyDefinition,
  HmiGraphicElement,
  HmiProject,
  HmiSurfaceBase,
  HmiValidationContext,
  HmiValidationFinding,
} from "./types";

function finding(
  ruleId: string,
  severity: HmiValidationFinding["severity"],
  message: string,
  target?: string,
): HmiValidationFinding {
  return { ruleId, severity, message, target };
}

function surfaces(project: HmiProject): HmiSurfaceBase[] {
  return [...project.screens, ...project.popups, project.systemBanner];
}

function knownTargets(project: HmiProject) {
  return {
    screens: new Set(project.screens.map((screen) => screen.id)),
    popups: new Set(project.popups.map((popup) => popup.id)),
    languages: new Set(project.languagePacks.map((language) => language.languageId)),
    dataLogs: new Set(project.dataLogs.map((log) => log.id)),
    recipes: new Set((project.recipes ?? []).map((recipe) => recipe.id)),
  };
}

function knownSet(values: string[] | undefined): Set<string> | undefined {
  return values ? new Set(values) : undefined;
}

function mergeKnownTagPaths(project: HmiProject, context: HmiValidationContext): HmiValidationContext {
  const referenced = hmiControllerReferenceTagPaths(project);
  if (referenced.length === 0) return context;
  return {
    ...context,
    knownTagPaths: [...new Set([...(context.knownTagPaths ?? []), ...referenced])],
  };
}

function stringProperty(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isFiniteNumber(value: number): boolean {
  return Number.isFinite(value);
}

function validateSourcePath(
  source: HmiBindingSource,
  context: HmiValidationContext,
  target: string,
  findings: HmiValidationFinding[],
  rulePrefix: string,
  label: string,
) {
  const path = source.path.trim();
  if (!path) {
    findings.push(finding(`${rulePrefix}-source-required`, "error", `${label} source path is required.`, target));
    return;
  }

  const tags = knownSet(context.knownTagPaths);
  if (source.kind === "tag" && tags && !tags.has(path)) {
    findings.push(finding(`${rulePrefix}-missing-tag`, "error", `${label} references missing tag "${path}".`, target));
  }

  // Default to the built-in system-tag registry so the diagnostic is live even
  // when a caller only supplies controller tags; callers can still override.
  const systemTags = knownSet(context.knownSystemTags ?? hmiSystemTagPaths());
  if (source.kind === "system-tag" && systemTags && !systemTags.has(path)) {
    findings.push(finding(`${rulePrefix}-missing-system-tag`, "error", `${label} references missing system tag "${path}".`, target));
  }
}

function normalizeDataType(dataType: string): string {
  return dataType.trim().replace(/\[.*\]$/, "").toUpperCase();
}

// System-tag sources often carry only the path; fall back to the registry's
// known data type so the binding/animation type-mismatch check still fires.
function effectiveSource(source: HmiBindingSource): HmiBindingSource {
  if (source.kind === "system-tag" && !source.dataType) {
    const dataType = hmiSystemTagDataType(source.path);
    if (dataType) return { ...source, dataType };
  }
  return source;
}

function isCompatibleBindingType(property: HmiElementPropertyDefinition, source: HmiBindingSource): boolean {
  if (!source.dataType) return true;
  const dataType = normalizeDataType(source.dataType);
  if (property.dataType === "boolean") return dataType === "BOOL";
  if (property.dataType === "number") return ["SINT", "INT", "DINT", "LINT", "USINT", "UINT", "UDINT", "ULINT", "REAL", "LREAL"].includes(dataType);
  if (property.dataType === "string" || property.dataType === "color") return dataType === "STRING";
  return true;
}

const COMMON_ELEMENT_PROPERTIES: HmiElementPropertyDefinition[] = [
  { name: "visible", label: "Visible", dataType: "boolean", defaultValue: true, bindable: true },
];

const HMIBC_TAG_PROPERTIES = ["controllerTagPath", "feedbackTagPath", "statusTagPath"] as const;
const CONTROLLER_REFERENCE_SOURCE_KINDS: HmiControllerReferenceSourceKind[] = [
  "plcproj",
  "xml-review",
  "secured-offline-reference",
  "manual",
  "unknown",
];
const CONTROLLER_REFERENCE_SYNC_STATUSES: HmiControllerReferenceSyncStatus[] = [
  "not-imported",
  "synchronizing",
  "synchronized",
  "stale",
  "conflict",
  "error",
  "unsupported-source",
  "secured",
];

function findElementProperty(
  definitionProperties: HmiElementPropertyDefinition[],
  name: string,
): HmiElementPropertyDefinition | undefined {
  return definitionProperties.find((candidate) => candidate.name === name)
    ?? COMMON_ELEMENT_PROPERTIES.find((candidate) => candidate.name === name);
}

function localPropertySource(element: HmiGraphicElement, path: string): string | undefined {
  const trimmed = path.trim();
  if (!trimmed) return undefined;
  const prefixes = ["this.", "self.", `${element.id}.`, `${element.name}.`];
  for (const prefix of prefixes) {
    if (trimmed.startsWith(prefix)) return trimmed.slice(prefix.length).trim() || undefined;
  }
  return trimmed.includes(".") ? undefined : trimmed;
}

function hasPath(graph: Map<string, string[]>, from: string, to: string, seen = new Set<string>()): boolean {
  if (from === to) return true;
  if (seen.has(from)) return false;
  seen.add(from);
  for (const next of graph.get(from) ?? []) {
    if (hasPath(graph, next, to, seen)) return true;
  }
  return false;
}

function isDirectControllerSource(source: HmiBindingSource): boolean {
  return source.kind === "tag" || source.kind === "system-tag";
}

function validateCommand(
  command: HmiCommand,
  project: HmiProject,
  context: HmiValidationContext,
  target: string,
  findings: HmiValidationFinding[],
) {
  const targets = knownTargets(project);
  if (command.type === "navigate") {
    const screenId = command.args.screenId;
    if (typeof screenId !== "string" || !targets.screens.has(screenId)) {
      findings.push(finding("hmi-event-missing-screen", "error", "Navigate command targets a missing screen.", target));
    }
  }
  if (command.type === "open-popup") {
    const popupId = command.args.popupId;
    if (typeof popupId !== "string" || !targets.popups.has(popupId)) {
      findings.push(finding("hmi-event-missing-popup", "error", "Open popup command targets a missing popup.", target));
    }
  }
  if (command.type === "change-language") {
    const languageId = command.args.languageId;
    if (typeof languageId !== "string" || !targets.languages.has(languageId)) {
      findings.push(finding("hmi-event-missing-language", "warning", "Change language command targets a missing language pack.", target));
    }
  }
  if ((command.type === "export-data-log" || command.type === "clear-data-log") && typeof command.args.dataLogId === "string") {
    if (!targets.dataLogs.has(command.args.dataLogId)) {
      findings.push(finding("hmi-event-missing-data-log", "warning", "Data log command targets a missing data log.", target));
    }
  }
  if (command.type === "apply-recipe") {
    const recipeId = command.args.recipeId;
    if (typeof recipeId !== "string" || !targets.recipes.has(recipeId)) {
      findings.push(finding("hmi-event-missing-recipe", "warning", "Recipe command targets a missing recipe.", target));
    }
  }
  if (command.type === "set-tag-value") {
    const tagPath = command.args.tagPath ?? command.args.path ?? command.args.tag;
    if (typeof tagPath !== "string" || !tagPath.trim()) {
      findings.push(finding("hmi-event-tag-required", "error", "Set tag value command requires a tag path.", target));
    } else {
      validateSourcePath({ kind: "tag", path: tagPath }, context, target, findings, "hmi-event", "Set tag value command");
    }
  }
  if (command.safety === "hardware-only") {
    findings.push(finding("hmi-command-model-only", "info", "Hardware command is preserved model-only; no device action will run.", target));
  }
  if (command.safety === "unsupported" || command.type === "unknown") {
    findings.push(finding("hmi-command-unsupported", "warning", "Unknown HMI command is preserved read-only.", target));
  }
}

function validateReusableElementReferences(
  element: HmiGraphicElement,
  surfaceTarget: string,
  findings: HmiValidationFinding[],
) {
  const elementTarget = `${surfaceTarget}/element:${element.id}`;
  const definition = getHmiElementDefinition(element.typeId);
  for (const binding of element.bindings) {
    if (isDirectControllerSource(binding.source)) {
      findings.push(
        finding(
          "hmi-add-on-graphic-direct-binding",
          "error",
          "Reusable Add-On Graphic definitions must bind through user-defined properties, not direct controller or system tag sources.",
          `${elementTarget}/binding:${binding.id}`,
        ),
      );
    }
  }
  if (definition && !element.unsupported) {
    for (const property of definition.properties) {
      if (property.dataType === "tag-path" && stringProperty(element.properties[property.name])) {
        findings.push(
          finding(
            "hmi-add-on-graphic-direct-tag-property",
            "error",
            `Reusable Add-On Graphic property "${property.name}" contains a direct tag path; expose it through the definition property interface.`,
            `${elementTarget}/property:${property.name}`,
          ),
        );
      }
    }
  }
  for (const animation of element.animations) {
    if (isDirectControllerSource(animation.source)) {
      findings.push(
        finding(
          "hmi-add-on-graphic-direct-animation-source",
          "error",
          "Reusable Add-On Graphic animations must use user-defined properties instead of direct controller or system tag sources.",
          `${elementTarget}/animation:${animation.id}`,
        ),
      );
    }
  }
  for (const event of element.events) {
    for (const command of event.commands) {
      if (command.type === "set-tag-value" && stringProperty(command.args.tagPath ?? command.args.path ?? command.args.tag)) {
        findings.push(
          finding(
            "hmi-add-on-graphic-direct-tag-command",
            "error",
            "Reusable Add-On Graphic events must write through exposed properties, not direct controller tag commands.",
            `${elementTarget}/event:${event.id}/command:${command.id}`,
          ),
        );
      }
    }
  }
}

function validateSecurityRoleReferences(
  roleIds: string[],
  knownRoleIds: Set<string>,
  target: string,
  findings: HmiValidationFinding[],
  missingRuleId: string,
  requiredRuleId: string,
  label: string,
) {
  for (const roleId of roleIds) {
    const value = roleId.trim();
    if (!value) {
      findings.push(finding(requiredRuleId, "error", `${label} contains a blank security role reference.`, target));
    } else if (!knownRoleIds.has(value)) {
      findings.push(finding(missingRuleId, "error", `${label} references missing security role "${roleId}".`, target));
    }
  }
}

function validateHmiButtonControl(
  element: HmiGraphicElement,
  context: HmiValidationContext,
  elementTarget: string,
  findings: HmiValidationFinding[],
) {
  if (element.typeId !== "common.hmi-button-control" || element.unsupported) return;

  const controllerTagPath = stringProperty(element.properties.controllerTagPath);
  if (!controllerTagPath) {
    findings.push(
      finding(
        "hmi-hmibc-controller-tag-required",
        "error",
        "HMI Button Control requires a controller tag path.",
        `${elementTarget}/property:controllerTagPath`,
      ),
    );
  }

  const tags = knownSet(context.knownTagPaths);
  if (tags) {
    for (const propertyName of HMIBC_TAG_PROPERTIES) {
      const tagPath = stringProperty(element.properties[propertyName]);
      if (tagPath && !tags.has(tagPath)) {
        findings.push(
          finding(
            "hmi-hmibc-missing-tag",
            "error",
            `HMI Button Control property "${propertyName}" references missing tag "${tagPath}".`,
            `${elementTarget}/property:${propertyName}`,
          ),
        );
      }
    }
  }

  if (
    element.properties.visualFeedbackEnabled !== undefined &&
    typeof element.properties.visualFeedbackEnabled !== "boolean"
  ) {
    findings.push(
      finding(
        "hmi-hmibc-visual-feedback-invalid",
        "error",
        "HMI Button Control visual feedback setting must be boolean.",
        `${elementTarget}/property:visualFeedbackEnabled`,
      ),
    );
  }
}

function validateElement(
  element: HmiGraphicElement,
  project: HmiProject,
  context: HmiValidationContext,
  surfaceTarget: string,
  findings: HmiValidationFinding[],
  surfaceBounds?: { width: number; height: number },
) {
  const elementTarget = `${surfaceTarget}/element:${element.id}`;
  const definition = getHmiElementDefinition(element.typeId);
  if (!element.name.trim()) {
    findings.push(finding("hmi-element-name-required", "error", "Graphic element name is required.", elementTarget));
  }
  if (!definition || element.unsupported) {
    findings.push(finding("hmi-element-unsupported", "warning", `Unsupported HMI element "${element.typeId}" is preserved read-only.`, elementTarget));
  } else if (definition.runtimeSupport === "model-only") {
    findings.push(finding("hmi-element-model-only", "info", `${definition.displayName} is modeled but not simulated yet.`, elementTarget));
  }
  if (!isFiniteNumber(element.geometry.x) || !isFiniteNumber(element.geometry.y)) {
    findings.push(finding("hmi-element-invalid-position", "error", "Graphic element x and y must be finite numbers.", elementTarget));
  }
  if (!isFiniteNumber(element.geometry.width) || !isFiniteNumber(element.geometry.height) || element.geometry.width <= 0 || element.geometry.height <= 0) {
    findings.push(finding("hmi-element-invalid-geometry", "error", "Graphic element width and height must be greater than zero.", elementTarget));
  }
  if (element.geometry.rotation !== undefined && !isFiniteNumber(element.geometry.rotation)) {
    findings.push(finding("hmi-element-invalid-rotation", "error", "Graphic element rotation must be a finite number.", elementTarget));
  }
  if (!Number.isInteger(element.zIndex)) {
    findings.push(finding("hmi-element-invalid-z-index", "error", "Graphic element z-index must be an integer.", elementTarget));
  }
  if (element.visible !== undefined && typeof element.visible !== "boolean") {
    findings.push(finding("hmi-element-visible-invalid", "error", "Graphic element visible flag must be boolean.", elementTarget));
  }
  if (element.locked !== undefined && typeof element.locked !== "boolean") {
    findings.push(finding("hmi-element-locked-invalid", "error", "Graphic element locked flag must be boolean.", elementTarget));
  }
  if (
    surfaceBounds &&
    isFiniteNumber(element.geometry.x) &&
    isFiniteNumber(element.geometry.y) &&
    isFiniteNumber(element.geometry.width) &&
    isFiniteNumber(element.geometry.height) &&
    element.geometry.width > 0 &&
    element.geometry.height > 0 &&
    (element.geometry.x < 0 ||
      element.geometry.y < 0 ||
      element.geometry.x + element.geometry.width > surfaceBounds.width ||
      element.geometry.y + element.geometry.height > surfaceBounds.height)
  ) {
    findings.push(finding("hmi-element-outside-surface", "warning", "Graphic element extends outside its surface bounds.", elementTarget));
  }
  if (element.style) {
    for (const [name, value] of [
      ["fill", element.style.fill],
      ["stroke", element.style.stroke],
      ["textColor", element.style.textColor],
    ] as const) {
      if (value !== undefined && (typeof value !== "string" || !value.trim())) {
        findings.push(finding("hmi-element-style-color-required", "error", `Graphic element style ${name} must be a non-empty color value.`, `${elementTarget}/style:${name}`));
      }
    }
    if (element.style.strokeWidth !== undefined && (!isFiniteNumber(element.style.strokeWidth) || element.style.strokeWidth < 0)) {
      findings.push(finding("hmi-element-style-stroke-width-invalid", "error", "Graphic element stroke width must be zero or greater.", `${elementTarget}/style:strokeWidth`));
    }
    if (element.style.fontSize !== undefined && (!isFiniteNumber(element.style.fontSize) || element.style.fontSize <= 0)) {
      findings.push(finding("hmi-element-style-font-size-invalid", "error", "Graphic element font size must be greater than zero.", `${elementTarget}/style:fontSize`));
    }
    if (element.style.opacity !== undefined && (!isFiniteNumber(element.style.opacity) || element.style.opacity < 0 || element.style.opacity > 1)) {
      findings.push(finding("hmi-element-style-opacity-invalid", "error", "Graphic element style opacity must be between 0 and 1.", `${elementTarget}/style:opacity`));
    }
  }

  const propertyEdges: Array<{ from: string; to: string; target: string }> = [];
  for (const binding of element.bindings) {
    const bindingTarget = `${elementTarget}/binding:${binding.id}`;
    const targetProperty = binding.targetProperty.trim();
    if (!targetProperty) {
      findings.push(finding("hmi-binding-target-required", "error", "Binding target property is required.", bindingTarget));
    } else if (definition && !element.unsupported) {
      const property = findElementProperty(definition.properties, targetProperty);
      if (!property) {
        findings.push(
          finding(
            "hmi-binding-invalid-target",
            "error",
            `Binding targets unknown property "${targetProperty}" on ${definition.displayName}.`,
            bindingTarget,
          ),
        );
      } else if (property.bindable === false) {
        findings.push(
          finding(
            "hmi-binding-nonbindable-target",
            "error",
            `Property "${targetProperty}" on ${definition.displayName} does not support bindings.`,
            bindingTarget,
          ),
        );
      } else if (!isCompatibleBindingType(property, effectiveSource(binding.source))) {
        findings.push(
          finding(
            "hmi-binding-type-mismatch",
            "warning",
            `Binding source data type "${effectiveSource(binding.source).dataType}" may not match ${definition.displayName} property "${targetProperty}" (${property.dataType}).`,
            bindingTarget,
          ),
        );
      }
    }
    if (targetProperty && binding.source.kind === "property" && !element.unsupported) {
      const sourceProperty = localPropertySource(element, binding.source.path);
      if (sourceProperty) {
        propertyEdges.push({ from: targetProperty, to: sourceProperty, target: bindingTarget });
      }
    }
    validateSourcePath(binding.source, context, bindingTarget, findings, "hmi-binding", "Binding");
  }

  if (definition && !element.unsupported) {
    const tags = knownSet(context.knownTagPaths);
    for (const property of definition.properties) {
      const value = stringProperty(element.properties[property.name]);
      if (!value) continue;

      const propertyTarget = `${elementTarget}/property:${property.name}`;
      if (property.dataType === "asset-id") {
        const asset = project.assets.find((candidate) => candidate.id === value);
        if (!asset) {
          findings.push(finding("hmi-property-missing-asset", "error", `Property "${property.name}" references missing asset "${value}".`, propertyTarget));
        } else if (asset.unsupported) {
          findings.push(finding("hmi-property-unsupported-asset", "warning", `Property "${property.name}" references unsupported asset "${asset.name}".`, propertyTarget));
        }
      }
      if (property.dataType === "screen-id" && !project.screens.some((screen) => screen.id === value)) {
        findings.push(finding("hmi-property-missing-screen", "error", `Property "${property.name}" references missing screen "${value}".`, propertyTarget));
      }
      if (property.dataType === "tag-path" && tags && !tags.has(value)) {
        findings.push(finding("hmi-property-missing-tag", "error", `Property "${property.name}" references missing tag "${value}".`, propertyTarget));
      }
    }
  }
  validateHmiButtonControl(element, context, elementTarget, findings);

  for (const animation of element.animations) {
    const animationTarget = `${elementTarget}/animation:${animation.id}`;
    const targetProperty = animation.targetProperty.trim();
    let property: HmiElementPropertyDefinition | undefined;
    if (!targetProperty) {
      findings.push(finding("hmi-animation-target-required", "error", "Animation target property is required.", animationTarget));
    } else if (definition && !element.unsupported) {
      property = findElementProperty(definition.properties, targetProperty);
      if (!property) {
        findings.push(
          finding(
            "hmi-animation-invalid-target",
            "error",
            `Animation targets unknown property "${targetProperty}" on ${definition.displayName}.`,
            animationTarget,
          ),
        );
      } else if (!isCompatibleBindingType(property, effectiveSource(animation.source))) {
        findings.push(
          finding(
            "hmi-animation-type-mismatch",
            "warning",
            `Animation source data type "${effectiveSource(animation.source).dataType}" may not match ${definition.displayName} property "${targetProperty}" (${property.dataType}).`,
            animationTarget,
          ),
        );
      }
    }
    validateSourcePath(animation.source, context, animationTarget, findings, "hmi-animation", "Animation");

    const seenStates = new Set<string>();
    const validateStateValue = (value: string | number | boolean, target: string) => {
      const stateKey = `${typeof value}:${String(value)}`;
      if (seenStates.has(stateKey)) {
        findings.push(finding("hmi-animation-duplicate-state", "warning", `Animation repeats state value "${String(value)}".`, target));
      }
      seenStates.add(stateKey);
    };

    if (animation.table.kind === "color") {
      const states = animation.table.states;
      if (states.length === 0) {
        findings.push(finding("hmi-animation-empty-table", "warning", "Animation state table has no states.", animationTarget));
      }
      states.forEach((state, index) => {
        const stateTarget = `${animationTarget}/state:${index}`;
        validateStateValue(state.value, stateTarget);
        if (typeof state.color !== "string" || !state.color.trim()) {
          findings.push(finding("hmi-animation-color-required", "error", "Color animation state requires a color.", stateTarget));
        }
      });
    } else {
      const states = animation.table.states;
      if (states.length === 0) {
        findings.push(finding("hmi-animation-empty-table", "warning", "Animation state table has no states.", animationTarget));
      }
      states.forEach((state, index) => {
        const stateTarget = `${animationTarget}/state:${index}`;
        validateStateValue(state.value, stateTarget);
        if (typeof state.state !== "string" || !state.state.trim()) {
          findings.push(finding("hmi-animation-state-required", "error", "State animation entry requires a target state name.", stateTarget));
        }
      });
    }
  }

  if (propertyEdges.length > 0) {
    const graph = new Map<string, string[]>();
    for (const edge of propertyEdges) {
      graph.set(edge.from, [...(graph.get(edge.from) ?? []), edge.to]);
    }
    for (const edge of propertyEdges) {
      if (hasPath(graph, edge.to, edge.from)) {
        findings.push(
          finding(
            "hmi-binding-circular-property",
            "error",
            `Property binding creates a circular dependency between "${edge.from}" and "${edge.to}".`,
            edge.target,
          ),
        );
      }
    }
  }

  for (const event of element.events) {
    if (event.commands.length === 0) {
      findings.push(finding("hmi-event-empty", "warning", "Event handler has no commands.", `${elementTarget}/event:${event.id}`));
    }
    for (const command of event.commands) {
      validateCommand(command, project, context, `${elementTarget}/event:${event.id}/command:${command.id}`, findings);
    }
  }
}

function controllerReferenceStatusRule(status: HmiControllerReferenceSyncStatus): string {
  return `hmi-controller-reference-${status.replace(/[^a-z0-9]+/g, "-")}`;
}

function controllerReferenceStatusSeverity(status: HmiControllerReferenceSyncStatus): HmiValidationFinding["severity"] {
  if (status === "conflict" || status === "error") return "error";
  if (status === "synchronizing" || status === "synchronized") return "info";
  return "warning";
}

function validateControllerReferences(project: HmiProject, findings: HmiValidationFinding[]) {
  const references = Array.isArray(project.controllerReferences) ? project.controllerReferences : [];
  const ids = new Set<string>();
  const names = new Set<string>();

  for (const reference of references) {
    const target = `hmi/controller-reference:${reference.id || "(blank)"}`;
    const id = reference.id?.trim();
    const name = reference.name?.trim();
    const controllerName = reference.controllerName?.trim();

    if (!id) {
      findings.push(finding("hmi-controller-reference-id-required", "error", "Controller reference id is required.", target));
    } else if (ids.has(id)) {
      findings.push(finding("hmi-controller-reference-id-duplicate", "error", `Duplicate controller reference id "${reference.id}".`, target));
    }
    if (!name) {
      findings.push(finding("hmi-controller-reference-name-required", "error", "Controller reference name is required.", target));
    } else if (names.has(name.toLowerCase())) {
      findings.push(finding("hmi-controller-reference-name-duplicate", "warning", `Duplicate controller reference name "${reference.name}".`, target));
    }
    if (!controllerName) {
      findings.push(finding("hmi-controller-reference-controller-name-required", "warning", "Controller reference should identify the source controller.", target));
    }
    if (!CONTROLLER_REFERENCE_SOURCE_KINDS.includes(reference.sourceKind)) {
      findings.push(finding("hmi-controller-reference-source-kind-invalid", "error", `Controller reference "${reference.name}" has an unsupported source kind.`, target));
    }
    if (!CONTROLLER_REFERENCE_SYNC_STATUSES.includes(reference.syncStatus)) {
      findings.push(finding("hmi-controller-reference-sync-status-invalid", "error", `Controller reference "${reference.name}" has an unsupported synchronization status.`, target));
    } else if (reference.syncStatus !== "synchronized") {
      findings.push(
        finding(
          controllerReferenceStatusRule(reference.syncStatus),
          controllerReferenceStatusSeverity(reference.syncStatus),
          `Controller reference "${reference.name}" is ${reference.syncStatus.replace(/-/g, " ")}${reference.statusMessage ? `: ${reference.statusMessage}` : "."}`,
          target,
        ),
      );
    } else if (!reference.lastSyncedAt) {
      findings.push(finding("hmi-controller-reference-sync-time-missing", "warning", `Controller reference "${reference.name}" is synchronized but has no last sync timestamp.`, target));
    }
    if (reference.sourceKind === "secured-offline-reference" && reference.syncStatus !== "secured") {
      findings.push(finding("hmi-controller-reference-secured-status", "warning", `Secured controller reference "${reference.name}" should remain in secured review state until imported metadata is provided.`, target));
    }
    if (reference.secured && (reference.tags.length > 0 || reference.dataTypes.length > 0 || reference.alarms.length > 0)) {
      findings.push(finding("hmi-controller-reference-secured-snapshot", "warning", `Secured controller reference "${reference.name}" should not expose decrypted tag, data type, or alarm snapshots.`, target));
    }

    const tagPaths = new Set<string>();
    for (const tag of reference.tags) {
      const tagTarget = `${target}/tag:${tag.path || "(blank)"}`;
      const path = tag.path?.trim();
      if (!path) {
        findings.push(finding("hmi-controller-reference-tag-path-required", "error", "Controller reference tag path is required.", tagTarget));
      } else if (tagPaths.has(path.toLowerCase())) {
        findings.push(finding("hmi-controller-reference-tag-path-duplicate", "warning", `Duplicate controller reference tag path "${tag.path}".`, tagTarget));
      }
      if (!tag.name?.trim()) {
        findings.push(finding("hmi-controller-reference-tag-name-required", "error", "Controller reference tag name is required.", tagTarget));
      }
      if (!tag.dataType?.trim()) {
        findings.push(finding("hmi-controller-reference-tag-data-type-required", "error", `Controller reference tag "${tag.path}" needs a data type.`, tagTarget));
      }
      if (tag.scope !== "controller" && tag.scope !== "program") {
        findings.push(finding("hmi-controller-reference-tag-scope-invalid", "error", `Controller reference tag "${tag.path}" has an invalid scope.`, tagTarget));
      }
      if (path) tagPaths.add(path.toLowerCase());
    }

    const dataTypeNames = new Set<string>();
    for (const dataType of reference.dataTypes) {
      const dataTypeTarget = `${target}/data-type:${dataType.name || "(blank)"}`;
      const dataTypeName = dataType.name?.trim();
      if (!dataTypeName) {
        findings.push(finding("hmi-controller-reference-data-type-name-required", "error", "Controller reference data type name is required.", dataTypeTarget));
      } else if (dataTypeNames.has(dataTypeName.toLowerCase())) {
        findings.push(finding("hmi-controller-reference-data-type-name-duplicate", "warning", `Duplicate controller reference data type "${dataType.name}".`, dataTypeTarget));
      }
      if (dataType.memberCount !== undefined && (!Number.isFinite(dataType.memberCount) || dataType.memberCount < 0)) {
        findings.push(finding("hmi-controller-reference-data-type-member-count-invalid", "error", `Controller reference data type "${dataType.name}" has an invalid member count.`, dataTypeTarget));
      }
      if (dataTypeName) dataTypeNames.add(dataTypeName.toLowerCase());
    }

    for (const alarm of reference.alarms) {
      const alarmTarget = `${target}/alarm:${alarm.tagPath || "(blank)"}`;
      if (!alarm.name?.trim()) {
        findings.push(finding("hmi-controller-reference-alarm-name-required", "error", "Controller reference alarm name is required.", alarmTarget));
      }
      if (!alarm.tagPath?.trim()) {
        findings.push(finding("hmi-controller-reference-alarm-tag-path-required", "error", "Controller reference alarm tag path is required.", alarmTarget));
      }
      if (!alarm.dataType?.trim()) {
        findings.push(finding("hmi-controller-reference-alarm-data-type-required", "error", `Controller reference alarm "${alarm.name}" needs a data type.`, alarmTarget));
      }
    }

    if (reference.snapshot.controllerTagCount !== reference.tags.filter((tag) => tag.scope === "controller").length) {
      findings.push(finding("hmi-controller-reference-controller-tag-count-mismatch", "warning", `Controller reference "${reference.name}" controller-tag snapshot count does not match its tag browser rows.`, `${target}/snapshot`));
    }
    if (reference.snapshot.programTagCount !== reference.tags.filter((tag) => tag.scope === "program").length) {
      findings.push(finding("hmi-controller-reference-program-tag-count-mismatch", "warning", `Controller reference "${reference.name}" program-tag snapshot count does not match its tag browser rows.`, `${target}/snapshot`));
    }
    if (reference.snapshot.dataTypeCount !== reference.dataTypes.length) {
      findings.push(finding("hmi-controller-reference-data-type-count-mismatch", "warning", `Controller reference "${reference.name}" data-type snapshot count does not match its browser rows.`, `${target}/snapshot`));
    }
    if (reference.snapshot.alarmCount !== reference.alarms.length) {
      findings.push(finding("hmi-controller-reference-alarm-count-mismatch", "warning", `Controller reference "${reference.name}" alarm snapshot count does not match its browser rows.`, `${target}/snapshot`));
    }

    if (id) ids.add(id);
    if (name) names.add(name.toLowerCase());
  }
}

export function validateHmiProject(
  project: HmiProject | undefined,
  context: HmiValidationContext = {},
): HmiValidationFinding[] {
  if (!project) {
    return [finding("hmi-project-missing", "info", "No HMI project is configured.")];
  }

  const findings: HmiValidationFinding[] = [];
  const effectiveContext = mergeKnownTagPaths(project, context);
  const recipes = project.recipes ?? [];
  if (!project.name.trim()) {
    findings.push(finding("hmi-project-name-required", "error", "HMI project name is required.", "hmi"));
  }
  if (project.targetDevice.width <= 0 || project.targetDevice.height <= 0) {
    findings.push(finding("hmi-device-invalid-size", "error", "Target HMI device must have a valid display size.", "hmi/device"));
  }
  if (
    project.targetDevice.capacity.maxScreens <= 0 ||
    project.targetDevice.capacity.maxElementsPerScreen <= 0 ||
    project.targetDevice.capacity.maxTrends < 0 ||
    project.targetDevice.capacity.maxDataLogs < 0 ||
    (project.targetDevice.capacity.maxRecipes ?? 0) < 0 ||
    project.targetDevice.capacity.storageMb <= 0
  ) {
    findings.push(finding("hmi-device-invalid-capacity", "error", "Target HMI device capacity limits must be valid.", "hmi/device/capacity"));
  }
  if (project.screens.length > project.targetDevice.capacity.maxScreens) {
    findings.push(
      finding(
        "hmi-device-screen-capacity-exceeded",
        "error",
        `HMI project has ${project.screens.length} screen(s), exceeding target device capacity ${project.targetDevice.capacity.maxScreens}.`,
        "hmi/screens",
      ),
    );
  }
  if (project.trends.length > project.targetDevice.capacity.maxTrends) {
    findings.push(
      finding(
        "hmi-device-trend-capacity-exceeded",
        "error",
        `HMI project has ${project.trends.length} trend(s), exceeding target device capacity ${project.targetDevice.capacity.maxTrends}.`,
        "hmi/trends",
      ),
    );
  }
  if (project.dataLogs.length > project.targetDevice.capacity.maxDataLogs) {
    findings.push(
      finding(
        "hmi-device-data-log-capacity-exceeded",
        "error",
        `HMI project has ${project.dataLogs.length} data log(s), exceeding target device capacity ${project.targetDevice.capacity.maxDataLogs}.`,
        "hmi/dataLogs",
      ),
    );
  }
  if (recipes.length > (project.targetDevice.capacity.maxRecipes ?? 0)) {
    findings.push(
      finding(
        "hmi-device-recipe-capacity-exceeded",
        "error",
        `HMI project has ${recipes.length} recipe(s), exceeding target device capacity ${project.targetDevice.capacity.maxRecipes ?? 0}.`,
        "hmi/recipes",
      ),
    );
  }
  const usageCapacity = hmiUsageCapacityReport(project);
  const storageMetric = usageCapacity.metrics.find((item) => item.key === "storage");
  if (storageMetric?.status === "exceeded") {
    findings.push(
      finding(
        "hmi-device-storage-capacity-exceeded",
        "error",
        `Estimated HMI storage requires ${usageCapacity.estimatedStorageBytes} byte(s), exceeding target device storage capacity ${usageCapacity.targetDevice.storageBytes} byte(s).`,
        "hmi/assets",
      ),
    );
  }
  if (usageCapacity.scalingRiskCount > 0) {
    findings.push(
      finding(
        "hmi-screen-raster-scaling-risk",
        "warning",
        `Scaled HMI surfaces contain ${usageCapacity.scalingRiskCount} raster image reference(s) that may lose clarity on the target device.`,
        "hmi/device/scaling",
      ),
    );
  }
  if (project.screens.length === 0) {
    findings.push(finding("hmi-no-screens", "info", "No HMI screens have been created yet.", "hmi/screens"));
  }
  if (project.homeScreenId && !project.screens.some((screen) => screen.id === project.homeScreenId)) {
    findings.push(finding("hmi-home-screen-missing", "error", "Home screen points to a missing screen.", "hmi/homeScreenId"));
  }
  if (!project.homeScreenId && project.screens.length > 0) {
    findings.push(finding("hmi-home-screen-unset", "warning", "HMI project has screens but no home screen is selected.", "hmi/homeScreenId"));
  }
  const navigation = hmiNavigationModel(project);
  for (const deadEndId of navigation.deadEndScreenIds) {
    const deadEnd = project.screens.find((screen) => screen.id === deadEndId);
    if (!deadEnd) continue;
    findings.push(
      finding(
        "hmi-screen-unreachable",
        "warning",
        `Screen "${deadEnd.name}" is omitted from navigation and is not the home screen or any shortcut target, so operators cannot reach it.`,
        `hmi/screen:${deadEnd.id}/navigation`,
      ),
    );
  }
  validateControllerReferences(project, findings);

  const assetIds = new Set<string>();
  const assetNames = new Set<string>();
  for (const asset of project.assets) {
    const assetTarget = `hmi/asset:${asset.id}`;
    const assetId = asset.id.trim();
    const assetName = asset.name.trim();
    if (!assetId) {
      findings.push(finding("hmi-asset-id-required", "error", "Asset id is required.", assetTarget));
    } else if (assetIds.has(assetId)) {
      findings.push(finding("hmi-asset-id-duplicate", "error", `Duplicate asset id "${asset.id}".`, assetTarget));
    }
    if (!assetName) {
      findings.push(finding("hmi-asset-name-required", "error", "Asset name is required.", assetTarget));
    } else if (assetNames.has(assetName.toLowerCase())) {
      findings.push(finding("hmi-asset-name-duplicate", "warning", `Duplicate asset name "${asset.name}".`, assetTarget));
    }
    if (asset.unsupported) {
      findings.push(finding("hmi-asset-unsupported", "warning", `Unsupported asset "${asset.name}" is preserved read-only.`, assetTarget));
    }
    if (asset.bytes !== undefined && (!Number.isFinite(asset.bytes) || asset.bytes < 0)) {
      findings.push(finding("hmi-asset-invalid-size", "error", `Asset "${asset.name}" must have a valid byte size.`, assetTarget));
    }
    if (assetId) assetIds.add(assetId);
    if (assetName) assetNames.add(assetName.toLowerCase());
  }

  const securityRoleIds = new Set<string>();
  const securityRoleNames = new Set<string>();
  if (project.security.roles.length === 0) {
    findings.push(finding("hmi-security-no-roles", "warning", "HMI security has no roles configured.", "hmi/security/roles"));
  }
  for (const role of project.security.roles) {
    const roleTarget = `hmi/security/role:${role.id}`;
    const roleId = role.id.trim();
    const roleName = role.name.trim();
    if (!roleId) {
      findings.push(finding("hmi-security-role-id-required", "error", "Security role id is required.", roleTarget));
    } else if (securityRoleIds.has(roleId)) {
      findings.push(finding("hmi-security-role-id-duplicate", "error", `Duplicate security role id "${role.id}".`, roleTarget));
    }
    if (!roleName) {
      findings.push(finding("hmi-security-role-name-required", "error", "Security role name is required.", roleTarget));
    } else if (securityRoleNames.has(roleName.toLowerCase())) {
      findings.push(finding("hmi-security-role-name-duplicate", "error", `Duplicate security role name "${role.name}".`, roleTarget));
    }
    if (role.permissions.some((permission) => !permission.trim())) {
      findings.push(finding("hmi-security-permission-required", "warning", `Security role "${role.name}" contains a blank permission.`, roleTarget));
    }
    if (roleId) securityRoleIds.add(roleId);
    if (roleName) securityRoleNames.add(roleName.toLowerCase());
  }

  const guestRoleId = project.security.guestRoleId?.trim();
  if (guestRoleId && !securityRoleIds.has(guestRoleId)) {
    findings.push(finding("hmi-security-guest-role-missing", "error", `Guest role "${project.security.guestRoleId}" is not configured.`, "hmi/security/guestRoleId"));
  } else if (!guestRoleId) {
    findings.push(finding("hmi-security-guest-role-unset", "warning", "HMI security has no guest role configured.", "hmi/security/guestRoleId"));
  }
  if (project.security.autoLogoffSeconds < 0) {
    findings.push(finding("hmi-security-auto-logoff-invalid", "error", "Auto-logoff seconds must be zero or greater.", "hmi/security/autoLogoffSeconds"));
  }
  if (project.security.passwordPolicy.minimumLength < 1) {
    findings.push(finding("hmi-security-password-invalid", "error", "Password minimum length must be at least one character.", "hmi/security/passwordPolicy"));
  } else if (project.security.passwordPolicy.minimumLength < 8) {
    findings.push(finding("hmi-security-password-too-short", "warning", "Password minimum length is shorter than the ESCO recommended minimum.", "hmi/security/passwordPolicy"));
  }
  if (!project.security.passwordPolicy.requireComplexity) {
    findings.push(finding("hmi-security-password-complexity-off", "warning", "Password complexity is disabled.", "hmi/security/passwordPolicy"));
  }

  const securityUserNames = new Set<string>();
  for (const user of project.security.users) {
    const userTarget = `hmi/security/user:${user.username}`;
    const username = user.username.trim();
    if (!username) {
      findings.push(finding("hmi-security-user-name-required", "error", "Security user name is required.", userTarget));
    } else if (securityUserNames.has(username.toLowerCase())) {
      findings.push(finding("hmi-security-user-name-duplicate", "error", `Duplicate security user "${user.username}".`, userTarget));
    }
    if (user.roleIds.length === 0) {
      findings.push(finding("hmi-security-user-no-roles", "warning", `Security user "${user.username}" has no roles.`, userTarget));
    }
    validateSecurityRoleReferences(
      user.roleIds,
      securityRoleIds,
      userTarget,
      findings,
      "hmi-security-user-missing-role",
      "hmi-security-user-role-required",
      `Security user "${user.username}"`,
    );
    if (username) securityUserNames.add(username.toLowerCase());
  }

  const defaultLanguage = project.defaultLanguage.trim();
  if (!defaultLanguage) {
    findings.push(finding("hmi-default-language-required", "error", "HMI project default language is required.", "hmi/defaultLanguage"));
  }
  if (project.languagePacks.length === 0) {
    findings.push(finding("hmi-language-pack-required", "error", "At least one HMI language pack is required.", "hmi/languagePacks"));
  }
  const languageIds = new Set<string>();
  for (const language of project.languagePacks) {
    const languageTarget = `hmi/language:${language.id}`;
    const languageId = language.languageId.trim();
    if (!languageId) {
      findings.push(finding("hmi-language-id-required", "error", "Language pack id is required.", languageTarget));
    } else if (languageIds.has(languageId.toLowerCase())) {
      findings.push(finding("hmi-language-id-duplicate", "error", `Duplicate language pack "${language.languageId}".`, languageTarget));
    }
    if (!language.displayName.trim()) {
      findings.push(finding("hmi-language-name-required", "error", "Language pack display name is required.", languageTarget));
    }
    if (language.missingStringIds.length > 0) {
      findings.push(
        finding(
          "hmi-language-missing-strings",
          "warning",
          `Language pack "${language.languageId}" is missing ${language.missingStringIds.length} string(s).`,
          languageTarget,
        ),
      );
    }
    if (languageId) languageIds.add(languageId.toLowerCase());
  }
  if (defaultLanguage && project.languagePacks.length > 0 && !languageIds.has(defaultLanguage.toLowerCase())) {
    findings.push(finding("hmi-default-language-missing", "error", `Default language "${project.defaultLanguage}" has no language pack.`, "hmi/defaultLanguage"));
  }

  const screenNames = new Set<string>();
  for (const screen of project.screens) {
    if (!screen.name.trim()) {
      findings.push(finding("hmi-screen-name-required", "error", "Screen name is required.", `hmi/screen:${screen.id}`));
    }
    if (screenNames.has(screen.name.toLowerCase())) {
      findings.push(finding("hmi-screen-name-duplicate", "error", `Duplicate screen name "${screen.name}".`, `hmi/screen:${screen.id}`));
    }
    if (screen.navigation?.includeInMenu && !screen.navigation.caption?.trim()) {
      findings.push(finding("hmi-screen-navigation-caption-required", "error", `Screen "${screen.name}" is included in navigation but has no caption.`, `hmi/screen:${screen.id}/navigation`));
    }
    if (screen.navigation?.icon !== undefined && !screen.navigation.icon.trim()) {
      findings.push(finding("hmi-screen-navigation-icon-empty", "warning", `Screen "${screen.name}" has an empty navigation icon.`, `hmi/screen:${screen.id}/navigation`));
    }
    screenNames.add(screen.name.toLowerCase());
  }

  const popupNames = new Set<string>();
  for (const popup of project.popups) {
    const popupTarget = `hmi/popup:${popup.id}`;
    const popupName = popup.name.trim();
    if (!popupName) {
      findings.push(finding("hmi-popup-name-required", "error", "Popup name is required.", popupTarget));
    } else if (popupNames.has(popupName.toLowerCase())) {
      findings.push(finding("hmi-popup-name-duplicate", "error", `Duplicate popup name "${popup.name}".`, popupTarget));
    }
    if (typeof popup.showCloseButton !== "boolean") {
      findings.push(finding("hmi-popup-close-button-invalid", "error", `Popup "${popup.name}" close button setting must be boolean.`, popupTarget));
    }
    if (popup.opacity < 0 || popup.opacity > 1 || !Number.isFinite(popup.opacity)) {
      findings.push(finding("hmi-popup-invalid-opacity", "error", `Popup "${popup.name}" opacity must be between 0 and 1.`, popupTarget));
    }
    if (popup.cachePolicy !== "none" && popup.cachePolicy !== "preload") {
      findings.push(finding("hmi-popup-invalid-cache-policy", "error", `Popup "${popup.name}" has an invalid cache policy.`, popupTarget));
    }
    if (popupName) popupNames.add(popupName.toLowerCase());
  }

  if (project.systemBanner.dock !== "top" && project.systemBanner.dock !== "bottom") {
    findings.push(finding("hmi-system-banner-invalid-dock", "error", "System banner dock must be top or bottom.", `hmi/system-banner:${project.systemBanner.id}`));
  }
  if (typeof project.systemBanner.restoreDefaultAvailable !== "boolean") {
    findings.push(finding("hmi-system-banner-restore-invalid", "error", "System banner restore-default setting must be boolean.", `hmi/system-banner:${project.systemBanner.id}`));
  }

  const addOnGraphicIds = new Set<string>();
  const addOnGraphicNames = new Set<string>();
  for (const addOnGraphic of project.addOnGraphics) {
    const graphicTarget = `hmi/add-on-graphic:${addOnGraphic.id}`;
    const graphicId = addOnGraphic.id.trim();
    const graphicName = addOnGraphic.name.trim();
    if (!graphicId) {
      findings.push(finding("hmi-add-on-graphic-id-required", "error", "Add-On Graphic id is required.", graphicTarget));
    } else if (addOnGraphicIds.has(graphicId)) {
      findings.push(finding("hmi-add-on-graphic-id-duplicate", "error", `Duplicate Add-On Graphic id "${addOnGraphic.id}".`, graphicTarget));
    }
    if (!graphicName) {
      findings.push(finding("hmi-add-on-graphic-name-required", "error", "Add-On Graphic name is required.", graphicTarget));
    } else if (addOnGraphicNames.has(graphicName.toLowerCase())) {
      findings.push(finding("hmi-add-on-graphic-name-duplicate", "error", `Duplicate Add-On Graphic name "${addOnGraphic.name}".`, graphicTarget));
    }
    if (addOnGraphic.width <= 0 || addOnGraphic.height <= 0) {
      findings.push(finding("hmi-add-on-graphic-invalid-size", "error", "Add-On Graphic width and height must be greater than zero.", graphicTarget));
    }
    if (addOnGraphic.unsupported) {
      findings.push(finding("hmi-add-on-graphic-unsupported", "warning", `Unsupported Add-On Graphic "${addOnGraphic.name}" is preserved read-only.`, graphicTarget));
    }
    if (addOnGraphic.elements.length === 0) {
      findings.push(finding("hmi-add-on-graphic-empty", "warning", `Add-On Graphic "${addOnGraphic.name}" has no elements.`, graphicTarget));
    }

    const propertyNames = new Set<string>();
    for (const property of addOnGraphic.properties) {
      const propertyTarget = `${graphicTarget}/property:${property.name}`;
      const propertyName = property.name.trim();
      if (!propertyName) {
        findings.push(finding("hmi-add-on-graphic-property-name-required", "error", "Add-On Graphic property name is required.", propertyTarget));
      } else if (propertyNames.has(propertyName.toLowerCase())) {
        findings.push(finding("hmi-add-on-graphic-property-name-duplicate", "error", `Duplicate Add-On Graphic property "${property.name}".`, propertyTarget));
      }
      if (!property.dataType.trim()) {
        findings.push(finding("hmi-add-on-graphic-property-type-required", "error", `Add-On Graphic property "${property.name}" requires a data type.`, propertyTarget));
      }
      if (propertyName) propertyNames.add(propertyName.toLowerCase());
    }

    for (const element of addOnGraphic.elements) {
      validateElement(element, project, effectiveContext, graphicTarget, findings, { width: addOnGraphic.width, height: addOnGraphic.height });
      validateReusableElementReferences(element, graphicTarget, findings);
    }
    if (graphicId) addOnGraphicIds.add(graphicId);
    if (graphicName) addOnGraphicNames.add(graphicName.toLowerCase());
  }

  for (const surface of surfaces(project)) {
    const surfaceTarget = `hmi/${surface.kind}:${surface.id}`;
    if (surface.width <= 0 || surface.height <= 0) {
      findings.push(finding("hmi-surface-invalid-size", "error", "HMI surface width and height must be greater than zero.", surfaceTarget));
    }
    if (surface.updateRateMs <= 0) {
      findings.push(finding("hmi-surface-invalid-update-rate", "error", "HMI surface update rate must be greater than zero.", surfaceTarget));
    }
    if (surface.kind === "screen" && (surface.width !== project.targetDevice.width || surface.height !== project.targetDevice.height)) {
      findings.push(
        finding(
          "hmi-screen-device-size-mismatch",
          "warning",
          `Screen "${surface.name}" size does not match target device display size.`,
          surfaceTarget,
        ),
      );
    }
    if (surface.kind === "popup" && (surface.width > project.targetDevice.width || surface.height > project.targetDevice.height)) {
      findings.push(
        finding(
          "hmi-popup-device-size-exceeded",
          "error",
          `Popup "${surface.name}" is larger than the target device display.`,
          surfaceTarget,
        ),
      );
    }
    if (surface.kind === "system-banner" && surface.width !== project.targetDevice.width) {
      findings.push(finding("hmi-system-banner-device-width-mismatch", "warning", "System banner width does not match the target device display.", surfaceTarget));
    }
    if (surface.elements.length > project.targetDevice.capacity.maxElementsPerScreen) {
      findings.push(
        finding(
          "hmi-device-element-capacity-exceeded",
          "error",
          `HMI ${surface.kind} "${surface.name}" has ${surface.elements.length} element(s), exceeding target device capacity ${project.targetDevice.capacity.maxElementsPerScreen}.`,
          `${surfaceTarget}/elements`,
        ),
      );
    }
    validateSecurityRoleReferences(
      surface.securityRoleIds,
      securityRoleIds,
      `${surfaceTarget}/security`,
      findings,
      "hmi-surface-security-role-missing",
      "hmi-surface-security-role-required",
      `HMI ${surface.kind} "${surface.name}"`,
    );
    for (const element of surface.elements) {
      validateElement(element, project, effectiveContext, surfaceTarget, findings, { width: surface.width, height: surface.height });
    }
  }

  const shortcutIds = new Set<string>();
  const shortcutNames = new Set<string>();
  for (const shortcut of project.shortcuts) {
    const shortcutTarget = `hmi/shortcut:${shortcut.id}`;
    const shortcutId = shortcut.id.trim();
    const shortcutName = shortcut.name.trim();
    if (!shortcutId) {
      findings.push(finding("hmi-shortcut-id-required", "error", "Shortcut id is required.", shortcutTarget));
    } else if (shortcutIds.has(shortcutId)) {
      findings.push(finding("hmi-shortcut-id-duplicate", "error", `Duplicate shortcut id "${shortcut.id}".`, shortcutTarget));
    }
    if (!shortcutName) {
      findings.push(finding("hmi-shortcut-name-required", "error", "Shortcut name is required.", shortcutTarget));
    } else if (shortcutNames.has(shortcutName.toLowerCase())) {
      findings.push(finding("hmi-shortcut-name-duplicate", "error", `Duplicate shortcut name "${shortcut.name}".`, shortcutTarget));
    }
    if (!shortcut.caption.trim()) {
      findings.push(finding("hmi-shortcut-caption-required", "error", `Shortcut "${shortcut.name}" requires a caption.`, shortcutTarget));
    }
    if (shortcut.icon !== undefined && !shortcut.icon.trim()) {
      findings.push(finding("hmi-shortcut-icon-empty", "warning", `Shortcut "${shortcut.name}" has an empty icon.`, shortcutTarget));
    }
    if (shortcut.folder !== undefined && !shortcut.folder.trim()) {
      findings.push(finding("hmi-shortcut-folder-empty", "warning", `Shortcut "${shortcut.name}" has an empty folder.`, shortcutTarget));
    }
    validateSecurityRoleReferences(
      shortcut.securityRoleIds,
      securityRoleIds,
      `hmi/shortcut:${shortcut.id}/security`,
      findings,
      "hmi-shortcut-security-role-missing",
      "hmi-shortcut-security-role-required",
      `Shortcut "${shortcut.name}"`,
    );
    const valid =
      shortcut.targetKind === "screen"
        ? project.screens.some((screen) => screen.id === shortcut.targetId)
        : project.popups.some((popup) => popup.id === shortcut.targetId);
    if (!valid) {
      findings.push(finding("hmi-shortcut-target-missing", "error", `Shortcut "${shortcut.name}" targets missing content.`, shortcutTarget));
    }
    if (shortcutId) shortcutIds.add(shortcutId);
    if (shortcutName) shortcutNames.add(shortcutName.toLowerCase());
  }

  const alarmViewIds = new Set<string>();
  const alarmViewNames = new Set<string>();
  const alarmIds = new Set<string>();
  const alarmNames = new Set<string>();
  const knownAlarmTags = knownSet(effectiveContext.knownTagPaths);
  for (const alarm of project.alarms ?? []) {
    const alarmTarget = `hmi/alarm:${alarm.id}`;
    const alarmId = alarm.id.trim();
    const alarmName = alarm.name.trim();
    if (!alarmId) {
      findings.push(finding("hmi-alarm-id-required", "error", "Alarm id is required.", alarmTarget));
    } else if (alarmIds.has(alarmId)) {
      findings.push(finding("hmi-alarm-id-duplicate", "error", `Duplicate alarm id "${alarm.id}".`, alarmTarget));
    }
    if (!alarmName) {
      findings.push(finding("hmi-alarm-name-required", "error", "Alarm name is required.", alarmTarget));
    } else if (alarmNames.has(alarmName.toLowerCase())) {
      findings.push(finding("hmi-alarm-name-duplicate", "error", `Duplicate alarm name "${alarm.name}".`, alarmTarget));
    }
    if (!alarm.tagPath.trim()) {
      findings.push(finding("hmi-alarm-tag-required", "error", `Alarm "${alarm.name}" requires a tag path.`, `${alarmTarget}/tagPath`));
    } else if (knownAlarmTags && !knownAlarmTags.has(alarm.tagPath)) {
      findings.push(finding("hmi-alarm-missing-tag", "error", `Alarm "${alarm.name}" references missing tag "${alarm.tagPath}".`, `${alarmTarget}/tagPath`));
    }
    if (!["info", "warning", "minor", "major", "critical"].includes(alarm.severity)) {
      findings.push(finding("hmi-alarm-invalid-severity", "error", `Alarm "${alarm.name}" has an invalid severity.`, `${alarmTarget}/severity`));
    }
    if (!["digital", "analog-high", "analog-low"].includes(alarm.trigger.kind)) {
      findings.push(finding("hmi-alarm-invalid-trigger", "error", `Alarm "${alarm.name}" has an invalid trigger kind.`, `${alarmTarget}/trigger`));
    }
    if (alarm.trigger.kind !== "digital" && !Number.isFinite(alarm.trigger.threshold)) {
      findings.push(finding("hmi-alarm-threshold-required", "error", `Alarm "${alarm.name}" analog trigger requires a finite threshold.`, `${alarmTarget}/trigger/threshold`));
    }
    if (alarm.trigger.deadband !== undefined && (!Number.isFinite(alarm.trigger.deadband) || alarm.trigger.deadband < 0)) {
      findings.push(finding("hmi-alarm-deadband-invalid", "error", `Alarm "${alarm.name}" deadband must be zero or greater.`, `${alarmTarget}/trigger/deadband`));
    }
    if (typeof alarm.allowAcknowledge !== "boolean") {
      findings.push(finding("hmi-alarm-acknowledge-invalid", "error", `Alarm "${alarm.name}" acknowledge setting must be boolean.`, `${alarmTarget}/allowAcknowledge`));
    }
    if (alarm.enabled !== undefined && typeof alarm.enabled !== "boolean") {
      findings.push(finding("hmi-alarm-enabled-invalid", "error", `Alarm "${alarm.name}" enabled setting must be boolean.`, `${alarmTarget}/enabled`));
    }
    if (alarmId) alarmIds.add(alarmId);
    if (alarmName) alarmNames.add(alarmName.toLowerCase());
  }
  for (const alarmView of project.alarmViews) {
    const alarmTarget = `hmi/alarm-view:${alarmView.id}`;
    const alarmId = alarmView.id.trim();
    const alarmName = alarmView.name.trim();
    if (!alarmId) {
      findings.push(finding("hmi-alarm-view-id-required", "error", "Alarm view id is required.", alarmTarget));
    } else if (alarmViewIds.has(alarmId)) {
      findings.push(finding("hmi-alarm-view-id-duplicate", "error", `Duplicate alarm view id "${alarmView.id}".`, alarmTarget));
    }
    if (!alarmName) {
      findings.push(finding("hmi-alarm-view-name-required", "error", "Alarm view name is required.", alarmTarget));
    } else if (alarmViewNames.has(alarmName.toLowerCase())) {
      findings.push(finding("hmi-alarm-view-name-duplicate", "error", `Duplicate alarm view name "${alarmView.name}".`, alarmTarget));
    }
    if (!["summary", "manager", "history"].includes(alarmView.kind)) {
      findings.push(finding("hmi-alarm-view-invalid-kind", "error", `Alarm view "${alarmView.name}" has an invalid kind.`, `${alarmTarget}/kind`));
    }
    if (alarmView.columns.length === 0) {
      findings.push(finding("hmi-alarm-view-no-columns", "warning", `Alarm view "${alarmView.name}" has no columns.`, alarmTarget));
    }
    const columnNames = new Set<string>();
    for (const column of alarmView.columns) {
      const columnTarget = `${alarmTarget}/column:${column}`;
      const columnName = column.trim();
      if (!columnName) {
        findings.push(finding("hmi-alarm-view-column-required", "error", `Alarm view "${alarmView.name}" contains a blank column.`, columnTarget));
      } else if (columnNames.has(columnName.toLowerCase())) {
        findings.push(finding("hmi-alarm-view-column-duplicate", "warning", `Alarm view "${alarmView.name}" repeats column "${column}".`, columnTarget));
      }
      if (columnName) columnNames.add(columnName.toLowerCase());
    }
    if (alarmView.filter !== undefined && !alarmView.filter.trim()) {
      findings.push(finding("hmi-alarm-view-filter-empty", "warning", `Alarm view "${alarmView.name}" has an empty filter.`, `${alarmTarget}/filter`));
    }
    if (alarmView.sort !== undefined && !alarmView.sort.trim()) {
      findings.push(finding("hmi-alarm-view-sort-empty", "warning", `Alarm view "${alarmView.name}" has an empty sort expression.`, `${alarmTarget}/sort`));
    }
    validateSecurityRoleReferences(
      alarmView.securityRoleIds,
      securityRoleIds,
      `${alarmTarget}/security`,
      findings,
      "hmi-alarm-view-security-role-missing",
      "hmi-alarm-view-security-role-required",
      `Alarm view "${alarmView.name}"`,
    );
    if (alarmId) alarmViewIds.add(alarmId);
    if (alarmName) alarmViewNames.add(alarmName.toLowerCase());
  }

  const diagnosticsViewIds = new Set<string>();
  const diagnosticsViewNames = new Set<string>();
  for (const diagnosticsView of project.diagnosticsViews) {
    const diagnosticsTarget = `hmi/diagnostics-view:${diagnosticsView.id}`;
    const diagnosticsId = diagnosticsView.id.trim();
    const diagnosticsName = diagnosticsView.name.trim();
    if (!diagnosticsId) {
      findings.push(finding("hmi-diagnostics-view-id-required", "error", "Diagnostics view id is required.", diagnosticsTarget));
    } else if (diagnosticsViewIds.has(diagnosticsId)) {
      findings.push(finding("hmi-diagnostics-view-id-duplicate", "error", `Duplicate diagnostics view id "${diagnosticsView.id}".`, diagnosticsTarget));
    }
    if (!diagnosticsName) {
      findings.push(finding("hmi-diagnostics-view-name-required", "error", "Diagnostics view name is required.", diagnosticsTarget));
    } else if (diagnosticsViewNames.has(diagnosticsName.toLowerCase())) {
      findings.push(finding("hmi-diagnostics-view-name-duplicate", "error", `Duplicate diagnostics view name "${diagnosticsView.name}".`, diagnosticsTarget));
    }
    if (diagnosticsView.columns.length === 0) {
      findings.push(finding("hmi-diagnostics-view-no-columns", "warning", `Diagnostics view "${diagnosticsView.name}" has no columns.`, diagnosticsTarget));
    }
    const columnNames = new Set<string>();
    for (const column of diagnosticsView.columns) {
      const columnTarget = `${diagnosticsTarget}/column:${column}`;
      const columnName = column.trim();
      if (!columnName) {
        findings.push(finding("hmi-diagnostics-view-column-required", "error", `Diagnostics view "${diagnosticsView.name}" contains a blank column.`, columnTarget));
      } else if (columnNames.has(columnName.toLowerCase())) {
        findings.push(finding("hmi-diagnostics-view-column-duplicate", "warning", `Diagnostics view "${diagnosticsView.name}" repeats column "${column}".`, columnTarget));
      }
      if (columnName) columnNames.add(columnName.toLowerCase());
    }
    if (diagnosticsView.defaultFilter !== undefined && !diagnosticsView.defaultFilter.trim()) {
      findings.push(finding("hmi-diagnostics-view-filter-empty", "warning", `Diagnostics view "${diagnosticsView.name}" has an empty default filter.`, `${diagnosticsTarget}/defaultFilter`));
    }
    if (diagnosticsId) diagnosticsViewIds.add(diagnosticsId);
    if (diagnosticsName) diagnosticsViewNames.add(diagnosticsName.toLowerCase());
  }

  const trendIds = new Set<string>();
  const trendNames = new Set<string>();
  for (const trend of project.trends) {
    const trendTarget = `hmi/trend:${trend.id}`;
    const trendId = trend.id.trim();
    const trendName = trend.name.trim();
    if (!trendId) {
      findings.push(finding("hmi-trend-id-required", "error", "Trend id is required.", trendTarget));
    } else if (trendIds.has(trendId)) {
      findings.push(finding("hmi-trend-id-duplicate", "error", `Duplicate trend id "${trend.id}".`, trendTarget));
    }
    if (!trendName) {
      findings.push(finding("hmi-trend-name-required", "error", "Trend name is required.", trendTarget));
    } else if (trendNames.has(trendName.toLowerCase())) {
      findings.push(finding("hmi-trend-name-duplicate", "error", `Duplicate trend name "${trend.name}".`, trendTarget));
    }
    if (trend.sampleRateMs <= 0) {
      findings.push(finding("hmi-trend-invalid-sample-rate", "error", `Trend "${trend.name}" sample rate must be greater than zero.`, trendTarget));
    }
    if (trend.timeRangeSeconds <= 0) {
      findings.push(finding("hmi-trend-invalid-time-range", "error", `Trend "${trend.name}" time range must be greater than zero.`, trendTarget));
    }
    if (trend.traces.length === 0) {
      findings.push(finding("hmi-trend-no-traces", "warning", `Trend "${trend.name}" has no traces.`, trendTarget));
    }
    const traceIds = new Set<string>();
    for (const trace of trend.traces) {
      const traceTarget = `${trendTarget}/trace:${trace.id}`;
      const traceId = trace.id.trim();
      if (traceId && traceIds.has(traceId)) {
        findings.push(finding("hmi-trend-trace-id-duplicate", "error", `Trend "${trend.name}" repeats trace id "${trace.id}".`, traceTarget));
      }
      if (!trace.label.trim()) {
        findings.push(finding("hmi-trend-trace-label-required", "error", `Trend "${trend.name}" has a trace with no label.`, traceTarget));
      }
      if (!trace.color.trim()) {
        findings.push(finding("hmi-trend-trace-color-required", "error", `Trend "${trend.name}" trace "${trace.label}" requires a color.`, traceTarget));
      }
      validateSourcePath(trace.source, effectiveContext, traceTarget, findings, "hmi-trend-trace", "Trend trace");
      if (traceId) traceIds.add(traceId);
    }
    if (trendId) trendIds.add(trendId);
    if (trendName) trendNames.add(trendName.toLowerCase());
  }

  const dataLogIds = new Set<string>();
  const dataLogNames = new Set<string>();
  for (const log of project.dataLogs) {
    const logTarget = `hmi/data-log:${log.id}`;
    const logId = log.id.trim();
    const logName = log.name.trim();
    if (!logId) {
      findings.push(finding("hmi-data-log-id-required", "error", "Data log id is required.", logTarget));
    } else if (dataLogIds.has(logId)) {
      findings.push(finding("hmi-data-log-id-duplicate", "error", `Duplicate data log id "${log.id}".`, logTarget));
    }
    if (!logName) {
      findings.push(finding("hmi-data-log-name-required", "error", "Data log name is required.", logTarget));
    } else if (dataLogNames.has(logName.toLowerCase())) {
      findings.push(finding("hmi-data-log-name-duplicate", "error", `Duplicate data log name "${log.name}".`, logTarget));
    }
    if (log.sampleRateMs <= 0) {
      findings.push(finding("hmi-data-log-invalid-sample-rate", "error", `Data log "${log.name}" sample rate must be greater than zero.`, logTarget));
    }
    if (log.retentionHours <= 0) {
      findings.push(finding("hmi-data-log-invalid-retention", "error", `Data log "${log.name}" retention must be greater than zero.`, logTarget));
    }
    if (log.tagPaths.length === 0) {
      findings.push(finding("hmi-data-log-no-tags", "warning", `Data log "${log.name}" has no tag paths.`, logTarget));
    }
    const tags = knownSet(effectiveContext.knownTagPaths);
    if (tags) {
      for (const tagPath of log.tagPaths) {
        if (!tags.has(tagPath)) {
          findings.push(finding("hmi-data-log-missing-tag", "error", `Data log "${log.name}" references missing tag "${tagPath}".`, logTarget));
        }
      }
      if (log.statusTagPath && !tags.has(log.statusTagPath)) {
        findings.push(finding("hmi-data-log-missing-status-tag", "error", `Data log "${log.name}" references missing status tag "${log.statusTagPath}".`, logTarget));
      }
    }
    if (logId) dataLogIds.add(logId);
    if (logName) dataLogNames.add(logName.toLowerCase());
  }

  const recipeIds = new Set<string>();
  const recipeNames = new Set<string>();
  const knownRecipeTags = knownSet(effectiveContext.knownTagPaths);
  for (const recipe of recipes) {
    const recipeTarget = `hmi/recipe:${recipe.id}`;
    const recipeId = recipe.id.trim();
    const recipeName = recipe.name.trim();
    if (!recipeId) {
      findings.push(finding("hmi-recipe-id-required", "error", "Recipe id is required.", recipeTarget));
    } else if (recipeIds.has(recipeId)) {
      findings.push(finding("hmi-recipe-id-duplicate", "error", `Duplicate recipe id "${recipe.id}".`, recipeTarget));
    }
    if (!recipeName) {
      findings.push(finding("hmi-recipe-name-required", "error", "Recipe name is required.", recipeTarget));
    } else if (recipeNames.has(recipeName.toLowerCase())) {
      findings.push(finding("hmi-recipe-name-duplicate", "error", `Duplicate recipe name "${recipe.name}".`, recipeTarget));
    }
    if (recipe.items.length === 0) {
      findings.push(finding("hmi-recipe-no-items", "warning", `Recipe "${recipe.name}" has no tag values.`, recipeTarget));
    }
    validateSecurityRoleReferences(
      recipe.securityRoleIds,
      securityRoleIds,
      `${recipeTarget}/security`,
      findings,
      "hmi-recipe-missing-security-role",
      "hmi-recipe-security-role-required",
      `Recipe "${recipe.name}" security`,
    );
    const itemIds = new Set<string>();
    const itemTagPaths = new Set<string>();
    for (const item of recipe.items) {
      const itemTarget = `${recipeTarget}/item:${item.id}`;
      const itemId = item.id.trim();
      const tagPath = item.tagPath.trim();
      if (!itemId) {
        findings.push(finding("hmi-recipe-item-id-required", "error", `Recipe "${recipe.name}" has an item with no id.`, itemTarget));
      } else if (itemIds.has(itemId)) {
        findings.push(finding("hmi-recipe-item-id-duplicate", "error", `Recipe "${recipe.name}" repeats item id "${item.id}".`, itemTarget));
      }
      if (!tagPath) {
        findings.push(finding("hmi-recipe-item-tag-required", "error", `Recipe "${recipe.name}" has an item with no tag path.`, itemTarget));
      } else {
        if (itemTagPaths.has(tagPath)) {
          findings.push(finding("hmi-recipe-item-tag-duplicate", "warning", `Recipe "${recipe.name}" writes "${tagPath}" more than once.`, itemTarget));
        }
        if (knownRecipeTags && !knownRecipeTags.has(tagPath)) {
          findings.push(finding("hmi-recipe-missing-tag", "error", `Recipe "${recipe.name}" references missing tag "${tagPath}".`, itemTarget));
        }
      }
      if (!["string", "number", "boolean"].includes(typeof item.value) && item.value !== null) {
        findings.push(finding("hmi-recipe-item-value-invalid", "error", `Recipe "${recipe.name}" item "${tagPath || item.id}" has an unsupported value.`, itemTarget));
      }
      if (itemId) itemIds.add(itemId);
      if (tagPath) itemTagPaths.add(tagPath);
    }
    if (recipeId) recipeIds.add(recipeId);
    if (recipeName) recipeNames.add(recipeName.toLowerCase());
  }

  for (const item of project.unsupportedContent) {
    findings.push(finding("hmi-unsupported-content", "warning", `Unsupported HMI content "${item.displayName}" is preserved read-only.`, `hmi/unsupported:${item.id}`));
  }

  return findings;
}
