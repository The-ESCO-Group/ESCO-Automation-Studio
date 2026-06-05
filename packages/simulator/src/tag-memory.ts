import { evaluateExpression } from "@esco/instructions";

export type PlcValue = boolean | number | string;

const SIMPLE_INDEX_PATH = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/;

/**
 * Holds live tag values for a simulation session.
 *
 * Ladder logic in Logix reads the most-recent value of a tag during the scan
 * (an OTE on rung 0 is visible to an XIC on rung 1), so a single coherent value
 * map is the correct image for executing logic. The separate physical input /
 * output image and its end-of-scan commit are reserved for when real I/O is
 * modelled; {@link commitScan} is the hook for that and is a no-op today.
 *
 * Each tag is registered with a power-up value via {@link define} so the
 * simulator can {@link reset} the session back to a known state.
 */
export class TagMemory {
  private values = new Map<string, PlcValue>();
  private initial = new Map<string, PlcValue>();
  private aliases = new Map<string, string>();

  private stringLengthPath(path: string): string | undefined {
    const resolved = this.resolve(path);
    if (!resolved || /\.(?:LEN|DATA(?:\[[^\]]+])?)$/i.test(resolved)) return undefined;
    return `${resolved}.LEN`;
  }

  private syncStringLength(path: string, value: string, target: Map<string, PlcValue>): void {
    const lengthPath = this.stringLengthPath(path);
    if (lengthPath) target.set(lengthPath, value.length);
  }

  /** Register a tag and its power-up value. Does not clobber a live value. */
  define(path: string, value: PlcValue = false): void {
    this.initial.set(path, value);
    if (typeof value === "string") this.syncStringLength(path, value, this.initial);
    if (!this.values.has(path)) {
      this.values.set(path, value);
      if (typeof value === "string") this.syncStringLength(path, value, this.values);
    }
  }

  /** Map an alias tag name to its base tag, so reads/writes resolve to the base. */
  defineAlias(name: string, base: string): void {
    if (name && base) this.aliases.set(name, base);
  }

  /** Resolve the base segment of a path through any alias chain (`MotorCmd.DN` → `Run.DN`). */
  private resolveAliasBase(path: string): string {
    if (this.aliases.size === 0) return path;
    const match = path.match(/^([A-Za-z_][A-Za-z0-9_]*)(.*)$/);
    if (!match) return path;
    let base = match[1]!;
    const seen = new Set<string>();
    while (this.aliases.has(base) && !seen.has(base)) {
      seen.add(base);
      base = this.aliases.get(base)!;
    }
    return base + (match[2] ?? "");
  }

  private coerceIndex(value: PlcValue | undefined): number {
    const raw =
      typeof value === "number"
        ? value
        : typeof value === "boolean"
          ? value
            ? 1
            : 0
          : typeof value === "string"
            ? Number(value)
            : 0;
    if (!Number.isFinite(raw)) return 0;
    return Math.max(0, Math.trunc(raw));
  }

  private resolveIndexToken(token: string, seen: Set<string>): string {
    const trimmed = token.trim();
    if (/^\d+$/.test(trimmed)) return String(Number(trimmed));
    if (SIMPLE_INDEX_PATH.test(trimmed)) {
      if (seen.has(trimmed)) return "0";
      seen.add(trimmed);
      const resolvedPath = this.resolve(trimmed, seen);
      const value = this.values.get(resolvedPath);
      seen.delete(trimmed);
      return String(this.coerceIndex(value));
    }
    const result = evaluateExpression(trimmed, (path) => {
      const resolvedPath = this.resolve(path, seen);
      return this.coerceIndex(this.values.get(resolvedPath));
    });
    return result.ok ? String(this.coerceIndex(result.value)) : trimmed;
  }

  private resolveDynamicIndices(path: string, seen: Set<string>): string {
    return path.replace(/\[([^\]]+)]/g, (_match, raw: string) => {
      const indices = raw.split(",").map((part) => this.resolveIndexToken(part, seen));
      return `[${indices.join(",")}]`;
    });
  }

  private resolve(path: string, seen = new Set<string>()): string {
    return this.resolveDynamicIndices(this.resolveAliasBase(path), seen);
  }

  read(path: string): PlcValue {
    return this.values.get(this.resolve(path)) ?? false;
  }

  write(path: string, value: PlcValue): void {
    this.values.set(this.resolve(path), value);
    if (typeof value === "string") this.syncStringLength(path, value, this.values);
  }

  readBool(path: string): boolean {
    return this.read(path) === true;
  }

  writeBool(path: string, value: boolean): void {
    this.values.set(this.resolve(path), value);
  }

  /** Read a path as a number, coercing booleans/strings; missing values are 0. */
  readNumber(path: string): number {
    const value = this.values.get(this.resolve(path));
    if (typeof value === "number") return value;
    if (typeof value === "boolean") return value ? 1 : 0;
    if (typeof value === "string") {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : 0;
    }
    return 0;
  }

  /** Read a path as STRING text; missing/false string tags behave like an empty STRING. */
  readString(path: string): string {
    const value = this.values.get(this.resolve(path));
    if (typeof value === "string") return value;
    if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
    return value === true ? "1" : "";
  }

  /** Write a STRING tag and keep its conventional .LEN member synchronized. */
  writeString(path: string, value: string): void {
    this.write(path, value);
  }

  /** Restore every defined tag to its registered power-up value. */
  reset(): void {
    this.values = new Map(this.initial);
  }

  /** Commit the pending output image at the end of a scan. No-op for now. */
  commitScan(): void {}

  snapshot(): Record<string, PlcValue> {
    return Object.fromEntries(this.values);
  }
}
