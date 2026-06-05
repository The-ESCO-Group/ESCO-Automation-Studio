import type { HmiControllerReference, HmiControllerReferenceTag } from "./types";

/**
 * Live runtime tag access for the HMI preview. The model layer already knows how
 * to evaluate alarms/trends/buttons given a `values` map; this provider is what
 * actually *produces and maintains* those values at runtime — reads, writes, and
 * change subscriptions, each value carrying quality and a timestamp.
 *
 * Everything here is deterministic and offline: {@link SimulatorTagProvider}
 * holds an in-memory typed value map seeded from the project's controller
 * references (or demo tags when none exist). It never reaches hardware.
 */

export type HmiTagQuality = "good" | "bad" | "uncertain";

export type HmiTagValue = string | number | boolean | null;

export interface HmiTagSample {
  path: string;
  value: HmiTagValue;
  quality: HmiTagQuality;
  timestampMs: number;
}

export interface HmiTagMetadata {
  path: string;
  dataType: string;
  scope: "controller" | "program";
  description?: string;
  writable: boolean;
}

export interface HmiTagWriteRequest {
  path: string;
  value: HmiTagValue;
  /** Why the write happened (e.g. "button:press") — surfaced in diagnostics/audit. */
  reason?: string;
  /** HMI object that initiated the write, for audit/diagnostics. */
  sourceObjectId?: string;
  /** Runtime user that initiated the write, for audit/diagnostics. */
  userId?: string;
  timestampMs?: number;
}

export interface HmiTagWriteResult {
  ok: boolean;
  path: string;
  value: HmiTagValue;
  quality: HmiTagQuality;
  timestampMs: number;
  message?: string;
}

export type HmiTagSubscriber = (sample: HmiTagSample) => void;

/** The runtime contract bindings/actions depend on; hardware-free by design. */
export interface RuntimeTagProvider {
  read(path: string): HmiTagSample;
  write(request: HmiTagWriteRequest): HmiTagWriteResult;
  /**
   * Subscribe to a tag's changes. The current sample is delivered synchronously
   * on subscribe so objects render an initial value. Returns an unsubscribe fn.
   */
  subscribe(path: string, callback: HmiTagSubscriber): () => void;
  listTags(): string[];
  getMetadata(path: string): HmiTagMetadata | undefined;
  /** All known tag metadata, in declaration order. */
  metadata(): HmiTagMetadata[];
  dispose(): void;
}

const NUMERIC_TYPES = new Set([
  "SINT",
  "INT",
  "DINT",
  "LINT",
  "USINT",
  "UINT",
  "UDINT",
  "ULINT",
  "REAL",
  "LREAL",
]);

/** Coerce a raw value to the shape implied by a Logix data type. */
export function coerceTagValue(dataType: string, value: HmiTagValue): HmiTagValue {
  const type = dataType.toUpperCase();
  if (type === "BOOL") {
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value !== 0;
    if (typeof value === "string") {
      const v = value.trim().toLowerCase();
      if (v === "1" || v === "true" || v === "on") return true;
      if (v === "0" || v === "false" || v === "off" || v === "") return false;
    }
    return Boolean(value);
  }
  if (NUMERIC_TYPES.has(type)) {
    const n = typeof value === "number" ? value : Number(value);
    return Number.isFinite(n) ? n : null;
  }
  if (type === "STRING") {
    return value === null || value === undefined ? "" : String(value);
  }
  return value;
}

function defaultValueFor(dataType: string): HmiTagValue {
  const type = dataType.toUpperCase();
  if (type === "BOOL") return false;
  if (NUMERIC_TYPES.has(type)) return 0;
  if (type === "STRING") return "";
  return null;
}

function qualityFor(value: HmiTagValue): HmiTagQuality {
  if (value === null) return "bad";
  if (typeof value === "number" && !Number.isFinite(value)) return "bad";
  return "good";
}

interface TagEntry {
  metadata: HmiTagMetadata;
  value: HmiTagValue;
  initialValue: HmiTagValue;
  quality: HmiTagQuality;
  timestampMs: number;
}

export interface SimulatorTagSeed {
  path: string;
  dataType: string;
  scope?: "controller" | "program";
  description?: string;
  writable?: boolean;
  value?: HmiTagValue;
}

export interface SimulatorTagProviderOptions {
  /** Explicit seed tags; take precedence over controller-reference tags. */
  seeds?: SimulatorTagSeed[];
  /** Controller references whose tags seed the provider when no seeds are given. */
  controllerReferences?: readonly HmiControllerReference[];
  /** Injectable clock for deterministic timestamps in tests. */
  clock?: () => number;
  /** Skip the built-in demo tags when nothing else seeds the provider. */
  noDemoTags?: boolean;
}

/** Demo tags used only when a preview has no project tags to bind against. */
export const DEMO_TAG_SEEDS: SimulatorTagSeed[] = [
  { path: "Motor_Start", dataType: "BOOL", value: false },
  { path: "Motor_Running", dataType: "BOOL", value: false },
  { path: "Motor_Speed", dataType: "REAL", value: 0 },
  { path: "Tank_Level", dataType: "REAL", value: 42 },
  { path: "Tank_Setpoint", dataType: "REAL", value: 75 },
  { path: "Tank_HighAlarm", dataType: "BOOL", value: false },
  { path: "Line_Status", dataType: "STRING", value: "Idle" },
];

