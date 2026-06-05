// Offline project search for the Find / Search Results feature.
import type { PlcProject } from "@esco/core";
import { baseTagName, isNumericLiteral, referencedPaths } from "@esco/instructions";
import { rungNodes } from "@esco/ladder";
import { getLadder } from "@esco/project-actions";
import {
  getHmiProject,
  hmiControllerReferenceBrowserRows,
  touchHmiProject,
  withHmiProject,
  type HmiAddOnGraphicDefinition,
  type HmiGraphicElement,
  type HmiProject,
  type HmiSurfaceBase,
  type HmiSurfaceKind,
} from "@esco/hmi-model";

export type SearchScope = "controller" | "logic" | "tags" | "hmi" | "security" | "assets";

export type SearchHitKind =
  | "controller"
  | "task"
  | "program"
  | "tag"
  | "tag-comment"
  | "io-module"
  | "routine"
  | "rung"
  | "rung-operand"
  | "hmi-surface"
  | "hmi-element"
  | "hmi-binding"
  | "hmi-event"
  | "hmi-alarm"
  | "hmi-trend"
  | "hmi-data-log"
  | "hmi-language"
  | "hmi-security"
  | "hmi-asset"
  | "hmi-add-on-graphic"
  | "hmi-controller-reference";

export interface SearchHit {
  kind: SearchHitKind;
  scope: SearchScope;
  label: string;
  detail: string;
  target: string;
  field?: string;
  matchText?: string;
  snippet?: string;
  replaceable: boolean;
  /** Stable project item or editor location used by the UI when opening a hit. */
  navigationTarget?: string;
  /** Routine to open when the hit is activated (routine/rung hits). */
  routineId?: string;
  /** Defined tag name that can be watched, forced, or cross-referenced from this hit. */
  tagName?: string;
}

export interface SearchOptions {
  scopes?: SearchScope[];
  maxHits?: number;
}

export interface ReplacePreviewHit extends SearchHit {
  before: string;
  after: string;
}

export interface ReplacePreview {
  query: string;
  replacement: string;
  hits: ReplacePreviewHit[];
  replaceableCount: number;
  skippedCount: number;
  capped: boolean;
}

export interface TextReplaceApplyResult {
  project: PlcProject;
  preview: ReplacePreview;
  appliedCount: number;
}

const DEFAULT_MAX_HITS = 200;

function rungText(nodes: { instructionType: string; operands: { value: string }[] }[]): string {
  return nodes.map((node) => `${node.instructionType}(${node.operands.map((operand) => operand.value).join(",")})`).join("");
}

function enabled(scopes: Set<SearchScope> | undefined, scope: SearchScope): boolean {
  return !scopes || scopes.has(scope);
}

function textValue(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}

function stringifyValue(value: unknown): string | undefined {
  const primitive = textValue(value);
  if (primitive !== undefined) return primitive;
  if (value === null || value === undefined) return undefined;
  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function replaceInsensitive(value: string, query: string, replacement: string): string {
  return value.replace(new RegExp(escapeRegex(query), "gi"), replacement);
}

function snippetFor(value: string, query: string): string {
  const index = value.toLowerCase().indexOf(query);
  if (index < 0 || value.length <= 96) return value;
  const start = Math.max(0, index - 36);
  const end = Math.min(value.length, index + query.length + 48);
  return `${start > 0 ? "..." : ""}${value.slice(start, end)}${end < value.length ? "..." : ""}`;
}

function operandTagNames(value: string): string[] {
  const text = value.trim();
  if (!text || isNumericLiteral(text)) return [];
  const candidates = referencedPaths(text);
  const values = candidates.length ? candidates : [text];
  const names = values
    .map((candidate) => baseTagName(candidate))
    .filter((candidate): candidate is string => candidate.length > 0 && !isNumericLiteral(candidate));
  return [...new Set(names)];
}

function hitKey(target: string, field: string | undefined): string {
  return `${target}\u0000${field ?? ""}`;
}

function hmiElementPropertyReplaceable(property: string): boolean {
  const normalized = property.toLowerCase();
  if (/(^|\.)(id|path|tag|screen|popup|asset|controller|reference|role|source|target)(\.|$)/i.test(property)) {
    return false;
  }
  return /label|text|caption|title|tooltip|message|description|placeholder|header|footer|format|unit|prefix|suffix|name/.test(
    normalized,
  );
}

function hmiCommandArgReplaceable(key: string): boolean {
  return /^(value|text|message|caption|label|title|url)$/i.test(key);
}

function optionalModuleText(value: unknown): string | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  return String(value);
}

