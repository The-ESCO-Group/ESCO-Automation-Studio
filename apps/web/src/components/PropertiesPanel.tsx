import { Panel } from "@esco/ui";
import type { PlcProject } from "@esco/core";
import type { Selection } from "../selection";

interface Props {
  project: PlcProject;
  selection: Selection;
}

type Row = { label: string; value: string };

function rowsFor(project: PlcProject, selection: Selection): Row[] {
  if (!selection) return [];
  for (const controller of project.controllers) {
    if (selection.kind === "controller" && controller.id === selection.id) {
      return [
        { label: "Name", value: controller.name },
        { label: "Processor", value: controller.processorType ?? "—" },
        { label: "Programs", value: String(controller.programs.length) },
        { label: "Tasks", value: String(controller.tasks.length) },
      ];
    }
    for (const program of controller.programs) {
      if (selection.kind === "program" && program.id === selection.id) {
        return [
          { label: "Name", value: program.name },
          { label: "Routines", value: String(program.routines.length) },
          { label: "Main routine", value: program.mainRoutineId ? "set" : "—" },
        ];
      }
      for (const routine of program.routines) {
        if (selection.kind === "routine" && routine.id === selection.id) {
          return [
            { label: "Name", value: routine.name },
            { label: "Language", value: routine.language },
            { label: "Program", value: program.name },
          ];
        }
      }
    }
    for (const tag of controller.controllerTags) {
      if (selection.kind === "tag" && tag.id === selection.id) {
        return [
          { label: "Name", value: tag.name },
          { label: "Data type", value: tag.dataType },
          { label: "Scope", value: tag.scope },
          { label: "Value", value: String(tag.value ?? "—") },
          { label: "Description", value: tag.description ?? "—" },
        ];
      }
    }
  }
  return [];
}

export function PropertiesPanel({ project, selection }: Props) {
  const rows = rowsFor(project, selection);
  return (
    <Panel title="Properties">
      {rows.length === 0 ? (
        <p className="esco-empty">Nothing selected.</p>
      ) : (
        <dl className="esco-props">
          {rows.map((row) => (
            <div className="esco-props__row" key={row.label}>
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </Panel>
  );
}
