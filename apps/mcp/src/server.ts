/**
 * ESCO Automation Studio — MCP server.
 *
 * Exposes the offline ESCO IDE as Model Context Protocol tools so an MCP client
 * (Claude Code in a terminal/PowerShell, Claude Desktop) can inspect and edit
 * PLC projects and drive the Simulation Lab — using the client's own model.
 * No API key lives here and no model is called; this process only exposes tools
 * that reuse the existing offline @esco packages.
 *
 * Boundaries (same as the rest of ESCO): offline/virtual only — no controller
 * communication, no go-online/upload/download, no .ACD or vendor binaries.
 * Protocol: newline-delimited JSON-RPC 2.0 over stdio (zero dependencies).
 */

import { createInterface } from "node:readline";
import { readFileSync, writeFileSync } from "node:fs";
import { createServer, type ServerResponse } from "node:http";
import { spawn } from "node:child_process";
import { createDemoProject, createProject, type Controller, type PlcProject } from "@esco/core";
import { addRungFromText, createTag } from "@esco/project-actions";
import { createDefaultEngine } from "@esco/validator";
import { exportL5X, importL5X } from "@esco/parser-l5x";
import {
  addDevice,
  addLogicBlock,
  addScenarioFromTemplate,
  createLogicBlock,
  createSimProject,
  DEVICE_KINDS,
  deserializeSimProject,
  generateSimReport,
  LOGIC_TEMPLATES,
  PROCESS_TYPES,
  runScenario,
  SCENARIO_TEMPLATES,
  serializeSimProject,
  SIM_LAB_OFFLINE_BOUNDARY,
  validateSimProject,
  type SimDeviceKind,
  type SimLogicTemplateKind,
  type SimProcessType,
  type SimProject,
  type SimScenarioResult,
  type SimScenarioTemplateKind,
} from "@esco/sim-lab";

const SERVER_NAME = "esco-automation-studio";
const SERVER_VERSION = "0.1.0";
const BOUNDARY =
  "ESCO MCP is offline/virtual only. No controller communication, no go-online, " +
  "no upload/download, no .ACD or vendor binaries. All edits are local, review-before-use.";

// ---------------------------------------------------------------------------
// Server state
// ---------------------------------------------------------------------------

let plc: PlcProject = createDemoProject();
let plcPath: string | null = null;
let sim: SimProject | null = null;
let simResults: SimScenarioResult[] = [];

function log(message: string): void {
  process.stderr.write(`[esco-mcp] ${message}\n`);
}

// ---------------------------------------------------------------------------
// Live bridge — streams project edits to the running Studio (web/desktop) over
// Server-Sent Events so the user watches Claude's edits appear in real time.
// ---------------------------------------------------------------------------

const BRIDGE_PORT = Number(process.env.ESCO_BRIDGE_PORT) || 7393;
const sseClients = new Set<ServerResponse>();
/** Tools that change the live PLC project and should be broadcast to the Studio. */
const WRITE_TOOLS = new Set(["esco_new_project", "esco_open_project", "esco_create_tag", "esco_add_rung", "esco_import_l5x"]);

function broadcastPlc(): void {
  if (sseClients.size === 0) return;
  const payload = `data: ${JSON.stringify({ type: "plc", project: plc })}\n\n`;
  for (const res of sseClients) {
    try {
      res.write(payload);
    } catch {
      sseClients.delete(res);
    }
  }
}

