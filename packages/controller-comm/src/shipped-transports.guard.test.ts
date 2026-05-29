import { describe, expect, it } from "vitest";
import {
  MODEL_ONLY_DRIVER,
  ModelOnlyTransport,
  OFFLINE_SIM_DRIVER,
  OfflineSimulationTransport,
  ReadOnlyControllerTransport,
  RealControllerTransport,
  SHIPPED_DRIVERS,
  UNAVAILABLE_DRIVER,
  UnavailableTransport,
  describeReadiness,
  type ControllerTransport,
  type DriverDescriptor,
  type TransportConnectResult,
} from "./index";

/**
 * REGRESSION BACKSTOP (see docs/threat-model.md crown-jewel control).
 *
 * The single safety invariant of this package is: no transport that actually
 * SHIPS may report `verified: true`, because `verified` is the hard gate that
 * unlocks a real Connected state and real upload/download/online-edit. These
 * tests fail loudly the moment a shipped transport — or its driver descriptor —
 * flips `verified`, or the moment `describeReadiness` would call a shipped
 * transport `ready`. They are intentionally blunt.
 */

/** Every concrete transport that the app can instantiate today, paired with its descriptor. */
const SHIPPED_TRANSPORTS: { transport: ControllerTransport; driver: DriverDescriptor }[] = [
  { transport: new OfflineSimulationTransport(), driver: OFFLINE_SIM_DRIVER },
  { transport: new UnavailableTransport(), driver: UNAVAILABLE_DRIVER },
  { transport: new ModelOnlyTransport(), driver: MODEL_ONLY_DRIVER },
];

describe("no shipped controller transport is verified", () => {
  for (const { transport } of SHIPPED_TRANSPORTS) {
    it(`${transport.kind} (${transport.displayName}) reports verified: false`, () => {
      expect(transport.capabilities.verified).toBe(false);
    });
  }

  it("not a single shipped driver descriptor is verified", () => {
    for (const driver of SHIPPED_DRIVERS) {
      expect(driver.capabilities.verified).toBe(false);
    }
  });

  it("no shipped transport can ever be described as 'ready'", () => {
    for (const { transport, driver } of SHIPPED_TRANSPORTS) {
      // Even granting every favourable runtime fact, a non-verified transport
      // can never reach `ready`.
      const readiness = describeReadiness(transport.capabilities, driver, {
        permissionGranted: true,
        supported: true,
        hardwarePresent: true,
      });
      expect(readiness).not.toBe("ready");
    }
  });
});

describe("driver descriptors do not drift from the transports they describe", () => {
  for (const { transport, driver } of SHIPPED_TRANSPORTS) {
    it(`${driver.id} descriptor capabilities match the ${transport.kind} transport`, () => {
      expect(driver.capabilities).toEqual(transport.capabilities);
    });
  }
});

/** A minimal concrete subclass of each abstract real base, to inspect its defaults. */
class ProbeReadOnly extends ReadOnlyControllerTransport {
  readonly displayName = "probe read-only";
  async connect(): Promise<TransportConnectResult> {
    return { ok: true, reportedState: "connected-readonly", message: "" };
  }
  async disconnect(): Promise<void> {}
}
class ProbeReal extends RealControllerTransport {
  readonly displayName = "probe real";
  async connect(): Promise<TransportConnectResult> {
    return { ok: true, reportedState: "connected-readonly", message: "" };
  }
  async disconnect(): Promise<void> {}
}

describe("the abstract real bases ship unverified (audit-required), never ready", () => {
  it("ReadOnlyControllerTransport defaults to real I/O but unverified", () => {
    const probe = new ProbeReadOnly();
    expect(probe.capabilities.realControllerIo).toBe(true);
    expect(probe.capabilities.verified).toBe(false);
    expect(probe.capabilities.canWrite).toBe(false);
    expect(describeReadiness(probe.capabilities, { requiresPermission: true, requiresAudit: true })).toBe(
      "audit-required",
    );
  });

  it("RealControllerTransport defaults to write-capable but unverified", () => {
    const probe = new ProbeReal();
    expect(probe.capabilities.realControllerIo).toBe(true);
    expect(probe.capabilities.canWrite).toBe(true);
    expect(probe.capabilities.verified).toBe(false);
    expect(describeReadiness(probe.capabilities, { requiresPermission: true, requiresAudit: true })).toBe(
      "audit-required",
    );
  });

  it("ONLY overriding verified to true (a thing no shipped class does) reaches ready", () => {
    // Proves `ready` is reachable in principle — but only by the very override the
    // shipped transports above are asserted never to make.
    const verifiedCaps = { ...new ProbeReal().capabilities, verified: true };
    expect(describeReadiness(verifiedCaps, { requiresPermission: false, requiresAudit: true })).toBe("ready");
  });
});
