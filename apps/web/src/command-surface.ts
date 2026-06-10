import type { ControllerCommandKind } from "@esco/controller-comm";
import { escoControllerCommandCapability } from "./escoCapabilityMap";

export const ESCO_COMMAND_SURFACE_KINDS = [
  "offline-action",
  "offline-navigation",
  "simulation-action",
  "gateway-online",
  "review-import-export",
  "guarded-hardware",
  "informational",
] as const;

export type EscoCommandSurfaceKind = (typeof ESCO_COMMAND_SURFACE_KINDS)[number];

export const ESCO_COMMAND_SURFACE_KIND_LABELS: Record<EscoCommandSurfaceKind, string> = {
  "offline-action": "Offline action",
  "offline-navigation": "Offline navigation",
  "simulation-action": "Simulation action",
  "gateway-online": "Gateway online",
  "review-import-export": "Review/import/export",
  "guarded-hardware": "Guarded hardware",
  informational: "Informational",
};

export interface EscoCommandSurfaceEntry {
  id: string;
  surface: "Ribbon menu" | "Ribbon toolbar" | "Path/status bar" | "Organizer context" | "Editor context";
  group: string;
  label: string;
  kind: EscoCommandSurfaceKind;
  actionPath: string;
  controllerCommandKind?: ControllerCommandKind;
}

type EscoCommandSurfaceTuple = [
  label: string,
  kind: EscoCommandSurfaceKind,
  actionPath: string,
  controllerCommandKind?: ControllerCommandKind,
];

export interface EscoCommandSurfaceGroupSummary {
  key: string;
  surface: EscoCommandSurfaceEntry["surface"];
  group: string;
  total: number;
  offline: number;
  review: number;
  simulation: number;
  gatewayOnline: number;
  guarded: number;
  informational: number;
}

const menu = (
  group: string,
  entries: EscoCommandSurfaceTuple[],
): EscoCommandSurfaceEntry[] =>
  entries.map(([label, kind, actionPath, controllerCommandKind]) => ({
    id: `ribbon-menu:${group}:${label}`,
    surface: "Ribbon menu",
    group,
    label,
    kind,
    actionPath,
    ...(controllerCommandKind ? { controllerCommandKind } : {}),
  }));

const toolbar = (
  group: string,
  entries: EscoCommandSurfaceTuple[],
): EscoCommandSurfaceEntry[] =>
  entries.map(([label, kind, actionPath, controllerCommandKind]) => ({
    id: `ribbon-toolbar:${group}:${label}`,
    surface: group === "Path/status bar" ? "Path/status bar" : "Ribbon toolbar",
    group,
    label,
    kind,
    actionPath,
    ...(controllerCommandKind ? { controllerCommandKind } : {}),
  }));

const organizer = (
  group: string,
  entries: EscoCommandSurfaceTuple[],
): EscoCommandSurfaceEntry[] =>
  entries.map(([label, kind, actionPath, controllerCommandKind]) => ({
    id: `organizer-context:${group}:${label}`,
    surface: "Organizer context",
    group,
    label,
    kind,
    actionPath,
    ...(controllerCommandKind ? { controllerCommandKind } : {}),
  }));

const editorContext = (group: string, entries: EscoCommandSurfaceTuple[]): EscoCommandSurfaceEntry[] =>
  entries.map(([label, kind, actionPath, controllerCommandKind]) => ({
    id: `editor-context:${group}:${label}`,
    surface: "Editor context",
    group,
    label,
    kind,
    actionPath,
    ...(controllerCommandKind ? { controllerCommandKind } : {}),
  }));

