import { describe, expect, it } from "vitest";
import { createController, createProject, createRoutine, type AddOnInstruction } from "@esco/core";
import { createLadderRoutine, createNode, createRung } from "@esco/ladder";
import { createDefaultEngine } from "./index";

function projectWithAois(aois: AddOnInstruction[]) {
  const project = createProject("Cell");
  const controller = createController(project.id, "Ctrl");
  controller.addOnInstructions.push(...aois);
  project.controllers.push(controller);
  return project;
}

function aoi(name: string, patch: Partial<AddOnInstruction> = {}): AddOnInstruction {
  return {
    id: `aoi-${name}`,
    name,
    parameters: [],
    localTags: [],
    routineNames: [],
    ...patch,
  };
}

function parameters(count: number, usage: "Input" | "Output" | "InOut") {
  return Array.from({ length: count }, (_, index) => ({
    name: `${usage}${index}`,
    dataType: "DINT",
    usage,
  }));
}

function localTags(count: number) {
  return Array.from({ length: count }, (_, index) => ({ name: `Local${index}`, dataType: "DINT" }));
}

function callRoutine(owner: string, called: string) {
  const routine = createRoutine(`aoi-${owner}`, "Logic", "ladder");
  const ladder = createLadderRoutine();
  ladder.rungs.push(createRung(routine.id, 0, [createNode(called)]));
  routine.ladder = ladder;
  return routine;
}

function chain(length: number): AddOnInstruction[] {
  return Array.from({ length: length + 1 }, (_, index) => {
    const name = `A${index}`;
    const next = index < length ? `A${index + 1}` : undefined;
    return aoi(name, next ? { routines: [callRoutine(name, next)] } : {});
  });
}

const capacityFindings = (aois: AddOnInstruction[]) =>
  createDefaultEngine()
    .run(projectWithAois(aois))
    .filter((finding) => finding.ruleId === "aoi-capacity");

describe("aoi-capacity", () => {
  it("flags AOIs with more than 512 Input/Output parameters plus local tags", () => {
    const findings = capacityFindings([
      aoi("Mixer", {
        parameters: [...parameters(300, "Input"), ...parameters(100, "Output"), ...parameters(10, "InOut")],
        localTags: localTags(113),
      }),
    ]);

    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toContain("513 Input/Output parameters plus local tags");
    expect(findings[0]!.message).toContain("at most 512");
  });

  it("uses Studio 5000 v28's lower InOut parameter limit", () => {
    const findings = capacityFindings([
      aoi("Legacy", {
        softwareRevision: "v28.00",
        parameters: parameters(41, "InOut"),
      }),
    ]);

    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toContain("41 InOut parameters");
    expect(findings[0]!.message).toContain("v28");
    expect(findings[0]!.message).toContain("40");
  });

  it("uses Studio 5000 v29+ InOut parameter limits for current or unknown software revisions", () => {
    expect(
      capacityFindings([
        aoi("Current", {
          softwareRevision: "v32.11",
          parameters: parameters(65, "InOut"),
        }),
      ]),
    ).toHaveLength(1);

    expect(
      capacityFindings([
        aoi("Unknown", {
          parameters: parameters(65, "InOut"),
        }),
      ]),
    ).toHaveLength(1);
  });

  it("does not enforce an InOut cap for AOIs authored by Logix Designer v27 or earlier", () => {
    expect(
      capacityFindings([
        aoi("Old", {
          softwareRevision: "v27.04",
          parameters: parameters(80, "InOut"),
        }),
      ]),
    ).toHaveLength(0);
  });

  it("flags AOI call chains deeper than 16 nested levels", () => {
    const findings = capacityFindings(chain(17));

    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toContain("17 levels deep");
    expect(findings[0]!.message).toContain("A0 -> A1");
  });

  it("accepts AOI call chains up to 16 nested levels", () => {
    expect(capacityFindings(chain(16))).toHaveLength(0);
  });
});
