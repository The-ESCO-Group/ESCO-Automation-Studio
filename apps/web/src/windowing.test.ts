import { describe, expect, it } from "vitest";
import { capList } from "./windowing";

describe("capList", () => {
  it("returns everything when under the limit", () => {
    const result = capList([1, 2, 3], 10);
    expect(result.items).toEqual([1, 2, 3]);
    expect(result.total).toBe(3);
    expect(result.truncated).toBe(false);
    expect(result.hidden).toBe(0);
  });

  it("caps and reports the hidden remainder when over the limit", () => {
    const items = Array.from({ length: 250 }, (_, i) => i);
    const result = capList(items, 200);
    expect(result.items).toHaveLength(200);
    expect(result.items[0]).toBe(0);
    expect(result.total).toBe(250);
    expect(result.truncated).toBe(true);
    expect(result.hidden).toBe(50);
  });

  it("treats limit <= 0 as no cap", () => {
    const result = capList([1, 2], 0);
    expect(result.truncated).toBe(false);
    expect(result.items).toEqual([1, 2]);
  });
});
