import type {
  HmiAlarmDefinition,
  HmiAlarmHistoryEvent,
  HmiAlarmOperationInput,
  HmiAlarmQuality,
  HmiAlarmRuntime,
  HmiAlarmRuntimeInput,
  HmiAlarmRuntimeRecord,
  HmiAlarmRuntimeSummary,
  HmiAlarmState,
  HmiAlarmTableRow,
  HmiAlarmTableVariant,
} from "./types";

const SEVERITY_RANK: Record<HmiAlarmRuntimeRecord["severity"], number> = {
  critical: 5,
  major: 4,
  minor: 3,
  warning: 2,
  info: 1,
};

function normalizeQuality(value: string | number | boolean | null | undefined): {
  value: string | number | boolean | null;
  quality: HmiAlarmQuality;
} {
  if (value === undefined) return { value: null, quality: "missing" };
  if (value === null) return { value: null, quality: "bad" };
  if (typeof value === "number" && !Number.isFinite(value)) return { value: null, quality: "bad" };
  return { value, quality: "good" };
}

function cloneRuntime(runtime: HmiAlarmRuntime): HmiAlarmRuntime {
  return {
    alarms: runtime.alarms.map((alarm) => ({ ...alarm })),
    history: runtime.history.map((event) => ({ ...event })),
    summary: {
      ...runtime.summary,
      systemTags: { ...runtime.summary.systemTags },
    },
  };
}

function eventFor(record: HmiAlarmRuntimeRecord, timestampMs: number, eventType: HmiAlarmHistoryEvent["eventType"]): HmiAlarmHistoryEvent {
  return {
    alarmId: record.alarmId,
    timestampMs,
    eventType,
    state: record.state,
    quality: record.quality,
    value: record.value,
    message: record.message,
  };
}

function alarmState(active: boolean, acknowledged: boolean, suppressed: boolean, returnedUnacknowledged = false): HmiAlarmState {
  if (suppressed) return "suppressed";
  if (active) return acknowledged ? "active-acknowledged" : "active-unacknowledged";
  return returnedUnacknowledged ? "returned-unacknowledged" : "normal";
}

function triggerActive(definition: HmiAlarmDefinition, value: string | number | boolean, previousActive: boolean): boolean {
  const deadband = definition.trigger.deadband ?? 0;
  if (definition.trigger.kind === "digital") {
    const activeValue = definition.trigger.activeValue ?? true;
    return value === activeValue;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) return previousActive;
  const threshold = definition.trigger.threshold ?? 0;
  if (definition.trigger.kind === "analog-high") {
    return previousActive ? value >= threshold - deadband : value >= threshold;
  }
  return previousActive ? value <= threshold + deadband : value <= threshold;
}

function summarize(alarms: HmiAlarmRuntimeRecord[]): HmiAlarmRuntimeSummary {
  const activeCount = alarms.filter((alarm) => alarm.active && !alarm.suppressed).length;
  const unacknowledgedCount = alarms.filter(
    (alarm) => !alarm.suppressed && !alarm.acknowledged && (alarm.active || alarm.state === "returned-unacknowledged"),
  ).length;
  const acknowledgedCount = alarms.filter((alarm) => alarm.active && alarm.acknowledged && !alarm.suppressed).length;
  const suppressedCount = alarms.filter((alarm) => alarm.suppressed).length;
  return {
    activeCount,
    unacknowledgedCount,
    acknowledgedCount,
    suppressedCount,
    badQualityCount: alarms.filter((alarm) => alarm.quality !== "good").length,
    systemTags: {
      "System.AlarmActiveCount": activeCount,
      "System.AlarmUnacknowledgedCount": unacknowledgedCount,
      "System.AlarmAcknowledgedCount": acknowledgedCount,
      "System.AlarmSuppressedCount": suppressedCount,
    },
  };
}

function applySummary(runtime: Omit<HmiAlarmRuntime, "summary">): HmiAlarmRuntime {
  return {
    ...runtime,
    summary: summarize(runtime.alarms),
  };
}

function operationTargets(alarmIds: string[] | undefined): Set<string> | undefined {
  if (!alarmIds) return undefined;
  return new Set(alarmIds);
}

function recordTimestamp(record: HmiAlarmRuntimeRecord): number | undefined {
  return Math.max(
    record.lastTransitionMs ?? -1,
    record.activeSinceMs ?? -1,
    record.returnTimestampMs ?? -1,
    record.acknowledgedTimestampMs ?? -1,
    record.suppressedTimestampMs ?? -1,
    record.resetTimestampMs ?? -1,
  );
}

