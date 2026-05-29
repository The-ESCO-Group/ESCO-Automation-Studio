// The agent's tool surface. This is the security boundary for the live agent:
// the model may ONLY call tools defined here. Read tools are executed live and
// never mutate; write tools are mapped to controlled @esco/project-actions and
// returned as a previewable plan (applied only on user Apply). Anything not in
// this whitelist is rejected. There are deliberately NO file/shell/network/PLC/
// .ACD/eval/state-mutation tools.

import type { PlcProject } from "@esco/core";
import {
  getHmiElementDefinition,
  getHmiProject,
  HMI_ELEMENT_DEFINITIONS,
  validateHmiProject,
  type HmiGraphicElement,
  type HmiProject,
  type HmiSurfaceBase,
  type HmiSurfaceKind,
} from "@esco/hmi-model";
import { createDefaultRegistry } from "@esco/instructions";
import { rungNodes } from "@esco/ladder";
import { createId } from "@esco/shared";
import {
  collectTagReferences,
  findRoutine,
  getAllTags,
  getLadder,
  validate,
} from "@esco/project-actions";
import type { AssistantSelection, ProposedProjectAction } from "./types";

const registry = createDefaultRegistry();

export interface AgentToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

const obj = (
  properties: Record<string, unknown>,
  required: string[] = [],
): Record<string, unknown> => ({ type: "object", properties, required, additionalProperties: false });
const str = (description: string) => ({ type: "string", description });
const num = (description: string) => ({ type: "number", description });
const hmiSurfaceKindSchema = {
  type: "string",
  enum: ["screen", "popup", "system-banner", "add-on-graphic"],
  description: "HMI surface kind.",
};

function knownTagPaths(project: PlcProject): string[] {
  return getAllTags(project).map((tag) => tag.name);
}

function hmiSurfaces(hmi: HmiProject): HmiSurfaceBase[] {
  return [...hmi.screens, ...hmi.popups, hmi.systemBanner];
}

function findHmiSurface(
  hmi: HmiProject,
  surfaceKind: HmiSurfaceKind,
  surfaceId: string,
): HmiSurfaceBase | undefined {
  return hmiSurfaces(hmi).find((surface) => surface.kind === surfaceKind && surface.id === surfaceId);
}

function formatHmiElement(element: HmiGraphicElement): string {
  const bindings = element.bindings
    .map((binding) => `${binding.targetProperty}<-${binding.source.path || "(blank)"} (${binding.mode})`)
    .join(", ");
  const events = element.events
    .map((event) => `${event.eventType}:${event.commands.map((command) => command.type).join("+") || "(none)"}`)
    .join(", ");
  return [
    `${element.name} [${element.id}] type=${element.typeId}`,
    `xywh=${element.geometry.x},${element.geometry.y},${element.geometry.width},${element.geometry.height}`,
    bindings ? `bindings=${bindings}` : "bindings=(none)",
    events ? `events=${events}` : "events=(none)",
    element.unsupported ? "read-only unsupported" : "",
  ]
    .filter(Boolean)
    .join(" | ");
}

