import { describe, expect, it } from "vitest";
import { capList, virtualWindow } from "./windowing";

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

describe("virtualWindow", () => {
  it("returns all items below the virtualization threshold", () => {
    const result = virtualWindow([1, 2, 3], {
      scrollTop: 0,
      viewportHeight: 200,
      rowHeight: 40,
      minimumTotal: 10,
    });
    expect(result.active).toBe(false);
    expect(result.items).toEqual([1, 2, 3]);
    expect(result.startIndex).toBe(0);
    expect(result.endIndex).toBe(3);
  });

  it("windows large lists from the current scroll offset with overscan", () => {
    const items = Array.from({ length: 200 }, (_, i) => i);
    const result = virtualWindow(items, {
      scrollTop: 500,
      viewportHeight: 300,
      rowHeight: 50,
      overscan: 2,
      minimumTotal: 100,
    });
    expect(result.active).toBe(true);
    expect(result.startIndex).toBe(8);
    expect(result.endIndex).toBe(18);
    expect(result.items).toEqual(items.slice(8, 18));
    expect(result.beforePx).toBe(400);
    expect(result.afterPx).toBe((200 - 18) * 50);
    expect(result.truncated).toBe(true);
  });

  it("clamps the window near the end of the list", () => {
    const items = Array.from({ length: 12 }, (_, i) => i);
    const result = virtualWindow(items, {
      scrollTop: 10_000,
      viewportHeight: 120,
      rowHeight: 30,
      overscan: 1,
      minimumTotal: 1,
    });
    expect(result.startIndex).toBe(6);
    expect(result.endIndex).toBe(12);
    expect(result.items).toEqual([6, 7, 8, 9, 10, 11]);
    expect(result.afterPx).toBe(0);
  });
});
