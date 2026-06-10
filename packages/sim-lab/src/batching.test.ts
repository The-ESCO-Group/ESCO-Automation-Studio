import { describe, expect, it } from "vitest";
import { TAG } from "./catalog";
import { SimEngine } from "./engine";
import { addDevice, createSimProject } from "./project";
import { addScenarioFromTemplate, availableScenarioTemplates, runScenario } from "./scenarios";
import { validateSimProject } from "./validation";
import type { SimDevice, SimProject } from "./types";

const NOW = () => "2026-01-01T00:00:00.000Z";

/** A pump-station project (no batch system seeded) with a batch system added. */
function batchProject(): { project: SimProject; batch: SimDevice } {
  const base = createSimProject({ name: "Batch Test", processType: "pump-station", now: NOW });
  const added = addDevice(base, { kind: "batch-system", tag: "BT101" }, NOW);
  if (!added.ok) throw new Error(added.error);
  return { project: added.project, batch: added.data! };
}

describe("Batching machine template", () => {
  it("adds a batch system and generates its virtual tags", () => {
    const { project, batch } = batchProject();
    const names = batch.tags.map((t) => t.name);
    expect(batch.kind).toBe("batch-system");
    expect(names).toContain(`BT101_${TAG.startCmd}`);
    expect(names).toContain(`BT101_${TAG.drainCmd}`);
    expect(names).toContain(`BT101_${TAG.run}`);
    expect(names).toContain(`BT101_${TAG.done}`);
    expect(names).toContain(`BT101_${TAG.pv}`);
    expect(names).toContain(`BT101_${TAG.batchCount}`);
    expect(names).toContain(`BT101_${TAG.fault}`);
    // An overfill alarm is generated on the level PV.
    expect(batch.alarms.map((a) => a.name)).toContain("BT101_Overfill");
    // Project remains valid (no errors) with the new device.
    expect(validateSimProject(project).filter((f) => f.severity === "error")).toEqual([]);
  });

  it("offers the batch-fill-drain template only when a batch system exists", () => {
    const noBatch = createSimProject({ name: "No Batch", processType: "pump-station", now: NOW });
    expect(availableScenarioTemplates(noBatch).some((t) => t.kind === "batch-fill-drain")).toBe(false);
    const { project } = batchProject();
    expect(availableScenarioTemplates(project).some((t) => t.kind === "batch-fill-drain")).toBe(true);
  });

  it("runs the batch-fill-drain scenario to a deterministic PASS verdict", () => {
    const { project } = batchProject();
    const added = addScenarioFromTemplate(project, "batch-fill-drain", NOW);
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    const result = runScenario(added.project, added.data!);
    if (result.status !== "pass") {
      const failed = result.checks
        .filter((c) => !c.passed)
        .map((c) => `${c.description}: expected ${c.expected}, got ${c.actual}`);
      throw new Error(`batch-fill-drain did not pass:\n${failed.join("\n")}\nerror=${result.error ?? "none"}`);
    }
    expect(result.status).toBe("pass");
    expect(result.checks.length).toBeGreaterThan(0);
    expect(result.summary.passed).toBe(result.summary.total);
    // Determinism: an identical run produces the same verdict and check set.
    const again = runScenario(added.project, added.data!);
    expect(again.status).toBe("pass");
    expect(again.summary).toEqual(result.summary);
  });

  it("fills, completes, and drains the vessel in the engine", () => {
    const { project, batch } = batchProject();
    const engine = new SimEngine(project);
    engine.setTag(`${batch.tag}_${TAG.startCmd}`, true);
    engine.runFor(800);
    expect(engine.readTag(`${batch.tag}_${TAG.pv}`) as number).toBeGreaterThan(99);
    expect(engine.readTag(`${batch.tag}_${TAG.done}`)).toBe(true);
    expect(engine.readTag(`${batch.tag}_${TAG.batchCount}`)).toBe(1);
    // Drain it back down.
    engine.setTag(`${batch.tag}_${TAG.startCmd}`, false);
    engine.setTag(`${batch.tag}_${TAG.drainCmd}`, true);
    engine.runFor(800);
    expect(engine.readTag(`${batch.tag}_${TAG.pv}`) as number).toBeLessThan(1);
    expect(engine.readTag(`${batch.tag}_${TAG.run}`)).toBe(false);
    // The completed-batch count is retained, not double-counted.
    expect(engine.readTag(`${batch.tag}_${TAG.batchCount}`)).toBe(1);
  });

  it("supports comm-loss / sensor-fail faults and rejects unsupported ones", () => {
    const { project, batch } = batchProject();
    const engine = new SimEngine(project);
    // Unsupported fault is rejected.
    expect(engine.injectFault(batch.id, "overload").ok).toBe(false);
    // sensor-fail drops the level reading.
    engine.setTag(`${batch.tag}_${TAG.startCmd}`, true);
    engine.runFor(400);
    expect(engine.readTag(`${batch.tag}_${TAG.pv}`) as number).toBeGreaterThan(0);
    expect(engine.injectFault(batch.id, "sensor-fail").ok).toBe(true);
    engine.runFor(100);
    expect(engine.readTag(`${batch.tag}_${TAG.pv}`)).toBe(0);
    // comm-loss latches the device fault bit.
    const fresh = new SimEngine(project);
    expect(fresh.injectFault(batch.id, "comm-loss").ok).toBe(true);
    fresh.runFor(50);
    expect(fresh.readTag(`${batch.tag}_${TAG.fault}`)).toBe(true);
  });
});
