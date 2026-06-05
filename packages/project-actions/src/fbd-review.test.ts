import { describe, expect, it } from "vitest";
import { reviewFbdRoutineSource } from "./fbd-review";

const SOURCE = `<FBDContent SheetSize="Letter">
  <Sheet Number="0" Name="Main">
    <Block ID="1" Type="PIDE" Operand="PIDE_01" X="120" Y="80" Visible="true">
      <InputParameters>
        <InputParameter Name="PV" Operand="Level"/>
        <Parameter Name="SP" Value="10.0"/>
      </InputParameters>
      <OutputParameter Name="CV" Operand="ValveCmd"/>
    </Block>
    <Block ID="2" Type="SCALE" Operand="ScaleAOI"/>
    <IRef ID="3" Operand="Level" X="40" Y="80"/>
    <ORef ID="4" Operand="ValveCmd"/>
    <Wire ID="5" FromID="3" ToID="1"/>
    <TextBox ID="6" X="20" Y="30" Text="Loop review only"/>
    <VendorNote Code="PV"/>
  </Sheet>
  <Sheet Number="1">
    <Block ID="7" Type="TOT" Operand="Totalizer"/>
    <FeedbackWire FromOperand="PIDE_01.CV" ToOperand="PIDE_01.BKCAL"/>
  </Sheet>
</FBDContent>`;

