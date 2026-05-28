import { describe, expect, it } from "vitest";
import { deserializeProject, serializeProject } from "@esco/project-store";
import { importL5X } from "./index";

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0">
  <Controller Use="Target" Name="MetaCtl" ProcessorType="1756-L85E" CatalogNumber="1756-L85E" MajorRev="33" MinorRev="11" Slot="0">
    <Tags>
      <Tag Name="ConstTag" TagType="Base" DataType="DINT" Constant="true"/>
      <Tag Name="ProdTag" TagType="Produced" DataType="DINT"/>
      <Tag Name="ConsTag" TagType="Consumed" DataType="DINT"/>
      <Tag Name="Plain" TagType="Base" DataType="BOOL"/>
    </Tags>
    <Programs>
      <Program Name="MainProgram" MainRoutineName="Main" FaultRoutineName="Fault" Disabled="true">
        <Parameters>
          <Parameter Name="InParam" DataType="DINT" Usage="Input" Required="true"><Description><![CDATA[in val]]></Description></Parameter>
          <Parameter Name="OutParam" DataType="BOOL" Usage="Output"/>
        </Parameters>
        <Routines>
          <Routine Name="Main" Type="RLL"><RLLContent>
            <Rung Number="0"><Text><![CDATA[XIC(Plain)OTE(Plain);]]></Text></Rung>
          </RLLContent></Routine>
          <Routine Name="Fault" Type="RLL"><RLLContent></RLLContent></Routine>
        </Routines>
      </Program>
    </Programs>
    <Tasks>
      <Task Name="MainTask" Type="PERIODIC" Rate="20" Priority="10" Watchdog="500" InhibitTask="true">
        <ScheduledPrograms><ScheduledProgram Name="MainProgram"/></ScheduledPrograms>
      </Task>
    </Tasks>
  </Controller>
</RSLogix5000Content>`;

describe("importL5X — controller / task / program / tag metadata", () => {
  const controller = importL5X(XML).project.controllers[0]!;

  it("imports controller catalog, firmware, and slot", () => {
    expect(controller.catalogNumber).toBe("1756-L85E");
    expect(controller.firmwareRevision).toBe("33.11");
    expect(controller.slot).toBe(0);
  });

  it("imports task watchdog, period, priority, and inhibit", () => {
    const task = controller.tasks[0]!;
    expect(task.type).toBe("periodic");
    expect(task.periodMs).toBe(20);
    expect(task.priority).toBe(10);
    expect(task.watchdogMs).toBe(500);
    expect(task.inhibited).toBe(true);
  });

  it("imports program inhibit, fault routine, and parameters", () => {
    const program = controller.programs[0]!;
    expect(program.inhibited).toBe(true);
    const fault = program.routines.find((r) => r.name === "Fault")!;
    expect(program.faultRoutineId).toBe(fault.id);
    expect(program.parameters?.map((p) => `${p.name}:${p.usage}`)).toEqual(["InParam:Input", "OutParam:Output"]);
    expect(program.parameters?.[0]?.required).toBe(true);
    expect(program.parameters?.[0]?.description).toBe("in val");
  });

  it("imports constant and produced/consumed tag flags", () => {
    const tag = (name: string) => controller.controllerTags.find((t) => t.name === name)!;
    expect(tag("ConstTag").constant).toBe(true);
    expect(tag("ProdTag").produced).toBe(true);
    expect(tag("ConsTag").consumed).toBe(true);
    expect(tag("Plain").constant).toBeUndefined();
  });

  it("round-trips all new metadata through serialize/deserialize", () => {
    const { project } = importL5X(XML);
    expect(deserializeProject(serializeProject(project))).toEqual(project);
  });
});
