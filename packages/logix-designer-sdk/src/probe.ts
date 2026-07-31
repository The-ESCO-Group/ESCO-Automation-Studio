import { existsSync, readdirSync } from "node:fs";
import { win32 } from "node:path";
import type {
  LogixDesignerSdkCapability,
  LogixDesignerSdkClientSummary,
  LogixDesignerSdkFilesystem,
  LogixDesignerSdkProbeOptions,
  LogixDesignerSdkProbeReport,
  LogixDesignerSdkStatus,
} from "./types";

export const LOGIX_DESIGNER_SDK_DOCS_URL =
  "https://literature.rockwellautomation.com/idc/groups/literature/documents/gr/ldsdk-gr001_-en-p.pdf";

export const DEFAULT_LOGIX_DESIGNER_SDK_ROOT =
  "C:\\Users\\Public\\Documents\\Studio 5000\\Logix Designer SDK";

const BOUNDARY =
  "ESCO may use the Logix Designer SDK as an optional Windows workstation handoff/check lane; physical upload/download, go-online, online edit, mode change, SD-card deployment, and controller writes remain outside ESCO Automation Studio.";

const defaultFs: LogixDesignerSdkFilesystem = {
  exists: (path) => existsSync(path),
  readDir: (path) => readdirSync(path),
};

function envSdkRoot(env: Record<string, string | undefined>): string | undefined {
  return env.ESCO_LOGIX_DESIGNER_SDK_ROOT?.trim() || env.LOGIX_DESIGNER_SDK_ROOT?.trim() || undefined;
}

function capabilitySet(sdkAvailable: boolean): LogixDesignerSdkCapability[] {
  const safeStatus = sdkAvailable ? "ready" : "needs-sdk";
  return [
    {
      id: "open-save-export-l5x",
      label: "Open and save/export ACD/L5K/L5X projects",
      status: safeStatus,
      destructive: false,
      notes: ["Use only on sandbox files and return review artifacts to ESCO."],
    },
    {
      id: "component-export",
      label: "Export project components to L5X",
      status: safeStatus,
      destructive: false,
      notes: ["Useful for Studio 5000-to-ESCO component comparison and reuse review."],
    },
    {
      id: "component-import-offline",
      label: "Import project components into a sandbox project",
      status: sdkAvailable ? "guarded" : "needs-sdk",
      destructive: false,
      notes: ["Allowed only against an offline sandbox copy; never against a controller-connected session."],
    },
    {
      id: "convert-project",
      label: "Convert a project to an installed Logix Designer major revision",
      status: sdkAvailable ? "guarded" : "needs-sdk",
      destructive: false,
      notes: ["Version conversion stays a sandbox handoff step with before/after artifacts."],
    },
    {
      id: "controller-download",
      label: "Download/go-online/controller-mode operations",
      status: "blocked",
      destructive: true,
      notes: ["Rockwell documents these SDK APIs, but ESCO does not expose them in this integration lane."],
    },
  ];
}

async function safeExists(fs: LogixDesignerSdkFilesystem, path: string): Promise<boolean> {
  try {
    return await fs.exists(path);
  } catch {
    return false;
  }
}

async function safeReadDir(fs: LogixDesignerSdkFilesystem, path: string): Promise<readonly string[]> {
  try {
    return await fs.readDir(path);
  } catch {
    return [];
  }
}

function clientSummary(
  id: "python" | "csharp",
  available: boolean,
  installPath: string,
  evidence: string[],
): LogixDesignerSdkClientSummary {
  return {
    id,
    label: id === "python" ? "Python client" : "C# client",
    available,
    installPath,
    evidence,
    setupSteps:
      id === "python"
        ? [
            "Create or activate a Python virtual environment inside the SDK python examples folder.",
            "Install the SDK wheel with requirements.txt or pip install path/to/logix_designer_sdk-*.whl.",
            "Run ESCO's probe script before any handoff operation.",
          ]
        : [
            "Open or create a .NET solution on the SDK workstation.",
            "Reference RockwellAutomation.LogixDesigner.CSClient from the SDK installation.",
            "Build for the workstation architecture before running any handoff operation.",
          ],
  };
}

async function findPythonWheels(
  fs: LogixDesignerSdkFilesystem,
  root: string,
  pythonExamplesDir: string,
): Promise<string[]> {
  const candidateDirs = [root, win32.join(root, "python"), pythonExamplesDir];
  const wheels = new Set<string>();
  for (const dir of candidateDirs) {
    const entries = await safeReadDir(fs, dir);
    for (const entry of entries) {
      if (/^logix_designer_sdk-.*\.whl$/i.test(entry)) {
        wheels.add(win32.join(dir, entry));
      }
    }
  }
  return [...wheels].sort((a, b) => a.localeCompare(b));
}