/** Read-only tools — executed live against the working project; never mutate. */
export const READ_TOOLS: AgentToolDef[] = [
  {
    name: "get_project_overview",
    description: "Summarize the project: controllers, programs, routines (with ids and rung counts), and total tag count. Call this first to orient yourself.",
    input_schema: obj({}),
  },
  {
    name: "list_routines",
    description: "List every routine with its program name, programId, routineId, and rung count.",
    input_schema: obj({}),
  },
  {
    name: "get_routine",
    description: "Show the rungs of one routine, including rungId, comment, and each instruction's nodeId, type, and operands. Use this to get the ids you need for edit tools.",
    input_schema: obj({ routineId: str("routineId from list_routines/overview.") }, ["routineId"]),
  },
  {
    name: "list_tags",
    description: "List all tags with data type and scope (controller or program).",
    input_schema: obj({}),
  },
  {
    name: "get_validation_findings",
    description: "Run the validator and return current findings (errors/warnings/info) with targets.",
    input_schema: obj({}),
  },
  {
    name: "get_cross_references",
    description: "List where a tag is read/written across the project. Helpful before renaming or deleting a tag.",
    input_schema: obj({ tagName: str("Base tag name to cross-reference.") }, ["tagName"]),
  },
  {
    name: "get_instruction_metadata",
    description: "Describe a ladder instruction type (display name, operands, supported or not) from the instruction registry.",
    input_schema: obj({ instructionType: str("e.g. XIC, TON, MOV, PID.") }, ["instructionType"]),
  },
  {
    name: "get_hmi_overview",
    description: "Summarize the View Designer/HMI project: screens, popups, system banner, element counts, and HMI validation status. Use this before proposing HMI edits.",
    input_schema: obj({}),
  },
  {
    name: "list_hmi_element_types",
    description: "List registered HMI element typeIds that can be added safely. Use one of these typeIds with add_hmi_registered_element.",
    input_schema: obj({}),
  },
  {
    name: "get_hmi_surface",
    description: "Show one HMI screen, popup, or system banner with element ids, bindings, and events. Use this to get ids before binding or navigation edits.",
    input_schema: obj(
      { surfaceKind: hmiSurfaceKindSchema, surfaceId: str("HMI surface id from get_hmi_overview.") },
      ["surfaceKind", "surfaceId"],
    ),
  },
  {
    name: "get_hmi_validation_findings",
    description: "Run HMI validation and return HMI/View Designer findings, including missing tag bindings and bad navigation targets.",
    input_schema: obj({}),
  },
];

/** Map each write tool name to its project-action kind (what applyAction dispatches). */
export const WRITE_TOOL_TO_KIND: Record<string, string> = {
  create_tag: "createTag",
  rename_tag: "renameTag",
  delete_tag: "deleteTag",
  set_tag_description: "setTagDescription",
  create_routine: "createRoutine",
  add_rung: "addRung",
  add_rung_from_text: "addRungFromText",
  delete_rung: "deleteRung",
  add_instruction: "addInstruction",
  remove_instruction: "removeInstruction",
  update_instruction_operand: "updateInstructionOperand",
  set_rung_comment: "setRungComment",
  add_parallel_branch: "addParallelBranch",
  add_branch_leg: "addBranchLeg",
  add_instruction_to_branch: "addInstructionToBranch",
  create_hmi_screen: "createHmiScreen",
  create_hmi_popup: "createHmiPopup",
  add_hmi_registered_element: "addHmiElement",
  set_hmi_tag_binding: "setHmiElementBinding",
  add_hmi_navigation_event: "addHmiEventCommand",
};

