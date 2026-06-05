import { describe, expect, it } from "vitest";
import { createDefaultRegistry, supportLevel } from "./index";

/**
 * EVENT (Trigger Event Task) is model-only: the offline scan has no asynchronous
 * task scheduler, so the event task it would fire must never be triggered. It is
 * registered as a program-control pass-through whose only operand is a literal
 * Task reference (not a tag), so cross-reference never mis-classifies the task
 * name as a tag read and the validator never raises a false "undefined tag".
 */
describe("EVENT trigger event task", () => {
  const registry = createDefaultRegistry();

  it("is registered model-only in the program-control category", () => {
    const reg = registry.get("EVENT");
    expect(reg).toBeDefined();
    expect(reg?.modelOnly).toBe(true);
    expect(reg?.category).toBe("program-control");
    expect(supportLevel(reg)).toBe("model-only");
  });

  it("declares its sole operand as a literal Task reference, not a tag", () => {
    const reg = registry.get("EVENT");
    expect(reg?.operands).toHaveLength(1);
    expect(reg?.operands[0]).toMatchObject({
      name: "task",
      label: "Task",
      required: true,
      isLabelRef: true,
    });
    // Never a destructive/read tag reference.
    expect(reg?.operands[0]?.direction).toBeUndefined();
    expect(reg?.operands[0]?.allowedTypes).toBeUndefined();
  });

  it("passes the rung condition through and never touches tag memory", () => {
    const reg = registry.get("EVENT");
    const mustNotWrite = () => {
      throw new Error("model-only EVENT must not write");
    };
    const result = reg?.execute(
      { id: "n", instructionType: "EVENT", operands: [{ name: "task", kind: "literal", value: "EventTask" }] },
      {
        rungIn: true,
        deltaMs: 0,
        readBool: () => false,
        writeBool: mustNotWrite,
        readNumber: () => 0,
        writeNumber: mustNotWrite,
        readString: () => "",
        writeString: mustNotWrite,
        numeric: () => 0,
      },
    );
    expect(result).toBe(true);
    // Validation is skipped for model-only instructions — never a false finding.
    expect(reg?.validate?.({ id: "n", instructionType: "EVENT", operands: [] })).toEqual([]);
  });
});
