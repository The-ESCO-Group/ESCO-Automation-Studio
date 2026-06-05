import { describe, expect, it } from "vitest";
import {
  HMI_SYSTEM_TAGS,
  hmiSystemTagDataType,
  hmiSystemTagPaths,
  type HmiSystemTagCategory,
} from "./system-tags";

const VALID_CATEGORIES: readonly HmiSystemTagCategory[] = [
  "alarms",
  "auto-logoff",
  "controller",
  "data-logs",
  "date-time",
  "device",
  "display",
  "ethernet",
  "project-events",
  "security",
  "smtp",
  "vnc",
];

const VALID_DATA_TYPES = ["BOOL", "DINT", "REAL", "STRING"] as const;

describe("HMI_SYSTEM_TAGS registry", () => {
  it("uses unique dotted System.* binding paths", () => {
    const paths = HMI_SYSTEM_TAGS.map((tag) => tag.path);
    // Uniqueness is an invariant the hmiSystemTagDataType Map depends on: a
    // duplicate path would silently shadow the earlier entry's data type.
    expect(new Set(paths).size).toBe(paths.length);
    for (const path of paths) {
      expect(path.startsWith("System.")).toBe(true);
    }
  });

  it("tags every entry with a known atomic type and category", () => {
    for (const tag of HMI_SYSTEM_TAGS) {
      expect(VALID_DATA_TYPES).toContain(tag.dataType);
      expect(VALID_CATEGORIES).toContain(tag.category);
      expect(tag.description.trim().length).toBeGreaterThan(0);
    }
  });
});

describe("hmiSystemTagPaths", () => {
  it("returns exactly the registry paths", () => {
    const paths = hmiSystemTagPaths();
    expect(paths).toEqual(HMI_SYSTEM_TAGS.map((tag) => tag.path));
  });

  it("returns a fresh array that does not mutate the registry", () => {
    const first = hmiSystemTagPaths();
    first.push("System.Injected");
    expect(hmiSystemTagPaths()).not.toContain("System.Injected");
    expect(HMI_SYSTEM_TAGS.some((tag) => tag.path === "System.Injected")).toBe(false);
  });
});

describe("hmiSystemTagDataType", () => {
  it("reports the atomic type for a known path", () => {
    expect(hmiSystemTagDataType("System.DateTime")).toBe("STRING");
    expect(hmiSystemTagDataType("System.AlarmActiveCount")).toBe("DINT");
    expect(hmiSystemTagDataType("System.ControllerConnectionStatus")).toBe("BOOL");
  });

  it("trims surrounding whitespace before lookup", () => {
    expect(hmiSystemTagDataType("  System.DateTime  ")).toBe("STRING");
  });

  it("returns undefined for an unknown or controller-scoped path", () => {
    expect(hmiSystemTagDataType("System.NotARealTag")).toBeUndefined();
    expect(hmiSystemTagDataType("MyControllerTag")).toBeUndefined();
    expect(hmiSystemTagDataType("")).toBeUndefined();
  });

  it("agrees with the registry for every catalogued tag", () => {
    for (const tag of HMI_SYSTEM_TAGS) {
      expect(hmiSystemTagDataType(tag.path)).toBe(tag.dataType);
    }
  });
});
