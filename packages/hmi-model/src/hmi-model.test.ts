import { describe, expect, it } from "vitest";
import {
  acknowledgeHmiAlarms,
  buildHmiRuntimePackage,
  buildHmiDataLogMediaSave,
  clearHmiDiagnosticEvents,
  clearHmiDataLogBuffer,
  createDefaultHmiProject,
  createHmiElement,
  createHmiAlarmRuntime,
  createHmiDiagnosticsRuntime,
  createHmiPopup,
  createHmiRuntimeSession,
  createHmiScreen,
  createHmiDataLogBuffer,
  createHmiTrendBuffer,
  deserializeHmiRuntimePackageArtifact,
  executeHmiRuntimeCommands,
  evaluateHmiAlarmRuntime,
  exportHmiContentBundle,
  exportHmiContentBundleFolder,
  exportHmiDataLogBufferCsv,
  exportHmiLanguagePackCsv,
  hmiDiagnosticsTableRows,
  hmiAlarmTableRows,
  HMI_ELEMENT_REGISTRY,
  HMI_SYSTEM_TAGS,
  hmiControllerReferenceBrowserRows,
  hmiControllerReferenceSyncSummary,
  hmiNavigationModel,
  hmiUsageCapacityReport,
  hmiVisualQaReport,
  importHmiLanguagePackCsv,
  importHmiContentBundle,
  importHmiContentBundleFolder,
  latestHmiTrendValues,
  previewHmiButtonControlRuntime,
  recordHmiDataLogSample,
  recordHmiDiagnosticEvent,
  recordHmiTrendSample,
  renderHmiTrendChartPreview,
  resetHmiAlarms,
  serializeHmiRuntimePackageArtifact,
  suppressHmiAlarms,
  syncHmiValidationDiagnostics,
  unsuppressHmiAlarms,
  verifyHmiRuntimePackageArtifact,
  validateHmiProject,
} from "./index";

