import { describe, expect, it } from "vitest";
import { exportL5X } from "./exportL5X";
import { importL5X } from "./index";

// Logix stores descriptions for individual array elements and structure members
// in a per-tag <Comments> block (keyed by operand), not on the data type. These
// must survive import and round-trip through export.
const XML = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0">
  <Controller Use="Target" Name="CommentCtl">
    <Tags>
      <Tag Name="Motor" TagType="Base" DataType="MOTOR_UDT">
        <Description><![CDATA[Main drive motor]]></Description>
        <Comments>
          <Comment Operand=".Speed"><![CDATA[Commanded speed (RPM)]]></Comment>
          <Comment Operand=".Running"><![CDATA[Motor running feedback]]></Comment>
        </Comments>
      </Tag>
      <Tag Name="Counts" TagType="Base" DataType="DINT" Dimensions="4">
        <Comments>
          <Comment Operand="[0]"><![CDATA[Shift A count]]></Comment>
          <Comment Operand="[2]"><![CDATA[Shift C count]]></Comment>
        </Comments>
      </Tag>
      <Tag Name="Plain" TagType="Base" DataType="BOOL"/>
    </Tags>
  </Controller>
</RSLogix5000Content>`;

describe("importL5X — per-operand tag comments", () => {
  const tagsOf = (xml: string) => {
    const controller = importL5X(xml).project.controllers[0]!;
    return (name: string) => controller.controllerTags.find((t) => t.name === name)!;
  };

  it("imports per-element and per-member comments keyed by operand", () => {
    const tag = tagsOf(XML);
    expect(tag("Motor").comments).toEqual([
      { operand: ".Speed", text: "Commanded speed (RPM)" },
      { operand: ".Running", text: "Motor running feedback" },
    ]);
    expect(tag("Counts").comments).toEqual([
      { operand: "[0]", text: "Shift A count" },
      { operand: "[2]", text: "Shift C count" },
    ]);
    expect(tag("Plain").comments).toBeUndefined();
  });

  it("round-trips operand comments through export -> import", () => {
    const { xml } = exportL5X(importL5X(XML).project);
    const tag = tagsOf(xml);
    expect(tag("Motor").comments).toEqual([
      { operand: ".Speed", text: "Commanded speed (RPM)" },
      { operand: ".Running", text: "Motor running feedback" },
    ]);
    expect(tag("Counts").comments).toEqual([
      { operand: "[0]", text: "Shift A count" },
      { operand: "[2]", text: "Shift C count" },
    ]);
  });
});
