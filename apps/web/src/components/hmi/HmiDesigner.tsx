import { useEffect, useMemo, useRef, useState } from "react";
import {
  getHmiElementDefinition,
  createHmiRuntimeSession,
  executeHmiRuntimeCommands,
  hmiControllerReferenceBrowserRows,
  hmiControllerReferenceSyncSummary,
  hmiDiagnosticsTableRows,
  hmiElementDefinitionsByCategory,
  hmiNavigationModel,
  hmiUsageCapacityReport,
  hmiVisualQaReport,
  setHmiRuntimeSessionRoles,
  validateHmiProject,
  HmiRuntimeController,
  SimulatorTagProvider,
  type HmiAlarmTableRow,
  type HmiAlarmSeverity,
  type HmiAlarmTriggerKind,
  type HmiBindingSourceKind,
  type HmiDiagnosticsTableRow,
  type HmiDiagnosticsTableVariant,
  type HmiElementDefinition,
  type HmiElementPropertyDefinition,
  type HmiElementRuntimeState,
  type HmiGraphicElement,
  type HmiCommand,
  type HmiProject,
  type HmiPropertyBinding,
  type HmiRecipeValue,
  type HmiRuntimeCommandResult,
  type HmiRuntimeSession,
  type HmiTagValue,
  type HmiUsageCapacityMetric,
  type HmiSurfaceKind,
  type RuntimeTagProvider,
} from "@esco/hmi-model";
import { requestConfirmation } from "../../confirmation";
import "./HmiDesigner.css";

type SurfaceSelection =
  | { kind: "screen"; id: string }
  | { kind: "popup"; id: string }
  | { kind: "system-banner"; id: string };

/** A binding the inspector proposes; App fills a stable id when one is absent. */
export type BindingDraft = Omit<HmiPropertyBinding, "id"> & { id?: string };

/**
 * An event command the inspector proposes; App fills a stable id and safety class.
 * Mirrors the command kinds the offline HMI runtime can preview. Hardware-only /
 * model-only commands are not authorable here.
 */
export type EventCommandDraft =
  | { type: "navigate"; args: { screenId: string } }
  | { type: "open-popup"; args: { popupId: string } }
  | { type: "close-popup"; args: Record<string, never> }
  | { type: "set-tag-value"; args: { tagPath: string; value: string } }
  | { type: "change-language"; args: { languageId: string } }
  | { type: "export-data-log"; args: { dataLogId: string } }
  | { type: "clear-data-log"; args: { dataLogId: string } }
  | { type: "apply-recipe"; args: { recipeId: string } }
  | { type: "login-user"; args: { username: string } }
  | { type: "logout-user"; args: Record<string, never> };

/** Partial element edit (name / properties / style / visibility / lock). */
export interface ElementPatch {
  name?: string;
  properties?: Record<string, unknown>;
  visible?: boolean;
  locked?: boolean;
}

/** Alarm authoring draft (mirrors the project-action input shape). */
export interface AlarmDraft {
  name: string;
  tagPath: string;
  severity?: HmiAlarmSeverity;
  triggerKind?: HmiAlarmTriggerKind;
  threshold?: number;
  deadband?: number;
  activeValue?: boolean;
  message?: string;
  area?: string;
  allowAcknowledge?: boolean;
  enabled?: boolean;
}

export interface AlarmUpdateDraft extends Partial<AlarmDraft> {
  alarmId: string;
}

/** Trend authoring drafts (mirror the project-action input shapes). */
export interface TrendDraft {
  name: string;
  sampleRateMs?: number;
  timeRangeSeconds?: number;
}

export interface TrendUpdateDraft extends Partial<TrendDraft> {
  trendId: string;
}

export interface TrendPenDraft {
  trendId: string;
  label: string;
  tagPath: string;
  color?: string;
  sourceKind?: "tag" | "expression" | "system-tag";
}

export interface DataLogDraft {
  name: string;
  sampleRateMs?: number;
  retentionHours?: number;
  tagPaths: string[];
  statusTagPath?: string;
}

export interface DataLogUpdateDraft extends Partial<DataLogDraft> {
  dataLogId: string;
}

export interface RecipeDraft {
  name: string;
  description?: string;
}

export interface RecipeItemDraft {
  recipeId: string;
  tagPath: string;
  value: HmiRecipeValue;
  dataType?: string;
}

export interface LanguageDraft {
  languageId: string;
  displayName?: string;
}

export interface RoleDraft {
  name: string;
  permissions?: string[];
}

export interface UserDraft {
  username: string;
  roleIds: string[];
  fullName?: string;
}

interface Props {
  hmi: HmiProject | undefined;
  knownTagPaths: string[];
  selectedSurface?: SurfaceSelection;
  onEnableProject: () => void;
  onCreateScreen: (name: string) => void;
  onCreatePopup: (name: string) => void;
  onAddElement: (surfaceKind: HmiSurfaceKind, surfaceId: string, typeId: string) => void;
  onSelectSurface: (selection: SurfaceSelection) => void;
  onUpdateElement: (surfaceKind: HmiSurfaceKind, surfaceId: string, elementId: string, patch: ElementPatch) => void;
  onUpdateElementGeometry: (
    surfaceKind: HmiSurfaceKind,
    surfaceId: string,
    elementId: string,
    geometry: HmiGraphicElement["geometry"],
  ) => void;
  onDeleteElement: (surfaceKind: HmiSurfaceKind, surfaceId: string, elementId: string) => void;
  onSetBinding: (surfaceKind: HmiSurfaceKind, surfaceId: string, elementId: string, binding: BindingDraft) => void;
  onRemoveBinding: (surfaceKind: HmiSurfaceKind, surfaceId: string, elementId: string, bindingId: string) => void;
  onAddEventCommand: (
    surfaceKind: HmiSurfaceKind,
    surfaceId: string,
    elementId: string,
    eventType: "press" | "release",
    command: EventCommandDraft,
  ) => void;
  onRemoveEventCommand: (
    surfaceKind: HmiSurfaceKind,
    surfaceId: string,
    elementId: string,
    eventId: string,
    commandId: string,
  ) => void;
  onSetHomeScreen: (screenId: string) => void;
  onRenameSurface: (surfaceKind: "screen" | "popup", surfaceId: string, name: string) => void;
  onSetSurfaceSecurityRoles: (surfaceKind: "screen" | "popup" | "system-banner", surfaceId: string, roleIds: string[]) => void;
  onDeleteSurface: (surfaceKind: "screen" | "popup", surfaceId: string) => void;
  onBuildRuntimePackage: () => void;
  createRuntimeTagProvider?: () => RuntimeTagProvider;
  // Alarm / trend / language authoring.
  onCreateAlarm: (input: AlarmDraft) => void;
  onUpdateAlarm: (input: AlarmUpdateDraft) => void;
  onDeleteAlarm: (alarmId: string) => void;
  onCreateTrend: (input: TrendDraft) => void;
  onUpdateTrend: (input: TrendUpdateDraft) => void;
  onDeleteTrend: (trendId: string) => void;
  onAddTrendPen: (input: TrendPenDraft) => void;
  onRemoveTrendPen: (trendId: string, traceId: string) => void;
  onCreateDataLog: (input: DataLogDraft) => void;
  onUpdateDataLog: (input: DataLogUpdateDraft) => void;
  onDeleteDataLog: (dataLogId: string) => void;
  onCreateRecipe: (input: RecipeDraft) => void;
  onAddRecipeItem: (input: RecipeItemDraft) => void;
  onRemoveRecipeItem: (recipeId: string, itemId: string) => void;
  onDeleteRecipe: (recipeId: string) => void;
  onCreateLanguage: (input: LanguageDraft) => void;
  onDeleteLanguage: (languageId: string) => void;
  onSetLanguageString: (languageId: string, key: string, value: string) => void;
  onRemoveLanguageString: (languageId: string, key: string) => void;
  onSetDefaultLanguage: (languageId: string) => void;
  onExportLanguage: (languageId: string) => void;
  onImportLanguage: (text: string, sourceFileName?: string) => void;
  onCreateRole: (input: RoleDraft) => void;
  onDeleteRole: (roleId: string) => void;
  onCreateUser: (input: UserDraft) => void;
  onDeleteUser: (userId: string) => void;
}

interface ActiveSurface {
  kind: HmiSurfaceKind;
  id: string;
  name: string;
  width: number;
  height: number;
  background: string;
  updateRateMs: number;
  securityRoleIds: string[];
  elements: HmiGraphicElement[];
}

const CATEGORY_LABELS: Record<string, string> = {
  common: "Common",
  alarms: "Alarms",
  diagnostics: "Diagnostics",
  navigation: "Navigation",
  trends: "Trends",
  media: "Media",
  system: "System",
};

const BINDING_SOURCE_KINDS: HmiBindingSourceKind[] = ["tag", "expression", "property", "system-tag"];
const OPERATOR_NAV_ITEMS = ["Home", "Overview", "Manual", "Alarms", "Trends", "Recipes", "I/O"];

type AuthoredAlarm = HmiProject["alarms"][number];
type AuthoredTrend = HmiProject["trends"][number];
type AuthoredDataLog = HmiProject["dataLogs"][number];
type AuthoredRecipe = HmiProject["recipes"][number];

function displayRuntimeName(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : fallback;
}

function preferredRuntimeTagPath(
  tags: readonly { path: string }[],
  patterns: readonly RegExp[],
  fallback: string,
): string {
  return tags.find((tag) => patterns.some((pattern) => pattern.test(tag.path)))?.path ?? fallback;
}

function formatRuntimeValue(value: HmiTagValue, fallback = "--"): string {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "boolean") return value ? "ON" : "OFF";
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toFixed(1);
  return String(value);
}

function numericRuntimeValue(value: HmiTagValue, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return fallback;
}

function boolRuntimeValue(value: HmiTagValue): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") return /^(1|true|on|run|running|fault|alarm)$/i.test(value.trim());
  return false;
}