describe("hmi model foundation", () => {
  it("creates an empty HMI project without demo screens", () => {
    const project = createDefaultHmiProject("Operator HMI");

    expect(project.name).toBe("Operator HMI");
    expect(project.screens).toHaveLength(0);
    expect(project.popups).toHaveLength(0);
    expect(project.systemBanner.name).toBe("System Banner");
    expect(project.controllerReferences).toEqual([]);
    expect(project.targetDevice.supportedFeatures).toContain("runtime-preview");
    expect(project.targetDevice.supportedFeatures).toContain("recipes");
    expect(project.recipes).toEqual([]);
  });

  it("validates HMI recipes and includes them in package/capacity summaries", () => {
    const project = createDefaultHmiProject("Recipe HMI");
    project.recipes.push({
      id: "recipe-startup",
      name: "Startup",
      securityRoleIds: [],
      items: [
        { id: "speed", tagPath: "Motor_Speed", value: 45, dataType: "REAL" },
        { id: "missing", tagPath: "Missing_Setpoint", value: 1, dataType: "DINT" },
      ],
    });

    const findings = validateHmiProject(project, { knownTagPaths: ["Motor_Speed"] });
    const capacity = hmiUsageCapacityReport(project);
    const packaged = buildHmiRuntimePackage(project, { validationContext: { knownTagPaths: ["Motor_Speed", "Missing_Setpoint"] } });

    expect(findings.some((finding) => finding.ruleId === "hmi-recipe-missing-tag")).toBe(true);
    expect(capacity.metrics.find((metric) => metric.key === "recipes")).toMatchObject({ used: 1, status: "ok" });
    expect(packaged.artifact?.summary.recipeCount).toBe(1);
  });

  it("registers the first HMI element slice", () => {
    expect(HMI_ELEMENT_REGISTRY.get("common.button")?.displayName).toBe("Button");
    expect(HMI_ELEMENT_REGISTRY.get("common.numeric-display")?.category).toBe("common");
    expect(HMI_ELEMENT_REGISTRY.get("common.hmi-button-control")?.runtimeSupport).toBe("model-only");
    expect(HMI_ELEMENT_REGISTRY.get("trends.trend-chart")?.runtimeSupport).toBe("runtime-preview");
    expect(HMI_ELEMENT_REGISTRY.get("alarms.alarm-summary")?.runtimeSupport).toBe("runtime-preview");
  });

  it("browses offline controller references and uses synchronized tags for HMI validation", () => {
    const project = createDefaultHmiProject();
    const screen = createHmiScreen("Overview");
    const display = createHmiElement("common.numeric-display");
    display.bindings.push({
      id: "binding_value",
      targetProperty: "value",
      source: { kind: "tag", path: "Program:Mix.SpeedSP", dataType: "REAL" },
      mode: "read",
    });
    screen.elements.push(display);
    project.screens.push(screen);
    project.homeScreenId = screen.id;
    project.controllerReferences.push({
      id: "controller_ref_1",
      name: "Line 1 Controller",
      controllerName: "CLX_01",
      sourceKind: "xml-review",
      sourcePath: "Line1.L5X",
      sourceProjectId: "project_1",
      sourceControllerId: "controller_1",
      sourceHash: "abc123",
      syncStatus: "synchronized",
      lastSyncedAt: "2026-05-30T12:00:00.000Z",
      snapshot: { controllerTagCount: 1, programTagCount: 1, dataTypeCount: 1, alarmCount: 1 },
      tags: [
        { path: "RunCmd", name: "RunCmd", dataType: "BOOL", scope: "controller" },
        { path: "Program:Mix.SpeedSP", name: "SpeedSP", dataType: "REAL", scope: "program", programName: "Mix" },
      ],
      dataTypes: [{ name: "MotorUDT", family: "udt", memberCount: 4 }],
      alarms: [{ name: "HighSpeed", tagPath: "HighSpeed", kind: "digital", dataType: "ALARM_DIGITAL", scope: "controller" }],
    });

    const findings = validateHmiProject(project);
    const rows = hmiControllerReferenceBrowserRows(project);
    const summary = hmiControllerReferenceSyncSummary(project);

    expect(findings.some((finding) => finding.ruleId === "hmi-binding-missing-tag")).toBe(false);
    expect(rows.map((row) => `${row.kind}:${row.path}`)).toEqual([
      "alarm:HighSpeed",
      "data-type:MotorUDT",
      "tag:Program:Mix.SpeedSP",
      "tag:RunCmd",
    ]);
    expect(summary).toMatchObject({
      total: 1,
      synchronized: 1,
      actionableCount: 0,
      tagCount: 2,
      dataTypeCount: 1,
      alarmCount: 1,
    });
  });

  it("validates controller-reference synchronization states and snapshot integrity", () => {
    const project = createDefaultHmiProject();
    project.controllerReferences.push(
      {
        id: "controller_ref_1",
        name: "Line 1 Controller",
        controllerName: "CLX_01",
        sourceKind: "plcproj",
        syncStatus: "stale",
        statusMessage: "Source L5X changed after import",
        snapshot: { controllerTagCount: 2, programTagCount: 0, dataTypeCount: 0, alarmCount: 0 },
        tags: [
          { path: "MotorRun", name: "MotorRun", dataType: "BOOL", scope: "controller" },
          { path: "MotorRun", name: "MotorRunCopy", dataType: "BOOL", scope: "controller" },
        ],
        dataTypes: [],
        alarms: [],
      },
      {
        id: "controller_ref_2",
        name: "Secured Controller",
        controllerName: "CLX_SECURED",
        sourceKind: "secured-offline-reference",
        syncStatus: "secured",
        secured: true,
        snapshot: { controllerTagCount: 0, programTagCount: 0, dataTypeCount: 0, alarmCount: 0 },
        tags: [],
        dataTypes: [],
        alarms: [],
      },
    );

    const ruleIds = validateHmiProject(project).map((finding) => finding.ruleId);

    expect(ruleIds).toContain("hmi-controller-reference-stale");
    expect(ruleIds).toContain("hmi-controller-reference-secured");
    expect(ruleIds).toContain("hmi-controller-reference-tag-path-duplicate");
  });

  it("preserves unknown elements as readonly unsupported content", () => {
    const element = createHmiElement("vendorx.custom-gauge", "Vendor Gauge", { raw: true });

    expect(element.unsupported?.originalType).toBe("vendorx.custom-gauge");
    expect(element.unsupported?.readonlyReason).toContain("not registered");
  });

  it("validates missing bindings and readonly unsupported elements", () => {
    const project = createDefaultHmiProject();
    const screen = createHmiScreen("Main");
    const element = createHmiElement("common.numeric-display");
    element.bindings.push({
      id: "bind_1",
      targetProperty: "value",
      source: { kind: "tag", path: "MissingTag", dataType: "DINT" },
      mode: "read",
    });
    screen.elements.push(element, createHmiElement("UNSUPPORTED_VENDOR_BLOCK"));
    project.screens.push(screen);
    project.homeScreenId = screen.id;

    const findings = validateHmiProject(project, { knownTagPaths: ["GoodTag"] });

    expect(findings.some((finding) => finding.ruleId === "hmi-binding-missing-tag")).toBe(true);
    expect(findings.some((finding) => finding.ruleId === "hmi-element-unsupported")).toBe(true);
  });

  it("validates model-only HMI Button Control tag configuration", () => {
    const project = createDefaultHmiProject();
    const screen = createHmiScreen("Main");
    const blankHmibc = createHmiElement("common.hmi-button-control");
    const missingHmibc = createHmiElement("common.hmi-button-control");
    missingHmibc.properties.controllerTagPath = "Motor.StartCommand";
    missingHmibc.properties.feedbackTagPath = "Motor.StartFeedback";
    missingHmibc.properties.statusTagPath = "Motor.StartStatus";
    missingHmibc.properties.visualFeedbackEnabled = "yes";
    screen.elements.push(blankHmibc, missingHmibc);
    project.screens.push(screen);
    project.homeScreenId = screen.id;

    const findings = validateHmiProject(project, {
      knownTagPaths: ["Motor.StartCommand"],
    });
    const ruleIds = findings.map((finding) => finding.ruleId);

    expect(ruleIds).toContain("hmi-element-model-only");
    expect(ruleIds).toContain("hmi-hmibc-controller-tag-required");
    expect(ruleIds).toContain("hmi-hmibc-missing-tag");
    expect(ruleIds).toContain("hmi-hmibc-visual-feedback-invalid");
    expect(findings.filter((finding) => finding.ruleId === "hmi-hmibc-missing-tag")).toHaveLength(2);
  });

  it("does not flag runtime-backed alarm summary and trend chart as model-only", () => {
    const project = createDefaultHmiProject();
    const screen = createHmiScreen("Main");
    screen.elements.push(createHmiElement("alarms.alarm-summary"), createHmiElement("trends.trend-chart"));
    project.screens.push(screen);
    project.homeScreenId = screen.id;

    const findings = validateHmiProject(project);
    const result = buildHmiRuntimePackage(project, {
      builtAt: "2026-06-03T12:00:00.000Z",
      validationContext: { knownTagPaths: [] },
    });

    expect(findings.some((finding) => finding.ruleId === "hmi-element-model-only")).toBe(false);
    expect(result.ok).toBe(true);
    expect(result.artifact?.summary.modelOnlyElementCount).toBe(0);
  });

  it("previews HMI Button Control command, feedback, and status state deterministically", () => {
    const hmibc = createHmiElement("common.hmi-button-control");
    hmibc.name = "Start Button";
    hmibc.properties.label = "Start";
    hmibc.properties.controllerTagPath = "Motor.StartCommand";
    hmibc.properties.feedbackTagPath = "Motor.StartFeedback";
    hmibc.properties.statusTagPath = "Motor.StartStatus";
    hmibc.properties.visualFeedbackEnabled = true;

    const idle = previewHmiButtonControlRuntime(hmibc, {
      timestampMs: 0,
      values: {
        "Motor.StartCommand": false,
        "Motor.StartFeedback": false,
        "Motor.StartStatus": "Ready",
      },
    });
    const mismatch = previewHmiButtonControlRuntime(hmibc, {
      timestampMs: 100,
      pressed: true,
      values: {
        "Motor.StartCommand": false,
        "Motor.StartFeedback": false,
        "Motor.StartStatus": "Ready",
      },
    });
    const feedbackActive = previewHmiButtonControlRuntime(hmibc, {
      timestampMs: 200,
      pressed: true,
      values: {
        "Motor.StartCommand": true,
        "Motor.StartFeedback": true,
        "Motor.StartStatus": "Running",
      },
    });
    const badQuality = previewHmiButtonControlRuntime(hmibc, {
      timestampMs: 300,
      values: {
        "Motor.StartCommand": Number.NaN,
        "Motor.StartFeedback": true,
        "Motor.StartStatus": null,
      },
    });
    const unconfigured = previewHmiButtonControlRuntime(createHmiElement("common.hmi-button-control"), {
      timestampMs: 400,
      values: {},
    });

    expect(idle).toMatchObject({
      label: "Start",
      state: "idle",
      active: false,
      visualFeedbackEnabled: true,
    });
    expect(mismatch).toMatchObject({
      state: "mismatch",
      active: true,
      pressed: true,
      command: { tagPath: "Motor.StartCommand", active: true, quality: "good" },
    });
    expect(feedbackActive).toMatchObject({
      state: "feedback-active",
      feedback: { active: true, value: true, quality: "good" },
      status: { active: true, value: "Running", quality: "good" },
    });
    expect(badQuality).toMatchObject({
      state: "bad-quality",
      command: { value: null, quality: "bad", active: false },
      status: { value: null, quality: "bad" },
    });
    expect(unconfigured.state).toBe("unconfigured");
    expect(unconfigured.message).toContain("controller tag path");
  });

  it("validates HMI binding targets, system tags, trends, and data logs", () => {
    const project = createDefaultHmiProject();
    const screen = createHmiScreen("Main");
    const nav = createHmiElement("navigation.menu");
    nav.bindings.push(
      {
        id: "bind_unknown_target",
        targetProperty: "unknownProperty",
        source: { kind: "system-tag", path: "System.DateTime" },
        mode: "read",
      },
      {
        id: "bind_nonbindable",
        targetProperty: "homeScreenId",
        source: { kind: "tag", path: "ScreenSelector" },
        mode: "read",
      },
    );

    const display = createHmiElement("common.text-display");
    display.bindings.push({
      id: "bind_missing_system_tag",
      targetProperty: "text",
      source: { kind: "system-tag", path: "System.Unknown" },
      mode: "read",
    });

    const button = createHmiElement("common.button");
    button.bindings.push({
      id: "bind_bad_type",
      targetProperty: "enabled",
      source: { kind: "tag", path: "Speed", dataType: "DINT" },
      mode: "read",
    });
    button.events.push({
      id: "event_press",
      eventType: "press",
      commands: [
        { id: "cmd_bad_tag", type: "set-tag-value", safety: "runtime-preview", args: { tagPath: "MissingCmdTag", value: true } },
        { id: "cmd_bad_recipe", type: "apply-recipe", safety: "runtime-preview", args: { recipeId: "missing_recipe" } },
      ],
    });

    screen.elements.push(nav, display, button);
    project.screens.push(screen);
    project.homeScreenId = screen.id;
    project.trends.push({
      id: "trend_main",
      name: "Main Trend",
      timeRangeSeconds: 300,
      sampleRateMs: 1000,
      traces: [{ id: "trace_speed", label: "Speed", source: { kind: "tag", path: "MissingSpeed" }, color: "#2563eb" }],
    });
    project.dataLogs.push({
      id: "log_main",
      name: "Main Log",
      sampleRateMs: 1000,
      retentionHours: 24,
      tagPaths: ["GoodTag", "MissingLogTag"],
      statusTagPath: "MissingStatus",
    });

    const findings = validateHmiProject(project, {
      knownTagPaths: ["GoodTag", "ScreenSelector", "Speed"],
      knownSystemTags: ["System.DateTime"],
    });

    const ruleIds = findings.map((finding) => finding.ruleId);
    expect(ruleIds).toContain("hmi-binding-invalid-target");
    expect(ruleIds).toContain("hmi-binding-nonbindable-target");
    expect(ruleIds).toContain("hmi-binding-missing-system-tag");
    expect(ruleIds).toContain("hmi-binding-type-mismatch");
    expect(ruleIds).toContain("hmi-event-missing-tag");
    expect(ruleIds).toContain("hmi-event-missing-recipe");
    expect(ruleIds).toContain("hmi-trend-trace-missing-tag");
    expect(ruleIds).toContain("hmi-data-log-missing-tag");
    expect(ruleIds).toContain("hmi-data-log-missing-status-tag");
    expect(findings.some((finding) => finding.message.includes("System.DateTime"))).toBe(false);
  });

  it("flags duplicate and blank trend and data-log identity plus incomplete traces", () => {
    const project = createDefaultHmiProject();
    project.trends.push(
      {
        id: "trend_dup",
        name: "Shared Trend",
        timeRangeSeconds: 300,
        sampleRateMs: 1000,
        traces: [
          { id: "trace_a", label: "Speed", source: { kind: "tag", path: "Speed" }, color: "#2563eb" },
          { id: "trace_a", label: "", source: { kind: "tag", path: "Torque" }, color: "" },
        ],
      },
      {
        id: "trend_dup",
        name: "Shared Trend",
        timeRangeSeconds: 300,
        sampleRateMs: 1000,
        traces: [{ id: "trace_b", label: "Flow", source: { kind: "tag", path: "Flow" }, color: "#16a34a" }],
      },
    );
    project.dataLogs.push(
      { id: "", name: "", sampleRateMs: 1000, retentionHours: 24, tagPaths: ["Speed"] },
      { id: "log_dup", name: "Audit Log", sampleRateMs: 1000, retentionHours: 24, tagPaths: ["Speed"] },
      { id: "log_dup", name: "Audit Log", sampleRateMs: 1000, retentionHours: 24, tagPaths: ["Speed"] },
    );

    const ruleIds = validateHmiProject(project, {
      knownTagPaths: ["Speed", "Torque", "Flow"],
    }).map((finding) => finding.ruleId);

    expect(ruleIds).toContain("hmi-trend-id-duplicate");
    expect(ruleIds).toContain("hmi-trend-name-duplicate");
    expect(ruleIds).toContain("hmi-trend-trace-id-duplicate");
    expect(ruleIds).toContain("hmi-trend-trace-label-required");
    expect(ruleIds).toContain("hmi-trend-trace-color-required");
    expect(ruleIds).toContain("hmi-data-log-id-required");
    expect(ruleIds).toContain("hmi-data-log-name-required");
    expect(ruleIds).toContain("hmi-data-log-id-duplicate");
    expect(ruleIds).toContain("hmi-data-log-name-duplicate");
  });

  it("buffers, clears, and exports HMI data-log runtime samples", () => {
    const log = {
      id: "log_main",
      name: "Main Log",
      sampleRateMs: 1000,
      retentionHours: 2 / 3600,
      tagPaths: ["Motor.Speed", "Motor.Running", "Motor.Status"],
    };

    const empty = createHmiDataLogBuffer(log);
    const first = recordHmiDataLogSample(empty, {
      timestampMs: 0,
      values: { "Motor.Speed": 12.5, "Motor.Running": true },
    });
    const skipped = recordHmiDataLogSample(first.buffer, {
      timestampMs: 500,
      values: { "Motor.Speed": 13 },
    });
    const second = recordHmiDataLogSample(skipped.buffer, {
      timestampMs: 1000,
      values: { "Motor.Speed": Number.NaN, "Motor.Running": false, "Motor.Status": "Ready" },
    });
    const third = recordHmiDataLogSample(second.buffer, {
      timestampMs: 2500,
      values: { "Motor.Speed": 20, "Motor.Running": true, "Motor.Status": "Run, Auto" },
    });
    const csv = exportHmiDataLogBufferCsv(third.buffer, "main-log.csv");
    const cleared = clearHmiDataLogBuffer(third.buffer);

    expect(first.accepted).toBe(true);
    expect(first.buffer.rows[0]?.values["Motor.Status"]?.quality).toBe("missing");
    expect(skipped.accepted).toBe(false);
    expect(skipped.buffer.status).toBe("skipped");
    expect(second.buffer.rows[1]?.values["Motor.Speed"]?.quality).toBe("bad");
    expect(third.buffer.rows.map((row) => row.timestampMs)).toEqual([1000, 2500]);
    expect(third.buffer.rows[1]?.values["Motor.Status"]?.value).toBe("Run, Auto");
    expect(third.buffer.status).toBe("recording");
    expect(csv.fileName).toBe("main-log.csv");
    expect(csv.rowCount).toBe(2);
    expect(csv.text).toContain("Motor.Speed__quality");
    expect(csv.text).toContain('"Run, Auto"');
    expect(cleared.rows).toHaveLength(0);
    expect(cleared.status).toBe("cleared");
    expect(cleared.lastSampleTimestampMs).toBeUndefined();
  });

  it("builds offline HMI data-log removable-media save previews", () => {
    const log = {
      id: "log_media",
      name: "Media Log",
      sampleRateMs: 1000,
      retentionHours: 1,
      tagPaths: ["Motor.Speed"],
    };
    const recorded = recordHmiDataLogSample(createHmiDataLogBuffer(log), {
      timestampMs: 1000,
      values: { "Motor.Speed": 42 },
    });
    const csv = exportHmiDataLogBufferCsv(recorded.buffer, "media log.csv");
    const saved = buildHmiDataLogMediaSave(csv, {
      target: {
        kind: "usb",
        label: "USB 1",
        rootPath: "E:\\",
        mounted: true,
        availableBytes: 4096,
      },
      directory: "Logs/Shift A",
      savedAt: "2026-05-30T12:00:00.000Z",
    });
    const fullTarget = buildHmiDataLogMediaSave(csv, {
      target: { kind: "sd-card", label: "SD Card", rootPath: "F:", mounted: true, availableBytes: 1 },
    });
    const unmounted = buildHmiDataLogMediaSave(csv, {
      target: { kind: "usb", label: "USB 2", rootPath: "G:", mounted: false },
    });

    expect(saved.ok).toBe(true);
    expect(saved.status).toBe("saved");
    expect(saved.file).toMatchObject({
      fileName: "media-log.csv",
      path: "E:/Logs/Shift-A/media-log.csv",
      rowCount: 1,
      mediaKind: "usb",
      mediaLabel: "USB 1",
      savedAt: "2026-05-30T12:00:00.000Z",
      checksumAlgorithm: "fnv1a32-text",
    });
    expect(saved.file?.byteLength).toBeGreaterThan(0);
    expect(saved.file?.contentChecksum).toMatch(/^[0-9a-f]{8}$/);
    expect(saved.message).toContain("offline preview");
    expect(fullTarget).toMatchObject({ ok: false, status: "blocked" });
    expect(fullTarget.message).toContain("enough free space");
    expect(unmounted).toMatchObject({ ok: false, status: "blocked" });
    expect(unmounted.message).toContain("not mounted");
  });

  it("executes HMI runtime-preview navigation, popup, language, and data-log commands", () => {
    const project = createDefaultHmiProject("Line HMI");
    const main = createHmiScreen("Main");
    main.id = "screen_main";
    const detail = createHmiScreen("Detail");
    detail.id = "screen_detail";
    const popup = createHmiPopup("Motor Faceplate");
    popup.id = "popup_motor";
    project.screens.push(main, detail);
    project.popups.push(popup);
    project.homeScreenId = main.id;
    project.languagePacks.push({
      id: "lang_fr",
      languageId: "fr-FR",
      displayName: "French",
      strings: {},
      missingStringIds: [],
    });
    project.dataLogs.push({
      id: "log_batch",
      name: "Batch Log",
      sampleRateMs: 1000,
      retentionHours: 24,
      tagPaths: ["Batch.Count"],
    });
    project.recipes.push({
      id: "recipe_startup",
      name: "Startup",
      securityRoleIds: [],
      items: [{ id: "item_speed", tagPath: "Motor.Speed", value: 50, dataType: "REAL" }],
    });

    const initial = createHmiRuntimeSession(project);
    const final = executeHmiRuntimeCommands(project, initial, [
      { id: "cmd_nav", type: "navigate", safety: "runtime-preview", args: { screenId: detail.id } },
      { id: "cmd_popup", type: "open-popup", safety: "runtime-preview", args: { popupId: popup.id } },
      { id: "cmd_language", type: "change-language", safety: "runtime-preview", args: { languageId: "fr-FR" } },
      { id: "cmd_write", type: "set-tag-value", safety: "runtime-preview", args: { tagPath: "Motor.Start", value: true } },
      { id: "cmd_export", type: "export-data-log", safety: "runtime-preview", args: { dataLogId: "log_batch" } },
      { id: "cmd_recipe", type: "apply-recipe", safety: "runtime-preview", args: { recipeId: "recipe_startup" } },
      { id: "cmd_close", type: "close-popup", safety: "runtime-preview", args: {} },
      { id: "cmd_missing", type: "navigate", safety: "runtime-preview", args: { screenId: "missing_screen" } },
      { id: "cmd_device", type: "device-command", safety: "hardware-only", args: { command: "restart" } },
    ]);

    expect(initial.currentScreenId).toBe(main.id);
    expect(final.currentScreenId).toBe(detail.id);
    expect(final.previousScreenId).toBe(main.id);
    expect(final.currentLanguage).toBe("fr-FR");
    expect(final.popupStack).toEqual([]);
    expect(final.blockedCommandCount).toBe(2);
    expect(final.systemTags).toMatchObject({
      "System.CurrentScreen": "Detail",
      "System.PreviousScreen": "Main",
      "System.CurrentLanguage": "fr-FR",
      "System.ProjectName": "Line HMI",
    });
    expect(final.commandLog.map((entry) => entry.status)).toEqual([
      "applied",
      "applied",
      "applied",
      "applied",
      "applied",
      "applied",
      "applied",
      "blocked",
      "blocked",
    ]);
    expect(final.commandLog.find((entry) => entry.commandId === "cmd_write")?.effect).toEqual({
      kind: "tag-write-preview",
      tagPath: "Motor.Start",
      value: true,
    });
    expect(final.commandLog.find((entry) => entry.commandId === "cmd_export")?.effect).toEqual({
      kind: "data-log-export",
      dataLogId: "log_batch",
    });
    expect(final.commandLog.find((entry) => entry.commandId === "cmd_recipe")?.effect).toEqual({
      kind: "apply-recipe",
      recipeId: "recipe_startup",
    });
  });

  it("evaluates and operates an HMI alarm runtime preview", () => {
    const definitions = [
      {
        id: "alarm_high_temp",
        name: "High Temp",
        tagPath: "Tank.Temp",
        severity: "major",
        trigger: { kind: "analog-high", threshold: 100, deadband: 5 },
        message: "Tank temperature is high",
        area: "Tank Farm",
        allowAcknowledge: true,
      },
      {
        id: "alarm_pump_stopped",
        name: "Pump Stopped",
        tagPath: "Pump.Running",
        severity: "warning",
        trigger: { kind: "digital", activeValue: false },
        allowAcknowledge: false,
      },
    ] as const;

    const empty = createHmiAlarmRuntime(definitions);
    const normal = evaluateHmiAlarmRuntime(empty, definitions, {
      timestampMs: 0,
      values: { "Tank.Temp": 90, "Pump.Running": true },
    });
    const active = evaluateHmiAlarmRuntime(normal, definitions, {
      timestampMs: 1000,
      values: { "Tank.Temp": 101, "Pump.Running": false },
    });
    const acknowledged = acknowledgeHmiAlarms(active, { timestampMs: 1500 });
    const suppressed = suppressHmiAlarms(acknowledged, { timestampMs: 2000, alarmIds: ["alarm_high_temp"] });
    const unsuppressed = unsuppressHmiAlarms(suppressed, { timestampMs: 2500, alarmIds: ["alarm_high_temp"] });
    const badQuality = evaluateHmiAlarmRuntime(unsuppressed, definitions, {
      timestampMs: 3000,
      values: { "Tank.Temp": Number.NaN, "Pump.Running": false },
    });
    const returned = evaluateHmiAlarmRuntime(badQuality, definitions, {
      timestampMs: 4000,
      values: { "Tank.Temp": 94, "Pump.Running": true },
    });

    expect(empty.summary.badQualityCount).toBe(2);
    expect(normal.summary.activeCount).toBe(0);
    expect(normal.summary.badQualityCount).toBe(0);
    expect(active.summary.activeCount).toBe(2);
    expect(active.summary.systemTags["System.AlarmUnacknowledgedCount"]).toBe(2);
    expect(acknowledged.alarms.find((alarm) => alarm.alarmId === "alarm_high_temp")?.state).toBe("active-acknowledged");
    expect(acknowledged.alarms.find((alarm) => alarm.alarmId === "alarm_pump_stopped")?.state).toBe("active-unacknowledged");
    expect(suppressed.summary.activeCount).toBe(1);
    expect(suppressed.summary.suppressedCount).toBe(1);
    expect(unsuppressed.alarms.find((alarm) => alarm.alarmId === "alarm_high_temp")?.state).toBe("active-acknowledged");
    expect(badQuality.alarms.find((alarm) => alarm.alarmId === "alarm_high_temp")?.quality).toBe("bad");
    expect(badQuality.alarms.find((alarm) => alarm.alarmId === "alarm_high_temp")?.active).toBe(true);
    expect(returned.alarms.find((alarm) => alarm.alarmId === "alarm_high_temp")?.state).toBe("normal");
    expect(returned.alarms.find((alarm) => alarm.alarmId === "alarm_pump_stopped")?.state).toBe("returned-unacknowledged");
    expect(returned.history.map((event) => event.eventType)).toEqual([
      "quality-changed",
      "quality-changed",
      "activated",
      "activated",
      "acknowledged",
      "suppressed",
      "unsuppressed",
      "quality-changed",
      "quality-changed",
      "returned",
      "returned",
    ]);

    const summaryRows = hmiAlarmTableRows(returned);
    const managerRows = hmiAlarmTableRows(returned, "manager");
    const historyRows = hmiAlarmTableRows(returned, "history");
    const latestReturnedRows = historyRows.filter((row) => row.timestampMs === 4000);

    expect(summaryRows.map((row) => row.alarmId)).toEqual(["alarm_pump_stopped"]);
    expect(summaryRows[0]).toMatchObject({
      name: "Pump Stopped",
      state: "returned-unacknowledged",
      active: false,
      acknowledged: false,
      allowAcknowledge: false,
    });
    expect(managerRows).toHaveLength(2);
    expect(managerRows.find((row) => row.alarmId === "alarm_high_temp")).toMatchObject({
      name: "High Temp",
      state: "normal",
      area: "Tank Farm",
      acknowledged: true,
      timestampMs: 4000,
    });
    expect(historyRows).toHaveLength(returned.history.length);
    expect(historyRows[0]?.timestampMs).toBe(4000);
    expect(latestReturnedRows.map((row) => row.eventType)).toEqual([
      "quality-changed",
      "returned",
      "returned",
    ]);
    expect(latestReturnedRows.some((row) => row.name === "High Temp" && row.tagPath === "Tank.Temp")).toBe(true);

    const reset = resetHmiAlarms(returned, { timestampMs: 4500, alarmIds: ["alarm_pump_stopped"] });
    expect(reset.alarms.find((alarm) => alarm.alarmId === "alarm_pump_stopped")).toMatchObject({
      state: "normal",
      active: false,
      acknowledged: true,
      resetTimestampMs: 4500,
    });
    expect(reset.summary.unacknowledgedCount).toBe(0);
    expect(hmiAlarmTableRows(reset)).toHaveLength(0);
    expect(hmiAlarmTableRows(reset, "history")[0]).toMatchObject({
      alarmId: "alarm_pump_stopped",
      eventType: "reset",
      state: "normal",
      timestampMs: 4500,
    });
  });

  it("streams HMI automatic diagnostics into live and history table rows", () => {
    const empty = createHmiDiagnosticsRuntime({ maxHistory: 5 });
    const validation = syncHmiValidationDiagnostics(
      empty,
      [
        {
          ruleId: "hmi-binding-missing-tag",
          severity: "error",
          message: 'Binding references missing tag "Motor.Speed".',
          target: "hmi/screen:main/element:speed",
        },
      ],
      100,
    );
    const runtime = recordHmiDiagnosticEvent(validation, {
      timestampMs: 200,
      source: "runtime",
      severity: "warning",
      code: "hmi-trend-flatline",
      message: "Trend trace has not changed.",
      target: "hmi/trend:trend_main",
    });
    const repeated = recordHmiDiagnosticEvent(runtime, {
      timestampMs: 300,
      source: "runtime",
      severity: "warning",
      code: "hmi-trend-flatline",
      message: "Trend trace has not changed.",
      target: "hmi/trend:trend_main",
    });
    const runtimeDiagnosticId = repeated.active.find((event) => event.code === "hmi-trend-flatline")!.id;
    const clearedRuntime = clearHmiDiagnosticEvents(repeated, {
      timestampMs: 400,
      ids: [runtimeDiagnosticId],
    });
    const resolved = syncHmiValidationDiagnostics(clearedRuntime, [], 500);
    const liveRows = hmiDiagnosticsTableRows(resolved);
    const historyRows = hmiDiagnosticsTableRows(resolved, "history");

    expect(validation.summary.activeErrorCount).toBe(1);
    expect(repeated.summary.activeCount).toBe(2);
    expect(repeated.summary.sourceCounts.validation).toBe(1);
    expect(repeated.summary.sourceCounts.runtime).toBe(1);
    expect(repeated.active.find((event) => event.id === runtimeDiagnosticId)?.occurrences).toBe(2);
    expect(clearedRuntime.summary.activeCount).toBe(1);
    expect(resolved.summary.activeCount).toBe(0);
    expect(liveRows).toEqual([]);
    expect(historyRows).toHaveLength(5);
    expect(historyRows[0]).toMatchObject({
      status: "cleared",
      code: "hmi-binding-missing-tag",
      timestampMs: 500,
    });
    expect(historyRows[1]).toMatchObject({
      status: "cleared",
      code: "hmi-trend-flatline",
      timestampMs: 400,
      occurrences: 2,
    });
    expect(historyRows.some((row) => row.message.includes("Motor.Speed"))).toBe(true);
  });

  it("buffers HMI trend runtime samples with sample-rate and time-window semantics", () => {
    const trend = {
      id: "trend_main",
      name: "Main Trend",
      sampleRateMs: 1000,
      timeRangeSeconds: 2,
      traces: [
        { id: "trace_speed", label: "Speed", source: { kind: "tag" as const, path: "Motor.Speed", dataType: "REAL" }, color: "#2563eb" },
        { id: "trace_running", label: "Running", source: { kind: "tag" as const, path: "Motor.Running", dataType: "BOOL" }, color: "#16a34a" },
        { id: "trace_faults", label: "Faults", source: { kind: "tag" as const, path: "Motor.Faults", dataType: "DINT" }, color: "#dc2626" },
      ],
    };

    const empty = createHmiTrendBuffer(trend);
    const first = recordHmiTrendSample(empty, {
      timestampMs: 0,
      values: { "Motor.Speed": 12.5, "Motor.Running": true, trace_faults: Number.NaN },
    });
    const skipped = recordHmiTrendSample(first.buffer, {
      timestampMs: 500,
      values: { "Motor.Speed": 13 },
    });
    const second = recordHmiTrendSample(skipped.buffer, {
      timestampMs: 1500,
      values: { "Motor.Speed": 15, "Motor.Running": false },
    });
    const third = recordHmiTrendSample(second.buffer, {
      timestampMs: 3500,
      values: { "Motor.Speed": 20, "Motor.Running": true, "Motor.Faults": 2 },
    });

    expect(first.accepted).toBe(true);
    expect(skipped.accepted).toBe(false);
    expect(skipped.skippedReason).toContain("sample rate");
    expect(second.accepted).toBe(true);
    expect(third.accepted).toBe(true);

    const speedTrace = third.buffer.traces.find((trace) => trace.id === "trace_speed")!;
    const runningTrace = third.buffer.traces.find((trace) => trace.id === "trace_running")!;
    const faultsTrace = third.buffer.traces.find((trace) => trace.id === "trace_faults")!;
    const latest = latestHmiTrendValues(third.buffer);

    expect(speedTrace.points.map((point) => point.timestampMs)).toEqual([1500, 3500]);
    expect(speedTrace.points.map((point) => point.value)).toEqual([15, 20]);
    expect(runningTrace.points.at(-1)?.value).toBe(1);
    expect(faultsTrace.points[0]?.quality).toBe("missing");
    expect(faultsTrace.points.at(-1)?.value).toBe(2);
    expect(latest.trace_speed?.value).toBe(20);
    expect(latest.trace_running?.quality).toBe("good");
  });

  it("renders deterministic HMI trend chart preview geometry from buffered samples", () => {
    const trend = {
      id: "trend_chart",
      name: "Chart Preview",
      sampleRateMs: 1000,
      timeRangeSeconds: 2,
      traces: [
        { id: "trace_speed", label: "Speed", source: { kind: "tag" as const, path: "Motor.Speed", dataType: "REAL" }, color: "#2563eb" },
        { id: "trace_faults", label: "Faults", source: { kind: "tag" as const, path: "Motor.Faults", dataType: "DINT" }, color: "#dc2626" },
      ],
    };

    const first = recordHmiTrendSample(createHmiTrendBuffer(trend), {
      timestampMs: 0,
      values: { "Motor.Speed": 10, "Motor.Faults": 0 },
    });
    const second = recordHmiTrendSample(first.buffer, {
      timestampMs: 1000,
      values: { "Motor.Speed": 20, "Motor.Faults": null },
    });
    const third = recordHmiTrendSample(second.buffer, {
      timestampMs: 2000,
      values: { "Motor.Speed": 30, "Motor.Faults": 2 },
    });

    const preview = renderHmiTrendChartPreview(third.buffer, {
      width: 400,
      height: 240,
      nowTimestampMs: 2000,
      valueMin: 0,
      valueMax: 30,
    });
    const speed = preview.series.find((series) => series.traceId === "trace_speed")!;
    const faults = preview.series.find((series) => series.traceId === "trace_faults")!;

    expect(preview.plotArea).toEqual({ x: 48, y: 16, width: 336, height: 192 });
    expect(preview.timeAxis.startTimestampMs).toBe(0);
    expect(preview.timeAxis.endTimestampMs).toBe(2000);
    expect(preview.timeAxis.ticks.map((tick) => tick.position)).toEqual([48, 216, 384]);
    expect(preview.valueAxis).toMatchObject({ min: 0, max: 30 });
    expect(speed.points.map((point) => [point.x, point.y])).toEqual([
      [48, 144],
      [216, 80],
      [384, 16],
    ]);
    expect(speed.path).toBe("M 48 144 L 216 80 L 384 16");
    expect(faults.points[1]).toMatchObject({ value: null, quality: "bad", y: null });
    expect(faults.path).toBe("M 48 208 M 384 195.2");
  });

  it("verifies system-tag bindings against the built-in registry by default", () => {
    const project = createDefaultHmiProject();
    const screen = createHmiScreen("Main");
    const display = createHmiElement("common.text-display");
    display.bindings.push(
      {
        id: "bind_known_system_tag",
        targetProperty: "text",
        source: { kind: "system-tag", path: HMI_SYSTEM_TAGS[0]!.path },
        mode: "read",
      },
      {
        id: "bind_unknown_system_tag",
        targetProperty: "visible",
        source: { kind: "system-tag", path: "System.NotARealSystemTag" },
        mode: "read",
      },
    );
    screen.elements.push(display);
    project.screens.push(screen);
    project.homeScreenId = screen.id;

    // No knownSystemTags supplied — the validator must fall back to the registry.
    const findings = validateHmiProject(project, { knownTagPaths: [] });

    const systemTagFindings = findings.filter(
      (finding) => finding.ruleId === "hmi-binding-missing-system-tag",
    );
    expect(systemTagFindings).toHaveLength(1);
    expect(systemTagFindings[0]!.message).toContain("System.NotARealSystemTag");
  });

  it("flags a system-tag binding type mismatch using the registry data type", () => {
    const project = createDefaultHmiProject();
    const screen = createHmiScreen("Main");
    const display = createHmiElement("common.text-display");
    const dateTimeTag = HMI_SYSTEM_TAGS.find((tag) => tag.dataType === "STRING")!;
    // Source carries only the path (no dataType); the validator must fall back
    // to the registry's STRING type and notice it cannot drive a boolean.
    display.bindings.push({
      id: "bind_string_system_tag_to_boolean",
      targetProperty: "visible",
      source: { kind: "system-tag", path: dateTimeTag.path },
      mode: "read",
    });
    screen.elements.push(display);
    project.screens.push(screen);
    project.homeScreenId = screen.id;

    const findings = validateHmiProject(project, { knownTagPaths: [] });
    const mismatch = findings.filter((finding) => finding.ruleId === "hmi-binding-type-mismatch");

    expect(mismatch).toHaveLength(1);
    expect(mismatch[0]!.message).toContain(dateTimeTag.dataType);
    expect(findings.some((finding) => finding.ruleId === "hmi-binding-missing-system-tag")).toBe(false);
  });

  it("detects circular property-to-property bindings inside an element", () => {
    const project = createDefaultHmiProject();
    const screen = createHmiScreen("Main");
    const button = createHmiElement("common.button");
    button.bindings.push(
      {
        id: "bind_enabled_to_label",
        targetProperty: "enabled",
        source: { kind: "property", path: "this.label", dataType: "STRING" },
        mode: "read",
      },
      {
        id: "bind_label_to_enabled",
        targetProperty: "label",
        source: { kind: "property", path: `${button.id}.enabled`, dataType: "BOOL" },
        mode: "read",
      },
    );
    screen.elements.push(button);
    project.screens.push(screen);
    project.homeScreenId = screen.id;

    const findings = validateHmiProject(project);

    expect(findings.filter((finding) => finding.ruleId === "hmi-binding-circular-property")).toHaveLength(2);
  });

  it("validates default language and missing translation metadata", () => {
    const project = createDefaultHmiProject();
    project.defaultLanguage = "fr-FR";
    project.languagePacks.push(
      {
        id: "lang_duplicate",
        languageId: "en-US",
        displayName: "English Duplicate",
        strings: {},
        missingStringIds: ["screen.main.title"],
      },
      {
        id: "lang_blank",
        languageId: " ",
        displayName: " ",
        strings: {},
        missingStringIds: [],
      },
    );

    const findings = validateHmiProject(project);
    const ruleIds = findings.map((finding) => finding.ruleId);

    expect(ruleIds).toContain("hmi-default-language-missing");
    expect(ruleIds).toContain("hmi-language-id-duplicate");
    expect(ruleIds).toContain("hmi-language-id-required");
    expect(ruleIds).toContain("hmi-language-name-required");
    expect(ruleIds).toContain("hmi-language-missing-strings");
  });

  it("exports and imports HMI language CSV files with metadata", () => {
    const project = createDefaultHmiProject();
    const language = project.languagePacks[0]!;
    language.strings = {
      "alarm.active": "Active alarm",
      "screen.main.title": "Main, Overview",
      "screen.main.subtitle": 'Pump "A"',
    };
    language.missingStringIds = ["screen.main.footer"];

    const exported = exportHmiLanguagePackCsv(language, {
      fileName: "en-US.hmi-language.csv",
      exportedAt: "2026-05-30T12:00:00.000Z",
    });
    const imported = importHmiLanguagePackCsv(exported.text, {
      id: "lang_imported_en",
      sourceFileName: exported.fileName,
      importedAt: "2026-05-30T12:05:00.000Z",
    });
    const reexported = exportHmiLanguagePackCsv(imported.languagePack!, { fileName: exported.fileName });

    expect(exported.fileName).toBe("en-US.hmi-language.csv");
    expect(exported.text).toContain('"Main, Overview"');
    expect(exported.text).toContain('"Pump ""A"""');
    expect(exported.metadata.stringCount).toBe(4);
    expect(exported.metadata.missingStringCount).toBe(1);
    expect(exported.metadata.contentChecksum).toMatch(/^[0-9a-f]{8}$/);
    expect(imported.ok).toBe(true);
    expect(imported.errors).toEqual([]);
    expect(imported.languagePack?.id).toBe("lang_imported_en");
    expect(imported.languagePack?.languageId).toBe("en-US");
    expect(imported.languagePack?.strings["screen.main.title"]).toBe("Main, Overview");
    expect(imported.languagePack?.strings["screen.main.subtitle"]).toBe('Pump "A"');
    expect(imported.languagePack?.missingStringIds).toEqual(["screen.main.footer"]);
    expect(imported.languagePack?.importExport?.sourceFileName).toBe("en-US.hmi-language.csv");
    expect(imported.languagePack?.importExport?.contentChecksum).toBe(exported.metadata.contentChecksum);
    expect(reexported.metadata.contentChecksum).toBe(exported.metadata.contentChecksum);
  });

  it("exports and imports deterministic HMI content bundles with checksums", () => {
    const project = createDefaultHmiProject("Packaging HMI");
    const screen = createHmiScreen("Main");
    const popup = createHmiPopup("Motor Popup");
    const button = createHmiElement("common.button");
    screen.elements.push(button);
    project.screens.push(screen);
    project.popups.push(popup);
    project.assets.push({ id: "asset_logo", name: "Logo", kind: "image", references: [screen.id], bytes: 128 });
    project.addOnGraphics.push({
      id: "aog_motor",
      name: "Motor Faceplate",
      width: 320,
      height: 220,
      properties: [{ name: "TagBase", dataType: "tag-path", required: true }],
      elements: [],
    });
    project.unsupportedContent.push({
      id: "vendor_widget",
      sourcePath: "screens/Main/VendorWidget",
      kind: "vendor-widget",
      displayName: "Vendor Widget",
      readonlyReason: "Unknown vendor content.",
    });

    const exported = exportHmiContentBundle(project, { exportedAt: "2026-05-30T12:00:00.000Z" });
    const imported = importHmiContentBundle(exported.files);
    const repeat = exportHmiContentBundle(project, { exportedAt: "2026-05-30T12:00:00.000Z" });
    const tampered = importHmiContentBundle(
      exported.files.map((entry) =>
        entry.path === `screens/${screen.id}.json`
          ? { ...entry, text: entry.text.replace('"name": "Main"', '"name": "Changed"') }
          : entry,
      ),
    );

    expect(exported.manifest.summary).toMatchObject({
      screenCount: 1,
      popupCount: 1,
      addOnGraphicCount: 1,
      assetCount: 1,
      unsupportedContentCount: 1,
    });
    expect(exported.files.map((entry) => entry.path)).toEqual([
      "manifest.json",
      `screens/${screen.id}.json`,
      `popups/${popup.id}.json`,
      "add-on-graphics/aog_motor.json",
      "assets/manifest.json",
      "unsupported/manifest.json",
    ]);
    expect(exported.files.every((entry) => entry.contentChecksum.match(/^[0-9a-f]{8}$/))).toBe(true);
    expect(repeat.files.map((entry) => entry.contentChecksum)).toEqual(exported.files.map((entry) => entry.contentChecksum));
    expect(imported.ok).toBe(true);
    expect(imported.errors).toEqual([]);
    expect(imported.content.screens[0]?.name).toBe("Main");
    expect(imported.content.screens[0]?.elements[0]?.typeId).toBe("common.button");
    expect(imported.content.popups[0]?.name).toBe("Motor Popup");
    expect(imported.content.addOnGraphics[0]?.properties[0]?.name).toBe("TagBase");
    expect(imported.content.assets[0]?.id).toBe("asset_logo");
    expect(imported.content.unsupportedContent[0]?.id).toBe("vendor_widget");
    expect(tampered.ok).toBe(false);
    expect(tampered.errors.some((error) => error.includes("checksum mismatch"))).toBe(true);
  });

  it("imports HMI content folders from path and text entries", () => {
    const project = createDefaultHmiProject("Folder HMI");
    const screen = createHmiScreen("Main");
    const popup = createHmiPopup("Details");
    screen.elements.push(createHmiElement("common.text-display"));
    project.screens.push(screen);
    project.popups.push(popup);
    project.addOnGraphics.push({
      id: "aog_motor",
      name: "Motor Faceplate",
      width: 320,
      height: 180,
      properties: [{ name: "TagBase", dataType: "tag-path" }],
      elements: [],
    });

    const exported = exportHmiContentBundleFolder(project, { exportedAt: "2026-05-30T12:00:00.000Z" });
    const imported = importHmiContentBundleFolder(
      exported.entries.map((entry) =>
        entry.path === `screens/${screen.id}.json`
          ? { ...entry, path: `./screens\\${screen.id}.json` }
          : entry,
      ),
    );
    const tampered = importHmiContentBundleFolder(
      exported.entries.map((entry) =>
        entry.path === `popups/${popup.id}.json`
          ? { ...entry, text: entry.text.replace('"name": "Details"', '"name": "Tampered"') }
          : entry,
      ),
    );
    const withExtra = importHmiContentBundleFolder([
      ...exported.entries,
      { path: "screens/orphan.json", text: "{}\n" },
    ]);

    expect(exported.entries.map((entry) => entry.path)).toContain("manifest.json");
    expect(exported.entries.some((entry) => "contentChecksum" in entry)).toBe(false);
    expect(imported.ok).toBe(true);
    expect(imported.content.screens[0]?.name).toBe("Main");
    expect(imported.content.popups[0]?.name).toBe("Details");
    expect(imported.content.addOnGraphics[0]?.id).toBe("aog_motor");
    expect(tampered.ok).toBe(false);
    expect(tampered.errors.some((error) => error.includes("manifest checksum"))).toBe(true);
    expect(withExtra.ok).toBe(true);
    expect(withExtra.warnings.some((warning) => warning.includes("unlisted file"))).toBe(true);
  });

  it("reports language CSV import problems while preserving duplicate last-wins semantics", () => {
    const imported = importHmiLanguagePackCsv(
      [
        "languageId,displayName,stringId,text,missing",
        "en-US,English,greeting,Hello,false",
        "en-US,English,greeting,Hi,false",
        "en-US,English,,Ignored,false",
        "en-US,English,footer,,true",
      ].join("\n"),
      { id: "lang_imported" },
    );
    const badHeader = importHmiLanguagePackCsv("languageId,stringId\nen-US,greeting");

    expect(imported.ok).toBe(true);
    expect(imported.languagePack?.strings.greeting).toBe("Hi");
    expect(imported.languagePack?.missingStringIds).toEqual(["footer"]);
    expect(imported.warnings.some((warning) => warning.includes("repeats stringId"))).toBe(true);
    expect(imported.warnings.some((warning) => warning.includes("blank stringId"))).toBe(true);
    expect(badHeader.ok).toBe(false);
    expect(badHeader.errors).toContain('Language file CSV is missing required column "displayName".');
    expect(badHeader.errors).toContain('Language file CSV is missing required column "text".');
    expect(badHeader.errors).toContain('Language file CSV is missing required column "missing".');
  });

  it("validates asset, screen, and tag-path element property references", () => {
    const project = createDefaultHmiProject();
    const screen = createHmiScreen("Main");
    const image = createHmiElement("media.image-placeholder");
    image.properties.assetId = "asset_missing";

    const unsupportedImage = createHmiElement("media.image-placeholder");
    unsupportedImage.properties.assetId = "asset_unsupported";

    const nav = createHmiElement("navigation.menu");
    nav.properties.homeScreenId = "screen_missing";

    const display = createHmiElement("common.numeric-display");
    display.properties.value = "MissingPV";

    screen.elements.push(image, unsupportedImage, nav, display);
    project.screens.push(screen);
    project.homeScreenId = screen.id;
    project.assets.push(
      { id: "asset_unsupported", name: "Legacy WMF", kind: "image", references: [], unsupported: true },
      { id: "asset_blank_name", name: " ", kind: "image", references: [] },
      { id: "asset_duplicate_name", name: "Legacy WMF", kind: "image", references: [] },
      { id: "asset_unsupported", name: "Legacy WMF Copy", kind: "image", references: [] },
    );

    const findings = validateHmiProject(project, { knownTagPaths: ["GoodPV"] });
    const ruleIds = findings.map((finding) => finding.ruleId);

    expect(ruleIds).toContain("hmi-property-missing-asset");
    expect(ruleIds).toContain("hmi-property-unsupported-asset");
    expect(ruleIds).toContain("hmi-property-missing-screen");
    expect(ruleIds).toContain("hmi-property-missing-tag");
    expect(ruleIds).toContain("hmi-asset-unsupported");
    expect(ruleIds).toContain("hmi-asset-name-required");
    expect(ruleIds).toContain("hmi-asset-name-duplicate");
    expect(ruleIds).toContain("hmi-asset-id-duplicate");
  });

  it("validates target device capacity, storage, and surface compatibility", () => {
    const project = createDefaultHmiProject();
    project.targetDevice = {
      ...project.targetDevice,
      width: 100,
      height: 80,
      capacity: {
        maxScreens: 0,
        maxElementsPerScreen: 1,
        maxTrends: 0,
        maxDataLogs: 0,
        maxRecipes: 0,
        storageMb: 1,
      },
    };
    const screen = createHmiScreen("Main", project.targetDevice);
    screen.width = 120;
    screen.updateRateMs = 0;
    screen.elements.push(createHmiElement("common.button"), createHmiElement("common.text-display"));
    const popup = createHmiPopup("Large Popup", 120, 90);
    project.systemBanner.width = 80;
    project.systemBanner.updateRateMs = 0;
    project.screens.push(screen);
    project.popups.push(popup);
    project.homeScreenId = screen.id;
    project.assets.push(
      { id: "asset_large", name: "Large Image", kind: "image", references: [], bytes: 2 * 1024 * 1024 },
      { id: "asset_bad_size", name: "Bad Size", kind: "image", references: [], bytes: -1 },
    );
    project.trends.push({
      id: "trend_over_capacity",
      name: "Over Capacity Trend",
      timeRangeSeconds: 60,
      sampleRateMs: 1000,
      traces: [],
    });
    project.dataLogs.push({
      id: "log_over_capacity",
      name: "Over Capacity Log",
      sampleRateMs: 1000,
      retentionHours: 24,
      tagPaths: ["Tag1"],
    });

    const findings = validateHmiProject(project, { knownTagPaths: ["Tag1"] });
    const ruleIds = findings.map((finding) => finding.ruleId);

    expect(ruleIds).toContain("hmi-device-invalid-capacity");
    expect(ruleIds).toContain("hmi-device-screen-capacity-exceeded");
    expect(ruleIds).toContain("hmi-device-element-capacity-exceeded");
    expect(ruleIds).toContain("hmi-device-trend-capacity-exceeded");
    expect(ruleIds).toContain("hmi-device-data-log-capacity-exceeded");
    expect(ruleIds).toContain("hmi-device-storage-capacity-exceeded");
    expect(ruleIds).toContain("hmi-asset-invalid-size");
    expect(ruleIds).toContain("hmi-surface-invalid-update-rate");
    expect(ruleIds).toContain("hmi-screen-device-size-mismatch");
    expect(ruleIds).toContain("hmi-popup-device-size-exceeded");
    expect(ruleIds).toContain("hmi-system-banner-device-width-mismatch");
  });

  it("builds a usage/capacity report with storage estimates and scaling risks", () => {
    const project = createDefaultHmiProject();
    project.targetDevice = {
      ...project.targetDevice,
      width: 1280,
      height: 800,
      capacity: {
        maxScreens: 2,
        maxElementsPerScreen: 2,
        maxTrends: 1,
        maxDataLogs: 1,
        maxRecipes: 1,
        storageMb: 1,
      },
    };
    const native = createHmiScreen("Native", project.targetDevice);
    native.elements.push(createHmiElement("common.button"));
    const scaled = createHmiScreen("Scaled", { ...project.targetDevice, width: 640, height: 400 });
    const image = createHmiElement("media.image-placeholder");
    image.properties.assetId = "asset_photo";
    scaled.elements.push(image, createHmiElement("common.text-display"), createHmiElement("common.numeric-display"));
    project.screens.push(native, scaled);
    project.homeScreenId = native.id;
    project.assets.push({ id: "asset_photo", name: "Operator Photo", kind: "image", references: [], bytes: 512 * 1024 });
    project.languagePacks[0]!.strings = { title: "Main screen" };
    project.trends.push({ id: "trend_1", name: "Trend", timeRangeSeconds: 60, sampleRateMs: 1000, traces: [] });
    project.dataLogs.push({
      id: "log_1",
      name: "Fast Log",
      sampleRateMs: 1000,
      retentionHours: 24,
      tagPaths: ["Speed", "Pressure"],
      statusTagPath: "LogStatus",
    });

    const report = hmiUsageCapacityReport(project);
    const byKey = Object.fromEntries(report.metrics.map((metric) => [metric.key, metric]));

    expect(byKey.screens?.status).toBe("warning");
    expect(byKey["largest-surface-elements"]?.status).toBe("exceeded");
    expect(byKey.storage?.status).toBe("exceeded");
    expect(report.knownAssetBytes).toBe(512 * 1024);
    expect(report.estimatedDataLogBytes).toBeGreaterThan(0);
    expect(report.scalingRiskCount).toBe(1);
    expect(report.surfaces.find((surface) => surface.name === "Scaled")).toMatchObject({
      scalingStatus: "scaled",
      rasterScalingRiskCount: 1,
      elementStatus: "exceeded",
    });

    const ruleIds = validateHmiProject(project, { knownTagPaths: ["Speed", "Pressure", "LogStatus"] }).map((finding) => finding.ruleId);
    expect(ruleIds).toContain("hmi-device-storage-capacity-exceeded");
    expect(ruleIds).toContain("hmi-screen-raster-scaling-risk");
  });

  it("builds a visual QA report for complex operator screens", () => {
    const project = createDefaultHmiProject("Visual QA");
    const screen = createHmiScreen("Overview");
    const button = createHmiElement("common.button", "Start");
    const smallButton = createHmiElement("common.button", "Tiny Start");
    smallButton.geometry = { x: 100, y: 100, width: 36, height: 24 };
    const display = createHmiElement("common.numeric-display", "Long Speed Display");
    display.geometry = { x: 96, y: 96, width: 90, height: 34 };
    display.properties.label = "Very Long Speed Display Label";
    const trend = createHmiElement("trends.trend-chart", "Trend");
    const alarm = createHmiElement("alarms.alarm-summary", "Alarms");
    const hmibc = createHmiElement("common.hmi-button-control", "HMIBC");
    hmibc.geometry = { x: -10, y: 40, width: 190, height: 56 };

    screen.elements = [button, smallButton, display, trend, alarm, hmibc];
    project.screens = [screen];
    project.homeScreenId = screen.id;
    project.dataLogs = [
      {
        id: "log1",
        name: "Process Log",
        sampleRateMs: 1000,
        retentionHours: 1,
        tagPaths: ["Tank_Level"],
      },
    ];

    const report = hmiVisualQaReport(project);
    const surface = report.surfaces.find((row) => row.name === "Overview")!;

    expect(report.complexSurfaceCount).toBe(1);
    expect(report.coverage.processObjects).toBeGreaterThanOrEqual(4);
    expect(report.coverage.alarmObjects).toBe(1);
    expect(report.coverage.trendObjects).toBe(1);
    expect(report.coverage.dataLogDefinitions).toBe(1);
    expect(report.coverage.hmiButtonControls).toBe(1);
    expect(surface.complexity).toBe("complex");
    expect(surface.modelOnlyElementCount).toBe(1);
    expect(surface.outOfBoundsCount).toBe(1);
    expect(surface.smallTouchTargetCount).toBe(1);
    expect(surface.tinyTextCount).toBe(1);
    expect(surface.overlapCount).toBeGreaterThan(0);
    expect(surface.issues.map((issue) => issue.ruleId)).toEqual(
      expect.arrayContaining([
        "hmi-visual-qa-model-only-element",
        "hmi-visual-qa-out-of-bounds",
        "hmi-visual-qa-small-touch-target",
        "hmi-visual-qa-text-fit-risk",
        "hmi-visual-qa-overlap",
      ]),
    );
  });

  it("validates navigation, shortcut, popup, and banner metadata", () => {
    const project = createDefaultHmiProject();
    const screen = createHmiScreen("Main");
    screen.navigation = { includeInMenu: true, caption: " ", icon: " " };
    const popupA = createHmiPopup("Tools");
    const popupB = createHmiPopup("Tools");
    const popupBad = createHmiPopup(" ");
    popupA.opacity = 2;
    popupA.cachePolicy = "invalid" as "none";
    popupA.showCloseButton = "yes" as unknown as boolean;
    project.systemBanner.dock = "left" as "top";
    project.systemBanner.restoreDefaultAvailable = "yes" as unknown as boolean;
    project.screens.push(screen);
    project.popups.push(popupA, popupB, popupBad);
    project.homeScreenId = screen.id;
    project.shortcuts.push(
      {
        id: "shortcut_main",
        name: "Main Shortcut",
        targetKind: "screen",
        targetId: screen.id,
        caption: " ",
        icon: " ",
        folder: " ",
        securityRoleIds: [],
      },
      {
        id: "shortcut_main",
        name: "Main Shortcut",
        targetKind: "popup",
        targetId: "missing_popup",
        caption: "Duplicate",
        securityRoleIds: [],
      },
      {
        id: " ",
        name: " ",
        targetKind: "screen",
        targetId: screen.id,
        caption: "Blank",
        securityRoleIds: [],
      },
    );

    const findings = validateHmiProject(project);
    const ruleIds = findings.map((finding) => finding.ruleId);

    expect(ruleIds).toContain("hmi-screen-navigation-caption-required");
    expect(ruleIds).toContain("hmi-screen-navigation-icon-empty");
    expect(ruleIds).toContain("hmi-popup-name-required");
    expect(ruleIds).toContain("hmi-popup-name-duplicate");
    expect(ruleIds).toContain("hmi-popup-close-button-invalid");
    expect(ruleIds).toContain("hmi-popup-invalid-opacity");
    expect(ruleIds).toContain("hmi-popup-invalid-cache-policy");
    expect(ruleIds).toContain("hmi-system-banner-invalid-dock");
    expect(ruleIds).toContain("hmi-system-banner-restore-invalid");
    expect(ruleIds).toContain("hmi-shortcut-id-required");
    expect(ruleIds).toContain("hmi-shortcut-id-duplicate");
    expect(ruleIds).toContain("hmi-shortcut-name-required");
    expect(ruleIds).toContain("hmi-shortcut-name-duplicate");
    expect(ruleIds).toContain("hmi-shortcut-caption-required");
    expect(ruleIds).toContain("hmi-shortcut-icon-empty");
    expect(ruleIds).toContain("hmi-shortcut-folder-empty");
    expect(ruleIds).toContain("hmi-shortcut-target-missing");
  });

  it("projects security-aware HMI navigation routes, folders, and dead-end screens", () => {
    const project = createDefaultHmiProject();
    const home = createHmiScreen("Home");
    home.navigation = { includeInMenu: true, caption: "Home", icon: "house" };
    const settings = createHmiScreen("Settings");
    settings.navigation = { includeInMenu: true, caption: "Settings" };
    settings.securityRoleIds = ["role_engineer"];
    const hidden = createHmiScreen("Hidden Diagnostics");
    hidden.navigation = { includeInMenu: false, caption: "Hidden" };
    const deadEnd = createHmiScreen("Standalone");
    deadEnd.navigation = { includeInMenu: false };
    const popup = createHmiPopup("Tools");
    project.screens.push(home, settings, hidden, deadEnd);
    project.popups.push(popup);
    project.homeScreenId = home.id;
    project.shortcuts.push(
      {
        id: "shortcut_tools",
        name: "Tools Shortcut",
        targetKind: "popup",
        targetId: popup.id,
        caption: "Tools",
        folder: "Maintenance",
        securityRoleIds: ["role_engineer"],
      },
      {
        id: "shortcut_hidden",
        name: "Hidden Shortcut",
        targetKind: "screen",
        targetId: hidden.id,
        caption: "Diagnostics",
        folder: "Maintenance",
        securityRoleIds: [],
      },
      {
        id: "shortcut_missing",
        name: "Missing",
        targetKind: "screen",
        targetId: "missing_screen",
        caption: "Missing",
        securityRoleIds: [],
      },
    );

    const engineer = hmiNavigationModel(project, { activeRoleIds: ["role_engineer"] });
    const operator = hmiNavigationModel(project, { activeRoleIds: ["role_operator"], includeHidden: true });

    expect(engineer.items.map((item) => `${item.commandType}:${item.label}`)).toEqual([
      "navigate:Home",
      "navigate:Settings",
      "open-popup:Tools",
      "navigate:Diagnostics",
    ]);
    expect(engineer.folders.find((folder) => folder.name === "Maintenance")?.items.map((item) => item.label)).toEqual(["Tools", "Diagnostics"]);
    expect(engineer.omittedScreenIds).toEqual([hidden.id, deadEnd.id]);
    expect(engineer.deadEndScreenIds).toEqual([deadEnd.id]);
    expect(engineer.missingTargetCount).toBe(1);
    expect(operator.items.find((item) => item.label === "Settings")?.hiddenReason).toBe("security");
    expect(operator.items.find((item) => item.label === "Tools")?.hiddenReason).toBe("security");
    expect(operator.hiddenBySecurityCount).toBe(2);
  });

  it("flags a navigation dead-end screen as unreachable but not a menu-included or shortcut-targeted screen", () => {
    const project = createDefaultHmiProject();
    const home = createHmiScreen("Home");
    home.navigation = { includeInMenu: true, caption: "Home" };
    const inMenu = createHmiScreen("Listed");
    inMenu.navigation = { includeInMenu: true, caption: "Listed" };
    const viaShortcut = createHmiScreen("Linked");
    viaShortcut.navigation = { includeInMenu: false };
    const orphan = createHmiScreen("Orphan");
    orphan.navigation = { includeInMenu: false };
    project.screens.push(home, inMenu, viaShortcut, orphan);
    project.homeScreenId = home.id;
    project.shortcuts.push({
      id: "shortcut_linked",
      name: "Linked Shortcut",
      targetKind: "screen",
      targetId: viaShortcut.id,
      caption: "Linked",
      securityRoleIds: [],
    });

    const findings = validateHmiProject(project);
    const unreachable = findings.filter((finding) => finding.ruleId === "hmi-screen-unreachable");

    expect(unreachable).toHaveLength(1);
    expect(unreachable[0].severity).toBe("warning");
    expect(unreachable[0].target).toBe(`hmi/screen:${orphan.id}/navigation`);
    expect(unreachable[0].message).toContain("Orphan");
  });

  it("validates graphic element layout, z-order, flags, and style metadata", () => {
    const project = createDefaultHmiProject();
    const screen = createHmiScreen("Main");
    const badElement = createHmiElement("common.button");
    badElement.geometry.x = Number.NaN;
    badElement.geometry.width = Number.POSITIVE_INFINITY;
    badElement.geometry.rotation = Number.NaN;
    badElement.zIndex = 1.5;
    badElement.visible = "yes" as unknown as boolean;
    badElement.locked = "no" as unknown as boolean;
    badElement.style = {
      fill: " ",
      stroke: "",
      textColor: " ",
      strokeWidth: -1,
      fontSize: 0,
      opacity: 2,
    };

    const outsideElement = createHmiElement("common.text-display");
    outsideElement.geometry.x = -4;
    outsideElement.geometry.y = screen.height - 8;
    outsideElement.geometry.width = 80;
    outsideElement.geometry.height = 24;

    screen.elements.push(badElement, outsideElement);
    project.screens.push(screen);
    project.homeScreenId = screen.id;

    const findings = validateHmiProject(project);
    const ruleIds = findings.map((finding) => finding.ruleId);

    expect(ruleIds).toContain("hmi-element-invalid-position");
    expect(ruleIds).toContain("hmi-element-invalid-geometry");
    expect(ruleIds).toContain("hmi-element-invalid-rotation");
    expect(ruleIds).toContain("hmi-element-invalid-z-index");
    expect(ruleIds).toContain("hmi-element-visible-invalid");
    expect(ruleIds).toContain("hmi-element-locked-invalid");
    expect(ruleIds).toContain("hmi-element-style-color-required");
    expect(ruleIds).toContain("hmi-element-style-stroke-width-invalid");
    expect(ruleIds).toContain("hmi-element-style-font-size-invalid");
    expect(ruleIds).toContain("hmi-element-style-opacity-invalid");
    expect(ruleIds).toContain("hmi-element-outside-surface");
  });

  it("builds an offline runtime package artifact after HMI verification", () => {
    const project = createDefaultHmiProject("Line 1 HMI");
    const screen = createHmiScreen("Main", project.targetDevice);
    screen.elements.push(createHmiElement("common.button"));
    project.screens.push(screen);
    project.homeScreenId = screen.id;

    const result = buildHmiRuntimePackage(project, {
      builtAt: "2026-05-30T12:00:00.000Z",
      validationContext: { knownTagPaths: [] },
    });
    const repeat = buildHmiRuntimePackage(project, {
      builtAt: "2026-05-30T12:05:00.000Z",
      validationContext: { knownTagPaths: [] },
    });

    expect(result.ok).toBe(true);
    expect(result.verification.status).toBe("ready");
    expect(result.verification.errorCount).toBe(0);
    expect(result.artifact?.kind).toBe("hmi-runtime-package");
    expect(result.artifact?.fileName).toBe("Line-1-HMI-panelview-5310-10w.hmiruntime.json");
    expect(result.artifact?.runtimeProfile).toBe("offline-preview");
    expect(result.artifact?.targetDevice.id).toBe(project.targetDevice.id);
    expect(result.artifact?.summary.screenCount).toBe(1);
    expect(result.artifact?.summary.elementCount).toBe(1);
    expect(result.artifact?.summary.languagePackCount).toBe(1);
    expect(result.artifact?.hardwareTransfer.download).toBe("disabled-model-only");
    expect(result.artifact?.contentChecksum).toMatch(/^[0-9a-f]{8}$/);
    expect(repeat.artifact?.contentChecksum).toBe(result.artifact?.contentChecksum);
    expect(repeat.artifact?.packageId).toBe(result.artifact?.packageId);
    expect(repeat.artifact?.builtAt).not.toBe(result.artifact?.builtAt);
  });

  it("serializes, reloads, and integrity-checks offline runtime package artifacts", () => {
    const project = createDefaultHmiProject("Line 1 HMI");
    const screen = createHmiScreen("Main", project.targetDevice);
    screen.elements.push(createHmiElement("common.button"));
    project.screens.push(screen);
    project.homeScreenId = screen.id;

    const built = buildHmiRuntimePackage(project, {
      builtAt: "2026-05-30T12:00:00.000Z",
      validationContext: { knownTagPaths: [] },
    });
    const artifact = built.artifact!;
    const text = serializeHmiRuntimePackageArtifact(artifact);
    const loaded = deserializeHmiRuntimePackageArtifact(text);
    const tampered = deserializeHmiRuntimePackageArtifact(text.replace('"screenCount": 1', '"screenCount": 2'));
    const unsafeTransfer = verifyHmiRuntimePackageArtifact({
      ...artifact,
      hardwareTransfer: { ...artifact.hardwareTransfer, download: "enabled" },
    });

    expect(loaded.ok).toBe(true);
    expect(loaded.artifact?.contentChecksum).toBe(artifact.contentChecksum);
    expect(loaded.expectedChecksum).toBe(artifact.contentChecksum);
    expect(tampered.ok).toBe(false);
    expect(tampered.errors.some((error) => error.includes("checksum mismatch"))).toBe(true);
    expect(unsafeTransfer.ok).toBe(false);
    expect(unsafeTransfer.errors.some((error) => error.includes("disabled-model-only"))).toBe(true);
  });

  it("blocks runtime package build when HMI verification has errors", () => {
    const project = createDefaultHmiProject("Bad HMI");
    const screen = createHmiScreen("Main", project.targetDevice);
    const element = createHmiElement("common.numeric-display");
    element.geometry.width = 0;
    screen.elements.push(element);
    project.screens.push(screen);
    project.homeScreenId = screen.id;

    const result = buildHmiRuntimePackage(project, { builtAt: "2026-05-30T12:00:00.000Z" });

    expect(result.ok).toBe(false);
    expect(result.artifact).toBeUndefined();
    expect(result.verification.status).toBe("blocked");
    expect(result.verification.errorCount).toBeGreaterThan(0);
    expect(result.blockedReason).toContain("must be resolved");
    expect(result.verification.findings.some((finding) => finding.ruleId === "hmi-element-invalid-geometry")).toBe(true);
  });

  it("validates animation targets, sources, and state tables", () => {
    const project = createDefaultHmiProject();
    const screen = createHmiScreen("Main");
    const button = createHmiElement("common.button");
    button.animations.push(
      {
        id: "anim_missing_target",
        targetProperty: " ",
        source: { kind: "tag", path: " " },
        table: { kind: "color", states: [] },
      },
      {
        id: "anim_unknown_target",
        targetProperty: "unknownProperty",
        source: { kind: "system-tag", path: "System.NotReal" },
        table: { kind: "color", states: [{ value: true, color: " " }, { value: true, color: "#f04438" }] },
      },
      {
        id: "anim_state",
        targetProperty: "label",
        source: { kind: "tag", path: "MissingStateTag", dataType: "DINT" },
        table: { kind: "state", states: [{ value: 1, state: "" }] },
      },
    );
    screen.elements.push(button);
    project.screens.push(screen);
    project.homeScreenId = screen.id;

    const findings = validateHmiProject(project, { knownTagPaths: ["GoodTag"] });
    const ruleIds = findings.map((finding) => finding.ruleId);

    expect(ruleIds).toContain("hmi-animation-target-required");
    expect(ruleIds).toContain("hmi-animation-source-required");
    expect(ruleIds).toContain("hmi-animation-empty-table");
    expect(ruleIds).toContain("hmi-animation-invalid-target");
    expect(ruleIds).toContain("hmi-animation-missing-system-tag");
    expect(ruleIds).toContain("hmi-animation-color-required");
    expect(ruleIds).toContain("hmi-animation-duplicate-state");
    expect(ruleIds).toContain("hmi-animation-type-mismatch");
    expect(ruleIds).toContain("hmi-animation-missing-tag");
    expect(ruleIds).toContain("hmi-animation-state-required");
  });

  it("validates Add-On Graphic definitions and reusable-content tag restrictions", () => {
    const project = createDefaultHmiProject();
    const reusableDisplay = createHmiElement("common.numeric-display");
    reusableDisplay.geometry.width = 0;
    reusableDisplay.properties.value = "Motor.Speed";
    reusableDisplay.bindings.push({
      id: "bind_direct_tag",
      targetProperty: "value",
      source: { kind: "tag", path: "Motor.Run", dataType: "BOOL" },
      mode: "read",
    });
    reusableDisplay.animations.push({
      id: "anim_direct_system",
      targetProperty: "label",
      source: { kind: "system-tag", path: "System.DateTime", dataType: "STRING" },
      table: { kind: "state", states: [{ value: true, state: "running" }] },
    });
    reusableDisplay.events.push({
      id: "event_direct_write",
      eventType: "press",
      commands: [{ id: "cmd_direct_write", type: "set-tag-value", safety: "runtime-preview", args: { tagPath: "Motor.Start", value: true } }],
    });

    project.addOnGraphics.push(
      {
        id: "aog_motor",
        name: "Motor Faceplate",
        width: 0,
        height: 120,
        properties: [
          { name: "TagBase", dataType: "tag-path", required: true },
          { name: "TagBase", dataType: "tag-path" },
          { name: " ", dataType: " " },
        ],
        elements: [reusableDisplay],
      },
      {
        id: "aog_motor",
        name: "Motor Faceplate",
        width: 100,
        height: 100,
        properties: [],
        elements: [],
        unsupported: true,
      },
      {
        id: " ",
        name: " ",
        width: 100,
        height: 100,
        properties: [],
        elements: [],
      },
    );

    const findings = validateHmiProject(project, { knownTagPaths: ["Motor.Run", "Motor.Speed", "Motor.Start"] });
    const ruleIds = findings.map((finding) => finding.ruleId);

    expect(ruleIds).toContain("hmi-add-on-graphic-id-required");
    expect(ruleIds).toContain("hmi-add-on-graphic-id-duplicate");
    expect(ruleIds).toContain("hmi-add-on-graphic-name-required");
    expect(ruleIds).toContain("hmi-add-on-graphic-name-duplicate");
    expect(ruleIds).toContain("hmi-add-on-graphic-invalid-size");
    expect(ruleIds).toContain("hmi-add-on-graphic-unsupported");
    expect(ruleIds).toContain("hmi-add-on-graphic-empty");
    expect(ruleIds).toContain("hmi-add-on-graphic-property-name-required");
    expect(ruleIds).toContain("hmi-add-on-graphic-property-name-duplicate");
    expect(ruleIds).toContain("hmi-add-on-graphic-property-type-required");
    expect(ruleIds).toContain("hmi-element-invalid-geometry");
    expect(ruleIds).toContain("hmi-add-on-graphic-direct-binding");
    expect(ruleIds).toContain("hmi-add-on-graphic-direct-tag-property");
    expect(ruleIds).toContain("hmi-add-on-graphic-direct-animation-source");
    expect(ruleIds).toContain("hmi-add-on-graphic-direct-tag-command");
  });

  it("validates alarm and diagnostics view table metadata", () => {
    const project = createDefaultHmiProject();
    project.alarms.push(
      {
        id: "alarm_high",
        name: "High Alarm",
        tagPath: "MissingTemp",
        severity: "major",
        trigger: { kind: "analog-high", threshold: 100, deadband: -1 },
        allowAcknowledge: true,
      },
      {
        id: "alarm_high",
        name: "High Alarm",
        tagPath: " ",
        severity: "urgent" as "major",
        trigger: { kind: "digital" },
        allowAcknowledge: "yes" as unknown as boolean,
        enabled: "yes" as unknown as boolean,
      },
      {
        id: " ",
        name: " ",
        tagPath: "GoodTemp",
        severity: "warning",
        trigger: { kind: "analog-low", threshold: Number.NaN },
        allowAcknowledge: true,
      },
    );
    project.alarmViews.push(
      {
        id: "alarm_main",
        name: "Main Alarms",
        kind: "summary",
        columns: ["Name", "Name", " "],
        filter: " ",
        sort: " ",
        securityRoleIds: [],
      },
      {
        id: "alarm_main",
        name: "Main Alarms",
        kind: "history",
        columns: [],
        securityRoleIds: [],
      },
      {
        id: " ",
        name: " ",
        kind: "manager",
        columns: [],
        securityRoleIds: [],
      },
      {
        id: "alarm_bad_kind",
        name: "Bad Kind",
        kind: "matrix" as unknown as "summary",
        columns: ["Name"],
        securityRoleIds: [],
      },
    );
    project.diagnosticsViews.push(
      {
        id: "diag_main",
        name: "Main Diagnostics",
        columns: ["Source", "Source", " "],
        defaultFilter: " ",
      },
      {
        id: "diag_main",
        name: "Main Diagnostics",
        columns: [],
      },
      {
        id: " ",
        name: " ",
        columns: [],
      },
    );

    const findings = validateHmiProject(project, { knownTagPaths: ["GoodTemp"] });
    const ruleIds = findings.map((finding) => finding.ruleId);

    expect(ruleIds).toContain("hmi-alarm-id-required");
    expect(ruleIds).toContain("hmi-alarm-id-duplicate");
    expect(ruleIds).toContain("hmi-alarm-name-required");
    expect(ruleIds).toContain("hmi-alarm-name-duplicate");
    expect(ruleIds).toContain("hmi-alarm-tag-required");
    expect(ruleIds).toContain("hmi-alarm-missing-tag");
    expect(ruleIds).toContain("hmi-alarm-invalid-severity");
    expect(ruleIds).toContain("hmi-alarm-threshold-required");
    expect(ruleIds).toContain("hmi-alarm-deadband-invalid");
    expect(ruleIds).toContain("hmi-alarm-acknowledge-invalid");
    expect(ruleIds).toContain("hmi-alarm-enabled-invalid");
    expect(ruleIds).toContain("hmi-alarm-view-id-required");
    expect(ruleIds).toContain("hmi-alarm-view-id-duplicate");
    expect(ruleIds).toContain("hmi-alarm-view-name-required");
    expect(ruleIds).toContain("hmi-alarm-view-name-duplicate");
    expect(ruleIds).toContain("hmi-alarm-view-invalid-kind");
    expect(ruleIds).toContain("hmi-alarm-view-no-columns");
    expect(ruleIds).toContain("hmi-alarm-view-column-required");
    expect(ruleIds).toContain("hmi-alarm-view-column-duplicate");
    expect(ruleIds).toContain("hmi-alarm-view-filter-empty");
    expect(ruleIds).toContain("hmi-alarm-view-sort-empty");
    expect(ruleIds).toContain("hmi-diagnostics-view-id-required");
    expect(ruleIds).toContain("hmi-diagnostics-view-id-duplicate");
    expect(ruleIds).toContain("hmi-diagnostics-view-name-required");
    expect(ruleIds).toContain("hmi-diagnostics-view-name-duplicate");
    expect(ruleIds).toContain("hmi-diagnostics-view-no-columns");
    expect(ruleIds).toContain("hmi-diagnostics-view-column-required");
    expect(ruleIds).toContain("hmi-diagnostics-view-column-duplicate");
    expect(ruleIds).toContain("hmi-diagnostics-view-filter-empty");
  });

  it("validates security roles, users, references, and policies", () => {
    const project = createDefaultHmiProject();
    const screen = createHmiScreen("Main");
    screen.securityRoleIds.push("role_missing");
    project.screens.push(screen);
    project.homeScreenId = screen.id;
    project.security.guestRoleId = "role_guest_missing";
    project.security.autoLogoffSeconds = -1;
    project.security.passwordPolicy.minimumLength = 4;
    project.security.passwordPolicy.requireComplexity = false;
    project.security.roles.push(
      { id: "role_operator", name: "Operator Duplicate", permissions: ["navigate"] },
      { id: "role_blank", name: "Operator", permissions: [""] },
      { id: " ", name: " ", permissions: [] },
    );
    project.security.users.push(
      { id: "user_blank", username: " ", roleIds: [] },
      { id: "user_a", username: "tech", roleIds: ["role_missing_user"] },
      { id: "user_b", username: "TECH", roleIds: [""] },
    );
    project.shortcuts.push({
      id: "shortcut_main",
      name: "Main Shortcut",
      targetKind: "screen",
      targetId: screen.id,
      caption: "Main",
      securityRoleIds: ["role_missing_shortcut"],
    });
    project.alarmViews.push({
      id: "alarm_main",
      name: "Alarm Main",
      kind: "summary",
      columns: [],
      securityRoleIds: ["role_missing_alarm"],
    });

    const findings = validateHmiProject(project);
    const ruleIds = findings.map((finding) => finding.ruleId);

    expect(ruleIds).toContain("hmi-security-guest-role-missing");
    expect(ruleIds).toContain("hmi-security-auto-logoff-invalid");
    expect(ruleIds).toContain("hmi-security-password-too-short");
    expect(ruleIds).toContain("hmi-security-password-complexity-off");
    expect(ruleIds).toContain("hmi-security-role-id-duplicate");
    expect(ruleIds).toContain("hmi-security-role-id-required");
    expect(ruleIds).toContain("hmi-security-role-name-duplicate");
    expect(ruleIds).toContain("hmi-security-role-name-required");
    expect(ruleIds).toContain("hmi-security-permission-required");
    expect(ruleIds).toContain("hmi-security-user-name-required");
    expect(ruleIds).toContain("hmi-security-user-name-duplicate");
    expect(ruleIds).toContain("hmi-security-user-no-roles");
    expect(ruleIds).toContain("hmi-security-user-missing-role");
    expect(ruleIds).toContain("hmi-security-user-role-required");
    expect(ruleIds).toContain("hmi-surface-security-role-missing");
    expect(ruleIds).toContain("hmi-shortcut-security-role-missing");
    expect(ruleIds).toContain("hmi-alarm-view-security-role-missing");
  });
});
