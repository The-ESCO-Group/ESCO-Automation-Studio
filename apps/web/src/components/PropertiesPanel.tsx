import { Panel } from "@esco/ui";
import type { PlcProject, Tag } from "@esco/core";
import {
  baseTagName,
  createDefaultRegistry,
  describeModelOnlyInstructionReview,
  isNumericLiteral,
  modelOnlyBoundaryLabel,
  type ModelOnlyInstructionReviewOperand,
} from "@esco/instructions";
import { rungNodes, type LadderNode, type LadderRoutine, type LadderRung } from "@esco/ladder";
import { collectTagReferences, findRoutine, getLadder, tagCommentPreview, tagCommentRows } from "@esco/project-actions";
import type { ValidationFinding } from "@esco/validator";
import type { Selection } from "../selection";
import type { TagValues } from "../simulation";

const registry = createDefaultRegistry();

interface Props {
  project: PlcProject;
  selection: Selection;
  values: TagValues;
  findings: ValidationFinding[];
}

interface Row {
  label: string;
  value: string;
}

function findTag(project: PlcProject, id: string): Tag | undefined {
  for (const controller of project.controllers) {
    const ctrlTag = controller.controllerTags.find((t) => t.id === id);
    if (ctrlTag) return ctrlTag;
    for (const program of controller.programs) {
      const progTag = program.programTags.find((t) => t.id === id);
      if (progTag) return progTag;
    }
  }
  return undefined;
}

function tagValue(values: TagValues, tag: Tag): string {
  return String(values[tag.name] ?? (tag.dataType === "BOOL" ? false : 0));
}

/** Distinct tags read / written across a set of nodes (member paths → base tag). */
function readsWrites(nodes: LadderNode[]): { reads: string[]; writes: string[] } {
  const reads = new Set<string>();
  const writes = new Set<string>();
  for (const node of nodes) {
    const def = registry.get(node.instructionType);
    node.operands.forEach((operand, index) => {
      const operandDef = def?.operands[index];
      if (operandDef?.isRoutineRef || operandDef?.isLabelRef) return;
      const value = operand.value.trim();
      if (!value || isNumericLiteral(value)) return;
      const base = baseTagName(value);
      if (!base) return;
      (operandDef?.direction === "write" ? writes : reads).add(base);
    });
  }
  return { reads: [...reads], writes: [...writes] };
}

function routineFindings(findings: ValidationFinding[], routineName: string): ValidationFinding[] {
  return findings.filter((f) => f.target?.includes(`/${routineName}`));
}

function instructionStatus(def: ReturnType<typeof registry.get>): string {
  if (!def) return "Unknown unsupported (read-only)";
  return def.modelOnly ? "Model-only / preserved, not simulated" : "Executable";
}

function reviewOperandRoleLabel(operand: ModelOnlyInstructionReviewOperand): string {
  if (operand.role === "tag" || operand.role === "expression") {
    return `${operand.declaredDirection} ${operand.role}`;
  }
  return operand.role;
}

interface View {
  heading: string;
  rows: Row[];
  findings?: ValidationFinding[];
  hint?: string;
}