/** Write tools — proposed as plan actions and applied ONLY through project-actions on Apply. */
export const WRITE_TOOLS: AgentToolDef[] = [
  {
    name: "create_tag",
    description: "Create a controller tag. Do this before adding a rung that references a new tag.",
    input_schema: obj(
      { name: str("Tag name, e.g. StartPB."), dataType: str("e.g. BOOL, DINT, TIMER, COUNTER, REAL."), description: str("Optional description.") },
      ["name", "dataType"],
    ),
  },
  {
    name: "rename_tag",
    description: "Rename a tag and remap all operand references.",
    input_schema: obj({ from: str("Existing tag name."), to: str("New tag name.") }, ["from", "to"]),
  },
  {
    name: "delete_tag",
    description: "Delete a tag. Rejected by the action layer if the tag is still referenced.",
    input_schema: obj({ name: str("Tag name to delete.") }, ["name"]),
  },
  {
    name: "set_tag_description",
    description: "Set or update a tag's description (good for suggesting tag comments).",
    input_schema: obj({ name: str("Tag name."), description: str("New description.") }, ["name", "description"]),
  },
  {
    name: "create_routine",
    description: "Create a new ladder routine in a program.",
    input_schema: obj({ programId: str("programId from overview."), name: str("New routine name.") }, ["programId", "name"]),
  },
  {
    name: "add_rung",
    description: "Append an empty rung to a routine (then add instructions to it).",
    input_schema: obj({ routineId: str("Target routineId."), comment: str("Optional rung comment.") }, ["routineId"]),
  },
  {
    name: "add_rung_from_text",
    description: "Append a rung from neutral instruction text, e.g. [XIC(StartPB),XIC(MotorRun)]XIO(StopPB)OTE(MotorRun).",
    input_schema: obj({ routineId: str("Target routineId."), text: str("Neutral rung text."), comment: str("Optional rung comment.") }, ["routineId", "text"]),
  },
  {
    name: "delete_rung",
    description: "Delete a rung by id.",
    input_schema: obj({ routineId: str("routineId."), rungId: str("rungId from get_routine.") }, ["routineId", "rungId"]),
  },
  {
    name: "add_instruction",
    description: "Append an instruction (by type) to a rung; operands start empty.",
    input_schema: obj({ routineId: str("routineId."), rungId: str("rungId."), instructionType: str("e.g. XIC, OTE, TON.") }, ["routineId", "rungId", "instructionType"]),
  },
  {
    name: "remove_instruction",
    description: "Remove one instruction from a rung by nodeId.",
    input_schema: obj({ routineId: str("routineId."), rungId: str("rungId."), nodeId: str("nodeId from get_routine.") }, ["routineId", "rungId", "nodeId"]),
  },
  {
    name: "update_instruction_operand",
    description: "Set one operand value of an instruction.",
    input_schema: obj(
      { routineId: str("routineId."), rungId: str("rungId."), nodeId: str("nodeId."), value: str("New operand value (tag or literal)."), index: { type: "integer", description: "Operand index (default 0)." } },
      ["routineId", "rungId", "nodeId", "value"],
    ),
  },
  {
    name: "set_rung_comment",
    description: "Set or clear a rung's comment.",
    input_schema: obj({ routineId: str("routineId."), rungId: str("rungId."), comment: str("Comment text.") }, ["routineId", "rungId", "comment"]),
  },
  {
    name: "add_parallel_branch",
    description: "Add a parallel (OR) branch to a rung. Pass branchId to nest inside an existing leg.",
    input_schema: obj({ routineId: str("routineId."), rungId: str("rungId."), branchId: str("Optional branch id to nest into.") }, ["routineId", "rungId"]),
  },
  {
    name: "add_branch_leg",
    description: "Add another empty leg to a rung's existing parallel group.",
    input_schema: obj({ routineId: str("routineId."), rungId: str("rungId."), branchId: str("Optional target branch id.") }, ["routineId", "rungId"]),
  },
  {
    name: "add_instruction_to_branch",
    description: "Append an instruction to a specific branch leg.",
    input_schema: obj({ routineId: str("routineId."), rungId: str("rungId."), branchId: str("Branch leg id."), instructionType: str("Instruction type.") }, ["routineId", "rungId", "branchId", "instructionType"]),
  },
  {
    name: "create_hmi_screen",
    description: "Create a View Designer HMI screen. This only queues a reviewed project action.",
    input_schema: obj(
      { name: str("Screen name, e.g. Overview."), width: num("Optional screen width."), height: num("Optional screen height.") },
      ["name"],
    ),
  },
  {
    name: "create_hmi_popup",
    description: "Create a View Designer HMI popup. This only queues a reviewed project action.",
    input_schema: obj(
      { name: str("Popup name, e.g. Motor Details."), width: num("Optional popup width."), height: num("Optional popup height.") },
      ["name"],
    ),
  },
  {
    name: "add_hmi_registered_element",
    description: "Add a registered HMI element to a screen/popup/banner. typeId must come from list_hmi_element_types.",
    input_schema: obj(
      {
        surfaceKind: hmiSurfaceKindSchema,
        surfaceId: str("Target surface id from get_hmi_overview/get_hmi_surface."),
        typeId: str("Registered HMI typeId, e.g. common.button or common.numeric-display."),
        name: str("Optional element name."),
      },
      ["surfaceKind", "surfaceId", "typeId"],
    ),
  },
  {
    name: "set_hmi_tag_binding",
    description: "Bind an existing HMI element property to a tag. The project-action layer validates missing tags as HMI findings.",
    input_schema: obj(
      {
        surfaceKind: hmiSurfaceKindSchema,
        surfaceId: str("Target surface id."),
        elementId: str("Existing element id from get_hmi_surface."),
        targetProperty: str("Bindable property, e.g. value, text, or enabled."),
        tagPath: str("Tag path to bind, e.g. MotorRun."),
        dataType: str("Optional data type, e.g. BOOL or DINT."),
        mode: { type: "string", enum: ["read", "write", "read-write"], description: "Binding mode." },
      },
      ["surfaceKind", "surfaceId", "elementId", "targetProperty", "tagPath"],
    ),
  },
  {
    name: "add_hmi_navigation_event",
    description: "Add a safe runtime-preview navigation command to an existing HMI element event, usually a button press.",
    input_schema: obj(
      {
        surfaceKind: hmiSurfaceKindSchema,
        surfaceId: str("Surface containing the button/element."),
        elementId: str("Existing element id from get_hmi_surface."),
        targetScreenId: str("Screen id to navigate to."),
        eventType: { type: "string", enum: ["press", "release"], description: "Event type; press is typical." },
      },
      ["surfaceKind", "surfaceId", "elementId", "targetScreenId"],
    ),
  },
];

