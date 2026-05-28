import { beforeEach, describe, expect, it } from "vitest";
import {
  createController,
  createProgram,
  createProject,
  createRoutine,
  createTag as makeTag,
  type PlcProject,
} from "@esco/core";
import { createLadderRoutine, type LadderRoutine } from "@esco/ladder";
import {
  addBranchLeg,
  addInstruction,
  addInstructionToBranch,
  addParallelBranch,
  addRung,
  addRungFromText,
  collectTagReferences,
  createRoutine as createRoutineAction,
  createTag,
  defaultValues,
  deleteRung,
  deleteTag,
  duplicateRung,
  exportProjectJson,
  generateLargeProject,
  importL5XFile,
  importProjectFile,
  pasteRung,
  removeBranchLeg,
  removeInstruction,
  renameTag,
  scanProject,
  setTagDescription,
  traceScan,
  updateInstructionOperand,
  validateProject,
  type TagValues,
} from "./index";

/** The root branch of a rung, read straight from the demo project structure. */
function rootOf(project: PlcProject, rungId: string) {
  const ladder = project.controllers[0]!.programs[0]!.routines[0]!.ladder as LadderRoutine;
  return ladder.rungs.find((r) => r.id === rungId)!.root;
}

interface Base {
  project: PlcProject;
  routineId: string;
  programId: string;
}

function baseProject(): Base {
  const project = createProject("Test");
  const controller = createController(project.id, "DemoController");
  const program = createProgram(controller.id, "MainProgram");
  const routine = createRoutine(program.id, "MainRoutine", "ladder");
  routine.ladder = createLadderRoutine();
  program.mainRoutineId = routine.id;
  program.routines.push(routine);
  controller.programs.push(program);
  project.controllers.push(controller);
  return { project, routineId: routine.id, programId: program.id };
}

/** Build the XIC(StartPB) XIO(StopPB) OTE(MotorRun) rung + tags through actions. */
function buildMotorRung(base: Base) {
  let p = base.project;
  const { routineId } = base;

  const rung = addRung(p, { routineId });
  p = rung.project;
  const rungId = rung.data!.rungId;

  const ids: Record<string, string> = {};
  for (const [type, tag] of [["XIC", "StartPB"], ["XIO", "StopPB"], ["OTE", "MotorRun"]] as const) {
    const added = addInstruction(p, { routineId, rungId, instructionType: type });
    p = added.project;
    const nodeId = added.data!.nodeId;
    ids[tag] = nodeId;
    p = updateInstructionOperand(p, { routineId, rungId, nodeId, index: 0, value: tag }).project;
  }
  for (const name of ["StartPB", "StopPB", "MotorRun"]) {
    p = createTag(p, { name, dataType: "BOOL" }).project;
  }
  return { project: p, routineId, rungId, ids };
}

describe("project-actions: immutability", () => {
  let base: Base;
  beforeEach(() => {
    base = baseProject();
  });

  it("never mutates the input project", () => {
    const snapshot = JSON.stringify(base.project);
    addRung(base.project, { routineId: base.routineId });
    createTag(base.project, { name: "Foo", dataType: "BOOL" });
    expect(JSON.stringify(base.project)).toBe(snapshot);
  });
});

describe("project-actions: build a rung and scan it", () => {
  it("adds a rung, XIC/XIO/OTE, tags, then simulates", () => {
    const { project } = buildMotorRung(baseProject());

    // Start pressed, stop clear -> MotorRun energizes.
    let values: TagValues = { ...defaultValues(project), StartPB: true };
    values = scanProject(project, values).data!.values;
    expect(values.MotorRun).toBe(true);

    // Stop pressed -> MotorRun drops.
    values = scanProject(project, { ...values, StopPB: true }).data!.values;
    expect(values.MotorRun).toBe(false);
  });
});

