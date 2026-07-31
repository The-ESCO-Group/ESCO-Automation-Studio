import { describe, expect, it } from "vitest";
import {
  DEFAULT_LOGIX_DESIGNER_SDK_ROOT,
  probeLogixDesignerSdk,
} from "./probe";
import type { LogixDesignerSdkFilesystem } from "./types";

function fakeFs(entries: Record<string, readonly string[] | true>): LogixDesignerSdkFilesystem {
  return {
    exists: (path) => entries[path] !== undefined,
    readDir: (path) => {
      const entry = entries[path];
      return Array.isArray(entry) ? entry : [];
    },
  };
}

describe("probeLogixDesignerSdk", () => {
  it("reports unsupported platforms without claiming SDK availability", async () => {
    const report = await probeLogixDesignerSdk({ platform: "linux", env: {}, fs: fakeFs({}) });

    expect(report.status).toBe("unsupported-platform");
    expect(report.available).toBe(false);
    expect(report.boundary).toContain("physical upload/download");
    expect(report.capabilities.find((capability) => capability.id === "controller-download")?.status).toBe("blocked");
  });

  it("reports a missing Windows SDK install at the default path", async () => {
    const report = await probeLogixDesignerSdk({ platform: "win32", env: {}, fs: fakeFs({}) });

    expect(report.status).toBe("missing");
    expect(report.sdkRoot).toBe(DEFAULT_LOGIX_DESIGNER_SDK_ROOT);
    expect(report.clients.every((client) => !client.available)).toBe(true);
    expect(report.nextSteps.join(" ")).toContain("Install the Logix Designer SDK");
  });

  it("detects Python and C# client materials from an env root", async () => {
    const root = "D:\\Rockwell\\Logix Designer SDK";
    const python = "D:\\Rockwell\\Logix Designer SDK\\python\\Examples";
    const dotnet = "D:\\Rockwell\\Logix Designer SDK\\dotnet\\Examples";
    const report = await probeLogixDesignerSdk({
      platform: "win32",
      env: { ESCO_LOGIX_DESIGNER_SDK_ROOT: root },
      fs: fakeFs({
        [root]: [],
        "D:\\Rockwell\\Logix Designer SDK\\python": ["logix_designer_sdk-2.2.0-py3-none-any.whl"],
        [python]: ["requirements.txt"],
        [`${python}\\requirements.txt`]: true,
        [dotnet]: [],
      }),
    });

    expect(report.status).toBe("available");
    expect(report.available).toBe(true);
    expect(report.pythonWheelCandidates).toEqual([
      "D:\\Rockwell\\Logix Designer SDK\\python\\logix_designer_sdk-2.2.0-py3-none-any.whl",
    ]);
    expect(report.clients.find((client) => client.id === "python")?.available).toBe(true);
    expect(report.clients.find((client) => client.id === "csharp")?.available).toBe(true);
    expect(report.capabilities.find((capability) => capability.id === "open-save-export-l5x")?.status).toBe("ready");
  });
});
