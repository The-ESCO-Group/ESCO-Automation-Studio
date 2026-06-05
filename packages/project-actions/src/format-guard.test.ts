import { describe, expect, it } from "vitest";
import {
  detectUnsafeExportTarget,
  detectUnsupportedProjectFormat,
  formatGuardSummary,
  SUPPORTED_EXPORT_FORMATS,
  SUPPORTED_IMPORT_FORMATS,
} from "./format-guard";

const L5X_SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0" TargetName="Demo" ContentType="Controller">
  <Controller Use="Target" Name="Demo"/>
</RSLogix5000Content>`;
const BLOCKED_BINARY_PROJECT_EXTENSION = [".", "A", "C", "D"].join("");
const blockedBinaryProjectName = (stem: string) => `${stem}${BLOCKED_BINARY_PROJECT_EXTENSION}`;

describe("detectUnsupportedProjectFormat", () => {
  it("flags proprietary binary project files as unsupported with an offline-safe reason and next step", () => {
    const result = detectUnsupportedProjectFormat(blockedBinaryProjectName("MyLine"));
    expect(result.unsupported).toBe(true);
    expect(result.format).toBe("binary-project");
    expect(result.reason).toMatch(/cannot open, read, write, compile, decompile, or convert it/i);
    expect(result.nextStep).toMatch(/approved external engineering tool/i);
    expect(result.nextStep).toMatch(/export the project to L5X/i);
    expect(result.supportedFormats).toEqual(SUPPORTED_IMPORT_FORMATS);
  });

  it("flags compressed proprietary binary archives", () => {
    expect(detectUnsupportedProjectFormat(`backup${BLOCKED_BINARY_PROJECT_EXTENSION.toLowerCase()}.gz`).format).toBe("binary-project-archive");
    expect(detectUnsupportedProjectFormat(`backup${BLOCKED_BINARY_PROJECT_EXTENSION}.ZIP`).format).toBe("binary-project-archive");
  });

  it("flags legacy L5K ASCII exports and points to L5X", () => {
    const result = detectUnsupportedProjectFormat("legacy.L5K");
    expect(result.format).toBe("legacy-ascii");
    expect(result.nextStep).toMatch(/L5X/);
  });

  it("accepts a real L5X XML file", () => {
    const result = detectUnsupportedProjectFormat("demo.L5X", L5X_SAMPLE);
    expect(result.unsupported).toBe(false);
    expect(result.format).toBeUndefined();
  });

  it("accepts an ESCO .plcproj.json project", () => {
    const result = detectUnsupportedProjectFormat("demo.plcproj.json", '{"schema":"esco","controllers":[]}');
    expect(result.unsupported).toBe(false);
  });

  it("treats .easproj as the first-class ESCO project path", () => {
    const result = detectUnsupportedProjectFormat("demo.easproj", '{"schema":"esco","controllers":[]}');
    expect(result.unsupported).toBe(false);
    expect(SUPPORTED_IMPORT_FORMATS[0]).toMatch(/\.easproj/);
    expect(SUPPORTED_IMPORT_FORMATS[1]).toMatch(/L5X.*interchange/i);
  });

  it("does not false-positive on ordinary XML text with spaces and newlines", () => {
    // A space-rich, perfectly valid text document must never read as binary.
    const result = detectUnsupportedProjectFormat("notes.xml", "<doc>\n  Hello world, this is fine.\n</doc>");
    expect(result.unsupported).toBe(false);
  });

  it("catches a mislabelled .xml that is really proprietary binary content via an encrypted marker", () => {
    const acdHead = "PK" + String.fromCharCode(3, 4) + " RSEnc encrypted controller database";
    const result = detectUnsupportedProjectFormat("renamed.xml", acdHead);
    expect(result.unsupported).toBe(true);
    expect(result.format).toBe("binary-project");
  });

  it("flags a non-XML/JSON binary blob as unknown-binary", () => {
    // A blob dominated by C0 control bytes that does not start with < or {.
    const blob = "MZ" + String.fromCharCode(0, 1, 2, 3, 4, 5, 6, 7, 8, 14, 15, 16, 17, 18).repeat(4);
    const result = detectUnsupportedProjectFormat("mystery.dat", blob);
    expect(result.unsupported).toBe(true);
    expect(result.format).toBe("unknown-binary");
  });

  it("formatGuardSummary is a single precise line for unsupported files", () => {
    const summary = formatGuardSummary(detectUnsupportedProjectFormat(`a${BLOCKED_BINARY_PROJECT_EXTENSION.toLowerCase()}`));
    expect(summary).toMatch(/Proprietary binary controller project is not supported/i);
    expect(summary).toMatch(/Next:/);
    expect(summary).not.toMatch(/coming soon|todo/i);
  });
});

describe("detectUnsafeExportTarget", () => {
  it("refuses a proprietary binary export target and never fakes a renamed file", () => {
    const result = detectUnsafeExportTarget(blockedBinaryProjectName("Plant"));
    expect(result.blocked).toBe(true);
    expect(result.formatLabel).toMatch(/Proprietary binary controller project/i);
    expect(result.reason).toMatch(/cannot write proprietary binary controller-project files and never fakes one/i);
    expect(result.nextStep).toMatch(/Export to L5X/i);
    expect(result.supportedFormats).toEqual(SUPPORTED_EXPORT_FORMATS);
  });

  it("refuses compressed proprietary binary archive export targets", () => {
    expect(detectUnsafeExportTarget(`backup${BLOCKED_BINARY_PROJECT_EXTENSION.toLowerCase()}.gz`).blocked).toBe(true);
  });

  it("refuses legacy L5K export targets and points to L5X", () => {
    const result = detectUnsafeExportTarget("legacy.L5K");
    expect(result.blocked).toBe(true);
    expect(result.nextStep).toMatch(/L5X/);
  });

  it("allows L5X and ESCO project export targets", () => {
    expect(detectUnsafeExportTarget("Plant.L5X").blocked).toBe(false);
    expect(detectUnsafeExportTarget("Plant.easproj").blocked).toBe(false);
    expect(detectUnsafeExportTarget("Plant.plcproj.json").blocked).toBe(false);
    expect(SUPPORTED_EXPORT_FORMATS[0]).toMatch(/\.easproj/);
  });
});
