import { describe, expect, it } from "vitest";
import { createContinuousTask, createController, createProgram, createProject, createRoutine, createTag } from "@esco/core";
import { createLadderRoutine, createNode, createRung, tagOperand } from "@esco/ladder";
import { createDefaultHmiProject, createHmiElement, createHmiScreen, getHmiProject, withHmiProject } from "@esco/hmi-model";
import { applyProjectTextReplace, previewProjectTextReplace, searchProject } from "./search";

function projectWithSearchableContent() {
  const project = createProject("Pump Cell", "Pump station demo");
  const controller = createController(project.id, "PumpController");
  controller.description = "Main pump controller";
  const tag = createTag(controller.id, "PumpSpeed", "REAL", { description: "Pump speed setpoint" });
  tag.comments = [{ operand: ".Cmd", text: "Pump command member" }];
  const startTag = createTag(controller.id, "PumpStart", "BOOL", { description: "Pump start request" });
  controller.controllerTags.push(tag, startTag);

  const program = createProgram(controller.id, "PumpProgram");
  program.description = "Pump program folder";
  const routine = createRoutine(program.id, "PumpRoutine");
  const ladder = createLadderRoutine();
  ladder.rungs.push(createRung(routine.id, 0, [createNode("XIC", [tagOperand("source", "PumpStart")])], "Pump start permissive"));
  routine.ladder = ladder;
  program.routines.push(routine);
  controller.programs.push(program);
  const task = createContinuousTask(controller.id, "PumpTask", [program.id]);
  task.description = "Pump scan task";
  task.eventInfo = { eventTrigger: "Consumed Tag Connection", eventTag: "PumpStart" };
  controller.tasks.push(task);
  controller.ioConfiguration.modules.push({
    id: "module_pump_di",
    name: "PumpInputRack",
    catalogNumber: "1756-IB16",
    slot: 3,
    vendor: "ESCO Automation",
    productType: "Digital Input",
    description: "Pump input module",
    connections: [{ name: "Input", type: "Input", rpi: 10000, inputProductionTrigger: "COS" }],
    profileChannels: [
      {
        name: "Channel 0",
        signalType: "Discrete",
        direction: "Input",
        address: "Local:3:I.Data.0",
      },
    ],
  } as (typeof controller.ioConfiguration.modules)[number] & { profileChannels: unknown[] });
  controller.dataTypes.push({
    id: "udt_pump",
    name: "PumpUdt",
    description: "Pump UDT",
    members: [{ name: "PumpState", dataType: "DINT", description: "Pump state text" }],
  });
  project.controllers.push(controller);

  const hmi = createDefaultHmiProject("Pump HMI");
  const screen = createHmiScreen("Pump Overview");
  const button = createHmiElement("common.button", "Pump Start Button");
  button.properties.label = "Start Pump";
  button.bindings.push({
    id: "binding_enabled",
    targetProperty: "enabled",
    source: { kind: "tag", path: "PumpSpeed", dataType: "REAL" },
    mode: "read",
  });
  button.events.push({
    id: "event_press",
    eventType: "press",
    commands: [{ id: "cmd_note", type: "set-tag-value", safety: "runtime-preview", args: { tagPath: "PumpStart", value: "Pump request" } }],
  });
  screen.elements.push(button);
  hmi.screens.push(screen);
  hmi.homeScreenId = screen.id;
  hmi.assets.push({ id: "asset_pump", name: "Pump Photo", kind: "image", references: [] });
  hmi.alarms.push({
    id: "alarm_pump",
    name: "Pump Fault",
    tagPath: "PumpFault",
    severity: "major",
    trigger: { kind: "digital", activeValue: true },
    message: "Pump fault active",
    allowAcknowledge: true,
  });
  hmi.dataLogs.push({ id: "log_pump", name: "Pump History", sampleRateMs: 1000, retentionHours: 1, tagPaths: ["PumpSpeed"] });
  hmi.languagePacks[0]!.strings = { title: "Pump Overview" };
  hmi.security.roles.push({ id: "role_pump", name: "Pump Operators", permissions: ["pump-control"] });

  return withHmiProject(project, hmi);
}

