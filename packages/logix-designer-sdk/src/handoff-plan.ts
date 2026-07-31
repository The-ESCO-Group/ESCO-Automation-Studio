import type {
  LogixDesignerSdkHandoffOperation,
  LogixDesignerSdkHandoffPlan,
  LogixDesignerSdkHandoffRequest,
  LogixDesignerSdkRunnerManifest,
  LogixDesignerSdkScriptBundle,
} from "./types";

const BOUNDARY =
  "This plan is an offline Studio 5000 SDK handoff lane only. It does not open a PLC connection, change controller mode, download to a controller, apply online edits, force tags, or clear faults.";

const BLOCKED_OPERATIONS = [
  "download-project-to-controller",
  "go-online",
  "online-edit",
  "controller-mode-change",
  "sd-card-deployment",
  "physical-plc-forces",
  "fault-clear",
];

const SAFE_OPERATIONS = [
  "Probe the SDK install and client environment.",
  "Open a sandbox ACD/L5K/L5X project file on the SDK workstation.",
  "Save/export review L5X artifacts from a sandbox project.",
  "Export selected project components to L5X for ESCO review.",
  "Import selected components into an offline sandbox project copy for vendor verification.",
  "Convert a sandbox project to an installed Logix Designer major revision.",
];

function operationLabel(operation: LogixDesignerSdkHandoffOperation): string {
  switch (operation) {
    case "probe-only":
      return "SDK probe only";
    case "open-export-l5x":
      return "Open sandbox project and export review L5X";
    case "component-export":
      return "Export selected component to review L5X";
    case "component-import-offline":
      return "Import selected component into offline sandbox project";
    case "convert-project":
      return "Convert sandbox project to installed Logix Designer revision";
  }
}

function requiredInputs(operation: LogixDesignerSdkHandoffOperation): string[] {
  switch (operation) {
    case "probe-only":
      return [];
    case "open-export-l5x":
      return ["sourceProjectPath", "outputPath"];
    case "component-export":
      return ["sourceProjectPath", "outputPath", "componentXPath"];
    case "component-import-offline":
      return ["sourceProjectPath", "outputPath", "componentXPath"];
    case "convert-project":
      return ["sourceProjectPath", "outputPath", "targetMajorRevision"];
  }
}

function hasInput(request: LogixDesignerSdkHandoffRequest, input: string): boolean {
  const value = request[input as keyof LogixDesignerSdkHandoffRequest];
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number") return Number.isInteger(value) && value >= 31;
  return value !== undefined && value !== null;
}

function buildPythonProbe(): string {
  return [
    "import asyncio",
    "import json",
    "",
    "async def main():",
    "    result = {\"ok\": False, \"client\": \"python\", \"sdkImport\": \"missing\"}",
    "    try:",
    "        from logix_designer_sdk.logix_project import LogixProject",
    "        result.update({\"ok\": True, \"sdkImport\": \"ok\", \"logixProjectType\": str(LogixProject)})",
    "    except Exception as exc:",
    "        result.update({\"error\": str(exc)})",
    "    print(json.dumps(result, indent=2))",
    "",
    "asyncio.run(main())",
    "",
  ].join("\n");
}

function buildReadme(operation: LogixDesignerSdkHandoffOperation): string {
  return [
    `ESCO Logix Designer SDK handoff: ${operationLabel(operation)}`,
    "",
    "Run this bundle only on a Windows workstation with Studio 5000 Logix Designer SDK installed.",
    "Start with the Python probe to prove the SDK client imports before writing any runner code.",
    "Use sandbox copies only. Return generated receipts and L5X exports to ESCO for review.",
    "",
    `Boundary: ${BOUNDARY}`,
    "",
  ].join("\n");
}

function runnerManifest(
  operation: LogixDesignerSdkHandoffOperation,
  request: LogixDesignerSdkHandoffRequest,
): LogixDesignerSdkRunnerManifest {
  return {
    schema: "esco.logixDesignerSdk.runner.v1",
    dryRun: true,
    operation,
    sourceProjectPath: request.sourceProjectPath?.trim() || undefined,
    outputPath: request.outputPath?.trim() || undefined,
    componentXPath: request.componentXPath?.trim() || undefined,
    targetMajorRevision: request.targetMajorRevision,
    blockedOperations: BLOCKED_OPERATIONS,
  };
}

function scriptBundle(
  operation: LogixDesignerSdkHandoffOperation,
  request: LogixDesignerSdkHandoffRequest,
): LogixDesignerSdkScriptBundle {
  return {
    readme: buildReadme(operation),
    pythonProbe: buildPythonProbe(),
    runnerManifest: runnerManifest(operation, request),
  };
}

export function buildLogixDesignerSdkHandoffPlan(
  request: LogixDesignerSdkHandoffRequest = {},
): LogixDesignerSdkHandoffPlan {
  const operation = request.operation ?? "probe-only";
  const required = requiredInputs(operation);
  const missingInputs = required.filter((input) => !hasInput(request, input));
  const controllerTransferRequested = request.allowControllerTransfer === true;
  const blockedOperations = controllerTransferRequested
    ? ["requested-controller-transfer", ...BLOCKED_OPERATIONS]
    : BLOCKED_OPERATIONS;
  const status = controllerTransferRequested ? "blocked" : missingInputs.length > 0 ? "needs-input" : "ready-to-stage";

  return {
    status,
    operation,
    requiredInputs: required,
    missingInputs,
    safeOperations: SAFE_OPERATIONS,
    blockedOperations,
    steps: [
      "Export or select a sandbox ACD/L5K/L5X project file on the SDK workstation.",
      "Probe the Logix Designer SDK Python or C# client before opening a project.",
      `Run the guarded SDK operation: ${operationLabel(operation)}.`,
      "Capture stdout/stderr, SDK exceptions, generated files, file sizes, and timestamps in a handoff receipt.",
      "Bring the receipt and any exported L5X artifact back into ESCO for diff, validation, and review-only import.",
    ],
    scriptBundle: scriptBundle(operation, request),
    boundary: BOUNDARY,
  };
}
