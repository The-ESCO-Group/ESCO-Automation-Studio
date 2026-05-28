import { describe, expect, it } from "vitest";
import type { ValidationFinding } from "@esco/validator";
import { auditAiApply, auditExport, auditImport, auditValidationRun } from "./audit";

describe("audit event factories", () => {
  it("auditValidationRun records severity counts", () => {
    const findings: ValidationFinding[] = [
      { ruleId: "undefined-tag", severity: "error", message: "x", target: "t" },
      { ruleId: "double-coil", severity: "warning", message: "y", target: "t" },
      { ruleId: "unsupported-instruction", severity: "info", message: "z", target: "t" },
    ];
    const event = auditValidationRun(findings);
    expect(event.type).toBe("validation-run");
    expect(event.details).toMatchObject({ errors: 1, warnings: 1, info: 1, total: 3 });
    expect(event.summary).toContain("1 error");
  });

  it("auditImport / auditExport / auditAiApply capture their context", () => {
    expect(auditImport("L5X: Plant.L5X").type).toBe("import");
    expect(auditExport("L5X", "plant.L5X").summary).toContain("plant.L5X");
    const ai = auditAiApply(["Create tag Foo", "Add rung"]);
    expect(ai.type).toBe("ai-apply");
    expect(ai.details?.actions).toEqual(["Create tag Foo", "Add rung"]);
  });

  it("stamps a unique id and ISO timestamp on every event", () => {
    const a = auditImport("a");
    const b = auditImport("b");
    expect(a.id).not.toBe(b.id);
    expect(a.id.startsWith("audit")).toBe(true);
    expect(() => new Date(a.at).toISOString()).not.toThrow();
    expect(new Date(a.at).toISOString()).toBe(a.at);
  });
});
