import {
  evaluateHmiExpression,
  expressionTagReferences,
  type ExpressionTagLookup,
} from "./expression-evaluator";
import type { HmiTagQuality, HmiTagValue, RuntimeTagProvider } from "./runtime-tag-provider";
import type { HmiAnimation, HmiGraphicElement, HmiPropertyBinding } from "./types";

/**
 * The binding engine resolves an HMI object's *runtime* properties from its
 * design-time bindings and animations, using a {@link RuntimeTagProvider} for
 * live values. It turns "this Text's `text` is bound to {Tank_Level}" into a
 * concrete resolved value plus quality and diagnostics, and (in the live form)
 * keeps that resolution current by subscribing to the tags it references.
 *
 * Supported binding kinds: tag, expression, system-tag, property (static).
 * Animations provide state-map / color-map resolution (value → state / color).
 */

export type HmiBindingDiagnosticCode =
  | "unknown-tag"
  | "expression"
  | "syntax"
  | "bad-quality"
  | "unmapped-state"
  | "unsupported";

export interface HmiBindingDiagnostic {
  elementId: string;
  targetProperty: string;
  code: HmiBindingDiagnosticCode;
  severity: "error" | "warning" | "info";
  message: string;
}

export interface HmiElementRuntimeState {
  elementId: string;
  typeId: string;
  /** Design-time property values (unchanged baseline). */
  designProps: Record<string, unknown>;
  /** Resolved live values, keyed by target property. */
  runtimeProps: Record<string, HmiTagValue>;
  /** Resolved quality per target property. */
  quality: Record<string, HmiTagQuality>;
  diagnostics: HmiBindingDiagnostic[];
  lastUpdatedMs: number;
}

export interface BindingResolveContext {
  lookup: ExpressionTagLookup;
  nowMs: number;
}

function severityForQuality(quality: HmiTagQuality): "error" | "warning" {
  return quality === "bad" ? "error" : "warning";
}

function resolveSourceValue(
  element: HmiGraphicElement,
  source: HmiPropertyBinding["source"] | HmiAnimation["source"],
  targetProperty: string,
  context: BindingResolveContext,
  diagnostics: HmiBindingDiagnostic[],
): { value: HmiTagValue; quality: HmiTagQuality } {
  switch (source.kind) {
    case "tag":
    case "system-tag": {
      const resolved = context.lookup(source.path);
      if (!resolved) {
        diagnostics.push({
          elementId: element.id,
          targetProperty,
          code: "unknown-tag",
          severity: "error",
          message: `${source.kind === "system-tag" ? "System tag" : "Tag"} "${source.path}" is not defined.`,
        });
        return { value: null, quality: "bad" };
      }
      if (resolved.quality !== "good") {
        diagnostics.push({
          elementId: element.id,
          targetProperty,
          code: "bad-quality",
          severity: severityForQuality(resolved.quality),
          message: `Tag "${source.path}" has ${resolved.quality} quality.`,
        });
      }
      return resolved;
    }
    case "expression": {
      const result = evaluateHmiExpression(source.path, context.lookup);
      for (const diagnostic of result.diagnostics) {
        diagnostics.push({
          elementId: element.id,
          targetProperty,
          code: diagnostic.code === "unknown-tag" ? "unknown-tag" : diagnostic.code === "syntax" ? "syntax" : "expression",
          severity: diagnostic.code === "type" ? "warning" : "error",
          message: diagnostic.message,
        });
      }
      return { value: result.value, quality: result.quality };
    }
    case "property": {
      // Static binding: read another design property, or use the literal path.
      const value = Object.hasOwn(element.properties, source.path)
        ? (element.properties[source.path] as HmiTagValue)
        : (source.path as HmiTagValue);
      return { value: value ?? null, quality: "good" };
    }
    default:
      diagnostics.push({
        elementId: element.id,
        targetProperty,
        code: "unsupported",
        severity: "warning",
        message: `Binding source kind "${(source as { kind: string }).kind}" is not supported in runtime preview.`,
      });
      return { value: null, quality: "uncertain" };
  }
}

function applyAnimation(
  element: HmiGraphicElement,
  animation: HmiAnimation,
  context: BindingResolveContext,
  runtimeProps: Record<string, HmiTagValue>,
  quality: Record<string, HmiTagQuality>,
  diagnostics: HmiBindingDiagnostic[],
): void {
  const source = resolveSourceValue(element, animation.source, animation.targetProperty, context, diagnostics);
  const table = animation.table;
  const match = table.states.find((entry) => looseMatch(entry.value, source.value));
  if (!match) {
    diagnostics.push({
      elementId: element.id,
      targetProperty: animation.targetProperty,
      code: "unmapped-state",
      severity: "info",
      message: `No ${table.kind} mapping for value "${String(source.value)}" on "${animation.targetProperty}".`,
    });
    return;
  }
  runtimeProps[animation.targetProperty] = "color" in match ? match.color : match.state;
  quality[animation.targetProperty] = source.quality;
}

function looseMatch(tableValue: string | number | boolean, runtimeValue: HmiTagValue): boolean {
  if (tableValue === runtimeValue) return true;
  if (typeof runtimeValue === "number" && typeof tableValue === "string") return Number(tableValue) === runtimeValue;
  if (typeof runtimeValue === "boolean") {
    if (typeof tableValue === "number") return (tableValue !== 0) === runtimeValue;
    if (typeof tableValue === "string") return (tableValue.toLowerCase() === "true") === runtimeValue;
  }
  return false;
}

