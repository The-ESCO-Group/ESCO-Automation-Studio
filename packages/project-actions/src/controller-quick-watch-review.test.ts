import { createController, createProgram, createProject, createTag, type QuickWatchList } from "@esco/core";
import { describe, expect, it } from "vitest";
import { controllerQuickWatchReviewReport } from "./controller-quick-watch-review";

function quickWatchList(name: string, tags: QuickWatchList["tags"]): QuickWatchList {
  return {
    id: `qwl-${name}`,
    name,
    tags,
  };
}

describe("controllerQuickWatchReviewReport", () => {
  it("projects imported Quick Watch definitions with explicit offline boundaries", () => {
    const project = createProject("WatchProject");
    const controller = createController(project.id, "WatchCtl");
    controller.controllerTags.push(createTag(controller.id, "StartPB", "BOOL"));
    const program = createProgram(controller.id, "PumpProgram");
    program.programTags.push(createTag(controller.id, "LocalSpeed", "DINT", { scope: "program", programId: program.id }));
    program.parameters = [{ name: "CommandedSpeed", dataType: "DINT", usage: "Input" }];
    controller.programs.push(program);
    controller.quickWatchLists = [
      quickWatchList("Startup Watch", [
        { id: "watch-1", specifier: "StartPB" },
        { id: "watch-2", specifier: "LocalSpeed", scope: "PumpProgram" },
        { id: "watch-3", specifier: "Program:PumpProgram.CommandedSpeed" },
      ]),
    ];
    project.controllers.push(controller);

    const report = controllerQuickWatchReviewReport(project);

    expect(report.listCount).toBe(1);
    expect(report.watchTagCount).toBe(3);
    expect(report.reviewableCount).toBe(1);
    expect(report.issueCount).toBe(0);
    expect(report.rows[0]).toMatchObject({
      controllerName: "WatchCtl",
      listName: "Startup Watch",
      watchTagCount: 3,
      controllerCommunicationModelled: false,
      onlineWatchMonitoringModelled: false,
      liveTagValuesModelled: false,
      forceOrEditInteractionModelled: false,
    });
    expect(report.rows[0]?.tags.map((tag) => tag.targetKind)).toEqual([
      "controller-tag",
      "program-tag",
      "program-parameter",
    ]);
    expect(report.rows[0]?.boundaries).toContain("no-online-watch-monitoring");
  });

  it("flags empty, duplicate, and unresolved Quick Watch lists", () => {
    const project = createProject("WatchProject");
    const controller = createController(project.id, "WatchCtl");
    controller.controllerTags.push(createTag(controller.id, "StartPB", "BOOL"));
    controller.quickWatchLists = [
      quickWatchList("Empty Watch", []),
      quickWatchList("Bad Watch", [
        { id: "watch-1", specifier: "StartPB" },
        { id: "watch-2", specifier: "StartPB" },
        { id: "watch-3", specifier: "MissingTag" },
      ]),
    ];
    project.controllers.push(controller);

    const report = controllerQuickWatchReviewReport(project);

    expect(report.listCount).toBe(2);
    expect(report.issueCount).toBe(2);
    expect(report.noWatchTagCount).toBe(1);
    expect(report.duplicateWatchTagCount).toBe(1);
    expect(report.unresolvedWatchTagCount).toBe(1);
    expect(report.rows.find((row) => row.listName === "Empty Watch")?.issues).toEqual(["no-watch-tags"]);
    expect(report.rows.find((row) => row.listName === "Bad Watch")?.issues).toEqual([
      "duplicate-watch-tag",
      "unresolved-watch-tag",
    ]);
    expect(report.rows.find((row) => row.listName === "Bad Watch")?.tags.find((tag) => tag.specifier === "MissingTag")?.resolved).toBe(false);
  });
});
