// E2E smoke runner: runs every driver against the dev server and aggregates results.
//
// Prerequisites:
//   1. The dev server must be running on http://localhost:5173 (`pnpm dev`).
//   2. Microsoft Edge must be installed (drivers launch via channel "msedge").
//
// Usage:  pnpm e2e
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readdirSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));
const URL = "http://localhost:5173/";

// Run order: welcome/navigation first, feature drivers next, file I/O last.
const ORDER = [
  "welcome.mjs",
  "driver.mjs",
  "instr.mjs",
  "newinstr.mjs",
  "branchedit.mjs",
  "undoredo.mjs",
  "tags.mjs",
  "props.mjs",
  "xref.mjs",
  "compare.mjs",
  "ai.mjs",
  "persist.mjs",
  "l5x.mjs",
  "l5x-branch.mjs",
];

const present = new Set(readdirSync(here).filter((f) => f.endsWith(".mjs") && f !== "run-all.mjs"));
const drivers = [...ORDER.filter((d) => present.has(d)), ...[...present].filter((d) => !ORDER.includes(d))];

async function devServerUp() {
  try {
    const res = await fetch(URL, { method: "GET" });
    return res.ok;
  } catch {
    return false;
  }
}

if (!(await devServerUp())) {
  console.error(`\nDev server is not reachable at ${URL}`);
  console.error("Start it first in another terminal:  pnpm dev\n");
  process.exit(2);
}

const summary = [];
let totalPass = 0;
let totalChecks = 0;

for (const driver of drivers) {
  const run = spawnSync(process.execPath, [join(here, driver)], { encoding: "utf-8" });
  const out = `${run.stdout || ""}${run.stderr || ""}`;
  const m = out.match(/SUMMARY:\s*(\d+)\/(\d+)/);
  const failLines = out
    .split("\n")
    .filter((l) => /^FAIL\b/.test(l) || /^ERROR:|^PAGEERROR:/.test(l))
    .map((l) => l.trim());

  if (m) {
    const [pass, total] = [Number(m[1]), Number(m[2])];
    const ok = pass === total && run.status === 0;
    totalPass += pass;
    totalChecks += total;
    summary.push({ driver, label: `${pass}/${total}`, ok, fails: ok ? [] : failLines });
  } else {
    summary.push({ driver, label: "NO SUMMARY", ok: false, fails: failLines.length ? failLines : [out.trim().slice(-200)] });
  }
}

console.log("\n================ E2E SMOKE ================");
let allOk = true;
for (const s of summary) {
  if (!s.ok) allOk = false;
  console.log(`${s.ok ? "PASS" : "FAIL"}  ${s.driver.padEnd(16)} ${s.label}`);
  for (const f of s.fails) console.log(`        ${f}`);
}
console.log("------------------------------------------");
console.log(`${allOk ? "ALL DRIVERS PASS" : "SOME DRIVERS FAILED"}  —  ${totalPass}/${totalChecks} checks across ${summary.length} drivers`);
console.log("==========================================\n");

process.exit(allOk ? 0 : 1);
