import { describe, expect, it } from "vitest";
import { createBranch, createLadderRoutine, createNode, tagOperand } from "./factory";
import {
  addBranchLeg,
  addParallelBranch,
  addRung,
  appendInstruction,
  appendNode,
  appendNodeToBranch,
  appendRungWithRoot,
  countNodeIdInBranch,
  duplicateRung,
  insertNodeRelativeToNode,
  insertRungAt,
  insertRungRelative,
  isParallelLeg,
  moveNode,
  removeBranchLeg,
  removeInstruction,
  removeRung,
  setOperandValue,
  setRungComment,
} from "./edit";
import { findBranchInRoot } from "./edit";
import type { LadderBranch, LadderRoutine } from "./types";
import { routineNodes, rungNodes } from "./traverse";

/** A three-rung routine whose rungs each carry one identifiable instruction. */
function threeRungRoutine() {
  let routine = createLadderRoutine();
  for (const tag of ["A", "B", "C"]) {
    routine = addRung(routine);
    const rungId = routine.rungs[routine.rungs.length - 1]!.id;
    routine = appendInstruction(routine, rungId, "XIC", tag);
  }
  return routine;
}

function rungTags(routine: ReturnType<typeof threeRungRoutine>) {
  return routine.rungs.map((rung) => rungNodes(rung).map((node) => node.operands[0]?.value).join(""));
}

describe("insertRungAt", () => {
  it("prepends at index 0 and renumbers", () => {
    const routine = insertRungAt(threeRungRoutine(), 0);
    expect(routine.rungs).toHaveLength(4);
    expect(routine.rungs.map((rung) => rung.number)).toEqual([0, 1, 2, 3]);
    expect(rungNodes(routine.rungs[0]!)).toHaveLength(0);
    expect(rungTags(routine)).toEqual(["", "A", "B", "C"]);
  });

  it("appends when index >= length", () => {
    const routine = insertRungAt(threeRungRoutine(), 99);
    expect(rungTags(routine)).toEqual(["A", "B", "C", ""]);
  });

  it("seeds the rung from a supplied root and comment", () => {
    const root = createBranch([createNode("OTE", [tagOperand("tag", "Seeded")])]);
    const routine = insertRungAt(createLadderRoutine(), 0, root, "hello");
    expect(routine.rungs[0]!.comment).toBe("hello");
    expect(rungNodes(routine.rungs[0]!)[0]?.operands[0]?.value).toBe("Seeded");
    expect(routine.rungs[0]!.root).not.toBe(root);
    expect(routine.rungs[0]!.root.id).not.toBe(root.id);
    expect(rungNodes(routine.rungs[0]!)[0]?.id).not.toBe(root.nodes[0]!.id);
  });

  it("does not mutate the input routine", () => {
    const before = threeRungRoutine();
    const snapshot = before.rungs.length;
    insertRungAt(before, 1);
    expect(before.rungs).toHaveLength(snapshot);
  });
});

describe("appendRungWithRoot", () => {
  it("clones a supplied parsed root with fresh ids", () => {
    const root = createBranch([createNode("XIC", [tagOperand("tag", "Parsed")])]);
    const routine = appendRungWithRoot(createLadderRoutine(), root, "from text");
    const rung = routine.rungs[0]!;
    expect(rung.comment).toBe("from text");
    expect(rung.root).not.toBe(root);
    expect(rung.root.id).not.toBe(root.id);
    expect(rungNodes(rung)[0]?.id).not.toBe(root.nodes[0]!.id);

    root.nodes[0]!.operands[0]!.value = "MutatedAfterAppend";
    expect(rungNodes(rung)[0]?.operands[0]?.value).toBe("Parsed");
  });
});

describe("insertRungRelative", () => {
  it("inserts above the target rung", () => {
    const base = threeRungRoutine();
    const middleId = base.rungs[1]!.id;
    const routine = insertRungRelative(base, middleId, "above");
    expect(rungTags(routine)).toEqual(["A", "", "B", "C"]);
  });

  it("inserts below the target rung", () => {
    const base = threeRungRoutine();
    const middleId = base.rungs[1]!.id;
    const routine = insertRungRelative(base, middleId, "below");
    expect(rungTags(routine)).toEqual(["A", "B", "", "C"]);
  });

  it("clones a supplied root with fresh ids (paste)", () => {
    const base = threeRungRoutine();
    const source = base.rungs[0]!.root;
    const routine = insertRungRelative(base, base.rungs[2]!.id, "below", source, "pasted");
    expect(rungTags(routine)).toEqual(["A", "B", "C", "A"]);
    const pasted = routine.rungs[3]!;
    expect(pasted.comment).toBe("pasted");
    // Fresh ids: the cloned root/node must not collide with the source.
    expect(pasted.root.id).not.toBe(source.id);
    expect(rungNodes(pasted)[0]?.id).not.toBe(rungNodes(base.rungs[0]!)[0]?.id);
  });

  it("is a no-op for an unknown rung id", () => {
    const base = threeRungRoutine();
    expect(insertRungRelative(base, "missing", "above")).toBe(base);
  });
});

