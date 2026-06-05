import type { PlcProject } from "@esco/core";
import type { ValidationFinding, ValidationRule } from "./types";

/**
 * A program designated as an organizational folder (`UseAsFolder="true"`) is
 * purely structural: Studio 5000 uses it only to group child programs in the
 * Controller Organizer. A folder program owns no executable logic — it has no
 * main routine and is never scheduled under a task. The "Use as Folder" property
 * page reflects this by hiding the schedule/main-routine controls the moment the
 * box is ticked, so Studio 5000 itself can never produce a folder program that
 * is also scheduled or that names a main routine.
 *
 * The importer (`extractPrograms.ts`) sets {@link Program.useAsFolder} only when
 * the attribute is literally `"true"`, and the exporter writes `UseAsFolder`
 * back whenever the flag is set, so the folder designation round-trips
 * unchanged. That means a contradictory combination authored offline — a folder
 * program dropped into a task's scheduled-program list, or one left holding a
 * `MainRoutineName` after the box was ticked — or one carried in from a
 * hand-edited L5X survives the round-trip and reaches Studio 5000 as a verify
 * error (a folder cannot be scheduled / cannot have a main routine).
 *
 * This is the folder-program companion to `task-scheduling` (which guards the
 * single-task / unscheduled-program constraints for ordinary programs but treats
 * a folder's *absence* from any task as the legal, expected state) and to
 * `missing-main-routine` (which expects every *executable* program to declare a
 * main routine). Both of those would otherwise read a folder program as a
 * legitimately-unscheduled, intentionally-routine-less program; this rule
 * catches the opposite hazard — a folder being treated as executable. A freshly
 * imported, valid project never trips it, so it fires only on the
 * offline-edit / hand-edited-L5X case the other `task-*`/program rules also
 * guard. Reported as an error because the controller will not verify until the
 * folder is emptied of executable configuration (or the folder flag cleared).
 */
export const programFolderUsage: ValidationRule = {
  id: "program-folder-usage",
  name: "Program folder usage",
  category: "project-structure",
  severity: "error",
  run({ project }: { project: PlcProject }) {
    const findings: ValidationFinding[] = [];
    for (const controller of project.controllers) {
      // Programs scheduled by at least one task (inhibited or not — a folder is
      // never scheduled regardless of the owning task's state).
      const scheduledProgramIds = new Set<string>();
      for (const task of controller.tasks) {
        for (const programId of task.scheduledProgramIds) {
          scheduledProgramIds.add(programId);
        }
      }

      for (const program of controller.programs) {
        if (program.useAsFolder !== true) continue;
        if (program.mainRoutineId) {
          findings.push({
            ruleId: "program-folder-usage",
            severity: "error",
            message: `Program "${program.name}" is a folder (UseAsFolder) but declares a main routine; a folder program owns no executable logic.`,
            target: `${controller.name}/${program.name}`,
          });
        }
        if (scheduledProgramIds.has(program.id)) {
          const owners = controller.tasks
            .filter((task) => task.scheduledProgramIds.includes(program.id))
            .map((task) => task.name);
          findings.push({
            ruleId: "program-folder-usage",
            severity: "error",
            message: `Program "${program.name}" is a folder (UseAsFolder) but is scheduled under task "${owners[0]}"; folder programs are organizational only and are never scheduled.`,
            target: `${controller.name}/${program.name}`,
          });
        }
      }
    }
    return findings;
  },
};
