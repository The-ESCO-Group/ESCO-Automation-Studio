import type { ProjectComparison, RoutineRef } from "./compare";
import type { NamedDiff, StructureComparison } from "./structure-compare";

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

/** Escape text for safe inclusion in HTML. */
function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function namedDiffSection(title: string, diff: NamedDiff): string {
  const changedRows = diff.changed
    .map((c) => `<tr><td>changed</td><td>${esc(c.name)}</td><td>${esc(c.details.join("; "))}</td></tr>`)
    .join("");
  const addedRows = diff.added
    .map((n) => `<tr><td>added</td><td>${esc(n)}</td><td></td></tr>`)
    .join("");
  const removedRows = diff.removed
    .map((n) => `<tr><td>removed</td><td>${esc(n)}</td><td></td></tr>`)
    .join("");
  const rows = changedRows + addedRows + removedRows;
  return `<section><h2>${esc(title)}</h2>
<p>${diff.added.length} added · ${diff.removed.length} removed · ${diff.changed.length} changed · ${diff.unchanged} unchanged</p>
<table><thead><tr><th>Status</th><th>Name</th><th>Details</th></tr></thead>
<tbody>${rows || '<tr><td colspan="3">No differences.</td></tr>'}</tbody></table></section>`;
}

/**
 * A self-contained, print-friendly HTML report of the comparison. Includes the
 * routine comparison summary + per-routine rows, and (when provided) the
 * structure diff (tags / data types / AOIs / I/O). No external assets; safe to
 * open or print in a browser.
 */
export function compareReportHtml(
  result: ProjectComparison,
  structure?: StructureComparison,
): string {
  const routineRows = [
    ...result.changed.map(
      (m) =>
        `<tr><td>changed</td><td>${esc(refName(m.left))}</td><td>${esc(refName(m.right))}</td><td>${esc(`${m.status} (by ${m.matchedBy})`)}</td><td>${esc(m.details.join("; "))}</td></tr>`,
    ),
    ...result.onlyInLeft.map((r) => `<tr><td>only-in-current</td><td>${esc(refName(r))}</td><td></td><td></td><td></td></tr>`),
    ...result.onlyInRight.map((r) => `<tr><td>only-in-comparison</td><td></td><td>${esc(refName(r))}</td><td></td><td></td></tr>`),
  ].join("");

  const structureSections = structure
    ? namedDiffSection("Tasks", structure.tasks) +
      namedDiffSection("Programs", structure.programs) +
      namedDiffSection("Tags", structure.tags) +
      namedDiffSection("Data Types", structure.dataTypes) +
      namedDiffSection("Add-On Instructions", structure.addOnInstructions) +
      namedDiffSection("I/O Modules", structure.modules)
    : "";

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>ESCO Automation Studio — Comparison Report</title>
<style>
 body{font-family:system-ui,Segoe UI,Arial,sans-serif;margin:2rem;color:#1a1a1a}
 h1{font-size:1.4rem} h2{font-size:1.1rem;margin-top:1.5rem}
 table{border-collapse:collapse;width:100%;margin:.5rem 0;font-size:.9rem}
 th,td{border:1px solid #ccc;padding:.3rem .5rem;text-align:left;vertical-align:top}
 th{background:#f3f4f6}
 .note{color:#666;font-size:.85rem}
</style></head>
<body>
<h1>ESCO Automation Studio — Comparison Report</h1>
<p class="note">Offline comparison. Generated for review; not an original controller-editor document.</p>
<section><h2>Routines</h2>
<p>${result.summary.matched} identical · ${result.summary.changed} changed · ${result.summary.onlyInLeft} only-in-current · ${result.summary.onlyInRight} only-in-comparison</p>
<table><thead><tr><th>Status</th><th>Current</th><th>Comparison</th><th>Match</th><th>Differences</th></tr></thead>
<tbody>${routineRows || '<tr><td colspan="5">No routine differences.</td></tr>'}</tbody></table></section>
${structureSections}
</body></html>`;
}
