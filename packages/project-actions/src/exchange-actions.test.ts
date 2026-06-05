import { describe, expect, it } from "vitest";
import { createDemoProject } from "@esco/core";
import {
  createNativeFileEnvelope,
  parseNativeFileEnvelope,
  serializeNativeFileEnvelope,
  validateEscoNativeArtifact,
} from "./native-format";
import { exportEscoExchange, importProjectFromEscoExchange, type EscoExchangePayload } from "./exchange-actions";

const AT = "2026-06-04T02:00:00.000Z";

describe("ESCO exchange actions", () => {
  it("exports and restores an editable project through a checksum-protected .easx exchange", () => {
    const project = createDemoProject();
    const exported = exportEscoExchange(project, { createdAt: AT });

    expect(exported.ok).toBe(true);
    expect(exported.data).toMatchObject({
      fileName: "demo-project.easx",
      checksum: expect.stringMatching(/^[0-9a-f]{64}$/),
      mediaType: "application/vnd.esco.exchange+json",
      projectPath: "project/demo-project.easproj",
      summary: {
        projectName: project.name,
        artifactCount: 1,
        formats: ["project"],
        boundaries: expect.arrayContaining([
          "offline-editable-project-only",
          "no-controller-communication",
          "no-physical-upload-download",
          "no-online-edit",
          "no-proprietary-binary-project",
        ]),
      },
    });

    const parsed = parseNativeFileEnvelope<EscoExchangePayload>(exported.data!.text, {
      fileName: exported.data!.fileName,
      expectedKind: "exchange",
    });
    expect(parsed.ok).toBe(true);
    expect(parsed.checksum?.valid).toBe(true);
    expect(parsed.file?.payload.exchangeKind).toBe("editable-project-exchange");
    expect(parsed.file?.payload.artifact.text).toContain(project.name);

    const validation = validateEscoNativeArtifact(exported.data!.text, exported.data!.fileName);
    expect(validation.ok).toBe(true);
    expect(validation.summary).toMatchObject({
      validationType: "native-envelope",
      kind: "exchange",
      extension: ".easx",
      checksumValid: true,
      nonMutating: true,
    });

    const imported = importProjectFromEscoExchange(exported.data!.text, exported.data!.fileName);
    expect(imported.ok).toBe(true);
    expect(imported.project.name).toBe(project.name);
    expect(imported.project.controllers).toHaveLength(project.controllers.length);
    expect(imported.data).toMatchObject({
      checksumValid: true,
      projectPath: "project/demo-project.easproj",
      migrationsApplied: [],
      summary: expect.objectContaining({ projectName: project.name }),
    });
    expect(imported.warnings?.[0]).toMatch(/No controller connection/i);
  });

  it("rejects tampered exchange payloads before restoring project state", () => {
    const exported = exportEscoExchange(createDemoProject(), { createdAt: AT });
    const tampered = JSON.parse(exported.data!.text);
    tampered.payload.artifact.text = tampered.payload.artifact.text.replace("Demo Project", "Tampered Project");

    const imported = importProjectFromEscoExchange(JSON.stringify(tampered), exported.data!.fileName);
    expect(imported.ok).toBe(false);
    expect(imported.error).toMatch(/checksum/i);
  });

  it("rejects exchanges whose embedded project byte count no longer matches", () => {
    const exported = exportEscoExchange(createDemoProject(), { createdAt: AT });
    const parsed = parseNativeFileEnvelope<EscoExchangePayload>(exported.data!.text, { expectedKind: "exchange" });
    expect(parsed.ok).toBe(true);
    const payload = {
      ...parsed.file!.payload,
      artifact: {
        ...parsed.file!.payload.artifact,
        bytes: parsed.file!.payload.artifact.bytes + 1,
      },
    };
    const edited = createNativeFileEnvelope("exchange", payload, { createdAt: AT });

    const result = importProjectFromEscoExchange(serializeNativeFileEnvelope(edited), exported.data!.fileName);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/byte count/i);
  });
});
