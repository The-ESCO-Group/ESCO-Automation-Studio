import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  addDevice as addDeviceAction,
  addHmiScreen as addHmiScreenAction,
  addHmiWidget as addHmiWidgetAction,
  addLogicBlock,
  addScenarioFromTemplate,
  buildCompatReview,
  createCandySorterDemoProject,
  createLogicBlock,
  createSimProject,
  type CreateSimProjectOptions,
  generateSimReport,
  removeDevice as removeDeviceAction,
  removeLogicBlock as removeLogicBlockAction,
  removeScenario as removeScenarioAction,
  runScenario,
  saveReportRef,
  SimEngine,
  type SimAlarmRecord,
  type SimCompatHelperId,
  type SimCompatReview,
  type SimDeviceKind,
  type SimEvidenceEntry,
  type SimFaultKind,
  type SimHistorianSeries,
  type SimHmiWidget,
  type SimLiveTag,
  type SimLogicTemplateKind,
  type SimProject,
  type SimReport,
  type SimScenarioResult,
  type SimScenarioTemplateKind,
  type SimTimelineFrame,
  type SimValidationFinding,
  updateDeviceTag as updateDeviceTagAction,
  validateSimProject,
} from "@esco/sim-lab";
import type { PlcValue } from "@esco/simulator";

export type SimStage = "project" | "onsite" | "devices" | "logic" | "hmi" | "simulation" | "reports" | "help";

export interface SimSelection {
  kind: "controller" | "rack" | "device" | "logic" | "screen" | "scenario" | "report";
  id: string;
}

export interface SimLabApi {
  project: SimProject | null;
  stage: SimStage;
  setStage: (stage: SimStage) => void;
  selection: SimSelection | null;
  select: (selection: SimSelection | null) => void;
  notices: string[];
  pushNotice: (message: string) => void;

  create: (options: CreateSimProjectOptions) => void;
  loadCandySorterDemo: () => void;
  discard: () => void;

  addDevice: (kind: SimDeviceKind, tag?: string, name?: string) => void;
  removeDevice: (id: string) => void;
  setTagUnits: (deviceId: string, tagId: string, units: string) => void;
  setTagScaling: (deviceId: string, tagId: string, scaling: { rawMin: number; rawMax: number; euMin: number; euMax: number }) => void;

  addLogic: (kind: SimLogicTemplateKind, params: Record<string, string>, name?: string) => void;
  removeLogic: (id: string) => void;

  addScreen: (name: string) => void;
  addWidget: (screenId: string, widget: Omit<SimHmiWidget, "id">) => void;

  addScenario: (kind: SimScenarioTemplateKind) => void;
  removeScenario: (id: string) => void;
  results: SimScenarioResult[];
  runOne: (scenarioId: string) => void;
  runAll: () => void;

  findings: SimValidationFinding[];

  // interactive engine
  engineReady: boolean;
  scan: number;
  timeMs: number;
  running: boolean;
  buildEngine: () => void;
  engineReset: () => void;
  step: () => void;
  runScans: (n: number) => void;
  toggleRun: () => void;
  setBool: (tag: string, value: boolean) => void;
  setTag: (tag: string, value: PlcValue, force?: boolean) => void;
  clearForce: (tag: string) => void;
  injectFault: (deviceId: string, fault: SimFaultKind) => void;
  clearFault: (deviceId: string) => void;
  activeFault: (deviceId: string) => SimFaultKind | undefined;
  ackAlarms: () => void;
  liveTags: SimLiveTag[];
  alarms: SimAlarmRecord[];
  timeline: SimTimelineFrame[];
  events: SimEvidenceEntry[];
  historian: SimHistorianSeries[];
  hmiPress: (tag: string, value: PlcValue, label: string) => void;

  // report + compat
  report: SimReport | null;
  generateReport: () => void;
  compat: SimCompatReview | null;
  buildCompat: (helper: SimCompatHelperId) => void;
}