function buildView(props: Props): View | null {
  const { project, selection, values, findings } = props;
  if (!selection) return null;

  if (selection.kind === "project") {
    return {
      heading: "Project",
      rows: [
        { label: "Name", value: project.name },
        { label: "Description", value: project.description ?? "—" },
        { label: "Created", value: project.createdAt ? new Date(project.createdAt).toLocaleString() : "—" },
        { label: "Updated", value: project.updatedAt ? new Date(project.updatedAt).toLocaleString() : "—" },
        { label: "Controllers", value: String(project.controllers.length) },
      ],
      hint: "Project properties are read-only until a project-action exists for editing them.",
    };
  }

  if (selection.kind === "controller") {
    const controller = project.controllers.find((c) => c.id === selection.id);
    if (!controller) return null;
    return {
      heading: "Controller",
      rows: [
        { label: "Name", value: controller.name },
        { label: "Processor", value: controller.processorType ?? "—" },
        { label: "Catalog", value: controller.catalogNumber ?? "—" },
        { label: "Firmware", value: controller.firmwareRevision ?? "—" },
        { label: "Slot", value: controller.slot != null ? String(controller.slot) : "—" },
        { label: "Programs", value: String(controller.programs.length) },
        { label: "Tasks", value: String(controller.tasks.length) },
        { label: "Tags", value: String(controller.controllerTags.length) },
      ],
    };
  }

  if (selection.kind === "task") {
    for (const controller of project.controllers) {
      const task = controller.tasks.find((candidate) => candidate.id === selection.id);
      if (task) {
        return {
          heading: "Task",
          rows: [
            { label: "Name", value: task.name },
            { label: "Type", value: task.type },
            { label: "Period", value: task.periodMs != null ? `${task.periodMs} ms` : "—" },
            { label: "Priority", value: task.priority != null ? String(task.priority) : "—" },
            { label: "Watchdog", value: task.watchdogMs != null ? `${task.watchdogMs} ms` : "—" },
            { label: "Inhibited", value: task.inhibited ? "yes" : "no" },
            { label: "Scheduled programs", value: String(task.scheduledProgramIds.length) },
          ],
          hint: "Imported task metadata only. The scheduler is not connected to a controller.",
        };
      }
    }
    return null;
  }

  if (selection.kind === "program") {
    for (const controller of project.controllers) {
      const program = controller.programs.find((p) => p.id === selection.id);
      if (program) {
        return {
          heading: "Program",
          rows: [
            { label: "Name", value: program.name },
            { label: "Routines", value: String(program.routines.length) },
            { label: "Program tags", value: String(program.programTags.length) },
            { label: "Parameters", value: String(program.parameters?.length ?? 0) },
            { label: "Inhibited", value: program.inhibited ? "yes" : "no" },
            { label: "Description", value: program.description ?? "—" },
          ],
          hint: "Program metadata is read-only unless a project-action exists for editing it.",
        };
      }
    }
    return null;
  }

  if (selection.kind === "tag") {
    const tag = findTag(project, selection.id);
    if (!tag) return null;
    const refs = collectTagReferences(project, tag.name);
    const written = refs.some((r) => r.direction === "write");
    const commentRows = tagCommentRows(tag);
    return {
      heading: "Tag",
      rows: [
        { label: "Name", value: tag.name },
        { label: "Type", value: tag.dataType },
        { label: "Scope", value: tag.scope },
        { label: "Role", value: written ? "output" : refs.length ? "input" : "internal" },
        { label: "References", value: String(refs.length) },
        { label: "Value", value: tagValue(values, tag) },
        { label: "Description", value: tag.description ?? "—" },
        { label: "Element/member comments", value: String(commentRows.length) },
        { label: "Comment preview", value: tagCommentPreview(tag) || "—" },
      ],
    };
  }

  if (selection.kind === "routine") {
    const routine = findRoutine(project, selection.id);
    if (!routine) return null;
    const ladder = getLadder(routine) as LadderRoutine | undefined;
    const nodes = ladder ? ladder.rungs.flatMap((r) => rungNodes(r)) : [];
    const { reads, writes } = readsWrites(nodes);
    return {
      heading: "Routine",
      rows: [
        { label: "Name", value: routine.name },
        { label: "Language", value: routine.language },
        { label: "Rungs", value: String(ladder?.rungs.length ?? 0) },
        { label: "Tags read", value: reads.join(", ") || "—" },
        { label: "Outputs", value: writes.join(", ") || "—" },
      ],
      findings: routineFindings(findings, routine.name),
    };
  }

  // Structure nodes (AOI / UDT / I/O) have their own center detail view.
  if (selection.kind !== "rung" && selection.kind !== "instruction") return null;

  // rung / instruction
  const routine = findRoutine(project, selection.routineId);
  const ladder = getLadder(routine) as LadderRoutine | undefined;
  const rung: LadderRung | undefined = ladder?.rungs.find((r) => r.id === selection.rungId);
  if (!routine || !rung) return null;

  if (selection.kind === "instruction") {
    const node = rungNodes(rung).find((n) => n.id === selection.nodeId);
    if (!node) return null;
    const def = registry.get(node.instructionType);
    const modelOnlyReview = describeModelOnlyInstructionReview(def, node);
    const rows: Row[] = [
      { label: "Instruction", value: node.instructionType },
      { label: "Name", value: def?.displayName ?? "Unknown unsupported block" },
      { label: "Status", value: instructionStatus(def) },
      { label: "Routine", value: routine.name },
      { label: "Rung", value: String(rung.number) },
    ];
    if (modelOnlyReview) {
      const missing = modelOnlyReview.operands.filter((operand) => operand.missing).map((operand) => operand.label);
      rows.push(
        { label: "Review behavior", value: "Pass-through rung power" },
        { label: "Runtime boundary", value: modelOnlyReview.boundaries.map(modelOnlyBoundaryLabel).join("; ") },
        { label: "Missing operands", value: missing.join(", ") || "—" },
      );
    }
    node.operands.forEach((operand, index) => {
      const operandDef = def?.operands[index];
      const reviewOperand = modelOnlyReview?.operands[index];
      // Keyword/label operands (e.g. GSV/SSV class & attribute names, JMP/LBL
      // targets) and routine references are not tag reads — label them by their
      // role rather than implying a data direction they don't have.
      const role = reviewOperand ? reviewOperandRoleLabel(reviewOperand) : (operandDef?.isLabelRef
        ? "keyword"
        : operandDef?.isRoutineRef
          ? "routine"
          : operandDef?.direction ?? "read");
      rows.push({
        label: reviewOperand?.label ?? operandDef?.label ?? `op${index}`,
        value: `${operand.value || "—"} (${role})`,
      });
    });
    return { heading: "Instruction", rows, hint: def?.description };
  }

  const { reads, writes } = readsWrites(rungNodes(rung));
  return {
    heading: "Rung",
    rows: [
      { label: "Routine", value: routine.name },
      { label: "Rung", value: String(rung.number) },
      { label: "Comment", value: rung.comment ?? "—" },
      { label: "Instructions", value: String(rungNodes(rung).length) },
      { label: "Tags read", value: reads.join(", ") || "—" },
      { label: "Tags written", value: writes.join(", ") || "—" },
    ],
    findings: routineFindings(findings, routine.name),
  };
}

