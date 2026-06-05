import { describe, expect, it } from "vitest";
import { exportL5X } from "./exportL5X";
import { importL5X } from "./index";

// A controller <CommPorts><SerialPort> can carry a <Description> child, like
// every other configurable element in an L5X (controller / program / routine /
// tag / module). The simulator never opens a serial port, but the description
// is engineer-authored documentation, so it must survive export -> import
// rather than being silently dropped when the port is re-emitted. The opaque
// SerialPort attribute map does not capture children, so the description is
// preserved separately (mirrors module / UDT descriptions).
const XML = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0" TargetName="SerialCtl" ContentType="Controller">
  <Controller Use="Target" Name="SerialCtl" ProcessorType="1756-L63">
    <Tags/>
    <Programs/>
    <Tasks/>
    <CommPorts>
      <SerialPort Channel="0" BaudRate="19200" Parity="No Parity" DataBits="8 Bits of Data" StopBits="1 Stop Bit">
        <Description>Weigh-scale DF1 link, do not repurpose</Description>
        <DF1 DF1Mode="Pt to Pt" StationAddress="0"/>
      </SerialPort>
    </CommPorts>
  </Controller>
</RSLogix5000Content>`;

describe("importL5X/exportL5X — controller serial port description", () => {
  const serialPortOf = (xml: string) =>
    importL5X(xml).project.controllers[0]!.commPorts!.serialPorts[0]!;

  it("imports the SerialPort <Description> child verbatim", () => {
    const serialPort = serialPortOf(XML);
    expect(serialPort.description).toBe("Weigh-scale DF1 link, do not repurpose");
    // The description is a child element, so it must not leak into the opaque
    // attribute map alongside BaudRate / Parity / etc.
    expect(serialPort.attributes.Description).toBeUndefined();
    expect(serialPort.protocols.map((protocol) => protocol.elementName)).toEqual(["DF1"]);
  });

  it("round-trips the serial port description through export -> import", () => {
    const { xml } = exportL5X(importL5X(XML).project);
    expect(serialPortOf(xml).description).toBe("Weigh-scale DF1 link, do not repurpose");
  });

  it("leaves description undefined when the serial port omits it", () => {
    const bare = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0" TargetName="BareCtl" ContentType="Controller">
  <Controller Use="Target" Name="BareCtl" ProcessorType="1756-L63">
    <CommPorts>
      <SerialPort Channel="0" BaudRate="19200"/>
    </CommPorts>
  </Controller>
</RSLogix5000Content>`;
    expect(serialPortOf(bare).description).toBeUndefined();
  });
});
