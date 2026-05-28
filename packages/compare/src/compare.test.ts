import { describe, expect, it } from "vitest";
import {
  createController,
  createProgram,
  createProject,
  createRoutine,
  type PlcProject,
  type Routine,
} from "@esco/core";
import {
  addRung,
  appendInstruction,
  appendRungWithRoot,
  createBranch,
  createLadderRoutine,
  createNode,
  tagOperand,
} from "@esco/ladder";
import { importL5X } from "@esco/parser-l5x";
import { compareProjects, compareReportCsv, compareReportJson, compareRoutines } from "./index";

type RungSpec = [type: string, operand?: string][];

/** Build a ladder routine from rungs (each a list of single-operand instructions). */
function routineWith(name: string, rungs: RungSpec[]): Routine {
  const routine = createRoutine("prog", name, "ladder");
  let ladder = createLadderRoutine();
  for (const rung of rungs) {
    ladder = addRung(ladder);
    const rungId = ladder.rungs[ladder.rungs.length - 1]!.id;
    for (const [type, operand] of rung) {
      ladder = appendInstruction(ladder, rungId, type, operand ?? "");
    }
  }
  routine.ladder = ladder;
  return routine;
}

function projectWith(routines: Routine[]): PlcProject {
  const project = createProject("P");
  const controller = createController(project.id, "Ctrl");
  const program = createProgram(controller.id, "MainProgram");
  for (const routine of routines) program.routines.push(routine);
  controller.programs.push(program);
  project.controllers.push(controller);
  return project;
}

const sealIn = (): RungSpec[] => [[["XIC", "Start"], ["XIO", "Stop"], ["OTE", "Run"]]];

const xic = (tag: string) => createNode("XIC", [tagOperand("tag", tag)]);
const ote = (tag: string) => createNode("OTE", [tagOperand("tag", tag)]);

/** One rung: [ XIC(legA) , XIC(legB) ] OTE(Out) — a 2-leg OR group. */
function orRoutine(name: string, legA: string, legB: string): Routine {
  const routine = createRoutine("prog", name, "ladder");
  const root = createBranch([xic(legA)], {
    parallelBranches: [createBranch([xic(legB)])],
    next: createBranch([ote("Out")]),
  });
  routine.ladder = appendRungWithRoot(createLadderRoutine(), root);
  return routine;
}

describe("compare canonicalization (OR-leg order)", () => {
  it("reordered OR legs are identical in logical mode, changed in strict mode", () => {
    const r1 = orRoutine("A", "Start", "Run");
    const r2 = orRoutine("B", "Run", "Start"); // same OR legs, reordered
    expect(compareRoutines(r1, r2, { canonicalize: "logical" }).status).toBe("identical");
    expect(compareRoutines(r1, r2, { canonicalize: "strict" }).status).not.toBe("identical");
  });

  it("compareProjects logical mode matches reordered-branch routines", () => {
    const left = projectWith([orRoutine("Seal", "Start", "Run")]);
    const right = projectWith([orRoutine("Seal", "Run", "Start")]);
    expect(compareProjects(left, right, { canonicalize: "logical" }).summary.matched).toBe(1);
    expect(compareProjects(left, right, { canonicalize: "strict" }).summary.changed).toBe(1);
  });
});

describe("compareRoutines", () => {
  it("treats identical logic with different ids as an exact match", () => {
    expect(compareRoutines(routineWith("A", sealIn()), routineWith("B", sealIn())).status).toBe(
      "identical",
    );
  });

  it("flags same structure, different tag names as operand-changed", () => {
    const a = routineWith("A", [[["XIC", "Start"], ["OTE", "Run"]]]);
    const b = routineWith("B", [[["XIC", "Go"], ["OTE", "Motor"]]]);
    const diff = compareRoutines(a, b);
    expect(diff.status).toBe("operand-changed");
    expect(diff.details.length).toBeGreaterThan(0);
  });

  it("flags a different instruction layout as structure-changed", () => {
    const a = routineWith("A", [[["XIC", "Start"], ["OTE", "Run"]]]);
    const b = routineWith("B", [[["XIC", "Start"], ["XIO", "Stop"], ["OTE", "Run"]]]);
    expect(compareRoutines(a, b).status).toBe("structure-changed");
  });

  it("flags a changed output as a difference", () => {
    const a = routineWith("A", [[["XIC", "Start"], ["OTE", "Run"]]]);
    const b = routineWith("B", [[["XIC", "Start"], ["OTE", "Stopped"]]]);
    expect(compareRoutines(a, b).status).toBe("operand-changed");
  });
});