describe("project-actions: large project stress", () => {
  it("validates, cross-references, and scans a large synthetic project", () => {
    // ~640 rungs, 300 tags, 16 routines.
    const project = generateLargeProject({
      controllerTags: 300,
      programs: 4,
      routinesPerProgram: 4,
      rungsPerRoutine: 40,
    });
    expect(project.controllers[0]!.controllerTags).toHaveLength(300);

    const validated = validateProject(project);
    expect(validated.ok).toBe(true);
    // Every operand resolves (tags exist) → no undefined-tag findings.
    expect(validated.findings?.some((f) => f.ruleId === "undefined-tag")).toBe(false);

    const refs = collectTagReferences(project);
    expect(refs.length).toBeGreaterThan(1000);

    const scan = scanProject(project, defaultValues(project));
    expect(scan.ok).toBe(true);
  });
});

describe("project-actions: trace and forces", () => {
  it("captures a per-instruction execution trace", () => {
    const { project } = buildMotorRung(baseProject());
    const { trace } = traceScan(project, { ...defaultValues(project), StartPB: true });
    expect(trace.length).toBeGreaterThan(0);
    const ote = trace.find((entry) => entry.instruction === "OTE");
    expect(ote).toBeDefined();
    expect(ote!.conditionIn).toBe(true);
    expect(ote!.writes.some((w) => w.path === "MotorRun" && w.value === true)).toBe(true);
  });

  it("a forced tag overrides logic during a scan (force wins)", () => {
    const { project } = buildMotorRung(baseProject());
    // StartPB true would energize MotorRun, but a force pins it false.
    const values = scanProject(
      project,
      { ...defaultValues(project), StartPB: true },
      { forces: { MotorRun: false } },
    ).data!.values;
    expect(values.MotorRun).toBe(false);
  });
});

describe("project-actions: tags", () => {
  it("creates a tag and rejects duplicates", () => {
    const base = baseProject();
    const created = createTag(base.project, { name: "Lamp", dataType: "BOOL" });
    expect(created.ok).toBe(true);
    expect(created.data?.tagId).toBeTruthy();

    const dup = createTag(created.project, { name: "Lamp", dataType: "BOOL" });
    expect(dup.ok).toBe(false);
    expect(dup.error).toMatch(/already exists/);
  });

  it("flags an undefined operand, then create-tag clears it", () => {
    const base = baseProject();
    const rung = addRung(base.project, { routineId: base.routineId });
    const added = addInstruction(rung.project, {
      routineId: base.routineId,
      rungId: rung.data!.rungId,
      instructionType: "XIC",
    });
    const edited = updateInstructionOperand(added.project, {
      routineId: base.routineId,
      rungId: rung.data!.rungId,
      nodeId: added.data!.nodeId,
      index: 0,
      value: "Ghost",
    });
    expect(edited.findings?.some((f) => f.ruleId === "undefined-tag")).toBe(true);

    const fixed = createTag(edited.project, { name: "Ghost", dataType: "BOOL" });
    expect(fixed.findings?.some((f) => f.ruleId === "undefined-tag")).toBe(false);
  });

  it("updates a tag description", () => {
    const base = baseProject();
    const created = createTag(base.project, { name: "Lamp", dataType: "BOOL" });
    const described = setTagDescription(created.project, { name: "Lamp", description: "Status lamp" });
    expect(described.ok).toBe(true);
    const tag = described.project.controllers[0]!.controllerTags.find((t) => t.name === "Lamp");
    expect(tag?.description).toBe("Status lamp");
  });

  it("renames a tag and remaps operand references", () => {
    const built = buildMotorRung(baseProject());
    const renamed = renameTag(built.project, { from: "StartPB", to: "RunCmd" });
    expect(renamed.ok).toBe(true);
    // No dangling reference to the old name.
    expect(renamed.findings?.some((f) => f.message.includes("StartPB"))).toBe(false);

    let values: TagValues = { ...defaultValues(renamed.project), RunCmd: true };
    values = scanProject(renamed.project, values).data!.values;
    expect(values.MotorRun).toBe(true);
  });

  it("refuses to delete a referenced tag, allows deleting an unused one", () => {
    const built = buildMotorRung(baseProject());
    const blocked = deleteTag(built.project, { name: "StartPB" });
    expect(blocked.ok).toBe(false);
    expect(blocked.error).toMatch(/referenced/);

    const withUnused = createTag(built.project, { name: "Spare", dataType: "BOOL" });
    const removed = deleteTag(withUnused.project, { name: "Spare" });
    expect(removed.ok).toBe(true);
  });
});

