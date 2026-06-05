import { describe, expect, it } from "vitest";
import { createDemoProject } from "@esco/core";
import {
  canonicalJson,
  createEscoPackage,
  createEscoPackageManifest,
  createNativeFileEnvelope,
  EASX_EXTENSION,
  EASPKG_EXTENSION,
  EASRUNTIME_EXTENSION,
  ESCO_FILE_FORMATS,
  ESCO_NATIVE_JSON_SCHEMAS,
  extractEscoPackageArtifacts,
  findEscoNativeFormatByExtension,
  isEscoArtifactFileName,
  isEscoNativeFileName,
  parseEscoPackage,
  parseEscoPackageManifest,
  serializeEscoPackage,
  parseNativeFileEnvelope,
  serializeEscoPackageManifest,
  serializeNativeFileEnvelope,
  validateEscoNativeArtifact,
  validateEscoPackageManifest,
} from "./native-format";
import { exportEscoPackage, importProjectFromEscoPackage } from "./package-actions";
import { exportEscoRuntime } from "./runtime-actions";

const AT = "2026-06-03T12:00:00.000Z";
const BLOCKED_BINARY_PROJECT_EXTENSION = [".", "A", "C", "D"].join("");
const blockedBinaryProjectName = (stem: string) => `${stem}${BLOCKED_BINARY_PROJECT_EXTENSION}`;

describe("ESCO native format registry", () => {
  it("registers the ESCO-owned file family and not controller/proprietary paths", () => {
    expect(ESCO_FILE_FORMATS.map((format) => format.extension)).toEqual([
      ".easproj",
      ".easctrl",
      ".eastags",
      ".easroutine",
      ".easio",
      ".eashmi",
      ".easlib",
      ".eassnap",
      ".easx",
      ".easruntime",
      ".easpkg",
    ]);
    expect(ESCO_NATIVE_JSON_SCHEMAS.exchange.extension).toBe(EASX_EXTENSION);
    expect(ESCO_NATIVE_JSON_SCHEMAS.runtime.extension).toBe(EASRUNTIME_EXTENSION);
    expect(ESCO_NATIVE_JSON_SCHEMAS.package.extension).toBe(EASPKG_EXTENSION);

    expect(isEscoNativeFileName("Line.easproj")).toBe(true);
    expect(isEscoNativeFileName("Line.easx")).toBe(true);
    expect(isEscoNativeFileName("Runtime.easruntime")).toBe(true);
    expect(isEscoNativeFileName("legacy.easrt")).toBe(true);
    expect(isEscoNativeFileName(blockedBinaryProjectName("Plant"))).toBe(false);
    expect(isEscoNativeFileName("Plant.L5X")).toBe(false);
    expect(isEscoArtifactFileName("MainRoutine.esco-routine.json")).toBe(true);
    expect(isEscoArtifactFileName("Controller_1-trends.esco-assets.json")).toBe(true);
    expect(isEscoArtifactFileName("LineSpeed.esco-trend.json")).toBe(true);
  });

  it("finds formats by canonical extension and compatibility alias", () => {
    expect(findEscoNativeFormatByExtension("Line.easproj")?.kind).toBe("project");
    expect(findEscoNativeFormatByExtension("Line.plcproj.json")?.kind).toBe("project");
    expect(findEscoNativeFormatByExtension("Runtime.easrt")?.kind).toBe("runtime");
  });
});

