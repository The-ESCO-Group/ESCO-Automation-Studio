import { describe, expect, it } from "vitest";
import { createProject } from "@esco/core";
import { createDefaultHmiProject, withHmiProject } from "@esco/hmi-model";
import { searchProject } from "./search";

// Guards the Find / Search Results paths that the broad search.test.ts fixture
// does not exercise: trends, Add-On Graphics, and offline controller-reference
// browser rows. These hit kinds are implemented in searchProject but were
// otherwise unverified, so a regression in any of them would pass unit tests.
function projectWithTrendGraphicAndReference() {
  const project = createProject("Glyph Cell", "Glyph station demo");

  const hmi = createDefaultHmiProject("Glyph HMI");
  hmi.trends.push({
    id: "trend_glyph",
    name: "Glyph Trend",
    timeRangeSeconds: 60,
    sampleRateMs: 1000,
    traces: [
      { id: "trace_glyph", label: "Glyph Trace", source: { kind: "tag", path: "GlyphSpeed", dataType: "REAL" }, color: "#00aa55" },
    ],
  });
  hmi.addOnGraphics.push({
    id: "aog_glyph",
    name: "Glyph Graphic",
    vendor: "ESCO",
    width: 120,
    height: 80,
    properties: [{ name: "GlyphProp", dataType: "REAL", defaultValue: 0 }],
    elements: [],
  });
  hmi.controllerReferences.push({
    id: "controller_ref_glyph",
    name: "Glyph Controller",
    controllerName: "CLX_GLYPH",
    sourceKind: "xml-review",
    sourcePath: "Glyph.L5X",
    sourceProjectId: "project_glyph",
    sourceControllerId: "controller_glyph",
    sourceHash: "glyphhash",
    syncStatus: "synchronized",
    lastSyncedAt: "2026-05-30T12:00:00.000Z",
    snapshot: { controllerTagCount: 1, programTagCount: 0, dataTypeCount: 0, alarmCount: 0 },
    tags: [{ path: "GlyphTag", name: "GlyphTag", dataType: "BOOL", scope: "controller" }],
    dataTypes: [],
    alarms: [],
  });

  return withHmiProject(project, hmi);
}

describe("project search — trend, Add-On Graphic, and controller-reference coverage", () => {
  it("surfaces trend, Add-On Graphic, and controller-reference hits", () => {
    const project = projectWithTrendGraphicAndReference();

    const hits = searchProject(project, "glyph", { maxHits: 500 });
    const kinds = new Set(hits.map((hit) => hit.kind));

    expect(kinds).toContain("hmi-trend");
    expect(kinds).toContain("hmi-add-on-graphic");
    expect(kinds).toContain("hmi-controller-reference");

    // The trend trace source path is replaceable only for expression bindings;
    // a tag-bound trace label is editable, so at least one trend hit is safe to replace.
    expect(hits.some((hit) => hit.kind === "hmi-trend" && hit.replaceable)).toBe(true);
    // Controller-reference rows mirror live controller data and must stay read-only.
    expect(hits.filter((hit) => hit.kind === "hmi-controller-reference").every((hit) => !hit.replaceable)).toBe(true);
  });

  it("honours the hmi scope filter for these kinds", () => {
    const project = projectWithTrendGraphicAndReference();

    const hmiHits = searchProject(project, "glyph", { scopes: ["hmi"], maxHits: 500 });

    expect(hmiHits.length).toBeGreaterThan(0);
    expect(hmiHits.every((hit) => hit.scope === "hmi")).toBe(true);
  });
});