function startBridge(): void {
  const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" };
  const server = createServer((req, res) => {
    const url = req.url ?? "/";
    if (req.method === "OPTIONS") {
      res.writeHead(204, cors);
      res.end();
      return;
    }
    if (url.startsWith("/health")) {
      res.writeHead(200, { ...cors, "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, server: SERVER_NAME, version: SERVER_VERSION, clients: sseClients.size }));
      return;
    }
    if (url.startsWith("/state")) {
      res.writeHead(200, { ...cors, "content-type": "application/json" });
      res.end(JSON.stringify({ plc }));
      return;
    }
    if (url.startsWith("/live")) {
      res.writeHead(200, { ...cors, "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
      res.write(`retry: 1500\n\n`);
      res.write(`data: ${JSON.stringify({ type: "plc", project: plc })}\n\n`);
      sseClients.add(res);
      log(`Studio connected to live bridge (${sseClients.size} client(s)).`);
      req.on("close", () => {
        sseClients.delete(res);
      });
      return;
    }
    res.writeHead(404, cors);
    res.end();
  });
  server.on("error", (e) => log(`Live bridge not started on ${BRIDGE_PORT}: ${(e as Error).message}`));
  server.listen(BRIDGE_PORT, "127.0.0.1", () => log(`Live bridge: http://127.0.0.1:${BRIDGE_PORT} (SSE /live, /state, /health)`));
}

function openStudio(explicitPath: string): string {
  const exe = explicitPath || process.env.ESCO_STUDIO_PATH || "";
  const url = process.env.ESCO_STUDIO_URL || "";
  if (exe) {
    spawn(exe, [], { detached: true, stdio: "ignore" }).unref();
    return `Launched ESCO Studio: ${exe}. When it loads, enable the live bridge to watch edits.`;
  }
  if (url) {
    const isWin = process.platform === "win32";
    const cmd = isWin ? "cmd" : process.platform === "darwin" ? "open" : "xdg-open";
    const args = isWin ? ["/c", "start", "", url] : [url];
    spawn(cmd, args, { detached: true, stdio: "ignore" }).unref();
    return `Opened ESCO Studio (web): ${url}.`;
  }
  throw new Error(
    "No Studio target configured. Set ESCO_STUDIO_PATH to the installed desktop executable, or ESCO_STUDIO_URL to the web app (e.g. http://localhost:5173), or pass { path }.",
  );
}

function autosavePlc(): string {
  if (!plcPath) return "";
  writeFileSync(plcPath, JSON.stringify(plc, null, 2));
  return ` Saved to ${plcPath}.`;
}

function requireSim(): SimProject {
  if (!sim) throw new Error("No simulation project. Call esco_sim_create first.");
  return sim;
}

function asParams(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object") return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = String(v);
  return out;
}

function arg(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  return v === undefined || v === null ? "" : String(v);
}

// ---------------------------------------------------------------------------
// PLC traversal helpers
// ---------------------------------------------------------------------------

type Rung = { number: number; sourceText?: string; normalizedText?: string };
type AnyRoutine = { id: string; name: string; ladder?: unknown };

interface RoutineRef {
  controller: Controller;
  programName: string;
  routine: AnyRoutine;
}

/** Routine.ladder is typed `unknown` in @esco/core to avoid a hard ladder dependency. */
function ladderRungs(routine: AnyRoutine): Rung[] {
  return (routine.ladder as { rungs?: Rung[] } | undefined)?.rungs ?? [];
}

function eachRoutine(project: PlcProject): RoutineRef[] {
  const refs: RoutineRef[] = [];
  for (const controller of project.controllers) {
    for (const program of controller.programs) {
      for (const routine of program.routines) {
        refs.push({ controller, programName: program.name, routine });
      }
    }
  }
  return refs;
}

function findRoutine(project: PlcProject, name: string): RoutineRef | undefined {
  const lower = name.trim().toLowerCase();
  return eachRoutine(project).find((r) => r.routine.name.toLowerCase() === lower);
}

function rungText(rung: Rung): string {
  return rung.sourceText ?? rung.normalizedText ?? `(rung ${rung.number})`;
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

interface Tool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => string | Promise<string>;
}

const obj = (properties: Record<string, unknown>, required: string[] = []): Record<string, unknown> => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
const str = (description: string) => ({ type: "string", description });
const optObj = () => ({ type: "object", description: "Optional key/value parameters.", additionalProperties: { type: "string" } });

const TOOLS: Tool[] = [
  {
    name: "esco_status",
    description: "Summary of the current ESCO session: loaded PLC project, controllers/programs/routines/tags, and the simulation project (if any). Start here.",
    inputSchema: obj({}),
    handler: () => {
      const routines = eachRoutine(plc);
      const tags = plc.controllers.reduce((n, c) => n + c.controllerTags.length + c.programs.reduce((m, p) => m + p.programTags.length, 0), 0);
      return [
        `${BOUNDARY}`,
        ``,
        `PLC project: "${plc.name}"${plcPath ? ` (${plcPath})` : " (unsaved)"}`,
        `  controllers ${plc.controllers.length} · programs ${plc.controllers.reduce((n, c) => n + c.programs.length, 0)} · routines ${routines.length} · tags ${tags}`,
        sim
          ? `Simulation project: "${sim.name}" (${sim.processType}) · devices ${sim.devices.length} · logic ${sim.logicBlocks.length} · scenarios ${sim.scenarios.length} · results ${simResults.length}`
          : `Simulation project: none (call esco_sim_create).`,
      ].join("\n");
    },
  },
  {
    name: "esco_boundaries",
    description: "The offline-only boundary statement enforced by ESCO. Real PLC/controller operations are intentionally unavailable.",
    inputSchema: obj({}),
    handler: () => `${BOUNDARY}\n\n${SIM_LAB_OFFLINE_BOUNDARY}`,
  },
  {
    name: "esco_open_studio",
    description: "Launch the installed ESCO Automation Studio so the user can WATCH edits live. Uses { path }, else ESCO_STUDIO_PATH (desktop exe), else ESCO_STUDIO_URL (web app). Once open and connected to the live bridge, subsequent edits (create tag, add rung, open/import) appear in real time.",
    inputSchema: obj({ path: str("Optional path to the installed Studio executable.") }),
    handler: (a) => openStudio(arg(a, "path")),
  },
  {
    name: "esco_live_status",
    description: "Show the live-bridge status: how many Studio windows are connected and watching edits, and the bridge URL.",
    inputSchema: obj({}),
    handler: () => `Live bridge http://127.0.0.1:${BRIDGE_PORT} — ${sseClients.size} Studio window(s) connected and watching.`,
  },
  {
    name: "esco_new_project",
    description: "Create a fresh ESCO-native PLC project in memory. Set demo=true (default) for a sample controller with a routine and tags, or false for an empty project.",
    inputSchema: obj({ name: str("Project name."), demo: { type: "boolean", description: "Seed a demo controller (default true)." } }),
    handler: (a) => {
      const demo = a.demo === undefined ? true : Boolean(a.demo);
      plc = demo ? createDemoProject() : createProject(arg(a, "name") || "New Project");
      if (arg(a, "name") && demo) plc.name = arg(a, "name");
      plcPath = null;
      return `Created ${demo ? "demo " : ""}project "${plc.name}". ${eachRoutine(plc).length} routine(s).`;
    },
  },
  {
    name: "esco_open_project",
    description: "Load an ESCO-native PLC project JSON file from disk.",
    inputSchema: obj({ path: str("Absolute or relative path to a .json ESCO project file.") }, ["path"]),
    handler: (a) => {
      const path = arg(a, "path");
      const data = JSON.parse(readFileSync(path, "utf8")) as PlcProject;
      if (!Array.isArray(data.controllers)) throw new Error("File is not an ESCO-native PLC project (no controllers array).");
      plc = data;
      plcPath = path;
      return `Opened "${plc.name}" from ${path}. ${eachRoutine(plc).length} routine(s).`;
    },
  },
  {
    name: "esco_save_project",
    description: "Save the current PLC project to an ESCO-native JSON file.",
    inputSchema: obj({ path: str("Target path (defaults to the previously opened/saved path).") }),
    handler: (a) => {
      const path = arg(a, "path") || plcPath;
      if (!path) throw new Error("No path given and no previous save path.");
      writeFileSync(path, JSON.stringify(plc, null, 2));
      plcPath = path;
      return `Saved "${plc.name}" to ${path}.`;
    },
  },
  {
    name: "esco_project_overview",
    description: "Structured overview of the PLC project: controllers, programs, routines (with rung counts), and tag counts.",
    inputSchema: obj({}),
    handler: () => {
      const lines: string[] = [`Project "${plc.name}"`];
      for (const controller of plc.controllers) {
        lines.push(`Controller ${controller.name} (${controller.controllerTags.length} controller tags)`);
        for (const program of controller.programs) {
          lines.push(`  Program ${program.name} (${program.programTags.length} program tags)`);
          for (const routine of program.routines) {
            lines.push(`    Routine ${routine.name} — ${ladderRungs(routine).length} rung(s)`);
          }
        }
      }
      return lines.join("\n");
    },
  },
  {
    name: "esco_list_routines",
    description: "List every routine with its program and rung count.",
    inputSchema: obj({}),
    handler: () =>
      eachRoutine(plc)
        .map((r) => `${r.routine.name}  [${r.programName}]  ${ladderRungs(r.routine).length} rung(s)`)
        .join("\n") || "(no routines)",
  },
  {
    name: "esco_get_routine",
    description: "Show a routine's rungs as neutral rung text.",
    inputSchema: obj({ name: str("Routine name.") }, ["name"]),
    handler: (a) => {
      const ref = findRoutine(plc, arg(a, "name"));
      if (!ref) throw new Error(`Routine "${arg(a, "name")}" not found.`);
      const rungs = ladderRungs(ref.routine);
      return `Routine ${ref.routine.name} [${ref.programName}] — ${rungs.length} rung(s):\n` +
        rungs.map((r) => `  ${r.number}: ${rungText(r)}`).join("\n");
    },
  },
  {
    name: "esco_list_tags",
    description: "List controller and program tags (name, data type, scope).",
    inputSchema: obj({}),
    handler: () => {
      const rows: string[] = [];
      for (const c of plc.controllers) {
        for (const t of c.controllerTags) rows.push(`${t.name}  ${t.dataType}  controller`);
        for (const p of c.programs) for (const t of p.programTags) rows.push(`${t.name}  ${t.dataType}  program:${p.name}`);
      }
      return rows.join("\n") || "(no tags)";
    },
  },
  {
    name: "esco_validate",
    description: "Run the offline validation engine and list findings (severity, rule, message).",
    inputSchema: obj({}),
    handler: () => {
      const findings = createDefaultEngine().run(plc);
      if (findings.length === 0) return "Validation clean — no findings.";
      const counts = findings.reduce((m, f) => ((m[f.severity] = (m[f.severity] ?? 0) + 1), m), {} as Record<string, number>);
      return `${findings.length} finding(s) — ${Object.entries(counts).map(([s, n]) => `${n} ${s}`).join(", ")}\n` +
        findings.slice(0, 50).map((f) => `  [${f.severity}] ${f.ruleId}: ${f.message}`).join("\n");
    },
  },
  {
    name: "esco_create_tag",
    description: "Create a controller (or program) tag. Edits the project as one offline action.",
    inputSchema: obj(
      { name: str("Tag name, e.g. StartPB."), dataType: str("e.g. BOOL, DINT, REAL, TIMER, COUNTER."), description: str("Optional description."), scope: str("'controller' (default) or 'program'."), program: str("Program name (required when scope=program).") },
      ["name", "dataType"],
    ),
    handler: (a) => {
      const scope = arg(a, "scope") === "program" ? "program" : "controller";
      let programId: string | undefined;
      if (scope === "program") {
        const programName = arg(a, "program");
        const program = plc.controllers.flatMap((c) => c.programs).find((p) => p.name.toLowerCase() === programName.toLowerCase());
        if (!program) throw new Error(`Program "${programName}" not found.`);
        programId = program.id;
      }
      const res = createTag(plc, { name: arg(a, "name"), dataType: arg(a, "dataType"), scope, ...(programId ? { programId } : {}), description: arg(a, "description") || undefined });
      if (!res.ok) throw new Error(res.error ?? "createTag failed.");
      plc = res.project;
      return `Created tag "${arg(a, "name")}" (${arg(a, "dataType")}).${autosavePlc()}`;
    },
  },
  {
    name: "esco_add_rung",
    description: "Append a rung to a routine from neutral rung text, e.g. 'XIC(StartPB) XIO(StopPB) OTE(MotorRun)'. Create any referenced tags first.",
    inputSchema: obj({ routine: str("Routine name."), text: str("Rung text."), comment: str("Optional rung comment.") }, ["routine", "text"]),
    handler: (a) => {
      const ref = findRoutine(plc, arg(a, "routine"));
      if (!ref) throw new Error(`Routine "${arg(a, "routine")}" not found.`);
      const res = addRungFromText(plc, { routineId: ref.routine.id, text: arg(a, "text"), comment: arg(a, "comment") || undefined });
      if (!res.ok) throw new Error(res.error ?? "addRungFromText failed.");
      plc = res.project;
      const warn = res.warnings?.length ? ` Warnings: ${res.warnings.join("; ")}` : "";
      return `Added rung to ${ref.routine.name}.${warn}${autosavePlc()}`;
    },
  },
  {
    name: "esco_import_l5x",
    description: "Import a Studio 5000-style .L5X XML file (offline, review-only) into the PLC project. No .ACD or binary formats.",
    inputSchema: obj({ path: str("Path to a .L5X XML file.") }, ["path"]),
    handler: (a) => {
      const xml = readFileSync(arg(a, "path"), "utf8");
      const result = importL5X(xml);
      plc = result.project;
      plcPath = null;
      const warn = result.warnings.length ? `\nWarnings: ${result.warnings.slice(0, 10).join("; ")}` : "";
      return `Imported L5X into "${plc.name}" — ${eachRoutine(plc).length} routine(s).${warn}`;
    },
  },
  {
    name: "esco_export_l5x",
    description: "Export the PLC project to a Studio 5000-style .L5X XML file for review (offline-generated, not controller-verified).",
    inputSchema: obj({ path: str("Target .L5X path.") }, ["path"]),
    handler: (a) => {
      const result = exportL5X(plc);
      writeFileSync(arg(a, "path"), result.xml);
      return `Exported L5X to ${arg(a, "path")}. ${result.evidence.generatedNotice}`;
    },
  },

  // --- Simulation Lab ---
  {
    name: "esco_sim_create",
    description: `Create an offline ESCO Simulation Lab project. processType is one of: ${PROCESS_TYPES.map((p) => p.id).join(", ")}. Seeds devices and logic for that process.`,
    inputSchema: obj({ name: str("Project name."), processType: str(`One of: ${PROCESS_TYPES.map((p) => p.id).join(", ")}.`) }, ["name", "processType"]),
    handler: (a) => {
      const processType = arg(a, "processType") as SimProcessType;
      if (!PROCESS_TYPES.some((p) => p.id === processType)) throw new Error(`Invalid processType. Use one of: ${PROCESS_TYPES.map((p) => p.id).join(", ")}`);
      sim = createSimProject({ name: arg(a, "name") || "Simulation", processType });
      simResults = [];
      return `Created simulation "${sim.name}" (${processType}) — devices ${sim.devices.length}, logic ${sim.logicBlocks.length}, scenarios ${sim.scenarios.length}.`;
    },
  },
  {
    name: "esco_sim_status",
    description: "Summary of the simulation project: devices, virtual tags, logic blocks, scenarios, and validation.",
    inputSchema: obj({}),
    handler: () => {
      const s = requireSim();
      const findings = validateSimProject(s);
      const tags = s.devices.reduce((n, d) => n + d.tags.length, 0);
      return [
        `Simulation "${s.name}" (${s.processType})`,
        `  devices: ${s.devices.map((d) => `${d.tag}:${d.kind}`).join(", ") || "(none)"}`,
        `  virtual tags ${tags} · logic ${s.logicBlocks.length} · scenarios ${s.scenarios.length}`,
        `  validation: ${findings.filter((f) => f.severity === "error").length} error(s), ${findings.filter((f) => f.severity === "warning").length} warning(s)`,
      ].join("\n");
    },
  },
  {
    name: "esco_sim_add_device",
    description: `Add a simulated device. kind is one of: ${DEVICE_KINDS.join(", ")}. Generates virtual tags, alarms, and interlocks.`,
    inputSchema: obj({ kind: str(`One of: ${DEVICE_KINDS.join(", ")}.`), tag: str("Optional device tag prefix (auto if blank)."), name: str("Optional friendly name.") }, ["kind"]),
    handler: (a) => {
      const s = requireSim();
      const kind = arg(a, "kind") as SimDeviceKind;
      if (!DEVICE_KINDS.includes(kind)) throw new Error(`Invalid kind. Use one of: ${DEVICE_KINDS.join(", ")}`);
      const res = addDevice(s, { kind, tag: arg(a, "tag") || undefined, name: arg(a, "name") || undefined });
      if (!res.ok) throw new Error(res.error ?? "addDevice failed.");
      sim = res.project;
      return `Added ${kind} ${res.data?.tag} with ${res.data?.tags.length} virtual tag(s).`;
    },
  },
  {
    name: "esco_sim_add_logic",
    description: `Add an ESCO-owned logic template. kind is one of: ${LOGIC_TEMPLATES.map((t) => t.kind).join(", ")}. params is an optional object of tag/value bindings.`,
    inputSchema: obj({ kind: str(`One of: ${LOGIC_TEMPLATES.map((t) => t.kind).join(", ")}.`), params: optObj() }, ["kind"]),
    handler: (a) => {
      const s = requireSim();
      const kind = arg(a, "kind") as SimLogicTemplateKind;
      if (!LOGIC_TEMPLATES.some((t) => t.kind === kind)) throw new Error(`Invalid kind. Use one of: ${LOGIC_TEMPLATES.map((t) => t.kind).join(", ")}`);
      const draft = structuredClone(s);
      const block = createLogicBlock(draft, kind, asParams(a.params));
      const res = addLogicBlock(draft, block);
      if (!res.ok) throw new Error(res.error ?? "addLogicBlock failed.");
      sim = res.project;
      return `Added logic "${block.name}" (${block.routine.rungs.length} rung(s)).`;
    },
  },
  {
    name: "esco_sim_add_scenario",
    description: `Add a built-in FAT/SAT scenario. kind is one of: ${SCENARIO_TEMPLATES.map((t) => t.kind).join(", ")}.`,
    inputSchema: obj({ kind: str(`One of: ${SCENARIO_TEMPLATES.map((t) => t.kind).join(", ")}.`) }, ["kind"]),
    handler: (a) => {
      const s = requireSim();
      const res = addScenarioFromTemplate(s, arg(a, "kind") as SimScenarioTemplateKind);
      if (!res.ok) throw new Error(res.error ?? "addScenarioFromTemplate failed.");
      sim = res.project;
      return `Added scenario "${res.data?.name}" (id ${res.data?.id}).`;
    },
  },
  {
    name: "esco_sim_list_scenarios",
    description: "List the simulation's scenarios (id, name, template).",
    inputSchema: obj({}),
    handler: () => requireSim().scenarios.map((sc) => `${sc.id}  ${sc.name}  [${sc.templateKind ?? "custom"}]`).join("\n") || "(no scenarios)",
  },
  {
    name: "esco_sim_run_scenario",
    description: "Run one scenario by id (or by template kind) and return pass/fail with the check results and evidence count.",
    inputSchema: obj({ scenarioId: str("Scenario id."), kind: str("Or a template kind to run the first matching scenario.") }),
    handler: (a) => {
      const s = requireSim();
      const id = arg(a, "scenarioId");
      const kind = arg(a, "kind");
      const scenario = id ? s.scenarios.find((x) => x.id === id) : s.scenarios.find((x) => x.templateKind === kind);
      if (!scenario) throw new Error("Scenario not found. Use esco_sim_list_scenarios or add one first.");
      const result = runScenario(s, scenario);
      simResults = [...simResults.filter((r) => r.scenarioId !== scenario.id), result];
      return formatResult(result);
    },
  },
  {
    name: "esco_sim_run_all",
    description: "Run every scenario and return a pass/fail summary.",
    inputSchema: obj({}),
    handler: () => {
      const s = requireSim();
      simResults = s.scenarios.map((sc) => runScenario(s, sc));
      const passed = simResults.filter((r) => r.status === "pass").length;
      return `Ran ${simResults.length} scenario(s): ${passed} passed.\n` +
        simResults.map((r) => `  ${r.status.toUpperCase()}  ${r.scenarioName}  (${r.summary.passed}/${r.summary.total})`).join("\n");
    },
  },
  {
    name: "esco_sim_report",
    description: "Generate the ESCO-native commissioning report from the latest scenario results. Optionally write it to a JSON file.",
    inputSchema: obj({ path: str("Optional path to write the report JSON.") }),
    handler: (a) => {
      const s = requireSim();
      const report = generateSimReport(s, simResults);
      if (arg(a, "path")) writeFileSync(arg(a, "path"), JSON.stringify(report, null, 2));
      return [
        `Report for "${report.project.name}" — status ${report.status.toUpperCase()}`,
        `  devices tested ${report.summary.devices} · virtual tags ${report.summary.tags} · I/O channels ${report.ioChannelsTested.exercised}/${report.ioChannelsTested.total}`,
        `  logic paths ${report.summary.logicBlocks} · alarms proven ${report.alarmsProven.filter((x) => x.proven).length}/${report.alarmsProven.length} · trends ${report.trendsCaptured.length}`,
        `  scenarios ${report.summary.scenariosPassed}/${report.summary.scenarios} passed · checks ${report.summary.checksPassed}/${report.summary.checks} passed`,
        report.failedExpectations.length ? `  failed: ${report.failedExpectations.map((f) => f.description).slice(0, 5).join("; ")}` : `  no failed expectations`,
        arg(a, "path") ? `  written to ${arg(a, "path")}` : ``,
        report.boundary,
      ].filter(Boolean).join("\n");
    },
  },
  {
    name: "esco_sim_save",
    description: "Save the simulation project to an ESCO-native .escosim.json file.",
    inputSchema: obj({ path: str("Target path.") }, ["path"]),
    handler: (a) => {
      writeFileSync(arg(a, "path"), serializeSimProject(requireSim()));
      return `Saved simulation to ${arg(a, "path")}.`;
    },
  },
  {
    name: "esco_sim_open",
    description: "Load a simulation project from an ESCO-native .escosim.json file.",
    inputSchema: obj({ path: str("Path to a .escosim.json file.") }, ["path"]),
    handler: (a) => {
      sim = deserializeSimProject(readFileSync(arg(a, "path"), "utf8"));
      simResults = [];
      return `Opened simulation "${sim.name}" (${sim.processType}) with ${sim.devices.length} device(s).`;
    },
  },
];

function formatResult(result: SimScenarioResult): string {
  const failed = result.checks.filter((c) => !c.passed);
  return [
    `${result.status.toUpperCase()} — ${result.scenarioName} (${result.summary.passed}/${result.summary.total} checks, ${result.scans} scans)`,
    ...result.checks.map((c) => `  ${c.passed ? "✓" : "✗"} ${c.description} — got ${c.actual}`),
    failed.length ? `  ${failed.length} failed expectation(s).` : ``,
    `  evidence entries: ${result.evidence.length}`,
  ].filter(Boolean).join("\n");
}

// ---------------------------------------------------------------------------
// JSON-RPC over stdio
// ---------------------------------------------------------------------------

interface RpcMessage {
  jsonrpc?: string;
  id?: number | string | null;
  method?: string;
  params?: Record<string, unknown>;
}

function send(message: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

async function handle(message: RpcMessage): Promise<void> {
  const { id, method, params } = message;
  const isRequest = id !== undefined && id !== null;

  switch (method) {
    case "initialize":
      send({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: (params?.protocolVersion as string) ?? "2025-06-18",
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
          instructions: `ESCO Automation Studio (offline). Use esco_status first. ${BOUNDARY}`,
        },
      });
      return;
    case "notifications/initialized":
      return; // notification — no response
    case "ping":
      if (isRequest) send({ jsonrpc: "2.0", id, result: {} });
      return;
    case "tools/list":
      send({ jsonrpc: "2.0", id, result: { tools: TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) } });
      return;
    case "tools/call": {
      const name = String(params?.name ?? "");
      const tool = TOOLS.find((t) => t.name === name);
      if (!tool) {
        send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true } });
        return;
      }
      try {
        const text = await tool.handler((params?.arguments as Record<string, unknown>) ?? {});
        if (WRITE_TOOLS.has(name)) broadcastPlc(); // push live edits to the watching Studio
        send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text }] } });
      } catch (error) {
        send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true } });
      }
      return;
    }
    default:
      if (isRequest) send({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } });
      return;
  }
}

function main(): void {
  log(`ESCO MCP server ${SERVER_VERSION} ready (${TOOLS.length} tools). Offline only.`);
  startBridge();
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on("line", (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let message: RpcMessage;
    try {
      message = JSON.parse(trimmed) as RpcMessage;
    } catch {
      log(`Ignoring non-JSON line.`);
      return;
    }
    void handle(message);
  });
  rl.on("close", () => process.exit(0));
}

main();