function tagSeedsFromReferences(references: readonly HmiControllerReference[]): SimulatorTagSeed[] {
  const seeds: SimulatorTagSeed[] = [];
  const seen = new Set<string>();
  for (const reference of references) {
    for (const tag of reference.tags as HmiControllerReferenceTag[]) {
      if (!tag.path || seen.has(tag.path)) continue;
      seen.add(tag.path);
      seeds.push({
        path: tag.path,
        dataType: tag.dataType,
        scope: tag.scope,
        description: tag.description,
        // External-access "Read Only" tags are not writable from the HMI.
        writable: tag.externalAccess ? !/read[\s-]?only/i.test(tag.externalAccess) : true,
      });
    }
  }
  return seeds;
}

export class SimulatorTagProvider implements RuntimeTagProvider {
  private readonly entries = new Map<string, TagEntry>();
  private readonly order: string[] = [];
  private readonly subscribers = new Map<string, Set<HmiTagSubscriber>>();
  private readonly clock: () => number;
  private disposed = false;

  constructor(options: SimulatorTagProviderOptions = {}) {
    this.clock = options.clock ?? (() => Date.now());
    let seeds = options.seeds ?? [];
    if (seeds.length === 0 && options.controllerReferences?.length) {
      seeds = tagSeedsFromReferences(options.controllerReferences);
    }
    if (seeds.length === 0 && !options.noDemoTags) {
      seeds = DEMO_TAG_SEEDS;
    }
    for (const seed of seeds) this.seed(seed);
  }

  private seed(seed: SimulatorTagSeed): void {
    if (this.entries.has(seed.path)) return;
    const value =
      seed.value !== undefined ? coerceTagValue(seed.dataType, seed.value) : defaultValueFor(seed.dataType);
    this.order.push(seed.path);
    this.entries.set(seed.path, {
      metadata: {
        path: seed.path,
        dataType: seed.dataType,
        scope: seed.scope ?? "controller",
        description: seed.description,
        writable: seed.writable ?? true,
      },
      value,
      initialValue: value,
      quality: qualityFor(value),
      timestampMs: this.clock(),
    });
  }

  read(path: string): HmiTagSample {
    const entry = this.entries.get(path);
    if (!entry) {
      return { path, value: null, quality: "bad", timestampMs: this.clock() };
    }
    return { path, value: entry.value, quality: entry.quality, timestampMs: entry.timestampMs };
  }

  write(request: HmiTagWriteRequest): HmiTagWriteResult {
    const timestampMs = request.timestampMs ?? this.clock();
    const entry = this.entries.get(request.path);
    if (!entry) {
      return {
        ok: false,
        path: request.path,
        value: null,
        quality: "bad",
        timestampMs,
        message: `Tag "${request.path}" is not defined in the runtime tag set.`,
      };
    }
    if (!entry.metadata.writable) {
      return {
        ok: false,
        path: request.path,
        value: entry.value,
        quality: entry.quality,
        timestampMs,
        message: `Tag "${request.path}" is read-only and cannot be written from the HMI.`,
      };
    }
    const coerced = coerceTagValue(entry.metadata.dataType, request.value);
    this.apply(entry, coerced, qualityFor(coerced), timestampMs);
    return { ok: true, path: request.path, value: coerced, quality: entry.quality, timestampMs };
  }

  /**
   * Simulator-side update (tick loop, tag inspector). Unlike {@link write} it
   * ignores writability and coerces to the tag's type. Notifies subscribers.
   */
  setValue(path: string, value: HmiTagValue, quality?: HmiTagQuality, timestampMs?: number): HmiTagSample {
    const ts = timestampMs ?? this.clock();
    const entry = this.entries.get(path);
    if (!entry) {
      // Unknown paths are created on the fly as untyped controller tags.
      this.seed({ path, dataType: typeof value === "boolean" ? "BOOL" : typeof value === "number" ? "REAL" : "STRING", value });
      return this.read(path);
    }
    const coerced = coerceTagValue(entry.metadata.dataType, value);
    this.apply(entry, coerced, quality ?? qualityFor(coerced), ts);
    return { path, value: entry.value, quality: entry.quality, timestampMs: ts };
  }

  private apply(entry: TagEntry, value: HmiTagValue, quality: HmiTagQuality, timestampMs: number): void {
    entry.value = value;
    entry.quality = quality;
    entry.timestampMs = timestampMs;
    this.notify(entry);
  }

  private notify(entry: TagEntry): void {
    const subs = this.subscribers.get(entry.metadata.path);
    if (!subs) return;
    const sample: HmiTagSample = {
      path: entry.metadata.path,
      value: entry.value,
      quality: entry.quality,
      timestampMs: entry.timestampMs,
    };
    for (const subscriber of [...subs]) subscriber(sample);
  }

  subscribe(path: string, callback: HmiTagSubscriber): () => void {
    let set = this.subscribers.get(path);
    if (!set) {
      set = new Set();
      this.subscribers.set(path, set);
    }
    set.add(callback);
    // Deliver the current sample immediately so objects paint an initial value.
    callback(this.read(path));
    return () => {
      const current = this.subscribers.get(path);
      if (!current) return;
      current.delete(callback);
      if (current.size === 0) this.subscribers.delete(path);
    };
  }

  listTags(): string[] {
    return [...this.order];
  }

  getMetadata(path: string): HmiTagMetadata | undefined {
    return this.entries.get(path)?.metadata;
  }

  metadata(): HmiTagMetadata[] {
    return this.order.map((path) => this.entries.get(path)!.metadata);
  }

  /** Restore every tag to its seeded initial value (notifying subscribers). */
  reset(): void {
    const ts = this.clock();
    for (const path of this.order) {
      const entry = this.entries.get(path)!;
      this.apply(entry, entry.initialValue, qualityFor(entry.initialValue), ts);
    }
  }

  dispose(): void {
    this.disposed = true;
    this.subscribers.clear();
  }

  get isDisposed(): boolean {
    return this.disposed;
  }
}
