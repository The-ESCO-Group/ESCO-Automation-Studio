import { describe, expect, it } from "vitest";
import { exportL5X } from "./exportL5X";
import { importL5X } from "./index";

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0" TargetName="EthernetCtl" ContentType="Controller">
  <Controller Use="Target" Name="EthernetCtl" ProcessorType="1756-L85E">
    <Tags/>
    <Programs/>
    <Tasks/>
    <InternetProtocol ConfigType="Manual" IPAddress="192.168.1.10" SubnetMask="255.255.255.0" Gateway="192.168.1.1" PrimaryDNS="8.8.8.8" SecondaryDNS="1.1.1.1" DomainName="esco.local" HostName="line1"/>
    <EthernetPorts>
      <EthernetPort Port="1" PortEnabled="Enabled" AutoNegotiateEnabled="Enabled" InterfaceSpeed="100" DuplexMode="Full"/>
      <EthernetPort Port="2" PortEnabled="Disabled" AutoNegotiateEnabled="Disabled" InterfaceSpeed="10" DuplexMode="Half"/>
    </EthernetPorts>
    <EthernetNetwork SupervisorModeEnabled="Enabled" SupervisorPrecedence="100" BeaconInterval="400" BeaconTimeout="1960" VLANID="10"/>
  </Controller>
</RSLogix5000Content>`;

describe("importL5X/exportL5X - controller EtherNet/IP configuration", () => {
  it("imports InternetProtocol, EthernetPorts, and EthernetNetwork attributes", () => {
    const controller = importL5X(XML).project.controllers[0]!;
    const ethernet = controller.ethernetConfig!;

    expect(ethernet.internetProtocol?.attributes).toMatchObject({
      ConfigType: "Manual",
      IPAddress: "192.168.1.10",
      SubnetMask: "255.255.255.0",
      HostName: "line1",
    });
    expect(ethernet.ports).toHaveLength(2);
    expect(ethernet.ports[0]?.attributes).toMatchObject({
      Port: "1",
      PortEnabled: "Enabled",
      InterfaceSpeed: "100",
      DuplexMode: "Full",
    });
    expect(ethernet.network?.attributes).toMatchObject({
      SupervisorModeEnabled: "Enabled",
      SupervisorPrecedence: "100",
      VLANID: "10",
    });
  });

  it("round-trips controller EtherNet/IP configuration through review-only L5X export", () => {
    const { project: p1 } = importL5X(XML);
    const { xml, warnings } = exportL5X(p1);

    expect(xml).toContain("<InternetProtocol");
    expect(xml).toContain('IPAddress="192.168.1.10"');
    expect(xml).toContain("<EthernetPorts>");
    expect(xml).toContain('<EthernetPort Port="1"');
    expect(xml).toContain("<EthernetNetwork");
    expect(xml).toContain('VLANID="10"');
    expect(warnings.some((warning) => warning.includes("EtherNet/IP") && warning.includes("offline review"))).toBe(true);

    const ethernet = importL5X(xml).project.controllers[0]!.ethernetConfig!;
    expect(ethernet.internetProtocol?.attributes.Gateway).toBe("192.168.1.1");
    expect(ethernet.ports.map((port) => port.attributes.Port)).toEqual(["1", "2"]);
    expect(ethernet.network?.attributes.BeaconTimeout).toBe("1960");
  });
});
