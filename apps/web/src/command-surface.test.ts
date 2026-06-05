import { describe, expect, it } from "vitest";
import {
  ESCO_COMMAND_SURFACE_AUDIT,
  ESCO_COMMAND_SURFACE_KINDS,
  escoCommandSurfaceCounts,
  escoCommandSurfaceGroupSummaries,
  escoCommandSurfaceGuardFindings,
} from "./command-surface";

describe("ESCO command surface audit", () => {
  it("classifies the visible IDE command surface without soft gaps", () => {
    expect(ESCO_COMMAND_SURFACE_AUDIT.length).toBeGreaterThan(150);
    const ids = new Set<string>();
    for (const entry of ESCO_COMMAND_SURFACE_AUDIT) {
      expect(ids.has(entry.id)).toBe(false);
      ids.add(entry.id);
      expect(ESCO_COMMAND_SURFACE_KINDS).toContain(entry.kind);
      expect(entry.actionPath.trim()).not.toBe("");
      expect(entry.label).not.toMatch(/coming soon|placeholder|toast-only/i);
    }
  });

  it("keeps guarded hardware commands tied to unsupported or planned read-only capabilities", () => {
    expect(escoCommandSurfaceGuardFindings()).toEqual([]);
    const guarded = ESCO_COMMAND_SURFACE_AUDIT.filter((entry) => entry.kind === "guarded-hardware");
    expect(guarded.length).toBeGreaterThanOrEqual(30);
    expect(guarded.map((entry) => entry.controllerCommandKind)).toEqual(
      expect.arrayContaining(["go-online", "upload", "download", "network-browser"]),
    );
  });

  it("covers ribbon, path, organizer, and editor context command groups", () => {
    const groups = escoCommandSurfaceGroupSummaries();
    expect(groups.map((group) => group.key)).toEqual(
      expect.arrayContaining([
        "Ribbon menu:File",
        "Ribbon menu:Communications",
        "Ribbon toolbar:Standard toolbar",
        "Ribbon toolbar:Online toolbar",
        "Path/status bar:Path/status bar",
        "Organizer context:Controller",
        "Organizer context:Tasks and programs",
        "Organizer context:I/O",
        "Editor context:Instruction",
        "Editor context:Rung",
      ]),
    );
  });

  it("tracks Simulation Lab and editor context commands from the visible IDE", () => {
    const byId = new Map(ESCO_COMMAND_SURFACE_AUDIT.map((entry) => [entry.id, entry]));
    expect(byId.get("ribbon-menu:View:ESCO Simulation Lab")?.kind).toBe("simulation-action");
    expect(byId.get("ribbon-toolbar:Standard toolbar:Simulation lab")?.kind).toBe("simulation-action");
    expect(byId.get("ribbon-menu:File:Export ESCO Exchange")?.kind).toBe("review-import-export");
    expect(byId.get("ribbon-menu:File:Import ESCO Exchange")?.kind).toBe("review-import-export");
    expect(byId.get("organizer-context:Controller:Import Program")?.kind).toBe("review-import-export");
    expect(byId.get("organizer-context:Tasks and programs:Import Task")?.kind).toBe("review-import-export");
    expect(byId.get("organizer-context:Tags:Import Tag Component")?.kind).toBe("review-import-export");
    expect(byId.get("editor-context:Instruction:Edit Operand...")?.kind).toBe("offline-action");
    expect(byId.get("editor-context:Instruction:Force Value")?.kind).toBe("simulation-action");
    expect(byId.get("editor-context:Rung:Cross Reference Rung")?.kind).toBe("offline-navigation");
    expect(byId.get("editor-context:Rung:Assemble Edits")).toMatchObject({
      kind: "guarded-hardware",
      controllerCommandKind: "assemble-edits",
    });
  });

  it("reports a useful mix of offline, review, simulation, guarded, and informational commands", () => {
    const counts = escoCommandSurfaceCounts();
    expect(counts["offline-action"]).toBeGreaterThan(45);
    expect(counts["offline-navigation"]).toBeGreaterThan(30);
    expect(counts["review-import-export"]).toBeGreaterThan(25);
    expect(counts["simulation-action"]).toBeGreaterThan(10);
    expect(counts["guarded-hardware"]).toBeGreaterThan(30);
    expect(counts.informational).toBeGreaterThan(0);
  });
});
