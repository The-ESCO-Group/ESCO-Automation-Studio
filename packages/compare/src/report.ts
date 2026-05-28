import type { ProjectComparison, RoutineRef } from "./compare";

/** The full comparison result as pretty-printed JSON. */
export function compareReportJson(result: ProjectComparison): string {
  return JSON.stringify(result, null, 2);
}

const refName = (ref: RoutineRef): string => `${ref.programName}/${ref.routineName}`;

/** Quote a CSV cell if it contains a comma, quote, or newline (RFC 4180-ish). */
function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * The comparison as CSV with one row per routine row in the compare view:
 * Status, Left routine, Right routine, Match type, Difference summary.
 */
export function compareReportCsv(result: ProjectComparison): string {
  const rows: string[][] = [
    ["Status", "Left routine", "Right routine", "Match type", "Difference summary"],
  ];
  for (const match of result.matches) {
    rows.push(["matched", refName(match.left), refName(match.right), `${match.status} (by ${match.matchedBy})`, ""]);
  }
  for (const match of result.changed) {
    rows.push([
      "changed",
      refName(match.left),
      refName(match.right),
      `${match.status} (by ${match.matchedBy})`,
      match.details.join("; "),
    ]);
  }
  for (const ref of result.onlyInLeft) {
    rows.push(["only-in-current", refName(ref), "", "", ""]);
  }
  for (const ref of result.onlyInRight) {
    rows.push(["only-in-comparison", "", refName(ref), "", ""]);
  }
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}
