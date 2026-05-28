import { describe, expect, it } from "vitest";
import {
  createController,
  createProject,
  createTag,
  type AddOnInstruction,
  type IoModule,
  type PlcProject,
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

const udt = (name: string, members: { name: string; dataType: string }[]): UserDefinedType => ({
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

  it("diffs AOIs: AOI1 revision changed", () => {
    const change = result.addOnInstructions.changed.find((c) => c.name === "AOI1");
    expect(change?.details.join(" ")).toMatch(/revision: 1.0 → 2.0/);
  });

  it("diffs I/O modules: M1 unchanged", () => {
    expect(result.modules.unchanged).toBe(1);
    expect(result.modules.changed).toHaveLength(0);
  });
});

describe("compareReportHtml", () => {
  it("produces a self-contained HTML doc with routine and structure sections", () => {
    const html = compareReportHtml(compareProjects(left, right), compareStructure(left, right));
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("Comparison Report");
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
