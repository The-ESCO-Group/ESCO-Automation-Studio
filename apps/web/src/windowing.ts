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

/** Return at most `limit` items, reporting whether (and how much) was truncated. */
export function capList<T>(items: readonly T[], limit: number): Windowed<T> {
  const total = items.length;
  if (limit <= 0 || total <= limit) {
    return { items: [...items], total, truncated: false, hidden: 0 };
  }
  return { items: items.slice(0, limit), total, truncated: true, hidden: total - limit };
}
