import { XMLParser } from "fast-xml-parser";

/** A parsed XML node (attributes are prefixed with `@_`). */
export type L5XNode = Record<string, unknown>;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseAttributeValue: false,
  trimValues: true,
});

/**
 * Parse a `.L5X` (RSLogix 5000 export) XML string and return the
 * `RSLogix5000Content` root node. Throws a clear error for non-L5X input.
 */
export function parseL5X(xml: string): L5XNode {
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
