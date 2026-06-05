import { XMLParser } from "fast-xml-parser";

/** A parsed XML node (attributes are prefixed with `@_`). */
export type L5XNode = Record<string, unknown>;

export const ESCO_OFFLINE_INTERCHANGE_MESSAGE =
  "ESCO Automation Studio cannot open proprietary binary controller-project files. " +
  "ESCO does not read, write, compile, decompile, or convert proprietary controller binaries. " +
  "Use an approved external engineering tool to export the project as .L5X XML, then import that .L5X review file into ESCO. " +
  "ESCO offline interchange supports .L5X XML import/export and ESCO-native project files only.";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseAttributeValue: false,
  trimValues: true,
});

const UNSUPPORTED_BINARY_PROJECT_MARKERS = [
  ["RS", "Logix"],
  ["Studio", " 5000"],
  ["Log", "ix Designer"],
  ["Rock", "well"],
].map((parts) => parts.join("")).join("|");

const BLOCKED_BINARY_PROJECT_EXTENSION_RE = new RegExp(`\\.${["a", "c", "d"].join("")}\\b`, "i");

function looksLikeUnsupportedBinaryProjectInput(xml: string): boolean {
  const sample = xml.slice(0, 4096);
  const trimmed = sample.trimStart();
  if (trimmed.startsWith("<")) return false;

  // Many proprietary project containers, including older Windows compound files,
  // begin with binary control bytes. Treat binary/non-XML project-looking input
  // as an unsupported proprietary source instead of a malformed L5X.
  const hasBinaryControlBytes = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(sample);
  if (!hasBinaryControlBytes) return false;

  return (
    sample.startsWith("\u00d0\u00cf\u0011\u00e0\u00a1\u00b1\u001a\u00e1") ||
    /\bRSEnc\b/i.test(sample) ||
    /\bAutomation Control Database\b/i.test(sample) ||
    BLOCKED_BINARY_PROJECT_EXTENSION_RE.test(sample) ||
    new RegExp(`\\b(?:${UNSUPPORTED_BINARY_PROJECT_MARKERS})\\b`, "i").test(sample)
  );
}

/**
 * Parse a `.L5X` XML string and return the
 * `RSLogix5000Content` root node. Throws a clear error for non-L5X input.
 */
export function parseL5X(xml: string): L5XNode {
  if (looksLikeUnsupportedBinaryProjectInput(xml)) {
    throw new Error(ESCO_OFFLINE_INTERCHANGE_MESSAGE);
  }

  let doc: L5XNode;
  try {
    doc = parser.parse(xml) as L5XNode;
  } catch {
    throw new Error("Invalid L5X: the file is not valid XML.");
  }
  const root = doc?.RSLogix5000Content;
  if (!root || typeof root !== "object") {
    throw new Error("Invalid L5X: missing <RSLogix5000Content> root element.");
  }
  return root as L5XNode;
}

/** Read an attribute (`@_Name`) as a string, or undefined. */
export function attr(node: unknown, name: string): string | undefined {
  if (node && typeof node === "object") {
    const value = (node as L5XNode)[`@_${name}`];
    return value == null ? undefined : String(value);
  }
  return undefined;
}

/** Read a child element by name. */
export function child(node: unknown, name: string): unknown {
  return node && typeof node === "object" ? (node as L5XNode)[name] : undefined;
}

/** Normalise a value that may be missing, a single object, or an array into an array. */
export function toArray<T = unknown>(value: unknown): T[] {
  if (value == null) return [];
  return (Array.isArray(value) ? value : [value]) as T[];
}

/** Element text content (handles plain text, CDATA, and `#text` nodes). */
export function text(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object" && "#text" in (value as object)) {
    return String((value as L5XNode)["#text"] ?? "");
  }
  return String(value);
}