export const ESCO_COMMAND_SURFACE_AUDIT: readonly EscoCommandSurfaceEntry[] = [
  ...menu("File", [
    ["New ESCO Project", "offline-action", "App.handleCreateRoutineProject/open new-project dialog"],
    ["Open ESCO Project", "review-import-export", "App.handleImportClick"],
    ["Import L5X (Legacy Review)", "review-import-export", "App.handleImportL5XClick"],
    ["Save ESCO Project", "review-import-export", "App.handleExport"],
    ["Save ESCO Project As", "review-import-export", "App.handleSaveAs"],
    ["Export L5X (Review Only)", "review-import-export", "App.handleExportL5X"],
    ["Build ESCO Runtime", "review-import-export", "App.handleBuildRuntime"],
    ["Export ESCO Runtime", "review-import-export", "App.handleExportRuntime"],
    ["Import ESCO Runtime", "review-import-export", "App.handleImportRuntimeClick"],
    ["Download Runtime to ESCO SoftController", "simulation-action", "App.handleSoftControllerDownloadRuntime"],
    ["Open ESCO SoftController Upload", "simulation-action", "BottomPanel controller tab / SoftController upload preview"],
    ["Export ESCO Snapshot", "review-import-export", "App.handleExportSnapshot"],
    ["Import ESCO Snapshot", "review-import-export", "App.handleImportSnapshotClick"],
    ["Export ESCO Library", "review-import-export", "App.handleExportLibrary"],
    ["Export ESCO Exchange", "review-import-export", "App.handleExportExchange"],
    ["Import ESCO Exchange", "review-import-export", "App.handleImportExchangeClick"],
    ["Export ESCO Package", "review-import-export", "App.handleExportPackage"],
    ["Import ESCO Package", "review-import-export", "App.handleImportPackageClick"],
    ["Validate ESCO Package / Runtime Files", "review-import-export", "App.handleValidateEscoArtifactClick"],
    ["Project Properties", "offline-action", "App.handleSaveProjectProperties"],
    ["Controller Properties", "offline-action", "App.handleSaveControllerProperties"],
    ["Close", "offline-action", "App.handleClose"],
  ]),
  ...menu("Edit", [
    ["Undo", "offline-action", "App.handleUndo"],
    ["Redo", "offline-action", "App.handleRedo"],
    ["Cut", "offline-action", "App.handleCutRung"],
    ["Copy", "offline-action", "App.handleCopyRung"],
    ["Paste", "offline-action", "App.handlePasteRung"],
    ["Find", "offline-navigation", "App.handleFind"],
    ["Find Next", "offline-navigation", "App.handleFindNext"],
    ["Find Previous", "offline-navigation", "App.handleFindPrevious"],
  ]),
  ...menu("View", [
    ["Controller Organizer", "offline-navigation", "Ribbon.focusControllerOrganizer"],
    ["Controller Tags", "offline-navigation", "App.setView(tags)"],
    ["HMI Designer", "offline-navigation", "App.setView(hmi)"],
    ["Controller Status", "offline-navigation", "BottomPanel controller tab"],
    ["Model Summary", "offline-navigation", "BottomPanel model tab"],
    ["Task Monitor", "simulation-action", "BottomPanel tasks tab"],
    ["ESCO Simulation Lab", "simulation-action", "App.setView(simulation)"],
    ["ESCO Online (Gateway)", "gateway-online", "App.setView(esco-online)"],
    ["Watch", "simulation-action", "BottomPanel watch tab"],
    ["Trend", "simulation-action", "BottomPanel trend tab"],
    ["Forces", "simulation-action", "BottomPanel forces tab"],
    ["Compare", "offline-navigation", "App.setView(compare)"],
    ["Project History", "offline-navigation", "App.handleProjectHistory"],
    ["Errors", "offline-navigation", "BottomPanel diagnostics tab"],
  ]),
  ...menu("Search", [
    ["Find", "offline-navigation", "App.handleFind"],
    ["Find Next", "offline-navigation", "App.handleFindNext"],
    ["Find Previous", "offline-navigation", "App.handleFindPrevious"],
    ["Cross Reference", "offline-navigation", "BottomPanel references tab"],
  ]),
  ...menu("Logic", [
    ["Verify Controller", "offline-action", "App.handleVerify"],
    ["Add Rung", "offline-action", "App.handleAddRung"],
    ["Examine On (XIC)", "offline-action", "App.handleInsertInstructionType(XIC)"],
    ["Examine Off (XIO)", "offline-action", "App.handleInsertInstructionType(XIO)"],
    ["One Shot (ONS)", "offline-action", "App.handleInsertInstructionType(ONS)"],
    ["Output Energize (OTE)", "offline-action", "App.handleInsertInstructionType(OTE)"],
    ["Timer On Delay (TON)", "offline-action", "App.handleInsertInstructionType(TON)"],
    ["Retentive Timer On (RTO)", "offline-action", "App.handleInsertInstructionType(RTO)"],
    ["Count Up (CTU)", "offline-action", "App.handleInsertInstructionType(CTU)"],
    ["Count Down (CTD)", "offline-action", "App.handleInsertInstructionType(CTD)"],
  ]),
  ...menu("Communications", [
    ["Controller Route Browser", "guarded-hardware", "Controller session guard/audit", "network-browser"],
    ["Saved Controller Path", "guarded-hardware", "Controller session guard/audit", "select-recent-path"],
    ["Go Online", "guarded-hardware", "Controller session guard/audit", "go-online"],
    ["Monitor", "guarded-hardware", "Controller session guard/audit", "monitor"],
    ["Upload", "guarded-hardware", "Controller session guard/audit", "upload"],
    ["Download", "guarded-hardware", "Controller session guard/audit", "download"],
    ["Run Mode", "guarded-hardware", "Controller session guard/audit", "run-mode"],
    ["Program Mode", "guarded-hardware", "Controller session guard/audit", "program-mode"],
    ["Test Mode", "guarded-hardware", "Controller session guard/audit", "test-mode"],
    ["Clear Faults", "guarded-hardware", "Controller session guard/audit", "clear-faults"],
    ["Go To Faults", "guarded-hardware", "Controller session guard/audit", "go-to-faults"],
    ["Test Edits", "guarded-hardware", "Controller session guard/audit", "test-edits"],
    ["Assemble Edits", "guarded-hardware", "Controller session guard/audit", "assemble-edits"],
    ["Finalize All Edits", "guarded-hardware", "Controller session guard/audit", "finalize-edits"],
    ["Cancel Edits", "guarded-hardware", "Controller session guard/audit", "cancel-edits"],
    ["Select Virtual Path", "simulation-action", "VirtualController.beginBrowsing"],
    ["Go Online (Virtual)", "simulation-action", "VirtualController.goOnline"],
    ["Monitor (Virtual)", "simulation-action", "VirtualController.monitor"],
    ["Download to ESCO Virtual Controller", "simulation-action", "VirtualController.download"],
    ["Upload from ESCO Virtual Controller", "simulation-action", "VirtualController.upload"],
    ["Program Mode (Virtual)", "simulation-action", "VirtualController.setMode(program)"],
    ["Run Mode (Virtual)", "simulation-action", "VirtualController.setMode(run)"],
    ["Clear Faults (Virtual)", "simulation-action", "VirtualController.clearFaults"],
    ["Go Offline (Virtual)", "simulation-action", "VirtualController.goOffline"],
    ["Go Offline", "simulation-action", "Controller session offline state", "go-offline"],
  ]),
  ...menu("Tools", [
    ["Cross Reference", "offline-navigation", "BottomPanel references tab"],
    ["Compare", "offline-navigation", "App.setView(compare)"],
    ["Diagnostics", "offline-navigation", "BottomPanel diagnostics tab"],
    ["Task Monitor", "simulation-action", "BottomPanel tasks tab"],
    ["Trend", "simulation-action", "BottomPanel trend tab"],
    ["Import Tags", "review-import-export", "App.handleImportTagsCsvClick"],
    ["Export Tags", "review-import-export", "App.handleExportTagsCsv"],
    ["Git", "offline-navigation", "App.handleGit"],
    ["Properties", "offline-action", "App.handleProperties"],
  ]),
  ...menu("Window", [
    ["Main Window", "offline-navigation", "App.handleMainWindow"],
    ["Controller Tags", "offline-navigation", "App.setView(tags)"],
    ["Controller Status", "offline-navigation", "BottomPanel controller tab"],
    ["Model Summary", "offline-navigation", "BottomPanel model tab"],
    ["Diagnostics", "offline-navigation", "BottomPanel diagnostics tab"],
    ["Cross Reference", "offline-navigation", "BottomPanel references tab"],
    ["Watch", "simulation-action", "BottomPanel watch tab"],
    ["Forces", "simulation-action", "BottomPanel forces tab"],
    ["Trend", "simulation-action", "BottomPanel trend tab"],
    ["Task Monitor", "simulation-action", "BottomPanel tasks tab"],
  ]),
  ...menu("Help", [
    ["Help Contents", "offline-navigation", "App.handleHelpContents"],
    ["About ESCO Automation Studio", "informational", "App.handleAbout"],
  ]),
  ...toolbar("Standard toolbar", [
    ["New", "offline-action", "App.handleCreateRoutineProject/open new-project dialog"],
    ["Open", "review-import-export", "App.handleImportClick"],
    ["Save", "review-import-export", "App.handleExport"],
    ["Save As", "review-import-export", "App.handleSaveAs"],
    ["Cut", "offline-action", "App.handleCutRung"],
    ["Copy", "offline-action", "App.handleCopyRung"],
    ["Paste", "offline-action", "App.handlePasteRung"],
    ["Undo", "offline-action", "App.handleUndo"],
    ["Redo", "offline-action", "App.handleRedo"],
    ["Find", "offline-navigation", "App.handleFind"],
    ["Close", "offline-action", "App.handleClose"],
    ["Browse Path", "guarded-hardware", "Controller session guard/audit", "network-browser"],
    ["Controller communications", "offline-navigation", "BottomPanel controller tab"],
    ["Verify project", "offline-action", "App.handleVerify"],
    ["Controller organizer view", "offline-navigation", "Ribbon.focusControllerOrganizer"],
    ["Simulation lab", "simulation-action", "App.setView(simulation)"],
  ]),
  ...toolbar("Online toolbar", [
    ["Set Path", "gateway-online", "ESCO Online gateway path setup"],
    ["Go Online", "gateway-online", "ESCO Online read-only connect"],
    ["Go Offline", "gateway-online", "ESCO Online disconnect"],
    ["Upload Snapshot", "gateway-online", "ESCO Online upload snapshot"],
    ["Download", "guarded-hardware", "Controller session guard/audit", "download"],
    ["Compare", "gateway-online", "ESCO Online match check"],
    ["Read Tags", "gateway-online", "ESCO Online Tag Monitor"],
    ["Watch Tags", "gateway-online", "ESCO Online watch list"],
    ["Faults", "gateway-online", "ESCO Online fault/status view"],
    ["Controller Status", "gateway-online", "ESCO Online controller status"],
  ]),
  ...toolbar("Path/status bar", [
    ["RUN status", "guarded-hardware", "Controller session guard/audit", "run-mode"],
    ["Verify controller status", "offline-action", "App.handleVerify + diagnostics tab"],
    ["Battery diagnostics", "guarded-hardware", "Controller session guard/audit", "go-to-faults"],
    ["I/O communication browser", "guarded-hardware", "Controller session guard/audit", "network-browser"],
    ["Communication path", "guarded-hardware", "Controller session guard/audit", "select-recent-path"],
    ["Offline status", "offline-navigation", "BottomPanel controller tab"],
    ["Forces status", "simulation-action", "BottomPanel forces tab"],
    ["Edit state", "guarded-hardware", "Controller session guard/audit", "test-edits"],
  ]),
  ...toolbar("Instruction toolbar", [
    ["Branch start/leg", "offline-action", "App.handleAddBranch/App.handleAddBranchLeg"],
    ["Branch end", "informational", "Graphical rung structure manages branch termination"],
    ["Favorite instructions", "offline-action", "App.handleInsertInstructionType"],
    ["Instruction categories", "offline-navigation", "Ribbon instruction category picker"],
  ]),
  ...editorContext("Instruction", [
    ["Edit Operand...", "offline-action", "EditorArea.setRoutineCommand(operand)"],
    ["Create Tag from Operand...", "offline-action", "App.handleCreateTagFromOperand"],
    ["Add Parallel Branch", "offline-action", "EditorArea.onAddParallelBranch"],
    ["Insert Instruction Before...", "offline-action", "EditorArea.onInsertInstruction(before)"],
    ["Insert Instruction After...", "offline-action", "EditorArea.onInsertInstruction(after)"],
    ["Add Ladder Element...", "offline-action", "EditorArea.onAddLadderElement"],
    ["Edit Tag Properties...", "offline-action", "App.handleEditTagProperties"],
    ["Watch Tag", "simulation-action", "App.handleWatchTag"],
    ["Toggle Bit", "simulation-action", "App.handleToggleBit"],
    ["Trend", "simulation-action", "App.handleTrendTag"],
    ["Cross Reference", "offline-navigation", "App.handleCrossReferenceTag"],
    ["Force Value", "simulation-action", "App.handleForceTag"],
    ["Unforce", "simulation-action", "App.handleUnforceTag"],
    ["Instruction Help", "offline-navigation", "App.handleInstructionHelp"],
    ["Delete Instruction", "offline-action", "EditorArea.onRemoveInstruction"],
  ]),
  ...editorContext("Rung", [
    ["Insert Rung Above", "offline-action", "EditorArea.onInsertRung(above)"],
    ["Insert Rung Below", "offline-action", "EditorArea.onInsertRung(below)"],
    ["Add Ladder Element...", "offline-action", "EditorArea.onAddLadderElement"],
    ["Edit Rung Comment...", "offline-action", "EditorArea.setRoutineCommand(comment)"],
    ["Duplicate Rung", "offline-action", "App.handleDuplicateRung"],
    ["Copy Rung", "offline-action", "App.handleCopyRung"],
    ["Cut Rung", "offline-action", "App.handleCutRung"],
    ["Paste Rung", "offline-action", "App.handlePasteRung"],
    ["Paste Rung Above", "offline-action", "EditorArea.onPasteRungRelative(above)"],
    ["Paste Rung Below", "offline-action", "EditorArea.onPasteRungRelative(below)"],
    ["Add Parallel Branch", "offline-action", "EditorArea.onAddParallelBranch"],
    ["Add Branch Leg", "offline-action", "EditorArea.onAddBranchLeg"],
    ["Remove Branch Leg", "offline-action", "LadderView.onRemoveBranchLeg"],
    ["Verify Rung", "offline-action", "App.handleVerifyRung"],
    ["Cross Reference Rung", "offline-navigation", "App.handleCrossReferenceRung"],
    ["Test Edits", "guarded-hardware", "Controller session guard/audit", "test-edits"],
    ["Assemble Edits", "guarded-hardware", "Controller session guard/audit", "assemble-edits"],
    ["Finalize All Edits", "guarded-hardware", "Controller session guard/audit", "finalize-edits"],
    ["Cancel Edits", "guarded-hardware", "Controller session guard/audit", "cancel-edits"],
    ["Delete Rung", "offline-action", "App.handleDeleteRung"],
  ]),
  ...organizer("Panel header", [
    ["Controller Tree", "offline-navigation", "ProjectExplorer.switchOrganizerTab(controllers)"],
    ["HMI Project", "offline-navigation", "ProjectExplorer.switchOrganizerTab(hmi)"],
    ["Assets", "offline-navigation", "ProjectExplorer.switchOrganizerTab(assets)"],
    ["Library", "offline-navigation", "ProjectExplorer.switchOrganizerTab(library)"],
    ["Pin Organizer", "offline-action", "ProjectExplorer panelPinned state"],
    ["Hide Organizer", "offline-action", "ProjectExplorer panelHidden state"],
    ["Reset Organizer View", "offline-action", "ProjectExplorer panel view reset"],
  ]),
  ...organizer("Controller", [
    ["Controller Properties", "offline-action", "App.handleControllerProperties"],
    ["Controller Tags", "offline-navigation", "ProjectExplorer selection"],
    ["New Tag", "offline-action", "App.handleOpenNewTagDialog"],
    ["New Task", "offline-action", "App.handleNewTask"],
    ["New Program", "offline-action", "App.handleNewProgram"],
    ["Import Program", "review-import-export", "App.handleImportProgramClick"],
    ["New Routine", "offline-action", "App.handleNewRoutine"],
    ["Verify Controller", "offline-action", "App.handleVerify"],
    ["Task Monitor", "simulation-action", "App.handleMonitorTasks"],
    ["Import Controller", "review-import-export", "App.handleImportControllerComponentClick"],
    ["Export Controller", "review-import-export", "App.handleExportControllerComponent"],
    ["Go Online", "guarded-hardware", "Controller session guard/audit", "go-online"],
    ["Upload", "guarded-hardware", "Controller session guard/audit", "upload"],
    ["Download", "guarded-hardware", "Controller session guard/audit", "download"],
    ["Set Path", "guarded-hardware", "Controller session guard/audit", "select-recent-path"],
    ["Controller Route Browser", "guarded-hardware", "Controller session guard/audit", "network-browser"],
    ["Select Virtual Path", "simulation-action", "VirtualController.beginBrowsing"],
    ["Go Online (Virtual)", "simulation-action", "VirtualController.goOnline"],
    ["Monitor (Virtual)", "simulation-action", "VirtualController.monitor"],
    ["Download to ESCO Virtual Controller", "simulation-action", "VirtualController.download"],
    ["Upload from ESCO Virtual Controller", "simulation-action", "VirtualController.upload"],
    ["Program Mode (Virtual)", "simulation-action", "VirtualController.setMode(program)"],
    ["Run Mode (Virtual)", "simulation-action", "VirtualController.setMode(run)"],
    ["Clear Faults (Virtual)", "simulation-action", "VirtualController.clearFaults"],
    ["Go Offline (Virtual)", "simulation-action", "VirtualController.goOffline"],
    ["Download Runtime to ESCO SoftController", "simulation-action", "App.handleSoftControllerDownloadRuntime"],
    ["Open ESCO SoftController Upload", "simulation-action", "BottomPanel controller tab / SoftController upload preview"],
  ]),
  ...organizer("Tags", [
    ["Open", "offline-navigation", "ProjectExplorer selection"],
    ["New Tag", "offline-action", "App.handleOpenNewTagDialog"],
    ["Edit Tags", "offline-navigation", "ProjectExplorer selection"],
    ["Monitor Tags", "simulation-action", "App.handleMonitorTags"],
    ["Import Tags", "review-import-export", "App.handleImportTagsCsvClick"],
    ["Import Tag Component", "review-import-export", "App.handleImportTagComponentClick"],
    ["Export Tags", "review-import-export", "App.handleExportTagsCsv"],
    ["Export Tag Component", "review-import-export", "App.handleExportTagComponent"],
  ]),
  ...organizer("Tasks and programs", [
    ["New Task", "offline-action", "App.handleNewTask"],
    ["Import Task", "review-import-export", "App.handleImportTaskClick"],
    ["Monitor Tasks", "simulation-action", "App.handleMonitorTasks"],
    ["Task Properties", "offline-action", "App.handleTaskProperties"],
    ["Add New Program", "offline-action", "App.handleNewProgram"],
    ["Add Existing Program", "offline-action", "App.handleScheduleExistingProgram"],
    ["Export Task", "review-import-export", "App.handleExportTaskComponent"],
    ["Inhibit Task", "offline-action", "App.handleToggleTaskInhibit"],
    ["Delete Task", "offline-action", "App.handleDeleteTask"],
    ["Program Properties", "offline-action", "App.handleProgramProperties"],
    ["Program Tags", "offline-navigation", "ProjectExplorer selection"],
    ["Add New Routine", "offline-action", "App.handleNewRoutine"],
    ["Import Routine", "review-import-export", "App.handleImportRoutineClick"],
    ["Verify Program", "offline-action", "App.handleVerifyProgram"],
    ["Export Program", "review-import-export", "App.handleExportProgramComponent"],
    ["Delete Program", "offline-action", "App.handleDeleteProgram"],
    ["Open Routine", "offline-navigation", "ProjectExplorer selection"],
    ["Routine Properties", "offline-action", "App.handleRoutineProperties"],
    ["Verify Routine", "offline-action", "App.handleVerifyRoutine"],
    ["Cross Reference Routine", "offline-navigation", "App.handleCrossReferenceRoutine"],
    ["Export Routine", "review-import-export", "App.handleExportRoutineComponent"],
    ["Delete Routine", "offline-action", "App.handleDeleteRoutine"],
  ]),
  ...organizer("Assets", [
    ["New Add-On Instruction", "offline-action", "App.handleNewAddOnInstruction"],
    ["Import Add-On Instruction", "review-import-export", "App.handleImportComponentClick(aoi)"],
    ["Export Add-On Instructions", "review-import-export", "App.handleExportAddOnInstructions"],
    ["Open AOI Definition", "offline-navigation", "ProjectExplorer selection"],
    ["AOI Signature / Source Protection", "offline-navigation", "ProjectExplorer selection"],
    ["Export Custom Instruction", "review-import-export", "App.handleExportCustomInstructionComponent"],
    ["Delete AOI", "offline-action", "App.handleDeleteAoi"],
    ["New Data Type", "offline-action", "App.handleNewDataType"],
    ["Import Data Type", "review-import-export", "App.handleImportComponentClick(udt)"],
    ["Export Data Types", "review-import-export", "App.handleExportDataTypes"],
    ["Open UDT Definition", "offline-navigation", "ProjectExplorer selection"],
    ["Export Data Type", "review-import-export", "App.handleExportDataTypeComponent"],
    ["Delete UDT", "offline-action", "App.handleDeleteUdt"],
    ["New Trend", "offline-action", "App.handleNewTrend"],
    ["Import Trend", "review-import-export", "App.handleImportComponentClick(trend)"],
    ["Export Trends", "review-import-export", "App.handleExportTrends"],
    ["Trend Properties", "offline-action", "App.handleTrendProperties"],
    ["Export Trend", "review-import-export", "App.handleExportTrend"],
    ["Delete Trend", "offline-action", "App.handleDeleteTrend"],
  ]),
  ...organizer("I/O", [
    ["Open I/O Configuration", "offline-navigation", "ProjectExplorer selection"],
    ["New Module", "offline-action", "App.handleNewIoModule"],
    ["I/O Properties", "offline-navigation", "ProjectExplorer selection"],
    ["Add 1756 Backplane", "offline-action", "App.handleNewIoModule(Chassis)"],
    ["Import I/O Profile Pack", "review-import-export", "App.handleImportIoProfilePackClick"],
    ["Export I/O Profile Pack", "review-import-export", "App.handleExportIoProfilePack"],
    ["Export Device Tree", "review-import-export", "App.handleExportDeviceTreeComponent"],
    ["Controller Route Browser", "guarded-hardware", "Controller session guard/audit", "network-browser"],
    ["Select Virtual Path", "simulation-action", "VirtualController.beginBrowsing"],
    ["Module Properties", "offline-action", "App.handleIoModuleProperties"],
    ["Configure Module", "offline-action", "App.handleIoModuleProperties"],
    ["Diagnostics / Fault Info", "offline-navigation", "App.handleIoModuleDiagnostics"],
    ["Change Module", "offline-action", "App.handleOpenChangeIoModule"],
    ["Export Device Definition", "review-import-export", "App.handleExportDeviceDefinitionComponent"],
    ["Inhibit Module", "offline-action", "App.handleToggleIoModuleInhibit"],
    ["Delete Module", "offline-action", "App.handleDeleteIoModule"],
  ]),
] as const;

