import { describe, expect, it } from "vitest";
import type {
  ControllerConnectionEvidence,
  ControllerDriverCapabilities,
  ControllerDriverSummary,
  TagQuality,
  TagValue,
} from "../../gateway-contract";
import { describeWatchState, normalizeDriverSummary } from "./EscoOnlinePanel";

function value(quality: TagQuality): TagValue {
  return {
    tagName: "Count",
    value: 1,
    dataType: "DINT",
    quality,
    timestamp: "t",
    sourceDriver: "simulator",
  };
}

const evidence: ControllerConnectionEvidence = {
  transportValidation: "software-wired",
  realControllerIo: true,
  hardwareValidated: false,
  verified: false,
  label: "Software-wired, not field-validated",
  message: "Software route only.",
  limitations: ["No hardware validation."],
};

const fullReadOnlyCapabilities: ControllerDriverCapabilities = {
  canConnect: true,
  canReadStatus: true,
  canReadFaults: true,
  canBrowseTags: true,
  canReadTags: true,
  canBatchReadTags: true,
  canSubscribeTags: true,
  canUploadSnapshot: false,
  canCompareProject: true,
  canWriteTags: false,
  canDownloadProject: false,
  canOnlineEdit: false,
  canForceTags: false,
  canModeChange: false,
  canClearFaults: false,
};

describe("describeWatchState", () => {
  it("does not label bad or uncertain samples as live", () => {
    const polling = { names: ["Count"], intervalMs: 2000 };

    expect(describeWatchState("Count", value("bad"), undefined, undefined, polling, undefined)).toEqual({
      label: "bad quality",
      tone: "bad",
    });
    expect(describeWatchState("Count", value("uncertain"), undefined, undefined, polling, undefined)).toEqual({
      label: "uncertain quality",
      tone: "stale",
    });
  });

  it("labels good actively watched samples as live", () => {
    expect(
      describeWatchState("Count", value("good"), undefined, undefined, { names: ["Count"], intervalMs: 2000 }, undefined),
    ).toEqual({ label: "live", tone: "live" });
  });
});

describe("normalizeDriverSummary", () => {
  it("fails closed when backend driver capabilities are missing", () => {
    const normalized = normalizeDriverSummary({
      id: "ethernetip-cip-readonly",
      name: "ESCO EtherNet/IP CIP Read-Only Driver",
      kind: "ethernetip",
      readOnly: true,
      safetyNote: "Backend summary omitted capability metadata.",
      connectionEvidence: evidence,
    } as ControllerDriverSummary);

    expect(normalized.capabilities).toMatchObject({
      canConnect: true,
      canReadStatus: false,
      canBrowseTags: false,
      canReadTags: false,
      canBatchReadTags: false,
      canSubscribeTags: false,
      canUploadSnapshot: false,
      canCompareProject: false,
      canWriteTags: false,
      canDownloadProject: false,
    });
  });

  it("fills missing partial capability booleans with blocked defaults", () => {
    const normalized = normalizeDriverSummary({
      id: "opcua-generic-readonly",
      name: "Generic OPC UA Read-Only Driver",
      kind: "opcua",
      readOnly: true,
      safetyNote: "Partial metadata from gateway.",
      connectionEvidence: evidence,
      capabilities: {
        canConnect: true,
        canReadTags: true,
      } as Partial<ControllerDriverCapabilities> as ControllerDriverCapabilities,
    });

    expect(normalized.capabilities.canConnect).toBe(true);
    expect(normalized.capabilities.canReadTags).toBe(true);
    expect(normalized.capabilities.canSubscribeTags).toBe(false);
    expect(normalized.capabilities.canBatchReadTags).toBe(false);
    expect(normalized.capabilities.canWriteTags).toBe(false);
  });

  it("preserves a complete backend capability contract", () => {
    const normalized = normalizeDriverSummary({
      id: "ethernetip-cip-readonly",
      name: "ESCO EtherNet/IP CIP Read-Only Driver",
      kind: "ethernetip",
      readOnly: true,
      safetyNote: "Complete backend metadata.",
      connectionEvidence: evidence,
      capabilities: fullReadOnlyCapabilities,
    });

    expect(normalized.capabilities).toEqual(fullReadOnlyCapabilities);
  });
});