export function useSimLab(): SimLabApi {
  const [project, setProject] = useState<SimProject | null>(null);
  const [stage, setStage] = useState<SimStage>("project");
  const [selection, setSelection] = useState<SimSelection | null>(null);
  const [notices, setNotices] = useState<string[]>([]);
  const [results, setResults] = useState<SimScenarioResult[]>([]);
  const [report, setReport] = useState<SimReport | null>(null);
  const [compat, setCompat] = useState<SimCompatReview | null>(null);

  const engineRef = useRef<SimEngine | null>(null);
  const builtFromRef = useRef<string>("");
  const [running, setRunning] = useState(false);
  const [, setTick] = useState(0);
  const bump = useCallback(() => setTick((t) => t + 1), []);

  const pushNotice = useCallback((message: string) => {
    setNotices((prev) => [message, ...prev].slice(0, 8));
  }, []);

  const apply = useCallback(
    (result: { ok: boolean; project?: SimProject; error?: string }, success?: string) => {
      if (result.ok && result.project) {
        setProject(result.project);
        if (success) pushNotice(success);
      } else if (!result.ok && result.error) {
        pushNotice(`⚠ ${result.error}`);
      }
    },
    [pushNotice],
  );

  // ---- project ----------------------------------------------------------
  const loadProject = useCallback(
    (next: SimProject, success: string, nextStage: SimStage = "devices") => {
      setProject(next);
      setResults([]);
      setReport(null);
      setCompat(null);
      engineRef.current = null;
      builtFromRef.current = "";
      setRunning(false);
      setSelection({ kind: "controller", id: next.controller.id });
      setStage(nextStage);
      pushNotice(success);
    },
    [pushNotice],
  );

  const create = useCallback(
    (options: CreateSimProjectOptions) => {
      const next = createSimProject(options);
      loadProject(next, `Created offline simulation project "${next.name}".`, "devices");
    },
    [loadProject],
  );

  const loadCandySorterDemo = useCallback(
    () => {
      const next = createCandySorterDemoProject();
      loadProject(
        next,
        `Loaded mock candy sorter project "${next.name}" with ${next.scenarios.length} ready scenario(s).`,
        "simulation",
      );
    },
    [loadProject],
  );

  const discard = useCallback(() => {
    setProject(null);
    setResults([]);
    setReport(null);
    setCompat(null);
    engineRef.current = null;
    setStage("project");
    setSelection(null);
  }, []);

  // ---- devices ----------------------------------------------------------
  const addDevice = useCallback(
    (kind: SimDeviceKind, tag?: string, name?: string) => {
      if (!project) return;
      apply(addDeviceAction(project, { kind, tag, name }), `Added ${kind} ${tag ?? ""}.`.trim());
    },
    [project, apply],
  );
  const removeDevice = useCallback(
    (id: string) => {
      if (!project) return;
      apply(removeDeviceAction(project, id), "Removed device.");
    },
    [project, apply],
  );
  const setTagUnits = useCallback(
    (deviceId: string, tagId: string, units: string) => {
      if (!project) return;
      apply(updateDeviceTagAction(project, deviceId, tagId, { units }), "Updated units.");
    },
    [project, apply],
  );
  const setTagScaling = useCallback(
    (deviceId: string, tagId: string, scaling: { rawMin: number; rawMax: number; euMin: number; euMax: number }) => {
      if (!project) return;
      apply(updateDeviceTagAction(project, deviceId, tagId, { scaling }), "Updated scaling.");
    },
    [project, apply],
  );

  // ---- logic ------------------------------------------------------------
  const addLogic = useCallback(
    (kind: SimLogicTemplateKind, params: Record<string, string>, name?: string) => {
      if (!project) return;
      const draft = structuredClone(project);
      const block = createLogicBlock(draft, kind, params, name);
      apply(addLogicBlock(draft, block), `Added logic "${block.name}".`);
    },
    [project, apply],
  );
  const removeLogic = useCallback(
    (id: string) => {
      if (!project) return;
      apply(removeLogicBlockAction(project, id), "Removed logic block.");
    },
    [project, apply],
  );

  // ---- hmi --------------------------------------------------------------
  const addScreen = useCallback(
    (name: string) => {
      if (!project) return;
      apply(addHmiScreenAction(project, name), `Added screen "${name}".`);
    },
    [project, apply],
  );
  const addWidget = useCallback(
    (screenId: string, widget: Omit<SimHmiWidget, "id">) => {
      if (!project) return;
      apply(addHmiWidgetAction(project, screenId, widget), "Added widget.");
    },
    [project, apply],
  );

  // ---- scenarios --------------------------------------------------------
  const addScenario = useCallback(
    (kind: SimScenarioTemplateKind) => {
      if (!project) return;
      apply(addScenarioFromTemplate(project, kind), "Added scenario.");
    },
    [project, apply],
  );
  const removeScenario = useCallback(
    (id: string) => {
      if (!project) return;
      apply(removeScenarioAction(project, id), "Removed scenario.");
      setResults((prev) => prev.filter((r) => r.scenarioId !== id));
    },
    [project, apply],
  );
  const runOne = useCallback(
    (scenarioId: string) => {
      if (!project) return;
      const scenario = project.scenarios.find((s) => s.id === scenarioId);
      if (!scenario) return;
      const result = runScenario(project, scenario);
      setResults((prev) => [...prev.filter((r) => r.scenarioId !== scenarioId), result]);
      pushNotice(`Scenario "${scenario.name}": ${result.status.toUpperCase()} (${result.summary.passed}/${result.summary.total}).`);
    },
    [project, pushNotice],
  );
  const runAll = useCallback(() => {
    if (!project) return;
    const all = project.scenarios.map((s) => runScenario(project, s));
    setResults(all);
    const passed = all.filter((r) => r.status === "pass").length;
    pushNotice(`Ran ${all.length} scenario(s): ${passed} passed.`);
  }, [project, pushNotice]);

  // ---- interactive engine ----------------------------------------------
  const buildEngine = useCallback(() => {
    if (!project) return;
    engineRef.current = new SimEngine(project);
    builtFromRef.current = project.updatedAtLabel;
    setRunning(false);
    bump();
  }, [project, bump]);

  // Auto-build when entering the simulation stage with a stale/absent engine.
  useEffect(() => {
    if (stage !== "simulation" || !project) return;
    if (!engineRef.current || builtFromRef.current !== project.updatedAtLabel) {
      engineRef.current = new SimEngine(project);
      builtFromRef.current = project.updatedAtLabel;
      setRunning(false);
      bump();
    }
  }, [stage, project, bump]);

  const engineReset = useCallback(() => {
    engineRef.current?.reset();
    setRunning(false);
    bump();
  }, [bump]);
  const step = useCallback(() => {
    engineRef.current?.stepScan();
    bump();
  }, [bump]);
  const runScans = useCallback(
    (n: number) => {
      engineRef.current?.run(n);
      bump();
    },
    [bump],
  );
  const toggleRun = useCallback(() => setRunning((r) => !r), []);

  // Continuous run loop (deterministic batches; UI cadence only).
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => {
      engineRef.current?.run(10);
      bump();
    }, 120);
    return () => window.clearInterval(id);
  }, [running, bump]);

  const setBool = useCallback(
    (tag: string, value: boolean) => {
      engineRef.current?.setTag(tag, value);
      bump();
    },
    [bump],
  );
  const forceTag = useCallback(
    (tag: string, value: PlcValue, force = true) => {
      engineRef.current?.setTag(tag, value, { force });
      bump();
    },
    [bump],
  );
  const clearTagForce = useCallback(
    (tag: string) => {
      engineRef.current?.clearForce(tag);
      bump();
    },
    [bump],
  );
  const injectFault = useCallback(
    (deviceId: string, fault: SimFaultKind) => {
      const res = engineRef.current?.injectFault(deviceId, fault);
      if (res && !res.ok) pushNotice(`⚠ ${res.error}`);
      bump();
    },
    [bump, pushNotice],
  );
  const clearFault = useCallback(
    (deviceId: string) => {
      engineRef.current?.clearFault(deviceId);
      bump();
    },
    [bump],
  );
  const ackAlarms = useCallback(() => {
    engineRef.current?.operatorAck();
    bump();
  }, [bump]);
  const hmiPress = useCallback(
    (tag: string, value: PlcValue, label: string) => {
      engineRef.current?.setTag(tag, value);
      engineRef.current?.recordHmiEvent(label);
      bump();
    },
    [bump],
  );

  const engine = engineRef.current;
  const liveTags = engine ? engine.liveTags() : [];
  const alarms = engine ? engine.alarms() : [];
  const timeline = engine ? engine.timeline() : [];
  const events = engine ? engine.events() : [];
  const historian = engine ? engine.historian() : [];

  // ---- report + compat --------------------------------------------------
  const generateReport = useCallback(() => {
    if (!project) return;
    const r = generateSimReport(project, results);
    setReport(r);
    const saved = saveReportRef(project, r);
    setProject(saved.project);
    pushNotice(`Generated test report (${r.status.toUpperCase()}).`);
  }, [project, results, pushNotice]);

  const buildCompat = useCallback(
    (helper: SimCompatHelperId) => {
      if (!project) return;
      setCompat(buildCompatReview(project, helper));
    },
    [project],
  );

  const findings = useMemo(() => (project ? validateSimProject(project) : []), [project]);

  return {
    project,
    stage,
    setStage,
    selection,
    select: setSelection,
    notices,
    pushNotice,
    create,
    loadCandySorterDemo,
    discard,
    addDevice,
    removeDevice,
    setTagUnits,
    setTagScaling,
    addLogic,
    removeLogic,
    addScreen,
    addWidget,
    addScenario,
    removeScenario,
    results,
    runOne,
    runAll,
    findings,
    engineReady: !!engine,
    scan: engine?.scan ?? 0,
    timeMs: engine?.timeMs ?? 0,
    running,
    buildEngine,
    engineReset,
    step,
    runScans,
    toggleRun,
    setBool,
    setTag: forceTag,
    clearForce: clearTagForce,
    injectFault,
    clearFault,
    activeFault: (deviceId: string) => engine?.activeFault(deviceId),
    ackAlarms,
    liveTags,
    alarms,
    timeline,
    events,
    historian,
    hmiPress,
    report,
    generateReport,
    compat,
    buildCompat,
  };
}
