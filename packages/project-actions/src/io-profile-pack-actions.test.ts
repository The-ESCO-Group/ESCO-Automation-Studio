import { describe, expect, it } from "vitest";
import { createController, createProject, type IoModule, type PlcProject } from "@esco/core";
import {
  exportIoProfilePack,
  importIoProfilePack,
  previewIoProfilePackImport,
} from "./io-profile-pack-actions";
import { parseNativeFileEnvelope } from "./native-format";

function module(input: Partial<IoModule> & Pick<IoModule, "id" | "name">): IoModule {
  return {
    id: input.id,
    name: input.name,
    catalogNumber: input.catalogNumber ?? "1756-IB16",
    slot: input.slot,
    parentModule: input.parentModule,
    parentPortId: input.parentPortId,
    productType: input.productType,
    connections: input.connections,
    ports: input.ports,
    ...(input as IoModule & { profileChannels?: unknown[] }).profileChannels
      ? { profileChannels: (input as IoModule & { profileChannels?: unknown[] }).profileChannels }
      : {},
  } as IoModule;
}

function projectWithModules(modules: IoModule[]): PlcProject {
  const project = { ...createProject("I/O Profile Pack Test"), id: "project-1", updatedAt: "2026-01-02T00:00:00.000Z" };
  const controller = { ...createController(project.id, "Controller_1"), id: "ctrl-1" };
  return {
    ...project,
    controllers: [
      {
        ...controller,
        ioConfiguration: { modules },
      },
    ],
  };
}

describe("I/O profile pack actions", () => {
  it("exports a checksum-validated .easio envelope with offline boundary evidence", () => {
    const project = projectWithModules([
      module({
        id: "module-1",
        name: "DI_01",
        catalogNumber: "1756-IB16",
        slot: 1,
        productType: "Digital Input",
        connections: [{ name: "Input", rpi: 10000, inputConnectionType: "Multicast" }],
      }),
    ]);

    const result = exportIoProfilePack(project, "ctrl-1");

    expect(result.ok).toBe(true);
    expect(result.data?.fileName).toBe("Controller_1-io-profile-pack.easio");
    const parsed = parseNativeFileEnvelope<{ modules: IoModule[]; boundaries: string[] }>(result.data!.text, { expectedKind: "io" });
    expect(parsed.ok).toBe(true);
    expect(parsed.checksum?.valid).toBe(true);
    expect(parsed.file?.payload.modules).toHaveLength(1);
    expect(parsed.file?.payload.boundaries.join(" ")).toMatch(/No AOP install parsing/);
  });

  it("previews conflicting imported modules with rename, overwrite, and slot-collision evidence", () => {
    const project = projectWithModules([
      module({ id: "module-1", name: "DI_01", slot: 1 }),
      module({ id: "module-2", name: "AI_01", slot: 2 }),
    ]);
    const pack = exportIoProfilePack(
      projectWithModules([
        module({ id: "incoming-1", name: "DI_01", slot: 1 }),
        module({ id: "incoming-2", name: "New_Module", slot: 2 }),
      ]),
      "ctrl-1",
    ).data!.text;

    const plan = previewIoProfilePackImport(project, "ctrl-1", pack);

    expect(plan.ok).toBe(true);
    expect(plan.kindLabel).toBe("I/O Module Profile");
    expect(plan.sourceFormat).toBe("esco-io-profile-pack");
    expect(plan.items[0]).toMatchObject({ sourceName: "DI_01", status: "error", conflict: true });
    expect(plan.items[0]?.availableOptions).toContain("overwrite");
    expect(plan.items[1]).toMatchObject({ sourceName: "New_Module", status: "error", conflict: false });
    expect(plan.items[1]?.message).toMatch(/slot 2/i);
  });

  it("imports with explicit overwrite and preserves profile metadata without controller communication", () => {
    const project = projectWithModules([module({ id: "module-1", name: "DI_01", slot: 1, productType: "Old" })]);
    const source = projectWithModules([
      module({
        id: "incoming-1",
        name: "DI_01",
        slot: 1,
        productType: "Digital Input",
        connections: [{ name: "Input", rpi: 20000 }],
        profileChannels: [{ id: "0", label: "Point 0", enabled: true, dataFormat: "BOOL" }],
      } as IoModule & { profileChannels: unknown[] }),
    ]);
    const pack = exportIoProfilePack(source, "ctrl-1").data!.text;

    const result = importIoProfilePack(project, "ctrl-1", pack, { "0": { option: "overwrite" } });

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({ created: 0, overwritten: 1, importedNames: ["DI_01"] });
    expect(result.receipt?.evidence.some((entry) => /no AOP/i.test(entry.detail))).toBe(true);
    const imported = result.project.controllers[0]!.ioConfiguration.modules[0] as IoModule & { profileChannels?: unknown[] };
    expect(imported.id).toBe("module-1");
    expect(imported.productType).toBe("Digital Input");
    expect(imported.connections?.[0]?.rpi).toBe(20000);
    expect(imported.profileChannels).toEqual([{ id: "0", label: "Point 0", enabled: true, dataFormat: "BOOL" }]);
  });

  it("imports new modules, remapping child parent names after rename", () => {
    const target = projectWithModules([module({ id: "existing", name: "RemoteRack", slot: 1 })]);
    const source = projectWithModules([
      module({ id: "rack", name: "RemoteRack", slot: 10 }),
      module({ id: "child", name: "RemoteDI", parentModule: "RemoteRack", slot: 1 }),
    ]);
    const pack = exportIoProfilePack(source, "ctrl-1").data!.text;

    const result = importIoProfilePack(target, "ctrl-1", pack, { "0": { option: "rename", renameTo: "RemoteRack_Imported" } });

    expect(result.ok).toBe(true);
    expect(result.data?.renamed).toBe(1);
    const modules = result.project.controllers[0]!.ioConfiguration.modules;
    expect(modules.map((candidate) => candidate.name)).toContain("RemoteRack_Imported");
    expect(modules.find((candidate) => candidate.name === "RemoteDI")?.parentModule).toBe("RemoteRack_Imported");
  });

  it("rejects corrupt and wrong-family files without mutating the project", () => {
    const project = projectWithModules([]);

    const corrupt = previewIoProfilePackImport(project, "ctrl-1", "{ nope");
    const wrong = previewIoProfilePackImport(
      project,
      "ctrl-1",
      JSON.stringify({ format: "esco.component.export.v1", kind: "routine", payload: { name: "Main" } }),
    );
    const missingController = importIoProfilePack(project, "missing", JSON.stringify({ modules: [] }));

    expect(corrupt.ok).toBe(false);
    expect(wrong.ok).toBe(false);
    expect(missingController.ok).toBe(false);
    expect(missingController.project).toBe(project);
  });
});