function rowActive(state: HmiAlarmState): boolean {
  return state === "active-unacknowledged" || state === "active-acknowledged";
}

function rowAcknowledged(state: HmiAlarmState): boolean {
  return state === "active-acknowledged" || state === "normal";
}

function rowSuppressed(state: HmiAlarmState): boolean {
  return state === "suppressed";
}

function rowMetadata(runtime: HmiAlarmRuntime): Map<string, HmiAlarmRuntimeRecord> {
  return new Map(runtime.alarms.map((alarm) => [alarm.alarmId, alarm]));
}

function recordToTableRow(record: HmiAlarmRuntimeRecord): HmiAlarmTableRow {
  const timestampMs = recordTimestamp(record);
  const base = {
    id: record.alarmId,
    alarmId: record.alarmId,
    name: record.name,
    tagPath: record.tagPath,
    severity: record.severity,
    state: record.state,
    quality: record.quality,
    value: record.value,
    message: record.message,
    area: record.area,
    active: record.active,
    acknowledged: record.acknowledged,
    suppressed: record.suppressed,
    allowAcknowledge: record.allowAcknowledge,
    disabled: record.disabled,
    activeSinceMs: record.activeSinceMs,
    returnTimestampMs: record.returnTimestampMs,
    acknowledgedTimestampMs: record.acknowledgedTimestampMs,
    suppressedTimestampMs: record.suppressedTimestampMs,
    resetTimestampMs: record.resetTimestampMs,
  };
  return timestampMs !== undefined && timestampMs >= 0 ? { ...base, timestampMs } : base;
}

function historyToTableRow(
  event: HmiAlarmHistoryEvent,
  metadata: HmiAlarmRuntimeRecord | undefined,
  index: number,
): HmiAlarmTableRow {
  return {
    id: `${event.alarmId}:${event.timestampMs}:${event.eventType}:${index}`,
    alarmId: event.alarmId,
    name: metadata?.name ?? event.alarmId,
    tagPath: metadata?.tagPath ?? "",
    severity: metadata?.severity ?? "info",
    state: event.state,
    quality: event.quality,
    value: event.value,
    message: event.message ?? metadata?.message,
    area: metadata?.area,
    active: rowActive(event.state),
    acknowledged: rowAcknowledged(event.state),
    suppressed: rowSuppressed(event.state),
    allowAcknowledge: metadata?.allowAcknowledge ?? false,
    disabled: metadata?.disabled,
    timestampMs: event.timestampMs,
    activeSinceMs: metadata?.activeSinceMs,
    returnTimestampMs: event.eventType === "returned" ? event.timestampMs : metadata?.returnTimestampMs,
    acknowledgedTimestampMs: event.eventType === "acknowledged" ? event.timestampMs : metadata?.acknowledgedTimestampMs,
    suppressedTimestampMs: event.eventType === "suppressed" ? event.timestampMs : metadata?.suppressedTimestampMs,
    resetTimestampMs: event.eventType === "reset" ? event.timestampMs : metadata?.resetTimestampMs,
    eventType: event.eventType,
  };
}

function compareRows(left: HmiAlarmTableRow, right: HmiAlarmTableRow): number {
  return (
    (right.timestampMs ?? -1) - (left.timestampMs ?? -1) ||
    SEVERITY_RANK[right.severity] - SEVERITY_RANK[left.severity] ||
    left.name.localeCompare(right.name) ||
    left.alarmId.localeCompare(right.alarmId) ||
    (left.eventType ?? "").localeCompare(right.eventType ?? "")
  );
}

export function createHmiAlarmRuntime(definitions: readonly HmiAlarmDefinition[]): HmiAlarmRuntime {
  const alarms: HmiAlarmRuntimeRecord[] = definitions.map((definition) => ({
    alarmId: definition.id,
    name: definition.name,
    tagPath: definition.tagPath,
    severity: definition.severity,
    message: definition.message,
    area: definition.area,
    allowAcknowledge: definition.allowAcknowledge,
    state: "normal",
    active: false,
    acknowledged: true,
    suppressed: false,
    quality: definition.enabled === false ? "bad" : "missing",
    value: null,
    disabled: definition.enabled === false,
  }));
  return { alarms, history: [], summary: summarize(alarms) };
}