describe("removeRung", () => {
  it("removes one rung and renumbers the remainder", () => {
    const base = threeRungRoutine();
    const routine = removeRung(base, base.rungs[1]!.id);
    expect(rungTags(routine)).toEqual(["A", "C"]);
    expect(routine.rungs.map((rung) => rung.number)).toEqual([0, 1]);
  });
});

describe("insertNodeRelativeToNode", () => {
  it("inserts before a target node in the series", () => {
    let routine = createLadderRoutine();
    routine = addRung(routine);
    const rungId = routine.rungs[0]!.id;
    routine = appendInstruction(routine, rungId, "XIC", "Start");
    routine = appendInstruction(routine, rungId, "OTE", "Run");
    const target = rungNodes(routine.rungs[0]!).find((node) => node.instructionType === "OTE")!;
    const inserted = createNode("XIO", [tagOperand("tag", "Stop")]);
    routine = insertNodeRelativeToNode(routine, rungId, target.id, inserted, "before");
    expect(rungNodes(routine.rungs[0]!).map((node) => node.instructionType)).toEqual(["XIC", "XIO", "OTE"]);
  });

  it("inserts after a target node in the series", () => {
    let routine = createLadderRoutine();
    routine = addRung(routine);
    const rungId = routine.rungs[0]!.id;
    routine = appendInstruction(routine, rungId, "XIC", "Start");
    const target = rungNodes(routine.rungs[0]!)[0]!;
    routine = insertNodeRelativeToNode(routine, rungId, target.id, createNode("OTE", [tagOperand("tag", "Run")]), "after");
    expect(rungNodes(routine.rungs[0]!).map((node) => node.instructionType)).toEqual(["XIC", "OTE"]);
  });

  it("inserts inside the parallel leg that holds the target node", () => {
    let routine = createLadderRoutine();
    routine = addRung(routine);
    const rungId = routine.rungs[0]!.id;
    routine = appendInstruction(routine, rungId, "XIC", "Main");
    routine = addParallelBranch(routine, rungId);
    // Put a node into the new (empty) parallel leg, then insert beside it.
    const leg = routine.rungs[0]!.root.parallelBranches!.at(-1)!;
    const branch = findBranchInRoot(routine.rungs[0]!.root, leg.id)!;
    expect(branch.nodes).toHaveLength(0);
    // Seed the leg directly via insertNode by appending then inserting relative.
    // Append a node into the leg's series first using a fresh node.
    const seeded = createNode("XIO", [tagOperand("tag", "Alt")]);
    routine = {
      ...routine,
      rungs: routine.rungs.map((rung) =>
        rung.id === rungId
          ? {
              ...rung,
              root: {
                ...rung.root,
                parallelBranches: rung.root.parallelBranches!.map((b) =>
                  b.id === leg.id ? { ...b, nodes: [seeded] } : b,
                ),
              },
            }
          : rung,
      ),
    };
    const inserted = createNode("ONS", [tagOperand("storage", "OneShot")]);
    routine = insertNodeRelativeToNode(routine, rungId, seeded.id, inserted, "before");
    const updatedLeg = routine.rungs[0]!.root.parallelBranches!.find((b) => b.id === leg.id)!;
    expect(updatedLeg.nodes.map((node) => node.instructionType)).toEqual(["ONS", "XIO"]);
    // The main series is untouched.
    expect(routine.rungs[0]!.root.nodes.map((node) => node.instructionType)).toEqual(["XIC"]);
  });

  it("is a no-op when the target node is absent", () => {
    let routine = createLadderRoutine();
    routine = addRung(routine);
    const rungId = routine.rungs[0]!.id;
    routine = appendInstruction(routine, rungId, "XIC", "Start");
    const before = routineNodes(routine).length;
    routine = insertNodeRelativeToNode(routine, rungId, "missing", createNode("NOP", []), "after");
    expect(routineNodes(routine)).toHaveLength(before);
  });
});

