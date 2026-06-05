import { describe, expect, it } from "vitest";
import {
  addDevice,
  addRack,
  createSimProject,
  defaultDeviceTag,
  deserializeSimProject,
  removeDevice,
  serializeSimProject,
  setScanRate,
  updateDeviceTag,
} from "./project";

const NOW = () => "2026-01-01T00:00:00.000Z";

describe("Simulation project state", () => {
  it("creates an offline project with a controller, racks, devices, and boundary", () => {
    const project = createSimProject({ name: "Demo", processType: "pump-station", now: NOW });
    expect(project.schema).toBe("esco-sim-lab/v1");
    expect(project.offlineOnly).toBe(true);
    expect(project.boundary).toMatch(/offline and virtual only/i);
    expect(project.controller.offlineOnly).toBe(true);
    expect(project.racks.length).toBeGreaterThan(0);
    expect(project.devices.length).toBeGreaterThan(0);
  });

  it("generates virtual tags for every device", () => {
    const project = createSimProject({ name: "Demo", processType: "pump-station", now: NOW });
    for (const device of project.devices) {
      expect(device.tags.length).toBeGreaterThan(0);
      for (const tag of device.tags) expect(tag.name.startsWith(device.tag)).toBe(true);
    }
  });

  it("uses deterministic ids", () => {
    const a = createSimProject({ name: "Demo", processType: "skid", now: NOW });
    const b = createSimProject({ name: "Demo", processType: "skid", now: NOW });
    expect(a.devices.map((d) => d.id)).toEqual(b.devices.map((d) => d.id));
  });

  it("adds and removes devices immutably (real state mutation, not UI-only)", () => {
    const project = createSimProject({ name: "Demo", processType: "skid", seedDefaults: false, now: NOW });
    expect(project.devices).toHaveLength(0);

    const added = addDevice(project, { kind: "motor", tag: "M201" }, NOW);
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    expect(project.devices).toHaveLength(0); // original untouched
    expect(added.project.devices).toHaveLength(1);
    expect(added.data!.tags.length).toBeGreaterThan(0);

    const dup = addDevice(added.project, { kind: "motor", tag: "M201" }, NOW);
    expect(dup.ok).toBe(false);

    const removed = removeDevice(added.project, added.data!.id, NOW);
    expect(removed.ok).toBe(true);
    if (removed.ok) expect(removed.project.devices).toHaveLength(0);
  });

  it("edits a device tag's units and scaling", () => {
    const project = createSimProject({ name: "Demo", processType: "pump-station", now: NOW });
    const device = project.devices.find((d) => d.kind === "flow-meter")!;
    const tag = device.tags[0]!;
    const result = updateDeviceTag(project, device.id, tag.id, { units: "lpm" }, NOW);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const updated = result.project.devices.find((d) => d.id === device.id)!.tags.find((t) => t.id === tag.id)!;
      expect(updated.units).toBe("lpm");
    }
  });

  it("adds racks and sets the scan rate", () => {
    const project = createSimProject({ name: "Demo", processType: "skid", now: NOW });
    const racked = addRack(project, "Rack X", 16, NOW);
    expect(racked.ok).toBe(true);
    if (racked.ok) expect(racked.project.racks.at(-1)!.name).toBe("Rack X");

    const scan = setScanRate(project, 25, NOW);
    expect(scan.ok).toBe(true);
    if (scan.ok) expect(scan.project.controller.scanRateMs).toBe(25);
    expect(setScanRate(project, 0, NOW).ok).toBe(false);
  });

  it("round-trips serialization to ESCO-native JSON", () => {
    const project = createSimProject({ name: "Demo", processType: "tank-farm", now: NOW });
    const text = serializeSimProject(project);
    const restored = deserializeSimProject(text);
    expect(restored).toEqual(project);
  });

  it("default device tags follow the blueprint prefix", () => {
    expect(defaultDeviceTag("motor", 0)).toBe("M101");
    expect(defaultDeviceTag("flow-meter", 1)).toBe("FT102");
  });
});
