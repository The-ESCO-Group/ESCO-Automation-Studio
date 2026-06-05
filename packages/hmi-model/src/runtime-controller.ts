import {
  acknowledgeHmiAlarms,
  createHmiAlarmRuntime,
  evaluateHmiAlarmRuntime,
  filterHmiAlarmRecords,
  hmiAlarmTableRows,
  resetHmiAlarms,
} from "./alarm-runtime";
import { HmiBindingEngine, type HmiBindingDiagnostic, type HmiElementRuntimeState } from "./binding-engine";
import {
  createHmiRuntimeSession,
  executeHmiRuntimeCommand,
  setHmiRuntimeSessionRoles,
} from "./runtime-session";
import {
  clearHmiDataLogBuffer,
  createHmiDataLogBuffer,
  exportHmiDataLogBufferCsv,
  recordHmiDataLogSample,
} from "./data-log-buffer";
import {
  clearHmiDiagnosticEvents,
  createHmiDiagnosticsRuntime,
  hmiDiagnosticsTableRows,
  recordHmiDiagnosticEvent,
} from "./diagnostics-runtime";
import {
  SimulatorTagProvider,
  type HmiTagValue,
  type RuntimeTagProvider,
} from "./runtime-tag-provider";
import { createHmiTrendBuffer, recordHmiTrendSample } from "./trend-buffer";
import { renderHmiTrendChartPreview } from "./trend-chart-preview";
import { hmiLanguageOptions, hmiLocalizedSystemTags, type HmiLanguageOption } from "./localization";
import type {
  HmiAlarmRuntime,
  HmiAlarmTableRow,
  HmiAlarmTableVariant,
  HmiCommand,
  HmiDataLogBuffer,
  HmiDataLogExportResult,
  HmiDiagnosticsRuntime,
  HmiDiagnosticsSourceKind,
  HmiDiagnosticsTableRow,
  HmiDiagnosticsTableVariant,
  HmiGraphicElement,
  HmiProject,
  HmiRecipeApplyResult,
  HmiRuntimeSession,
  HmiSurfaceBase,
  HmiRecipe,
  HmiRecipeApplyRow,
  HmiTrendBuffer,
  HmiTrendChartPreview,
  HmiTrendChartRenderOptions,
} from "./types";

/**
 * Live HMI runtime controller — the operator-interface "engine" that turns a
 * static {@link HmiProject} into a running preview. It owns:
 *   - a {@link RuntimeTagProvider} (live tag values),
 *   - a {@link HmiBindingEngine} (objects resolved from those values),
 *   - the alarm runtime, trend buffers, and data-log buffers (sampled from the same values),
 *   - the command session (navigation / popups / security / language).
 *
 * Operator actions (button writes, toggles, momentary, increment, navigation,
 * alarm acknowledge, …) all flow through real model/provider calls here — never
 * cosmetic state. Everything is deterministic and offline.
 */

export type HmiRuntimeAction =
  | { kind: "write-tag"; path: string; value: HmiTagValue }
  | { kind: "set-tag"; path: string; value: HmiTagValue }
  | { kind: "toggle-tag"; path: string }
  | { kind: "momentary"; path: string; phase: "press" | "release"; pressedValue?: HmiTagValue; releasedValue?: HmiTagValue }
  | { kind: "increment"; path: string; by?: number; max?: number }
  | { kind: "decrement"; path: string; by?: number; min?: number }
  | { kind: "navigate"; screenId: string }
  | { kind: "open-popup"; popupId: string }
  | { kind: "close-popup"; popupId?: string }
  | { kind: "acknowledge-alarm"; alarmIds?: string[] }
  | { kind: "acknowledge-all-visible" }
  | { kind: "reset-alarm"; alarmIds?: string[] }
  | { kind: "reset-all-visible" }
  | { kind: "set-language"; languageId: string }
  | { kind: "export-data-log"; dataLogId: string }
  | { kind: "clear-data-log"; dataLogId: string }
  | { kind: "apply-recipe"; recipeId: string }
  | { kind: "login"; username: string }
  | { kind: "logout" };

