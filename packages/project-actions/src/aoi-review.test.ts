import { describe, expect, it } from "vitest";
import type { AddOnInstruction, Routine } from "@esco/core";
import { describeAoiExecutionReview, describeAoiInterfaceReview } from "./aoi-review";

const ladder = { id: "lad", rungs: [] };

function routine(name: string, language: Routine["language"], withLadder = language === "ladder"): Routine {
  return {
    id: `rtn_${name}`,
    programId: "prog",
    name,
    language,
    ...(withLadder ? { ladder } : {}),
    ...(language === "structured-text" ? { structuredText: "Out := In;" } : {}),
    ...(language === "function-block" || language === "sfc" ? { sourceText: `<Routine Name="${name}"/>` } : {}),
  };
}

function aoi(patch: Partial<AddOnInstruction> = {}): AddOnInstruction {
  const routines = patch.routines ?? [routine("Logic", "ladder")];
  return {
    id: "aoi",
    name: "ScaleAOI",
    parameters: [],
    localTags: [],
    routineNames: routines.map((candidate) => candidate.name),
    routines,
    ...patch,
  };
}

describe("AOI execution review", () => {
  it("selects the ladder routine named Logic as the offline scan body", () => {
    const review = describeAoiExecutionReview(aoi({
      routines: [
        routine("Prescan", "ladder"),
        routine("Logic", "ladder"),
        routine("Postscan", "ladder"),
        routine("Calc", "structured-text"),
      ],
    }));

    expect(review).toMatchObject({
      editable: true,
      offlineExecutable: true,
      selectedRoutineName: "Logic",
      selectedRoutinePolicy: "logic-routine",
    });
    expect(review.boundaries).toEqual(expect.arrayContaining([
      "single-scan-routine-executes",
      "scan-phase-routines-not-executed",
      "non-ladder-routines-preserved-read-only",
      "no-controller-scheduling-or-fault-semantics",
    ]));
    expect(review.routines.map((row) => [row.name, row.behavior])).toEqual([
      ["Prescan", "ladder-preserved-not-selected"],
      ["Logic", "offline-rll-executable"],
      ["Postscan", "ladder-preserved-not-selected"],
      ["Calc", "non-ladder-preserved-read-only"],
    ]);
  });

  it("falls back to the first imported ladder routine when Logic is absent", () => {
    const review = describeAoiExecutionReview(aoi({
      routines: [
        routine("Calc", "structured-text"),
        routine("MainBody", "ladder"),
        routine("Helper", "ladder"),
      ],
    }));

    expect(review.offlineExecutable).toBe(true);
    expect(review.selectedRoutineName).toBe("MainBody");
    expect(review.selectedRoutinePolicy).toBe("first-ladder-fallback");
    expect(review.routines.find((row) => row.name === "Helper")?.behavior).toBe("ladder-preserved-not-selected");
  });

  it("keeps source-protected AOIs metadata-only even when signatures are present", () => {
    const review = describeAoiExecutionReview(aoi({
      protected: true,
      protectionType: "Protected",
      signature: "16#abcd_1234",
      routines: [routine("Logic", "ladder")],
    }));

    expect(review.editable).toBe(false);
    expect(review.offlineExecutable).toBe(false);
    expect(review.selectedRoutineName).toBeUndefined();
    expect(review.boundaries).toEqual(expect.arrayContaining([
      "source-protected-logic-unavailable",
      "no-controller-signature-enforcement",
    ]));
    expect(review.routines[0]).toMatchObject({
      name: "Logic",
      behavior: "source-protected-metadata-only",
    });
  });

  it("reports AOIs with only non-ladder bodies as model-only pass-through", () => {
    const review = describeAoiExecutionReview(aoi({
      routines: [
        routine("Logic", "structured-text"),
        routine("FBD", "function-block"),
        routine("Chart", "sfc"),
      ],
    }));

    expect(review.offlineExecutable).toBe(false);
    expect(review.status).toMatch(/model-only pass-through/i);
    expect(review.boundaries).toContain("non-ladder-routines-preserved-read-only");
    expect(review.routines.every((row) => row.behavior === "non-ladder-preserved-read-only")).toBe(true);
  });
});