describe("project-actions: rungs and routines", () => {
  it("deletes a rung and reports a missing rung", () => {
    const built = buildMotorRung(baseProject());
    const removed = deleteRung(built.project, { routineId: built.routineId, rungId: built.rungId });
    expect(removed.ok).toBe(true);

    const missing = deleteRung(built.project, { routineId: built.routineId, rungId: "nope" });
    expect(missing.ok).toBe(false);
  });

  it("removes an instruction", () => {
    const built = buildMotorRung(baseProject());
    const removed = removeInstruction(built.project, {
      routineId: built.routineId,
      rungId: built.rungId,
      nodeId: built.ids.StartPB,
    });
    expect(removed.ok).toBe(true);
  });

  it("duplicates a rung with fresh ids right after the original", () => {
    const built = buildMotorRung(baseProject());
    const result = duplicateRung(built.project, { routineId: built.routineId, rungId: built.rungId });
    expect(result.ok).toBe(true);
    const ladder = rootOf(result.project, built.rungId); // original still there
    expect(ladder).toBeDefined();

    const rungs = result.project.controllers[0]!.programs[0]!.routines[0]!.ladder as LadderRoutine;
    expect(rungs.rungs).toHaveLength(2);
    const [first, second] = rungs.rungs;
    expect(second!.id).not.toBe(first!.id); // fresh rung id
    expect(second!.id).toBe(result.data!.rungId);
    // Same logic, different node ids (deep clone).
    const firstNodes = first!.root.nodes.map((n) => n.instructionType);
    const secondNodes = second!.root.nodes.map((n) => n.instructionType);
    expect(secondNodes).toEqual(firstNodes);
    expect(second!.root.nodes[0]!.id).not.toBe(first!.root.nodes[0]!.id);
    // Renumbered 0,1.
    expect(rungs.rungs.map((r) => r.number)).toEqual([0, 1]);
  });

  it("copies a rung (root) and pastes it as a new rung with fresh ids", () => {
    const built = buildMotorRung(baseProject());
    const sourceRoot = rootOf(built.project, built.rungId);

    const pasted = pasteRung(built.project, { routineId: built.routineId, root: sourceRoot, comment: "Pasted" });
    expect(pasted.ok).toBe(true);
    const ladder = pasted.project.controllers[0]!.programs[0]!.routines[0]!.ladder as LadderRoutine;
    expect(ladder.rungs).toHaveLength(2);
    const newRung = ladder.rungs.find((r) => r.id === pasted.data!.rungId)!;
    expect(newRung.comment).toBe("Pasted");
    expect(newRung.root.id).not.toBe(sourceRoot.id); // cloned, not the same branch object
    expect(newRung.root.nodes.map((n) => n.instructionType)).toEqual(
      sourceRoot.nodes.map((n) => n.instructionType),
    );

    // Pasting again does not collide ids (clone each time).
    const twice = pasteRung(pasted.project, { routineId: built.routineId, root: sourceRoot });
    expect(twice.ok).toBe(true);
    const ladder2 = twice.project.controllers[0]!.programs[0]!.routines[0]!.ladder as LadderRoutine;
    const ids = ladder2.rungs.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length); // all unique
  });

  it("creates a routine in a program", () => {
    const base = baseProject();
    const result = createRoutineAction(base.project, { programId: base.programId, name: "Faults" });
    expect(result.ok).toBe(true);
    expect(result.data?.routineId).toBeTruthy();
  });

  it("addRungFromText builds a seal-in branch rung that simulates", () => {
    const base = baseProject();
    let p = addRungFromText(base.project, {
      routineId: base.routineId,
      text: "[XIC(StartPB),XIC(MotorRun)]XIO(StopPB)OTE(MotorRun)",
    }).project;
    for (const name of ["StartPB", "StopPB", "MotorRun"]) {
      p = createTag(p, { name, dataType: "BOOL" }).project;
    }

    let values: TagValues = { ...defaultValues(p), StartPB: true };
    values = scanProject(p, values).data!.values;
    expect(values.MotorRun).toBe(true);

    // Seal-in: release Start, MotorRun stays on.
    values = scanProject(p, { ...values, StartPB: false }).data!.values;
    expect(values.MotorRun).toBe(true);

    // Stop breaks it.
    values = scanProject(p, { ...values, StopPB: true }).data!.values;
    expect(values.MotorRun).toBe(false);
  });
});

