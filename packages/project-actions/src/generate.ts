import {
  createController,
  createProgram,
  createProject,
  createRoutine,
  createTag,
  type PlcProject,
} from "@esco/core";
import { createLadderRoutine, createNode, createRung, tagOperand } from "@esco/ladder";

export interface LargeProjectOptions {
  controllerTags?: number;
  programs?: number;
  routinesPerProgram?: number;
  rungsPerRoutine?: number;
}

/**
 * Generate a synthetic project for performance/stress testing. Tags are BOOL
 * `Bit0…`; each rung is a simple `XIC XIO OTE` over rotating tags so the project
 * validates, cross-references, and simulates like a real (if repetitive) one.
 */
export function generateLargeProject(options: LargeProjectOptions = {}): PlcProject {
  const tagCount = Math.max(3, options.controllerTags ?? 500);
  const programs = options.programs ?? 5;
  const routinesPerProgram = options.routinesPerProgram ?? 5;
  const rungsPerRoutine = options.rungsPerRoutine ?? 50;

  const project = createProject("Large Synthetic Project");
  const controller = createController(project.id, "BigController");
  for (let i = 0; i < tagCount; i++) {
    controller.controllerTags.push(createTag(controller.id, `Bit${i}`, "BOOL", { value: false }));
  }

  for (let p = 0; p < programs; p++) {
    const program = createProgram(controller.id, `Program${p}`);
    for (let r = 0; r < routinesPerProgram; r++) {
      const routine = createRoutine(program.id, `Routine${p}_${r}`, "ladder");
      if (r === 0) program.mainRoutineId = routine.id;
      const ladder = createLadderRoutine();
      for (let g = 0; g < rungsPerRoutine; g++) {
        const a = g % tagCount;
        const b = (g + 1) % tagCount;
        const c = (g + 2) % tagCount;
        ladder.rungs.push(
          createRung(ladder.id, g, [
            createNode("XIC", [tagOperand("tag", `Bit${a}`)]),
            createNode("XIO", [tagOperand("tag", `Bit${b}`)]),
            createNode("OTE", [tagOperand("tag", `Bit${c}`)]),
          ]),
        );
      }
      routine.ladder = ladder;
      program.routines.push(routine);
    }
    controller.programs.push(program);
  }
  project.controllers.push(controller);
  return project;
}