export const ALL_AGENT_TOOLS: AgentToolDef[] = [...READ_TOOLS, ...WRITE_TOOLS];
const READ_TOOL_NAMES = new Set(READ_TOOLS.map((t) => t.name));

export const isWriteTool = (name: string): boolean => name in WRITE_TOOL_TO_KIND;
export const isReadTool = (name: string): boolean => READ_TOOL_NAMES.has(name);
export const isKnownTool = (name: string): boolean => isReadTool(name) || isWriteTool(name);

/** Build the previewable project-action for a write tool call. Throws for non-write tools. */
export function writeToolToAction(name: string, input: Record<string, unknown>): ProposedProjectAction {
  const kind = WRITE_TOOL_TO_KIND[name];
  if (!kind) throw new Error(`Not a write tool: ${name}`);
  const s = (k: string) => (typeof input[k] === "string" ? (input[k] as string) : undefined);
  let actionInput: Record<string, unknown> = input;

  if (name === "create_hmi_screen") {
    actionInput = { ...input, screenId: s("screenId") ?? createId("hmiscreen") };
  } else if (name === "create_hmi_popup") {
    actionInput = { ...input, popupId: s("popupId") ?? createId("hmipopup") };
  } else if (name === "add_hmi_registered_element") {
    const typeId = s("typeId");
    if (typeId && !getHmiElementDefinition(typeId)) {
      throw new Error(`HMI element type "${typeId}" is not registered. Use list_hmi_element_types first.`);
    }
    actionInput = { ...input, elementId: s("elementId") ?? createId("hmiel") };
  } else if (name === "set_hmi_tag_binding") {
    const mode = input.mode === "write" || input.mode === "read-write" ? input.mode : "read";
    actionInput = {
      surfaceKind: input.surfaceKind,
      surfaceId: input.surfaceId,
      elementId: input.elementId,
      binding: {
        id: s("bindingId") ?? createId("hmibind"),
        targetProperty: s("targetProperty") ?? "",
        source: { kind: "tag", path: s("tagPath") ?? "", dataType: s("dataType") },
        mode,
      },
    };
  } else if (name === "add_hmi_navigation_event") {
    const eventType = input.eventType === "release" ? "release" : "press";
    actionInput = {
      surfaceKind: input.surfaceKind,
      surfaceId: input.surfaceId,
      elementId: input.elementId,
      eventType,
      command: {
        id: s("commandId") ?? createId("hmicmd"),
        type: "navigate",
        safety: "runtime-preview",
        args: { screenId: s("targetScreenId") ?? "" },
      },
    };
  }

  let label = kind;
  if (name === "create_tag") label = `Create tag ${s("name")} (${s("dataType") ?? "BOOL"})`;
  else if (name === "rename_tag") label = `Rename tag ${s("from")} → ${s("to")}`;
  else if (name === "delete_tag") label = `Delete tag ${s("name")}`;
  else if (name === "set_tag_description") label = `Describe tag ${s("name")}`;
  else if (name === "create_routine") label = `Create routine ${s("name")}`;
  else if (name === "add_rung_from_text") label = `Add rung: ${s("text")}`;
  else if (name === "add_rung") label = `Add empty rung to ${s("routineId")}`;
  else if (name === "delete_rung") label = `Delete rung ${s("rungId")}`;
  else if (name === "add_instruction") label = `Add ${s("instructionType")} to rung`;
  else if (name === "remove_instruction") label = `Remove instruction ${s("nodeId")}`;
  else if (name === "update_instruction_operand") label = `Set operand → ${s("value")}`;
  else if (name === "set_rung_comment") label = `Comment rung: ${s("comment")}`;
  else if (name === "add_parallel_branch") label = `Add parallel branch`;
  else if (name === "add_branch_leg") label = `Add branch leg`;
  else if (name === "add_instruction_to_branch") label = `Add ${s("instructionType")} to branch`;
  else if (name === "create_hmi_screen") label = `Create HMI screen ${s("name")}`;
  else if (name === "create_hmi_popup") label = `Create HMI popup ${s("name")}`;
  else if (name === "add_hmi_registered_element") label = `Add HMI ${s("typeId")} to ${s("surfaceId")}`;
  else if (name === "set_hmi_tag_binding") label = `Bind HMI ${s("elementId")} ${s("targetProperty")} to ${s("tagPath")}`;
  else if (name === "add_hmi_navigation_event") label = `Navigate from ${s("elementId")} to ${s("targetScreenId")}`;
  return { id: createId("act"), kind, label, description: `Proposed ${kind}`, input: actionInput };
}

