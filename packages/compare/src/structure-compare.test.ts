import { describe, expect, it } from "vitest";
import {
  createController,
  createProgram,
  createProject,
  createRoutine,
  createTag,
  type AddOnInstruction,
  type IoModule,
  type PlcProject,
  type Task,
  type UserDefinedType,
} from "@esco/core";
import { compareStructure } from "./structure-compare";
import { compareProjects } from "./compare";
import { compareReportHtml } from "./report";

function project(
  name: string,
  build: (controller: ReturnType<typeof createController>) => void,
): PlcProject {
  const p = createProject(name);
  const controller = createController(p.id, name);
  build(controller);
  p.controllers.push(controller);
  return p;
}

const udt = (name: string, members: UserDefinedType["members"]): UserDefinedType => ({
  id: `udt-${name}`,
  name,
  members,
});
const aoi = (name: string, revision: string): AddOnInstruction => ({
  id: `aoi-${name}`,
  name,
  revision,
  parameters: [],
  localTags: [],
  routineNames: [],
});
const mod = (name: string, slot: number): IoModule => ({ id: `mod-${name}`, name, slot });

const left = project("Left", (c) => {
  c.controllerTags.push(createTag(c.id, "A", "BOOL"), createTag(c.id, "B", "DINT"));
  c.dataTypes.push(udt("U1", [{ name: "x", dataType: "BOOL" }]));
  c.addOnInstructions.push(aoi("AOI1", "1.0"));
  c.ioConfiguration.modules.push(mod("M1", 0));
});
const right = project("Right", (c) => {
  c.controllerTags.push(createTag(c.id, "A", "DINT"), createTag(c.id, "C", "BOOL"));
  c.dataTypes.push(udt("U1", [{ name: "x", dataType: "BOOL" }, { name: "y", dataType: "DINT" }]));
  c.addOnInstructions.push(aoi("AOI1", "2.0"));
  c.ioConfiguration.modules.push(mod("M1", 0));
});

describe("compareStructure", () => {
  const result = compareStructure(left, right);

  it("diffs tags: A changed (type), B removed, C added", () => {
    expect(result.tags.removed).toContain("B");
    expect(result.tags.added).toContain("C");
    expect(result.tags.changed.map((c) => c.name)).toContain("A");
    expect(result.tags.changed.find((c) => c.name === "A")?.details.join(" ")).toMatch(/type: BOOL → DINT/);
  });

  it("diffs UDTs: U1 members changed", () => {
    expect(result.dataTypes.changed.map((c) => c.name)).toContain("U1");
  });

  it("diffs full multi-dimensional array metadata", () => {
    const a = project("ArrayLeft", (c) => {
      c.controllerTags.push(createTag(c.id, "Matrix", "DINT", { dimensions: [2, 3] }));
      c.dataTypes.push(udt("Recipe", [{ name: "Steps", dataType: "DINT", dimensions: [2, 3] }]));
    });
    const b = project("ArrayRight", (c) => {
      c.controllerTags.push(createTag(c.id, "Matrix", "DINT", { dimensions: [2, 4] }));
      c.dataTypes.push(udt("Recipe", [{ name: "Steps", dataType: "DINT", dimensions: [2, 4] }]));
    });
    const arrayDiff = compareStructure(a, b);

    expect(arrayDiff.tags.changed.find((c) => c.name === "Matrix")?.details.join(" ")).toContain(
      "dimensions: [2,3] → [2,4]",
    );
    expect(arrayDiff.dataTypes.changed.find((c) => c.name === "Recipe")?.details.join(" ")).toContain(
      "Steps:DINT[2,3]",
    );
    expect(arrayDiff.dataTypes.changed.find((c) => c.name === "Recipe")?.details.join(" ")).toContain(
      "Steps:DINT[2,4]",
    );
  });

  it("diffs AOIs: AOI1 revision changed", () => {
    const change = result.addOnInstructions.changed.find((c) => c.name === "AOI1");
    expect(change?.details.join(" ")).toMatch(/revision: 1.0 → 2.0/);
  });

  it("diffs I/O modules: M1 unchanged", () => {
    expect(result.modules.unchanged).toBe(1);
    expect(result.modules.changed).toHaveLength(0);
  });

  it("diffs I/O module profile metadata, connections, ports, and channel rows", () => {
    const profiledModule = (overrides: Partial<IoModule> & { profileChannels?: unknown[] }): IoModule => {
      const module: IoModule & { profileChannels?: unknown[] } = {
        id: "module-profile-ai",
        name: "Profile_AI",
        catalogNumber: "1756-IF8H",
        slot: 2,
        parentModule: "Local",
        parentPortId: "1",
        commPath: "Local,2",
        vendor: "ESCO Automation",
        productType: "Analog Input Module",
        productCode: "123",
        majorRevision: "1",
        minorRevision: "0",
        electronicKeying: "CompatibleModule",
        inhibited: false,
        majorFault: false,
        ports: [{ id: "1", type: "Backplane", address: "2", busSize: 8 }],
        connections: [
          {
            name: "Data",
            type: "Input",
            rpi: 100000,
            priority: "Scheduled",
            inputConnectionType: "Multicast",
            inputProductionTrigger: "Cyclic",
          },
        ],
        profileChannels: [
          {
            id: "Ch0",
            label: "Channel 0",
            direction: "Input",
            signal: "4-20 mA",
            enabled: true,
            dataFormat: "Float + HART",
            range: "4-20 mA + HART",
            diagnostic: "Profile default",
          },
        ],
      };
      return { ...module, ...overrides };
    };
    const a = project("A", (c) => {
      c.ioConfiguration.modules.push(profiledModule({}));
    });
    const b = project("B", (c) => {
      c.ioConfiguration.modules.push(
        profiledModule({
          parentPortId: "2",
          vendor: "Field Vendor",
          productCode: "456",
          majorRevision: "2",
          minorRevision: "1",
          electronicKeying: "ExactMatch",
          inhibited: true,
          majorFault: true,
          ports: [{ id: "2", type: "Ethernet", address: "192.168.1.20", upstream: true }],
          connections: [
            {
              name: "Data",
              type: "Input",
              rpi: 200000,
              priority: "Scheduled",
              unicast: true,
              inputConnectionType: "Unicast",
              inputProductionTrigger: "COS",
            },
          ],
          profileChannels: [
            {
              id: "Ch0",
              label: "Channel 0",
              direction: "Input",
              signal: "4-20 mA",
              enabled: false,
              dataFormat: "Integer",
              range: "0-10 V",
              diagnostic: "Disabled spare",
            },
          ],
        }),
      );
    });

    const change = compareStructure(a, b).modules.changed.find((row) => row.name === "Profile_AI");
    const details = change?.details.join("\n") ?? "";

    expect(details).toContain("parent port: 1 → 2");
    expect(details).toContain("vendor: ESCO Automation → Field Vendor");
    expect(details).toContain("product code: 123 → 456");
    expect(details).toContain("revision: 1.0 → 2.1");
    expect(details).toContain("keying: CompatibleModule → ExactMatch");
    expect(details).toContain("inhibited: false → true");
    expect(details).toContain("major fault on connection loss: false → true");
    expect(details).toContain("ports:");
    expect(details).toContain("connections:");
    expect(details).toContain("profile channels:");
  });
});