/**
 * Filter runtime alarm records by an alarm-summary filter expression. A blank
 * filter passes everything. Supports field-scoped terms (`severity:critical`,
 * `area:Tank`) and plain substring terms; all whitespace-separated terms must
 * match (AND), case-insensitively, across name/area/severity/message.
 */
export function filterHmiAlarmRecords<
  T extends Pick<HmiAlarmRuntimeRecord, "area" | "message" | "name" | "severity" | "state"> & { eventType?: string },
>(
  alarms: readonly T[],
  filter: string | undefined,
): T[] {
  const query = (filter ?? "").trim().toLowerCase();
  if (!query) return [...alarms];
  const terms = query.split(/\s+/).filter(Boolean);
  return alarms.filter((alarm) =>
    terms.every((term) => {
      const [field, ...rest] = term.split(":");
      const scoped = rest.length > 0 ? rest.join(":") : undefined;
      if (scoped !== undefined) {
        if (field === "severity") return alarm.severity.toLowerCase().includes(scoped);
        if (field === "area") return (alarm.area ?? "").toLowerCase().includes(scoped);
        if (field === "name") return alarm.name.toLowerCase().includes(scoped);
        if (field === "state") return alarm.state.toLowerCase().includes(scoped);
        if (field === "event" || field === "eventtype") return (alarm.eventType ?? "").toLowerCase().includes(scoped);
      }
      return (
        alarm.name.toLowerCase().includes(term) ||
        (alarm.area ?? "").toLowerCase().includes(term) ||
        alarm.severity.toLowerCase().includes(term) ||
        alarm.state.toLowerCase().includes(term) ||
        (alarm.eventType ?? "").toLowerCase().includes(term) ||
        (alarm.message ?? "").toLowerCase().includes(term)
      );
    }),
  );
}

export function hmiAlarmTableRows(
  runtime: HmiAlarmRuntime,
  variant: HmiAlarmTableVariant = "summary",
): HmiAlarmTableRow[] {
  if (variant === "history") {
    const metadata = rowMetadata(runtime);
    return runtime.history
      .map((event, index) => historyToTableRow(event, metadata.get(event.alarmId), index))
      .sort(compareRows);
  }

  const source = variant === "manager"
    ? runtime.alarms
    : runtime.alarms.filter((alarm) => alarm.state !== "normal" || alarm.quality !== "good" || alarm.disabled);
  return source.map(recordToTableRow).sort(compareRows);
}

export function evaluateHmiAlarmRuntime(
  runtime: HmiAlarmRuntime,
  definitions: readonly HmiAlarmDefinition[],
  input: HmiAlarmRuntimeInput,
): HmiAlarmRuntime {
  if (!Number.isFinite(input.timestampMs)) return cloneRuntime(runtime);

  const previousById = new Map(runtime.alarms.map((alarm) => [alarm.alarmId, alarm]));
  const history: HmiAlarmHistoryEvent[] = runtime.history.map((event) => ({ ...event }));
  const alarms = definitions.map((definition) => {
    const previous = previousById.get(definition.id);
    const base: HmiAlarmRuntimeRecord = previous
      ? { ...previous }
      : createHmiAlarmRuntime([definition]).alarms[0]!;
    base.name = definition.name;
    base.tagPath = definition.tagPath;
    base.severity = definition.severity;
    base.message = definition.message;
    base.area = definition.area;
    base.allowAcknowledge = definition.allowAcknowledge;
    base.disabled = definition.enabled === false;

    if (definition.enabled === false) {
      const disabled: HmiAlarmRuntimeRecord = {
        ...base,
        active: false,
        acknowledged: true,
        state: "normal",
        quality: "bad",
        value: null,
      };
      if (previous?.quality !== disabled.quality) history.push(eventFor(disabled, input.timestampMs, "quality-changed"));
      return disabled;
    }

    const raw = Object.prototype.hasOwnProperty.call(input.values, definition.tagPath)
      ? input.values[definition.tagPath]
      : undefined;
    const normalized = normalizeQuality(raw);
    const next: HmiAlarmRuntimeRecord = {
      ...base,
      quality: normalized.quality,
      value: normalized.value,
    };

    if (previous && previous.quality !== next.quality) {
      history.push(eventFor(next, input.timestampMs, "quality-changed"));
    }
    if (normalized.quality !== "good") return next;

    const active = triggerActive(definition, normalized.value as string | number | boolean, base.active);
    if (active && !base.active) {
      next.active = true;
      next.acknowledged = false;
      next.activeSinceMs = input.timestampMs;
      next.returnTimestampMs = undefined;
      next.lastTransitionMs = input.timestampMs;
      next.state = alarmState(true, false, next.suppressed);
      history.push(eventFor(next, input.timestampMs, "activated"));
      return next;
    }
    if (!active && base.active) {
      next.active = false;
      next.returnTimestampMs = input.timestampMs;
      next.lastTransitionMs = input.timestampMs;
      next.state = alarmState(false, next.acknowledged, next.suppressed, !next.acknowledged);
      history.push(eventFor(next, input.timestampMs, "returned"));
      return next;
    }

    next.active = active;
    next.state = alarmState(active, next.acknowledged, next.suppressed, !active && !next.acknowledged);
    return next;
  });

  return applySummary({ alarms, history });
}

