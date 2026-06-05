import { describe, expect, it } from "vitest";
import { exportL5X } from "./exportL5X";
import { importL5X } from "./index";

interface ProfileChannel {
  id?: string;
  label?: string;
  direction?: string;
  signal?: string;
  enabled?: boolean;
  dataFormat?: string;
  range?: string;
  diagnostic?: string;
}

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0">
  <Controller Use="Target" Name="ProfileCtl" ProcessorType="1756-L85E">
    <Modules>
      <Module Name="AI_01" CatalogNumber="1756-IF8" Slot="3" ParentModule="Local" ParentModPortId="1">
        <ProfileChannels>
          <ProfileChannel Id="Ch0" Label="Channel 0" Direction="Input" Signal="4-20 mA" Enabled="true" DataFormat="Float" Range="4-20 mA" Diagnostic="Open-wire detection"/>
          <Channel Name="Ch1" Label="Channel 1" Direction="Input" SignalType="RTD" Enabled="false" Format="Engineering Units" Mode="RTD" Diagnostic="Disabled spare"/>
        </ProfileChannels>
      </Module>
    </Modules>
  </Controller>
</RSLogix5000Content>`;

function profileChannelsOf(xml: string): ProfileChannel[] {
  const module = importL5X(xml).project.controllers[0]!.ioConfiguration.modules[0]!;
  return ((module as typeof module & { profileChannels?: ProfileChannel[] }).profileChannels ?? []);
}

describe("importL5X/exportL5X - module profile channel metadata", () => {
  it("imports module profile channel descriptors including disabled channels", () => {
    expect(profileChannelsOf(XML)).toEqual([
      {
        id: "Ch0",
        label: "Channel 0",
        direction: "Input",
        signal: "4-20 mA",
        enabled: true,
        dataFormat: "Float",
        range: "4-20 mA",
        diagnostic: "Open-wire detection",
      },
      {
        id: "Ch1",
        label: "Channel 1",
        direction: "Input",
        signal: "RTD",
        enabled: false,
        dataFormat: "Engineering Units",
        range: "RTD",
        diagnostic: "Disabled spare",
      },
    ]);
  });

  it("round-trips profile channel labels, formats, ranges, and disabled state through export", () => {
    const { xml } = exportL5X(importL5X(XML).project);

    expect(xml).toContain("<ProfileChannels>");
    expect(xml).toContain('Id="Ch0"');
    expect(xml).toContain('Enabled="false"');
    expect(xml).toContain('Range="RTD"');

    expect(profileChannelsOf(xml)).toEqual([
      {
        id: "Ch0",
        label: "Channel 0",
        direction: "Input",
        signal: "4-20 mA",
        enabled: true,
        dataFormat: "Float",
        range: "4-20 mA",
        diagnostic: "Open-wire detection",
      },
      {
        id: "Ch1",
        label: "Channel 1",
        direction: "Input",
        signal: "RTD",
        enabled: false,
        dataFormat: "Engineering Units",
        range: "RTD",
        diagnostic: "Disabled spare",
      },
    ]);
  });
});
