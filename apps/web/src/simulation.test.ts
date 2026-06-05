import { describe, expect, it } from "vitest";
import { createController, createProgram, createProject, createTag, type UserDefinedType } from "@esco/core";
import { watchRows, zeroValues } from "./simulation";

describe("simulation watch rows", () => {
  it("renders MESSAGE and imported UDT members as structured watch values", () => {
    const project = createProject("Watch");
    const controller = createController(project.id, "C");
    const motorUdt: UserDefinedType = {
      id: "udt_motor",
      name: "MotorUdt",
      members: [
        { name: "Running", dataType: "BOOL" },
        { name: "Faults", dataType: "BOOL", dimension: 2 },
      ],
    };
    controller.dataTypes.push(motorUdt);
    controller.controllerTags.push(
      createTag(controller.id, "MsgCtl", "MESSAGE"),
      createTag(controller.id, "M1", "MotorUdt"),
    );
    project.controllers.push(controller);

    const values = {
      ...zeroValues(project),
      "MsgCtl.Path": "2,10.0.0.5",
      "M1.Running": true,
      "M1.Faults[1]": true,
    };
    const rows = watchRows(project, values);

    const msg = rows.find((row) => row.name === "MsgCtl");
    expect(msg?.kind).toBe("struct");
    expect(msg?.members?.some((member) => member.name === "Path" && member.value === "2,10.0.0.5")).toBe(true);

    const motor = rows.find((row) => row.name === "M1");
    expect(motor?.members?.some((member) => member.name === "Running" && member.value === true)).toBe(true);
    expect(motor?.members?.some((member) => member.name === "Faults[1]" && member.value === true)).toBe(true);
  });

  it("renders program-scoped tags with qualified value paths", () => {
    const project = createProject("Watch");
    const controller = createController(project.id, "C");
    const program = createProgram(controller.id, "Mixer");
    program.programTags.push(createTag(controller.id, "LocalRun", "BOOL", { scope: "program", programId: program.id }));
    controller.programs.push(program);
    project.controllers.push(controller);

    const values = { ...zeroValues(project), "Program:Mixer.LocalRun": true };
    const rows = watchRows(project, values);

    const local = rows.find((row) => row.name === "Program:Mixer.LocalRun");
    expect(local?.kind).toBe("bool");
    expect(local?.value).toBe(true);
  });
});
