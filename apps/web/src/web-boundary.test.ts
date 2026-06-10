import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

interface BannedImport {
  pattern: RegExp;
  reason: string;
}

const BANNED_IMPORTS: BannedImport[] = [
  { pattern: /^@esco\/controller-gateway(?:\/|$)/, reason: "backend gateway package" },
  { pattern: /^@esco\/driver(?:-|\/|$)/, reason: "PLC driver package" },
  { pattern: /^node-opcua(?:\/|$)/, reason: "OPC UA runtime" },
  { pattern: /^(?:ethernet-ip|st-ethernet-ip|node-ethernet-ip)(?:\/|$)/i, reason: "EtherNet/IP runtime" },
  { pattern: /^(?:node:)?(?:net|dgram|tls)$/, reason: "raw socket transport" },
];

const srcRoot = dirname(fileURLToPath(import.meta.url));
const webRoot = dirname(srcRoot);

describe("web/backend online boundary", () => {
  it("keeps browser code away from gateway and PLC driver packages", () => {
    const violations = productionSourceFiles(srcRoot).flatMap((filePath) => {
      const text = readFileSync(filePath, "utf8");
      return importSpecifiers(text).flatMap((specifier) => {
        const banned = BANNED_IMPORTS.find(({ pattern }) => pattern.test(specifier));
        if (!banned) return [];
        return [{
          file: relative(webRoot, filePath).replace(/\\/g, "/"),
          specifier,
          reason: banned.reason,
        }];
      });
    });

    expect(violations).toEqual([]);
  });

  it("keeps the web package manifest free of backend gateway and PLC driver dependencies", () => {
    const manifest = JSON.parse(readFileSync(join(webRoot, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      optionalDependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };
    const dependencySections = [
      manifest.dependencies,
      manifest.devDependencies,
      manifest.optionalDependencies,
      manifest.peerDependencies,
    ];
    const violations = dependencySections.flatMap((section) =>
      Object.keys(section ?? {}).flatMap((specifier) => {
        const banned = BANNED_IMPORTS.find(({ pattern }) => pattern.test(specifier));
        return banned ? [{ specifier, reason: banned.reason }] : [];
      }),
    );

    expect(violations).toEqual([]);
  });

  it("keeps executable target adapter contracts out of browser production code", () => {
    const executableContractNames = [
      "TargetAdapter",
      "TargetAdapterRegistry",
      "ExecutableTargetAdapterRegistry",
      "preflightDownload",
      "getExecutableAdapter",
      "register(adapter",
    ];
    const violations = productionSourceFiles(srcRoot).flatMap((filePath) => {
      const text = readFileSync(filePath, "utf8");
      return executableContractNames.flatMap((name) => {
        const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const pattern = name.includes("(") ? new RegExp(escaped) : new RegExp(`\\b${escaped}\\b`);
        return pattern.test(text)
          ? [{
              file: relative(webRoot, filePath).replace(/\\/g, "/"),
              name,
            }]
          : [];
      });
    });

    expect(violations).toEqual([]);
  });
});

function productionSourceFiles(root: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const fullPath = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...productionSourceFiles(fullPath));
    } else if (/\.(?:ts|tsx|js|jsx)$/.test(entry.name) && !/\.test\.(?:ts|tsx|js|jsx)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
}

function importSpecifiers(text: string): string[] {
  const specifiers: string[] = [];
  const staticImport = /(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\s+from\s*)?["']([^"']+)["']/gs;
  const dynamicImport = /import\s*\(\s*["']([^"']+)["']\s*\)/g;
  for (const match of text.matchAll(staticImport)) specifiers.push(match[1]);
  for (const match of text.matchAll(dynamicImport)) specifiers.push(match[1]);
  return specifiers;
}