/** Execute a read-only tool against the (working) project. Returns human/model-readable text. */
export function executeReadTool(
  project: PlcProject,
  name: string,
  input: Record<string, unknown>,
  selection?: AssistantSelection,
): string {
  switch (name) {
    case "get_project_overview": {
      const lines: string[] = [];
      let tagCount = 0;
      for (const controller of project.controllers) {
        tagCount += controller.controllerTags.length;
        lines.push(`Controller ${controller.name}:`);
        for (const program of controller.programs) {
          tagCount += program.programTags.length;
          lines.push(`  Program ${program.name} [${program.id}] (${program.routines.length} routine(s)):`);
          for (const routine of program.routines) {
            lines.push(`    Routine ${routine.name} [${routine.id}] — ${getLadder(routine)?.rungs.length ?? 0} rung(s)`);
          }
        }
      }
      lines.push(`Total tags: ${tagCount}.`);
      if (selection?.routineId) lines.push(`Currently selected routineId: ${selection.routineId}.`);
      return lines.join("\n") || "Empty project.";
    }
    case "list_routines": {
      const rows: string[] = [];
      for (const controller of project.controllers)
        for (const program of controller.programs)
          for (const routine of program.routines)
            rows.push(`${program.name} [${program.id}] / ${routine.name} [${routine.id}] — ${getLadder(routine)?.rungs.length ?? 0} rung(s)`);
      return rows.join("\n") || "No routines.";
    }
    case "get_routine": {
      const routine = findRoutine(project, String(input.routineId ?? ""));
      if (!routine) return `No routine with id ${String(input.routineId)}.`;
      const ladder = getLadder(routine);
      if (!ladder || ladder.rungs.length === 0) return `Routine ${routine.name} has no rungs.`;
      const lines = [`Routine ${routine.name} (${ladder.rungs.length} rung(s)):`];
      for (const rung of [...ladder.rungs].sort((a, b) => a.number - b.number)) {
        lines.push(`  rung ${rung.number} [${rung.id}]${rung.comment ? ` // ${rung.comment}` : ""}`);
        for (const node of rungNodes(rung)) {
          lines.push(`    ${node.instructionType}(${node.operands.map((o) => o.value).join(",")}) [node ${node.id}]`);
        }
      }
      return lines.join("\n");
    }
    case "list_tags": {
      const rows = getAllTags(project).map((tag) => `${tag.name} : ${tag.dataType}`);
      return rows.join("\n") || "No tags defined.";
    }
    case "get_validation_findings": {
      const findings = validate(project);
      if (findings.length === 0) return "Validation clean — no findings.";
      return `${findings.length} finding(s):\n${findings
        .map((f) => `[${f.severity}] ${f.message}${f.target ? ` (${f.target})` : ""}`)
        .join("\n")}`;
    }
    case "get_cross_references": {
      const refs = collectTagReferences(project, String(input.tagName ?? ""));
      if (refs.length === 0) return `No references to ${String(input.tagName)}.`;
      return refs.map((r) => `${r.programName}/${r.routineName} rung ${r.rungNumber}: ${r.instructionType} (${r.direction})`).join("\n");
    }
    case "get_instruction_metadata": {
      const type = String(input.instructionType ?? "").toUpperCase();
      const def = registry.get(type);
      if (!def) return `${type} is not in the instruction registry (unsupported — preserved read-only, not simulated).`;
      return `${type} — ${def.displayName}. Operands: ${def.operands.map((o) => o.name).join(", ") || "(none)"}.`;
    }
    case "get_hmi_overview": {
      const hmi = getHmiProject(project);
      if (!hmi) return "No HMI project is configured. Creating an HMI screen will initialize one through project-actions.";
      const findings = validateHmiProject(hmi, { knownTagPaths: knownTagPaths(project) });
      const lines = [
        `HMI "${hmi.name}" [${hmi.id}] on ${hmi.targetDevice.name} (${hmi.targetDevice.width}x${hmi.targetDevice.height}).`,
        `Screens (${hmi.screens.length}):`,
      ];
      for (const screen of hmi.screens) {
        lines.push(`  ${screen.name} [${screen.id}]${hmi.homeScreenId === screen.id ? " home" : ""} — ${screen.elements.length} element(s)`);
      }
      lines.push(`Popups (${hmi.popups.length}):`);
      for (const popup of hmi.popups) lines.push(`  ${popup.name} [${popup.id}] — ${popup.elements.length} element(s)`);
      lines.push(`System banner [${hmi.systemBanner.id}] — ${hmi.systemBanner.elements.length} element(s)`);
      lines.push(`HMI validation: ${findings.length} finding(s).`);
      if (findings.length) {
        lines.push(...findings.slice(0, 8).map((finding) => `  [${finding.severity}] ${finding.message}${finding.target ? ` (${finding.target})` : ""}`));
      }
      return lines.join("\n");
    }
    case "list_hmi_element_types": {
      return HMI_ELEMENT_DEFINITIONS.map(
        (definition) =>
          `${definition.typeId} — ${definition.displayName} (${definition.category}, ${definition.runtimeSupport}): ${definition.description}`,
      ).join("\n");
    }
    case "get_hmi_surface": {
      const hmi = getHmiProject(project);
      if (!hmi) return "No HMI project is configured.";
      const surfaceKind = String(input.surfaceKind ?? "") as HmiSurfaceKind;
      const surfaceId = String(input.surfaceId ?? "");
      const surface = findHmiSurface(hmi, surfaceKind, surfaceId);
      if (!surface) return `No HMI ${surfaceKind || "surface"} with id ${surfaceId}.`;
      const lines = [
        `${surface.kind} "${surface.name}" [${surface.id}] ${surface.width}x${surface.height}, ${surface.elements.length} element(s):`,
      ];
      if (surface.elements.length === 0) lines.push("  (empty)");
      for (const element of surface.elements) lines.push(`  ${formatHmiElement(element)}`);
      return lines.join("\n");
    }
    case "get_hmi_validation_findings": {
      const hmi = getHmiProject(project);
      const findings = validateHmiProject(hmi, { knownTagPaths: knownTagPaths(project) });
      if (findings.length === 0) return "HMI validation clean — no findings.";
      return `${findings.length} HMI finding(s):\n${findings
        .map((finding) => `[${finding.severity}] ${finding.message}${finding.target ? ` (${finding.target})` : ""}`)
        .join("\n")}`;
    }
    default:
      return `Unknown read tool: ${name}`;
  }
}
