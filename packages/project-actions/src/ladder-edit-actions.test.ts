import { describe, expect, it } from "vitest";
import {
  createController,
  createProgram,
  createProject,
  createRoutine,
  type PlcProject,
} from "@esco/core";
import {
  createBranch,
  createLadderRoutine,
  createNode,
  rungNodes,
  type InstructionOperand,
  type LadderBranch,
  type LadderRoutine,
} from "@esco/ladder";
import {
  addInstructionToBranch,
  addBranchLeg,
  addParallelBranch,
  addInstruction,
  addRung,
  createTag,
  crossReferenceRung,
  deleteRung,
  insertInstruction,
  insertRung,
  moveInstruction,
  pasteInstruction,
  pasteRung,
  removeInstruction,
  setRungComment,
  updateInstructionOperand,
  verifyRung,
} from "./index";

interface Base {
  project: PlcProject;
  routineId: string;
  programId: string;
}

function baseProject(): Base {
  const project = createProject("Edit Actions");
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

function ladderOf(project: PlcProject): LadderRoutine {
  return project.controllers[0]!.programs[0]!.routines[0]!.ladder as LadderRoutine;
}

/** Build the seal-in motor rung XIC(StartPB) XIO(StopPB) OTE(MotorRun) via actions. */
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
    ids[tag] = added.data!.nodeId;
    p = updateInstructionOperand(p, { routineId, rungId, nodeId: added.data!.nodeId, index: 0, value: tag }).project;
  }
  for (const name of ["StartPB", "StopPB", "MotorRun"]) {
    p = createTag(p, { name, dataType: "BOOL" }).project;
  }
  return { project: p, routineId, rungId, ids };
}

describe("insertRung", () => {
  it("inserts an empty rung above an existing rung", () => {
    const base = baseProject();
    const first = addRung(base.project, { routineId: base.routineId });
    const rungId = first.data!.rungId;
    const result = insertRung(first.project, { routineId: base.routineId, rungId, position: "above" });
    expect(result.ok).toBe(true);
    const ladder = ladderOf(result.project);
    expect(ladder.rungs).toHaveLength(2);
    expect(ladder.rungs.map((rung) => rung.number)).toEqual([0, 1]);
    // The new rung is first and empty; the original now sits at index 1.
    expect(rungNodes(ladder.rungs[0]!)).toHaveLength(0);
    expect(ladder.rungs[1]!.id).toBe(rungId);
  });

  it("inserts below and does not mutate the input project", () => {
    const base = baseProject();
    const first = addRung(base.project, { routineId: base.routineId });
    const snapshot = JSON.stringify(first.project);
    const result = insertRung(first.project, { routineId: base.routineId, rungId: first.data!.rungId, position: "below" });
    expect(ladderOf(result.project).rungs).toHaveLength(2);
    expect(ladderOf(result.project).rungs[0]!.id).toBe(first.data!.rungId);
    expect(JSON.stringify(first.project)).toBe(snapshot);
  });

  it("fails for an unknown rung id", () => {
    const base = baseProject();
    const result = insertRung(base.project, { routineId: base.routineId, rungId: "missing", position: "above" });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not found/i);
  });
});

