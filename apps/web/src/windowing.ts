/**
 * Lightweight windowing for large lists. Rather than pull in a virtualization
 * library, we cap how many rows render at once and tell the user to refine their
 * search / expand. Pure and testable; the UI decides when to apply it.
 */
export interface Windowed<T> {
  items: T[];
  total: number;
  truncated: boolean;
  hidden: number;
}

export interface VirtualWindow<T> extends Windowed<T> {
  active: boolean;
  startIndex: number;
  endIndex: number;
  beforePx: number;
  afterPx: number;
  totalPx: number;
}

export interface VirtualWindowOptions {
  scrollTop: number;
  viewportHeight: number;
  rowHeight: number;
  overscan?: number;
  minimumTotal?: number;
}

/** Return at most `limit` items, reporting whether (and how much) was truncated. */
export function capList<T>(items: readonly T[], limit: number): Windowed<T> {
  const total = items.length;
  if (limit <= 0 || total <= limit) {
    return { items: [...items], total, truncated: false, hidden: 0 };
  }
  return { items: items.slice(0, limit), total, truncated: true, hidden: total - limit };
}

/** Return the list slice that should be rendered for a scroll-windowed list. */
export function virtualWindow<T>(
  items: readonly T[],
  options: VirtualWindowOptions,
): VirtualWindow<T> {
  const total = items.length;
  const rowHeight = Math.max(1, Math.trunc(options.rowHeight));
  const viewportHeight = Math.max(rowHeight, Math.trunc(options.viewportHeight || rowHeight));
  const minimumTotal = Math.max(0, Math.trunc(options.minimumTotal ?? 0));
  const active = total > minimumTotal;

  if (!active) {
    return {
      items: [...items],
      total,
      truncated: false,
      hidden: 0,
      active: false,
      startIndex: 0,
      endIndex: total,
      beforePx: 0,
      afterPx: 0,
      totalPx: total * rowHeight,
    };
  }

  const overscan = Math.max(0, Math.trunc(options.overscan ?? 0));
  const visibleCount = Math.max(1, Math.ceil(viewportHeight / rowHeight));
  const windowSize = Math.min(total, visibleCount + overscan * 2);
  const rawStart = Math.floor(Math.max(0, options.scrollTop) / rowHeight) - overscan;
  const maxStart = Math.max(0, total - windowSize);
  const startIndex = Math.max(0, Math.min(maxStart, rawStart));
  const endIndex = Math.min(total, startIndex + windowSize);
  const windowItems = items.slice(startIndex, endIndex);

  return {
    items: windowItems,
    total,
    truncated: windowItems.length < total,
    hidden: total - windowItems.length,
    active: true,
    startIndex,
    endIndex,
    beforePx: startIndex * rowHeight,
    afterPx: Math.max(0, (total - endIndex) * rowHeight),
    totalPx: total * rowHeight,
  };
}
