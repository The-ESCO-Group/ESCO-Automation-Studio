import { createDemoProject } from "@esco/core";
import { createDefaultRegistry } from "@esco/instructions";
import {
  createBranch,
  createLadderRoutine,
  createNode,
  createRung,
  tagOperand,
  type LadderRoutine,
} from "@esco/ladder";
import { collectOutputTags, createRuntime } from "./build";
import { PlcRuntime, type TagDescriptor } from "./runtime";

/** Human-readable form of the demo rung, shown in the editor and Watch panel. */
export const DEMO_RUNG_TEXT =
  "[ XIC(StartPB) ‖ XIC(MotorRun) ] XIO(StopPB) OTE(MotorRun)";

/**
 * The demo rung as a semantic ladder model: a seal-in (latching) motor starter.
 *
 *   ┌ XIC(StartPB) ┐
 *   ┤              ├ XIO(StopPB) ─ OTE(MotorRun)
 *   └ XIC(MotorRun)┘
 *
 * StartPB OR the sealed-back MotorRun contact powers the rung; while StopPB is
 * clear the coil latches, so MotorRun stays on after StartPB is released and
 * only drops when StopPB is pressed.
 */
export function buildDemoLadderRoutine(): LadderRoutine {
  const routine = createLadderRoutine();
  const rung = createRung(routine.id, 0, [], "Seal-in motor starter");
  rung.root = createBranch([createNode("XIC", [tagOperand("tag", "StartPB")])], {
    parallelBranches: [
      createBranch([createNode("XIC", [tagOperand("tag", "MotorRun")])]),
    ],
    next: createBranch([
      createNode("XIO", [tagOperand("tag", "StopPB")]),
      createNode("OTE", [tagOperand("tag", "MotorRun")]),
    ]),
  });
  routine.rungs.push(rung);
  return routine;
}

/**
 * Build a ready-to-scan runtime for the start/stop motor demo. Tags come from
 * the core demo project (the single source of truth); a tag's role is derived
 * from the ladder itself — anything written by a coil instruction is an output.
 */
export function createDemoRuntime(): PlcRuntime {
  const registry = createDefaultRegistry();
  const routine = buildDemoLadderRoutine();
  const outputs = collectOutputTags(routine, registry);

  const project = createDemoProject();
  const tags: TagDescriptor[] = [];
  for (const controller of project.controllers) {
    for (const tag of controller.controllerTags) {
      if (tag.dataType !== "BOOL") continue;
      tags.push({
        name: tag.name,
        dataType: tag.dataType,
        role: outputs.has(tag.name) ? "output" : "input",
        initialValue: tag.value === true,
      });
    }
  }

  return createRuntime({ routine, tags, registry });
}