describe("native envelope serialization and validation", () => {
  it("creates, serializes, loads, and validates a native routine file with stable key ordering", () => {
    const payloadA = { z: 2, name: "MainRoutine", source: { b: "OTE(Motor)", a: "XIC(Start)" } };
    const payloadB = { source: { a: "XIC(Start)", b: "OTE(Motor)" }, name: "MainRoutine", z: 2 };
    const first = createNativeFileEnvelope("routine", payloadA, { createdAt: AT });
    const second = createNativeFileEnvelope("routine", payloadB, { createdAt: AT });
    const text = serializeNativeFileEnvelope(first);

    expect(canonicalJson(payloadA)).toBe(canonicalJson(payloadB));
    expect(text).toBe(serializeNativeFileEnvelope(second));

    const loaded = parseNativeFileEnvelope<typeof payloadA>(text, {
      fileName: "MainRoutine.easroutine",
      expectedKind: "routine",
    });
    expect(loaded.ok).toBe(true);
    expect(loaded.format?.kind).toBe("routine");
    expect(loaded.checksum?.valid).toBe(true);
    expect(loaded.file?.payload).toEqual(payloadA);
  });

  it("rejects invalid native envelopes clearly", () => {
    const file = createNativeFileEnvelope("tags", { tags: [{ name: "MotorRun", dataType: "BOOL" }] }, { createdAt: AT });
    const tampered = JSON.parse(serializeNativeFileEnvelope(file));
    tampered.payload.tags[0].name = "Tampered";

    expect(parseNativeFileEnvelope(JSON.stringify(tampered), { fileName: "tags.eastags" }).error).toMatch(/integrity check failed/i);
    expect(parseNativeFileEnvelope("not json").error).toMatch(/not valid JSON/i);
    expect(parseNativeFileEnvelope(serializeNativeFileEnvelope(file), { expectedKind: "routine" }).error).toMatch(/Expected ESCO Routine/i);
    expect(parseNativeFileEnvelope(serializeNativeFileEnvelope(file), { fileName: blockedBinaryProjectName("Plant") }).error).toMatch(/not an ESCO-native file/i);
    expect(parseNativeFileEnvelope(serializeNativeFileEnvelope(file), { fileName: "Plant.L5X" }).error).toMatch(/Controller interchange\/binary formats are not ESCO-native/i);

    const future = JSON.parse(serializeNativeFileEnvelope(file));
    future.schemaVersion = 999;
    expect(parseNativeFileEnvelope(JSON.stringify(future), { fileName: "tags.eastags" }).error).toMatch(/Unsupported ESCO Tag Set schema version/i);
  });
});