describe("reviewFbdRoutineSource", () => {
  it("extracts sheets, blocks, refs, wires, text, and unknown elements for offline review", () => {
    const review = reviewFbdRoutineSource(SOURCE);

    expect(review.language).toBe("function-block");
    expect(review.modelOnly).toBe(true);
    expect(review.executable).toBe(false);
    expect(review.parseable).toBe(true);
    expect(review.boundary).toMatch(/offline review only/i);
    expect(review.boundary).toMatch(/does not execute FBD sheets/i);
    expect(review.boundary).toMatch(/physical-controller online edits/i);
    expect(review.sheetSize).toBe("Letter");
    expect(review.summary).toEqual({
      sheetCount: 2,
      blockCount: 3,
      inputRefCount: 1,
      outputRefCount: 1,
      wireCount: 2,
      connectedWireCount: 2,
      wireEndpointGapCount: 0,
      unresolvedWireEndpointCount: 0,
      duplicateElementIdCount: 0,
      missingBlockTypeCount: 0,
      missingRefOperandCount: 0,
      parameterCount: 3,
      inputParameterCount: 2,
      outputParameterCount: 1,
      inOutParameterCount: 0,
      unknownParameterCount: 0,
      missingParameterNameCount: 0,
      diagnosticCount: 0,
      diagnosticWarningCount: 0,
      textCount: 1,
      unknownElementCount: 1,
      blockTypes: [
        { name: "PIDE", count: 1 },
        { name: "SCALE", count: 1 },
        { name: "TOT", count: 1 },
      ],
      unknownElementNames: [{ name: "VendorNote", count: 1 }],
    });
    expect(review.sheets[0]!.blocks[0]).toMatchObject({
      id: "1",
      type: "PIDE",
      typeImported: true,
      operand: "PIDE_01",
      x: 120,
      y: 80,
      visible: true,
    });
    expect(review.sheets[0]!.blocks[0]!.parameters).toEqual([
      expect.objectContaining({ direction: "input", name: "PV", value: "Level" }),
      expect.objectContaining({ direction: "input", name: "SP", value: "10.0" }),
      expect.objectContaining({ direction: "output", name: "CV", value: "ValveCmd" }),
    ]);
    expect(review.sheets[0]!.inputRefs[0]).toMatchObject({ id: "3", operand: "Level" });
    expect(review.sheets[0]!.outputRefs[0]).toMatchObject({ id: "4", operand: "ValveCmd" });
    expect(review.sheets[1]!.wires[0]).toMatchObject({
      fromOperand: "PIDE_01.CV",
      toOperand: "PIDE_01.BKCAL",
    });
    expect(review.sheets[0]!.textBoxes[0]!.text).toBe("Loop review only");
    expect(review.sheets[0]!.unknownElements[0]).toMatchObject({ name: "VendorNote", attributes: { Code: "PV" } });
    expect(review.warnings).toContain("1 unrecognized FBD element(s) preserved for source review.");
  });

  it("treats direct FBDContent children as one implicit sheet", () => {
    const review = reviewFbdRoutineSource(`<FBDContent><Block Type="MOV" Operand="Move_01"/><IRef Operand="In"/></FBDContent>`);

    expect(review.summary.sheetCount).toBe(1);
    expect(review.summary.blockCount).toBe(1);
    expect(review.summary.inputRefCount).toBe(1);
    expect(review.sheets[0]!.number).toBe("0");
    expect(review.summary.blockTypes).toEqual([{ name: "MOV", count: 1 }]);
  });

  it("reports malformed or empty FBD source without inventing model data", () => {
    const malformed = reviewFbdRoutineSource(`<FBDContent><Block Type="PIDE" Operand="Bad & Tag"/></FBDContent>`);
    expect(malformed.parseable).toBe(false);
    expect(malformed.summary.sheetCount).toBe(0);
    expect(malformed.warnings[0]).toMatch(/could not be parsed/i);

    const empty = reviewFbdRoutineSource("");
    expect(empty.parseable).toBe(false);
    expect(empty.summary.blockCount).toBe(0);
    expect(empty.warnings[0]).toMatch(/empty/i);
  });

  it("flags wires with missing endpoint metadata without blocking review", () => {
    const review = reviewFbdRoutineSource(`<FBDContent><Wire ID="W1" FromID="1"/></FBDContent>`);

    expect(review.parseable).toBe(true);
    expect(review.summary.wireCount).toBe(1);
    expect(review.summary.connectedWireCount).toBe(0);
    expect(review.summary.wireEndpointGapCount).toBe(1);
    expect(review.warnings).toContain("1 FBD wire(s) are missing imported endpoint metadata.");
  });

  it("adds semantic review diagnostics for ambiguous ids, missing operands, and unresolved wire endpoints", () => {
    const review = reviewFbdRoutineSource(`<FBDContent>
      <Sheet Number="0">
        <Block ID="1"/>
        <Block ID="3" Type="SCALE">
          <InputParameter Operand="RawValue"/>
          <InOutParameters>
            <Parameter Name="Cfg" Operand="ScaleCfg"/>
          </InOutParameters>
        </Block>
        <IRef ID="1"/>
        <ORef ID="2" Operand="Out"/>
        <Wire ID="W2" FromID="404" ToID="2"/>
        <Wire ID="W3" ToID="2"/>
      </Sheet>
    </FBDContent>`);

    expect(review.summary).toMatchObject({
      duplicateElementIdCount: 1,
      missingBlockTypeCount: 1,
      missingRefOperandCount: 1,
      parameterCount: 2,
      inputParameterCount: 1,
      outputParameterCount: 0,
      inOutParameterCount: 1,
      unknownParameterCount: 0,
      missingParameterNameCount: 1,
      connectedWireCount: 1,
      wireEndpointGapCount: 1,
      unresolvedWireEndpointCount: 1,
      diagnosticCount: 8,
      diagnosticWarningCount: 6,
    });
    expect(review.sheets[0]!.blocks[0]).toMatchObject({ type: "Block", typeImported: false });
    expect(review.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(expect.arrayContaining([
      "duplicate-element-id",
      "missing-block-type",
      "block-without-operand",
      "missing-reference-operand",
      "missing-parameter-name",
      "missing-wire-endpoint",
      "unresolved-wire-endpoint",
    ]));
    expect(review.diagnostics.map((diagnostic) => diagnostic.message)).toEqual(expect.arrayContaining([
      "FBD sheet 0 imports duplicate element id 1; wire/reference review may be ambiguous.",
      "FBD block 1 on sheet 0 has no imported Type/Instruction/Name metadata.",
      "FBD block Block (1) has no Operand/Tag/Instance metadata; pins and parameters remain preserved as imported attributes.",
      "FBD block SCALE (3) has no Operand/Tag/Instance metadata; pins and parameters remain preserved as imported attributes.",
      "FBD input reference 1 on sheet 0 has no imported operand metadata.",
      "FBD input parameter on block SCALE (3) has no imported parameter name metadata.",
      "FBD wire W3 on sheet 0 is missing imported source endpoint metadata.",
      "FBD wire W2 on sheet 0 references unknown source endpoint id 404.",
    ]));
    expect(review.diagnostics.find((diagnostic) => diagnostic.code === "unresolved-wire-endpoint")?.message).toMatch(/unknown source endpoint id 404/i);
    expect(review.warnings).toContain("1 FBD wire endpoint reference(s) did not resolve to imported sheet elements.");
    expect(review.warnings).toContain("1 duplicate FBD element id occurrence(s) may make wire review ambiguous.");
    expect(review.warnings).toContain("1 FBD input/output reference(s) are missing operand metadata.");
    expect(review.warnings).toContain("1 FBD block parameter(s) are missing imported name metadata.");
  });
});