describe("AOI interface review", () => {
  it("classifies parameter direction, passing, and counts", () => {
    const review = describeAoiInterfaceReview(aoi({
      parameters: [
        { name: "EnableIn", dataType: "BOOL", usage: "Input" },
        { name: "EnableOut", dataType: "BOOL", usage: "Output" },
        { name: "Gain", dataType: "REAL", usage: "Input", required: true, defaultValue: "1.0" },
        { name: "Result", dataType: "REAL", usage: "Output", visible: true },
        { name: "Buffer", dataType: "DINT", usage: "InOut", required: true, visible: true, dimensions: [16] },
      ],
      localTags: [{ name: "scratch", dataType: "DINT" }],
    }));

    // Implicit pins are listed but excluded from the user-facing counts.
    expect(review.hasEnableIn).toBe(true);
    expect(review.hasEnableOut).toBe(true);
    expect(review.parameters.filter((p) => p.implicit).map((p) => p.name)).toEqual(["EnableIn", "EnableOut"]);
    expect(review.inputCount).toBe(1);
    expect(review.outputCount).toBe(1);
    expect(review.inOutCount).toBe(1);
    expect(review.localTagCount).toBe(1);

    const gain = review.parameters.find((p) => p.name === "Gain");
    expect(gain).toMatchObject({ direction: "input", passing: "by-value", required: true, visible: false, array: false, defaultValue: "1.0" });

    const buffer = review.parameters.find((p) => p.name === "Buffer");
    expect(buffer).toMatchObject({ direction: "inout", passing: "by-reference", visible: true, array: true, dimensions: [16] });
    expect(review.byReferenceCount).toBe(1);
    expect(review.visibleParameterCount).toBe(2); // Result + Buffer explicitly carry Visible="true"; Gain is hidden.
    expect(review.requiredParameterCount).toBe(2); // Gain + Buffer
    expect(review.boundaries).toEqual(expect.arrayContaining([
      "interface-metadata-display-only",
      "inout-parameters-alias-caller-memory",
    ]));
  });

  it("exposes the interface of a source-protected AOI without its logic", () => {
    const review = describeAoiInterfaceReview(aoi({
      protected: true,
      protectionType: "Protected",
      parameters: [
        { name: "EnableIn", dataType: "BOOL", usage: "Input" },
        { name: "Setpoint", dataType: "REAL", usage: "Input", required: true },
      ],
    }));

    expect(review.protectedSource).toBe(true);
    expect(review.inputCount).toBe(1);
    expect(review.boundaries).toContain("source-protected-logic-unavailable");
    expect(review.notes.join(" ")).toMatch(/survives source protection/i);
  });

  it("treats an array parameter as by reference even when usage is missing", () => {
    const review = describeAoiInterfaceReview(aoi({
      parameters: [{ name: "Matrix", dataType: "REAL", dimensions: [2, 3] }],
    }));

    const matrix = review.parameters[0];
    expect(matrix).toMatchObject({ direction: "unknown", passing: "by-reference", array: true, dimensions: [2, 3] });
    expect(review.byReferenceCount).toBe(1);
    expect(review.boundaries).toContain("inout-parameters-alias-caller-memory");
  });

  it("treats Required and instruction-face Visible as independent imported flags", () => {
    const review = describeAoiInterfaceReview(aoi({
      parameters: [
        { name: "HiddenRequired", dataType: "REAL", usage: "Input", required: true },
        { name: "VisibleOptional", dataType: "BOOL", usage: "Input", visible: true },
      ],
    }));

    expect(review.requiredParameterCount).toBe(1);
    expect(review.visibleParameterCount).toBe(1);
    expect(review.parameters.find((p) => p.name === "HiddenRequired")).toMatchObject({
      required: true,
      visible: false,
    });
    expect(review.parameters.find((p) => p.name === "VisibleOptional")).toMatchObject({
      required: false,
      visible: true,
    });
  });
});