export function PropertiesPanel(props: Props) {
  const view = buildView(props);

  return (
    <Panel title="Properties">
      {!view ? (
        <div className="esco-props__hints">
          <p className="esco-empty">Nothing selected.</p>
          <ul>
            <li>Select a routine to edit its ladder.</li>
            <li>Click a rung or instruction to inspect it.</li>
            <li>Select a tag to see its references and value.</li>
          </ul>
        </div>
      ) : (
        <>
          <div className="esco-props__heading">{view.heading}</div>
          <dl className="esco-props">
            {view.rows.map((row) => (
              <div className="esco-props__row" key={row.label}>
                <dt>{row.label}</dt>
                <dd>{row.value}</dd>
              </div>
            ))}
          </dl>
          {view.hint ? <p className="esco-props__hint">{view.hint}</p> : null}
          {view.findings ? (
            <div className="esco-props__findings">
              <div className="esco-props__heading">Validation ({view.findings.length})</div>
              {view.findings.length === 0 ? (
                <p className="esco-empty">No findings for this routine.</p>
              ) : (
                <ul>
                  {view.findings.slice(0, 6).map((f, i) => (
                    <li key={i} className={`esco-props__finding esco-props__finding--${f.severity}`}>
                      {f.message}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}
        </>
      )}
    </Panel>
  );
}
