import { describe, expect, it } from "vitest";
import { deserializeProject, serializeProject } from "@esco/project-store";
import { exportL5X } from "./exportL5X";
import { importL5X } from "./index";

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0">
  <Controller Use="Target" Name="MetaCtl" ProcessorType="1756-L85E" CatalogNumber="1756-L85E" MajorRev="33" MinorRev="11" Slot="0">
    <Description><![CDATA[Line 4 palletizer controller]]></Description>
    <Tags>
      <Tag Name="ConstTag" TagType="Base" DataType="DINT" Constant="true" ExternalAccess="Read Only"/>
      <Tag Name="ProdTag" TagType="Produced" DataType="DINT" ExternalAccess="Read/Write"/>
      <Tag Name="ConsTag" TagType="Consumed" DataType="DINT" ExternalAccess="None"/>
      <Tag Name="Plain" TagType="Base" DataType="BOOL"/>
    </Tags>
    <Programs>
      <Program Name="MainProgram" MainRoutineName="Main" FaultRoutineName="Fault" Disabled="true">
        <Parameters>
          <Parameter Name="InParam" DataType="DINT" Usage="Input" Required="true" Radix="Hex" ExternalAccess="Read Only" Constant="true"><Description><![CDATA[in val]]></Description></Parameter>
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

  it("imports the controller description", () => {
    expect(controller.description).toBe("Line 4 palletizer controller");
  });

  it("round-trips the controller description through export", () => {
    const { xml } = exportL5X(importL5X(XML).project);
    const reimported = importL5X(xml).project.controllers[0]!;
    expect(reimported.description).toBe("Line 4 palletizer controller");
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
    expect(program.parameters?.[0]?.radix).toBe("Hex");
    expect(program.parameters?.[0]?.externalAccess).toBe("read-only");
    expect(program.parameters?.[0]?.constant).toBe(true);
    expect(program.parameters?.[1]?.constant).toBeUndefined();
  });

  it("round-trips program-parameter radix, external access, and constant through export", () => {
    const { xml } = exportL5X(importL5X(XML).project);
    const param = importL5X(xml).project.controllers[0]!.programs[0]!.parameters?.[0]!;
    expect(param.name).toBe("InParam");
    expect(param.radix).toBe("Hex");
    expect(param.externalAccess).toBe("read-only");
    expect(param.constant).toBe(true);
  });

  it("imports constant, external access, and produced/consumed tag flags", () => {
    const tag = (name: string) => controller.controllerTags.find((t) => t.name === name)!;
    expect(tag("ConstTag").constant).toBe(true);
    expect(tag("ConstTag").externalAccess).toBe("read-only");
    expect(tag("ProdTag").produced).toBe(true);
    expect(tag("ProdTag").externalAccess).toBe("read-write");
    expect(tag("ConsTag").consumed).toBe(true);
    expect(tag("ConsTag").externalAccess).toBe("none");
    expect(tag("Plain").constant).toBeUndefined();
  });

  it("round-trips all new metadata through serialize/deserialize", () => {
    const { project } = importL5X(XML);
    expect(deserializeProject(serializeProject(project))).toEqual(project);
  });
});
