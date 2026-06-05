import { describe, expect, it } from "vitest";
import {
  IO_DEVICE_CATALOG,
  findIoDeviceCatalogEntry,
  ioDeviceChannelProfiles,
  ioDeviceFamilyImageKey,
  ioDeviceKeyingLabel,
  ioDeviceProfileDiagnostics,
  ioDeviceSetupTags,
} from "./io-device-catalog";

describe("findIoDeviceCatalogEntry", () => {
  it("matches imported 5094 module catalog numbers with Studio series suffixes", () => {
    const flexHart = findIoDeviceCatalogEntry({ catalogNumber: "5094-IF8IH/A" });
    expect(flexHart?.catalogNumber).toBe("5094-IF8IH");
    expect(ioDeviceChannelProfiles(flexHart)).toHaveLength(8);

    const flexUniversal = findIoDeviceCatalogEntry({ catalogNumber: "5094-IY8/B" });
    expect(flexUniversal?.catalogNumber).toBe("5094-IY8");
  });

  it("matches branded AC-drive imported names to drive catalog profiles", () => {
    const driveFamily = ["Power", "Flex"].join("");
    expect(findIoDeviceCatalogEntry({ catalogNumber: `${driveFamily} 755-EENET` })?.catalogNumber).toBe("PF755");
    expect(findIoDeviceCatalogEntry({ catalogNumber: `${driveFamily} 525-EENET` })?.catalogNumber).toBe("PF525");
  });

  it("matches process-controller suffixes to the base ControlLogix controller profile", () => {
    expect(findIoDeviceCatalogEntry({ catalogNumber: "1756-L85EP" })?.catalogNumber).toBe("1756-L85E");
  });
});

describe("ioDeviceSetupTags", () => {
  it("turns meter default points into typed offline setup tags", () => {
    const meter = IO_DEVICE_CATALOG.find((entry) => entry.label === "Magnetic Flow Meter");
    const tags = ioDeviceSetupTags(meter, {
      moduleName: "FIT_101",
      existingNames: ["FIT_101_Fault"],
    });

    expect(tags.map((tag) => [tag.name, tag.dataType, tag.externalAccess])).toEqual([
      ["FIT_101_Flow_Raw", "DINT", "read-only"],
      ["FIT_101_Flow_Scaled", "REAL", "read-only"],
      ["FIT_101_Totalizer", "REAL", "read-only"],
      ["FIT_101_Fault_02", "BOOL", "read-only"],
      ["FIT_101_Status", "DINT", "read-only"],
    ]);
    expect(tags.every((tag) => tag.description?.includes("No controller connection is created."))).toBe(true);
  });

  it("derives channel setup tags for profile-based I/O modules", () => {
    const hart = findIoDeviceCatalogEntry({ catalogNumber: "1756-IF8H" });
    const channels = ioDeviceChannelProfiles(hart);
    const tags = ioDeviceSetupTags(hart, { moduleName: "Profile_AI_02", channels });

    expect(tags).toHaveLength(10);
    expect(tags[0]).toMatchObject({
      name: "Profile_AI_02_Ch0",
      dataType: "REAL",
      externalAccess: "read-only",
    });
    expect(tags.at(-2)?.name).toBe("Profile_AI_02_Status");
    expect(tags.at(-1)?.name).toBe("Profile_AI_02_Fault");
  });
});

describe("I/O device catalog persisted tokens", () => {
  it("keeps common module family image keys available in the offline catalog", () => {
    const imageKeys = new Set(IO_DEVICE_CATALOG.map((entry) => entry.imageKey));

    expect(Array.from(imageKeys)).toEqual(
      expect.arrayContaining([
        "controller",
        "chassis",
        "remote_io",
        "communication",
        "digital_input",
        "digital_output",
        "analog_input",
        "analog_output",
        "drive",
        "meter",
        "safety",
        "generic",
      ]),
    );
  });

  it("infers common family images from imported/offline module metadata", () => {
    expect(ioDeviceFamilyImageKey({ catalogNumber: "1756-L83E", productType: "Controller Processor" })).toBe("controller");
    expect(ioDeviceFamilyImageKey({ catalogNumber: "1756-A10", productType: "Chassis / Backplane" })).toBe("chassis");
    expect(ioDeviceFamilyImageKey({ catalogNumber: "1734-AENTR", productType: "EtherNet/IP Adapter" })).toBe("remote_io");
    expect(ioDeviceFamilyImageKey({ catalogNumber: "1756-EN2T", productType: "EtherNet/IP Communication Module" })).toBe("communication");
    expect(ioDeviceFamilyImageKey({ catalogNumber: "1756-IB16", productType: "Digital Input Module", dataDirection: "Input" })).toBe("digital_input");
    expect(ioDeviceFamilyImageKey({ catalogNumber: "1756-OB16", productType: "Digital Output Module", dataDirection: "Output" })).toBe("digital_output");
    expect(ioDeviceFamilyImageKey({ catalogNumber: "1756-IF8H", productType: "Analog Input Module", dataDirection: "Input" })).toBe("analog_input");
    expect(ioDeviceFamilyImageKey({ catalogNumber: "1756-OF8", productType: "Analog Output Module", dataDirection: "Output" })).toBe("analog_output");
    expect(ioDeviceFamilyImageKey({ catalogNumber: "PF755", productType: "AC Drive" })).toBe("drive");
    expect(ioDeviceFamilyImageKey({ productType: "Magnetic Flow Meter" })).toBe("meter");
    expect(ioDeviceFamilyImageKey({ catalogNumber: "1756-IB16S", productType: "Safety Input Module" })).toBe("safety");
    expect(ioDeviceFamilyImageKey({ productType: "Vendor-defined Device Profile", setupMethod: "Third-party profile" })).toBe("generic");
  });

  it("authors canonical electronic keying values and labels legacy disabled keying", () => {
    const keyingValues = new Set(IO_DEVICE_CATALOG.map((entry) => entry.electronicKeying));

    expect(keyingValues.has("DisableKeying")).toBe(false);
    expect(Array.from(keyingValues).every((value) => ["ExactMatch", "CompatibleModule", "Disabled"].includes(value))).toBe(true);
    expect(ioDeviceKeyingLabel("Disabled")).toBe("Disable Keying");
    expect(ioDeviceKeyingLabel("DisableKeying")).toBe("Disable Keying");
  });

  it("authors validator-compatible catalog connection tokens", () => {
    const connections = IO_DEVICE_CATALOG.flatMap((entry) => (entry.connection ? [entry.connection] : []));

    expect(connections.length).toBeGreaterThan(0);
    expect(
      connections.every(
        (connection) =>
          !connection.inputConnectionType || ["Multicast", "Unicast"].includes(connection.inputConnectionType),
      ),
    ).toBe(true);
    expect(
      connections.every(
        (connection) =>
          !connection.inputProductionTrigger || ["Cyclic", "COS", "Application"].includes(connection.inputProductionTrigger),
      ),
    ).toBe(true);
  });

  it("treats disabled keying as offline review metadata, including legacy token spelling", () => {
    const generic = IO_DEVICE_CATALOG.find((entry) => entry.electronicKeying === "Disabled");

    expect(generic).toBeTruthy();
    expect(ioDeviceProfileDiagnostics(generic, { electronicKeying: "Disabled" }).some((row) => row.label === "Electronic keying disabled")).toBe(true);
    expect(ioDeviceProfileDiagnostics(generic, { electronicKeying: "DisableKeying" }).some((row) => row.label === "Electronic keying disabled")).toBe(true);
  });
});
