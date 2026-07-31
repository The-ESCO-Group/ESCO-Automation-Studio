export type LogixDesignerSdkStatus = "available" | "missing" | "unsupported-platform";

export type LogixDesignerSdkCapabilityStatus = "ready" | "needs-sdk" | "guarded" | "blocked";

export interface LogixDesignerSdkFilesystem {
  exists(path: string): boolean | Promise<boolean>;
  readDir(path: string): readonly string[] | Promise<readonly string[]>;
}

export interface LogixDesignerSdkProbeOptions {
  /** Override the SDK root. Defaults to ESCO_LOGIX_DESIGNER_SDK_ROOT, then Rockwell's public-documents path. */
  sdkRoot?: string;
  /** Injectable for tests. Defaults to process.env. */
  env?: Record<string, string | undefined>;
  /** Injectable for tests. Defaults to process.platform. */
  platform?: NodeJS.Platform | string;
  /** Injectable for tests. Defaults to node:fs probes. */
  fs?: LogixDesignerSdkFilesystem;
}

export interface LogixDesignerSdkClientSummary {
  id: "python" | "csharp";
  label: string;
  available: boolean;
  installPath: string;
  evidence: string[];
  setupSteps: string[];
}

export interface LogixDesignerSdkCapability {
  id: string;
  label: string;
  status: LogixDesignerSdkCapabilityStatus;
  destructive: boolean;
  notes: string[];
}

export interface LogixDesignerSdkProbeReport {
  product: "Studio 5000 Logix Designer SDK";
  status: LogixDesignerSdkStatus;
  available: boolean;
  sdkRoot: string;
  checkedPaths: string[];
  clients: LogixDesignerSdkClientSummary[];
  pythonWheelCandidates: string[];
  pythonRequirementsPath?: string;
  constraints: string[];
  capabilities: LogixDesignerSdkCapability[];
  notes: string[];
  nextSteps: string[];
  boundary: string;
  docsUrl: string;
}

export type LogixDesignerSdkHandoffOperation =
  | "probe-only"
  | "open-export-l5x"
  | "component-export"
  | "component-import-offline"
  | "convert-project";

export interface LogixDesignerSdkHandoffRequest {
  operation?: LogixDesignerSdkHandoffOperation;
  /** A sandbox ACD/L5X/L5K path on the Windows SDK workstation. */
  sourceProjectPath?: string;
  /** A destination path on the Windows SDK workstation. */
  outputPath?: string;
  /** XPath for component import/export operations. */
  componentXPath?: string;
  /** Required only for convert-project. */
  targetMajorRevision?: number;
  /** Must stay false in ESCO. Any true value blocks the plan. */
  allowControllerTransfer?: boolean;
}

export interface LogixDesignerSdkRunnerManifest {
  schema: "esco.logixDesignerSdk.runner.v1";
  dryRun: true;
  operation: LogixDesignerSdkHandoffOperation;
  sourceProjectPath?: string;
  outputPath?: string;
  componentXPath?: string;
  targetMajorRevision?: number;
  blockedOperations: string[];
}

export interface LogixDesignerSdkScriptBundle {
  readme: string;
  pythonProbe: string;
  runnerManifest: LogixDesignerSdkRunnerManifest;
}

export interface LogixDesignerSdkHandoffPlan {
  status: "ready-to-stage" | "needs-input" | "blocked";
  operation: LogixDesignerSdkHandoffOperation;
  requiredInputs: string[];
  missingInputs: string[];
  safeOperations: string[];
  blockedOperations: string[];
  steps: string[];
  scriptBundle: LogixDesignerSdkScriptBundle;
  boundary: string;
}
