import { describe, expect, it } from "vitest";
import {
  DRIVER_CATALOG,
  ETHERNET_IP_CIP_DRIVER,
  MODEL_ONLY_DRIVER,
  OFFLINE_SIM_DRIVER,
  SHIPPED_DRIVERS,
  TRANSPORT_READINESS_LABELS,
  UNAVAILABLE_DRIVER,
  describeDriverReadiness,
  describeReadiness,
  type TransportCapabilities,
} from "./index";

const VERIFIED_REAL: TransportCapabilities = {
  realControllerIo: true,
  verified: true,
  simulation: false,
  canRead: true,
  canWrite: true,
};

describe("describeReadiness maps capabilities to explicit readiness states", () => {
  it("a simulation transport is always offline-simulation", () => {
    expect(describeReadiness(OFFLINE_SIM_DRIVER.capabilities, OFFLINE_SIM_DRIVER)).toBe("offline-simulation");
  });

  it("a non-real, non-sim transport is unconfigured", () => {
    expect(describeReadiness(UNAVAILABLE_DRIVER.capabilities, UNAVAILABLE_DRIVER)).toBe("unconfigured");
    expect(describeReadiness(MODEL_ONLY_DRIVER.capabilities, MODEL_ONLY_DRIVER)).toBe("unconfigured");
  });

  it("a real but unverified driver is audit-required (the hard gate)", () => {
    expect(describeDriverReadiness(ETHERNET_IP_CIP_DRIVER)).toBe("audit-required");
  });

  it("an unsupported family wins over the audit gate", () => {
    expect(describeDriverReadiness(ETHERNET_IP_CIP_DRIVER, { supported: false })).toBe("unsupported");
  });

  it("a reachable check fails to hardware-unavailable before the audit gate", () => {
    expect(describeDriverReadiness(ETHERNET_IP_CIP_DRIVER, { hardwarePresent: false })).toBe("hardware-unavailable");
  });

  it("a verified driver still needs permission before it is ready", () => {
    expect(describeReadiness(VERIFIED_REAL, { requiresPermission: true, requiresAudit: true })).toBe(
      "permission-required",
    );
  });

  it("only a verified + permitted driver is ready", () => {
    expect(
      describeReadiness(VERIFIED_REAL, { requiresPermission: true, requiresAudit: true }, { permissionGranted: true }),
    ).toBe("ready");
  });

  it("a verified driver that needs no permission is ready immediately", () => {
    expect(describeReadiness(VERIFIED_REAL, { requiresPermission: false, requiresAudit: true })).toBe("ready");
  });

  it("every readiness state has a human-readable label", () => {
    for (const state of Object.keys(TRANSPORT_READINESS_LABELS)) {
      expect(TRANSPORT_READINESS_LABELS[state as keyof typeof TRANSPORT_READINESS_LABELS]).toBeTruthy();
    }
  });
});

describe("driver descriptors are honest about reaching hardware", () => {
  it("no shipped driver claims to be verified", () => {
    for (const driver of SHIPPED_DRIVERS) {
      expect(driver.capabilities.verified).toBe(false);
    }
  });

  it("the CIP descriptor is a spec: real I/O, unverified, audit-required", () => {
    expect(ETHERNET_IP_CIP_DRIVER.capabilities.realControllerIo).toBe(true);
    expect(ETHERNET_IP_CIP_DRIVER.capabilities.verified).toBe(false);
    expect(ETHERNET_IP_CIP_DRIVER.requiresAudit).toBe(true);
    expect(ETHERNET_IP_CIP_DRIVER.protocol).toBe("ethernet-ip-cip");
    expect(ETHERNET_IP_CIP_DRIVER.families.length).toBeGreaterThan(0);
  });

  it("the CIP spec is NOT in the shipped set (it is catalog-only)", () => {
    expect(SHIPPED_DRIVERS).not.toContain(ETHERNET_IP_CIP_DRIVER);
    expect(DRIVER_CATALOG).toContain(ETHERNET_IP_CIP_DRIVER);
    expect(DRIVER_CATALOG.length).toBe(SHIPPED_DRIVERS.length + 1);
  });
});