describe("project search", () => {
  it("searches ladder, tags, comments, and broad HMI content", () => {
    const project = projectWithSearchableContent();

    const hits = searchProject(project, "pump", { maxHits: 500 });
    const kinds = new Set(hits.map((hit) => hit.kind));

    expect(kinds).toContain("controller");
    expect(kinds).toContain("task");
    expect(kinds).toContain("tag");
    expect(kinds).toContain("tag-comment");
    expect(kinds).toContain("io-module");
    expect(kinds).toContain("routine");
    expect(kinds).toContain("rung");
    expect(kinds).toContain("hmi-surface");
    expect(kinds).toContain("hmi-element");
    expect(kinds).toContain("hmi-binding");
    expect(kinds).toContain("hmi-event");
    expect(kinds).toContain("hmi-alarm");
    expect(kinds).toContain("hmi-data-log");
    expect(kinds).toContain("hmi-language");
    expect(kinds).toContain("hmi-security");
    expect(kinds).toContain("hmi-asset");
  });

  it("supports scope filters and safe replace previews", () => {
    const project = projectWithSearchableContent();

    const securityHits = searchProject(project, "pump", { scopes: ["security"], maxHits: 500 });
    const preview = previewProjectTextReplace(project, "pump", "Mixer", { maxHits: 500 });

    expect(securityHits.length).toBeGreaterThan(0);
    expect(securityHits.every((hit) => hit.scope === "security")).toBe(true);
    expect(preview.replaceableCount).toBeGreaterThan(0);
    expect(preview.skippedCount).toBeGreaterThan(0);
    expect(preview.hits.every((hit) => hit.replaceable)).toBe(true);
    expect(preview.hits.some((hit) => hit.before.includes("Pump") && hit.after.includes("Mixer"))).toBe(true);
  });

  it("applies replace-all only to previewed mutable text fields", () => {
    const project = projectWithSearchableContent();

    const result = applyProjectTextReplace(project, "pump", "Mixer", { maxHits: 500 });
    const controller = result.project.controllers[0]!;
    const tag = controller.controllerTags[0]!;
    const program = controller.programs[0]!;
    const routine = program.routines[0]!;
    const rung = createLadderRoutine();
    const hmi = getHmiProject(result.project)!;
    const screen = hmi.screens[0]!;
    const button = screen.elements[0]!;
    const command = button.events[0]!.commands[0]!;
    const pumpRole = hmi.security.roles.find((role) => role.id === "role_pump")!;

    expect(result.appliedCount).toBe(result.preview.replaceableCount);
    expect(controller.name).toBe("PumpController");
    expect(controller.description).toBe("Main Mixer controller");
    expect(tag.name).toBe("PumpSpeed");
    expect(tag.description).toBe("Mixer speed setpoint");
    expect(tag.comments?.[0]?.text).toBe("Mixer command member");
    expect(program.name).toBe("PumpProgram");
    expect(controller.tasks[0]!.name).toBe("PumpTask");
    expect(controller.tasks[0]!.description).toBe("Mixer scan task");
    expect(controller.ioConfiguration.modules[0]!.name).toBe("PumpInputRack");
    expect(controller.ioConfiguration.modules[0]!.description).toBe("Mixer input module");
    expect(routine.name).toBe("PumpRoutine");
    expect((routine.ladder as typeof rung).rungs[0]!.comment).toBe("Mixer start permissive");
    expect(screen.name).toBe("Mixer Overview");
    expect(button.name).toBe("Mixer Start Button");
    expect(button.properties.label).toBe("Start Mixer");
    expect(button.bindings[0]!.source.path).toBe("PumpSpeed");
    expect(command.args.tagPath).toBe("PumpStart");
    expect(command.args.value).toBe("Mixer request");
    expect(pumpRole.name).toBe("Mixer Operators");
    expect(pumpRole.permissions).toEqual(["pump-control"]);
  });

  it("marks defined tag and rung-operand hits for Watch, Force, and Cross Reference actions", () => {
    const project = projectWithSearchableContent();

    const hits = searchProject(project, "PumpStart", { maxHits: 500 });
    const tagHit = hits.find((hit) => hit.kind === "tag" && hit.label === "PumpStart");
    const operandHit = hits.find((hit) => hit.kind === "rung-operand" && hit.tagName === "PumpStart");

    expect(tagHit?.tagName).toBe("PumpStart");
    expect(operandHit).toMatchObject({
      tagName: "PumpStart",
      routineId: expect.any(String),
      replaceable: false,
    });
  });

  it("searches task and I/O metadata with openable navigation targets without making identifiers replaceable", () => {
    const project = projectWithSearchableContent();

    const taskHits = searchProject(project, "Consumed Tag", { maxHits: 500 });
    const moduleHits = searchProject(project, "1756-IB16", { maxHits: 500 });
    const slotHits = searchProject(project, "3", { maxHits: 500 }).filter((hit) => hit.kind === "io-module");
    const channelHits = searchProject(project, "Local:3:I.Data.0", { maxHits: 500 });

    expect(taskHits).toContainEqual(
      expect.objectContaining({
        kind: "task",
        label: "PumpTask",
        target: expect.stringMatching(/^task:/),
        navigationTarget: expect.stringMatching(/^task:/),
        replaceable: false,
      }),
    );
    expect(moduleHits).toContainEqual(
      expect.objectContaining({
        kind: "io-module",
        label: "PumpInputRack",
        detail: "catalog number",
        navigationTarget: expect.stringContaining("/io-module:module_pump_di"),
        replaceable: false,
      }),
    );
    expect(slotHits).toContainEqual(expect.objectContaining({ detail: "slot", matchText: "3", replaceable: false }));
    expect(channelHits).toContainEqual(
      expect.objectContaining({
        kind: "io-module",
        detail: "channel address",
        replaceable: false,
      }),
    );
  });
});