function alarmRuntimeLabel(value: string | undefined): string {
  if (!value) return "--";
  return value
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function alarmTimestampLabel(timestampMs: number | undefined): string {
  if (typeof timestampMs !== "number" || !Number.isFinite(timestampMs)) return "--:--:--";
  return new Date(timestampMs).toISOString().slice(11, 19);
}

function diagnosticTimestampLabel(row: HmiDiagnosticsTableRow): string {
  const base = alarmTimestampLabel(row.timestampMs);
  if (row.status !== "cleared" || typeof row.clearedTimestampMs !== "number") return base;
  return `${base} cleared ${alarmTimestampLabel(row.clearedTimestampMs)}`;
}

function alarmRowValue(row: HmiAlarmTableRow): string {
  return row.quality === "good" ? formatRuntimeValue(row.value) : row.quality.toUpperCase();
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${Math.round(bytes)} B`;
}

function formatMetric(metric: HmiUsageCapacityMetric): string {
  if (metric.key === "storage") return `${formatBytes(metric.used)} / ${formatBytes(metric.limit)}`;
  return `${metric.used} / ${metric.limit}`;
}

function metricPercent(metric: HmiUsageCapacityMetric): string {
  const percent = Math.max(0, Math.min(100, metric.percent ?? 0));
  return `${percent.toFixed(0)}%`;
}

function alarmTriggerSummary(alarm: AuthoredAlarm): string {
  if (alarm.trigger.kind === "digital") {
    return `digital ${String(alarm.trigger.activeValue ?? true)}`;
  }
  const direction = alarm.trigger.kind === "analog-high" ? "high" : "low";
  return `${direction} ${alarm.trigger.threshold ?? 0}${alarm.trigger.deadband ? ` db ${alarm.trigger.deadband}` : ""}`;
}

function alarmPreviewState(alarm: AuthoredAlarm): string {
  if (alarm.enabled === false) return "disabled";
  return alarm.allowAcknowledge ? "ack-ready" : "view-only";
}

function trendPreviewSummary(trend: AuthoredTrend): string {
  return `${trend.sampleRateMs}ms sample · ${trend.timeRangeSeconds}s window · ${trend.traces.length} pen${trend.traces.length === 1 ? "" : "s"}`;
}

function dataLogPreviewSummary(log: AuthoredDataLog): string {
  return `${log.sampleRateMs}ms sample · ${log.retentionHours}h retention · ${log.tagPaths.length} tag${log.tagPaths.length === 1 ? "" : "s"}`;
}

function recipePreviewSummary(recipe: AuthoredRecipe): string {
  return `${recipe.items.length} value${recipe.items.length === 1 ? "" : "s"}${recipe.securityRoleIds.length ? ` · ${recipe.securityRoleIds.length} secured role${recipe.securityRoleIds.length === 1 ? "" : "s"}` : ""}`;
}

function parseRecipeValue(raw: string, dataTypeHint: string): HmiRecipeValue {
  const value = raw.trim();
  const type = dataTypeHint.trim().toUpperCase();
  if (type === "BOOL") return /^(1|true|on|yes)$/i.test(value);
  if (["SINT", "INT", "DINT", "LINT", "USINT", "UINT", "UDINT", "ULINT", "REAL", "LREAL"].includes(type)) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  }
  if (/^(true|false)$/i.test(value)) return value.toLowerCase() === "true";
  const numeric = Number(value);
  if (value !== "" && Number.isFinite(numeric)) return numeric;
  return value;
}

function elementCaption(element: HmiGraphicElement): string {
  const definition = getHmiElementDefinition(element.typeId);
  return definition?.displayName ?? element.unsupported?.originalType ?? element.typeId;
}

function propertyLabel(element: HmiGraphicElement): string {
  const text =
    element.properties.text ??
    element.properties.label ??
    element.properties.title ??
    element.properties.altText ??
    element.name;
  return String(text);
}

function commandEffectText(entry: HmiRuntimeCommandResult): string {
  const effect = entry.effect;
  if (!effect) return entry.message;
  if (effect.kind === "navigate") return `${entry.message} Screen ${effect.screenId}.`;
  if (effect.kind === "open-popup") return `${entry.message} Popup ${effect.popupId}.`;
  if (effect.kind === "close-popup") return `${entry.message} Popup ${effect.popupId ?? "top"}.`;
  if (effect.kind === "tag-write-preview") return `${entry.message} Value ${String(effect.value ?? "")}.`;
  if (effect.kind === "change-language") return `${entry.message} Language ${effect.languageId}.`;
  if (effect.kind === "data-log-export" || effect.kind === "data-log-clear") return `${entry.message} Data log ${effect.dataLogId}.`;
  if (effect.kind === "apply-recipe") return `${entry.message} Recipe ${effect.recipeId}.`;
  if (effect.kind === "login-user") return `${entry.message} Roles ${effect.roleIds.join(", ") || "none"}.`;
  if (effect.kind === "logout-user") return `${entry.message} Guest roles ${effect.roleIds.join(", ") || "none"}.`;
  return entry.message;
}

function commandTargetText(
  command: HmiCommand,
  targets: {
    screens: { id: string; name: string }[];
    popups: { id: string; name: string }[];
    dataLogs: { id: string; name: string }[];
    recipes: { id: string; name: string }[];
    languages: { languageId: string; displayName: string }[];
    users: { username: string; fullName?: string }[];
  },
): string {
  if (command.type === "navigate") {
    const screenId = typeof command.args.screenId === "string" ? command.args.screenId : "";
    return targets.screens.find((screen) => screen.id === screenId)?.name ?? screenId;
  }
  if (command.type === "open-popup") {
    const popupId = typeof command.args.popupId === "string" ? command.args.popupId : "";
    return targets.popups.find((popup) => popup.id === popupId)?.name ?? popupId;
  }
  if (command.type === "set-tag-value") {
    const tagPath = typeof command.args.tagPath === "string" ? command.args.tagPath : "";
    const value = command.args.value === undefined ? "" : String(command.args.value);
    return `${tagPath}${value ? ` = ${value}` : ""}`;
  }
  if (command.type === "change-language") {
    const languageId = typeof command.args.languageId === "string" ? command.args.languageId : "";
    const language = targets.languages.find((candidate) => candidate.languageId === languageId);
    return language ? `${language.displayName} (${language.languageId})` : languageId;
  }
  if (command.type === "export-data-log" || command.type === "clear-data-log") {
    const dataLogId = typeof command.args.dataLogId === "string" ? command.args.dataLogId : "";
    return targets.dataLogs.find((log) => log.id === dataLogId)?.name ?? dataLogId;
  }
  if (command.type === "apply-recipe") {
    const recipeId = typeof command.args.recipeId === "string" ? command.args.recipeId : "";
    return targets.recipes.find((recipe) => recipe.id === recipeId)?.name ?? recipeId;
  }
  if (command.type === "login-user") {
    const username = typeof command.args.username === "string" ? command.args.username : "";
    const user = targets.users.find((candidate) => candidate.username === username);
    return user?.fullName ? `${user.fullName} (${user.username})` : username;
  }
  if (command.type === "logout-user") return "current user";
  return "";
}

function RuntimePreviewPanel({
  project,
  session,
  onRoleChange,
}: {
  project: HmiProject;
  session: HmiRuntimeSession;
  onRoleChange: (roleId: string) => void;
}) {
  const recent = session.commandLog.slice(-4).reverse();
  const activeRoleId = session.activeRoleIds[0] ?? "";
  return (
    <section className="esco-hmi-runtime" aria-label="HMI runtime preview">
      <h2>Runtime Preview</h2>
      <dl>
        <dt>Current screen</dt>
        <dd>{session.currentScreenName ?? "—"}</dd>
        <dt>Previous screen</dt>
        <dd>{session.previousScreenName ?? "—"}</dd>
        <dt>Open popups</dt>
        <dd>{session.popupStack.map((popup) => popup.popupName).join(", ") || "none"}</dd>
        <dt>User</dt>
        <dd>{session.currentUserName || "none"}</dd>
        <dt>Roles</dt>
        <dd>{session.activeRoleNames.join(", ") || "none"}</dd>
        <dt>Blocked commands</dt>
        <dd>{session.blockedCommandCount}</dd>
      </dl>
      <label className="esco-hmi-runtime__role">
        <span>Preview role</span>
        <select
          aria-label="Runtime preview role"
          value={activeRoleId}
          onChange={(event) => onRoleChange(event.target.value)}
        >
          <option value="">No role</option>
          {project.security.roles.map((role) => (
            <option key={role.id} value={role.id}>
              {role.name}
            </option>
          ))}
        </select>
      </label>
      {recent.length ? (
        <ul>
          {recent.map((entry, index) => (
            <li key={`${entry.commandId}:${session.commandLog.length - index}`} className={`is-${entry.status}`}>
              <strong>{entry.status} · {entry.type}</strong>
              <span>{commandEffectText(entry)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="esco-hmi-nav__empty">No preview commands run.</p>
      )}
    </section>
  );
}

function surfaceFromSelection(hmi: HmiProject, selection?: SurfaceSelection): ActiveSurface | undefined {
  if (selection?.kind === "screen") return hmi.screens.find((screen) => screen.id === selection.id);
  if (selection?.kind === "popup") return hmi.popups.find((popup) => popup.id === selection.id);
  if (selection?.kind === "system-banner" && selection.id === hmi.systemBanner.id) return hmi.systemBanner;
  return hmi.screens[0] ?? hmi.systemBanner;
}

function renderElementBody(element: HmiGraphicElement) {
  const definition = getHmiElementDefinition(element.typeId);
  const caption = propertyLabel(element);
  const valueBinding = element.bindings.find((binding) => binding.targetProperty === "value");
  if (element.unsupported || !definition) {
    return (
      <>
        <strong>{element.name}</strong>
        <span>Read-only unsupported</span>
      </>
    );
  }
  if (definition.typeId === "common.button") return <strong>{caption}</strong>;
  if (definition.typeId === "common.numeric-display") {
    return (
      <>
        <span>{caption}</span>
        <strong>{valueBinding?.source.path ?? "0"}</strong>
      </>
    );
  }
  if (definition.typeId === "common.numeric-input") {
    return (
      <>
        <span>{caption}</span>
        <strong>{valueBinding?.source.path ?? "enter value"}</strong>
      </>
    );
  }
  if (definition.typeId === "trends.trend-chart") {
    return (
      <>
        <strong>{caption}</strong>
        <span className="esco-hmi-element__gridline" />
        <span>Offline trend preview</span>
      </>
    );
  }
  if (definition.typeId === "alarms.alarm-summary") {
    return (
      <>
        <strong>{caption}</strong>
        <span>Time | Severity | Message</span>
        <span>Offline alarm preview</span>
      </>
    );
  }
  if (definition.typeId === "navigation.menu") {
    return (
      <>
        <strong>Navigation</strong>
        <span>Home</span>
        <span>Alarms</span>
        <span>Trends</span>
      </>
    );
  }
  if (definition.typeId === "media.image-placeholder") {
    return (
      <>
        <strong>Image</strong>
        <span>{caption}</span>
      </>
    );
  }
  return <strong>{caption}</strong>;
}

function ElementOnCanvas({
  element,
  surface,
  selected,
  onSelect,
}: {
  element: HmiGraphicElement;
  surface: ActiveSurface;
  selected: boolean;
  onSelect: () => void;
}) {
  const definition = getHmiElementDefinition(element.typeId);
  const style = {
    left: `${(element.geometry.x / surface.width) * 100}%`,
    top: `${(element.geometry.y / surface.height) * 100}%`,
    width: `${(element.geometry.width / surface.width) * 100}%`,
    height: `${(element.geometry.height / surface.height) * 100}%`,
    zIndex: element.zIndex,
    background: element.style?.fill,
    borderColor: element.style?.stroke,
    color: element.style?.textColor,
    opacity: element.visible === false ? 0.35 : element.style?.opacity,
    fontSize: element.style?.fontSize ? `${element.style.fontSize}px` : undefined,
  };
  return (
    <button
      type="button"
      className={[
        "esco-hmi-element",
        selected ? "is-selected" : "",
        element.unsupported ? "is-unsupported" : "",
        definition?.runtimeSupport === "model-only" ? "is-model-only" : "",
      ].join(" ")}
      style={style}
      onClick={onSelect}
      title={element.unsupported?.readonlyReason ?? definition?.description}
    >
      {renderElementBody(element)}
    </button>
  );
}

function coerceRuntimeInput(raw: string): HmiTagValue {
  const trimmed = raw.trim();
  if (trimmed === "") return "";
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if (trimmed.toLowerCase() === "true") return true;
  if (trimmed.toLowerCase() === "false") return false;
  return raw;
}

function resolvedString(
  state: HmiElementRuntimeState | undefined,
  element: HmiGraphicElement,
  key: string,
  fallback: string,
): string {
  const value = state?.runtimeProps[key];
  if (value !== undefined && value !== null) return String(value);
  const design = element.properties[key];
  return design !== undefined && design !== null ? String(design) : fallback;
}

/** Editable numeric field bound to a tag; commits on Enter/blur via a real write. */
function LiveNumericInput({
  value,
  onCommit,
}: {
  value: HmiTagValue;
  onCommit: (raw: string) => void;
}) {
  const [draft, setDraft] = useState(value === null || value === undefined ? "" : String(value));
  useEffect(() => {
    setDraft(value === null || value === undefined ? "" : String(value));
  }, [value]);
  return (
    <input
      className="esco-hmi-live__input"
      aria-label="Runtime numeric input"
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") onCommit(draft);
      }}
      onBlur={() => onCommit(draft)}
    />
  );
}

/** One live operator object: resolved props + real interactivity. */
/** Live SVG sparkline rendered from the controller's trend buffer geometry. */
function LiveTrendChart({ controller, trendId }: { controller: HmiRuntimeController; trendId?: string }) {
  const buffers = controller.getTrendBuffers();
  // Bind to the element's configured trend when set; otherwise show the first.
  const buffer = (trendId && buffers.find((candidate) => candidate.trendId === trendId)) || buffers[0];
  const preview = buffer ? controller.getTrendChartPreview(buffer.trendId, { width: 240, height: 96 }) : undefined;
  const totalPoints = preview?.series.reduce((sum, series) => sum + series.points.length, 0) ?? 0;
  if (!preview || totalPoints === 0) {
    return <span className="esco-hmi-live__muted">No trend samples yet</span>;
  }
  return (
    <svg
      className="esco-hmi-live__trend-svg"
      viewBox={`0 0 ${preview.width} ${preview.height}`}
      preserveAspectRatio="none"
      data-testid="hmi-live-trend"
      data-points={totalPoints}
    >
      <rect
        x={preview.plotArea.x}
        y={preview.plotArea.y}
        width={preview.plotArea.width}
        height={preview.plotArea.height}
        fill="none"
        stroke="#e2e8f0"
      />
      {preview.series.map((series) => (
        <path key={series.traceId} d={series.path} fill="none" stroke={series.color} strokeWidth={2} />
      ))}
      <text x={2} y={preview.plotArea.y + 8} className="esco-hmi-live__trend-axis">
        {preview.valueAxis.max}
      </text>
      <text x={2} y={preview.plotArea.y + preview.plotArea.height} className="esco-hmi-live__trend-axis">
        {preview.valueAxis.min}
      </text>
    </svg>
  );
}

function LivePreviewElement({
  element,
  surfaceWidth,
  surfaceHeight,
  state,
  controller,
  onAction,
}: {
  element: HmiGraphicElement;
  surfaceWidth: number;
  surfaceHeight: number;
  state: HmiElementRuntimeState | undefined;
  controller: HmiRuntimeController;
  onAction: () => void;
}) {
  const definition = getHmiElementDefinition(element.typeId);
  const props = state?.runtimeProps ?? {};
  const visible = props.visible !== false && element.visible !== false;
  const baseStyle: React.CSSProperties = {
    left: `${(element.geometry.x / surfaceWidth) * 100}%`,
    top: `${(element.geometry.y / surfaceHeight) * 100}%`,
    width: `${(element.geometry.width / surfaceWidth) * 100}%`,
    height: `${(element.geometry.height / surfaceHeight) * 100}%`,
    zIndex: element.zIndex,
    background: (props.fillColor as string) ?? (props.backgroundColor as string) ?? element.style?.fill,
    borderColor: (props.strokeColor as string) ?? element.style?.stroke,
    color: (props.foregroundColor as string) ?? element.style?.textColor,
    opacity: typeof props.opacity === "number" ? props.opacity : visible ? element.style?.opacity : 0,
    fontSize: element.style?.fontSize ? `${element.style.fontSize}px` : undefined,
    visibility: visible ? "visible" : "hidden",
  };

  const runEvent = (eventType: "press" | "release") => {
    const handler = element.events.find((event) => event.eventType === eventType);
    if (handler) {
      for (const command of handler.commands) {
        if (command.type === "navigate") controller.navigateToScreen(String(command.args.screenId ?? ""));
        else if (command.type === "open-popup") controller.openPopup(String(command.args.popupId ?? ""));
        else if (command.type === "close-popup") controller.closePopup();
        else if (command.type === "set-tag-value")
          controller.writeTag(String(command.args.tagPath ?? ""), coerceRuntimeInput(String(command.args.value ?? "")));
        else if (command.type === "change-language") controller.setLanguage(String(command.args.languageId ?? ""));
        else if (command.type === "export-data-log") controller.exportDataLogCsv(String(command.args.dataLogId ?? ""));
        else if (command.type === "clear-data-log") controller.clearDataLog(String(command.args.dataLogId ?? ""));
        else if (command.type === "apply-recipe") controller.applyRecipe(String(command.args.recipeId ?? ""), { sourceObjectId: element.id });
        else if (command.type === "login-user") controller.login(String(command.args.username ?? ""));
        else if (command.type === "logout-user") controller.logout();
      }
    }
    onAction();
  };

  const valueBinding = element.bindings.find((binding) => binding.targetProperty === "value");

  if (definition?.typeId === "common.button" || definition?.typeId === "common.hmi-button-control") {
    const enabled = props.enabled !== false;
    const stateLabel = props.state !== undefined ? ` · ${String(props.state)}` : "";
    return (
      <button
        type="button"
        className="esco-hmi-live esco-hmi-live--button"
        style={baseStyle}
        disabled={!enabled}
        data-element-id={element.id}
        onPointerDown={() => runEvent("press")}
        onPointerUp={() => runEvent("release")}
        onPointerLeave={(event) => {
          if (event.buttons) runEvent("release");
        }}
      >
        {resolvedString(state, element, "label", element.name)}
        {stateLabel}
      </button>
    );
  }

  if (definition?.typeId === "common.numeric-input") {
    const path = valueBinding?.source.kind === "tag" ? valueBinding.source.path : undefined;
    return (
      <div className="esco-hmi-live esco-hmi-live--field" style={baseStyle} data-element-id={element.id}>
        <span className="esco-hmi-live__label">{resolvedString(state, element, "label", element.name)}</span>
        <LiveNumericInput
          value={props.value ?? null}
          onCommit={(raw) => {
            if (path) controller.writeTag(path, coerceRuntimeInput(raw), { sourceObjectId: element.id });
            onAction();
          }}
        />
      </div>
    );
  }

  if (definition?.typeId === "common.numeric-display") {
    const precision = Number(element.properties.precision ?? 0);
    const raw = props.value;
    const text =
      typeof raw === "number" ? raw.toFixed(Number.isFinite(precision) ? Math.max(0, precision) : 0) : resolvedString(state, element, "value", "—");
    return (
      <div className="esco-hmi-live esco-hmi-live--display" style={baseStyle} data-element-id={element.id}>
        <span className="esco-hmi-live__label">{resolvedString(state, element, "label", element.name)}</span>
        <strong className="esco-hmi-live__value">{text}</strong>
      </div>
    );
  }

  if (definition?.typeId === "alarms.alarm-summary") {
    const filterText = typeof element.properties.filter === "string" ? element.properties.filter : "";
    const rows = controller.getAlarmTableRows("summary", filterText);
    return (
      <div className="esco-hmi-live esco-hmi-live--alarms" style={baseStyle} data-element-id={element.id}>
        <strong>{resolvedString(state, element, "title", "Alarm Summary")}</strong>
        {rows.length === 0 ? (
          <span className="esco-hmi-live__muted">No active alarms</span>
        ) : (
          <ul>
            {rows.slice(0, 5).map((alarm) => (
              <li key={alarm.alarmId} className={`esco-hmi-live__alarm is-${alarm.state}`}>
                <span>{alarm.name}</span>
                <span>{alarm.severity}</span>
                {alarm.allowAcknowledge && !alarm.acknowledged ? (
                  <button
                    type="button"
                    onClick={() => {
                      controller.acknowledgeAlarms([alarm.alarmId]);
                      onAction();
                    }}
                  >
                    Ack
                  </button>
                ) : (
                  <span className="esco-hmi-live__muted">{alarm.acknowledged ? "ack" : ""}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  if (definition?.typeId === "trends.trend-chart") {
    return (
      <div className="esco-hmi-live esco-hmi-live--trend" style={baseStyle} data-element-id={element.id}>
        <strong className="esco-hmi-live__trend-title">{resolvedString(state, element, "title", "Trend")}</strong>
        <LiveTrendChart
          controller={controller}
          trendId={typeof element.properties.trendId === "string" ? element.properties.trendId : undefined}
        />
      </div>
    );
  }

  if (definition?.typeId === "common.indicator-lamp") {
    const lit = props.value === true || props.value === 1 || props.value === "true";
    const onColor = String(element.properties.onColor ?? "#16a34a");
    const offColor = String(element.properties.offColor ?? "#94a3b8");
    const fill = (props.fillColor as string) ?? (lit ? onColor : offColor);
    return (
      <div
        className="esco-hmi-live esco-hmi-live--lamp"
        style={{ ...baseStyle, background: fill }}
        data-element-id={element.id}
        data-lit={lit ? "true" : "false"}
      >
        <span className="esco-hmi-live__lamp-dot" aria-hidden="true" />
        <span>{resolvedString(state, element, "label", element.name)}</span>
      </div>
    );
  }

  if (definition?.typeId === "common.multistate-indicator") {
    const caption =
      props.text !== undefined && props.text !== null
        ? String(props.text)
        : props.state !== undefined && props.state !== null
          ? String(props.state)
          : resolvedString(state, element, "label", element.name);
    return (
      <div
        className="esco-hmi-live esco-hmi-live--multistate"
        style={baseStyle}
        data-element-id={element.id}
        data-state={props.state !== undefined && props.state !== null ? String(props.state) : ""}
      >
        <span>{caption}</span>
      </div>
    );
  }

  // Text display / generic: show resolved text + color.
  return (
    <div className="esco-hmi-live esco-hmi-live--text" style={baseStyle} data-element-id={element.id}>
      <span>{resolvedString(state, element, "text", element.name)}</span>
    </div>
  );
}

/** Operator-facing live runtime preview wired to a real {@link HmiRuntimeController}. */
function LiveRuntimePreview({
  project,
  createRuntimeTagProvider,
}: {
  project: HmiProject;
  createRuntimeTagProvider?: () => RuntimeTagProvider;
}) {
  const controllerRef = useRef<HmiRuntimeController | null>(null);
  const [, setVersion] = useState(0);
  const [dataLogExportMessage, setDataLogExportMessage] = useState("");
  const [recipeApplyMessage, setRecipeApplyMessage] = useState("");
  const [alarmPanelMode, setAlarmPanelMode] = useState<"manager" | "history">("manager");
  const [alarmFilter, setAlarmFilter] = useState("");
  const [diagnosticsPanelMode, setDiagnosticsPanelMode] = useState<HmiDiagnosticsTableVariant>("live");

  // Create + start the controller inside the effect so React 18 StrictMode's
  // mount→unmount→mount cycle disposes the first instance and rebuilds a fresh,
  // fully-wired one (disposing in render-phase would leave an empty engine).
  useEffect(() => {
    const provider = createRuntimeTagProvider?.();
    const controller = new HmiRuntimeController(project, provider ? { provider } : undefined);
    controller.start();
    controllerRef.current = controller;
    const bump = () => setVersion((value) => value + 1);
    bump();
    const unsubscribe = controller.bindingEngine.subscribe(() => bump());
    const interval = window.setInterval(() => {
      controller.tick();
      bump();
    }, 500);
    return () => {
      unsubscribe();
      window.clearInterval(interval);
      controller.dispose();
      controllerRef.current = null;
    };
  }, [project, createRuntimeTagProvider]);

  const controller = controllerRef.current;
  if (!controller || controller.isDisposed) {
    return (
      <div className="esco-hmi-live-preview" data-testid="hmi-live-preview">
        <div className="esco-hmi-live-preview__empty">Starting runtime preview…</div>
      </div>
    );
  }

  const bump = () => setVersion((value) => value + 1);
  const session = controller.getSession();
  const screen = project.screens.find((candidate) => candidate.id === session.currentScreenId) ?? project.screens[0];
  const states = controller.resolveScreen();
  const stateById = new Map(states.map((state) => [state.elementId, state]));
  const alarms = controller.getAlarmRuntime();
  const alarmManagerRows = controller.getAlarmTableRows("manager", alarmFilter);
  const alarmHistoryRows = controller.getAlarmTableRows("history", alarmFilter);
  const dataLogs = controller.getDataLogBuffers();
  const recipes = project.recipes ?? [];
  const recipeApplyHistory = controller.getRecipeApplyHistory();
  const latestRecipeApply = recipeApplyHistory.length ? recipeApplyHistory[recipeApplyHistory.length - 1] : undefined;
  const diagnosticsRuntime = controller.getDiagnosticsRuntime();
  const diagnosticRows = hmiDiagnosticsTableRows(diagnosticsRuntime, diagnosticsPanelMode);
  const tags = controller.provider.metadata();
  const elements = controller.activeElements();
  const tagPaths = {
    tankLevel: preferredRuntimeTagPath(tags, [/tank.*level/i, /level/i], "Tank_Level"),
    pumpSpeed: preferredRuntimeTagPath(tags, [/pump.*speed/i, /motor.*speed/i, /line.*speed/i], "Motor_Speed"),
    motorRunning: preferredRuntimeTagPath(tags, [/motor.*run/i, /pump.*run/i, /running/i], "Motor_Running"),
    fault: preferredRuntimeTagPath(tags, [/fault/i, /alarm/i, /tank.*high/i], "Tank_HighAlarm"),
    lineStatus: preferredRuntimeTagPath(tags, [/line.*status/i, /mode/i, /state/i], "Line_Status"),
  };
  const tankLevelSample = controller.provider.read(tagPaths.tankLevel);
  const pumpSpeedSample = controller.provider.read(tagPaths.pumpSpeed);
  const motorSample = controller.provider.read(tagPaths.motorRunning);
  const faultSample = controller.provider.read(tagPaths.fault);
  const lineStatusSample = controller.provider.read(tagPaths.lineStatus);
  const tankLevel = numericRuntimeValue(tankLevelSample.value, 42);
  const pumpSpeed = numericRuntimeValue(pumpSpeedSample.value, boolRuntimeValue(motorSample.value) ? 65 : 0);
  const motorRunning = boolRuntimeValue(motorSample.value);
  const lineMode = String(lineStatusSample.value ?? "AUTO").toUpperCase().includes("MANUAL") ? "MANUAL" : "AUTO";
  const runtimeName = displayRuntimeName(screen?.name, displayRuntimeName(project.name, "HMI Runtime"));
  const operatorName = displayRuntimeName(session.currentUserFullName || session.currentUserName, "Guest");
  const activeAlarmCount = project.alarms.length > 0 ? alarms.summary.activeCount : 0;
  const faultActive = boolRuntimeValue(faultSample.value) || activeAlarmCount > 0;
  const processNodes = [
    { key: "tank", label: "Tank", detail: `${tankLevel.toFixed(0)}%`, state: tankLevel >= 80 ? "warn" : "good" },
    { key: "pump", label: "Pump", detail: motorRunning ? "RUN" : "STOP", state: motorRunning ? "good" : "idle" },
    { key: "valve", label: "Valve", detail: faultActive ? "FAULT" : "OPEN", state: faultActive ? "alarm" : "good" },
    { key: "conveyor", label: "Conveyor", detail: lineMode, state: lineMode === "AUTO" ? "good" : "manual" },
    { key: "filler", label: "Filler", detail: faultActive ? "HOLD" : "READY", state: faultActive ? "warn" : "good" },
  ];
  const alarmStripRows =
    controller.getAlarmTableRows("summary").slice(0, 3).map((alarm) => ({
      id: alarm.id,
      severity: alarm.severity.toUpperCase(),
      message: alarm.message ?? alarm.name,
      state: alarm.state,
    }));
  const visibleAlarmRows =
    alarmStripRows.length > 0
      ? alarmStripRows
      : [
          { id: "no-active-alarms", severity: "INFO", message: "No active alarms", state: "normal" },
        ];
  const writeRuntimeTag = (path: string, value: HmiTagValue) => {
    if (controller.provider.getMetadata(path)) controller.writeTag(path, value);
  };
  const runOperatorAction = (action: "start" | "stop" | "reset" | "manual") => {
    if (action === "start") {
      writeRuntimeTag(tagPaths.motorRunning, true);
      writeRuntimeTag(tagPaths.pumpSpeed, 72);
      writeRuntimeTag(tagPaths.lineStatus, "AUTO");
    } else if (action === "stop") {
      writeRuntimeTag(tagPaths.motorRunning, false);
      writeRuntimeTag(tagPaths.pumpSpeed, 0);
      writeRuntimeTag(tagPaths.lineStatus, "STOPPED");
    } else if (action === "reset") {
      writeRuntimeTag(tagPaths.fault, false);
      controller.acknowledgeAllVisible();
    } else {
      writeRuntimeTag(tagPaths.lineStatus, lineMode === "MANUAL" ? "AUTO" : "MANUAL");
    }
    controller.tick();
    bump();
  };

  return (
    <div className="esco-hmi-live-preview" data-testid="hmi-live-preview">
      <section className="esco-hmi-operator" data-testid="hmi-operator-runtime" aria-label="Operator runtime preview">
        <div className="esco-hmi-operator__status" data-testid="hmi-operator-status">
          <strong>{runtimeName}</strong>
          <span className={`esco-hmi-operator__mode is-${lineMode.toLowerCase()}`}>{lineMode}</span>
          <span>Operator: {operatorName}</span>
          <span className={activeAlarmCount > 0 ? "is-alarm" : undefined}>{activeAlarmCount} Active Alarms</span>
        </div>

        <div className="esco-hmi-operator__main">
          <div className="esco-hmi-operator__process-stack">
            <div className="esco-hmi-operator__mimic" data-testid="hmi-process-mimic" aria-label="Process mimic">
              {processNodes.map((node, index) => (
                <div key={node.key} className="esco-hmi-operator__mimic-step">
                  <div className={`esco-hmi-operator__asset esco-hmi-operator__asset--${node.key} is-${node.state}`}>
                    <span className="esco-hmi-operator__asset-shape" aria-hidden="true" />
                    <strong>{node.label}</strong>
                    <em>{node.detail}</em>
                  </div>
                  {index < processNodes.length - 1 ? <span className="esco-hmi-operator__flow" aria-hidden="true" /> : null}
                </div>
              ))}
            </div>

            <div className="esco-hmi-live-preview__stage" aria-label="Configured screen runtime layer">
              {screen ? (
                <div
                  className="esco-hmi-live-preview__surface"
                  style={{ aspectRatio: `${screen.width} / ${screen.height}`, background: screen.background }}
                >
                  {elements.map((element) => (
                    <LivePreviewElement
                      key={element.id}
                      element={element}
                      surfaceWidth={screen.width}
                      surfaceHeight={screen.height}
                      state={stateById.get(element.id)}
                      controller={controller}
                      onAction={bump}
                    />
                  ))}
                  {elements.length === 0 ? <div className="esco-hmi-live-preview__empty">No objects on this screen.</div> : null}
                </div>
              ) : (
                <div className="esco-hmi-live-preview__empty">No screen to preview.</div>
              )}
            </div>
          </div>

          <aside className="esco-hmi-operator__telemetry" aria-label="Live operator values and controls">
            <h3>Live Values</h3>
            <dl className="esco-hmi-operator__values">
              <dt>Tank Level</dt>
              <dd>{formatRuntimeValue(tankLevelSample.value, `${tankLevel.toFixed(0)}%`)}</dd>
              <dt>Pump Speed</dt>
              <dd>{formatRuntimeValue(pumpSpeedSample.value, String(pumpSpeed))} Hz</dd>
              <dt>Motor</dt>
              <dd className={motorRunning ? "is-good" : "is-idle"}>{motorRunning ? "RUNNING" : "STOPPED"}</dd>
              <dt>Fault</dt>
              <dd className={faultActive ? "is-alarm" : "is-good"}>{faultActive ? "ACTIVE" : "CLEAR"}</dd>
            </dl>
            <div className="esco-hmi-operator__controls" aria-label="Operator controls">
              <button type="button" className="is-start" onClick={() => runOperatorAction("start")}>
                START
              </button>
              <button type="button" className="is-stop" onClick={() => runOperatorAction("stop")}>
                STOP
              </button>
              <button type="button" onClick={() => runOperatorAction("reset")}>
                RESET
              </button>
              <button type="button" className={lineMode === "MANUAL" ? "is-manual is-active" : "is-manual"} onClick={() => runOperatorAction("manual")}>
                MANUAL MODE
              </button>
            </div>
          </aside>
        </div>

        <div className="esco-hmi-operator__alarm-strip" data-testid="hmi-operator-alarm-strip">
          <strong>Alarm Strip</strong>
          {visibleAlarmRows.map((alarm) => (
            <span key={alarm.id} className={`is-${alarm.state}`}>
              <em>{alarm.severity}</em>
              {alarm.message}
            </span>
          ))}
          <button
            type="button"
            onClick={() => {
              controller.acknowledgeAllVisible();
              bump();
            }}
          >
            ACK
          </button>
        </div>

        <nav className="esco-hmi-operator__bottom-nav" aria-label="Operator runtime navigation">
          {OPERATOR_NAV_ITEMS.map((item) => {
            const target =
              item === "Home"
                ? project.screens.find((candidate) => candidate.id === project.homeScreenId)
                : project.screens.find((candidate) => candidate.name.toLowerCase() === item.toLowerCase());
            const active = Boolean(target && target.id === session.currentScreenId);
            const testId = `hmi-operator-nav-${item.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
            return (
              <button
                key={item}
                type="button"
                className={active ? "is-active" : undefined}
                data-testid={testId}
                disabled={!target}
                aria-current={active ? "page" : undefined}
                onClick={() => {
                  if (target) {
                    controller.navigateToScreen(target.id);
                    bump();
                  }
                }}
              >
                {item}
              </button>
            );
          })}
        </nav>
      </section>

      <aside className="esco-hmi-live-preview__panels">
        <section className="esco-hmi-live-preview__panel" aria-label="Runtime status">
          <h3>Runtime</h3>
          <p>
            Screen: <strong>{session.currentScreenName ?? "—"}</strong>
          </p>
          <p>
            Alarms active: <strong data-testid="live-alarm-active">{alarms.summary.activeCount}</strong> · unack{" "}
            <strong>{alarms.summary.unacknowledgedCount}</strong>
          </p>
          <p className="esco-hmi-live-preview__user">
            User: <strong data-testid="live-user">{session.currentUserName || "Guest"}</strong>
            {project.security.users.length > 0 ? (
              <select
                aria-label="Runtime user"
                value=""
                onChange={(event) => {
                  if (event.target.value === "__logout") controller.logout();
                  else if (event.target.value) controller.login(event.target.value);
                  bump();
                }}
              >
                <option value="">Log in…</option>
                {project.security.users.map((user) => (
                  <option key={user.id} value={user.username}>
                    {user.username}
                  </option>
                ))}
                <option value="__logout">Log out</option>
              </select>
            ) : null}
          </p>
          {controller.getLanguages().length > 1 ? (
            <p className="esco-hmi-live-preview__language">
              Language:{" "}
              <select
                aria-label="Runtime language"
                value={controller.getCurrentLanguage()}
                onChange={(event) => {
                  controller.setLanguage(event.target.value);
                  bump();
                }}
              >
                {controller.getLanguages().map((language) => (
                  <option key={language.languageId} value={language.languageId}>
                    {language.displayName}
                  </option>
                ))}
              </select>
            </p>
          ) : null}
          <button
            type="button"
            className="esco-btn esco-btn--xs"
            onClick={() => {
              controller.acknowledgeAllVisible();
              bump();
            }}
          >
            Acknowledge All
          </button>
          <button
            type="button"
            className="esco-btn esco-btn--xs"
            onClick={() => {
              controller.resetAllVisible();
              bump();
            }}
          >
            Reset Returned
          </button>
        </section>

        <section className="esco-hmi-live-preview__panel esco-hmi-live-preview__panel--alarms" aria-label="Alarm manager and history">
          <div className="esco-hmi-live-preview__panel-head">
            <h3>Alarm Manager</h3>
            <div className="esco-hmi-live-preview__tabs" role="tablist" aria-label="Alarm runtime view">
              <button
                type="button"
                className={alarmPanelMode === "manager" ? "is-active" : undefined}
                aria-selected={alarmPanelMode === "manager"}
                onClick={() => setAlarmPanelMode("manager")}
              >
                Manager
              </button>
              <button
                type="button"
                className={alarmPanelMode === "history" ? "is-active" : undefined}
                aria-selected={alarmPanelMode === "history"}
                onClick={() => setAlarmPanelMode("history")}
              >
                Event Log
              </button>
            </div>
          </div>
          <div className="esco-hmi-live-preview__alarm-tools">
            <input
              aria-label="Alarm manager filter"
              value={alarmFilter}
              placeholder="Filter alarms"
              onChange={(event) => setAlarmFilter(event.target.value)}
            />
            <button
              type="button"
              className="esco-btn esco-btn--xs"
              onClick={() => {
                controller.acknowledgeAllVisible();
                bump();
              }}
            >
              Ack All
            </button>
            <button
              type="button"
              className="esco-btn esco-btn--xs"
              onClick={() => {
                controller.resetAllVisible();
                bump();
              }}
            >
              Reset
            </button>
          </div>
          {alarmPanelMode === "manager" ? (
            <ul className="esco-hmi-live-preview__alarms" data-testid="hmi-live-alarm-manager">
              {alarmManagerRows.length === 0 ? (
                <li className="esco-hmi-live-preview__alarm-empty">No alarm rows</li>
              ) : (
                alarmManagerRows.map((alarm) => (
                  <li
                    key={alarm.id}
                    className={`esco-hmi-live-preview__alarm-row is-${alarm.state}`}
                    data-alarm-id={alarm.alarmId}
                    data-state={alarm.state}
                  >
                    <span className={`esco-hmi-live-preview__alarm-severity is-${alarm.severity}`}>{alarm.severity}</span>
                    <strong title={alarm.message ?? alarm.name}>{alarm.name}</strong>
                    <span className="esco-hmi-live-preview__alarm-state">{alarmRuntimeLabel(alarm.state)}</span>
                    <em>{alarmRowValue(alarm)}</em>
                    <div className="esco-hmi-live-preview__alarm-actions">
                      <button
                        type="button"
                        disabled={alarm.acknowledged || alarm.suppressed || !alarm.allowAcknowledge}
                        onClick={() => {
                          controller.acknowledgeAlarms([alarm.alarmId]);
                          bump();
                        }}
                      >
                        Ack
                      </button>
                      <button
                        type="button"
                        disabled={alarm.active || alarm.suppressed || alarm.state === "normal"}
                        onClick={() => {
                          controller.resetAlarms([alarm.alarmId]);
                          bump();
                        }}
                      >
                        Reset
                      </button>
                    </div>
                  </li>
                ))
              )}
            </ul>
          ) : (
            <ul className="esco-hmi-live-preview__alarm-history" data-testid="hmi-live-alarm-history">
              {alarmHistoryRows.length === 0 ? (
                <li className="esco-hmi-live-preview__alarm-empty">No alarm events</li>
              ) : (
                alarmHistoryRows.slice(0, 10).map((alarm) => (
                  <li key={alarm.id} className={`is-${alarm.eventType ?? "event"}`}>
                    <time>{alarmTimestampLabel(alarm.timestampMs)}</time>
                    <strong>{alarmRuntimeLabel(alarm.eventType)}</strong>
                    <span>{alarm.name}</span>
                    <em>{alarmRuntimeLabel(alarm.state)}</em>
                  </li>
                ))
              )}
            </ul>
          )}
        </section>

        <section className="esco-hmi-live-preview__panel" aria-label="Recipe runtime">
          <h3>Recipes ({recipes.length})</h3>
          {recipes.length === 0 ? (
            <p className="esco-hmi-live__muted">No recipes configured.</p>
          ) : (
            <ul className="esco-hmi-live-preview__data-logs" data-testid="hmi-live-recipes">
              {recipes.map((recipe) => (
                <li key={recipe.id} data-testid="hmi-live-recipe" data-values={recipe.items.length}>
                  <div>
                    <strong>{recipe.name}</strong>
                    <span>{recipe.items.length} value{recipe.items.length === 1 ? "" : "s"}</span>
                    <em>{recipe.items.slice(0, 3).map((item) => `${item.tagPath}=${String(item.value)}`).join(" · ") || "no values"}</em>
                  </div>
                  <div className="esco-hmi-live-preview__data-log-actions">
                    <button
                      type="button"
                      className="esco-btn esco-btn--xs"
                      disabled={recipe.items.length === 0}
                      onClick={() => {
                        const result = controller.applyRecipe(recipe.id);
                        setRecipeApplyMessage(result.message);
                        bump();
                      }}
                    >
                      Apply
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {recipeApplyMessage ? <p className="esco-hmi-live-preview__export" data-testid="hmi-live-recipe-apply">{recipeApplyMessage}</p> : null}
          {latestRecipeApply ? (
            <ul className="esco-hmi-live-preview__diagnostics" data-testid="hmi-live-recipe-history">
              {latestRecipeApply.rows.slice(0, 6).map((row) => (
                <li key={`${latestRecipeApply.timestampMs}:${row.itemId}`} className={row.status === "failed" ? "is-error" : "is-info"}>
                  <span>
                    <strong>{row.status}</strong> {row.tagPath}
                  </span>
                  <em>{String(row.value)}</em>
                </li>
              ))}
            </ul>
          ) : null}
        </section>

        <section className="esco-hmi-live-preview__panel" aria-label="Tag inspector">
          <h3>Tag Inspector</h3>
          <ul className="esco-hmi-live-preview__tags">
            {tags.map((meta) => {
              const sample = controller.provider.read(meta.path);
              return (
                <li key={meta.path} className={`esco-hmi-live-preview__tag is-${sample.quality}`}>
                  <span className="esco-hmi-live-preview__tag-name" title={meta.dataType}>
                    {meta.path}
                  </span>
                  <input
                    className="esco-hmi-live-preview__tag-input"
                    aria-label={`Set ${meta.path}`}
                    defaultValue={sample.value === null ? "" : String(sample.value)}
                    key={`${meta.path}-${String(sample.value)}`}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter") return;
                      const provider = controller.provider;
                      const next = coerceRuntimeInput((event.target as HTMLInputElement).value);
                      if (provider instanceof SimulatorTagProvider) provider.setValue(meta.path, next);
                      else controller.writeTag(meta.path, next);
                      controller.tick();
                      bump();
                    }}
                  />
                </li>
              );
            })}
          </ul>
        </section>

        <section className="esco-hmi-live-preview__panel" aria-label="Data log runtime">
          <h3>Data Logs ({dataLogs.length})</h3>
          {dataLogs.length === 0 ? (
            <p className="esco-hmi-live__muted">No data logs configured.</p>
          ) : (
            <ul className="esco-hmi-live-preview__data-logs">
              {dataLogs.map((buffer) => (
                <li key={buffer.dataLogId} data-testid="hmi-live-data-log" data-rows={buffer.rows.length}>
                  <div>
                    <strong>{buffer.dataLogName}</strong>
                    <span>{buffer.status}</span>
                    <em>{buffer.rows.length} row{buffer.rows.length === 1 ? "" : "s"}</em>
                  </div>
                  <div className="esco-hmi-live-preview__data-log-actions">
                    <button
                      type="button"
                      className="esco-btn esco-btn--xs"
                      onClick={() => {
                        const exported = controller.exportDataLogCsv(buffer.dataLogId);
                        setDataLogExportMessage(exported ? `${exported.fileName}: ${exported.rowCount} row(s)` : "Data log not found.");
                      }}
                    >
                      Export
                    </button>
                    <button
                      type="button"
                      className="esco-btn esco-btn--xs"
                      onClick={() => {
                        controller.clearDataLog(buffer.dataLogId);
                        setDataLogExportMessage("");
                        bump();
                      }}
                    >
                      Clear
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {dataLogExportMessage ? <p className="esco-hmi-live-preview__export" data-testid="hmi-live-data-log-export">{dataLogExportMessage}</p> : null}
        </section>

        <section className="esco-hmi-live-preview__panel esco-hmi-live-preview__panel--diagnostics" aria-label="Runtime diagnostics">
          <div className="esco-hmi-live-preview__panel-head">
            <h3>Diagnostics ({diagnosticsRuntime.summary.activeCount})</h3>
            <div className="esco-hmi-live-preview__tabs" role="tablist" aria-label="Diagnostics runtime view">
              <button
                type="button"
                className={diagnosticsPanelMode === "live" ? "is-active" : undefined}
                aria-selected={diagnosticsPanelMode === "live"}
                onClick={() => setDiagnosticsPanelMode("live")}
              >
                Live
              </button>
              <button
                type="button"
                className={diagnosticsPanelMode === "history" ? "is-active" : undefined}
                aria-selected={diagnosticsPanelMode === "history"}
                onClick={() => setDiagnosticsPanelMode("history")}
              >
                History
              </button>
            </div>
          </div>
          <div className="esco-hmi-live-preview__diagnostic-summary" data-testid="hmi-runtime-diagnostic-summary">
            <span><strong>{diagnosticsRuntime.summary.activeErrorCount}</strong> errors</span>
            <span><strong>{diagnosticsRuntime.summary.activeWarningCount}</strong> warnings</span>
            <span><strong>{diagnosticsRuntime.summary.historyCount}</strong> history</span>
          </div>
          {diagnosticRows.length === 0 ? (
            <p className="esco-hmi-live__muted">
              {diagnosticsPanelMode === "live" ? "No active runtime diagnostics." : "No diagnostic history."}
            </p>
          ) : (
            <ul
              className="esco-hmi-live-preview__diagnostics"
              data-testid={diagnosticsPanelMode === "live" ? "hmi-runtime-diagnostics-live" : "hmi-runtime-diagnostics-history"}
            >
              {diagnosticRows.slice(0, 10).map((row) => (
                <li key={`${row.id}:${row.status}:${row.timestampMs}`} className={`is-${row.severity} is-${row.status}`}>
                  <span className="esco-hmi-live-preview__diagnostic-meta">
                    <strong>{row.severity}</strong>
                    <time>{diagnosticTimestampLabel(row)}</time>
                    <em>{row.status}{row.occurrences > 1 ? ` x${row.occurrences}` : ""}</em>
                  </span>
                  <span>
                    <strong>{row.code}</strong> {row.message}
                  </span>
                  {row.target ? <em>{row.target}</em> : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      </aside>
    </div>
  );
}

function ToolboxGroup({
  label,
  definitions,
  disabled,
  onAdd,
}: {
  label: string;
  definitions: HmiElementDefinition[];
  disabled: boolean;
  onAdd: (typeId: string) => void;
}) {
  return (
    <section className="esco-hmi-toolbox__group">
      <h3>{label}</h3>
      <div className="esco-hmi-toolbox__buttons">
        {definitions.map((definition) => (
          <button
            key={definition.typeId}
            type="button"
            disabled={disabled}
            onClick={() => onAdd(definition.typeId)}
            title={definition.description}
          >
            <span>{definition.displayName}</span>
            {definition.runtimeSupport === "model-only" ? <em>model</em> : null}
          </button>
        ))}
      </div>
    </section>
  );
}

/** One typed property editor input, driven by the element-definition property type. */
function PropertyField({
  definition,
  value,
  screens,
  trends,
  knownTagPaths,
  onCommit,
}: {
  definition: HmiElementPropertyDefinition;
  value: unknown;
  screens: { id: string; name: string }[];
  trends: { id: string; name: string }[];
  knownTagPaths: string[];
  onCommit: (value: unknown) => void;
}) {
  const id = `hmi-prop-${definition.name}`;
  // A trend-chart's trendId picks one of the project's authored trends.
  if (definition.name === "trendId") {
    return (
      <label className="esco-hmi-edit__row">
        <span>{definition.label}</span>
        <select
          aria-label={`Property ${definition.name}`}
          value={value === undefined || value === null ? "" : String(value)}
          onChange={(event) => onCommit(event.target.value || undefined)}
        >
          <option value="">(first trend)</option>
          {trends.map((trend) => (
            <option key={trend.id} value={trend.id}>{trend.name}</option>
          ))}
        </select>
      </label>
    );
  }
  if (definition.dataType === "boolean") {
    return (
      <label className="esco-hmi-edit__row esco-hmi-edit__row--check">
        <span>{definition.label}</span>
        <input
          type="checkbox"
          aria-label={`Property ${definition.name}`}
          defaultChecked={Boolean(value)}
          onChange={(event) => onCommit(event.target.checked)}
        />
      </label>
    );
  }
  if (definition.dataType === "screen-id") {
    return (
      <label className="esco-hmi-edit__row">
        <span>{definition.label}</span>
        <select
          aria-label={`Property ${definition.name}`}
          defaultValue={value === undefined || value === null ? "" : String(value)}
          onChange={(event) => onCommit(event.target.value || undefined)}
        >
          <option value="">(none)</option>
          {screens.map((screen) => (
            <option key={screen.id} value={screen.id}>
              {screen.name}
            </option>
          ))}
        </select>
      </label>
    );
  }
  const inputType =
    definition.dataType === "number" ? "number" : definition.dataType === "color" ? "color" : "text";
  const listId = definition.dataType === "tag-path" ? `${id}-tags` : undefined;
  return (
    <label className="esco-hmi-edit__row">
      <span>{definition.label}</span>
      <input
        type={inputType}
        aria-label={`Property ${definition.name}`}
        list={listId}
        defaultValue={value === undefined || value === null ? "" : String(value)}
        spellCheck={false}
        onBlur={(event) => {
          const raw = event.target.value;
          const next = definition.dataType === "number" ? (raw === "" ? undefined : Number(raw)) : raw;
          if (String(next ?? "") !== String(value ?? "")) onCommit(next);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
      />
      {listId ? (
        <datalist id={listId}>
          {knownTagPaths.map((path) => (
            <option key={path} value={path} />
          ))}
        </datalist>
      ) : null}
    </label>
  );
}

/** Editable inspector for the selected element. Remounted per element via React key. */
function ElementInspector({
  element,
  screens,
  popups,
  trends,
  dataLogs,
  recipes,
  languages,
  users,
  runtimeSession,
  knownTagPaths,
  onUpdate,
  onUpdateGeometry,
  onDelete,
  onSetBinding,
  onRemoveBinding,
  onAddCommand,
  onRemoveEventCommand,
  onPreviewEvent,
}: {
  element: HmiGraphicElement;
  screens: { id: string; name: string }[];
  popups: { id: string; name: string }[];
  trends: { id: string; name: string }[];
  dataLogs: { id: string; name: string }[];
  recipes: { id: string; name: string }[];
  languages: { languageId: string; displayName: string }[];
  users: { username: string; fullName?: string }[];
  runtimeSession: HmiRuntimeSession;
  knownTagPaths: string[];
  onUpdate: (patch: ElementPatch) => void;
  onUpdateGeometry: (geometry: HmiGraphicElement["geometry"]) => void;
  onDelete: () => void;
  onSetBinding: (binding: BindingDraft) => void;
  onRemoveBinding: (bindingId: string) => void;
  onAddCommand: (eventType: "press" | "release", command: EventCommandDraft) => void;
  onRemoveEventCommand: (eventId: string, commandId: string) => void;
  onPreviewEvent: (eventType: "press" | "release") => void;
}) {
  const definition = getHmiElementDefinition(element.typeId);
  const bindableProps = definition?.properties.filter((property) => property.bindable) ?? [];
  const eventTypes = definition?.events ?? [];
  // Navigation commands only fire on press/release; an element whose only event is
  // e.g. "value-change" cannot host a navigate command, so don't offer the form for it.
  const navEventTypes = eventTypes.filter(
    (type): type is "press" | "release" => type === "press" || type === "release",
  );

  const [bindTarget, setBindTarget] = useState(bindableProps[0]?.name ?? "value");
  const [bindKind, setBindKind] = useState<HmiBindingSourceKind>("tag");
  const [bindPath, setBindPath] = useState("");
  const [bindMode, setBindMode] = useState<HmiPropertyBinding["mode"]>("read");
  const [cmdType, setCmdType] = useState<EventCommandDraft["type"]>("navigate");
  const [navScreen, setNavScreen] = useState(screens[0]?.id ?? "");
  const [popupTarget, setPopupTarget] = useState(popups[0]?.id ?? "");
  const [tagPath, setTagPath] = useState("");
  const [tagValue, setTagValue] = useState("");
  const [languageTarget, setLanguageTarget] = useState(languages[0]?.languageId ?? "");
  const [dataLogTarget, setDataLogTarget] = useState(dataLogs[0]?.id ?? "");
  const [recipeTarget, setRecipeTarget] = useState(recipes[0]?.id ?? "");
  const [loginUser, setLoginUser] = useState(users[0]?.username ?? "");
  const [navEvent, setNavEvent] = useState<"press" | "release">(navEventTypes[0] ?? "press");

  useEffect(() => {
    if (languageTarget && languages.some((language) => language.languageId === languageTarget)) return;
    setLanguageTarget(languages[0]?.languageId ?? "");
  }, [languageTarget, languages]);

  useEffect(() => {
    if (dataLogTarget && dataLogs.some((log) => log.id === dataLogTarget)) return;
    setDataLogTarget(dataLogs[0]?.id ?? "");
  }, [dataLogTarget, dataLogs]);

  useEffect(() => {
    if (recipeTarget && recipes.some((recipe) => recipe.id === recipeTarget)) return;
    setRecipeTarget(recipes[0]?.id ?? "");
  }, [recipeTarget, recipes]);

  useEffect(() => {
    if (loginUser && users.some((user) => user.username === loginUser)) return;
    setLoginUser(users[0]?.username ?? "");
  }, [loginUser, users]);

  const cmdLabel =
    cmdType === "navigate"
      ? "Add navigate"
      : cmdType === "open-popup"
        ? "Add open popup"
        : cmdType === "close-popup"
          ? "Add close popup"
          : cmdType === "set-tag-value"
            ? "Add set tag"
            : cmdType === "change-language"
              ? "Add language"
              : cmdType === "export-data-log"
                ? "Add export"
                : cmdType === "clear-data-log"
                  ? "Add clear log"
                  : cmdType === "apply-recipe"
                    ? "Add recipe"
                  : cmdType === "login-user"
                    ? "Add login"
                    : "Add logout";
  const cmdDisabled =
    (cmdType === "navigate" && !navScreen) ||
    (cmdType === "open-popup" && !popupTarget) ||
    (cmdType === "set-tag-value" && !tagPath.trim()) ||
    (cmdType === "change-language" && !languageTarget) ||
    ((cmdType === "export-data-log" || cmdType === "clear-data-log") && !dataLogTarget) ||
    (cmdType === "apply-recipe" && !recipeTarget) ||
    (cmdType === "login-user" && !loginUser);
  const previewRows = navEventTypes.map((eventType) => {
    const handler = element.events.find((event) => event.eventType === eventType);
    return { eventType, commandCount: handler?.commands.length ?? 0 };
  });
  const commandTargets = { screens, popups, dataLogs, recipes, languages, users };

  const submitCommand = () => {
    if (cmdType === "navigate") {
      if (!navScreen) return;
      onAddCommand(navEvent, { type: "navigate", args: { screenId: navScreen } });
    } else if (cmdType === "open-popup") {
      if (!popupTarget) return;
      onAddCommand(navEvent, { type: "open-popup", args: { popupId: popupTarget } });
    } else if (cmdType === "close-popup") {
      onAddCommand(navEvent, { type: "close-popup", args: {} });
    } else if (cmdType === "set-tag-value") {
      if (!tagPath.trim()) return;
      onAddCommand(navEvent, { type: "set-tag-value", args: { tagPath: tagPath.trim(), value: tagValue } });
      setTagPath("");
      setTagValue("");
    } else if (cmdType === "change-language") {
      if (!languageTarget) return;
      onAddCommand(navEvent, { type: "change-language", args: { languageId: languageTarget } });
    } else if (cmdType === "export-data-log") {
      if (!dataLogTarget) return;
      onAddCommand(navEvent, { type: "export-data-log", args: { dataLogId: dataLogTarget } });
    } else if (cmdType === "clear-data-log") {
      if (!dataLogTarget) return;
      onAddCommand(navEvent, { type: "clear-data-log", args: { dataLogId: dataLogTarget } });
    } else if (cmdType === "apply-recipe") {
      if (!recipeTarget) return;
      onAddCommand(navEvent, { type: "apply-recipe", args: { recipeId: recipeTarget } });
    } else if (cmdType === "login-user") {
      if (!loginUser) return;
      onAddCommand(navEvent, { type: "login-user", args: { username: loginUser } });
    } else {
      onAddCommand(navEvent, { type: "logout-user", args: {} });
    }
  };

  if (element.unsupported || !definition) {
    return (
      <>
        <div className="esco-hmi-properties__title">
          <h2>{element.name}</h2>
          <span className="esco-hmi-badge esco-hmi-badge--warn">Read-only</span>
        </div>
        <dl>
          <dt>Type</dt>
          <dd>{elementCaption(element)}</dd>
        </dl>
        <p className="esco-hmi-note">
          {element.unsupported?.readonlyReason ?? "This element type is not registered and cannot be edited."}
        </p>
        <button type="button" className="esco-btn esco-btn--danger" onClick={onDelete}>
          Delete element
        </button>
      </>
    );
  }

  const geo = element.geometry;
  const commitGeometry = (patch: Partial<HmiGraphicElement["geometry"]>) =>
    onUpdateGeometry({ ...geo, ...patch });

  return (
    <>
      <div className="esco-hmi-properties__title">
        <h2>{elementCaption(element)}</h2>
        {definition.runtimeSupport === "model-only" ? <span className="esco-hmi-badge">Model-only</span> : null}
      </div>

      <section>
        <h3>Element</h3>
        <label className="esco-hmi-edit__row">
          <span>Name</span>
          <input
            aria-label="Element name"
            defaultValue={element.name}
            spellCheck={false}
            onBlur={(event) => {
              const next = event.target.value.trim();
              if (next && next !== element.name) onUpdate({ name: next });
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
          />
        </label>
        <label className="esco-hmi-edit__row esco-hmi-edit__row--check">
          <span>Visible</span>
          <input
            type="checkbox"
            aria-label="Element visible"
            defaultChecked={element.visible !== false}
            onChange={(event) => onUpdate({ visible: event.target.checked })}
          />
        </label>
        <label className="esco-hmi-edit__row esco-hmi-edit__row--check">
          <span>Locked</span>
          <input
            type="checkbox"
            aria-label="Element locked"
            defaultChecked={Boolean(element.locked)}
            onChange={(event) => onUpdate({ locked: event.target.checked })}
          />
        </label>
      </section>

      <section>
        <h3>Geometry</h3>
        <div className="esco-hmi-edit__grid">
          {(["x", "y", "width", "height"] as const).map((dim) => (
            <label key={dim} className="esco-hmi-edit__cell">
              <span>{dim}</span>
              <input
                type="number"
                aria-label={`Geometry ${dim}`}
                defaultValue={geo[dim]}
                onBlur={(event) => {
                  const value = Number(event.target.value);
                  if (Number.isFinite(value) && value !== geo[dim]) commitGeometry({ [dim]: value });
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                }}
              />
            </label>
          ))}
        </div>
      </section>

      {definition.properties.length ? (
        <section>
          <h3>Properties</h3>
          {definition.properties.map((property) => (
            <PropertyField
              key={property.name}
              definition={property}
              value={element.properties[property.name]}
              screens={screens}
              trends={trends}
              knownTagPaths={knownTagPaths}
              onCommit={(value) => onUpdate({ properties: { [property.name]: value } })}
            />
          ))}
        </section>
      ) : null}

      <section data-testid="hmi-binding-section">
        <h3>Bindings ({element.bindings.length})</h3>
        {element.bindings.length === 0 ? (
          <p className="esco-empty">No bindings configured.</p>
        ) : (
          <ul className="esco-hmi-edit__list">
            {element.bindings.map((binding) => (
              <li key={binding.id}>
                <div className="esco-hmi-edit__list-main">
                  <strong>{binding.targetProperty}</strong>
                  <span>
                    {binding.source.kind}: {binding.source.path || "(blank)"} · {binding.mode}
                  </span>
                </div>
                <button
                  type="button"
                  className="esco-btn esco-btn--danger esco-btn--xs"
                  aria-label={`Remove binding ${binding.targetProperty}`}
                  onClick={() => onRemoveBinding(binding.id)}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="esco-hmi-edit__form" aria-label="Add binding">
          <select aria-label="Binding property" value={bindTarget} onChange={(event) => setBindTarget(event.target.value)}>
            {(bindableProps.length ? bindableProps : definition.properties).map((property) => (
              <option key={property.name} value={property.name}>
                {property.label}
              </option>
            ))}
          </select>
          <select aria-label="Binding source kind" value={bindKind} onChange={(event) => setBindKind(event.target.value as HmiBindingSourceKind)}>
            {BINDING_SOURCE_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {kind}
              </option>
            ))}
          </select>
          <input
            aria-label="Binding source path"
            list="hmi-bind-tags"
            placeholder={bindKind === "tag" ? "Tag path" : "Source path / expression"}
            value={bindPath}
            spellCheck={false}
            onChange={(event) => setBindPath(event.target.value)}
          />
          <datalist id="hmi-bind-tags">
            {knownTagPaths.map((path) => (
              <option key={path} value={path} />
            ))}
          </datalist>
          <select aria-label="Binding mode" value={bindMode} onChange={(event) => setBindMode(event.target.value as HmiPropertyBinding["mode"])}>
            <option value="read">read</option>
            <option value="write">write</option>
            <option value="read-write">read-write</option>
          </select>
          <button
            type="button"
            className="esco-btn esco-btn--primary esco-btn--xs"
            disabled={!bindPath.trim()}
            onClick={() => {
              onSetBinding({
                targetProperty: bindTarget,
                source: { kind: bindKind, path: bindPath.trim() },
                mode: bindMode,
              });
              setBindPath("");
            }}
          >
            Bind
          </button>
        </div>
      </section>

      <section>
        <h3>Events</h3>
        {element.events.length === 0 ? (
          <p className="esco-empty">No event handlers.</p>
        ) : (
          <ul className="esco-hmi-edit__list">
            {element.events.flatMap((event) =>
              event.commands.map((command) => (
                <li key={command.id}>
                  <div className="esco-hmi-edit__list-main">
                    <strong>
                      {event.eventType} → {command.type}
                    </strong>
                    <span>
                      {command.safety}
                      {commandTargetText(command, commandTargets) ? ` · ${commandTargetText(command, commandTargets)}` : ""}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="esco-btn esco-btn--danger esco-btn--xs"
                    aria-label={`Remove ${event.eventType} command`}
                    onClick={() => onRemoveEventCommand(event.id, command.id)}
                  >
                    Remove
                  </button>
                </li>
              )),
            )}
          </ul>
        )}
        {navEventTypes.length ? (
          <div className="esco-hmi-edit__form" aria-label="Add command">
            <select aria-label="Navigation event type" value={navEvent} onChange={(event) => setNavEvent(event.target.value as "press" | "release")}>
              {navEventTypes.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
            <select aria-label="Command type" value={cmdType} onChange={(event) => setCmdType(event.target.value as EventCommandDraft["type"])}>
              <option value="navigate">Navigate to screen</option>
              <option value="open-popup">Open popup</option>
              <option value="close-popup">Close popup</option>
              <option value="set-tag-value">Set tag value</option>
              <option value="change-language">Change language</option>
              <option value="export-data-log">Export data log</option>
              <option value="clear-data-log">Clear data log</option>
              <option value="apply-recipe">Apply recipe</option>
              <option value="login-user">Login user</option>
              <option value="logout-user">Logout user</option>
            </select>
            {cmdType === "navigate" ? (
              <select aria-label="Navigation target screen" value={navScreen} onChange={(event) => setNavScreen(event.target.value)}>
                {screens.length === 0 ? <option value="">(no screens)</option> : null}
                {screens.map((screen) => (
                  <option key={screen.id} value={screen.id}>
                    {screen.name}
                  </option>
                ))}
              </select>
            ) : null}
            {cmdType === "open-popup" ? (
              <select aria-label="Open popup target" value={popupTarget} onChange={(event) => setPopupTarget(event.target.value)}>
                {popups.length === 0 ? <option value="">(no popups)</option> : null}
                {popups.map((popup) => (
                  <option key={popup.id} value={popup.id}>
                    {popup.name}
                  </option>
                ))}
              </select>
            ) : null}
            {cmdType === "set-tag-value" ? (
              <>
                <input
                  aria-label="Set tag path"
                  list="hmi-bind-tags"
                  placeholder="Tag path"
                  value={tagPath}
                  spellCheck={false}
                  onChange={(event) => setTagPath(event.target.value)}
                />
                <input
                  aria-label="Set tag value"
                  placeholder="Value"
                  value={tagValue}
                  spellCheck={false}
                  onChange={(event) => setTagValue(event.target.value)}
                />
              </>
            ) : null}
            {cmdType === "change-language" ? (
              <select aria-label="Language target" value={languageTarget} onChange={(event) => setLanguageTarget(event.target.value)}>
                {languages.length === 0 ? <option value="">(no languages)</option> : null}
                {languages.map((language) => (
                  <option key={language.languageId} value={language.languageId}>
                    {language.displayName} ({language.languageId})
                  </option>
                ))}
              </select>
            ) : null}
            {cmdType === "export-data-log" || cmdType === "clear-data-log" ? (
              <select aria-label="Data log target" value={dataLogTarget} onChange={(event) => setDataLogTarget(event.target.value)}>
                {dataLogs.length === 0 ? <option value="">(no data logs)</option> : null}
                {dataLogs.map((log) => (
                  <option key={log.id} value={log.id}>
                    {log.name}
                  </option>
                ))}
              </select>
            ) : null}
            {cmdType === "apply-recipe" ? (
              <select aria-label="Recipe target" value={recipeTarget} onChange={(event) => setRecipeTarget(event.target.value)}>
                {recipes.length === 0 ? <option value="">(no recipes)</option> : null}
                {recipes.map((recipe) => (
                  <option key={recipe.id} value={recipe.id}>
                    {recipe.name}
                  </option>
                ))}
              </select>
            ) : null}
            {cmdType === "login-user" ? (
              <select aria-label="Login user target" value={loginUser} onChange={(event) => setLoginUser(event.target.value)}>
                {users.length === 0 ? <option value="">(no users)</option> : null}
                {users.map((user) => (
                  <option key={user.username} value={user.username}>
                    {user.fullName ? `${user.fullName} (${user.username})` : user.username}
                  </option>
                ))}
              </select>
            ) : null}
            <button
              type="button"
              className="esco-btn esco-btn--primary esco-btn--xs"
              disabled={cmdDisabled}
              onClick={submitCommand}
            >
              {cmdLabel}
            </button>
          </div>
        ) : (
          <p className="esco-empty">This element supports no press/release events that can host a command.</p>
        )}
      </section>

      {previewRows.length ? (
        <section>
          <h3>Runtime Preview</h3>
          <div className="esco-hmi-preview-actions" aria-label="Preview element events">
            {previewRows.map((row) => (
              <button
                key={row.eventType}
                type="button"
                className="esco-btn esco-btn--xs"
                aria-label={`Preview ${row.eventType} event`}
                disabled={row.commandCount === 0}
                onClick={() => onPreviewEvent(row.eventType)}
              >
                Preview {row.eventType}
                <span>{row.commandCount}</span>
              </button>
            ))}
          </div>
          <p className="esco-hmi-note esco-hmi-note--runtime">
            Executes authored commands in the offline HMI runtime session. Current screen: {runtimeSession.currentScreenName ?? "—"}.
          </p>
        </section>
      ) : null}

      <button type="button" className="esco-btn esco-btn--danger" onClick={onDelete}>
        Delete element
      </button>
    </>
  );
}

function surfaceDeletePrompt(surface: ActiveSurface, isHome: boolean): string {
  const label = surface.kind === "popup" ? "popup" : "screen";
  const homeWarning =
    surface.kind === "screen" && isHome
      ? " This is the configured home screen; deleting it will move Home to the next available screen or clear it if none remain."
      : "";
  const shortcutWarning = " Shortcuts that target this surface will be removed.";
  return `Delete HMI ${label} "${surface.name}"?${homeWarning}${shortcutWarning}`;
}

/** Editable inspector for the selected surface (no element selected). */
function SurfaceInspector({
  surface,
  isHome,
  roles,
  onRename,
  onSetHome,
  onSetSecurityRoles,
  onDelete,
}: {
  surface: ActiveSurface;
  isHome: boolean;
  roles: { id: string; name: string }[];
  onRename: (name: string) => void;
  onSetHome: () => void;
  onSetSecurityRoles: (roleIds: string[]) => void;
  onDelete: () => void;
}) {
  const editable = surface.kind === "screen" || surface.kind === "popup";
  const selectedRoles = new Set(surface.securityRoleIds);
  const toggleRole = (roleId: string, checked: boolean) => {
    const next = new Set(surface.securityRoleIds);
    if (checked) next.add(roleId);
    else next.delete(roleId);
    onSetSecurityRoles([...next]);
  };
  return (
    <>
      <h2>Surface</h2>
      {editable ? (
        <label className="esco-hmi-edit__row">
          <span>Name</span>
          <input
            aria-label="Surface name"
            defaultValue={surface.name}
            spellCheck={false}
            onBlur={(event) => {
              const next = event.target.value.trim();
              if (next && next !== surface.name) onRename(next);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
          />
        </label>
      ) : (
        <dl>
          <dt>Name</dt>
          <dd>{surface.name}</dd>
        </dl>
      )}
      <dl>
        <dt>Kind</dt>
        <dd>{surface.kind}</dd>
        <dt>Canvas</dt>
        <dd>
          {surface.width} x {surface.height}
        </dd>
        <dt>Update rate</dt>
        <dd>{surface.updateRateMs} ms</dd>
        <dt>Elements</dt>
        <dd>{surface.elements.length}</dd>
        <dt>Security</dt>
        <dd>{surface.securityRoleIds.length ? surface.securityRoleIds.length : "All roles"}</dd>
      </dl>
      <section className="esco-hmi-surface-security" aria-label="Surface security roles" data-testid="hmi-surface-security">
        <h3>Security</h3>
        {roles.length ? (
          <div className="esco-hmi-surface-security__roles">
            {roles.map((role) => (
              <label key={role.id} className="esco-hmi-surface-security__role">
                <input
                  type="checkbox"
                  aria-label={`Surface role ${role.name}`}
                  checked={selectedRoles.has(role.id)}
                  onChange={(event) => toggleRole(role.id, event.target.checked)}
                />
                <span>{role.name}</span>
              </label>
            ))}
          </div>
        ) : (
          <p className="esco-hmi-nav__empty">No security roles configured</p>
        )}
      </section>
      {surface.kind === "screen" ? (
        <button type="button" className="esco-btn" disabled={isHome} onClick={onSetHome}>
          {isHome ? "Home screen" : "Set as home"}
        </button>
      ) : null}
      {editable ? (
        <button
          type="button"
          className="esco-btn esco-btn--danger"
          aria-label={`Delete HMI ${surface.kind} ${surface.name}`}
          onClick={async () => {
            if (
              await requestConfirmation({
                title: "Delete HMI Surface",
                message: surfaceDeletePrompt(surface, isHome),
                confirmLabel: "Delete",
                tone: "danger",
              })
            ) {
              onDelete();
            }
          }}
        >
          Delete {surface.kind}
        </button>
      ) : null}
    </>
  );
}

const ALARM_SEVERITY_OPTIONS: HmiAlarmSeverity[] = ["info", "warning", "minor", "major", "critical"];
const ALARM_TRIGGER_OPTIONS: HmiAlarmTriggerKind[] = ["digital", "analog-high", "analog-low"];

interface AuthoringProps {
  hmi: HmiProject;
  knownTagPaths: string[];
  onCreateAlarm: (input: AlarmDraft) => void;
  onUpdateAlarm: (input: AlarmUpdateDraft) => void;
  onDeleteAlarm: (alarmId: string) => void;
  onCreateTrend: (input: TrendDraft) => void;
  onDeleteTrend: (trendId: string) => void;
  onAddTrendPen: (input: TrendPenDraft) => void;
  onRemoveTrendPen: (trendId: string, traceId: string) => void;
  onCreateDataLog: (input: DataLogDraft) => void;
  onDeleteDataLog: (dataLogId: string) => void;
  onCreateRecipe: (input: RecipeDraft) => void;
  onAddRecipeItem: (input: RecipeItemDraft) => void;
  onRemoveRecipeItem: (recipeId: string, itemId: string) => void;
  onDeleteRecipe: (recipeId: string) => void;
  onCreateLanguage: (input: LanguageDraft) => void;
  onDeleteLanguage: (languageId: string) => void;
  onSetLanguageString: (languageId: string, key: string, value: string) => void;
  onRemoveLanguageString: (languageId: string, key: string) => void;
  onSetDefaultLanguage: (languageId: string) => void;
  onExportLanguage: (languageId: string) => void;
  onImportLanguage: (text: string, sourceFileName?: string) => void;
  onCreateRole: (input: RoleDraft) => void;
  onDeleteRole: (roleId: string) => void;
  onCreateUser: (input: UserDraft) => void;
  onDeleteUser: (userId: string) => void;
}

/** Alarms / trends / languages authoring, wired to the real project-action layer. */
function HmiProjectAuthoring({
  hmi,
  knownTagPaths,
  onCreateAlarm,
  onUpdateAlarm,
  onDeleteAlarm,
  onCreateTrend,
  onDeleteTrend,
  onAddTrendPen,
  onRemoveTrendPen,
  onCreateDataLog,
  onDeleteDataLog,
  onCreateRecipe,
  onAddRecipeItem,
  onRemoveRecipeItem,
  onDeleteRecipe,
  onCreateLanguage,
  onDeleteLanguage,
  onSetLanguageString,
  onRemoveLanguageString,
  onSetDefaultLanguage,
  onExportLanguage,
  onImportLanguage,
  onCreateRole,
  onDeleteRole,
  onCreateUser,
  onDeleteUser,
}: AuthoringProps) {
  // Alarm form state.
  const [alarmName, setAlarmName] = useState("");
  const [alarmTag, setAlarmTag] = useState("");
  const [alarmSeverity, setAlarmSeverity] = useState<HmiAlarmSeverity>("warning");
  const [alarmTrigger, setAlarmTrigger] = useState<HmiAlarmTriggerKind>("analog-high");
  const [alarmThreshold, setAlarmThreshold] = useState("90");

  // Trend form state.
  const [trendName, setTrendName] = useState("");
  const [activeTrendId, setActiveTrendId] = useState("");
  const [penLabel, setPenLabel] = useState("");
  const [penTag, setPenTag] = useState("");
  const [dataLogName, setDataLogName] = useState("");
  const [dataLogTags, setDataLogTags] = useState("");
  const [dataLogSampleRate, setDataLogSampleRate] = useState("1000");
  const [dataLogRetention, setDataLogRetention] = useState("24");
  const [recipeName, setRecipeName] = useState("");
  const [activeRecipeId, setActiveRecipeId] = useState("");
  const [recipeTag, setRecipeTag] = useState("");
  const [recipeValue, setRecipeValue] = useState("");
  const [recipeDataType, setRecipeDataType] = useState("REAL");

  // Language form state.
  const [langId, setLangId] = useState("");
  const [langName, setLangName] = useState("");
  const [editLangId, setEditLangId] = useState(hmi.defaultLanguage);
  const [stringKey, setStringKey] = useState("");
  const [stringValue, setStringValue] = useState("");

  // Security form state.
  const [roleName, setRoleName] = useState("");
  const [userName, setUserName] = useState("");
  const [userRoleId, setUserRoleId] = useState(hmi.security.roles[0]?.id ?? "");

  const trendForPen = hmi.trends.find((trend) => trend.id === (activeTrendId || hmi.trends[0]?.id));
  const activeRecipe = (hmi.recipes ?? []).find((recipe) => recipe.id === (activeRecipeId || hmi.recipes?.[0]?.id));
  const editPack = hmi.languagePacks.find((pack) => pack.languageId === editLangId) ?? hmi.languagePacks[0];
  const parsedDataLogTags = dataLogTags.split(/[,\n]+/).map((tagPath) => tagPath.trim()).filter(Boolean);

  const submitAlarm = () => {
    if (!alarmName.trim() || !alarmTag.trim()) return;
    onCreateAlarm({
      name: alarmName,
      tagPath: alarmTag,
      severity: alarmSeverity,
      triggerKind: alarmTrigger,
      ...(alarmTrigger !== "digital" ? { threshold: Number(alarmThreshold) } : {}),
    });
    setAlarmName("");
    setAlarmTag("");
  };

  return (
    <>
      <datalist id="hmi-authoring-tags">
        {knownTagPaths.map((path) => (
          <option key={path} value={path} />
        ))}
      </datalist>
      <section aria-label="HMI alarms">
        <h2>Alarms ({hmi.alarms.length})</h2>
        <ul className="esco-hmi-authoring__list">
          {hmi.alarms.map((alarm) => (
            <li key={alarm.id} className="esco-hmi-authoring__item">
              <div className="esco-hmi-authoring__main">
                <strong>{alarm.name}</strong>
                <span>
                  {alarm.severity} · {alarm.trigger.kind}
                  {alarm.trigger.kind !== "digital" ? ` ${alarm.trigger.threshold}` : ""} · {alarm.tagPath}
                </span>
              </div>
              <label className="esco-hmi-authoring__toggle">
                <input
                  type="checkbox"
                  aria-label={`Alarm ${alarm.name} enabled`}
                  checked={alarm.enabled !== false}
                  onChange={(event) => onUpdateAlarm({ alarmId: alarm.id, enabled: event.target.checked })}
                />
                On
              </label>
              <button
                type="button"
                className="esco-btn esco-btn--danger esco-btn--xs"
                aria-label={`Delete alarm ${alarm.name}`}
                onClick={() => onDeleteAlarm(alarm.id)}
              >
                Delete
              </button>
            </li>
          ))}
          {hmi.alarms.length === 0 ? <li className="esco-hmi-nav__empty">No alarms</li> : null}
        </ul>
        <div className="esco-hmi-authoring__form" aria-label="Add alarm">
          <input aria-label="New alarm name" placeholder="Alarm name" value={alarmName} onChange={(e) => setAlarmName(e.target.value)} />
          <input aria-label="New alarm tag" placeholder="Tag path" list="hmi-authoring-tags" value={alarmTag} onChange={(e) => setAlarmTag(e.target.value)} />
          <select aria-label="New alarm severity" value={alarmSeverity} onChange={(e) => setAlarmSeverity(e.target.value as HmiAlarmSeverity)}>
            {ALARM_SEVERITY_OPTIONS.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <select aria-label="New alarm trigger" value={alarmTrigger} onChange={(e) => setAlarmTrigger(e.target.value as HmiAlarmTriggerKind)}>
            {ALARM_TRIGGER_OPTIONS.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          {alarmTrigger !== "digital" ? (
            <input aria-label="New alarm threshold" type="number" placeholder="Threshold" value={alarmThreshold} onChange={(e) => setAlarmThreshold(e.target.value)} />
          ) : null}
          <button type="button" className="esco-btn esco-btn--primary esco-btn--xs" disabled={!alarmName.trim() || !alarmTag.trim()} onClick={submitAlarm}>
            Add Alarm
          </button>
        </div>
        {hmi.alarms.length ? (
          <div className="esco-hmi-authoring__preview" aria-label="Alarm table offline preview">
            <h3>Alarm Table Preview</h3>
            <ul>
              {hmi.alarms.slice(0, 6).map((alarm) => (
                <li key={alarm.id} className={`is-${alarm.severity}`}>
                  <strong>{alarm.name}</strong>
                  <span>{alarm.severity} · {alarmPreviewState(alarm)}</span>
                  <em>{alarmTriggerSummary(alarm)} · {alarm.tagPath}</em>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <section aria-label="HMI trends">
        <h2>Trends ({hmi.trends.length})</h2>
        <ul className="esco-hmi-authoring__list">
          {hmi.trends.map((trend) => (
            <li key={trend.id} className="esco-hmi-authoring__item">
              <div className="esco-hmi-authoring__main">
                <strong>{trend.name}</strong>
                <span>{trend.sampleRateMs}ms · {trend.traces.length} pen{trend.traces.length === 1 ? "" : "s"}</span>
              </div>
              <button
                type="button"
                className="esco-btn esco-btn--xs"
                aria-label={`Edit pens ${trend.name}`}
                onClick={() => setActiveTrendId(trend.id)}
              >
                Pens
              </button>
              <button
                type="button"
                className="esco-btn esco-btn--danger esco-btn--xs"
                aria-label={`Delete trend ${trend.name}`}
                onClick={() => onDeleteTrend(trend.id)}
              >
                Delete
              </button>
            </li>
          ))}
          {hmi.trends.length === 0 ? <li className="esco-hmi-nav__empty">No trends</li> : null}
        </ul>
        <div className="esco-hmi-authoring__form" aria-label="Add trend">
          <input aria-label="New trend name" placeholder="Trend name" value={trendName} onChange={(e) => setTrendName(e.target.value)} />
          <button
            type="button"
            className="esco-btn esco-btn--primary esco-btn--xs"
            disabled={!trendName.trim()}
            onClick={() => {
              onCreateTrend({ name: trendName });
              setTrendName("");
            }}
          >
            Add Trend
          </button>
        </div>
        {trendForPen ? (
          <div className="esco-hmi-authoring__pens" aria-label={`Pens for ${trendForPen.name}`}>
            <h3>Pens — {trendForPen.name}</h3>
            <ul className="esco-hmi-authoring__list">
              {trendForPen.traces.map((trace) => (
                <li key={trace.id} className="esco-hmi-authoring__item">
                  <span className="esco-hmi-authoring__swatch" style={{ background: trace.color }} aria-hidden="true" />
                  <div className="esco-hmi-authoring__main">
                    <strong>{trace.label}</strong>
                    <span>{trace.source.path}</span>
                  </div>
                  <button
                    type="button"
                    className="esco-btn esco-btn--danger esco-btn--xs"
                    aria-label={`Remove pen ${trace.label}`}
                    onClick={() => onRemoveTrendPen(trendForPen.id, trace.id)}
                  >
                    Remove
                  </button>
                </li>
              ))}
              {trendForPen.traces.length === 0 ? <li className="esco-hmi-nav__empty">No pens</li> : null}
            </ul>
            <div className="esco-hmi-authoring__form" aria-label="Add trend pen">
              <input aria-label="New pen label" placeholder="Pen label" value={penLabel} onChange={(e) => setPenLabel(e.target.value)} />
              <input aria-label="New pen tag" placeholder="Tag path" list="hmi-authoring-tags" value={penTag} onChange={(e) => setPenTag(e.target.value)} />
              <button
                type="button"
                className="esco-btn esco-btn--primary esco-btn--xs"
                disabled={!penLabel.trim() || !penTag.trim()}
                onClick={() => {
                  onAddTrendPen({ trendId: trendForPen.id, label: penLabel, tagPath: penTag });
                  setPenLabel("");
                  setPenTag("");
                }}
              >
                Add Pen
              </button>
            </div>
          </div>
        ) : null}
        {hmi.trends.length ? (
          <div className="esco-hmi-authoring__preview" aria-label="Trend offline preview">
            <h3>Trend Preview</h3>
            <ul>
              {hmi.trends.slice(0, 6).map((trend) => (
                <li key={trend.id}>
                  <strong>{trend.name}</strong>
                  <span>{trendPreviewSummary(trend)}</span>
                  <em>
                    {trend.traces.length
                      ? trend.traces.map((trace) => `${trace.label}:${trace.source.path}`).join(" · ")
                      : "no pens"}
                  </em>
                  {trend.traces.length ? (
                    <i className="esco-hmi-authoring__spark" aria-hidden="true">
                      {trend.traces.slice(0, 5).map((trace) => (
                        <b key={trace.id} style={{ background: trace.color }} />
                      ))}
                    </i>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <section aria-label="HMI data logs">
        <h2>Data Logs ({hmi.dataLogs.length})</h2>
        <ul className="esco-hmi-authoring__list">
          {hmi.dataLogs.map((log) => (
            <li key={log.id} className="esco-hmi-authoring__item">
              <div className="esco-hmi-authoring__main">
                <strong>{log.name}</strong>
                <span>
                  {log.sampleRateMs}ms · {log.retentionHours}h · {log.tagPaths.length} tag{log.tagPaths.length === 1 ? "" : "s"}
                </span>
              </div>
              <button
                type="button"
                className="esco-btn esco-btn--danger esco-btn--xs"
                aria-label={`Delete data log ${log.name}`}
                onClick={() => onDeleteDataLog(log.id)}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
        <div className="esco-hmi-authoring__form" aria-label="Add data log">
          <input aria-label="New data log name" placeholder="Data log name" value={dataLogName} onChange={(e) => setDataLogName(e.target.value)} />
          <input
            aria-label="New data log tags"
            placeholder="Tag paths, comma separated"
            list="hmi-authoring-tags"
            value={dataLogTags}
            onChange={(e) => setDataLogTags(e.target.value)}
          />
          <input
            aria-label="New data log sample rate"
            type="number"
            min="1"
            value={dataLogSampleRate}
            onChange={(e) => setDataLogSampleRate(e.target.value)}
          />
          <input
            aria-label="New data log retention"
            type="number"
            min="1"
            value={dataLogRetention}
            onChange={(e) => setDataLogRetention(e.target.value)}
          />
          <button
            type="button"
            className="esco-btn esco-btn--primary esco-btn--xs"
            disabled={!dataLogName.trim() || parsedDataLogTags.length === 0}
            onClick={() => {
              onCreateDataLog({
                name: dataLogName,
                tagPaths: parsedDataLogTags,
                sampleRateMs: Number(dataLogSampleRate),
                retentionHours: Number(dataLogRetention),
              });
              setDataLogName("");
              setDataLogTags("");
            }}
          >
            Add Data Log
          </button>
        </div>
        <div className="esco-hmi-authoring__preview" aria-label="Data log offline preview">
          <h3>Data Log Preview</h3>
          {hmi.dataLogs.length ? (
            <ul>
              {hmi.dataLogs.slice(0, 6).map((log) => (
                <li key={log.id}>
                  <strong>{log.name}</strong>
                  <span>{dataLogPreviewSummary(log)}</span>
                  <em>{log.tagPaths.join(" · ") || "no tags configured"}</em>
                </li>
              ))}
            </ul>
          ) : (
            <p className="esco-hmi-nav__empty">No data logs configured</p>
          )}
        </div>
      </section>

      <section aria-label="HMI recipes">
        <h2>Recipes ({(hmi.recipes ?? []).length})</h2>
        <ul className="esco-hmi-authoring__list">
          {(hmi.recipes ?? []).map((recipe) => (
            <li key={recipe.id} className="esco-hmi-authoring__item">
              <div className="esco-hmi-authoring__main">
                <strong>{recipe.name}</strong>
                <span>{recipePreviewSummary(recipe)}</span>
              </div>
              <button
                type="button"
                className="esco-btn esco-btn--xs"
                aria-label={`Edit recipe ${recipe.name}`}
                onClick={() => setActiveRecipeId(recipe.id)}
              >
                Values
              </button>
              <button
                type="button"
                className="esco-btn esco-btn--danger esco-btn--xs"
                aria-label={`Delete recipe ${recipe.name}`}
                onClick={() => onDeleteRecipe(recipe.id)}
              >
                Delete
              </button>
            </li>
          ))}
          {(hmi.recipes ?? []).length === 0 ? <li className="esco-hmi-nav__empty">No recipes</li> : null}
        </ul>
        <div className="esco-hmi-authoring__form" aria-label="Add recipe">
          <input aria-label="New recipe name" placeholder="Recipe name" value={recipeName} onChange={(e) => setRecipeName(e.target.value)} />
          <button
            type="button"
            className="esco-btn esco-btn--primary esco-btn--xs"
            disabled={!recipeName.trim()}
            onClick={() => {
              onCreateRecipe({ name: recipeName });
              setRecipeName("");
            }}
          >
            Add Recipe
          </button>
        </div>
        {activeRecipe ? (
          <div className="esco-hmi-authoring__pens" aria-label={`Values for ${activeRecipe.name}`}>
            <h3>Values — {activeRecipe.name}</h3>
            <ul className="esco-hmi-authoring__list">
              {activeRecipe.items.map((item) => (
                <li key={item.id} className="esco-hmi-authoring__item">
                  <div className="esco-hmi-authoring__main">
                    <strong>{item.tagPath}</strong>
                    <span>
                      {item.dataType ?? "auto"} = {String(item.value)}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="esco-btn esco-btn--danger esco-btn--xs"
                    aria-label={`Remove recipe value ${item.tagPath}`}
                    onClick={() => onRemoveRecipeItem(activeRecipe.id, item.id)}
                  >
                    Remove
                  </button>
                </li>
              ))}
              {activeRecipe.items.length === 0 ? <li className="esco-hmi-nav__empty">No recipe values</li> : null}
            </ul>
            <div className="esco-hmi-authoring__form" aria-label="Add recipe value">
              <input aria-label="New recipe tag" placeholder="Tag path" list="hmi-authoring-tags" value={recipeTag} onChange={(e) => setRecipeTag(e.target.value)} />
              <input aria-label="New recipe value" placeholder="Value" value={recipeValue} onChange={(e) => setRecipeValue(e.target.value)} />
              <select aria-label="New recipe data type" value={recipeDataType} onChange={(e) => setRecipeDataType(e.target.value)}>
                <option value="REAL">REAL</option>
                <option value="DINT">DINT</option>
                <option value="BOOL">BOOL</option>
                <option value="STRING">STRING</option>
              </select>
              <button
                type="button"
                className="esco-btn esco-btn--primary esco-btn--xs"
                disabled={!recipeTag.trim()}
                onClick={() => {
                  onAddRecipeItem({
                    recipeId: activeRecipe.id,
                    tagPath: recipeTag,
                    value: parseRecipeValue(recipeValue, recipeDataType),
                    dataType: recipeDataType,
                  });
                  setRecipeTag("");
                  setRecipeValue("");
                }}
              >
                Add Value
              </button>
            </div>
          </div>
        ) : null}
        <div className="esco-hmi-authoring__preview" aria-label="Recipe offline preview">
          <h3>Recipe Preview</h3>
          {(hmi.recipes ?? []).length ? (
            <ul>
              {(hmi.recipes ?? []).slice(0, 6).map((recipe) => (
                <li key={recipe.id}>
                  <strong>{recipe.name}</strong>
                  <span>{recipePreviewSummary(recipe)}</span>
                  <em>
                    {recipe.items.length
                      ? recipe.items.map((item) => `${item.tagPath}=${String(item.value)}`).join(" · ")
                      : "no values configured"}
                  </em>
                </li>
              ))}
            </ul>
          ) : (
            <p className="esco-hmi-nav__empty">No recipes configured</p>
          )}
        </div>
      </section>

      <section aria-label="HMI languages">
        <h2>Languages ({hmi.languagePacks.length})</h2>
        <ul className="esco-hmi-authoring__list">
          {hmi.languagePacks.map((pack) => (
            <li key={pack.id} className="esco-hmi-authoring__item">
              <div className="esco-hmi-authoring__main">
                <strong>{pack.displayName}</strong>
                <span>
                  {pack.languageId}
                  {pack.languageId === hmi.defaultLanguage ? " · default" : ""} · {Object.keys(pack.strings).length} strings
                </span>
              </div>
              {pack.languageId !== hmi.defaultLanguage ? (
                <button
                  type="button"
                  className="esco-btn esco-btn--xs"
                  aria-label={`Set ${pack.languageId} default`}
                  onClick={() => onSetDefaultLanguage(pack.languageId)}
                >
                  Default
                </button>
              ) : null}
              <button
                type="button"
                className="esco-btn esco-btn--xs"
                aria-label={`Export language ${pack.languageId}`}
                onClick={() => onExportLanguage(pack.languageId)}
              >
                CSV
              </button>
              <button
                type="button"
                className="esco-btn esco-btn--danger esco-btn--xs"
                aria-label={`Delete language ${pack.languageId}`}
                disabled={hmi.languagePacks.length <= 1}
                onClick={() => onDeleteLanguage(pack.languageId)}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
        <div className="esco-hmi-authoring__form" aria-label="Add language">
          <input aria-label="New language id" placeholder="e.g. de-DE" value={langId} onChange={(e) => setLangId(e.target.value)} />
          <input aria-label="New language name" placeholder="Display name" value={langName} onChange={(e) => setLangName(e.target.value)} />
          <button
            type="button"
            className="esco-btn esco-btn--primary esco-btn--xs"
            disabled={!langId.trim()}
            onClick={() => {
              onCreateLanguage({ languageId: langId, displayName: langName.trim() || undefined });
              setLangId("");
              setLangName("");
            }}
          >
            Add Language
          </button>
          <label className="esco-hmi-authoring__import">
            Import CSV
            <input
              type="file"
              accept=".csv"
              aria-label="Import language CSV"
              onChange={async (event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                const text = await file.text();
                onImportLanguage(text, file.name);
                event.target.value = "";
              }}
            />
          </label>
        </div>
        {editPack ? (
          <div className="esco-hmi-authoring__strings" aria-label="Localized strings">
            <h3>Strings</h3>
            <select aria-label="Language to edit" value={editPack.languageId} onChange={(e) => setEditLangId(e.target.value)}>
              {hmi.languagePacks.map((pack) => (
                <option key={pack.id} value={pack.languageId}>{pack.displayName}</option>
              ))}
            </select>
            <ul className="esco-hmi-authoring__list">
              {Object.entries(editPack.strings).map(([key, value]) => (
                <li key={key} className="esco-hmi-authoring__item">
                  <div className="esco-hmi-authoring__main">
                    <strong>{key}</strong>
                    <span>{value}</span>
                  </div>
                  <button
                    type="button"
                    className="esco-btn esco-btn--danger esco-btn--xs"
                    aria-label={`Remove string ${key}`}
                    onClick={() => onRemoveLanguageString(editPack.languageId, key)}
                  >
                    Remove
                  </button>
                </li>
              ))}
              {Object.keys(editPack.strings).length === 0 ? <li className="esco-hmi-nav__empty">No strings</li> : null}
            </ul>
            <div className="esco-hmi-authoring__form" aria-label="Add localized string">
              <input aria-label="Localized string key" placeholder="Key" value={stringKey} onChange={(e) => setStringKey(e.target.value)} />
              <input aria-label="Localized string value" placeholder="Value" value={stringValue} onChange={(e) => setStringValue(e.target.value)} />
              <button
                type="button"
                className="esco-btn esco-btn--primary esco-btn--xs"
                disabled={!stringKey.trim()}
                onClick={() => {
                  onSetLanguageString(editPack.languageId, stringKey.trim(), stringValue);
                  setStringKey("");
                  setStringValue("");
                }}
              >
                Save String
              </button>
            </div>
          </div>
        ) : null}
      </section>

      <section aria-label="HMI security">
        <h2>Security ({hmi.security.roles.length} roles · {hmi.security.users.length} users)</h2>
        <ul className="esco-hmi-authoring__list">
          {hmi.security.roles.map((role) => (
            <li key={role.id} className="esco-hmi-authoring__item">
              <div className="esco-hmi-authoring__main">
                <strong>{role.name}</strong>
                <span>
                  {role.id === hmi.security.guestRoleId ? "guest · " : ""}
                  {role.permissions.length} permission{role.permissions.length === 1 ? "" : "s"}
                </span>
              </div>
              <button
                type="button"
                className="esco-btn esco-btn--danger esco-btn--xs"
                aria-label={`Delete role ${role.name}`}
                onClick={() => onDeleteRole(role.id)}
              >
                Delete
              </button>
            </li>
          ))}
          {hmi.security.roles.length === 0 ? <li className="esco-hmi-nav__empty">No roles</li> : null}
        </ul>
        <div className="esco-hmi-authoring__form" aria-label="Add role">
          <input aria-label="New role name" placeholder="Role name" value={roleName} onChange={(e) => setRoleName(e.target.value)} />
          <button
            type="button"
            className="esco-btn esco-btn--primary esco-btn--xs"
            disabled={!roleName.trim()}
            onClick={() => {
              onCreateRole({ name: roleName });
              setRoleName("");
            }}
          >
            Add Role
          </button>
        </div>
        <ul className="esco-hmi-authoring__list">
          {hmi.security.users.map((user) => (
            <li key={user.id} className="esco-hmi-authoring__item">
              <div className="esco-hmi-authoring__main">
                <strong>{user.username}</strong>
                <span>{user.roleIds.map((id) => hmi.security.roles.find((r) => r.id === id)?.name ?? id).join(", ")}</span>
              </div>
              <button
                type="button"
                className="esco-btn esco-btn--danger esco-btn--xs"
                aria-label={`Delete user ${user.username}`}
                onClick={() => onDeleteUser(user.id)}
              >
                Delete
              </button>
            </li>
          ))}
          {hmi.security.users.length === 0 ? <li className="esco-hmi-nav__empty">No users</li> : null}
        </ul>
        <div className="esco-hmi-authoring__form" aria-label="Add user">
          <input aria-label="New user name" placeholder="Username" value={userName} onChange={(e) => setUserName(e.target.value)} />
          <select aria-label="New user role" value={userRoleId} onChange={(e) => setUserRoleId(e.target.value)}>
            {hmi.security.roles.map((role) => (
              <option key={role.id} value={role.id}>{role.name}</option>
            ))}
          </select>
          <button
            type="button"
            className="esco-btn esco-btn--primary esco-btn--xs"
            disabled={!userName.trim() || !userRoleId}
            onClick={() => {
              onCreateUser({ username: userName, roleIds: [userRoleId] });
              setUserName("");
            }}
          >
            Add User
          </button>
        </div>
      </section>
    </>
  );
}

export function HmiDesigner({
  hmi,
  knownTagPaths,
  selectedSurface,
  onEnableProject,
  onCreateScreen,
  onCreatePopup,
  onAddElement,
  onSelectSurface,
  onUpdateElement,
  onUpdateElementGeometry,
  onDeleteElement,
  onSetBinding,
  onRemoveBinding,
  onAddEventCommand,
  onRemoveEventCommand,
  onSetHomeScreen,
  onRenameSurface,
  onSetSurfaceSecurityRoles,
  onDeleteSurface,
  onBuildRuntimePackage,
  createRuntimeTagProvider,
  onCreateAlarm,
  onUpdateAlarm,
  onDeleteAlarm,
  onCreateTrend,
  onDeleteTrend,
  onAddTrendPen,
  onRemoveTrendPen,
  onCreateDataLog,
  onDeleteDataLog,
  onCreateRecipe,
  onAddRecipeItem,
  onRemoveRecipeItem,
  onDeleteRecipe,
  onCreateLanguage,
  onDeleteLanguage,
  onSetLanguageString,
  onRemoveLanguageString,
  onSetDefaultLanguage,
  onExportLanguage,
  onImportLanguage,
  onCreateRole,
  onDeleteRole,
  onCreateUser,
  onDeleteUser,
}: Props) {
  const [screenName, setScreenName] = useState("Overview");
  const [popupName, setPopupName] = useState("Popup");
  const [selectedElementId, setSelectedElementId] = useState<string | undefined>();
  const [previewActive, setPreviewActive] = useState(false);
  const [popoutActive, setPopoutActive] = useState(false);
  // Bumping this key remounts the live preview, resetting the runtime provider.
  const [previewKey, setPreviewKey] = useState(0);
  const [propsSection, setPropsSection] = useState<"bind" | "events" | "sec">("bind");
  const hmiRootRef = useRef<HTMLDivElement | null>(null);
  const [runtimeSession, setRuntimeSession] = useState<HmiRuntimeSession | undefined>(
    () => (hmi ? createHmiRuntimeSession(hmi) : undefined),
  );
  const runtimeActiveRoleKey = runtimeSession?.activeRoleIds.join("|") ?? "";
  const groups = useMemo(() => hmiElementDefinitionsByCategory(), []);
  const controllerReferences = hmi?.controllerReferences ?? [];
  const controllerRows = useMemo(() => (hmi ? hmiControllerReferenceBrowserRows(hmi) : []), [hmi]);
  const controllerSummary = useMemo(() => (hmi ? hmiControllerReferenceSyncSummary(hmi) : undefined), [hmi]);
  const capacityReport = useMemo(() => (hmi ? hmiUsageCapacityReport(hmi) : undefined), [hmi]);
  const visualQaReport = useMemo(() => (hmi ? hmiVisualQaReport(hmi) : undefined), [hmi]);
  const navigationModel = useMemo(
    () => (hmi ? hmiNavigationModel(hmi, { includeHidden: true, activeRoleIds: runtimeSession?.activeRoleIds }) : undefined),
    [hmi, runtimeActiveRoleKey],
  );
  const allKnownTagPaths = useMemo(
    () => [...new Set([...knownTagPaths, ...controllerRows.filter((row) => row.kind === "tag").map((row) => row.path)])],
    [knownTagPaths, controllerRows],
  );
  const findings = useMemo(() => validateHmiProject(hmi, { knownTagPaths: allKnownTagPaths }), [hmi, allKnownTagPaths]);
  const surface = hmi ? surfaceFromSelection(hmi, selectedSurface) : undefined;
  const selectedElement = surface?.elements.find((element) => element.id === selectedElementId);
  const screens = hmi?.screens.map((screen) => ({ id: screen.id, name: screen.name })) ?? [];
  const popups = hmi?.popups.map((popup) => ({ id: popup.id, name: popup.name })) ?? [];

  useEffect(() => {
    if (!hmi) {
      setRuntimeSession(undefined);
      return;
    }
    setRuntimeSession((current) => {
      if (!current || current.projectId !== hmi.id) return createHmiRuntimeSession(hmi);
      if (!current.currentScreenId && hmi.screens.length > 0) return createHmiRuntimeSession(hmi);
      const currentScreen = hmi.screens.find((screen) => screen.id === current.currentScreenId);
      if (current.currentScreenId && !currentScreen) return createHmiRuntimeSession(hmi);
      if (currentScreen && currentScreen.name !== current.currentScreenName) {
        return {
          ...current,
          currentScreenName: currentScreen.name,
          systemTags: { ...current.systemTags, "System.CurrentScreen": currentScreen.name },
        };
      }
      return current;
    });
  }, [hmi, hmi?.id, hmi?.screens.length]);

  useEffect(() => {
    setSelectedElementId(undefined);
  }, [surface?.id]);

  // Drop the element selection if the element was just deleted.
  useEffect(() => {
    if (selectedElementId && !selectedElement) setSelectedElementId(undefined);
  }, [selectedElementId, selectedElement]);

  useEffect(() => {
    if (!popoutActive) return;
    const previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPopoutActive(false);
    };
    const syncFullscreenState = () => {
      if (!document.fullscreenElement) setPopoutActive(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    document.addEventListener("fullscreenchange", syncFullscreenState);
    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("fullscreenchange", syncFullscreenState);
    };
  }, [popoutActive]);

  if (!hmi) {
    return (
      <div className="esco-hmi esco-hmi--empty">
        <div className="esco-hmi-empty-card">
          <span className="esco-hmi-empty-card__icon">HMI</span>
          <h1>HMI Designer</h1>
          <p>
            Add a real HMI project model to this ESCO project. Screens, popups, banners, bindings,
            events, alarms, trends, data logs, security, and language packs will persist in project data.
          </p>
          <button type="button" className="esco-btn esco-btn--primary" onClick={onEnableProject}>
            Enable HMI Project
          </button>
        </div>
      </div>
    );
  }

  const addToSurface = (typeId: string) => {
    if (!surface) return;
    onAddElement(surface.kind, surface.id, typeId);
  };
  const previewElementEvent = (eventType: "press" | "release") => {
    if (!hmi || !selectedElement) return;
    const handler = selectedElement.events.find((event) => event.eventType === eventType);
    if (!handler?.commands.length) return;
    const current = runtimeSession ?? createHmiRuntimeSession(hmi);
    setRuntimeSession(executeHmiRuntimeCommands(hmi, current, handler.commands));
  };
  const setRuntimePreviewRole = (roleId: string) => {
    if (!hmi) return;
    const role = hmi.security.roles.find((candidate) => candidate.id === roleId);
    const current = runtimeSession ?? createHmiRuntimeSession(hmi);
    setRuntimeSession(
      setHmiRuntimeSessionRoles(hmi, current, role ? [role.id] : [], {
        currentUserName: role?.name ?? "",
        currentUserFullName: "",
        securityAuthority: role ? "manual-preview" : "none",
      }),
    );
  };
  const startRuntimePreview = () => {
    if (hmi.screens.length === 0) return;
    setPreviewKey((key) => key + 1);
    setPreviewActive(true);
  };
  const stopRuntimePreview = () => setPreviewActive(false);
  const togglePopout = () => {
    if (popoutActive) {
      setPopoutActive(false);
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
      return;
    }
    setPopoutActive(true);
    if (hmiRootRef.current?.requestFullscreen) {
      void hmiRootRef.current.requestFullscreen().catch(() => undefined);
    }
  };
  const problemCount = findings.filter((finding) => finding.severity === "error" || finding.severity === "warning").length;
  const errorCount = findings.filter((finding) => finding.severity === "error").length;
  const warningCount = findings.filter((finding) => finding.severity === "warning").length;
  const infoCount = findings.filter((finding) => finding.severity === "info").length;
  const visualRuntimePreviewCount = visualQaReport?.surfaces.reduce((sum, row) => sum + row.runtimePreviewElementCount, 0) ?? 0;
  const visualModelOnlyCount = visualQaReport?.surfaces.reduce((sum, row) => sum + row.modelOnlyElementCount, 0) ?? 0;

  return (
    <div
      ref={hmiRootRef}
      className={popoutActive ? "esco-hmi esco-hmi--popout" : "esco-hmi"}
      data-testid="hmi-designer"
    >
      <header className="esco-hmi__header">
        <div className="esco-hmi__title">
          <p className="esco-kicker">EAS HMI Designer</p>
          <h1>EAS HMI Designer</h1>
          <span data-testid="hmi-project-name">Project {displayRuntimeName(hmi.name, "Untitled HMI")}</span>
          <em title={hmi.name}>Model {hmi.name}</em>
        </div>
        <div className="esco-hmi__device">
          <span>{hmi.targetDevice.name}</span>
          <strong>
            {hmi.targetDevice.width} x {hmi.targetDevice.height}
          </strong>
          <em>Offline runtime preview</em>
          <em>
            {controllerSummary?.total
              ? `${controllerSummary.synchronized}/${controllerSummary.total} controller refs synced`
              : "No controller reference"}
          </em>
          <em className={capacityReport?.exceededCount ? "is-warn" : undefined}>
            {capacityReport?.exceededCount
              ? `${capacityReport.exceededCount} capacity limit${capacityReport.exceededCount === 1 ? "" : "s"}`
              : "Capacity OK"}
          </em>
          {previewActive ? (
            <button type="button" className="esco-btn esco-btn--xs" data-testid="hmi-stop-preview" onClick={stopRuntimePreview}>
              Stop Preview
            </button>
          ) : (
            <button
              type="button"
              className="esco-btn esco-btn--xs esco-btn--primary"
              data-testid="hmi-start-preview"
              disabled={hmi.screens.length === 0}
              onClick={startRuntimePreview}
            >
              Preview
            </button>
          )}
          <button type="button" className="esco-btn esco-btn--xs" aria-label="Build Runtime Package" onClick={onBuildRuntimePackage}>
            Build Runtime
            <span className="esco-hmi__sr-only"> Package</span>
          </button>
          <button
            type="button"
            className="esco-btn esco-btn--xs esco-hmi__popout-toggle"
            data-testid="hmi-popout-toggle"
            aria-pressed={popoutActive}
            onClick={togglePopout}
          >
            {popoutActive ? "Dock HMI" : "Pop Out"}
          </button>
        </div>
      </header>

      <div className="esco-hmi__workspace" data-testid="hmi-designer-layout">
        <nav className="esco-hmi-rail" aria-label="HMI designer rail">
          <button type="button" className="is-active" title="Project tree">
            HMI
          </button>
          <button type="button" title="Objects">
            OBJ
          </button>
          <button type="button" title="Tags">
            TAG
          </button>
          <button type="button" title="Runtime">
            RUN
          </button>
        </nav>

        <aside className="esco-hmi-nav" data-testid="hmi-project-tree">
          <div className="esco-hmi-nav__title">
            <strong>HMI Project Tree</strong>
            <span>{hmi.screens.length} screens</span>
          </div>
          <section>
            <h2>Screens</h2>
            <div className="esco-hmi-create">
              <input value={screenName} onChange={(event) => setScreenName(event.target.value)} aria-label="New HMI screen name" />
              <button type="button" onClick={() => onCreateScreen(screenName)}>
                New
              </button>
            </div>
            <ul>
              {hmi.screens.map((screen) => (
                <li key={screen.id}>
                  <button
                    type="button"
                    className={surface?.id === screen.id ? "is-active" : undefined}
                    onClick={() => onSelectSurface({ kind: "screen", id: screen.id })}
                  >
                    <span>{screen.name}</span>
                    {hmi.homeScreenId === screen.id ? <em>Home</em> : null}
                  </button>
                </li>
              ))}
              {hmi.screens.length === 0 ? <li className="esco-hmi-nav__empty">No screens created</li> : null}
            </ul>
          </section>

          <section>
            <h2>Popups</h2>
            <div className="esco-hmi-create">
              <input value={popupName} onChange={(event) => setPopupName(event.target.value)} aria-label="New HMI popup name" />
              <button type="button" onClick={() => onCreatePopup(popupName)}>
                New
              </button>
            </div>
            <ul>
              {hmi.popups.map((popup) => (
                <li key={popup.id}>
                  <button
                    type="button"
                    className={surface?.id === popup.id ? "is-active" : undefined}
                    onClick={() => onSelectSurface({ kind: "popup", id: popup.id })}
                  >
                    <span>{popup.name}</span>
                    <em>
                      {popup.width}x{popup.height}
                    </em>
                  </button>
                </li>
              ))}
              {hmi.popups.length === 0 ? <li className="esco-hmi-nav__empty">No popups created</li> : null}
            </ul>
          </section>

          <section>
            <h2>Tags</h2>
            <ul>
              {allKnownTagPaths.slice(0, 8).map((path) => (
                <li key={path}>
                  <button type="button" disabled title={path}>
                    <span>{path}</span>
                    <em>tag</em>
                  </button>
                </li>
              ))}
              {allKnownTagPaths.length === 0 ? <li className="esco-hmi-nav__empty">No controller tags linked</li> : null}
            </ul>
          </section>

          <section>
            <h2>Shared</h2>
            <button
              type="button"
              className={surface?.id === hmi.systemBanner.id ? "esco-hmi-nav__banner is-active" : "esco-hmi-nav__banner"}
              onClick={() => onSelectSurface({ kind: "system-banner", id: hmi.systemBanner.id })}
            >
              <span>System Banner</span>
              <em>{hmi.systemBanner.height}px</em>
            </button>
          </section>

          <HmiProjectAuthoring
            hmi={hmi}
            knownTagPaths={allKnownTagPaths}
            onCreateAlarm={onCreateAlarm}
            onUpdateAlarm={onUpdateAlarm}
            onDeleteAlarm={onDeleteAlarm}
            onCreateTrend={onCreateTrend}
            onDeleteTrend={onDeleteTrend}
            onAddTrendPen={onAddTrendPen}
            onRemoveTrendPen={onRemoveTrendPen}
            onCreateDataLog={onCreateDataLog}
            onDeleteDataLog={onDeleteDataLog}
            onCreateRecipe={onCreateRecipe}
            onAddRecipeItem={onAddRecipeItem}
            onRemoveRecipeItem={onRemoveRecipeItem}
            onDeleteRecipe={onDeleteRecipe}
            onCreateLanguage={onCreateLanguage}
            onDeleteLanguage={onDeleteLanguage}
            onSetLanguageString={onSetLanguageString}
            onRemoveLanguageString={onRemoveLanguageString}
            onSetDefaultLanguage={onSetDefaultLanguage}
            onExportLanguage={onExportLanguage}
            onImportLanguage={onImportLanguage}
            onCreateRole={onCreateRole}
            onDeleteRole={onDeleteRole}
            onCreateUser={onCreateUser}
            onDeleteUser={onDeleteUser}
          />

          <section>
            <h2>Controllers</h2>
            <ul>
              {controllerReferences.map((reference) => (
                <li key={reference.id}>
                  <button type="button" disabled title={reference.statusMessage ?? reference.sourcePath ?? reference.controllerName}>
                    <span>{reference.name}</span>
                    <em>
                      {reference.syncStatus} · {reference.tags.length} tags
                    </em>
                  </button>
                </li>
              ))}
              {controllerReferences.length === 0 ? <li className="esco-hmi-nav__empty">No controller references</li> : null}
            </ul>
          </section>

          {navigationModel ? (
            <section>
              <h2>Navigation</h2>
              <ul>
                {navigationModel.items.slice(0, 6).map((item) => (
                  <li key={item.id}>
                    <button type="button" disabled title={item.hiddenReason ?? item.targetName ?? item.targetId}>
                      <span>{item.label}</span>
                      <em>{item.visible ? item.commandType : item.hiddenReason}</em>
                    </button>
                  </li>
                ))}
              </ul>
              <p className="esco-hmi-nav__empty">
                {navigationModel.items.filter((item) => item.visible).length} visible · {navigationModel.omittedScreenIds.length} omitted · {navigationModel.deadEndScreenIds.length} dead-end
                {navigationModel.missingTargetCount > 0 ? ` · ${navigationModel.missingTargetCount} missing target` : ""}
                {navigationModel.hiddenBySecurityCount > 0 ? ` · ${navigationModel.hiddenBySecurityCount} security-hidden` : ""}
              </p>
            </section>
          ) : null}

          {runtimeSession ? (
            <RuntimePreviewPanel project={hmi} session={runtimeSession} onRoleChange={setRuntimePreviewRole} />
          ) : null}

          {capacityReport ? (
            <section>
              <h2>Usage</h2>
              <ul className="esco-hmi-capacity">
                {capacityReport.metrics.map((metric) => (
                  <li key={metric.key} className={`is-${metric.status}`} title={metric.message}>
                    <div>
                      <span>{metric.label}</span>
                      <em>{formatMetric(metric)}</em>
                    </div>
                    <i>
                      <b style={{ width: metricPercent(metric) }} />
                    </i>
                  </li>
                ))}
              </ul>
              {capacityReport.scalingRiskCount ? (
                <p className="esco-hmi-nav__empty">{capacityReport.scalingRiskCount} scaled raster image risk</p>
              ) : null}
            </section>
          ) : null}

          {visualQaReport ? (
            <section aria-label="HMI visual QA">
              <h2>Visual QA</h2>
              <ul className="esco-hmi-visual-qa">
                <li className={visualQaReport.complexSurfaceCount ? "is-ok" : "is-muted"}>
                  <span>Complex surfaces</span>
                  <em>{visualQaReport.complexSurfaceCount}</em>
                </li>
                <li className={visualQaReport.warningCount ? "is-warning" : "is-ok"}>
                  <span>Warnings</span>
                  <em>{visualQaReport.warningCount}</em>
                </li>
                <li className={visualQaReport.errorCount ? "is-error" : "is-ok"}>
                  <span>Errors</span>
                  <em>{visualQaReport.errorCount}</em>
                </li>
                <li>
                  <span>Runtime-ready</span>
                  <em>{visualRuntimePreviewCount}</em>
                </li>
                <li>
                  <span>Model-only</span>
                  <em>{visualModelOnlyCount}</em>
                </li>
                <li>
                  <span>Coverage</span>
                  <em>
                    {visualQaReport.coverage.processObjects}/{visualQaReport.coverage.alarmObjects}/{visualQaReport.coverage.trendObjects}
                  </em>
                </li>
              </ul>
              <ul className="esco-hmi-visual-qa__surfaces">
                {visualQaReport.surfaces
                  .filter((row) => row.elementCount > 0 || row.issueCount > 0)
                  .slice(0, 4)
                  .map((row) => (
                    <li key={row.id} className={row.issueCount ? "is-warning" : "is-ok"}>
                      <div>
                        <strong>{row.name}</strong>
                        <span>
                          {row.complexity} · {row.elementCount} objects · {row.issueCount} issues
                        </span>
                      </div>
                      <em>{row.scaling}</em>
                    </li>
                  ))}
              </ul>
              <p className="esco-hmi-nav__empty">
                {visualQaReport.coverage.hmiButtonControls} HMIBC · {visualQaReport.coverage.dataLogDefinitions} data logs · {visualQaReport.coverage.recipeDefinitions} recipes · {visualQaReport.coverage.securedSurfaces} secured surfaces
              </p>
            </section>
          ) : null}
        </aside>

        <main className="esco-hmi-main" data-testid="hmi-screen-canvas">
          <div className="esco-hmi-toolbox">
            {Object.entries(groups).map(([category, definitions]) => (
              <ToolboxGroup
                key={category}
                label={CATEGORY_LABELS[category] ?? category}
                definitions={definitions}
                disabled={!surface}
                onAdd={addToSurface}
              />
            ))}
          </div>

          <section className="esco-hmi-canvas">
            <div className="esco-hmi-canvas__toolbar">
              <strong>{previewActive ? "Operator Runtime Preview" : "Screen Designer Canvas"}</strong>
              <span>{surface?.name ?? "No surface selected"}</span>
              <span>{surface ? `${surface.width} x ${surface.height}` : "Create a screen to begin"}</span>
              <span className="esco-hmi-canvas__spacer" />
              {previewActive ? (
                <>
                  <button
                    type="button"
                    className="esco-btn esco-btn--xs"
                    data-testid="hmi-reset-preview"
                    onClick={() => setPreviewKey((key) => key + 1)}
                  >
                    Reset Simulator
                  </button>
                  <button
                    type="button"
                    className="esco-btn esco-btn--xs esco-btn--primary"
                    onClick={stopRuntimePreview}
                  >
                    Stop Preview
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="esco-btn esco-btn--xs esco-btn--primary"
                  disabled={hmi.screens.length === 0}
                  onClick={startRuntimePreview}
                >
                  Preview
                </button>
              )}
              {!previewActive ? (
                <em>No controller or device connection active</em>
              ) : createRuntimeTagProvider ? (
                <em>Live ESCO SoftController preview</em>
              ) : (
                <em>Live offline preview</em>
              )}
            </div>
            {previewActive && hmi.screens.length > 0 ? (
              <LiveRuntimePreview key={previewKey} project={hmi} createRuntimeTagProvider={createRuntimeTagProvider} />
            ) : surface ? (
              <div
                className="esco-hmi-canvas__surface"
                style={{ aspectRatio: `${surface.width} / ${surface.height}`, background: surface.background }}
              >
                <div className="esco-hmi-canvas__grid" aria-hidden="true" />
                {surface.elements.map((element) => (
                  <ElementOnCanvas
                    key={element.id}
                    element={element}
                    surface={surface}
                    selected={element.id === selectedElementId}
                    onSelect={() => setSelectedElementId(element.id)}
                  />
                ))}
                {surface.elements.length === 0 ? (
                  <div className="esco-hmi-canvas__empty">
                    <strong>Empty {surface.kind}</strong>
                    <span>Add an element from the toolbox above.</span>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="esco-hmi-canvas__placeholder">Create a screen to open the HMI canvas.</div>
            )}
          </section>
        </main>

        <aside className="esco-hmi-properties" data-testid="hmi-props-panel">
          <div className="esco-hmi-properties__header">
            <strong>Props</strong>
            <div className="esco-hmi-properties__tabs" role="tablist" aria-label="HMI property sections">
              {[
                ["bind", "Bind"],
                ["events", "Events"],
                ["sec", "Sec."],
              ].map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={propsSection === key}
                  className={propsSection === key ? "is-active" : undefined}
                  onClick={() => setPropsSection(key as "bind" | "events" | "sec")}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="esco-hmi-properties__body">
            {!surface ? (
              <p className="esco-empty">Create a screen or select the system banner.</p>
            ) : selectedElement ? (
              <ElementInspector
                key={selectedElement.id}
                element={selectedElement}
                screens={screens}
                popups={popups}
                trends={hmi.trends.map((trend) => ({ id: trend.id, name: trend.name }))}
                dataLogs={hmi.dataLogs.map((log) => ({ id: log.id, name: log.name }))}
                recipes={(hmi.recipes ?? []).map((recipe) => ({ id: recipe.id, name: recipe.name }))}
                languages={hmi.languagePacks.map((language) => ({ languageId: language.languageId, displayName: language.displayName }))}
                users={hmi.security.users.map((user) => ({ username: user.username, fullName: user.fullName }))}
                runtimeSession={runtimeSession ?? createHmiRuntimeSession(hmi)}
                knownTagPaths={allKnownTagPaths}
                onUpdate={(patch) => onUpdateElement(surface.kind, surface.id, selectedElement.id, patch)}
                onUpdateGeometry={(geometry) => onUpdateElementGeometry(surface.kind, surface.id, selectedElement.id, geometry)}
                onDelete={() => onDeleteElement(surface.kind, surface.id, selectedElement.id)}
                onSetBinding={(binding) => onSetBinding(surface.kind, surface.id, selectedElement.id, binding)}
                onRemoveBinding={(bindingId) => onRemoveBinding(surface.kind, surface.id, selectedElement.id, bindingId)}
                onAddCommand={(eventType, command) =>
                  onAddEventCommand(surface.kind, surface.id, selectedElement.id, eventType, command)
                }
                onRemoveEventCommand={(eventId, commandId) =>
                  onRemoveEventCommand(surface.kind, surface.id, selectedElement.id, eventId, commandId)
                }
                onPreviewEvent={previewElementEvent}
              />
            ) : (
              <SurfaceInspector
                key={surface.id}
                surface={surface}
                isHome={surface.kind === "screen" && hmi.homeScreenId === surface.id}
                roles={hmi.security.roles}
                onRename={(name) =>
                  surface.kind === "screen" || surface.kind === "popup"
                    ? onRenameSurface(surface.kind, surface.id, name)
                    : undefined
                }
                onSetHome={() => onSetHomeScreen(surface.id)}
                onSetSecurityRoles={(roleIds) =>
                  surface.kind === "screen" || surface.kind === "popup" || surface.kind === "system-banner"
                    ? onSetSurfaceSecurityRoles(surface.kind, surface.id, roleIds)
                    : undefined
                }
                onDelete={() =>
                  surface.kind === "screen" || surface.kind === "popup"
                    ? onDeleteSurface(surface.kind, surface.id)
                    : undefined
                }
              />
            )}
          </div>
        </aside>
      </div>

      <footer className="esco-hmi-bottom-dock" data-testid="hmi-bottom-dock">
        <div className="esco-hmi-bottom-dock__tabs" role="tablist" aria-label="HMI bottom dock">
          <span role="tab" aria-selected="true">Problems <em>{problemCount}</em></span>
          <span role="tab">Runtime Diagnostics <em>{runtimeSession?.blockedCommandCount ?? 0}</em></span>
          <span role="tab">Tag Watch <em>{allKnownTagPaths.length}</em></span>
          <span role="tab">Output <em>{previewActive ? "live" : "idle"}</em></span>
        </div>
        <div className="esco-hmi-bottom-dock__content">
          <strong>{errorCount} errors</strong>
          <span>{warningCount} warnings</span>
          <span>{infoCount} messages</span>
          {findings.slice(0, 3).map((finding) => (
            <p key={`${finding.ruleId}:${finding.target ?? ""}`}>
              <em>{finding.severity}</em>
              {finding.message}
            </p>
          ))}
          {findings.length === 0 ? <p><em>output</em> Runtime package checks are clear.</p> : null}
        </div>
      </footer>
    </div>
  );
}
