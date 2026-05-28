// The agent's tool surface. This is the security boundary for the live agent:
// the model may ONLY call tools defined here. Read tools are executed live and
// never mutate; write tools are mapped to controlled @esco/project-actions and
// returned as a previewable plan (applied only on user Apply). Anything not in
// this whitelist is rejected. There are deliberately NO file/shell/network/PLC/
// .ACD/eval/state-mutation tools.

import type { PlcProject } from "@esco/core";
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
  return { id: createId("act"), kind, label, description: `Proposed ${kind}`, input };
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
    default:
      return `Unknown read tool: ${name}`;
  }
}
