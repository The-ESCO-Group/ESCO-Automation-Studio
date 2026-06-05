import { describe, expect, it } from "vitest";
import { downloadToSoftController } from "@esco/project-actions";
import { deserializeProject } from "@esco/project-store";
import { EscoSoftController, createSoftControllerTarget } from "@esco/soft-controller";
import { createBlankRoutineProject, withNewTag } from "./project-edit";
import {
  createSoftControllerRuntimeTagProvider,
  softControllerMonitorSnapshot,
  softControllerUploadImage,
  uploadSoftControllerImage,
} from "./virtual-controller-session";

const AT = "2026-06-03T12:00:00.000Z";

function validProject() {
  return withNewTag(
    createBlankRoutineProject({
      projectName: "Soft Upload Line",
      controllerName: "SoftCtl",
      catalogNumber: "ESCO-SOFT-CTRL",
      firmwareRevision: "1.0.0",
    }),
    "StartPB",
  );
}

describe("web SoftController upload session helpers", () => {
  it("reconstructs a downloaded SoftController image and returns a preview plus project payload", () => {
    const soft = new EscoSoftController({ now: () => AT });
    const downloaded = downloadToSoftController(validProject(), createSoftControllerTarget(soft), {
      builtAt: AT,
      now: () => AT,
    });
    expect(downloaded.ok).toBe(true);

    const uploaded = uploadSoftControllerImage(softControllerUploadImage(soft), { uploadedAt: AT });
    expect(uploaded.ok).toBe(true);
    expect(uploaded.data?.preview.projectName).toBe("Soft Upload Line");
    expect(uploaded.data?.preview.controllerName).toBe("SoftCtl");
    expect(uploaded.data?.preview.checksumValid).toBe(true);
    expect(uploaded.data?.preview.counts.controllers).toBe(1);
    expect(uploaded.data?.preview.counts.tags).toBe(1);

    const payloadProject = deserializeProject(uploaded.data!.payload);
    expect(payloadProject.provenance?.sourceType).toBe("esco-softcontroller-upload");
    expect(payloadProject.provenance?.softController?.runtimeChecksum).toMatch(/^[0-9a-f]{64}$/);
  });

  it("fails cleanly when the SoftController has no downloaded runtime image", () => {
    const uploaded = uploadSoftControllerImage(softControllerUploadImage(new EscoSoftController()), {
      uploadedAt: AT,
    });
    expect(uploaded.ok).toBe(false);
    expect(uploaded.error).toMatch(/empty|no project has been downloaded/i);
  });

  it("fails cleanly when the SoftController image is corrupt", () => {
    const uploaded = uploadSoftControllerImage(
      { connected: true, runtimeImage: "}{ not runtime json" },
      { uploadedAt: AT },
    );
    expect(uploaded.ok).toBe(false);
    expect(uploaded.error).toMatch(/corrupt esco softcontroller runtime image/i);
  });

  it("uses the executable SoftController rollback hook for restore availability", () => {
    const soft = new EscoSoftController({ now: () => AT });
    expect(soft.status().backup.available).toBe(false);

    const first = downloadToSoftController(validProject(), createSoftControllerTarget(soft), {
      builtAt: AT,
      now: () => AT,
    });
    expect(first.ok).toBe(true);
    const secondProject = withNewTag(validProject(), "SecondTag");
    const second = downloadToSoftController(secondProject, createSoftControllerTarget(soft), {
      builtAt: AT,
      now: () => AT,
    });
    expect(second.ok).toBe(true);
    expect(soft.status().backup.available).toBe(true);

    const restored = soft.restorePreviousRuntime();
    expect(restored.ok).toBe(true);
    expect(restored.restored).toBe(true);
    expect(soft.status().runtime?.projectName).toBe("Soft Upload Line");
  });

  it("exposes SoftController tags through the HMI runtime provider contract", () => {
    const soft = new EscoSoftController({ now: () => AT });
    const downloaded = downloadToSoftController(validProject(), createSoftControllerTarget(soft), {
      builtAt: AT,
      now: () => AT,
    });
    expect(downloaded.ok).toBe(true);

    const provider = createSoftControllerRuntimeTagProvider(soft);
    expect(provider.listTags()).toContain("StartPB");
    expect(provider.getMetadata("StartPB")).toMatchObject({ dataType: "BOOL", writable: true });
    expect(provider.read("StartPB")).toMatchObject({ value: false, quality: "good" });

    const samples: unknown[] = [];
    const unsubscribe = provider.subscribe("StartPB", (sample) => samples.push(sample.value));
    const written = provider.write({ path: "StartPB", value: true, timestampMs: 1 });
    expect(written.ok).toBe(true);
    expect(provider.read("StartPB")).toMatchObject({ value: true, quality: "good" });
    expect(samples).toEqual([false, true]);

    unsubscribe();
    provider.dispose();
  });

  it("projects a read-only SoftController live monitor snapshot with tag values and scan counters", () => {
    const soft = new EscoSoftController({ now: () => AT });
    const downloaded = downloadToSoftController(validProject(), createSoftControllerTarget(soft), {
      builtAt: AT,
      now: () => AT,
    });
    expect(downloaded.ok).toBe(true);

    let monitor = softControllerMonitorSnapshot(soft);
    expect(monitor.softwareOnly).toBe(true);
    expect(monitor.runtimeLoaded).toBe(true);
    expect(monitor.running).toBe(false);
    expect(monitor.runtime?.projectName).toBe("Soft Upload Line");
    expect(monitor.tagRows).toEqual([
      expect.objectContaining({ path: "StartPB", dataType: "BOOL", value: false }),
    ]);

    expect(soft.startScan().ok).toBe(true);
    expect(soft.scanOnce().ok).toBe(true);
    monitor = softControllerMonitorSnapshot(soft);
    expect(monitor.running).toBe(true);
    expect(monitor.scanCount).toBe(1);
    expect(monitor.lastScanMs).toBeGreaterThan(0);
    expect(monitor.lastScanEvidence?.softwareOnly).toBe(true);
    expect(monitor.pendingEventTaskTriggers).toEqual([]);
  });
});