describe("structural edit guards", () => {
  it("rejects malformed rung roots without committing a partial edit", () => {
    const routine = createLadderRoutine();
    const malformed: LadderRoutine = {
      ...routine,
      rungs: [
        {
          id: "rung-bad-root",
          routineId: routine.id,
          number: 0,
          root: { id: "branch-without-nodes" } as unknown as LadderBranch,
        },
      ],
    };

    expect(appendInstruction(malformed, "rung-bad-root", "XIC", "Start")).toBe(malformed);
  });

  it("rejects cyclic branch roots and keeps safe counters finite", () => {
    const node = createNode("XIC", [tagOperand("tag", "Start")]);
    const root = createBranch([node]);
    root.next = root;
    const routine = createLadderRoutine();
    const cyclic: LadderRoutine = {
      ...routine,
      rungs: [{ id: "rung-cycle", routineId: routine.id, number: 0, root }],
    };

    expect(countNodeIdInBranch(root, node.id)).toBe(1);
    expect(appendInstruction(cyclic, "rung-cycle", "OTE", "Run")).toBe(cyclic);
  });

  it("does not delete when rung ids are duplicated", () => {
    const base = threeRungRoutine();
    const duplicate = {
      ...base,
      rungs: base.rungs.map((rung, index) =>
        index === 1 ? { ...rung, id: base.rungs[0]!.id } : rung,
      ),
    };

    expect(removeRung(duplicate, base.rungs[0]!.id)).toBe(duplicate);
    expect(duplicate.rungs).toHaveLength(3);
  });

  it("does not delete multiple instructions when node ids are duplicated", () => {
    const routine = createLadderRoutine();
    const first = createNode("XIC", [tagOperand("tag", "A")]);
    const second = { ...createNode("XIO", [tagOperand("tag", "B")]), id: first.id };
    const duplicate: LadderRoutine = {
      ...routine,
      rungs: [
        {
          id: "rung-duplicate-node",
          routineId: routine.id,
          number: 0,
          root: createBranch([first, second]),
        },
      ],
    };

    expect(removeInstruction(duplicate, "rung-duplicate-node", first.id)).toBe(duplicate);
    expect(duplicate.rungs[0]!.root.nodes).toHaveLength(2);
  });

  it("rejects branch-target edits when branch ids are duplicated", () => {
    const routine = createLadderRoutine();
    const leg = createBranch([]);
    const duplicateLeg = { ...createBranch([]), id: leg.id };
    const duplicate: LadderRoutine = {
      ...routine,
      rungs: [
        {
          id: "rung-duplicate-branch",
          routineId: routine.id,
          number: 0,
          root: createBranch([], { parallelBranches: [leg, duplicateLeg] }),
        },
      ],
    };

    const result = appendNodeToBranch(
      duplicate,
      "rung-duplicate-branch",
      leg.id,
      createNode("XIC", [tagOperand("tag", "A")]),
    );
    expect(result).toBe(duplicate);
    expect(duplicate.rungs[0]!.root.parallelBranches).toHaveLength(2);
  });

  it("rolls back when a supplied node would duplicate an existing id", () => {
    let routine = createLadderRoutine();
    routine = addRung(routine);
    const rungId = routine.rungs[0]!.id;
    routine = appendInstruction(routine, rungId, "XIC", "Start");
    const existing = rungNodes(routine.rungs[0]!)[0]!;
    const duplicateNode = {
      ...createNode("OTE", [tagOperand("tag", "Run")]),
      id: existing.id,
    };

    expect(appendNode(routine, rungId, duplicateNode)).toBe(routine);
    expect(rungNodes(routine.rungs[0]!)).toHaveLength(1);
  });

  it("does not insert a rung from a cyclic pasted root", () => {
    const routine = createLadderRoutine();
    const root = createBranch([]);
    root.next = root;

    expect(insertRungAt(routine, 0, root)).toBe(routine);
    expect(routine.rungs).toHaveLength(0);
  });
});

describe("setOperandValue", () => {
  it("rejects invalid operand indexes without mutating the routine", () => {
    let routine = createLadderRoutine();
    routine = addRung(routine);
    const rungId = routine.rungs[0]!.id;
    routine = appendInstruction(routine, rungId, "XIC", "Start");
    const nodeId = rungNodes(routine.rungs[0]!)[0]!.id;

    expect(setOperandValue(routine, rungId, nodeId, "Bad", -1)).toBe(routine);
    expect(setOperandValue(routine, rungId, nodeId, "Bad", Number.NaN)).toBe(routine);
    expect(setOperandValue(routine, rungId, nodeId, "Bad", Number.POSITIVE_INFINITY)).toBe(routine);
    expect(setOperandValue(routine, rungId, nodeId, "Bad", 256)).toBe(routine);
    expect(rungNodes(routine.rungs[0]!)[0]!.operands).toHaveLength(1);
    expect(rungNodes(routine.rungs[0]!)[0]!.operands[0]!.value).toBe("Start");
  });
});

