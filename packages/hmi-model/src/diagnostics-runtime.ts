import type {
  HmiDiagnosticEvent,
  HmiDiagnosticEventInput,
  HmiDiagnosticsClearInput,
  HmiDiagnosticsRuntime,
  HmiDiagnosticsRuntimeOptions,
  HmiDiagnosticsRuntimeSummary,
  HmiDiagnosticsSourceKind,
  HmiDiagnosticsTableRow,
  HmiDiagnosticsTableVariant,
  HmiValidationFinding,
} from "./types";

const DIAGNOSTIC_SOURCES: HmiDiagnosticsSourceKind[] = [
  "validation",
  "import",
  "runtime",
  "hardware-metadata",
  "system",
];

function checksum(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function stableDiagnosticId(input: Pick<HmiDiagnosticEventInput, "source" | "code" | "target" | "message">): string {
  return `diag_${checksum([input.source, input.code, input.target ?? "", input.message].join("|"))}`;
}

function sourceCounts(active: HmiDiagnosticEvent[]): Record<HmiDiagnosticsSourceKind, number> {
  return Object.fromEntries(
    DIAGNOSTIC_SOURCES.map((source) => [source, active.filter((event) => event.source === source).length]),
  ) as Record<HmiDiagnosticsSourceKind, number>;
}

function summarize(runtime: Omit<HmiDiagnosticsRuntime, "summary">): HmiDiagnosticsRuntimeSummary {
  return {
    activeCount: runtime.active.length,
    historyCount: runtime.history.length,
    activeErrorCount: runtime.active.filter((event) => event.severity === "error").length,
    activeWarningCount: runtime.active.filter((event) => event.severity === "warning").length,
    activeInfoCount: runtime.active.filter((event) => event.severity === "info").length,
    sourceCounts: sourceCounts(runtime.active),
  };
}

function applySummary(runtime: Omit<HmiDiagnosticsRuntime, "summary">): HmiDiagnosticsRuntime {
  return {
    ...runtime,
    summary: summarize(runtime),
  };
}

function cloneRuntime(runtime: HmiDiagnosticsRuntime): HmiDiagnosticsRuntime {
  return applySummary({
    maxHistory: runtime.maxHistory,
    active: runtime.active.map((event) => ({ ...event, details: event.details ? { ...event.details } : undefined })),
    history: runtime.history.map((event) => ({ ...event, details: event.details ? { ...event.details } : undefined })),
  });
}

function trimHistory(history: HmiDiagnosticEvent[], maxHistory: number): HmiDiagnosticEvent[] {
  return history.slice(Math.max(0, history.length - maxHistory));
}

function normalizeEvent(input: HmiDiagnosticEventInput, previous?: HmiDiagnosticEvent): HmiDiagnosticEvent {
  const id = input.id?.trim() || stableDiagnosticId(input);
  const timestampMs = input.timestampMs;
  return {
    id,
    firstSeenTimestampMs: previous?.firstSeenTimestampMs ?? timestampMs,
    lastSeenTimestampMs: timestampMs,
    source: input.source,
    severity: input.severity,
    code: input.code.trim() || "diagnostic",
    message: input.message.trim() || input.code.trim() || "Diagnostic event",
    target: input.target?.trim() || undefined,
    details: input.details ? { ...input.details } : undefined,
    status: "active",
    occurrences: (previous?.occurrences ?? 0) + 1,
  };
}

function eventToRow(event: HmiDiagnosticEvent): HmiDiagnosticsTableRow {
  return {
    id: event.id,
    timestampMs: event.lastSeenTimestampMs,
    status: event.status,
    source: event.source,
    severity: event.severity,
    code: event.code,
    message: event.message,
    target: event.target,
    occurrences: event.occurrences,
    clearedTimestampMs: event.clearedTimestampMs,
  };
}

export function createHmiDiagnosticsRuntime(options: HmiDiagnosticsRuntimeOptions = {}): HmiDiagnosticsRuntime {
  const maxHistory = Math.max(1, Math.floor(options.maxHistory ?? 500));
  return applySummary({ active: [], history: [], maxHistory });
}

export function recordHmiDiagnosticEvent(
  runtime: HmiDiagnosticsRuntime,
  input: HmiDiagnosticEventInput,
): HmiDiagnosticsRuntime {
  if (!Number.isFinite(input.timestampMs)) return cloneRuntime(runtime);

  const existingIndex = runtime.active.findIndex((event) => event.id === (input.id?.trim() || stableDiagnosticId(input)));
  const existing = existingIndex >= 0 ? runtime.active[existingIndex] : undefined;
  const event = normalizeEvent(input, existing);
  const active = runtime.active.map((candidate) => ({ ...candidate }));
  if (existingIndex >= 0) active[existingIndex] = event;
  else active.push(event);

  return applySummary({
    maxHistory: runtime.maxHistory,
    active,
    history: trimHistory([...runtime.history.map((candidate) => ({ ...candidate })), event], runtime.maxHistory),
  });
}

export function clearHmiDiagnosticEvents(
  runtime: HmiDiagnosticsRuntime,
  input: HmiDiagnosticsClearInput,
): HmiDiagnosticsRuntime {
  if (!Number.isFinite(input.timestampMs)) return cloneRuntime(runtime);

  const ids = input.ids ? new Set(input.ids) : undefined;
  const active: HmiDiagnosticEvent[] = [];
  const cleared: HmiDiagnosticEvent[] = [];
  for (const event of runtime.active) {
    const selectedById = !ids || ids.has(event.id);
    const selectedBySource = !input.source || input.source === event.source;
    if (selectedById && selectedBySource) {
      cleared.push({
        ...event,
        status: "cleared",
        clearedTimestampMs: input.timestampMs,
        lastSeenTimestampMs: input.timestampMs,
      });
    } else {
      active.push({ ...event });
    }
  }

  return applySummary({
    maxHistory: runtime.maxHistory,
    active,
    history: trimHistory(
      [...runtime.history.map((candidate) => ({ ...candidate })), ...cleared],
      runtime.maxHistory,
    ),
  });
}

export function syncHmiValidationDiagnostics(
  runtime: HmiDiagnosticsRuntime,
  findings: readonly HmiValidationFinding[],
  timestampMs: number,
): HmiDiagnosticsRuntime {
  if (!Number.isFinite(timestampMs)) return cloneRuntime(runtime);

  const nextIds = new Set<string>();
  let next = runtime;
  for (const finding of findings) {
    const eventInput: HmiDiagnosticEventInput = {
      timestampMs,
      source: "validation",
      severity: finding.severity,
      code: finding.ruleId,
      message: finding.message,
      target: finding.target,
    };
    nextIds.add(stableDiagnosticId(eventInput));
    next = recordHmiDiagnosticEvent(next, eventInput);
  }

  const staleValidationIds = next.active
    .filter((event) => event.source === "validation" && !nextIds.has(event.id))
    .map((event) => event.id);
  if (staleValidationIds.length === 0) return next;
  return clearHmiDiagnosticEvents(next, { timestampMs, ids: staleValidationIds });
}

export function hmiDiagnosticsTableRows(
  runtime: HmiDiagnosticsRuntime,
  variant: HmiDiagnosticsTableVariant = "live",
): HmiDiagnosticsTableRow[] {
  const source = variant === "history" ? runtime.history : runtime.active;
  return source
    .map(eventToRow)
    .sort((left, right) => right.timestampMs - left.timestampMs || left.code.localeCompare(right.code));
}
