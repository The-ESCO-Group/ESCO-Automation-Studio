import { describe, expect, it } from "vitest";
import { exportL5X } from "./exportL5X";
import { importL5X } from "./index";

/**
 * Round-trip coverage for the DataType `Family` attribute.
 *
 * Logix marks custom string types with `Family="StringFamily"` (ordinary
 * structures carry `"NoFamily"`). The DataType extraction path preserved the
 * name, description, and members but dropped `Family`, so a custom STRING type
 * collapsed to a plain structure on the way through export -> import. This locks
 * in that the family survives, mirroring the verbatim-metadata guarantee already
 * in place for member radix / external access.
 */
describe("importL5X — DataType family", () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0">
  <Controller Use="Target" Name="FamilyCtl" ProcessorType="1756-L85E">
    <DataTypes>
      <DataType Name="PartNumber" Family="StringFamily">
        <Members>
          <Member Name="LEN" DataType="DINT" Radix="Decimal"/>
          <Member Name="DATA" DataType="SINT" Dimension="20" Radix="ASCII"/>
        </Members>
      </DataType>
      <DataType Name="MotorData" Family="NoFamily">
        <Members>
          <Member Name="Speed" DataType="REAL"/>
        </Members>
      </DataType>
      <DataType Name="Legacy">
        <Members>
          <Member Name="Flag" DataType="BOOL"/>
        </Members>
      </DataType>
    </DataTypes>
  </Controller>
</RSLogix5000Content>`;

  it("imports the data-type family verbatim", () => {
    const types = importL5X(xml).project.controllers[0]!.dataTypes;
    const byName = (name: string) => types.find((t) => t.name === name)!;
    expect(byName("PartNumber").family).toBe("StringFamily");
    expect(byName("MotorData").family).toBe("NoFamily");
    // Absent Family stays undefined rather than being invented.
    expect(byName("Legacy").family).toBeUndefined();
  });

  it("preserves the data-type family through export -> import", () => {
    const { project: p1 } = importL5X(xml);
    const { xml: exported } = exportL5X(p1);
    expect(exported).toContain('<DataType Name="PartNumber" Family="StringFamily">');
    // A type with no family is emitted without a Family attribute.
    expect(exported).toContain('<DataType Name="Legacy">');

    const { project: p2 } = importL5X(exported);
    const byName = (name: string) => p2.controllers[0]!.dataTypes.find((t) => t.name === name)!;
    expect(byName("PartNumber").family).toBe("StringFamily");
    expect(byName("MotorData").family).toBe("NoFamily");
    expect(byName("Legacy").family).toBeUndefined();
  });
});
