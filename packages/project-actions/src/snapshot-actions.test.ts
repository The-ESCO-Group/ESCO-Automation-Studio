import { describe, expect, it } from "vitest";
import { createDemoProject } from "@esco/core";
import { createDefaultHmiProject, createHmiScreen, withHmiProject } from "@esco/hmi-model";
import { parseNativeFileEnvelope, validateEscoNativeArtifact } from "./native-format";
import { exportEscoSnapshot, importProjectFromEscoSnapshot } from "./snapshot-actions";

const AT = "2026-06-04T01:00:00.000Z";

describe("ESCO snapshot actions", () => {
  it("exports and restores a checksum-protected offline project snapshot", () => {
    const project = createDemoProject();
    const exported = exportEscoSnapshot(project, { createdAt: AT });

    expect(exported.ok).toBe(true);
    expect(exported.data).toMatchObject({
      fileName: "demo-project.eassnap",
      checksum: expect.stringMatching(/^[0-9a-f]{64}$/),
      summary: {
        projectName: project.name,
        controllerCount: 1,
        boundaries: expect.arrayContaining([
          "offline-project-state-only",
          "no-controller-communication",
          "no-physical-upload-download",
          "no-online-edit",
        ]),
      },
    });

    const validation = validateEscoNativeArtifact(exported.data!.text, exported.data!.fileName);
    expect(validation.ok).toBe(true);
    expect(validation.summary).toMatchObject({
      validationType: "native-envelope",
      kind: "snapshot",
      extension: ".eassnap",
      checksumValid: true,
      nonMutating: true,
    });

    const imported = importProjectFromEscoSnapshot(exported.data!.text, exported.data!.fileName);
    expect(imported.ok).toBe(true);
    expect(imported.project.name).toBe(project.name);
    expect(imported.project.controllers).toHaveLength(project.controllers.length);
    expect(imported.data).toMatchObject({
      checksumValid: true,
      restoredHmiProject: false,
      summary: expect.objectContaining({ projectName: project.name }),
    });
    expect(imported.warnings?.[0]).toMatch(/No controller connection/i);
  });

  it("includes HMI project state when a snapshot is exported from an HMI-enabled project", () => {
    const project = createDemoProject();
    const hmi = createDefaultHmiProject("Line HMI");
    hmi.screens.push(createHmiScreen("Overview"));

    const exported = exportEscoSnapshot(withHmiProject(project, hmi), { createdAt: AT, hmiProject: hmi });
    const parsed = parseNativeFileEnvelope(exported.data!.text, { expectedKind: "snapshot" });

    expect(parsed.ok).toBe(true);
    expect((parsed.file?.payload as { summary?: { hmiScreenCount?: number } }).summary?.hmiScreenCount).toBe(1);

    const imported = importProjectFromEscoSnapshot(exported.data!.text, exported.data!.fileName);
    expect(imported.ok).toBe(true);
    expect(imported.data?.restoredHmiProject).toBe(true);
  });

  it("rejects tampered snapshots before restoring project state", () => {
    const exported = exportEscoSnapshot(createDemoProject(), { createdAt: AT });
    const tampered = JSON.parse(exported.data!.text);
    tampered.payload.project.name = "Tampered";

    const imported = importProjectFromEscoSnapshot(JSON.stringify(tampered), exported.data!.fileName);
    expect(imported.ok).toBe(false);
    expect(imported.error).toMatch(/checksum/i);
  });
});