export async function probeLogixDesignerSdk(
  options: LogixDesignerSdkProbeOptions = {},
): Promise<LogixDesignerSdkProbeReport> {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const fs = options.fs ?? defaultFs;
  const sdkRoot = options.sdkRoot?.trim() || envSdkRoot(env) || DEFAULT_LOGIX_DESIGNER_SDK_ROOT;
  const dotnetExamplesDir = win32.join(sdkRoot, "dotnet", "Examples");
  const pythonExamplesDir = win32.join(sdkRoot, "python", "Examples");
  const pythonRequirementsPath = win32.join(pythonExamplesDir, "requirements.txt");
  const checkedPaths = [sdkRoot, dotnetExamplesDir, pythonExamplesDir, pythonRequirementsPath];

  if (platform !== "win32") {
    return {
      product: "Studio 5000 Logix Designer SDK",
      status: "unsupported-platform",
      available: false,
      sdkRoot,
      checkedPaths,
      clients: [
        clientSummary("python", false, pythonExamplesDir, ["The Logix Designer SDK is documented as a 64-bit Windows workstation tool."]),
        clientSummary("csharp", false, dotnetExamplesDir, ["The Logix Designer SDK is documented as a 64-bit Windows workstation tool."]),
      ],
      pythonWheelCandidates: [],
      pythonRequirementsPath,
      constraints: sdkConstraints(),
      capabilities: capabilitySet(false),
      notes: ["Run this probe on the Windows workstation where Studio 5000 Logix Designer SDK is installed."],
      nextSteps: ["Install/run ESCO API on the Logix Designer SDK workstation, or set ESCO_LOGIX_DESIGNER_SDK_ROOT to a mounted SDK path for probing."],
      boundary: BOUNDARY,
      docsUrl: LOGIX_DESIGNER_SDK_DOCS_URL,
    };
  }

  const rootExists = await safeExists(fs, sdkRoot);
  const dotnetExamplesExists = await safeExists(fs, dotnetExamplesDir);
  const pythonExamplesExists = await safeExists(fs, pythonExamplesDir);
  const requirementsExists = await safeExists(fs, pythonRequirementsPath);
  const pythonWheelCandidates = await findPythonWheels(fs, sdkRoot, pythonExamplesDir);
  const pythonAvailable = pythonExamplesExists && (requirementsExists || pythonWheelCandidates.length > 0);
  const csharpAvailable = dotnetExamplesExists;
  const available = rootExists && (pythonAvailable || csharpAvailable);
  const status: LogixDesignerSdkStatus = available ? "available" : "missing";
  const notes = available
    ? ["SDK installation materials were found. ESCO still treats this as a sandbox handoff lane, not a controller transfer lane."]
    : [
        "SDK installation materials were not found at the checked paths.",
        "Install Logix Designer SDK 2.01+ for Python, or set ESCO_LOGIX_DESIGNER_SDK_ROOT to the SDK root.",
      ];

  return {
    product: "Studio 5000 Logix Designer SDK",
    status,
    available,
    sdkRoot,
    checkedPaths,
    clients: [
      clientSummary(
        "python",
        pythonAvailable,
        pythonExamplesDir,
        [
          pythonExamplesExists ? "Python examples directory exists." : "Python examples directory was not found.",
          requirementsExists ? "requirements.txt exists." : "requirements.txt was not found.",
          pythonWheelCandidates.length > 0
            ? `${pythonWheelCandidates.length} SDK wheel candidate(s) found.`
            : "No logix_designer_sdk wheel candidate was found in the shallow SDK paths.",
        ],
      ),
      clientSummary(
        "csharp",
        csharpAvailable,
        dotnetExamplesDir,
        [dotnetExamplesExists ? "C# examples directory exists." : "C# examples directory was not found."],
      ),
    ],
    pythonWheelCandidates,
    pythonRequirementsPath,
    constraints: sdkConstraints(),
    capabilities: capabilitySet(available),
    notes,
    nextSteps: available
      ? [
          "Run the ESCO Logix Designer SDK preflight before creating any SDK runner.",
          "Use a sandbox project copy and keep all generated artifacts review-only.",
          "Return the SDK receipt and exported L5X to ESCO for comparison/import review.",
        ]
      : [
          "Install the Logix Designer SDK on a 64-bit Windows workstation with Studio 5000.",
          "For Python, create a venv in the SDK python examples folder and install requirements.txt or the SDK .whl.",
          "Set ESCO_LOGIX_DESIGNER_SDK_ROOT if the SDK is installed somewhere other than Rockwell's default public-documents path.",
        ],
    boundary: BOUNDARY,
    docsUrl: LOGIX_DESIGNER_SDK_DOCS_URL,
  };
}

export function sdkConstraints(): string[] {
  return [
    "Rockwell documents Logix Designer SDK support for Logix Designer projects version 31 and later.",
    "FactoryTalk Linx is the supported communication software; RSLinx Classic is not supported.",
    "The SDK is documented for 64-bit Windows workstations.",
    "The SDK server uses TCP port 53204 by default.",
    "Rockwell documents a 500 MB maximum project size and 30 kB maximum single operation data file.",
    "Python support requires SDK 2.01+; Python and C# are both listed for SDK 2.02+.",
  ];
}
