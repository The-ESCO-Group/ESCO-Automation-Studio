import { useCallback, useState } from "react";

interface HistoryState<T> {
  past: T[];
  present: T;
  future: T[];
}

export interface HistoryApi<T> {
  present: T;
  canUndo: boolean;
  canRedo: boolean;
  /** State that an undo would restore (the new present), or null. */
  undoTarget: T | null;
  /** State that a redo would restore (the new present), or null. */
  redoTarget: T | null;
  /**
   * Commit a new state: push the present onto the past and clear the redo stack.
   * Accepts a value or an updater. A result identical (by reference) to the
   * current present is ignored, so a no-op/failed action never adds history.
   */
  set: (next: T | ((current: T) => T)) => void;
  undo: () => void;
  redo: () => void;
  /** Replace the state and clear all history (e.g. open / import a project). */
  reset: (next: T) => void;
}

/** Cap the undo depth so long sessions don't grow memory without bound. */
const HISTORY_LIMIT = 100;

/**
 * Undo/redo state container (past / present / future). Used by the app to make
 * every project mutation reversible. Project-actions are immutable and return a
 * fresh project on success and the same reference on failure, so `set` only
 * records history for changes that actually happened.
 */
export function useHistoryState<T>(initial: T): HistoryApi<T> {
  const [state, setState] = useState<HistoryState<T>>({ past: [], present: initial, future: [] });

  const set = useCallback((next: T | ((current: T) => T)) => {
    setState((current) => {
      const value =
        typeof next === "function" ? (next as (c: T) => T)(current.present) : next;
      if (value === current.present) return current; // no-op: nothing changed
      return {
        past: [...current.past, current.present].slice(-HISTORY_LIMIT),
        present: value,
        future: [],
      };
    });
  }, []);

  const undo = useCallback(() => {
    setState((current) => {
      if (current.past.length === 0) return current;
      const previous = current.past[current.past.length - 1]!;
      return {
        past: current.past.slice(0, -1),
        present: previous,
        future: [current.present, ...current.future],
      };
    });
  }, []);

  const redo = useCallback(() => {
    setState((current) => {
      if (current.future.length === 0) return current;
      const next = current.future[0]!;
      return {
        past: [...current.past, current.present],
        present: next,
        future: current.future.slice(1),
      };
    });
  }, []);

  const reset = useCallback((next: T) => {
    setState({ past: [], present: next, future: [] });
  }, []);

  return {
    present: state.present,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
    undoTarget: state.past.length > 0 ? state.past[state.past.length - 1]! : null,
    redoTarget: state.future.length > 0 ? state.future[0]! : null,
    set,
    undo,
    redo,
    reset,
  };
}
