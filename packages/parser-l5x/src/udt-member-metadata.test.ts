import { describe, expect, it } from "vitest";
import { exportL5X } from "./exportL5X";
import { importL5X } from "./index";

/**
 * Round-trip coverage for UDT member `ExternalAccess`.
 *
 * UDT members carry an `ExternalAccess` permission in the L5X (just like tags),
 * but the member extraction path only preserved `Radix`/`Description`, dropping
 * external access on the way through. This locks in that the member access
 * survives import -> export -> import, mirroring the tag-level guarantee.
 */
describe("importL5X — UDT member external access", () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0">
  <Controller Use="Target" Name="UdtAccessCtl" ProcessorType="1756-L85E">
    <DataTypes>
      <DataType Name="MotorData">
        <Members>
          <Member Name="Speed" DataType="REAL" Radix="Float" ExternalAccess="Read/Write"/>
          <Member Name="Status" DataType="DINT" ExternalAccess="Read Only"/>
          <Member Name="Internal" DataType="DINT" ExternalAccess="None"/>
          <Member Name="Plain" DataType="BOOL"/>
        </Members>
      </DataType>
    </DataTypes>
  </Controller>
</RSLogix5000Content>`;

  it("imports normalized member external-access values", () => {
    const udt = importL5X(xml).project.controllers[0]!.dataTypes[0]!;
    const member = (name: string) => udt.members.find((m) => m.name === name)!;
    expect(member("Speed").externalAccess).toBe("read-write");
    expect(member("Status").externalAccess).toBe("read-only");
    expect(member("Internal").externalAccess).toBe("none");
    expect(member("Plain").externalAccess).toBeUndefined();
  });

  it("preserves member external access through export -> import", () => {
    const { project: p1 } = importL5X(xml);
    const { xml: exported } = exportL5X(p1);
    expect(exported).toContain('ExternalAccess="Read/Write"');
    expect(exported).toContain('ExternalAccess="Read Only"');
    expect(exported).toContain('ExternalAccess="None"');

    const { project: p2 } = importL5X(exported);
    const udt = p2.controllers[0]!.dataTypes[0]!;
    const member = (name: string) => udt.members.find((m) => m.name === name)!;
    expect(member("Speed").externalAccess).toBe("read-write");
    expect(member("Status").externalAccess).toBe("read-only");
    expect(member("Internal").externalAccess).toBe("none");
    expect(member("Plain").externalAccess).toBeUndefined();
  });
});

/**
 * Round-trip coverage for UDT member bit-overlay layout (`Hidden`, `Target`,
 * `BitNumber`).
 *
 * Logix packs BOOL members as bit fields on a hidden host integer member: the
 * host carries `Hidden="true"` and each BOOL carries `Target` (the host name)
 * plus `BitNumber` (its bit). The member extraction path dropped this layout
 * metadata, so the exact packing was lost on export. This locks in that the
 * hidden host flag and bit packing survive import -> export -> import.
 */
describe("importL5X — UDT member bit-overlay layout", () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0">
  <Controller Use="Target" Name="UdtBitCtl" ProcessorType="1756-L85E">
    <DataTypes>
      <DataType Name="FlagData">
        <Members>
          <Member Name="ZZZZZZZZZZFlagData0" DataType="SINT" Dimension="0" Radix="Decimal" Hidden="true"/>
          <Member Name="Run" DataType="BOOL" Radix="Decimal" Hidden="false" Target="ZZZZZZZZZZFlagData0" BitNumber="0"/>
          <Member Name="Stop" DataType="BOOL" Radix="Decimal" Hidden="false" Target="ZZZZZZZZZZFlagData0" BitNumber="1"/>
          <Member Name="Count" DataType="DINT"/>
        </Members>
      </DataType>
    </DataTypes>
  </Controller>
</RSLogix5000Content>`;

  it("imports hidden host flag, target, and bit number", () => {
    const udt = importL5X(xml).project.controllers[0]!.dataTypes[0]!;
    const member = (name: string) => udt.members.find((m) => m.name === name)!;

    expect(member("ZZZZZZZZZZFlagData0").hidden).toBe(true);
    expect(member("ZZZZZZZZZZFlagData0").target).toBeUndefined();

    expect(member("Run").hidden).toBeUndefined();
    expect(member("Run").target).toBe("ZZZZZZZZZZFlagData0");
    expect(member("Run").bitNumber).toBe(0);

    expect(member("Stop").target).toBe("ZZZZZZZZZZFlagData0");
    expect(member("Stop").bitNumber).toBe(1);

    expect(member("Count").hidden).toBeUndefined();
    expect(member("Count").target).toBeUndefined();
    expect(member("Count").bitNumber).toBeUndefined();
  });

  it("preserves bit-overlay layout through export -> import", () => {
    const { project: p1 } = importL5X(xml);
    const { xml: exported } = exportL5X(p1);
    expect(exported).toContain('Hidden="true"');
    expect(exported).toContain('Target="ZZZZZZZZZZFlagData0"');
    expect(exported).toContain('BitNumber="0"');
    expect(exported).toContain('BitNumber="1"');

    const udt = importL5X(exported).project.controllers[0]!.dataTypes[0]!;
    const member = (name: string) => udt.members.find((m) => m.name === name)!;
    expect(member("ZZZZZZZZZZFlagData0").hidden).toBe(true);
    expect(member("Run").target).toBe("ZZZZZZZZZZFlagData0");
    expect(member("Run").bitNumber).toBe(0);
    expect(member("Stop").bitNumber).toBe(1);
    expect(member("Count").bitNumber).toBeUndefined();
  });
});