/** A single rung carrying instructions A, B, C (operand value names) in series. */
function abcRung() {
  let routine = createLadderRoutine();
  routine = addRung(routine);
  const rungId = routine.rungs[0]!.id;
  routine = appendInstruction(routine, rungId, "XIC", "A");
  routine = appendInstruction(routine, rungId, "XIC", "B");
  routine = appendInstruction(routine, rungId, "OTE", "C");
  return { routine, rungId };
}

const seriesValues = (routine: LadderRoutine) =>
  routine.rungs[0]!.root.nodes.map((node) => node.operands[0]?.value);

const nodeByValue = (routine: LadderRoutine, value: string) =>
  rungNodes(routine.rungs[0]!).find((node) => node.operands[0]?.value === value)!;

describe("moveNode", () => {
  it("reorders an instruction before a target within the series", () => {
    const { routine, rungId } = abcRung();
    const a = nodeByValue(routine, "A");
    const c = nodeByValue(routine, "C");
    const moved = moveNode(routine, rungId, c.id, a.id, "before");
    expect(seriesValues(moved)).toEqual(["C", "A", "B"]);
    // A true move keeps the node identity (undo/redo + xrefs stay stable).
    expect(nodeByValue(moved, "C").id).toBe(c.id);
    expect(nodeByValue(moved, "C").instructionType).toBe("OTE");
  });

  it("reorders an instruction after a target within the series", () => {
    const { routine, rungId } = abcRung();
    const a = nodeByValue(routine, "A");
    const c = nodeByValue(routine, "C");
    const moved = moveNode(routine, rungId, a.id, c.id, "after");
    expect(seriesValues(moved)).toEqual(["B", "C", "A"]);
  });

  it("moves an instruction out of a parallel leg into the main series", () => {
    let routine = createLadderRoutine();
    routine = addRung(routine);
    const rungId = routine.rungs[0]!.id;
    routine = appendInstruction(routine, rungId, "XIC", "Main");
    routine = addParallelBranch(routine, rungId);
    const leg = routine.rungs[0]!.root.parallelBranches!.at(-1)!;
    const seeded = createNode("XIO", [tagOperand("tag", "Alt")]);
    routine = {
      ...routine,
      rungs: routine.rungs.map((rung) =>
        rung.id === rungId
          ? {
              ...rung,
              root: {
                ...rung.root,
                parallelBranches: rung.root.parallelBranches!.map((b) =>
                  b.id === leg.id ? { ...b, nodes: [seeded] } : b,
                ),
              },
            }
          : rung,
      ),
    };
    const main = nodeByValue(routine, "Main");
    const moved = moveNode(routine, rungId, seeded.id, main.id, "after");
    // The alternate node now lives in the main series, right after Main.
    expect(seriesValues(moved)).toEqual(["Main", "Alt"]);
    // The leg it left is now empty (structurally valid).
    expect(moved.rungs[0]!.root.parallelBranches!.find((b) => b.id === leg.id)!.nodes).toHaveLength(0);
  });

  it("is a no-op when source and target are the same node", () => {
    const { routine, rungId } = abcRung();
    const a = nodeByValue(routine, "A");
    expect(moveNode(routine, rungId, a.id, a.id, "before")).toBe(routine);
  });

  it("is a no-op for an invalid position", () => {
    const { routine, rungId } = abcRung();
    const a = nodeByValue(routine, "A");
    const c = nodeByValue(routine, "C");
    expect(moveNode(routine, rungId, a.id, c.id, "sideways" as "before")).toBe(routine);
  });

  it("is a no-op when the moved node or target is missing", () => {
    const { routine, rungId } = abcRung();
    const a = nodeByValue(routine, "A");
    expect(moveNode(routine, rungId, "missing", a.id, "before")).toBe(routine);
    expect(moveNode(routine, rungId, a.id, "missing", "after")).toBe(routine);
  });

  it("does not mutate the input routine", () => {
    const { routine, rungId } = abcRung();
    const before = seriesValues(routine);
    const a = nodeByValue(routine, "A");
    const c = nodeByValue(routine, "C");
    moveNode(routine, rungId, c.id, a.id, "before");
    expect(seriesValues(routine)).toEqual(before);
  });
});