interface ProfileChannel {
  name?: string;
  label?: string;
  signalType?: string;
  range?: string;
  direction?: string;
  dataFormat?: string;
  address?: string;
  description?: string;
}

function ioModuleProfileChannels(module: unknown): ProfileChannel[] {
  const candidate = (module as { profileChannels?: unknown }).profileChannels;
  return Array.isArray(candidate) ? candidate.filter((row): row is ProfileChannel => typeof row === "object" && row !== null) : [];
}

/** Search controller, logic, tag, and HMI content for `query` (case-insensitive). */
export function searchProject(project: PlcProject, query: string, options: SearchOptions = {}): SearchHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const scopes = options.scopes ? new Set(options.scopes) : undefined;
  const maxHits = options.maxHits ?? DEFAULT_MAX_HITS;
  const hits: SearchHit[] = [];
  const addText = (
    scope: SearchScope,
    kind: SearchHitKind,
    label: string,
    detail: string,
    value: unknown,
    target: string,
    field: string | undefined,
    replaceable: boolean,
    routineId?: string,
    tagName?: string,
  ) => {
    if (hits.length >= maxHits || !enabled(scopes, scope)) return;
    const text = stringifyValue(value);
    if (!text || !text.toLowerCase().includes(q)) return;
    hits.push({
      kind,
      scope,
      label,
      detail,
      target,
      field,
      matchText: text,
      snippet: snippetFor(text, q),
      replaceable: replaceable && typeof value === "string",
      navigationTarget: routineId ? `routine:${routineId}` : target,
      routineId,
      tagName,
    });
  };

  for (const controller of project.controllers) {
    const definedTagNames = new Set(
      [
        ...controller.controllerTags.map((tag) => tag.name),
        ...controller.programs.flatMap((program) => program.programTags.map((tag) => tag.name)),
      ].map((name) => name.toLowerCase()),
    );
    addText("controller", "controller", controller.name, "controller name", controller.name, `controller:${controller.id}`, "name", false);
    addText("controller", "controller", controller.name, "controller description", controller.description, `controller:${controller.id}`, "description", true);
    addText("controller", "controller", controller.name, "processor type", controller.processorType, `controller:${controller.id}`, "processorType", false);
    addText("controller", "controller", controller.name, "catalog number", controller.catalogNumber, `controller:${controller.id}`, "catalogNumber", false);
    addText("controller", "controller", controller.name, "controller slot", controller.slot, `controller:${controller.id}`, "slot", false);

    for (const task of controller.tasks) {
      const target = `task:${task.id}`;
      const taskDetail = `${task.type}${task.periodMs != null ? ` · ${task.periodMs} ms` : ""}${task.priority != null ? ` · priority ${task.priority}` : ""}`;
      addText("controller", "task", task.name, "task name", task.name, target, "name", false);
      addText("controller", "task", task.name, `${taskDetail} description`, task.description, target, "description", true);
      addText("controller", "task", task.name, "task type", task.type, target, "type", false);
      addText("controller", "task", task.name, "task period", task.periodMs, target, "periodMs", false);
      addText("controller", "task", task.name, "task priority", task.priority, target, "priority", false);
      addText("controller", "task", task.name, "task watchdog", task.watchdogMs, target, "watchdogMs", false);
      addText("controller", "task", task.name, "event trigger", task.eventInfo?.eventTrigger, target, "eventInfo.eventTrigger", false);
      addText("controller", "task", task.name, "event tag", task.eventInfo?.eventTag, target, "eventInfo.eventTag", false, undefined, task.eventInfo?.eventTag);
      addText("controller", "task", task.name, "safety class", task.safetyClass, target, "safetyClass", false);
      for (const programId of task.scheduledProgramIds) {
        const scheduledProgram = controller.programs.find((program) => program.id === programId);
        addText(
          "controller",
          "task",
          task.name,
          "scheduled program",
          scheduledProgram?.name ?? programId,
          `${target}/scheduled-program:${programId}`,
          "scheduledProgramIds",
          false,
        );
      }
    }

    for (const module of controller.ioConfiguration.modules) {
      const target = `controller:${controller.id}/io-module:${module.id}`;
      const moduleLocation = [
        module.parentModule ? `parent ${module.parentModule}` : undefined,
        module.parentPortId ? `port ${module.parentPortId}` : undefined,
        module.slot != null ? `slot ${module.slot}` : undefined,
      ]
        .filter(Boolean)
        .join(" · ");
      const moduleDetail = [module.catalogNumber, moduleLocation, module.vendor].filter(Boolean).join(" · ") || "I/O module";
      addText("controller", "io-module", module.name, "I/O module name", module.name, target, "name", false);
      addText("controller", "io-module", module.name, `${moduleDetail} description`, module.description, target, "description", true);
      addText("controller", "io-module", module.name, "catalog number", module.catalogNumber, target, "catalogNumber", false);
      addText("controller", "io-module", module.name, "slot", module.slot, target, "slot", false);
      addText("controller", "io-module", module.name, "vendor", module.vendor, target, "vendor", false);
      addText("controller", "io-module", module.name, "product type", module.productType, target, "productType", false);
      addText("controller", "io-module", module.name, "product code", module.productCode, target, "productCode", false);
      addText("controller", "io-module", module.name, "electronic keying", module.electronicKeying, target, "electronicKeying", false);
      addText("controller", "io-module", module.name, "communication path", module.commPath, target, "commPath", false);
      for (const [portIndex, port] of (module.ports ?? []).entries()) {
        const portTarget = `${target}/port:${port.id ?? portIndex}`;
        addText("controller", "io-module", `${module.name} port ${port.id ?? portIndex + 1}`, "port type", port.type, portTarget, "type", false);
        addText("controller", "io-module", `${module.name} port ${port.id ?? portIndex + 1}`, "port address", port.address, portTarget, "address", false);
        addText("controller", "io-module", `${module.name} port ${port.id ?? portIndex + 1}`, "safety network", port.safetyNetwork, portTarget, "safetyNetwork", false);
      }
      for (const [connectionIndex, connection] of (module.connections ?? []).entries()) {
        const connectionTarget = `${target}/connection:${connection.name ?? connectionIndex}`;
        addText("controller", "io-module", `${module.name} connection`, "connection name", connection.name, connectionTarget, "name", false);
        addText("controller", "io-module", `${module.name} connection`, "connection type", connection.type, connectionTarget, "type", false);
        addText("controller", "io-module", `${module.name} connection`, "connection RPI", connection.rpi, connectionTarget, "rpi", false);
        addText("controller", "io-module", `${module.name} connection`, "connection priority", connection.priority, connectionTarget, "priority", false);
        addText("controller", "io-module", `${module.name} connection`, "input connection type", connection.inputConnectionType, connectionTarget, "inputConnectionType", false);
        addText("controller", "io-module", `${module.name} connection`, "input production trigger", connection.inputProductionTrigger, connectionTarget, "inputProductionTrigger", false);
      }
      for (const [channelIndex, channel] of ioModuleProfileChannels(module).entries()) {
        const channelTarget = `${target}/channel:${channel.name ?? channelIndex}`;
        const channelLabel = `${module.name} ${channel.name ?? channel.label ?? `channel ${channelIndex + 1}`}`;
        addText("controller", "io-module", channelLabel, "profile channel", channel.name ?? channel.label, channelTarget, "name", false);
        addText("controller", "io-module", channelLabel, "channel signal type", channel.signalType, channelTarget, "signalType", false);
        addText("controller", "io-module", channelLabel, "channel range", channel.range, channelTarget, "range", false);
        addText("controller", "io-module", channelLabel, "channel direction", channel.direction, channelTarget, "direction", false);
        addText("controller", "io-module", channelLabel, "channel data format", channel.dataFormat, channelTarget, "dataFormat", false);
        addText("controller", "io-module", channelLabel, "channel address", channel.address, channelTarget, "address", false);
        addText("controller", "io-module", channelLabel, "channel description", optionalModuleText(channel.description), channelTarget, "description", false);
      }
    }

    const controllerTags = controller.controllerTags.map((tag) => ({ tag, scopeLabel: "controller", target: `controller:${controller.id}/tag:${tag.name}` }));
    const programTags = controller.programs.flatMap((program) =>
      program.programTags.map((tag) => ({
        tag,
        scopeLabel: program.name,
        target: `program:${program.id}/tag:${tag.name}`,
      })),
    );
    for (const { tag, scopeLabel, target } of [...controllerTags, ...programTags]) {
      addText("tags", "tag", tag.name, `${tag.dataType} · ${scopeLabel}`, tag.name, target, "name", false, undefined, tag.name);
      addText("tags", "tag", tag.name, `${tag.dataType} · ${scopeLabel} description`, tag.description, target, "description", true, undefined, tag.name);
      addText("tags", "tag", tag.name, `${tag.dataType} · ${scopeLabel} alias`, tag.aliasFor, target, "aliasFor", false, undefined, tag.name);
      for (const comment of tag.comments ?? []) {
        addText("tags", "tag-comment", `${tag.name}${comment.operand}`, "element/member comment", comment.text, `${target}/comment:${comment.operand}`, "text", true, undefined, tag.name);
      }
    }

    for (const dataType of controller.dataTypes) {
      addText("controller", "controller", dataType.name, "UDT name", dataType.name, `controller:${controller.id}/udt:${dataType.name}`, "name", false);
      addText("controller", "controller", dataType.name, "UDT description", dataType.description, `controller:${controller.id}/udt:${dataType.name}`, "description", true);
      for (const member of dataType.members) {
        addText("controller", "controller", `${dataType.name}.${member.name}`, "UDT member", member.name, `controller:${controller.id}/udt:${dataType.name}/member:${member.name}`, "name", false);
        addText("controller", "controller", `${dataType.name}.${member.name}`, "UDT member description", member.description, `controller:${controller.id}/udt:${dataType.name}/member:${member.name}`, "description", true);
      }
    }

    for (const program of controller.programs) {
      addText("controller", "program", program.name, "program name", program.name, `program:${program.id}`, "name", false);
      addText("controller", "program", program.name, "program description", program.description, `program:${program.id}`, "description", true);
      for (const routine of program.routines) {
        addText("logic", "routine", `${program.name} / ${routine.name}`, "routine name", routine.name, `routine:${routine.id}`, "name", false, routine.id);
        addText("logic", "routine", `${program.name} / ${routine.name}`, "routine description", routine.description, `routine:${routine.id}`, "description", true, routine.id);
        addText("logic", "routine", `${program.name} / ${routine.name}`, "structured text", routine.structuredText, `routine:${routine.id}/structuredText`, "structuredText", true, routine.id);
        addText("logic", "routine", `${program.name} / ${routine.name}`, "preserved source text", routine.sourceText, `routine:${routine.id}/sourceText`, "sourceText", false, routine.id);
        const ladder = getLadder(routine);
        if (!ladder) continue;
        for (const rung of ladder.rungs) {
          const nodes = rungNodes(rung);
          const text = rungText(nodes);
          addText("logic", "rung", `${program.name} / ${routine.name} · rung ${rung.number}`, text || "(empty rung)", text, `routine:${routine.id}/rung:${rung.id}/text`, "text", false, routine.id);
          addText("logic", "rung", `${program.name} / ${routine.name} · rung ${rung.number}`, "rung comment", rung.comment, `routine:${routine.id}/rung:${rung.id}/comment`, "comment", true, routine.id);
          nodes.forEach((node, nodeIndex) => {
            node.operands.forEach((operand, operandIndex) => {
              for (const tagName of operandTagNames(operand.value)) {
                addText(
                  "logic",
                  "rung-operand",
                  `${program.name} / ${routine.name} · rung ${rung.number} · ${tagName}`,
                  `${node.instructionType} operand ${operandIndex + 1}`,
                  operand.value,
                  `routine:${routine.id}/rung:${rung.id}/node:${nodeIndex}/operand:${operandIndex}`,
                  "operand",
                  false,
                  routine.id,
                  definedTagNames.has(tagName.toLowerCase()) ? tagName : undefined,
                );
              }
            });
          });
        }
      }
    }
  }

  const hmi = getHmiProject(project);
  if (hmi) {
    addText("hmi", "hmi-surface", hmi.name, "HMI project name", hmi.name, `hmi:${hmi.id}`, "name", true);
    addText("hmi", "hmi-surface", hmi.defaultLanguage, "default language", hmi.defaultLanguage, "hmi/defaultLanguage", "defaultLanguage", false);

    for (const row of hmiControllerReferenceBrowserRows(hmi)) {
      addText("hmi", "hmi-controller-reference", row.referenceName, `${row.kind} · ${row.controllerName}`, row.path, `hmi/controller-reference:${row.referenceId}/${row.kind}:${row.path}`, undefined, false);
      addText("hmi", "hmi-controller-reference", row.referenceName, `${row.kind} · ${row.controllerName}`, row.name, `hmi/controller-reference:${row.referenceId}/${row.kind}:${row.path}`, undefined, false);
    }

    const surfaces = [...hmi.screens, ...hmi.popups, hmi.systemBanner];
    for (const surface of surfaces) {
      addText("hmi", "hmi-surface", surface.name, surface.kind, surface.name, `hmi/${surface.kind}:${surface.id}`, "name", surface.kind !== "system-banner");
      addText("hmi", "hmi-surface", surface.name, `${surface.kind} background`, surface.background, `hmi/${surface.kind}:${surface.id}/background`, "background", true);
      for (const roleId of surface.securityRoleIds) {
        addText("security", "hmi-security", surface.name, `${surface.kind} security role`, roleId, `hmi/${surface.kind}:${surface.id}/security:${roleId}`, "securityRoleIds", false);
      }
      for (const element of surface.elements) {
        const elementTarget = `hmi/${surface.kind}:${surface.id}/element:${element.id}`;
        addText("hmi", "hmi-element", `${surface.name} / ${element.name}`, "element name", element.name, elementTarget, "name", true);
        addText("hmi", "hmi-element", `${surface.name} / ${element.name}`, "element type", element.typeId, elementTarget, "typeId", false);
        for (const [property, value] of Object.entries(element.properties)) {
          addText(
            "hmi",
            "hmi-element",
            `${element.name}.${property}`,
            "element property",
            value,
            `${elementTarget}/property:${property}`,
            property,
            hmiElementPropertyReplaceable(property),
          );
        }
        for (const binding of element.bindings) {
          addText("hmi", "hmi-binding", `${element.name}.${binding.targetProperty}`, `${binding.source.kind} binding`, binding.source.path, `${elementTarget}/binding:${binding.id}`, "source.path", binding.source.kind === "expression");
        }
        for (const animation of element.animations) {
          addText("hmi", "hmi-binding", `${element.name}.${animation.targetProperty}`, `${animation.source.kind} animation`, animation.source.path, `${elementTarget}/animation:${animation.id}`, "source.path", animation.source.kind === "expression");
        }
        for (const event of element.events) {
          for (const command of event.commands) {
            for (const [key, value] of Object.entries(command.args)) {
              addText(
                "hmi",
                "hmi-event",
                `${element.name}.${event.eventType}`,
                `${command.type} command argument`,
                value,
                `${elementTarget}/event:${event.id}/command:${command.id}/arg:${key}`,
                key,
                hmiCommandArgReplaceable(key),
              );
            }
          }
        }
      }
    }

    for (const shortcut of hmi.shortcuts) {
      addText("hmi", "hmi-surface", shortcut.name, "shortcut name", shortcut.name, `hmi/shortcut:${shortcut.id}`, "name", true);
      addText("hmi", "hmi-surface", shortcut.name, "shortcut caption", shortcut.caption, `hmi/shortcut:${shortcut.id}`, "caption", true);
      addText("hmi", "hmi-surface", shortcut.name, "shortcut folder", shortcut.folder, `hmi/shortcut:${shortcut.id}`, "folder", true);
    }
    for (const asset of hmi.assets) {
      addText("assets", "hmi-asset", asset.name, `${asset.kind} asset`, asset.name, `hmi/asset:${asset.id}`, "name", true);
      addText("assets", "hmi-asset", asset.name, `${asset.kind} MIME type`, asset.mimeType, `hmi/asset:${asset.id}`, "mimeType", false);
      addText("assets", "hmi-asset", asset.name, `${asset.kind} hash`, asset.hash, `hmi/asset:${asset.id}`, "hash", false);
    }
    for (const graphic of hmi.addOnGraphics) {
      addText("hmi", "hmi-add-on-graphic", graphic.name, "Add-On Graphic name", graphic.name, `hmi/add-on-graphic:${graphic.id}`, "name", true);
      addText("hmi", "hmi-add-on-graphic", graphic.name, "Add-On Graphic vendor", graphic.vendor, `hmi/add-on-graphic:${graphic.id}`, "vendor", true);
      for (const property of graphic.properties) {
        addText("hmi", "hmi-add-on-graphic", `${graphic.name}.${property.name}`, "Add-On Graphic property", property.name, `hmi/add-on-graphic:${graphic.id}/property:${property.name}`, "name", false);
        addText("hmi", "hmi-add-on-graphic", `${graphic.name}.${property.name}`, "Add-On Graphic default value", property.defaultValue, `hmi/add-on-graphic:${graphic.id}/property:${property.name}`, "defaultValue", true);
      }
    }
    for (const alarm of hmi.alarms) {
      addText("hmi", "hmi-alarm", alarm.name, "alarm name", alarm.name, `hmi/alarm:${alarm.id}`, "name", true);
      addText("hmi", "hmi-alarm", alarm.name, "alarm tag", alarm.tagPath, `hmi/alarm:${alarm.id}/tagPath`, "tagPath", false);
      addText("hmi", "hmi-alarm", alarm.name, "alarm message", alarm.message, `hmi/alarm:${alarm.id}/message`, "message", true);
    }
    for (const trend of hmi.trends) {
      addText("hmi", "hmi-trend", trend.name, "trend name", trend.name, `hmi/trend:${trend.id}`, "name", true);
      for (const trace of trend.traces) {
        addText("hmi", "hmi-trend", `${trend.name}.${trace.label}`, "trend trace label", trace.label, `hmi/trend:${trend.id}/trace:${trace.id}`, "label", true);
        addText("hmi", "hmi-trend", `${trend.name}.${trace.label}`, "trend trace source", trace.source.path, `hmi/trend:${trend.id}/trace:${trace.id}/source`, "source.path", trace.source.kind === "expression");
      }
    }
    for (const log of hmi.dataLogs) {
      addText("hmi", "hmi-data-log", log.name, "data log name", log.name, `hmi/data-log:${log.id}`, "name", true);
      addText("hmi", "hmi-data-log", log.name, "data log status tag", log.statusTagPath, `hmi/data-log:${log.id}/statusTagPath`, "statusTagPath", false);
      for (const tagPath of log.tagPaths) addText("hmi", "hmi-data-log", log.name, "data log tag path", tagPath, `hmi/data-log:${log.id}/tag:${tagPath}`, "tagPaths", false);
    }
    for (const language of hmi.languagePacks) {
      addText("hmi", "hmi-language", language.displayName, "language display name", language.displayName, `hmi/language:${language.id}`, "displayName", true);
      addText("hmi", "hmi-language", language.displayName, "language id", language.languageId, `hmi/language:${language.id}`, "languageId", false);
      for (const [stringId, value] of Object.entries(language.strings)) {
        addText("hmi", "hmi-language", `${language.languageId}.${stringId}`, "localized string", value, `hmi/language:${language.id}/string:${stringId}`, stringId, true);
      }
    }
    for (const role of hmi.security.roles) {
      addText("security", "hmi-security", role.name, "security role", role.name, `hmi/security/role:${role.id}`, "name", true);
      for (const permission of role.permissions) addText("security", "hmi-security", role.name, "security permission", permission, `hmi/security/role:${role.id}/permission:${permission}`, "permissions", false);
    }
    for (const user of hmi.security.users) {
      addText("security", "hmi-security", user.username, "security user", user.username, `hmi/security/user:${user.id}`, "username", false);
    }
  }

  return hits;
}