describe("project-actions: branch editing", () => {
  // Build [XIC(StartPB) , XIC(MotorRun)] XIO(StopPB) OTE(MotorRun) entirely
  // through the controlled branch actions — the way the UI buttons drive it.
  function buildSealInByBranch() {
    const base = baseProject();
    const { routineId } = base;
    const rung = addRung(base.project, { routineId });
    let p = rung.project;
    const rungId = rung.data!.rungId;

    // Parallel branch → leg 1 = main line (root), leg 2 = first alternate.
    p = addParallelBranch(p, { routineId, rungId }).project;
    const root = rootOf(p, rungId);
    const leg1 = root.id;
    const leg2 = root.parallelBranches![0]!.id;

    const addToLeg = (branchId: string, type: string, tag: string) => {
      const added = addInstructionToBranch(p, { routineId, rungId, branchId, instructionType: type });
      p = added.project;
      p = updateInstructionOperand(p, { routineId, rungId, nodeId: added.data!.nodeId, value: tag }).project;
    };
    addToLeg(leg1, "XIC", "StartPB"); // leg 1: start contact
    addToLeg(leg2, "XIC", "MotorRun"); // leg 2: seal-in contact

    // Downstream series after the parallel merge.
    for (const [type, tag] of [["XIO", "StopPB"], ["OTE", "MotorRun"]] as const) {
      const a = addInstruction(p, { routineId, rungId, instructionType: type });
      p = a.project;
      p = updateInstructionOperand(p, { routineId, rungId, nodeId: a.data!.nodeId, value: tag }).project;
    }
    for (const name of ["StartPB", "StopPB", "MotorRun"]) {
      p = createTag(p, { name, dataType: "BOOL" }).project;
    }
    return { project: p, routineId, rungId, leg2 };
  }

  it("adds a parallel branch, then a second leg", () => {
    const base = baseProject();
    const { routineId } = base;
    const rung = addRung(base.project, { routineId });
    const rungId = rung.data!.rungId;

    const withBranch = addParallelBranch(rung.project, { routineId, rungId });
    expect(withBranch.ok).toBe(true);
    expect(rootOf(withBranch.project, rungId).parallelBranches).toHaveLength(1);

    const twoLegs = addBranchLeg(withBranch.project, { routineId, rungId });
    expect(twoLegs.ok).toBe(true);
    expect(rootOf(twoLegs.project, rungId).parallelBranches).toHaveLength(2);
  });

  it("rejects adding a leg before a parallel branch exists", () => {
    const base = baseProject();
    const rung = addRung(base.project, { routineId: base.routineId });
    const res = addBranchLeg(rung.project, { routineId: base.routineId, rungId: rung.data!.rungId });
    expect(res.ok).toBe(false);
  });

  it("removes an empty leg but refuses a populated one", () => {
    const { project, routineId, rungId, leg2 } = buildSealInByBranch();
    const blocked = removeBranchLeg(project, { routineId, rungId, branchId: leg2 });
    expect(blocked.ok).toBe(false);
    expect(blocked.error).toMatch(/empty/i);

    const added = addBranchLeg(project, { routineId, rungId });
    const legs = rootOf(added.project, rungId).parallelBranches!;
    const emptyLeg = legs[legs.length - 1]!.id;
    const removed = removeBranchLeg(added.project, { routineId, rungId, branchId: emptyLeg });
    expect(removed.ok).toBe(true);
    expect(rootOf(removed.project, rungId).parallelBranches).toHaveLength(1);
  });

  it("simulates the hand-built seal-in (latches, then stop breaks it)", () => {
    const { project } = buildSealInByBranch();
    let values: TagValues = { ...defaultValues(project), StartPB: true };
    values = scanProject(project, values).data!.values;
    expect(values.MotorRun).toBe(true);

    values = scanProject(project, { ...values, StartPB: false }).data!.values;
    expect(values.MotorRun).toBe(true); // sealed in by the parallel branch

    values = scanProject(project, { ...values, StopPB: true }).data!.values;
    expect(values.MotorRun).toBe(false); // stop breaks the seal
  });

  it("export/import preserves the branch structure", () => {
    const { project, rungId } = buildSealInByBranch();
    const restored = importProjectFile(exportProjectJson(project).data!.text);
    expect(restored.ok).toBe(true);
    expect(restored.project).toEqual(project);
    expect(rootOf(restored.project, rungId).parallelBranches).toHaveLength(1);
  });

  it("cross reference sees tags inside branch legs", () => {
    const { project } = buildSealInByBranch();
    const motor = collectTagReferences(project).filter((r) => r.tag === "MotorRun");
    // The seal-in contact lives inside leg 2; the coil is on the main line.
    expect(motor.some((r) => r.instructionType === "XIC" && r.direction === "read")).toBe(true);
    expect(motor.some((r) => r.instructionType === "OTE" && r.direction === "write")).toBe(true);
  });

  it("validation catches an undefined tag inside a branch leg", () => {
    const base = baseProject();
    const { routineId } = base;
    const rung = addRung(base.project, { routineId });
    const rungId = rung.data!.rungId;
    let p = addParallelBranch(rung.project, { routineId, rungId }).project;
    const leg2 = rootOf(p, rungId).parallelBranches![0]!.id;
    const added = addInstructionToBranch(p, { routineId, rungId, branchId: leg2, instructionType: "XIC" });
    p = added.project;
    const result = updateInstructionOperand(p, {
      routineId,
      rungId,
      nodeId: added.data!.nodeId,
      value: "GhostInBranch",
    });
    expect(
      result.findings?.some((f) => f.ruleId === "undefined-tag" && f.message.includes("GhostInBranch")),
    ).toBe(true);
  });
});