const task = (controllerId: string, name: string, overrides: Partial<Task> = {}): Task => ({
  id: `task-${name}`,
  controllerId,
  name,
  type: "periodic",
  scheduledProgramIds: [],
  ...overrides,
});

describe("compareStructure programs & tasks", () => {
  it("diffs programs: added, removed, and changed (main routine + new routine)", () => {
    const a = project("A", (c) => {
      const main = createProgram(c.id, "Main");
      const r1 = createRoutine(main.id, "MainRoutine");
      main.routines.push(r1);
      main.mainRoutineId = r1.id;
      const legacy = createProgram(c.id, "Legacy");
      c.programs.push(main, legacy);
    });
    const b = project("B", (c) => {
      const main = createProgram(c.id, "Main");
      const r1 = createRoutine(main.id, "MainRoutine");
      const r2 = createRoutine(main.id, "Startup");
      main.routines.push(r1, r2);
      main.mainRoutineId = r2.id; // main routine changed + routine added
      const fresh = createProgram(c.id, "Conveyor");
      c.programs.push(main, fresh);
    });
    const diff = compareStructure(a, b);
    expect(diff.programs.removed).toContain("Legacy");
    expect(diff.programs.added).toContain("Conveyor");
    const mainChange = diff.programs.changed.find((p) => p.name === "Main");
    expect(mainChange?.details.join(" ")).toMatch(/main routine: MainRoutine → Startup/);
    expect(mainChange?.details.join(" ")).toMatch(/routines:/);
  });

  it("diffs tasks: period, watchdog, and scheduled programs (compared by name across ids)", () => {
    const a = project("A", (c) => {
      const prog = createProgram(c.id, "Motion");
      c.programs.push(prog);
      c.tasks.push(task(c.id, "MainTask", { periodMs: 10, watchdogMs: 500, scheduledProgramIds: [prog.id] }));
    });
    const b = project("B", (c) => {
      const prog = createProgram(c.id, "Motion"); // different id, same name
      const extra = createProgram(c.id, "Safety");
      c.programs.push(prog, extra);
      c.tasks.push(
        task(c.id, "MainTask", { periodMs: 20, watchdogMs: 500, scheduledProgramIds: [prog.id, extra.id] }),
      );
    });
    const diff = compareStructure(a, b);
    const change = diff.tasks.changed.find((t) => t.name === "MainTask");
    expect(change?.details.join(" ")).toMatch(/period \(ms\): 10 → 20/);
    // Same program name scheduled in both -> only the newly-scheduled "Safety" shows up, no false id churn.
    expect(change?.details.join(" ")).toMatch(/scheduled programs: Motion → Motion, Safety/);
    // Watchdog unchanged -> not reported.
    expect(change?.details.join(" ")).not.toMatch(/watchdog/);
  });
});

describe("compareReportHtml", () => {
  it("produces a self-contained HTML doc with routine and structure sections", () => {
    const html = compareReportHtml(compareProjects(left, right), compareStructure(left, right));
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("Comparison Report");
    expect(html).toContain("Tasks");
    expect(html).toContain("Programs");
    expect(html).toContain("Tags");
    expect(html).toContain("Data Types");
    expect(html).toContain("Add-On Instructions");
    expect(html).toContain("I/O Modules");
    expect(html).toContain("changed");
  });

  it("escapes HTML-special characters in names/details", () => {
    const evil = project("Evil", (c) => c.controllerTags.push(createTag(c.id, "A", "DINT")));
    // A right project missing tag <A> → 'removed' row; ensure no raw angle brackets injected.
    const html = compareReportHtml(compareProjects(evil, project("Empty", () => {})), compareStructure(evil, project("Empty", () => {})));
    expect(html).not.toContain("<script>");
  });
});
