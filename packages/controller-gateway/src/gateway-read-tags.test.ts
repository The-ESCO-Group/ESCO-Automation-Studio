import { describe, expect, it } from "vitest";
import { SimulatorGatewayDriver } from "./drivers";
import { ControllerGateway } from "./gateway";

function simulatorGateway(): ControllerGateway {
  return new ControllerGateway([
    new SimulatorGatewayDriver({
      identity: { controllerName: "SIM", controllerType: "ESCO Virtual", vendor: "ESCO" },
      tags: [
        { name: "Count", dataType: "DINT", value: 7 },
        { name: "Running", dataType: "BOOL", value: true },
      ],
    }),
  ]);
}

describe("ControllerGateway.readTags", () => {
  it("reads a batch through the active driver and audits once", async () => {
    const gateway = simulatorGateway();
    await gateway.connect("esco-simulator");
    const result = await gateway.readTags(["Count", "Running"]);
    expect(result.values.map((value) => value.tagName)).toEqual(["Count", "Running"]);
    expect(result.errors).toEqual({});
    const batchEntries = gateway.auditLog.filter((entry) => entry.action === "read-tags");
    expect(batchEntries).toHaveLength(1);
    expect(batchEntries[0].result).toBe("ran");
    expect(batchEntries[0].message).toContain("2/2");
    expect(batchEntries[0].details).toMatchObject({
      requestedCount: 2,
      valueCount: 2,
      errorCount: 0,
    });
  });

  it("reports per-tag failures without failing the batch", async () => {
    const gateway = simulatorGateway();
    await gateway.connect("esco-simulator");
    const result = await gateway.readTags(["Count", "Missing"]);
    expect(result.values).toHaveLength(1);
    expect(result.errors["Missing"]).toContain("Unknown simulator tag");
    const entry = gateway.auditLog.find((candidate) => candidate.action === "read-tags");
    expect(entry?.result).toBe("ran"); // partial success is still a run
    expect(entry?.message).toContain("1/2");
    expect(entry?.message).toContain("1 failed");
    expect(entry?.details).toMatchObject({ requestedCount: 2, valueCount: 1, errorCount: 1 });
  });

  it("records a failed batch when every tag errors", async () => {
    const gateway = simulatorGateway();
    await gateway.connect("esco-simulator");
    const result = await gateway.readTags(["Nope1", "Nope2"]);
    expect(result.values).toHaveLength(0);
    expect(Object.keys(result.errors)).toHaveLength(2);
    const entry = gateway.auditLog.find((candidate) => candidate.action === "read-tags");
    expect(entry?.result).toBe("failed");
    expect(entry?.details).toMatchObject({ requestedCount: 2, valueCount: 0, errorCount: 2 });
  });

  it("prefers a driver-level batch implementation when present", async () => {
    let batchCalls = 0;
    let singleCalls = 0;
    const driver = {
      id: "batching",
      name: "Batching Stub",
      kind: "ethernetip" as const,
      connect: async () => ({ ok: true, state: "online-readonly" as const, message: "ok" }),
      disconnect: async () => {},
      getIdentity: async () => ({}),
      getStatus: async () => ({
        state: "online-readonly" as const,
        connected: true,
        health: "ok" as const,
        message: "ok",
        updatedAt: "t",
      }),
      getFaults: async () => [],
      readTag: async (tagName: string) => {
        singleCalls += 1;
        return {
          tagName,
          value: 0,
          quality: "good" as const,
          timestamp: "t",
          sourceDriver: "ethernetip" as const,
        };
      },
      readTags: async (tagNames: string[]) => {
        batchCalls += 1;
        return {
          values: tagNames.map((tagName) => ({
            tagName,
            value: 1,
            quality: "good" as const,
            timestamp: "t",
            sourceDriver: "ethernetip" as const,
          })),
          errors: {},
        };
      },
    };
    const gateway = new ControllerGateway([driver]);
    await gateway.connect("batching");
    const result = await gateway.readTags(["A", "B", "C"]);
    expect(result.values).toHaveLength(3);
    expect(batchCalls).toBe(1);
    expect(singleCalls).toBe(0); // never fell back to per-tag reads
  });

  it("requires a selected driver and an online session", async () => {
    const gateway = simulatorGateway();
    await expect(gateway.readTags(["Count"])).rejects.toThrow(/No controller driver is selected/);

    await gateway.connect("esco-simulator");
    await gateway.disconnect();
    await expect(gateway.readTags(["Count"])).rejects.toThrow(/not online/);
  });
});