describe("project-actions: array tags", () => {
  it("expands an array tag into element value-paths and simulates them", () => {
    const base = baseProject();
    const ctrl = base.project.controllers[0]!;
    ctrl.controllerTags.push(makeTag(ctrl.id, "Arr", "DINT", { dimension: 8 }));
    ctrl.controllerTags.push(makeTag(ctrl.id, "Dest", "DINT"));
    const p = addRungFromText(base.project, {
      routineId: base.routineId,
      text: "MOV(7,Arr[2])MOV(Arr[2],Dest)",
    }).project;

    const defaults = defaultValues(p);
    expect(defaults["Arr[0]"]).toBe(0);
    expect(defaults["Arr[7]"]).toBe(0);
    expect("Arr[8]" in defaults).toBe(false); // dimension is 8 → indices 0..7

    const values = scanProject(p, defaults).data!.values;
    expect(values["Arr[2]"]).toBe(7); // written by MOV(7, Arr[2])
    expect(values["Dest"]).toBe(7); // read back via MOV(Arr[2], Dest)
  });

  it("resolves alias reads/writes to the base tag in simulation", () => {
    const base = baseProject();
    const ctrl = base.project.controllers[0]!;
    ctrl.controllerTags.push(makeTag(ctrl.id, "StartPB", "BOOL"));
    ctrl.controllerTags.push(makeTag(ctrl.id, "Run", "BOOL"));
    const alias = makeTag(ctrl.id, "MotorCmd", "BOOL");
    alias.aliasFor = "Run";
    ctrl.controllerTags.push(alias);

    // XIC(StartPB) OTE(MotorCmd) — writing the alias must land on its base, Run.
    const p = addRungFromText(base.project, { routineId: base.routineId, text: "XIC(StartPB)OTE(MotorCmd)" }).project;
    const values = scanProject(p, { ...defaultValues(p), StartPB: true }).data!.values;
    expect(values.Run).toBe(true);
  });

  it("flags an out-of-range array index and accepts an in-range one", () => {
    const base = baseProject();
    const ctrl = base.project.controllers[0]!;
    ctrl.controllerTags.push(makeTag(ctrl.id, "Arr", "DINT", { dimension: 4 }));
    ctrl.controllerTags.push(makeTag(ctrl.id, "Dest", "DINT"));

    const bad = addRungFromText(base.project, { routineId: base.routineId, text: "MOV(Arr[10],Dest)" }).project;
    expect(validateProject(bad).findings?.some((f) => f.ruleId === "array-index-out-of-range")).toBe(true);

    const good = addRungFromText(base.project, { routineId: base.routineId, text: "MOV(Arr[3],Dest)" }).project;
    expect(validateProject(good).findings?.some((f) => f.ruleId === "array-index-out-of-range")).toBe(false);
  });
});

