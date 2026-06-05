import { describe, expect, it } from "vitest";
import { exportL5X } from "./exportL5X";
import { importL5X } from "./index";

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0" TargetName="SerialCtl" ContentType="Controller">
  <Controller Use="Target" Name="SerialCtl" ProcessorType="1756-L63">
    <Tags/>
    <Programs/>
    <Tasks/>
    <CommPorts>
      <SerialPort Channel="0" BaudRate="19200" Parity="No Parity" DataBits="8 Bits of Data" StopBits="1 Stop Bit" ComDriverId="DF1" ControlLine="No Handshake" RTSOffDelay="0" RTSSendDelay="0">
        <ASCII AppendCharacter1="13" AppendCharacter2="10" DeleteMode="Ignored"/>
        <DF1 DuplicateDetection="-1" ErrorDetection="BCC Error" DF1Mode="Pt to Pt" ACKTimeout="50" StationAddress="0"/>
      </SerialPort>
    </CommPorts>
  </Controller>
</RSLogix5000Content>`;

describe("importL5X/exportL5X - controller communication ports", () => {
  it("imports SerialPort settings and child protocol attributes", () => {
    const controller = importL5X(XML).project.controllers[0]!;
    const commPorts = controller.commPorts!;

    expect(commPorts.serialPorts).toHaveLength(1);
    expect(commPorts.serialPorts[0]?.attributes).toMatchObject({
      Channel: "0",
      BaudRate: "19200",
      Parity: "No Parity",
      DataBits: "8 Bits of Data",
      StopBits: "1 Stop Bit",
      ComDriverId: "DF1",
      ControlLine: "No Handshake",
    });
    expect(commPorts.serialPorts[0]?.protocols.map((protocol) => protocol.elementName)).toEqual(["ASCII", "DF1"]);
    expect(commPorts.serialPorts[0]?.protocols[0]?.attributes).toMatchObject({
      AppendCharacter1: "13",
      AppendCharacter2: "10",
    });
    expect(commPorts.serialPorts[0]?.protocols[1]?.attributes).toMatchObject({
      ErrorDetection: "BCC Error",
      StationAddress: "0",
    });
  });

  it("round-trips controller CommPorts through review-only L5X export", () => {
    const { project: p1 } = importL5X(XML);
    const { xml, warnings } = exportL5X(p1);

    expect(xml).toContain("<CommPorts>");
    expect(xml).toContain("<SerialPort");
    expect(xml).toContain('BaudRate="19200"');
    expect(xml).toContain("<ASCII");
    expect(xml).toContain('AppendCharacter1="13"');
    expect(xml).toContain("<DF1");
    expect(xml).toContain('ACKTimeout="50"');
    expect(warnings.some((warning) => warning.includes("serial communication") && warning.includes("offline review"))).toBe(true);

    const commPorts = importL5X(xml).project.controllers[0]!.commPorts!;
    expect(commPorts.serialPorts[0]?.attributes.RTSSendDelay).toBe("0");
    expect(commPorts.serialPorts[0]?.protocols.map((protocol) => protocol.elementName)).toEqual(["ASCII", "DF1"]);
    expect(commPorts.serialPorts[0]?.protocols[1]?.attributes.DF1Mode).toBe("Pt to Pt");
  });
});