describe("compareProjects", () => {
  it("matches by fingerprint even when routine names differ", () => {
    const left = projectWith([routineWith("Conveyor", sealIn())]);
    const right = projectWith([routineWith("DifferentName", sealIn())]);
    const result = compareProjects(left, right);
    expect(result.summary.matched).toBe(1);
    expect(result.matches[0]!.matchedBy).toBe("fingerprint");
    expect(result.matches[0]!.left.routineName).toBe("Conveyor");
    expect(result.matches[0]!.right.routineName).toBe("DifferentName");
  });

  it("reports matched, changed, only-in-left and only-in-right", () => {
    const left = projectWith([
      routineWith("Same", sealIn()),
      routineWith("Edited", [[["XIC", "A"], ["OTE", "B"]]]),
      routineWith("OnlyLeft", [[["XIC", "X"], ["OTE", "Y"]]]),
    ]);
    const right = projectWith([
      routineWith("Same", sealIn()),
      routineWith("Edited", [[["XIC", "A"], ["OTE", "Changed"]]]),
      routineWith("OnlyRight", [[["XIC", "P"], ["OTE", "Q"], ["XIC", "Z"]]]),
    ]);
    const result = compareProjects(left, right);
    expect(result.summary.matched).toBe(1);
    expect(result.summary.changed).toBe(1);
    expect(result.summary.onlyInLeft).toBe(1);
    expect(result.summary.onlyInRight).toBe(1);
    expect(result.changed[0]!.status).toBe("operand-changed");
    expect(result.onlyInLeft[0]!.routineName).toBe("OnlyLeft");
    expect(result.onlyInRight[0]!.routineName).toBe("OnlyRight");
  });

  it("serializes a compare report to JSON and CSV", () => {
    const left = projectWith([
      routineWith("Same", sealIn()),
      routineWith("Edited", [[["XIC", "A"], ["OTE", "B"]]]),
      routineWith("Only, Left", [[["XIC", "X"], ["OTE", "Y"]]]), // name has a comma
    ]);
    const right = projectWith([
      routineWith("Same", sealIn()),
      routineWith("Edited", [[["XIC", "A"], ["OTE", "Changed"]]]),
    ]);
    const result = compareProjects(left, right);

    // JSON round-trips back to the same summary.
    const json = compareReportJson(result);
    expect(JSON.parse(json).summary).toEqual(result.summary);

    // CSV has a header + one row per compared routine.
    const csv = compareReportCsv(result);
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe("Status,Left routine,Right routine,Match type,Difference summary");
    expect(lines).toHaveLength(1 + result.summary.total);
    expect(csv).toMatch(/MainProgram\/Same/);
    // A routine name containing a comma is quoted as a single CSV cell.
    expect(csv.includes('"MainProgram/Only, Left"')).toBe(true);
  });

  it("compares two imported L5X projects by logic despite a renamed routine", () => {
    const makeL5X = (routineName: string) => `<?xml version="1.0"?>
<RSLogix5000Content><Controller Name="C">
  <Tags><Tag Name="Start" DataType="BOOL"/><Tag Name="Run" DataType="BOOL"/></Tags>
  <Programs><Program Name="MainProgram" MainRoutineName="${routineName}">
    <Routines><Routine Name="${routineName}" Type="RLL"><RLLContent>
      <Rung Number="0"><Text><![CDATA[XIC(Start)OTE(Run);]]></Text></Rung>
    </RLLContent></Routine></Routines>
  </Program></Programs>
</Controller></RSLogix5000Content>`;
    const left = importL5X(makeL5X("Original")).project;
    const right = importL5X(makeL5X("Renamed")).project;
    const result = compareProjects(left, right);
    expect(result.summary.matched).toBe(1);
    expect(result.matches[0]!.matchedBy).toBe("fingerprint");
  });
});