/**
 * Resolve one element's runtime state from its bindings + animations. Pure: no
 * subscriptions, no side effects — given the same lookup it always produces the
 * same state. Write-only bindings are skipped (they don't drive a display value).
 */
export function resolveHmiElement(
  element: HmiGraphicElement,
  context: BindingResolveContext,
): HmiElementRuntimeState {
  const runtimeProps: Record<string, HmiTagValue> = {};
  const quality: Record<string, HmiTagQuality> = {};
  const diagnostics: HmiBindingDiagnostic[] = [];

  for (const binding of element.bindings) {
    if (binding.mode === "write") continue;
    const resolved = resolveSourceValue(element, binding.source, binding.targetProperty, context, diagnostics);
    runtimeProps[binding.targetProperty] = resolved.value;
    quality[binding.targetProperty] = resolved.quality;
  }

  for (const animation of element.animations) {
    applyAnimation(element, animation, context, runtimeProps, quality, diagnostics);
  }

  return {
    elementId: element.id,
    typeId: element.typeId,
    designProps: element.properties,
    runtimeProps,
    quality,
    diagnostics,
    lastUpdatedMs: context.nowMs,
  };
}

/** Collect every tag path an element's bindings/animations reference. */
export function elementTagReferences(element: HmiGraphicElement): string[] {
  const refs = new Set<string>();
  const collect = (source: HmiPropertyBinding["source"] | HmiAnimation["source"]) => {
    if (source.kind === "tag" || source.kind === "system-tag") {
      refs.add(source.path);
    } else if (source.kind === "expression") {
      for (const ref of expressionTagReferences(source.path)) refs.add(ref);
    }
  };
  for (const binding of element.bindings) collect(binding.source);
  for (const animation of element.animations) collect(animation.source);
  return [...refs];
}

export interface HmiBindingEngineOptions {
  /** Read-only system tags merged into the lookup (e.g. session System.* tags). */
  systemTags?: Record<string, HmiTagValue>;
  clock?: () => number;
}

/**
 * Live binding engine bound to a provider. Register elements, then read their
 * resolved states or subscribe for updates as referenced tags change. The engine
 * owns its tag subscriptions and releases them on {@link dispose}.
 */
export class HmiBindingEngine {
  private readonly elements = new Map<string, HmiGraphicElement>();
  private readonly unsubscribers: Array<() => void> = [];
  private readonly listeners = new Set<(states: HmiElementRuntimeState[]) => void>();
  private systemTags: Record<string, HmiTagValue>;
  private readonly clock: () => number;
  private suppressNotify = false;
  private disposed = false;

  constructor(private readonly provider: RuntimeTagProvider, options: HmiBindingEngineOptions = {}) {
    this.systemTags = { ...(options.systemTags ?? {}) };
    this.clock = options.clock ?? (() => Date.now());
  }

  private lookup: ExpressionTagLookup = (path) => {
    if (Object.hasOwn(this.systemTags, path)) return { value: this.systemTags[path]!, quality: "good" };
    if (!this.provider.getMetadata(path)) return undefined;
    const sample = this.provider.read(path);
    return { value: sample.value, quality: sample.quality };
  };

  /** Replace the registered element set and (re)wire tag subscriptions. */
  setElements(elements: readonly HmiGraphicElement[]): void {
    this.elements.clear();
    for (const element of elements) this.elements.set(element.id, element);
    this.rewireSubscriptions();
    this.notify();
  }

  setSystemTags(systemTags: Record<string, HmiTagValue>): void {
    this.systemTags = { ...systemTags };
    this.notify();
  }

  private rewireSubscriptions(): void {
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.unsubscribers.length = 0;
    const paths = new Set<string>();
    for (const element of this.elements.values()) {
      for (const ref of elementTagReferences(element)) paths.add(ref);
    }
    // Subscribe quietly: the immediate current-value callback shouldn't spam listeners.
    this.suppressNotify = true;
    for (const path of paths) {
      this.unsubscribers.push(this.provider.subscribe(path, () => this.notify()));
    }
    this.suppressNotify = false;
  }

  resolve(elementId: string): HmiElementRuntimeState | undefined {
    const element = this.elements.get(elementId);
    if (!element) return undefined;
    return resolveHmiElement(element, { lookup: this.lookup, nowMs: this.clock() });
  }

  resolveAll(): HmiElementRuntimeState[] {
    const nowMs = this.clock();
    return [...this.elements.values()].map((element) => resolveHmiElement(element, { lookup: this.lookup, nowMs }));
  }

  /** All binding diagnostics across registered elements at the current values. */
  diagnostics(): HmiBindingDiagnostic[] {
    return this.resolveAll().flatMap((state) => state.diagnostics);
  }

  subscribe(listener: (states: HmiElementRuntimeState[]) => void): () => void {
    this.listeners.add(listener);
    listener(this.resolveAll());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    if (this.suppressNotify || this.disposed || this.listeners.size === 0) return;
    const states = this.resolveAll();
    for (const listener of [...this.listeners]) listener(states);
  }

  dispose(): void {
    this.disposed = true;
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.unsubscribers.length = 0;
    this.listeners.clear();
    this.elements.clear();
  }

  get isDisposed(): boolean {
    return this.disposed;
  }
}
