import { describe, expect, it } from "vitest";
import { exportL5X } from "./exportL5X";
import { importL5X } from "./index";

// GuardLogix projects carry a dedicated Safety Task marked with `Class="Safety"`
// (standard tasks are `Class="Standard"` or carry no Class at all). Like the
// program / tag partition, it is display/organisational metadata (never used here
// to schedule a safety task), but it must survive export -> import so the task
// partition is not silently lost when an engineer round-trips a GuardLogix project.
const XML = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0">
  <Controller Use="Target" Name="SafetyCtl" ProcessorType="1756-L8SP" MajorRev="33" MinorRev="11">
    <Programs>
      <Program Name="SafetyProg" Class="Safety">
        <Routines>
          <Routine Name="MainRoutine" Type="RLL"><RLLContent/></Routine>
        </Routines>
      </Program>
      <Program Name="StdProg">
        <Routines>
          <Routine Name="MainRoutine" Type="RLL"><RLLContent/></Routine>
        </Routines>
      </Program>
    </Programs>
    <Tasks>
      <Task Name="SafetyTask" Type="PERIODIC" Rate="10" Priority="9" Watchdog="20" Class="Safety">
        <ScheduledPrograms><ScheduledProgram Name="SafetyProg"/></ScheduledPrograms>
      </Task>
      <Task Name="StandardTask" Type="CONTINUOUS" Class="Standard">
        <ScheduledPrograms><ScheduledProgram Name="StdProg"/></ScheduledPrograms>
      </Task>
      <Task Name="PlainTask" Type="PERIODIC" Rate="50">
        <ScheduledPrograms/>
      </Task>
    </Tasks>
  </Controller>
</RSLogix5000Content>`;

describe("importL5X — task safety class", () => {
  const tasksOf = (xml: string) => {
    const controller = importL5X(xml).project.controllers[0]!;
    return (name: string) => controller.tasks.find((t) => t.name === name)!;
  };

  it("imports the Task Class attribute as safetyClass", () => {
    const task = tasksOf(XML);
    expect(task("SafetyTask").safetyClass).toBe("Safety");
    expect(task("StandardTask").safetyClass).toBe("Standard");
    expect(task("PlainTask").safetyClass).toBeUndefined();
  });

  it("round-trips the task safety partition through export -> import", () => {
    const { xml } = exportL5X(importL5X(XML).project);
    const task = tasksOf(xml);
    expect(task("SafetyTask").safetyClass).toBe("Safety");
    expect(task("StandardTask").safetyClass).toBe("Standard");
    expect(task("PlainTask").safetyClass).toBeUndefined();
  });
});