describe("project-actions: nested branch editing", () => {
  // Build  [ XIC(Sel0) , [ XIC(Sel1) , XIC(Sel2) ] ] OTE(Out)  through actions:
  // a parallel on the root, then a nested parallel inside leg 2.
  function buildNested() {
    const base = baseProject();
    const { routineId } = base;
    const rung = addRung(base.project, { routineId });
    let p = rung.project;
    const rungId = rung.data!.rungId;

    const addToBranch = (branchId: string, type: string, tag: string) => {
      const added = addInstructionToBranch(p, { routineId, rungId, branchId, instructionType: type });
      p = added.project;
      p = updateInstructionOperand(p, { routineId, rungId, nodeId: added.data!.nodeId, value: tag }).project;
    };

    // Parallel on the root: root = leg1(main) | leg2.
    p = addParallelBranch(p, { routineId, rungId }).project;
    const rootId = rootOf(p, rungId).id;
    const leg2Id = rootOf(p, rungId).parallelBranches![0]!.id;

    // Nested parallel inside leg 2: leg2 = legA | legB.
    p = addParallelBranch(p, { routineId, rungId, branchId: leg2Id }).project;
    const nestedLegId = rootOf(p, rungId).parallelBranches![0]!.parallelBranches![0]!.id;

    addToBranch(rootId, "XIC", "Sel0"); // main line
    addToBranch(leg2Id, "XIC", "Sel1"); // leg 2 series
    addToBranch(nestedLegId, "XIC", "Sel2"); // nested leg

    // Downstream output after the root merge.
    const ote = addInstruction(p, { routineId, rungId, instructionType: "OTE" });
    p = ote.project;
    p = updateInstructionOperand(p, { routineId, rungId, nodeId: ote.data!.nodeId, value: "Out" }).project;

    for (const name of ["Sel0", "Sel1", "Sel2", "Out"]) {
      p = createTag(p, { name, dataType: "BOOL" }).project;
    }
    return { project: p, routineId, rungId, leg2Id, nestedLegId };
  }

  it("creates a nested parallel branch inside a leg", () => {
    const { project, rungId } = buildNested();
    const leg2 = rootOf(project, rungId).parallelBranches![0]!;
    expect(leg2.parallelBranches).toHaveLength(1); // nesting present
  });

  it("simulates nested OR logic (any of the selectors energizes the output)", () => {
    const { project } = buildNested();
    const off = scanProject(project, defaultValues(project)).data!.values;
    expect(off.Out).toBe(false);

    // Only the deeply-nested selector is true → still energizes via the nested OR.
    const viaNested = scanProject(project, { ...defaultValues(project), Sel2: true }).data!.values;
    expect(viaNested.Out).toBe(true);

    const viaMain = scanProject(project, { ...defaultValues(project), Sel0: true }).data!.values;
    expect(viaMain.Out).toBe(true);
  });

  it("cross-references an operand inside a nested branch", () => {
    const { project } = buildNested();
    const refs = collectTagReferences(project, "Sel2");
    expect(refs.length).toBeGreaterThan(0);
    expect(refs[0]!.instructionType).toBe("XIC");
  });

  it("validates an undefined tag inside a nested branch", () => {
    const { project, routineId, rungId, nestedLegId } = buildNested();
    const added = addInstructionToBranch(project, { routineId, rungId, branchId: nestedLegId, instructionType: "XIC" });
    const result = updateInstructionOperand(added.project, {
      routineId,
      rungId,
      nodeId: added.data!.nodeId,
      value: "GhostNested",
    });
    expect(
      result.findings?.some((f) => f.ruleId === "undefined-tag" && f.message.includes("GhostNested")),
    ).toBe(true);
  });

  it("preserves the nested branch through export/import", () => {
    const { project, rungId } = buildNested();
    const restored = importProjectFile(exportProjectJson(project).data!.text);
    expect(restored.ok).toBe(true);
    const leg2 = rootOf(restored.project, rungId).parallelBranches![0]!;
    expect(leg2.parallelBranches).toHaveLength(1);
  });

  it("removes an empty nested leg, refuses a populated one", () => {
    const { project, routineId, rungId, nestedLegId } = buildNested();
    // nestedLeg has XIC(Sel2) → cannot remove.
    expect(removeBranchLeg(project, { routineId, rungId, branchId: nestedLegId }).ok).toBe(false);

    // Add an empty nested leg and remove it.
    const leg2Id = rootOf(project, rungId).parallelBranches![0]!.id;
    const withLeg = addBranchLeg(project, { routineId, rungId, branchId: leg2Id });
    const legs = rootOf(withLeg.project, rungId).parallelBranches![0]!.parallelBranches!;
    const emptyLeg = legs[legs.length - 1]!.id;
    const removed = removeBranchLeg(withLeg.project, { routineId, rungId, branchId: emptyLeg });
    expect(removed.ok).toBe(true);
  });
});

