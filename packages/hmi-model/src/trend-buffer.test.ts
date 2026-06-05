import { describe, expect, it } from "vitest";

import type { HmiTrend } from "./types";
import { createHmiTrendBuffer, exportHmiTrendBufferCsv, recordHmiTrendSample } from "./trend-buffer";

function sampleTrend(): HmiTrend {
  return {
    id: "trend-1",
    name: "Reactor Trend",
    timeRangeSeconds: 600,
    sampleRateMs: 1000,
    traces: [
      { id: "t-temp", label: "Temp", source: { kind: "tag", path: "Reactor.Temp" }, color: "#f00" },
      { id: "t-flow", label: "Flow", source: { kind: "tag", path: "Reactor.Flow" }, color: "#0f0" },
    ],
  };
}

describe("exportHmiTrendBufferCsv", () => {
  it("exports buffered trace samples as CSV with value and quality columns per source path", () => {
    let buffer = createHmiTrendBuffer(sampleTrend());
    buffer = recordHmiTrendSample(buffer, { timestampMs: 1000, values: { "Reactor.Temp": 72.5, "Reactor.Flow": 12 } }).buffer;
    buffer = recordHmiTrendSample(buffer, { timestampMs: 2000, values: { "Reactor.Temp": 73, "Reactor.Flow": null } }).buffer;

    const result = exportHmiTrendBufferCsv(buffer);
    const lines = result.text.trimEnd().split("\n");

    expect(result.fileName).toBe("Reactor-Trend.hmi-trend.csv");
    expect(result.rowCount).toBe(2);
    expect(lines[0]).toBe("timestampMs,timestampIso,Reactor.Temp,Reactor.Temp__quality,Reactor.Flow,Reactor.Flow__quality");
    expect(lines[1]).toBe("1000,1970-01-01T00:00:01.000Z,72.5,good,12,good");
    // null Flow sample is recorded as a bad-quality empty cell, not dropped.
    expect(lines[2]).toBe("2000,1970-01-01T00:00:02.000Z,73,good,,bad");
  });

  it("emits header-only output with zero rows for an empty buffer", () => {
    const result = exportHmiTrendBufferCsv(createHmiTrendBuffer(sampleTrend()));
    expect(result.rowCount).toBe(0);
    expect(result.text).toBe(
      "timestampMs,timestampIso,Reactor.Temp,Reactor.Temp__quality,Reactor.Flow,Reactor.Flow__quality\n",
    );
  });
});