export interface HmiRuntimeActionContext {
  sourceObjectId?: string;
}

export interface HmiRuntimeActionResult {
  ok: boolean;
  message: string;
}

export interface HmiRuntimeControllerOptions {
  provider?: RuntimeTagProvider;
  clock?: () => number;
}

let actionCounter = 0;

function diagnosticChecksum(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function runtimeDiagnosticTarget(diagnostic: HmiBindingDiagnostic): string {
  const targetProperty = diagnostic.targetProperty.trim();
  if (diagnostic.elementId.trim()) {
    return `hmi/element:${diagnostic.elementId}${targetProperty ? `/property:${targetProperty}` : ""}`;
  }
  return targetProperty ? `hmi/runtime:${targetProperty}` : "hmi/runtime";
}

function runtimeDiagnosticId(diagnostic: HmiBindingDiagnostic): string {
  return `runtime_${diagnosticChecksum(
    [diagnostic.elementId, diagnostic.targetProperty, diagnostic.code, diagnostic.message].join("|"),
  )}`;
}

function canAccessRecipe(recipe: HmiRecipe, activeRoleIds: readonly string[]): boolean {
  const required = recipe.securityRoleIds.map((roleId) => roleId.trim()).filter(Boolean);
  if (required.length === 0) return true;
  const active = new Set(activeRoleIds);
  return required.some((roleId) => active.has(roleId));
}

export class HmiRuntimeController {
  readonly provider: RuntimeTagProvider;
  readonly bindingEngine: HmiBindingEngine;
  private session: HmiRuntimeSession;
  private alarmRuntime: HmiAlarmRuntime;
  private trendBuffers = new Map<string, HmiTrendBuffer>();
  private dataLogBuffers = new Map<string, HmiDataLogBuffer>();
  private diagnosticsRuntime: HmiDiagnosticsRuntime = createHmiDiagnosticsRuntime({ maxHistory: 200 });
  private recipeApplyHistory: HmiRecipeApplyResult[] = [];
  private readonly clock: () => number;
  private readonly actionDiagnostics: HmiBindingDiagnostic[] = [];
  private running = false;
  private disposed = false;

  constructor(private project: HmiProject, options: HmiRuntimeControllerOptions = {}) {
    this.clock = options.clock ?? (() => Date.now());
    this.provider =
      options.provider ??
      new SimulatorTagProvider({ controllerReferences: project.controllerReferences, clock: this.clock });
    this.session = createHmiRuntimeSession(project);
    this.alarmRuntime = createHmiAlarmRuntime(project.alarms);
    for (const trend of project.trends) this.trendBuffers.set(trend.id, createHmiTrendBuffer(trend));
    for (const log of project.dataLogs) this.dataLogBuffers.set(log.id, createHmiDataLogBuffer(log));
    this.bindingEngine = new HmiBindingEngine(this.provider, {
      systemTags: this.session.systemTags,
      clock: this.clock,
    });
  }

  /** Begin the preview: bind the active screen's objects and seed alarm/trend state. */
  start(): void {
    if (this.disposed) throw new Error("Runtime controller has been disposed.");
    this.running = true;
    this.refreshBoundElements();
    this.tick(this.clock());
  }

  get isRunning(): boolean {
    return this.running;
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  getSession(): HmiRuntimeSession {
    return this.session;
  }

  getAlarmRuntime(): HmiAlarmRuntime {
    return this.alarmRuntime;
  }

  getAlarmTableRows(variant: HmiAlarmTableVariant = "summary", filter?: string): HmiAlarmTableRow[] {
    const rows = hmiAlarmTableRows(this.alarmRuntime, variant);
    return filterHmiAlarmRecords(rows, filter);
  }

  getTrendBuffer(trendId: string): HmiTrendBuffer | undefined {
    return this.trendBuffers.get(trendId);
  }

  getTrendBuffers(): HmiTrendBuffer[] {
    return [...this.trendBuffers.values()];
  }

  getDataLogBuffer(dataLogId: string): HmiDataLogBuffer | undefined {
    return this.dataLogBuffers.get(dataLogId);
  }

  getDataLogBuffers(): HmiDataLogBuffer[] {
    return [...this.dataLogBuffers.values()];
  }

  getRecipeApplyHistory(): HmiRecipeApplyResult[] {
    return this.recipeApplyHistory.map((entry) => ({
      ...entry,
      rows: entry.rows.map((row) => ({ ...row })),
    }));
  }

  private roleNames(roleIds: readonly string[]): string {
    const names = new Map(this.project.security.roles.map((role) => [role.id, role.name]));
    return roleIds.map((roleId) => names.get(roleId) ?? roleId).join(", ") || "configured role";
  }

  /** Elements rendered on the active screen, system banner, and any open popups. */
  activeElements(): HmiGraphicElement[] {
    const surfaces: HmiSurfaceBase[] = [];
    const screen = this.project.screens.find((candidate) => candidate.id === this.session.currentScreenId);
    if (screen) surfaces.push(screen);
    surfaces.push(this.project.systemBanner);
    for (const entry of this.session.popupStack) {
      const popup = this.project.popups.find((candidate) => candidate.id === entry.popupId);
      if (popup) surfaces.push(popup);
    }
    return surfaces.flatMap((surface) => surface.elements);
  }

  private refreshBoundElements(): void {
    this.bindingEngine.setSystemTags(this.systemTagValues());
    this.bindingEngine.setElements(this.activeElements());
  }

  private systemTagValues(): Record<string, HmiTagValue> {
    const dataLogStatus = this.dataLogStatus();
    return {
      ...this.session.systemTags,
      "System.AlarmActiveCount": this.alarmRuntime.summary.activeCount,
      "System.AlarmUnacknowledgedCount": this.alarmRuntime.summary.unacknowledgedCount,
      "System.AlarmAcknowledgedCount": this.alarmRuntime.summary.acknowledgedCount,
      "System.AlarmSuppressedCount": this.alarmRuntime.summary.suppressedCount,
      "System.DataLogActive": dataLogStatus.active,
      "System.DataLogStatus": dataLogStatus.message,
      // Localized strings for the current language, published as Text.<id> so a
      // localized-text binding (system-tag → Text.<id>) resolves and re-resolves
      // live on setLanguage. Per-key fallback to the default language is applied.
      ...hmiLocalizedSystemTags(this.project, this.session.currentLanguage),
    };
  }

  private dataLogStatus(): { active: boolean; message: string } {
    const buffers = this.getDataLogBuffers();
    if (buffers.length === 0) return { active: false, message: "No data logs configured." };
    const active = buffers.some((buffer) => buffer.status === "recording");
    const latest = buffers
      .slice()
      .sort((a, b) => (b.lastSampleTimestampMs ?? -1) - (a.lastSampleTimestampMs ?? -1))[0]!;
    return { active, message: latest.statusMessage };
  }

  /** Languages the operator can switch between at runtime. */
  getLanguages(): HmiLanguageOption[] {
    return hmiLanguageOptions(this.project);
  }

  getCurrentLanguage(): string {
    return this.session.currentLanguage;
  }

  /** Deterministic SVG chart-preview geometry for a trend buffer (sparkline). */
  getTrendChartPreview(trendId: string, options?: HmiTrendChartRenderOptions): HmiTrendChartPreview | undefined {
    const buffer = this.trendBuffers.get(trendId);
    return buffer ? renderHmiTrendChartPreview(buffer, options) : undefined;
  }

  /** Resolve the active screen's objects against the current live values. */
  resolveScreen(): HmiElementRuntimeState[] {
    return this.bindingEngine.resolveAll();
  }

  /** Combined binding + action diagnostics at the current values. */
  getDiagnostics(): HmiBindingDiagnostic[] {
    return [...this.bindingEngine.diagnostics(), ...this.actionDiagnostics];
  }

  private syncRuntimeDiagnostics(nowMs = this.clock()): void {
    if (!Number.isFinite(nowMs)) return;
    const current = this.getDiagnostics();
    const activeIds = new Set(current.map(runtimeDiagnosticId));
    let next = this.diagnosticsRuntime;
    const alreadyActiveIds = new Set(next.active.map((event) => event.id));

    for (const diagnostic of current) {
      const id = runtimeDiagnosticId(diagnostic);
      if (alreadyActiveIds.has(id)) continue;
      next = recordHmiDiagnosticEvent(next, {
        id,
        timestampMs: nowMs,
        source: "runtime",
        severity: diagnostic.severity,
        code: diagnostic.code,
        message: diagnostic.message,
        target: runtimeDiagnosticTarget(diagnostic),
        details: {
          elementId: diagnostic.elementId,
          targetProperty: diagnostic.targetProperty,
        },
      });
      alreadyActiveIds.add(id);
    }

    const staleIds = next.active
      .filter((event) => event.source === "runtime" && !activeIds.has(event.id))
      .map((event) => event.id);
    if (staleIds.length > 0) {
      next = clearHmiDiagnosticEvents(next, { timestampMs: nowMs, ids: staleIds });
    }
    this.diagnosticsRuntime = next;
  }

  /** Structured live/history diagnostics for the runtime-preview diagnostic widgets. */
  getDiagnosticsRuntime(): HmiDiagnosticsRuntime {
    this.syncRuntimeDiagnostics(this.clock());
    return this.diagnosticsRuntime;
  }

  getDiagnosticsTableRows(variant: HmiDiagnosticsTableVariant = "live"): HmiDiagnosticsTableRow[] {
    return hmiDiagnosticsTableRows(this.getDiagnosticsRuntime(), variant);
  }

  clearDiagnostics(source?: HmiDiagnosticsSourceKind): void {
    const timestampMs = this.clock();
    if (!source || source === "runtime") this.actionDiagnostics.length = 0;
    this.diagnosticsRuntime = clearHmiDiagnosticEvents(this.diagnosticsRuntime, {
      timestampMs,
      ...(source ? { source } : {}),
    });
  }

  /**
   * Sample alarms and trends from the current provider values. Called on start,
   * after writes, and on each preview frame.
   */
  tick(nowMs = this.clock()): void {
    const values = this.readValues();
    this.alarmRuntime = evaluateHmiAlarmRuntime(this.alarmRuntime, this.project.alarms, {
      timestampMs: nowMs,
      values,
    });
    for (const trend of this.project.trends) {
      const buffer = this.trendBuffers.get(trend.id);
      if (!buffer) continue;
      const result = recordHmiTrendSample(buffer, { timestampMs: nowMs, values: this.numericValues(values) });
      if (result.accepted) this.trendBuffers.set(trend.id, result.buffer);
    }
    for (const log of this.project.dataLogs) {
      const buffer = this.dataLogBuffers.get(log.id);
      if (!buffer) continue;
      const result = recordHmiDataLogSample(buffer, { timestampMs: nowMs, values });
      this.dataLogBuffers.set(log.id, result.buffer);
    }
    this.bindingEngine.setSystemTags(this.systemTagValues());
    this.syncRuntimeDiagnostics(nowMs);
  }

  private readValues(): Record<string, HmiTagValue> {
    const values: Record<string, HmiTagValue> = {};
    for (const path of this.provider.listTags()) values[path] = this.provider.read(path).value;
    // Ensure alarm/trend tag paths are present even when unknown (→ missing quality).
    for (const alarm of this.project.alarms) {
      if (!(alarm.tagPath in values)) values[alarm.tagPath] = this.provider.getMetadata(alarm.tagPath) ? this.provider.read(alarm.tagPath).value : null;
    }
    for (const log of this.project.dataLogs) {
      for (const tagPath of log.tagPaths) {
        if (!(tagPath in values) && this.provider.getMetadata(tagPath)) values[tagPath] = this.provider.read(tagPath).value;
      }
    }
    for (const recipe of this.project.recipes ?? []) {
      for (const item of recipe.items) {
        if (!(item.tagPath in values) && this.provider.getMetadata(item.tagPath)) values[item.tagPath] = this.provider.read(item.tagPath).value;
      }
    }
    return values;
  }

  private numericValues(values: Record<string, HmiTagValue>): Record<string, number | boolean | null> {
    const out: Record<string, number | boolean | null> = {};
    for (const [path, value] of Object.entries(values)) {
      if (typeof value === "number" || typeof value === "boolean" || value === null) out[path] = value;
      else if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) out[path] = Number(value);
      else out[path] = null;
    }
    return out;
  }

  // ---- Navigation / session (security-enforced via the command session) ------

  private runCommand(type: HmiCommand["type"], args: Record<string, unknown>): HmiRuntimeActionResult {
    const command: HmiCommand = {
      id: `act-${(actionCounter += 1)}`,
      type,
      safety: "runtime-preview",
      args,
    };
    const next = executeHmiRuntimeCommand(this.project, this.session, command);
    this.session = next;
    const last = next.commandLog[next.commandLog.length - 1];
    const ok = last?.status === "applied";
    if (!ok && last) {
      this.actionDiagnostics.push({
        elementId: String(args.sourceObjectId ?? ""),
        targetProperty: type,
        code: "unsupported",
        severity: "warning",
        message: last.message,
      });
    }
    this.refreshBoundElements();
    return { ok, message: last?.message ?? "No effect." };
  }

  navigateToScreen(screenId: string): HmiRuntimeActionResult {
    return this.runCommand("navigate", { screenId });
  }

  openPopup(popupId: string): HmiRuntimeActionResult {
    return this.runCommand("open-popup", { popupId });
  }

  closePopup(popupId?: string): HmiRuntimeActionResult {
    return this.runCommand("close-popup", popupId ? { popupId } : {});
  }

  setLanguage(languageId: string): HmiRuntimeActionResult {
    return this.runCommand("change-language", { languageId });
  }

  login(username: string): HmiRuntimeActionResult {
    return this.runCommand("login-user", { username });
  }

  logout(): HmiRuntimeActionResult {
    return this.runCommand("logout-user", {});
  }

  setRoles(roleIds: readonly string[]): void {
    this.session = setHmiRuntimeSessionRoles(this.project, this.session, roleIds);
    this.refreshBoundElements();
  }

  // ---- Tag actions (provider-backed) -----------------------------------------

  private writeThroughProvider(
    path: string,
    value: HmiTagValue,
    reason: string,
    context?: HmiRuntimeActionContext,
  ): HmiRuntimeActionResult {
    const result = this.provider.write({
      path,
      value,
      reason,
      sourceObjectId: context?.sourceObjectId,
      userId: this.session.currentUserName || undefined,
    });
    if (!result.ok) {
      this.actionDiagnostics.push({
        elementId: context?.sourceObjectId ?? "",
        targetProperty: path,
        code: "unsupported",
        severity: "error",
        message: result.message ?? `Write to "${path}" failed.`,
      });
    } else {
      this.tick(this.clock());
    }
    return { ok: result.ok, message: result.message ?? `Wrote ${String(value)} to ${path}.` };
  }

  writeTag(path: string, value: HmiTagValue, context?: HmiRuntimeActionContext): HmiRuntimeActionResult {
    return this.writeThroughProvider(path, value, "write-tag", context);
  }

  toggleTag(path: string, context?: HmiRuntimeActionContext): HmiRuntimeActionResult {
    const current = this.provider.read(path);
    const next = !(current.value === true || current.value === 1);
    return this.writeThroughProvider(path, next, "toggle-tag", context);
  }

  momentary(
    path: string,
    phase: "press" | "release",
    pressedValue: HmiTagValue = true,
    releasedValue: HmiTagValue = false,
    context?: HmiRuntimeActionContext,
  ): HmiRuntimeActionResult {
    return this.writeThroughProvider(path, phase === "press" ? pressedValue : releasedValue, `momentary-${phase}`, context);
  }

  incrementTag(path: string, by = 1, max?: number, context?: HmiRuntimeActionContext): HmiRuntimeActionResult {
    const current = Number(this.provider.read(path).value ?? 0);
    let next = current + by;
    if (max !== undefined) next = Math.min(next, max);
    return this.writeThroughProvider(path, next, "increment", context);
  }

  decrementTag(path: string, by = 1, min?: number, context?: HmiRuntimeActionContext): HmiRuntimeActionResult {
    const current = Number(this.provider.read(path).value ?? 0);
    let next = current - by;
    if (min !== undefined) next = Math.max(next, min);
    return this.writeThroughProvider(path, next, "decrement", context);
  }

  // ---- Alarms ----------------------------------------------------------------

  acknowledgeAlarms(alarmIds?: string[]): HmiRuntimeActionResult {
    this.alarmRuntime = acknowledgeHmiAlarms(this.alarmRuntime, { timestampMs: this.clock(), alarmIds });
    this.bindingEngine.setSystemTags(this.systemTagValues());
    return { ok: true, message: alarmIds?.length ? `Acknowledged ${alarmIds.length} alarm(s).` : "Acknowledged all alarms." };
  }

  acknowledgeAllVisible(): HmiRuntimeActionResult {
    const ids = this.alarmRuntime.alarms
      .filter((alarm) => !alarm.acknowledged && (alarm.active || alarm.state === "returned-unacknowledged"))
      .map((alarm) => alarm.alarmId);
    return this.acknowledgeAlarms(ids);
  }

  resetAlarms(alarmIds?: string[]): HmiRuntimeActionResult {
    this.alarmRuntime = resetHmiAlarms(this.alarmRuntime, { timestampMs: this.clock(), alarmIds });
    this.bindingEngine.setSystemTags(this.systemTagValues());
    return { ok: true, message: alarmIds?.length ? `Reset ${alarmIds.length} alarm(s).` : "Reset returned alarms." };
  }

  resetAllVisible(): HmiRuntimeActionResult {
    const ids = this.alarmRuntime.alarms
      .filter((alarm) => !alarm.active && !alarm.suppressed && alarm.state !== "normal")
      .map((alarm) => alarm.alarmId);
    return this.resetAlarms(ids);
  }

  // ---- Data logs -------------------------------------------------------------

  clearDataLog(dataLogId: string): HmiRuntimeActionResult {
    const buffer = this.dataLogBuffers.get(dataLogId);
    if (!buffer) return { ok: false, message: `Data log "${dataLogId}" was not found.` };
    this.dataLogBuffers.set(dataLogId, clearHmiDataLogBuffer(buffer));
    this.bindingEngine.setSystemTags(this.systemTagValues());
    return { ok: true, message: `Cleared data log "${buffer.dataLogName}".` };
  }

  exportDataLogCsv(dataLogId: string): HmiDataLogExportResult | undefined {
    const buffer = this.dataLogBuffers.get(dataLogId);
    return buffer ? exportHmiDataLogBufferCsv(buffer) : undefined;
  }

  // ---- Recipes --------------------------------------------------------------

  applyRecipe(recipeId: string, context?: HmiRuntimeActionContext): HmiRuntimeActionResult {
    const recipe = (this.project.recipes ?? []).find((candidate) => candidate.id === recipeId);
    const timestampMs = this.clock();
    if (!recipe) return { ok: false, message: `Recipe "${recipeId}" was not found.` };
    if (recipe.items.length === 0) return { ok: false, message: `Recipe "${recipe.name}" has no tag values.` };
    if (!canAccessRecipe(recipe, this.session.activeRoleIds)) {
      const rows: HmiRecipeApplyRow[] = recipe.items.map((item) => ({
        itemId: item.id,
        tagPath: item.tagPath,
        value: item.value,
        status: "skipped",
        message: `Recipe requires role ${this.roleNames(recipe.securityRoleIds)}.`,
      }));
      const result: HmiRecipeApplyResult = {
        recipeId: recipe.id,
        recipeName: recipe.name,
        timestampMs,
        appliedCount: 0,
        failedCount: rows.length,
        rows,
      };
      this.recipeApplyHistory = [...this.recipeApplyHistory, result].slice(-20);
      this.actionDiagnostics.push({
        elementId: context?.sourceObjectId ?? "",
        targetProperty: `recipe:${recipe.id}`,
        code: "unsupported",
        severity: "warning",
        message: `Recipe "${recipe.name}" was blocked by HMI security; requires role ${this.roleNames(recipe.securityRoleIds)}.`,
      });
      this.syncRuntimeDiagnostics(timestampMs);
      return { ok: false, message: `Recipe "${recipe.name}" blocked by HMI security.` };
    }

    const preflight = recipe.items.map((item) => {
      const metadata = this.provider.getMetadata(item.tagPath);
      if (!metadata) {
        return {
          item,
          ok: false,
          message: `Tag "${item.tagPath}" is not defined in the runtime tag set.`,
        };
      }
      if (!metadata.writable) {
        return {
          item,
          ok: false,
          message: `Tag "${item.tagPath}" is read-only and cannot be written from the HMI.`,
        };
      }
      return { item, ok: true, message: `Ready to write ${item.tagPath}.` };
    });
    const preflightFailures = preflight.filter((entry) => !entry.ok);
    if (preflightFailures.length > 0) {
      const rows: HmiRecipeApplyRow[] = preflight.map((entry) => ({
        itemId: entry.item.id,
        tagPath: entry.item.tagPath,
        value: entry.item.value,
        status: entry.ok ? "skipped" : "failed",
        message: entry.ok ? "Skipped because recipe preflight failed; no values were written." : entry.message,
      }));
      for (const failure of preflightFailures) {
        this.actionDiagnostics.push({
          elementId: context?.sourceObjectId ?? "",
          targetProperty: failure.item.tagPath,
          code: "unsupported",
          severity: "error",
          message: failure.message,
        });
      }
      const result: HmiRecipeApplyResult = {
        recipeId: recipe.id,
        recipeName: recipe.name,
        timestampMs,
        appliedCount: 0,
        failedCount: rows.length,
        rows,
      };
      this.recipeApplyHistory = [...this.recipeApplyHistory, result].slice(-20);
      this.syncRuntimeDiagnostics(timestampMs);
      return {
        ok: false,
        message: `Recipe "${recipe.name}" was not applied; ${preflightFailures.length} tag value(s) failed preflight.`,
      };
    }

    const beforeValues = new Map(recipe.items.map((item) => [item.id, this.provider.read(item.tagPath).value]));
    const rows: HmiRecipeApplyRow[] = recipe.items.map((item) => {
      const result = this.provider.write({
        path: item.tagPath,
        value: item.value,
        reason: `recipe:${recipe.name}`,
        sourceObjectId: context?.sourceObjectId,
        userId: this.session.currentUserName || undefined,
        timestampMs,
      });
      if (!result.ok) {
        this.actionDiagnostics.push({
          elementId: context?.sourceObjectId ?? "",
          targetProperty: item.tagPath,
          code: "unsupported",
          severity: "error",
          message: result.message ?? `Recipe write to "${item.tagPath}" failed.`,
        });
      }
      return {
        itemId: item.id,
        tagPath: item.tagPath,
        value: item.value,
        status: result.ok ? "applied" as const : "failed" as const,
        message: result.message ?? (result.ok ? `Wrote ${String(result.value)} to ${item.tagPath}.` : `Write to "${item.tagPath}" failed.`),
      };
    });
    if (rows.some((row) => row.status === "failed")) {
      for (const row of rows.filter((candidate) => candidate.status === "applied")) {
        const previous = beforeValues.get(row.itemId) ?? null;
        const rollback = this.provider.write({
          path: row.tagPath,
          value: previous,
          reason: `recipe-rollback:${recipe.name}`,
          sourceObjectId: context?.sourceObjectId,
          userId: this.session.currentUserName || undefined,
          timestampMs,
        });
        row.status = rollback.ok ? "rolled-back" : "failed";
        row.message = rollback.ok
          ? `Rolled back ${row.tagPath} after recipe apply failure.`
          : `Recipe write failed and rollback for "${row.tagPath}" also failed.`;
      }
    }
    const appliedCount = rows.filter((row) => row.status === "applied").length;
    const result: HmiRecipeApplyResult = {
      recipeId: recipe.id,
      recipeName: recipe.name,
      timestampMs,
      appliedCount,
      failedCount: rows.length - appliedCount,
      rows,
    };
    this.recipeApplyHistory = [...this.recipeApplyHistory, result].slice(-20);
    this.tick(timestampMs);
    return {
      ok: result.failedCount === 0,
      message:
        result.failedCount === 0
          ? `Applied recipe "${recipe.name}" to ${result.appliedCount} tag value(s).`
          : `Applied ${result.appliedCount} of ${rows.length} recipe tag value(s) for "${recipe.name}".`,
    };
  }

  // ---- Unified dispatch (for object event handlers) --------------------------

  executeAction(action: HmiRuntimeAction, context?: HmiRuntimeActionContext): HmiRuntimeActionResult {
    switch (action.kind) {
      case "write-tag":
      case "set-tag":
        return this.writeTag(action.path, action.value, context);
      case "toggle-tag":
        return this.toggleTag(action.path, context);
      case "momentary":
        return this.momentary(action.path, action.phase, action.pressedValue, action.releasedValue, context);
      case "increment":
        return this.incrementTag(action.path, action.by ?? 1, action.max, context);
      case "decrement":
        return this.decrementTag(action.path, action.by ?? 1, action.min, context);
      case "navigate":
        return this.navigateToScreen(action.screenId);
      case "open-popup":
        return this.openPopup(action.popupId);
      case "close-popup":
        return this.closePopup(action.popupId);
      case "acknowledge-alarm":
        return this.acknowledgeAlarms(action.alarmIds);
      case "acknowledge-all-visible":
        return this.acknowledgeAllVisible();
      case "reset-alarm":
        return this.resetAlarms(action.alarmIds);
      case "reset-all-visible":
        return this.resetAllVisible();
      case "set-language":
        return this.setLanguage(action.languageId);
      case "export-data-log": {
        const exported = this.exportDataLogCsv(action.dataLogId);
        return exported
          ? { ok: true, message: `Exported ${exported.rowCount} data-log row(s) to ${exported.fileName}.` }
          : { ok: false, message: `Data log "${action.dataLogId}" was not found.` };
      }
      case "clear-data-log":
        return this.clearDataLog(action.dataLogId);
      case "apply-recipe":
        return this.applyRecipe(action.recipeId, context);
      case "login":
        return this.login(action.username);
      case "logout":
        return this.logout();
      default:
        return { ok: false, message: "Unknown action." };
    }
  }

  stop(): void {
    this.running = false;
  }

  dispose(): void {
    this.running = false;
    this.disposed = true;
    this.bindingEngine.dispose();
    this.provider.dispose();
  }
}

/** Convenience constructor used by the designer preview and tests. */
export function startHmiRuntimePreview(
  project: HmiProject,
  options: HmiRuntimeControllerOptions = {},
): HmiRuntimeController {
  const controller = new HmiRuntimeController(project, options);
  controller.start();
  return controller;
}