export function escoCommandSurfaceCounts(
  entries: readonly EscoCommandSurfaceEntry[] = ESCO_COMMAND_SURFACE_AUDIT,
): Record<EscoCommandSurfaceKind, number> {
  return entries.reduce((counts, entry) => {
    counts[entry.kind] += 1;
    return counts;
  }, Object.fromEntries(ESCO_COMMAND_SURFACE_KINDS.map((kind) => [kind, 0])) as Record<EscoCommandSurfaceKind, number>);
}

export function escoCommandSurfaceGroupSummaries(
  entries: readonly EscoCommandSurfaceEntry[] = ESCO_COMMAND_SURFACE_AUDIT,
): EscoCommandSurfaceGroupSummary[] {
  const groups = new Map<string, EscoCommandSurfaceGroupSummary>();
  for (const entry of entries) {
    const key = `${entry.surface}:${entry.group}`;
    const summary = groups.get(key) ?? {
      key,
      surface: entry.surface,
      group: entry.group,
      total: 0,
      offline: 0,
      review: 0,
      simulation: 0,
      gatewayOnline: 0,
      guarded: 0,
      informational: 0,
    };
    summary.total += 1;
    if (entry.kind === "offline-action" || entry.kind === "offline-navigation") summary.offline += 1;
    else if (entry.kind === "review-import-export") summary.review += 1;
    else if (entry.kind === "simulation-action") summary.simulation += 1;
    else if (entry.kind === "gateway-online") summary.gatewayOnline += 1;
    else if (entry.kind === "guarded-hardware") summary.guarded += 1;
    else summary.informational += 1;
    groups.set(key, summary);
  }
  return [...groups.values()];
}

export function escoCommandSurfaceGuardFindings(
  entries: readonly EscoCommandSurfaceEntry[] = ESCO_COMMAND_SURFACE_AUDIT,
): string[] {
  return entries.flatMap((entry) => {
    if (entry.kind !== "guarded-hardware") return [];
    if (!entry.controllerCommandKind) return [`${entry.id} is guarded hardware but has no controller command kind.`];
    const capability = escoControllerCommandCapability(entry.controllerCommandKind);
    const plannedReadOnly =
      capability?.id === "verified-readonly-monitor" && capability.status === "planned";
    if (capability?.status !== "unsupported" && !plannedReadOnly) {
      return [`${entry.id} maps to ${entry.controllerCommandKind}, which is not marked unsupported or planned read-only.`];
    }
    return [];
  });
}