export function previewProjectTextReplace(
  project: PlcProject,
  query: string,
  replacement: string,
  options: SearchOptions = {},
): ReplacePreview {
  const hits = searchProject(project, query, options);
  const trimmed = query.trim();
  const replaceableHits = trimmed
    ? hits.filter((hit): hit is SearchHit & { matchText: string } => hit.replaceable && typeof hit.matchText === "string")
    : [];
  return {
    query,
    replacement,
    hits: replaceableHits.map((hit) => ({
      ...hit,
      before: hit.matchText,
      after: replaceInsensitive(hit.matchText, trimmed, replacement),
    })),
    replaceableCount: replaceableHits.length,
    skippedCount: hits.length - replaceableHits.length,
    capped: hits.length >= (options.maxHits ?? DEFAULT_MAX_HITS),
  };
}

export function applyProjectTextReplace(
  project: PlcProject,
  query: string,
  replacement: string,
  options: SearchOptions = {},
): TextReplaceApplyResult {
  const preview = previewProjectTextReplace(project, query, replacement, options);
  if (preview.hits.length === 0) return { project, preview, appliedCount: 0 };

  const replacements = new Map(preview.hits.map((hit) => [hitKey(hit.target, hit.field), hit.after]));
  let appliedCount = 0;
  const replaceField = (value: string | undefined, target: string, field: string): string | undefined => {
    if (typeof value !== "string") return value;
    const after = replacements.get(hitKey(target, field));
    if (after === undefined) return value;
    if (after !== value) appliedCount += 1;
    return after;
  };

  let next: PlcProject = {
    ...project,
    controllers: project.controllers.map((controller) => ({
      ...controller,
      description: replaceField(controller.description, `controller:${controller.id}`, "description"),
      tasks: controller.tasks.map((task) => ({
        ...task,
        description: replaceField(task.description, `task:${task.id}`, "description"),
      })),
      ioConfiguration: {
        ...controller.ioConfiguration,
        modules: controller.ioConfiguration.modules.map((module) => ({
          ...module,
          description: replaceField(module.description, `controller:${controller.id}/io-module:${module.id}`, "description"),
        })),
      },
      controllerTags: controller.controllerTags.map((tag) => ({
        ...tag,
        description: replaceField(tag.description, `controller:${controller.id}/tag:${tag.name}`, "description"),
        comments: tag.comments?.map((comment) => ({
          ...comment,
          text: replaceField(comment.text, `controller:${controller.id}/tag:${tag.name}/comment:${comment.operand}`, "text") ?? comment.text,
        })),
      })),
      dataTypes: controller.dataTypes.map((dataType) => ({
        ...dataType,
        description: replaceField(dataType.description, `controller:${controller.id}/udt:${dataType.name}`, "description"),
        members: dataType.members.map((member) => ({
          ...member,
          description: replaceField(
            member.description,
            `controller:${controller.id}/udt:${dataType.name}/member:${member.name}`,
            "description",
          ),
        })),
      })),
      programs: controller.programs.map((program) => ({
        ...program,
        description: replaceField(program.description, `program:${program.id}`, "description"),
        programTags: program.programTags.map((tag) => ({
          ...tag,
          description: replaceField(tag.description, `program:${program.id}/tag:${tag.name}`, "description"),
          comments: tag.comments?.map((comment) => ({
            ...comment,
            text: replaceField(comment.text, `program:${program.id}/tag:${tag.name}/comment:${comment.operand}`, "text") ?? comment.text,
          })),
        })),
        routines: program.routines.map((routine) => {
          const ladder = getLadder(routine);
          return {
            ...routine,
            description: replaceField(routine.description, `routine:${routine.id}`, "description"),
            structuredText: replaceField(routine.structuredText, `routine:${routine.id}/structuredText`, "structuredText"),
            ladder: ladder
              ? {
                  ...ladder,
                  rungs: ladder.rungs.map((rung) => ({
                    ...rung,
                    comment: replaceField(rung.comment, `routine:${routine.id}/rung:${rung.id}/comment`, "comment"),
                  })),
                }
              : routine.ladder,
          };
        }),
      })),
    })),
  };

  const hmi = getHmiProject(next);
  if (hmi) {
    const replacedHmi = replaceHmiText(hmi, replaceField);
    if (replacedHmi !== hmi) next = withHmiProject(next, touchHmiProject(replacedHmi));
  }

  return { project: next, preview, appliedCount };
}

