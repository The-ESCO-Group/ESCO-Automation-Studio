import { describe, expect, it } from "vitest";
import { createController, createProject } from "@esco/core";
import { controllerDocumentationReviewReport } from "./controller-documentation-review";

describe("controllerDocumentationReviewReport", () => {
  it("reviews controller project documentation language and download settings with offline boundaries", () => {
    const project = createProject("Controller Documentation Review");
    const controller = createController(project.id, "LineCtl");
    controller.currentProjectLanguage = "en-US";
    controller.defaultProjectLanguage = "en-US";
    controller.controllerLanguage = "fr-FR";
    controller.passThroughConfiguration = "EnabledWithAppend";
    controller.downloadProjectDocumentationAndExtendedProperties = "true";
    controller.downloadProjectCustomProperties = "false";
    project.controllers.push(controller);

    const report = controllerDocumentationReviewReport(project);
    expect(report.controllerCount).toBe(1);
    expect(report.reviewableCount).toBe(1);
    expect(report.configuredLanguageCount).toBe(1);
    expect(report.configuredDownloadCount).toBe(1);
    expect(report.issueCount).toBe(0);
    expect(report.rows[0]).toMatchObject({
      controllerName: "LineCtl",
      currentProjectLanguage: "en-US",
      defaultProjectLanguage: "en-US",
      controllerLanguage: "fr-FR",
      passThroughConfiguration: "EnabledWithAppend",
      downloadProjectDocumentationAndExtendedPropertiesEnabled: true,
      downloadProjectCustomPropertiesEnabled: false,
      languageMetadataPresent: true,
      downloadMetadataPresent: true,
      status: "reviewable",
      controllerCommunicationModelled: false,
      projectDocumentationDownloadModelled: false,
      languageMergeModelled: false,
      languageSelectionDialogModelled: false,
      extendedPropertiesSyncModelled: false,
      customPropertiesSyncModelled: false,
    });
    expect(report.rows[0]?.boundaries).toEqual(expect.arrayContaining([
      "no-controller-communication",
      "no-project-documentation-download",
      "no-controller-pass-through-storage",
      "no-language-merge",
      "no-language-selection-dialog",
      "no-extended-properties-sync",
      "no-custom-properties-sync",
    ]));
  });

  it("flags partial language/download metadata and invalid true/false flags", () => {
    const project = createProject("Controller Documentation Issues");
    const controller = createController(project.id, "BadDocsCtl");
    controller.currentProjectLanguage = "en-US";
    controller.passThroughConfiguration = "EnabledWithAppend";
    controller.downloadProjectDocumentationAndExtendedProperties = "sometimes";
    project.controllers.push(controller);

    const report = controllerDocumentationReviewReport(project);
    expect(report.issueCount).toBe(1);
    expect(report.partialLanguageCount).toBe(1);
    expect(report.partialDownloadCount).toBe(1);
    expect(report.invalidDownloadFlagCount).toBe(1);
    expect(report.rows[0]?.issues).toEqual([
      "partial-language-metadata",
      "partial-download-metadata",
      "invalid-download-project-documentation-flag",
    ]);
    expect(report.rows[0]?.status).toBe("needs-attention");
    expect(report.warnings[0]).toMatch(/partial project documentation language metadata/);
    expect(report.warnings[0]).toMatch(/DownloadProjectDocumentationAndExtendedProperties/);
  });

  it("marks controllers with no imported documentation metadata as no-metadata", () => {
    const project = createProject("No Metadata");
    project.controllers.push(createController(project.id, "BareCtl"));

    const report = controllerDocumentationReviewReport(project);
    expect(report.reviewableCount).toBe(0);
    expect(report.configuredLanguageCount).toBe(0);
    expect(report.configuredDownloadCount).toBe(0);
    expect(report.issueCount).toBe(0);
    expect(report.rows[0]).toMatchObject({
      controllerName: "BareCtl",
      languageMetadataPresent: false,
      downloadMetadataPresent: false,
      status: "no-metadata",
      projectDocumentationDownloadModelled: false,
    });
  });
});