export function acknowledgeHmiAlarms(runtime: HmiAlarmRuntime, input: HmiAlarmOperationInput): HmiAlarmRuntime {
  if (!Number.isFinite(input.timestampMs)) return cloneRuntime(runtime);
  const targets = operationTargets(input.alarmIds);
  const history = runtime.history.map((event) => ({ ...event }));
  const alarms = runtime.alarms.map((alarm) => {
    if (targets && !targets.has(alarm.alarmId)) return { ...alarm };
    if (alarm.acknowledged || alarm.suppressed || !alarm.allowAcknowledge) return { ...alarm };
    const next: HmiAlarmRuntimeRecord = {
      ...alarm,
      acknowledged: true,
      acknowledgedTimestampMs: input.timestampMs,
      state: alarmState(alarm.active, true, alarm.suppressed),
    };
    history.push(eventFor(next, input.timestampMs, "acknowledged"));
    return next;
  });
  return applySummary({ alarms, history });
}

export function resetHmiAlarms(runtime: HmiAlarmRuntime, input: HmiAlarmOperationInput): HmiAlarmRuntime {
  if (!Number.isFinite(input.timestampMs)) return cloneRuntime(runtime);
  const targets = operationTargets(input.alarmIds);
  const history = runtime.history.map((event) => ({ ...event }));
  const alarms = runtime.alarms.map((alarm) => {
    if (targets && !targets.has(alarm.alarmId)) return { ...alarm };
    if (alarm.active || alarm.suppressed || (alarm.state === "normal" && alarm.acknowledged)) return { ...alarm };
    const next: HmiAlarmRuntimeRecord = {
      ...alarm,
      active: false,
      acknowledged: true,
      state: "normal",
      resetTimestampMs: input.timestampMs,
      lastTransitionMs: input.timestampMs,
    };
    history.push(eventFor(next, input.timestampMs, "reset"));
    return next;
  });
  return applySummary({ alarms, history });
}

export function suppressHmiAlarms(runtime: HmiAlarmRuntime, input: HmiAlarmOperationInput): HmiAlarmRuntime {
  if (!Number.isFinite(input.timestampMs)) return cloneRuntime(runtime);
  const targets = operationTargets(input.alarmIds);
  const history = runtime.history.map((event) => ({ ...event }));
  const alarms = runtime.alarms.map((alarm) => {
    if (targets && !targets.has(alarm.alarmId)) return { ...alarm };
    if (alarm.suppressed) return { ...alarm };
    const next: HmiAlarmRuntimeRecord = {
      ...alarm,
      suppressed: true,
      suppressedTimestampMs: input.timestampMs,
      state: "suppressed",
    };
    history.push(eventFor(next, input.timestampMs, "suppressed"));
    return next;
  });
  return applySummary({ alarms, history });
}

export function unsuppressHmiAlarms(runtime: HmiAlarmRuntime, input: HmiAlarmOperationInput): HmiAlarmRuntime {
  if (!Number.isFinite(input.timestampMs)) return cloneRuntime(runtime);
  const targets = operationTargets(input.alarmIds);
  const history = runtime.history.map((event) => ({ ...event }));
  const alarms = runtime.alarms.map((alarm) => {
    if (targets && !targets.has(alarm.alarmId)) return { ...alarm };
    if (!alarm.suppressed) return { ...alarm };
    const next: HmiAlarmRuntimeRecord = {
      ...alarm,
      suppressed: false,
      state: alarmState(alarm.active, alarm.acknowledged, false, !alarm.active && !alarm.acknowledged),
    };
    history.push(eventFor(next, input.timestampMs, "unsuppressed"));
    return next;
  });
  return applySummary({ alarms, history });
}
