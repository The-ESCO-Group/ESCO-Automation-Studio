import { describe, expect, it } from "vitest";
import { exportL5X } from "./exportL5X";
import { importL5X } from "./index";

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0" TargetName="WatchCtl" ContentType="Controller">
  <Controller Use="Target" Name="WatchCtl" ProcessorType="1756-L85E">
    <QuickWatchLists>
      <QuickWatchList Name="Startup Watch">
        <Description><![CDATA[Startup checkout tags]]></Description>
        <WatchTag Specifier="StartPB" Scope="" Radix="Decimal"/>
        <WatchTag Specifier="LocalSpeed" Scope="PumpProgram"/>
        <WatchTag Specifier="PumpAOI.Status" Scope="PumpProgram"/>
      </QuickWatchList>
    </QuickWatchLists>
    <Tags>
      <Tag Name="StartPB" TagType="Base" DataType="BOOL"/>
    </Tags>
    <Programs>
      <Program Name="PumpProgram">
        <Tags>
          <Tag Name="LocalSpeed" TagType="Base" DataType="DINT"/>
          <Tag Name="PumpAOI" TagType="Base" DataType="PumpControl"/>
        </Tags>
        <Routines/>
      </Program>
    </Programs>
    <Tasks/>
  </Controller>
</RSLogix5000Content>`;

describe("importL5X/exportL5X - controller quick watch lists", () => {
  it("imports quick watch list names, watch tag specifiers, scopes, and attributes", () => {
    const controller = importL5X(XML).project.controllers[0]!;
    const list = controller.quickWatchLists?.[0]!;

    expect(list.name).toBe("Startup Watch");
    expect(list.description).toBe("Startup checkout tags");
    expect(list.tags).toHaveLength(3);
    expect(list.tags[0]).toMatchObject({
      specifier: "StartPB",
      attributes: { Radix: "Decimal" },
    });
    expect(list.tags[0]?.scope).toBeUndefined();
    expect(list.tags[1]).toMatchObject({ specifier: "LocalSpeed", scope: "PumpProgram" });
    expect(list.tags[2]).toMatchObject({ specifier: "PumpAOI.Status", scope: "PumpProgram" });
  });

  it("round-trips quick watch lists through review-only L5X export", () => {
    const { project: p1 } = importL5X(XML);
    const { xml, warnings } = exportL5X(p1);

    expect(xml).toContain("<QuickWatchLists>");
    expect(xml).toContain('<QuickWatchList Name="Startup Watch">');
    expect(xml).toContain('Specifier="StartPB"');
    expect(xml).toContain('Scope="PumpProgram"');
    expect(xml).toContain('Radix="Decimal"');
    expect(warnings.some((warning) => warning.includes("Startup Watch") && warning.includes("offline review"))).toBe(true);

    const list = importL5X(xml).project.controllers[0]!.quickWatchLists?.[0]!;
    expect(list.tags.map((tag) => tag.specifier)).toEqual(["StartPB", "LocalSpeed", "PumpAOI.Status"]);
    expect(list.tags[1]?.scope).toBe("PumpProgram");
    expect(list.tags[0]?.attributes?.Radix).toBe("Decimal");
  });
});