describe("project-actions: subroutine execution (JSR / RET)", () => {
  it("runs a subroutine via JSR against shared memory", () => {
    const base = baseProject();
    const created = createRoutineAction(base.project, { programId: base.programId, name: "Sub" });
    let p = created.project;
    const subId = created.data!.routineId;
    p = addRungFromText(p, { routineId: subId, text: "MOV(99,Result)" }).project;
    p = addRungFromText(p, { routineId: base.routineId, text: "XIC(Run)JSR(Sub)" }).project;
    p = createTag(p, { name: "Run", dataType: "BOOL" }).project;
    p = createTag(p, { name: "Result", dataType: "DINT" }).project;

    // Run = true → JSR(Sub) executes → Result = 99.
    let values = scanProject(p, { ...defaultValues(p), Run: true }, { routineId: base.routineId }).data!.values;
    expect(values.Result).toBe(99);

    // Run = false → the JSR is not taken → Result stays 0.
    values = scanProject(p, defaultValues(p), { routineId: base.routineId }).data!.values;
    expect(values.Result).toBe(0);
  });

  it("RET ends a subroutine early (later rungs do not run)", () => {
    const base = baseProject();
    const created = createRoutineAction(base.project, { programId: base.programId, name: "Sub" });
    let p = created.project;
    const subId = created.data!.routineId;
    p = addRungFromText(p, { routineId: subId, text: "MOV(1,A)" }).project; // runs
    p = addRungFromText(p, { routineId: subId, text: "RET()" }).project; // returns
    p = addRungFromText(p, { routineId: subId, text: "MOV(2,B)" }).project; // skipped
    p = addRungFromText(p, { routineId: base.routineId, text: "JSR(Sub)" }).project;
    for (const name of ["A", "B"]) p = createTag(p, { name, dataType: "DINT" }).project;

    const values = scanProject(p, defaultValues(p), { routineId: base.routineId }).data!.values;
    expect(values.A).toBe(1); // executed before RET
    expect(values.B).toBe(0); // RET ended the routine before this rung
  });

  it("flags a JSR to an unknown routine as a warning (not an undefined tag)", () => {
    const base = baseProject();
    const p = addRungFromText(base.project, { routineId: base.routineId, text: "JSR(DoesNotExist)" }).project;
    const result = validateProject(p);
    expect(result.findings?.some((f) => f.ruleId === "unknown-routine")).toBe(true);
    expect(
      result.findings?.some((f) => f.ruleId === "undefined-tag" && f.message.includes("DoesNotExist")),
    ).toBe(false);
  });
});

