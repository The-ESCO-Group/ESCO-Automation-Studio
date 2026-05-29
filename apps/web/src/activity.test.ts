import { describe, expect, it } from "vitest";
import { aiApplyActivityMessage, recordActivity } from "./activity";

describe("recordActivity", () => {
  it("prepends entries most-recent-first and caps the log", () => {
    let log = recordActivity([], "ai", "first");
    log = recordActivity(log, "import", "second");
    expect(log[0]?.message).toBe("second");
    expect(log[1]?.message).toBe("first");
  });
});

describe("aiApplyActivityMessage (AI audit trail)", () => {
  it("lists the reviewed action labels for an applied plan", () => {
    const message = aiApplyActivityMessage("Proposed changes", {
      ok: true,
      appliedCount: 2,
      actionLabels: ["Create tag StartPB (BOOL)", "Add rung: XIC(StartPB)OTE(MotorRun)"],
    });
    expect(message).toContain("2 action(s)");
    expect(message).toContain("Create tag StartPB (BOOL)");
    expect(message).toContain("Add rung");
  });

  it("summarizes the overflow beyond the inline label limit", () => {
    const labels = Array.from({ length: 8 }, (_, i) => `Create tag T${i}`);
    const message = aiApplyActivityMessage("Bulk", { ok: true, appliedCount: 8, actionLabels: labels });
    expect(message).toContain("(+3 more)");
    expect(message).toContain("Create tag T0");
    expect(message).not.toContain("Create tag T5");
  });

  it("records a blocked apply with the action-layer error", () => {
    const message = aiApplyActivityMessage("Proposed changes", {
      ok: false,
      appliedCount: 0,
      actionLabels: ["Delete tag MotorRun"],
      error: "Cannot delete \"MotorRun\": still referenced by 1 operand(s).",
    });
    expect(message).toMatch(/blocked/i);
    expect(message).toContain("still referenced");
  });

  it("falls back to a generic blocked message when no error is provided", () => {
    const message = aiApplyActivityMessage("Plan", { ok: false, appliedCount: 0, actionLabels: [] });
    expect(message).toMatch(/blocked/i);
    expect(message).toMatch(/reviewed action layer/i);
  });
});
