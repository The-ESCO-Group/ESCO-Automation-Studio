import { describe, expect, it } from "vitest";
import { filterHmiAlarmRecords } from "./alarm-runtime";
import type { HmiAlarmRuntimeRecord } from "./types";

function record(overrides: Partial<HmiAlarmRuntimeRecord>): HmiAlarmRuntimeRecord {
  return {
    alarmId: "a",
    name: "Alarm",
    tagPath: "Tag",
    severity: "warning",
    allowAcknowledge: true,
    state: "active-unacknowledged",
    active: true,
    acknowledged: false,
    suppressed: false,
    quality: "good",
    value: true,
    ...overrides,
  };
}

const alarms: HmiAlarmRuntimeRecord[] = [
  record({ alarmId: "1", name: "Tank High", severity: "critical", area: "Tanks" }),
  record({ alarmId: "2", name: "Motor Fault", severity: "warning", area: "Motors" }),
  record({ alarmId: "3", name: "Tank Low", severity: "minor", area: "Tanks", message: "below setpoint" }),
];

describe("filterHmiAlarmRecords", () => {
  it("passes everything for a blank filter", () => {
    expect(filterHmiAlarmRecords(alarms, "")).toHaveLength(3);
    expect(filterHmiAlarmRecords(alarms, undefined)).toHaveLength(3);
  });

  it("substring-matches across name/area/severity/message (case-insensitive)", () => {
    expect(filterHmiAlarmRecords(alarms, "tank").map((a) => a.alarmId)).toEqual(["1", "3"]);
    expect(filterHmiAlarmRecords(alarms, "motors").map((a) => a.alarmId)).toEqual(["2"]);
    expect(filterHmiAlarmRecords(alarms, "setpoint").map((a) => a.alarmId)).toEqual(["3"]);
  });

  it("supports field-scoped terms and AND across terms", () => {
    expect(filterHmiAlarmRecords(alarms, "severity:critical").map((a) => a.alarmId)).toEqual(["1"]);
    expect(filterHmiAlarmRecords(alarms, "area:tanks").map((a) => a.alarmId)).toEqual(["1", "3"]);
    expect(filterHmiAlarmRecords(alarms, "area:tanks severity:minor").map((a) => a.alarmId)).toEqual(["3"]);
  });
});
