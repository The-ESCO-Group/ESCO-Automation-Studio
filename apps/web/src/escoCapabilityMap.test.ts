import type { ControllerCommandKind } from "@esco/controller-comm";
import { describe, expect, it } from "vitest";
import {
  ESCO_CAPABILITY_STATUSES,
  escoCapabilityById,
  escoCapabilityCounts,
  escoControllerCommandCapability,
  escoControllerCommandDisplayLabel,
  escoControllerCommandUnavailableTitle,
} from "./escoCapabilityMap";

describe("escoCapabilityMap", () => {
  it("uses the explicit seven-state capability vocabulary", () => {
    expect(ESCO_CAPABILITY_STATUSES).toEqual([
      "implemented",
      "partial",
      "simulation-only",
      "model-only",
      "review-only",
      "planned",
      "unsupported",
    ]);

    const counts = escoCapabilityCounts();
    for (const status of ESCO_CAPABILITY_STATUSES) {
      expect(counts[status]).toBeGreaterThan(0);
    }
    expect("usable" in counts).toBe(false);
    expect("gap" in counts).toBe(false);
  });

  it("classifies core offline, interchange, and preview capabilities conservatively", () => {
    expect(escoCapabilityById("offline-simulation")?.status).toBe("simulation-only");
    expect(escoCapabilityById("virtual-controller-session")?.status).toBe("simulation-only");
    expect(escoCapabilityById("hmi-preview")?.status).toBe("model-only");
    expect(escoCapabilityById("xml-review-export")?.status).toBe("review-only");
    expect(escoCapabilityById("binary-project-import")?.status).toBe("unsupported");
    expect(escoCapabilityById("verified-controller-transport")?.status).toBe("planned");
  });

  it("keeps proprietary .ACD/binary project handling explicitly unsupported", () => {
    const capability = escoCapabilityById("binary-project-import");
    expect(capability?.status).toBe("unsupported");
    expect(capability?.summary).toMatch(/\.ACD/i);
    expect(capability?.summary).toMatch(/not read, written, compiled, decompiled, uploaded, downloaded, converted, or faked/i);
    expect(capability?.visibleIn).toMatch(/Import guard|About|Help/);
  });

  it("marks visible real hardware commands unsupported", () => {
    const hardwareCommands: ControllerCommandKind[] = [
      "go-online",
      "upload",
      "download",
      "network-browser",
      "select-recent-path",
      "run-mode",
      "program-mode",
      "test-mode",
      "clear-faults",
      "test-edits",
      "assemble-edits",
      "finalize-edits",
      "cancel-edits",
    ];

    for (const command of hardwareCommands) {
      const capability = escoControllerCommandCapability(command);
      expect(capability?.status).toBe("unsupported");
      expect(escoControllerCommandDisplayLabel(command, "Command")).toContain("(Unsupported)");
      expect(escoControllerCommandUnavailableTitle(command)).toMatch(/verified|unsupported|no tested|blocked/i);
    }
  });

  it("splits future read-only monitor from broader hardware Go Online and transfer", () => {
    for (const command of ["monitor", "fault-diagnostics", "go-to-faults"] as const) {
      const capability = escoControllerCommandCapability(command);
      expect(capability?.id).toBe("verified-readonly-monitor");
      expect(capability?.status).toBe("planned");
      expect(capability?.summary).toMatch(/without enabling upload, download, mode changes, online edits/i);
      expect(escoControllerCommandDisplayLabel(command, "Command")).toContain("(Future)");
    }

    expect(escoControllerCommandCapability("go-online")?.id).toBe("real-go-online");
    expect(escoControllerCommandCapability("upload")?.id).toBe("real-transfer");
    expect(escoControllerCommandCapability("download")?.id).toBe("real-transfer");
    expect(escoControllerCommandCapability("clear-faults")?.id).toBe("hardware-faults");
  });
});