describe("ESCO package manifest", () => {
  it("creates a deterministic .easpkg manifest with entries sorted by path", () => {
    const unsorted = createEscoPackageManifest(
      [
        { path: "runtime/Line.easruntime", text: "{\"runtime\":true}" },
        { path: "project/Line.easproj", text: "{\"project\":true}" },
        { path: "logic/Main.easroutine", text: "{\"routine\":true}" },
      ],
      { createdAt: AT },
    );
    const sorted = createEscoPackageManifest(
      [
        { path: "logic/Main.easroutine", text: "{\"routine\":true}" },
        { path: "project/Line.easproj", text: "{\"project\":true}" },
        { path: "runtime/Line.easruntime", text: "{\"runtime\":true}" },
      ],
      { createdAt: AT },
    );

    expect(unsorted.entries.map((entry) => entry.path)).toEqual([
      "logic/Main.easroutine",
      "project/Line.easproj",
      "runtime/Line.easruntime",
    ]);
    expect(serializeEscoPackageManifest(unsorted)).toBe(serializeEscoPackageManifest(sorted));

    const parsed = parseEscoPackageManifest(serializeEscoPackageManifest(unsorted));
    expect(parsed.ok).toBe(true);
    expect(parsed.manifest?.extension).toBe(EASPKG_EXTENSION);
  });

  it("allows .easpkg manifests to reference app-emitted ESCO component artifacts", () => {
    const component = {
      format: "esco.component.export.v1",
      kind: "routine",
      name: "MainRoutine",
      exportedAt: AT,
      project: { id: "project_1", name: "Line" },
      dependencies: { tags: ["StartPB"], dataTypes: ["BOOL"], routines: ["MainRoutine"], devices: [] },
      payload: { id: "routine_1", name: "MainRoutine" },
    };
    const assets = {
      format: "esco.controller-assets.export.v1",
      kind: "controller-trends",
      exportedAt: AT,
      project: { id: "project_1", name: "Line" },
      controller: { id: "controller_1", name: "Controller_1" },
      payload: [{ id: "trend_1", name: "LineSpeed", pens: [] }],
    };

    const manifest = createEscoPackageManifest(
      [
        { path: "logic/MainRoutine.esco-routine.json", text: JSON.stringify(component) },
        { path: "assets/Controller_1-trends.esco-assets.json", text: JSON.stringify(assets) },
      ],
      { createdAt: AT },
    );

    expect(manifest.entries.map((entry) => entry.format)).toEqual(["component-assets", "component-routine"]);
    expect(validateEscoPackageManifest(manifest).ok).toBe(true);
  });

  it("builds a deterministic .easpkg manifest referencing the full ESCO artifact family", () => {
    const entries = [
      { path: "project/Line.easproj", text: "{\"project\":true}" },
      { path: "runtime/Line.easruntime", text: "{\"runtime\":true}" },
      { path: "hmi/Line.eashmi", text: "{\"hmi\":true}" },
      { path: "io/Line.easio", text: "{\"io\":true}" },
      { path: "libraries/Common.easlib", text: "{\"lib\":true}" },
      { path: "snapshots/Line.eassnap", text: "{\"snapshot\":true}" },
      { path: "exchange/Line.easx", text: "{\"exchange\":true}" },
    ];
    const manifest = createEscoPackageManifest(entries, { createdAt: AT, packageVersion: "2.0.0" });
    const shuffled = createEscoPackageManifest([...entries].reverse(), { createdAt: AT, packageVersion: "2.0.0" });

    // Deterministic regardless of input order.
    expect(serializeEscoPackageManifest(manifest)).toBe(serializeEscoPackageManifest(shuffled));

    // References the compiled runtime alongside the project, HMI, I/O, library, and snapshot artifacts.
    expect(new Set(manifest.entries.map((entry) => entry.format))).toEqual(
      new Set(["project", "runtime", "hmi", "io", "library", "snapshot", "exchange"]),
    );
    expect(manifest.entries.some((entry) => entry.extension === EASRUNTIME_EXTENSION)).toBe(true);
    expect(manifest.entries.every((entry) => /^[0-9a-f]{64}$/.test(entry.checksum.value))).toBe(true);
    expect(manifest.packageVersion).toBe("2.0.0");

    const parsed = parseEscoPackageManifest(serializeEscoPackageManifest(manifest));
    expect(parsed.ok).toBe(true);
  });

  it("rejects non-native package entries and unsorted manifests", () => {
    expect(() => createEscoPackageManifest([{ path: blockedBinaryProjectName("Plant"), text: "binary" }], { createdAt: AT })).toThrow(/not an ESCO artifact/i);
    expect(() => createEscoPackageManifest([{ path: "Plant.L5X", text: "<xml/>" }], { createdAt: AT })).toThrow(/not an ESCO artifact/i);
    expect(() =>
      createEscoPackageManifest(
        [
          { path: "logic/Main.easroutine", text: "{}" },
          { path: "logic\\Main.easroutine", text: "{}" },
        ],
        { createdAt: AT },
      ),
    ).toThrow(/duplicated/i);

    const manifest = createEscoPackageManifest(
      [
        { path: "b.easroutine", text: "{}" },
        { path: "a.eastags", text: "{}" },
      ],
      { createdAt: AT },
    );
    const invalid = { ...manifest, entries: [...manifest.entries].reverse() };
    expect(validateEscoPackageManifest(invalid).error).toMatch(/sorted by path/i);
  });

  it("creates, validates, and extracts a deterministic embedded .easpkg package", () => {
    const entries = [
      { path: "runtime/Line.easruntime", text: "{\"runtime\":true}" },
      { path: "project/Line.easproj", text: "{\"project\":true}" },
      { path: "logic/Main.easroutine", text: "{\"routine\":true}" },
    ];
    const first = createEscoPackage(entries, { createdAt: AT });
    const second = createEscoPackage([...entries].reverse(), { createdAt: AT });
    const text = serializeEscoPackage(first);

    expect(text).toBe(serializeEscoPackage(second));
    expect(first.artifacts.map((artifact) => artifact.path)).toEqual([
      "logic/Main.easroutine",
      "project/Line.easproj",
      "runtime/Line.easruntime",
    ]);
    expect(first.packageChecksum.value).toMatch(/^[0-9a-f]{64}$/);

    const parsed = parseEscoPackage(text);
    expect(parsed.ok).toBe(true);
    expect(parsed.embeddedContent).toBe(true);
    expect(parsed.packageChecksum?.valid).toBe(true);

    const extracted = extractEscoPackageArtifacts(text);
    expect(extracted.ok).toBe(true);
    expect(extracted.artifacts.map((artifact) => [artifact.path, artifact.text])).toEqual([
      ["logic/Main.easroutine", "{\"routine\":true}"],
      ["project/Line.easproj", "{\"project\":true}"],
      ["runtime/Line.easruntime", "{\"runtime\":true}"],
    ]);

    const packageResult = validateEscoNativeArtifact(text, "Line.easpkg");
    expect(packageResult.ok).toBe(true);
    expect(packageResult.summary).toMatchObject({
      validationType: "package",
      entryCount: 3,
      embeddedContent: true,
      embeddedContentCount: 3,
      packageChecksumValid: true,
      nonMutating: true,
    });
  });

  it("rejects embedded .easpkg files with missing or tampered contents", () => {
    const file = createEscoPackage(
      [
        { path: "project/Line.easproj", text: "{\"project\":true}" },
        { path: "runtime/Line.easruntime", text: "{\"runtime\":true}" },
      ],
      { createdAt: AT },
    );
    const tampered = {
      ...file,
      artifacts: file.artifacts.map((artifact) =>
        artifact.path.endsWith(".easproj") ? { ...artifact, text: "{\"project\":false}" } : artifact,
      ),
    };
    expect(validateEscoPackageManifest(tampered).error).toMatch(/checksum does not match embedded content/i);

    const missing = {
      ...file,
      artifacts: file.artifacts.filter((artifact) => !artifact.path.endsWith(".easruntime")),
      packageChecksum: file.packageChecksum,
    };
    expect(validateEscoPackageManifest(missing).error).toMatch(/has no embedded artifact content/i);

    const manifestOnly = serializeEscoPackageManifest(createEscoPackageManifest([{ path: "project/Line.easproj", text: "{}" }], { createdAt: AT }));
    expect(validateEscoNativeArtifact(manifestOnly, "Line.easpkg").summary).toMatchObject({
      validationType: "package",
      embeddedContent: false,
      entryCount: 1,
    });
    expect(extractEscoPackageArtifacts(manifestOnly).error).toMatch(/manifest-only/i);
  });

  it("exports and imports an editable project through a self-contained ESCO package", () => {
    const project = createDemoProject();
    const exported = exportEscoPackage(project, { createdAt: AT, builtAt: AT });
    expect(exported.ok).toBe(true);
    expect(exported.data?.fileName.endsWith(EASPKG_EXTENSION)).toBe(true);
    expect(exported.data?.embeddedArtifactCount).toBe(2);

    const validation = validateEscoNativeArtifact(exported.data!.text, exported.data!.fileName);
    expect(validation.ok).toBe(true);
    expect(validation.summary).toMatchObject({ validationType: "package", embeddedContent: true, entryCount: 2 });

    const imported = importProjectFromEscoPackage(exported.data!.text);
    expect(imported.ok).toBe(true);
    expect(imported.project.name).toBe(project.name);
    expect(imported.project.controllers).toHaveLength(project.controllers.length);
    expect(imported.data).toMatchObject({
      packageEntryCount: 2,
      embeddedArtifactCount: 2,
      packageChecksumValid: true,
    });
  });
});

