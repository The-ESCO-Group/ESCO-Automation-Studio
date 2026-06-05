import { describe, expect, it } from "vitest";
import { exportL5X } from "./exportL5X";
import { importL5X } from "./index";

// Safety controllers partition tags into Safety / Standard via the `Class`
// attribute. It is display/organisational metadata (never used here to drive a
// safety task), but it must survive export -> import so the partition is not
// silently lost when an engineer round-trips a safety project.
const XML = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0">
  <Controller Use="Target" Name="SafetyCtl" ProcessorType="1756-L8SP" MajorRev="33" MinorRev="11">
    <Tags>
      <Tag Name="SafetyEStop" TagType="Base" DataType="BOOL" Class="Safety"/>
      <Tag Name="StdMotorRun" TagType="Base" DataType="BOOL" Class="Standard"/>
      <Tag Name="PlainTag" TagType="Base" DataType="DINT"/>
    </Tags>
  </Controller>
</RSLogix5000Content>`;

describe("importL5X — tag safety class", () => {
  const tagsOf = (xml: string) => {
    const controller = importL5X(xml).project.controllers[0]!;
    const byName = (name: string) => controller.controllerTags.find((t) => t.name === name)!;
    return byName;
  };

  it("imports the Class attribute as safetyClass", () => {
    const tag = tagsOf(XML);
    expect(tag("SafetyEStop").safetyClass).toBe("Safety");
    expect(tag("StdMotorRun").safetyClass).toBe("Standard");
    expect(tag("PlainTag").safetyClass).toBeUndefined();
  });

  it("round-trips the safety partition through export -> import", () => {
    const { xml } = exportL5X(importL5X(XML).project);
    const tag = tagsOf(xml);
    expect(tag("SafetyEStop").safetyClass).toBe("Safety");
    expect(tag("StdMotorRun").safetyClass).toBe("Standard");
    expect(tag("PlainTag").safetyClass).toBeUndefined();
  });
});
