export type PlcValue = boolean | number | string;

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

  /** Register a tag and its power-up value. Does not clobber a live value. */
  define(path: string, value: PlcValue = false): void {
    this.initial.set(path, value);
    if (!this.values.has(path)) {
      this.values.set(path, value);
    }
  }

  read(path: string): PlcValue {
    return this.values.get(path) ?? false;
  }

  write(path: string, value: PlcValue): void {
    this.values.set(path, value);
  }

  readBool(path: string): boolean {
    return this.read(path) === true;
  }

  writeBool(path: string, value: boolean): void {
    this.values.set(path, value);
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