describe("duplicateRung", () => {
  it("inserts a fresh-id copy directly after the source and renumbers", () => {
    const base = threeRungRoutine();
    const dup = duplicateRung(base, base.rungs[0]!.id);
    expect(rungTags(dup)).toEqual(["A", "A", "B", "C"]);
    expect(dup.rungs.map((rung) => rung.number)).toEqual([0, 1, 2, 3]);
    expect(dup.rungs[1]!.id).not.toBe(dup.rungs[0]!.id);
    expect(rungNodes(dup.rungs[1]!)[0]!.id).not.toBe(rungNodes(dup.rungs[0]!)[0]!.id);
  });

  it("is a no-op for an unknown rung id", () => {
    const base = threeRungRoutine();
    expect(duplicateRung(base, "missing")).toBe(base);
  });
});

describe("appendInstruction / appendNode", () => {
  it("appends a single-operand instruction to the rung's terminal series", () => {
    let routine = createLadderRoutine();
    routine = addRung(routine);
    const rungId = routine.rungs[0]!.id;
    routine = appendInstruction(routine, rungId, "XIC", "Start");
    const nodes = rungNodes(routine.rungs[0]!);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]!.instructionType).toBe("XIC");
    expect(nodes[0]!.operands[0]!.value).toBe("Start");
  });

  it("appends a pre-built node, preserving its id and operands", () => {
    let routine = createLadderRoutine();
    routine = addRung(routine);
    const rungId = routine.rungs[0]!.id;
    routine = appendInstruction(routine, rungId, "XIC", "Start");
    const node = createNode("OTE", [tagOperand("tag", "Run")]);
    routine = appendNode(routine, rungId, node);
    expect(rungNodes(routine.rungs[0]!).map((n) => n.instructionType)).toEqual(["XIC", "OTE"]);
    expect(rungNodes(routine.rungs[0]!).at(-1)!.id).toBe(node.id);
  });
});

describe("parallel branch legs", () => {
  function rungWithParallel() {
    let routine = createLadderRoutine();
    routine = addRung(routine);
    const rungId = routine.rungs[0]!.id;
    routine = appendInstruction(routine, rungId, "XIC", "Main");
    routine = addParallelBranch(routine, rungId);
    return { routine, rungId };
  }

  it("adds an extra leg to an existing parallel group", () => {
    let { routine, rungId } = rungWithParallel();
    expect(routine.rungs[0]!.root.parallelBranches).toHaveLength(1);
    routine = addBranchLeg(routine, rungId);
    expect(routine.rungs[0]!.root.parallelBranches).toHaveLength(2);
  });

  it("addBranchLeg is a no-op when the target has no parallel group", () => {
    let routine = createLadderRoutine();
    routine = addRung(routine);
    const rungId = routine.rungs[0]!.id;
    routine = appendInstruction(routine, rungId, "XIC", "X");
    expect(addBranchLeg(routine, rungId)).toBe(routine);
  });

  it("isParallelLeg recognises legs but not the main root", () => {
    const { routine } = rungWithParallel();
    const root = routine.rungs[0]!.root;
    expect(isParallelLeg(root, root.parallelBranches![0]!.id)).toBe(true);
    expect(isParallelLeg(root, root.id)).toBe(false);
  });

  it("removeBranchLeg removes an empty leg but never the main root", () => {
    let { routine, rungId } = rungWithParallel();
    routine = addBranchLeg(routine, rungId);
    const legId = routine.rungs[0]!.root.parallelBranches!.at(-1)!.id;
    const removed = removeBranchLeg(routine, rungId, legId);
    expect(removed.rungs[0]!.root.parallelBranches).toHaveLength(1);
    // The rung root is not a parallel leg, so it cannot be removed.
    expect(removeBranchLeg(routine, rungId, routine.rungs[0]!.root.id)).toBe(routine);
  });
});

describe("setRungComment", () => {
  it("sets and clears a rung comment", () => {
    let routine = threeRungRoutine();
    const rungId = routine.rungs[0]!.id;
    routine = setRungComment(routine, rungId, "Seal-in");
    expect(routine.rungs[0]!.comment).toBe("Seal-in");
    routine = setRungComment(routine, rungId, "");
    expect(routine.rungs[0]!.comment).toBeUndefined();
  });
});