describe("moveInstruction", () => {
  it("reorders an instruction after a target within the series", () => {
    const built = buildMotorRung(baseProject());
    const result = moveInstruction(built.project, {
      routineId: built.routineId,
      rungId: built.rungId,
      nodeId: built.ids.StartPB!,
      targetNodeId: built.ids.MotorRun!,
      position: "after",
    });
    expect(result.ok).toBe(true);
    const series = rungNodes(ladderOf(result.project).rungs[0]!);
    expect(series.map((node) => node.operands[0]?.value)).toEqual(["StopPB", "MotorRun", "StartPB"]);
    // The moved instruction keeps its id (cross-references stay stable).
    expect(series.find((node) => node.operands[0]?.value === "StartPB")!.id).toBe(built.ids.StartPB);
  });

  it("reorders an instruction before a target within the series", () => {
    const built = buildMotorRung(baseProject());
    const result = moveInstruction(built.project, {
      routineId: built.routineId,
      rungId: built.rungId,
      nodeId: built.ids.MotorRun!,
      targetNodeId: built.ids.StartPB!,
      position: "before",
    });
    expect(result.ok).toBe(true);
    expect(rungNodes(ladderOf(result.project).rungs[0]!).map((node) => node.operands[0]?.value)).toEqual([
      "MotorRun",
      "StartPB",
      "StopPB",
    ]);
  });

  it("fails when an instruction is moved relative to itself", () => {
    const built = buildMotorRung(baseProject());
    const result = moveInstruction(built.project, {
      routineId: built.routineId,
      rungId: built.rungId,
      nodeId: built.ids.StartPB!,
      targetNodeId: built.ids.StartPB!,
      position: "after",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/itself/i);
  });

  it("fails for an unknown instruction id", () => {
    const built = buildMotorRung(baseProject());
    const result = moveInstruction(built.project, {
      routineId: built.routineId,
      rungId: built.rungId,
      nodeId: "missing",
      targetNodeId: built.ids.StartPB!,
      position: "after",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not found/i);
  });

  it("fails for an invalid position and does not mutate the input project", () => {
    const built = buildMotorRung(baseProject());
    const snapshot = JSON.stringify(built.project);
    const result = moveInstruction(built.project, {
      routineId: built.routineId,
      rungId: built.rungId,
      nodeId: built.ids.StartPB!,
      targetNodeId: built.ids.MotorRun!,
      position: "sideways" as "before",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/before/i);
    expect(JSON.stringify(built.project)).toBe(snapshot);
  });
});

describe("pasteInstruction", () => {
  it("appends a fresh-id clone of a copied instruction, operands intact", () => {
    const built = buildMotorRung(baseProject());
    const source = rungNodes(ladderOf(built.project).rungs[0]!).find((n) => n.operands[0]?.value === "StartPB")!;
    const result = pasteInstruction(built.project, {
      routineId: built.routineId,
      rungId: built.rungId,
      node: source,
    });
    expect(result.ok).toBe(true);
    const series = rungNodes(ladderOf(result.project).rungs[0]!);
    // Appended to the terminal series, after the existing OTE.
    expect(series.map((n) => n.operands[0]?.value)).toEqual(["StartPB", "StopPB", "MotorRun", "StartPB"]);
    const pasted = series.at(-1)!;
    expect(pasted.instructionType).toBe("XIC");
    expect(pasted.id).not.toBe(source.id); // fresh id, never a duplicate
    expect(result.data!.nodeId).toBe(pasted.id);
  });

  it("pastes before an anchor instruction", () => {
    const built = buildMotorRung(baseProject());
    const motorRun = rungNodes(ladderOf(built.project).rungs[0]!).find((n) => n.operands[0]?.value === "MotorRun")!;
    const start = rungNodes(ladderOf(built.project).rungs[0]!).find((n) => n.operands[0]?.value === "StartPB")!;
    const result = pasteInstruction(built.project, {
      routineId: built.routineId,
      rungId: built.rungId,
      nodeId: motorRun.id,
      position: "before",
      node: start,
    });
    expect(result.ok).toBe(true);
    expect(rungNodes(ladderOf(result.project).rungs[0]!).map((n) => n.operands[0]?.value)).toEqual([
      "StartPB",
      "StopPB",
      "StartPB",
      "MotorRun",
    ]);
  });

  it("fails when there is nothing to paste", () => {
    const built = buildMotorRung(baseProject());
    const result = pasteInstruction(built.project, {
      routineId: built.routineId,
      rungId: built.rungId,
      node: { id: "x", instructionType: "", operands: [] },
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/nothing to paste/i);
  });
});

describe("pasteRung relative", () => {
  it("pastes a copied rung directly below the anchor with fresh ids", () => {
    const built = buildMotorRung(baseProject());
    const source = ladderOf(built.project).rungs[0]!;
    // Add a trailing empty rung so we can prove the paste lands BELOW rung 0, not at the end.
    const withTail = addRung(built.project, { routineId: built.routineId });
    const result = pasteRung(withTail.project, {
      routineId: built.routineId,
      root: source.root,
      rungId: built.rungId,
      position: "below",
    });
    expect(result.ok).toBe(true);
    const ladder = ladderOf(result.project);
    expect(ladder.rungs).toHaveLength(3);
    // Pasted rung is index 1 (below the motor rung), tail empty rung is last.
    const pasted = ladder.rungs[1]!;
    expect(rungNodes(pasted).map((node) => node.operands[0]?.value)).toEqual(["StartPB", "StopPB", "MotorRun"]);
    expect(pasted.id).not.toBe(source.id);
    expect(result.data!.rungId).toBe(pasted.id);
  });

  it("still appends to the end when no anchor is given (back-compat)", () => {
    const built = buildMotorRung(baseProject());
    const source = ladderOf(built.project).rungs[0]!;
    const result = pasteRung(built.project, { routineId: built.routineId, root: source.root });
    const ladder = ladderOf(result.project);
    expect(ladder.rungs).toHaveLength(2);
    expect(ladder.rungs[1]!.id).toBe(result.data!.rungId);
  });

  it("rejects malformed or cyclic pasted roots before cloning", () => {
    const base = baseProject();
    const malformed = pasteRung(base.project, {
      routineId: base.routineId,
      root: { id: "bad" } as LadderBranch,
    });
    expect(malformed.ok).toBe(false);
    expect(malformed.error).toMatch(/malformed/i);

    const cyclic = createBranch([]);
    cyclic.next = cyclic;
    const cycle = pasteRung(base.project, { routineId: base.routineId, root: cyclic });
    expect(cycle.ok).toBe(false);
    expect(cycle.error).toMatch(/cycle/i);

    const duplicatedBranch = createBranch([]);
    duplicatedBranch.next = { ...createBranch([]), id: duplicatedBranch.id };
    const duplicateBranch = pasteRung(base.project, { routineId: base.routineId, root: duplicatedBranch });
    expect(duplicateBranch.ok).toBe(false);
    expect(duplicateBranch.error).toMatch(/duplicated/i);

    const duplicateNodeId = createBranch([
      { ...createNode("XIC", [{ name: "tag", kind: "tag", value: "A" }]), id: "same-node" },
      { ...createNode("XIO", [{ name: "tag", kind: "tag", value: "B" }]), id: "same-node" },
    ]);
    const duplicateNode = pasteRung(base.project, { routineId: base.routineId, root: duplicateNodeId });
    expect(duplicateNode.ok).toBe(false);
    expect(duplicateNode.error).toMatch(/duplicated/i);

    const missingOperandKind = createBranch([
      createNode("XIC", [{ name: "tag", value: "A" } as unknown as InstructionOperand]),
    ]);
    const badOperand = pasteRung(base.project, { routineId: base.routineId, root: missingOperandKind });
    expect(badOperand.ok).toBe(false);
    expect(badOperand.error).toMatch(/operand is malformed/i);
  });
});

describe("insertInstruction", () => {
  it("inserts a new instruction before an anchor instruction", () => {
    const built = buildMotorRung(baseProject());
    const result = insertInstruction(built.project, {
      routineId: built.routineId,
      rungId: built.rungId,
      nodeId: built.ids.MotorRun!,
      instructionType: "XIC",
      position: "before",
    });
    expect(result.ok).toBe(true);
    const rung = ladderOf(result.project).rungs[0]!;
    expect(rungNodes(rung).map((node) => node.instructionType)).toEqual(["XIC", "XIO", "XIC", "OTE"]);
  });

  it("inserts after an anchor instruction", () => {
    const built = buildMotorRung(baseProject());
    const result = insertInstruction(built.project, {
      routineId: built.routineId,
      rungId: built.rungId,
      nodeId: built.ids.StartPB!,
      instructionType: "ONS",
      position: "after",
    });
    const rung = ladderOf(result.project).rungs[0]!;
    expect(rungNodes(rung).map((node) => node.instructionType)).toEqual(["XIC", "ONS", "XIO", "OTE"]);
  });

  it("fails when the anchor instruction is absent", () => {
    const built = buildMotorRung(baseProject());
    const result = insertInstruction(built.project, {
      routineId: built.routineId,
      rungId: built.rungId,
      nodeId: "missing",
      instructionType: "XIC",
      position: "after",
    });
    expect(result.ok).toBe(false);
  });
});

describe("ladder mutation guards", () => {
  it("rejects non-ladder surfaces without creating ladder data", () => {
    const project = createProject("Surface Guards");
    const controller = createController(project.id, "DemoController");
    const program = createProgram(controller.id, "MainProgram");
    const routine = createRoutine(program.id, "StructuredRoutine", "structured-text");
    routine.structuredText = "XIC(StartPB);";
    program.routines.push(routine);
    controller.programs.push(program);
    project.controllers.push(controller);
    const snapshot = JSON.stringify(project);

    const result = addRung(project, { routineId: routine.id });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not a ladder routine/i);
    expect(JSON.stringify(result.project)).toBe(snapshot);
    expect(result.project.controllers[0]!.programs[0]!.routines[0]!.ladder).toBeUndefined();
  });

  it("reports an invalid routine id instead of a vague missing rung", () => {
    const built = buildMotorRung(baseProject());
    const result = deleteRung(built.project, { routineId: "missing-routine", rungId: built.rungId });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Routine "missing-routine" not found/i);
  });

  it("rejects invalid relative targets without mutating the project", () => {
    const built = buildMotorRung(baseProject());
    const source = ladderOf(built.project).rungs[0]!;
    const snapshot = JSON.stringify(built.project);

    const badInsert = insertRung(built.project, {
      routineId: built.routineId,
      rungId: built.rungId,
      position: "sideways" as "above",
    });
    expect(badInsert.ok).toBe(false);
    expect(badInsert.error).toMatch(/above.*below/i);
    expect(JSON.stringify(badInsert.project)).toBe(snapshot);

    const halfAnchoredPaste = pasteRung(built.project, {
      routineId: built.routineId,
      root: source.root,
      rungId: built.rungId,
    });
    expect(halfAnchoredPaste.ok).toBe(false);
    expect(halfAnchoredPaste.error).toMatch(/above.*below/i);
    expect(JSON.stringify(halfAnchoredPaste.project)).toBe(snapshot);

    const badInstructionInsert = insertInstruction(built.project, {
      routineId: built.routineId,
      rungId: built.rungId,
      nodeId: built.ids.StartPB!,
      instructionType: "XIC",
      position: "around" as "after",
    });
    expect(badInstructionInsert.ok).toBe(false);
    expect(badInstructionInsert.error).toMatch(/before.*after/i);
    expect(JSON.stringify(badInstructionInsert.project)).toBe(snapshot);
  });

  it("rejects blank instruction types before creating unsupported boxes", () => {
    const built = buildMotorRung(baseProject());
    const snapshot = JSON.stringify(built.project);

    const result = addInstruction(built.project, {
      routineId: built.routineId,
      rungId: built.rungId,
      instructionType: " ",
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/instruction type/i);
    expect(JSON.stringify(result.project)).toBe(snapshot);
  });

  it("rejects invalid operand indexes without mutating the project", () => {
    const built = buildMotorRung(baseProject());
    const snapshot = JSON.stringify(built.project);
    const negative = updateInstructionOperand(built.project, {
      routineId: built.routineId,
      rungId: built.rungId,
      nodeId: built.ids.StartPB!,
      index: -1,
      value: "Bad",
    });
    expect(negative.ok).toBe(false);
    expect(negative.error).toMatch(/operand index/i);
    expect(JSON.stringify(negative.project)).toBe(snapshot);

    const infinite = updateInstructionOperand(built.project, {
      routineId: built.routineId,
      rungId: built.rungId,
      nodeId: built.ids.StartPB!,
      index: Number.POSITIVE_INFINITY,
      value: "Bad",
    });
    expect(infinite.ok).toBe(false);
    expect(infinite.error).toMatch(/operand index/i);
    expect(JSON.stringify(infinite.project)).toBe(snapshot);
  });

  it("rejects fixed-arity registered operand indexes without growing hidden operands", () => {
    const built = buildMotorRung(baseProject());
    const snapshot = JSON.stringify(built.project);
    const result = updateInstructionOperand(built.project, {
      routineId: built.routineId,
      rungId: built.rungId,
      nodeId: built.ids.StartPB!,
      index: 1,
      value: "Unexpected",
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/outside that range/i);
    expect(JSON.stringify(result.project)).toBe(snapshot);
    expect(rungNodes(ladderOf(result.project).rungs[0]!)[0]!.operands).toHaveLength(1);
  });

  it("rejects rung-scoped mutations when a rung id appears more than once", () => {
    const built = buildMotorRung(baseProject());
    const withSecond = addRung(built.project, { routineId: built.routineId });
    const duplicateProject = withSecond.project;
    const ladder = ladderOf(duplicateProject);
    ladder.rungs[1]!.id = built.rungId;
    const snapshot = JSON.stringify(duplicateProject);

    const remove = deleteRung(duplicateProject, { routineId: built.routineId, rungId: built.rungId });
    expect(remove.ok).toBe(false);
    expect(remove.error).toMatch(/appears 2 times/i);
    expect(JSON.stringify(remove.project)).toBe(snapshot);

    const add = addInstruction(duplicateProject, { routineId: built.routineId, rungId: built.rungId, instructionType: "XIC" });
    expect(add.ok).toBe(false);
    expect(add.error).toMatch(/duplicate ladder IDs/i);

    const comment = setRungComment(duplicateProject, { routineId: built.routineId, rungId: built.rungId, comment: "Nope" });
    expect(comment.ok).toBe(false);
    expect(comment.error).toMatch(/duplicate ladder IDs/i);
  });

  it("rejects instruction mutations when a node id appears more than once in the rung", () => {
    const built = buildMotorRung(baseProject());
    const ladder = ladderOf(built.project);
    ladder.rungs[0]!.root.nodes[1]!.id = built.ids.StartPB!;

    const remove = removeInstruction(built.project, {
      routineId: built.routineId,
      rungId: built.rungId,
      nodeId: built.ids.StartPB!,
    });
    expect(remove.ok).toBe(false);
    expect(remove.error).toMatch(/appears 2 times/i);

    const insert = insertInstruction(built.project, {
      routineId: built.routineId,
      rungId: built.rungId,
      nodeId: built.ids.StartPB!,
      instructionType: "XIC",
      position: "after",
    });
    expect(insert.ok).toBe(false);
    expect(insert.error).toMatch(/duplicate ladder IDs/i);

    const edit = updateInstructionOperand(built.project, {
      routineId: built.routineId,
      rungId: built.rungId,
      nodeId: built.ids.StartPB!,
      index: 0,
      value: "Bad",
    });
    expect(edit.ok).toBe(false);
    expect(edit.error).toMatch(/duplicate ladder IDs/i);
  });

  it("rejects branch mutations when a branch id appears more than once in the rung", () => {
    const built = buildMotorRung(baseProject());
    const branched = addParallelBranch(built.project, { routineId: built.routineId, rungId: built.rungId });
    expect(branched.ok).toBe(true);
    const ladder = ladderOf(branched.project);
    const root = ladder.rungs[0]!.root;
    root.parallelBranches![0]!.id = root.id;

    const result = addInstructionToBranch(branched.project, {
      routineId: built.routineId,
      rungId: built.rungId,
      branchId: root.id,
      instructionType: "XIC",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/appears 2 times/i);
  });

  it("rejects auto-pruning an emptied branch leg when that leg id is duplicated", () => {
    const built = buildMotorRung(baseProject());
    const branched = addParallelBranch(built.project, { routineId: built.routineId, rungId: built.rungId });
    const root = ladderOf(branched.project).rungs[0]!.root;
    const leg = root.parallelBranches![0]!;
    const filledLeg = addInstructionToBranch(branched.project, {
      routineId: built.routineId,
      rungId: built.rungId,
      branchId: leg.id,
      instructionType: "XIC",
    });
    expect(filledLeg.ok).toBe(true);
    const nodeId = ladderOf(filledLeg.project).rungs[0]!.root.parallelBranches![0]!.nodes[0]!.id;
    const withSibling = addBranchLeg(filledLeg.project, { routineId: built.routineId, rungId: built.rungId });
    expect(withSibling.ok).toBe(true);
    const branches = ladderOf(withSibling.project).rungs[0]!.root.parallelBranches!;
    branches[1]!.id = branches[0]!.id;

    const result = removeInstruction(withSibling.project, {
      routineId: built.routineId,
      rungId: built.rungId,
      nodeId,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/appears 2 times/i);
  });
});

describe("verifyRung", () => {
  it("reports a clean rung with zero errors", () => {
    const built = buildMotorRung(baseProject());
    const result = verifyRung(built.project, { routineId: built.routineId, rungId: built.rungId });
    expect(result.ok).toBe(true);
    expect(result.data!.errorCount).toBe(0);
    expect(result.data!.rungNumber).toBe(0);
    expect(result.data!.routineName).toBe("MainRoutine");
  });

  it("surfaces a finding for an undefined tag used on the rung", () => {
    const base = baseProject();
    const rung = addRung(base.project, { routineId: base.routineId });
    let p = rung.project;
    const rungId = rung.data!.rungId;
    const added = addInstruction(p, { routineId: base.routineId, rungId, instructionType: "XIC" });
    p = added.project;
    p = updateInstructionOperand(p, {
      routineId: base.routineId,
      rungId,
      nodeId: added.data!.nodeId,
      index: 0,
      value: "GhostTag",
    }).project;
    // GhostTag is never created, so validation should flag it on this rung.
    const result = verifyRung(p, { routineId: base.routineId, rungId });
    expect(result.ok).toBe(true);
    expect(result.data!.findings.length).toBeGreaterThan(0);
    expect(result.data!.findings.some((finding) => finding.message.includes("GhostTag"))).toBe(true);
  });

  it("surfaces a structural finding that names the rung but no operand tag", () => {
    const base = baseProject();
    const rung = addRung(base.project, { routineId: base.routineId });
    let p = rung.project;
    const rungId = rung.data!.rungId;
    for (const type of ["XIC", "OTE", "RTO"]) {
      p = addInstruction(p, { routineId: base.routineId, rungId, instructionType: type }).project;
    }

    const result = verifyRung(p, { routineId: base.routineId, rungId });

    expect(result.ok).toBe(true);
    expect(result.data!.findings.some((finding) => /same execution path/i.test(finding.message))).toBe(true);
  });

  it("fails for an unknown rung", () => {
    const base = baseProject();
    const result = verifyRung(base.project, { routineId: base.routineId, rungId: "missing" });
    expect(result.ok).toBe(false);
  });
});

describe("crossReferenceRung", () => {
  it("returns the tags used on the rung and their references", () => {
    const built = buildMotorRung(baseProject());
    const result = crossReferenceRung(built.project, { routineId: built.routineId, rungId: built.rungId });
    expect(result.ok).toBe(true);
    expect(result.data!.tags).toEqual(["StartPB", "StopPB", "MotorRun"]);
    expect(result.data!.references.length).toBeGreaterThanOrEqual(3);
    expect(result.data!.references.every((ref) => result.data!.tags.includes(ref.tag))).toBe(true);
  });
});