describe("project-actions: validation and IO", () => {
  it("validateProject returns findings", () => {
    const built = buildMotorRung(baseProject());
    const result = validateProject(built.project);
    expect(result.ok).toBe(true);
    expect(result.data?.findingCount).toBe(result.findings?.length);
  });

  it("round-trips export -> import", () => {
    const { project } = buildMotorRung(baseProject());
    const exported = exportProjectJson(project);
    const imported = importProjectFile(exported.data!.text);
    expect(imported.ok).toBe(true);
    expect(imported.project).toEqual(project);
  });

  it("reports a clear error for an invalid project file", () => {
    const result = importProjectFile("{ not json");
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it("collects tag cross-references with direction and location", () => {
    const base = baseProject();
    const p = addRungFromText(base.project, {
      routineId: base.routineId,
      text: "XIC(StartPB)TON(Timer1,1000)",
    }).project;

    const refs = collectTagReferences(p);
    const start = refs.find((r) => r.tag === "StartPB");
    expect(start?.instructionType).toBe("XIC");
    expect(start?.direction).toBe("read");
    expect(start?.routineName).toBe("MainRoutine");
    expect(start?.rungNumber).toBe(0);

    const timer = refs.find((r) => r.tag === "Timer1");
    expect(timer?.instructionType).toBe("TON");
    expect(timer?.direction).toBe("write");

    // Filtering by tag name works (member paths resolve to the base tag).
    expect(collectTagReferences(p, "Timer1").every((r) => r.tag === "Timer1")).toBe(true);
  });

  it("validates a richer imported L5X cleanly (members/arrays resolve, PID flagged)", () => {
    const xml = `<?xml version="1.0"?>
<RSLogix5000Content>
  <Controller Name="Imported">
    <Tags>
      <Tag Name="Start" DataType="BOOL"/><Tag Name="Run" DataType="BOOL"/>
      <Tag Name="Stop" DataType="BOOL"/><Tag Name="Dwell" DataType="TIMER"/>
      <Tag Name="Cnt" DataType="COUNTER"/><Tag Name="Arr" DataType="DINT" Dimensions="4"/>
      <Tag Name="Dest" DataType="DINT"/>
    </Tags>
    <Programs>
      <Program Name="MainProgram" MainRoutineName="Main">
        <Routines><Routine Name="Main" Type="RLL"><RLLContent>
          <Rung Number="0"><Text><![CDATA[[XIC(Start),XIC(Run)]XIO(Stop)OTE(Run);]]></Text></Rung>
          <Rung Number="1"><Text><![CDATA[XIC(Run)RTO(Dwell,1000);]]></Text></Rung>
          <Rung Number="2"><Text><![CDATA[XIC(Dwell.DN)CTU(Cnt,5);]]></Text></Rung>
          <Rung Number="3"><Text><![CDATA[MOV(Arr[0],Dest);]]></Text></Rung>
          <Rung Number="4"><Text><![CDATA[XIC(Start)PID(Sub);]]></Text></Rung>
        </RLLContent></Routine></Routines>
      </Program>
    </Programs>
  </Controller>
</RSLogix5000Content>`;
    const imported = importL5XFile(xml);
    expect(imported.ok).toBe(true);

    const result = validateProject(imported.project);
    expect(result.ok).toBe(true);
    // Member (Dwell.DN) and array (Arr[0]) paths resolve to defined base tags.
    expect(result.findings?.some((f) => f.ruleId === "undefined-tag")).toBe(false);
    // The unsupported PID is reported as info, not an error.
    expect(result.findings?.some((f) => f.ruleId === "unsupported-instruction")).toBe(true);
  });

  it("imports an L5X file through the action layer", () => {
    const xml = `<?xml version="1.0"?>
<RSLogix5000Content>
  <Controller Name="Imported">
    <Tags><Tag Name="StartPB" DataType="BOOL"/><Tag Name="MotorRun" DataType="BOOL"/></Tags>
    <Programs>
      <Program Name="MainProgram" MainRoutineName="Main">
        <Routines><Routine Name="Main" Type="RLL"><RLLContent>
          <Rung Number="0"><Text><![CDATA[XIC(StartPB)OTE(MotorRun);]]></Text></Rung>
        </RLLContent></Routine></Routines>
      </Program>
    </Programs>
  </Controller>
</RSLogix5000Content>`;
    const result = importL5XFile(xml);
    expect(result.ok).toBe(true);
    expect(result.project.name).toBe("Imported");
    expect(result.data?.summary.rungs).toBe(1);
  });
});