function replaceHmiText(
  hmi: HmiProject,
  replaceField: (value: string | undefined, target: string, field: string) => string | undefined,
): HmiProject {
  let changed = false;
  type SurfaceContext = { id: string; kind: HmiSurfaceKind };
  const changedValue = <T>(before: T, after: T): T => {
    if (after !== before) changed = true;
    return after;
  };
  const changedOptional = (before: string | undefined, after: string | undefined): string | undefined => {
    if (after !== before) changed = true;
    return after;
  };

  const replaceElement = (surface: SurfaceContext, element: HmiGraphicElement): HmiGraphicElement => {
    const elementTarget = `hmi/${surface.kind}:${surface.id}/element:${element.id}`;
    return {
      ...element,
      name: changedValue(element.name, replaceField(element.name, elementTarget, "name") ?? element.name),
      properties: Object.fromEntries(
        Object.entries(element.properties).map(([property, value]) => [
          property,
          hmiElementPropertyReplaceable(property) && typeof value === "string"
            ? changedValue(value, replaceField(value, `${elementTarget}/property:${property}`, property) ?? value)
            : value,
        ]),
      ),
      bindings: element.bindings.map((binding) => ({
        ...binding,
        source:
          binding.source.kind === "expression"
            ? {
                ...binding.source,
                path: changedValue(
                  binding.source.path,
                  replaceField(binding.source.path, `${elementTarget}/binding:${binding.id}`, "source.path") ?? binding.source.path,
                ),
              }
            : binding.source,
      })),
      animations: element.animations.map((animation) => ({
        ...animation,
        source:
          animation.source.kind === "expression"
            ? {
                ...animation.source,
                path: changedValue(
                  animation.source.path,
                  replaceField(animation.source.path, `${elementTarget}/animation:${animation.id}`, "source.path") ??
                    animation.source.path,
                ),
              }
            : animation.source,
      })),
      events: element.events.map((event) => ({
        ...event,
        commands: event.commands.map((command) => ({
          ...command,
          args: Object.fromEntries(
            Object.entries(command.args).map(([key, value]) => [
              key,
              hmiCommandArgReplaceable(key) && typeof value === "string"
                ? changedValue(
                    value,
                    replaceField(value, `${elementTarget}/event:${event.id}/command:${command.id}/arg:${key}`, key) ?? value,
                  )
                : value,
            ]),
          ),
        })),
      })),
    };
  };

  const replaceSurface = <T extends HmiSurfaceBase>(surface: T): T => ({
    ...surface,
    name:
      surface.kind === "system-banner"
        ? surface.name
        : changedValue(surface.name, replaceField(surface.name, `hmi/${surface.kind}:${surface.id}`, "name") ?? surface.name),
    background: changedValue(
      surface.background,
      replaceField(surface.background, `hmi/${surface.kind}:${surface.id}/background`, "background") ?? surface.background,
    ),
    elements: surface.elements.map((element) => replaceElement(surface, element)),
  });

  const replaceGraphic = (graphic: HmiAddOnGraphicDefinition): HmiAddOnGraphicDefinition => ({
    ...graphic,
    name: changedValue(
      graphic.name,
      replaceField(graphic.name, `hmi/add-on-graphic:${graphic.id}`, "name") ?? graphic.name,
    ),
    vendor: changedOptional(graphic.vendor, replaceField(graphic.vendor, `hmi/add-on-graphic:${graphic.id}`, "vendor")),
    properties: graphic.properties.map((property) => ({
      ...property,
      defaultValue:
        typeof property.defaultValue === "string"
          ? changedValue(
              property.defaultValue,
              replaceField(
                property.defaultValue,
                `hmi/add-on-graphic:${graphic.id}/property:${property.name}`,
                "defaultValue",
              ) ?? property.defaultValue,
            )
          : property.defaultValue,
    })),
    elements: graphic.elements.map((element) => replaceElement({ id: graphic.id, kind: "add-on-graphic" }, element)),
  });

  const next: HmiProject = {
    ...hmi,
    name: changedValue(hmi.name, replaceField(hmi.name, `hmi:${hmi.id}`, "name") ?? hmi.name),
    screens: hmi.screens.map(replaceSurface),
    popups: hmi.popups.map(replaceSurface),
    systemBanner: replaceSurface(hmi.systemBanner),
    shortcuts: hmi.shortcuts.map((shortcut) => ({
      ...shortcut,
      name: changedValue(shortcut.name, replaceField(shortcut.name, `hmi/shortcut:${shortcut.id}`, "name") ?? shortcut.name),
      caption: changedValue(shortcut.caption, replaceField(shortcut.caption, `hmi/shortcut:${shortcut.id}`, "caption") ?? shortcut.caption),
      folder: changedOptional(shortcut.folder, replaceField(shortcut.folder, `hmi/shortcut:${shortcut.id}`, "folder")),
    })),
    assets: hmi.assets.map((asset) => ({
      ...asset,
      name: changedValue(asset.name, replaceField(asset.name, `hmi/asset:${asset.id}`, "name") ?? asset.name),
    })),
    addOnGraphics: hmi.addOnGraphics.map(replaceGraphic),
    alarms: hmi.alarms.map((alarm) => ({
      ...alarm,
      name: changedValue(alarm.name, replaceField(alarm.name, `hmi/alarm:${alarm.id}`, "name") ?? alarm.name),
      message: changedValue(alarm.message, replaceField(alarm.message, `hmi/alarm:${alarm.id}/message`, "message") ?? alarm.message),
    })),
    trends: hmi.trends.map((trend) => ({
      ...trend,
      name: changedValue(trend.name, replaceField(trend.name, `hmi/trend:${trend.id}`, "name") ?? trend.name),
      traces: trend.traces.map((trace) => ({
        ...trace,
        label: changedValue(trace.label, replaceField(trace.label, `hmi/trend:${trend.id}/trace:${trace.id}`, "label") ?? trace.label),
        source:
          trace.source.kind === "expression"
            ? {
                ...trace.source,
                path: changedValue(
                  trace.source.path,
                  replaceField(trace.source.path, `hmi/trend:${trend.id}/trace:${trace.id}/source`, "source.path") ??
                    trace.source.path,
                ),
              }
            : trace.source,
      })),
    })),
    dataLogs: hmi.dataLogs.map((log) => ({
      ...log,
      name: changedValue(log.name, replaceField(log.name, `hmi/data-log:${log.id}`, "name") ?? log.name),
    })),
    languagePacks: hmi.languagePacks.map((language) => ({
      ...language,
      displayName: changedValue(
        language.displayName,
        replaceField(language.displayName, `hmi/language:${language.id}`, "displayName") ?? language.displayName,
      ),
      strings: Object.fromEntries(
        Object.entries(language.strings).map(([stringId, value]) => [
          stringId,
          changedValue(value, replaceField(value, `hmi/language:${language.id}/string:${stringId}`, stringId) ?? value),
        ]),
      ),
    })),
    security: {
      ...hmi.security,
      roles: hmi.security.roles.map((role) => ({
        ...role,
        name: changedValue(role.name, replaceField(role.name, `hmi/security/role:${role.id}`, "name") ?? role.name),
      })),
    },
  };

  return changed ? next : hmi;
}