describe("ESCO artifact validator", () => {
  it("validates runtime, package manifest, and component artifacts without importing them", () => {
    const runtime = exportEscoRuntime(createDemoProject(), { builtAt: AT });
    expect(runtime.ok).toBe(true);
    const runtimeResult = validateEscoNativeArtifact(runtime.data!.text, runtime.data!.fileName);
    expect(runtimeResult.ok).toBe(true);
    expect(runtimeResult.summary).toMatchObject({
      validationType: "runtime",
      kind: "runtime",
      checksumValid: true,
      nonMutating: true,
    });

    const componentText = `${JSON.stringify(
      {
        format: "esco.component.export.v1",
        kind: "routine",
        name: "MainRoutine",
        exportedAt: AT,
        project: { id: "project_1", name: "Line" },
        dependencies: { tags: [], dataTypes: [], routines: ["MainRoutine"], devices: [] },
        payload: { id: "routine_1", name: "MainRoutine" },
      },
      null,
      2,
    )}\n`;
    const componentResult = validateEscoNativeArtifact(componentText, "MainRoutine.esco-routine.json");
    expect(componentResult.ok).toBe(true);
    expect(componentResult.summary).toMatchObject({ validationType: "component", kind: "routine", payloadCount: 1 });

    const manifest = createEscoPackageManifest(
      [
        { path: `runtime/${runtime.data!.fileName}`, text: runtime.data!.text },
        { path: "logic/MainRoutine.esco-routine.json", text: componentText },
      ],
      { createdAt: AT },
    );
    const packageResult = validateEscoNativeArtifact(serializeEscoPackageManifest(manifest), "Line.easpkg");
    expect(packageResult.ok).toBe(true);
    expect(packageResult.summary).toMatchObject({ validationType: "package", entryCount: 2, nonMutating: true });
  });

  it("rejects non-ESCO validation targets and mismatched component suffixes", () => {
    expect(validateEscoNativeArtifact("<xml/>", "Line.L5X").error).toMatch(/Not an ESCO artifact/i);

    const programText = JSON.stringify({
      format: "esco.component.export.v1",
      kind: "program",
      name: "MainProgram",
      exportedAt: AT,
      project: { id: "project_1", name: "Line" },
      dependencies: { tags: [], dataTypes: [], routines: [], devices: [] },
      payload: { id: "program_1", name: "MainProgram" },
    });
    expect(validateEscoNativeArtifact(programText, "MainRoutine.esco-routine.json").error).toMatch(/suffix expects routine/i);
  });
});
