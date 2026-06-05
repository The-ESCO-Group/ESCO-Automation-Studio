import { describe, expect, it } from "vitest";
import { monitorStateMatrixReport } from "./index";

describe("monitor state matrix report", () => {
  it("keeps shipped offline simulation monitor reads behind the real-transport gate", () => {
    const report = monitorStateMatrixReport();
    const offline = report.rows.find((row) => row.id === "offline-simulation")!;
    expect(offline.realControllerIo).toBe(false);
    expect(offline.monitorAvailable).toBe(false);
    expect(offline.goOfflineAvailable).toBe(true);
    expect(offline.firstBlocker).toBe("no-real-transport");
    expect(offline.summary).toMatch(/no real controller I\/O/i);
  });

  it("models future verified read-only monitoring without clearing download/write", () => {
    const report = monitorStateMatrixReport();
    const readonly = report.rows.find((row) => row.id === "future-verified-readonly")!;
    expect(readonly.realControllerIo).toBe(true);
    expect(readonly.verified).toBe(true);
    expect(readonly.monitorAvailable).toBe(true);
    expect(readonly.faultDiagnosticsAvailable).toBe(true);
    expect(readonly.cells.find((cell) => cell.commandKind === "path-diagnostics")?.reason).toBe("capability-missing");
    expect(readonly.downloadBlocked).toBe(true);
    expect(readonly.nextStep).toMatch(/read-only/i);
  });

  it("keeps faulted and unverified future states visibly blocked", () => {
    const report = monitorStateMatrixReport();
    const faulted = report.rows.find((row) => row.id === "future-faulted-readonly")!;
    const unverified = report.rows.find((row) => row.id === "unverified-safety-blocked")!;

    expect(faulted.monitorAvailable).toBe(false);
    expect(faulted.firstBlocker).toBe("faulted");
    expect(faulted.nextStep).toMatch(/Reconnect/i);
    expect(unverified.monitorAvailable).toBe(false);
    expect(unverified.firstBlocker).toBe("safety-unverified");
    expect(unverified.nextStep).toMatch(/Validate/i);
  });
});
