import { useState } from "react";
import type {
  AddOnInstruction,
  AoiLocalTag,
  AoiParameter,
  Controller,
  ControllerTrend,
  IoModule,
  PlcProject,
  Program,
  Task,
  UdtMember,
  UserDefinedType,
} from "@esco/core";
import { arrayDimensionSuffix, arrayDimensionsOf } from "@esco/core";
import {
  aoiReferences,
  aoiReviewBoundaryLabel,
  aoiRoutineReviewBehaviorLabel,
  describeAoiExecutionReview,
  ioModuleReviewReport,
  tagsUsingType,
  udtMemberPaths,
  type AddIoModuleInput,
  type IoModuleReviewRow,
  type RemoveIoModuleInput,
  type UpdateIoModuleInput,
} from "@esco/project-actions";
import type { Selection } from "../selection";
import { escoBrandText } from "../branding";
import { deviceImageUrl } from "../device-image-assets";
import {
  findIoDeviceCatalogEntry,
  ioDeviceProfileSummary,
} from "../io-device-catalog";
import "./StructureView.css";

/** Reviewed-action callbacks for editing controller-database structures. */
export interface StructureEditing {
  addUdtMember: (udtId: string, member: UdtMember) => void;
  updateUdtMember: (udtId: string, memberName: string, patch: Partial<UdtMember>) => void;
  removeUdtMember: (udtId: string, memberName: string) => void;
  addAoiParameter: (aoiId: string, parameter: AoiParameter) => void;
  updateAoiParameter: (aoiId: string, parameterName: string, patch: Partial<AoiParameter>) => void;
  removeAoiParameter: (aoiId: string, parameterName: string) => void;
  addAoiLocalTag: (aoiId: string, localTag: AoiLocalTag) => void;
  updateAoiLocalTag: (aoiId: string, localTagName: string, patch: Partial<AoiLocalTag>) => void;
  removeAoiLocalTag: (aoiId: string, localTagName: string) => void;
  addIoModule: (input: AddIoModuleInput) => void;
  updateIoModule: (input: UpdateIoModuleInput) => void;
  removeIoModule: (input: RemoveIoModuleInput) => void;
}

interface Props {
  project: PlcProject;
  selection: Selection;
  onOpenRoutine: (routineId: string) => void;
  editing?: StructureEditing;
  onNewIoModule?: (controllerId: string, initialQuery?: string, initialSlot?: number) => void;
  onSelectIoModule?: (controllerId: string, moduleId: string) => void;
  onIoModuleProperties?: (controllerId: string, moduleId: string) => void;
  onToggleIoModuleInhibit?: (controllerId: string, moduleId: string) => void;
  onDeleteIoModule?: (controllerId: string, moduleId: string) => void;
}

const AOI_USAGES = ["Input", "Output", "InOut"];

/** Uncontrolled text/number cell that commits on blur or Enter (re-seeds via React key). */
function CommitCell({
  value,
  onCommit,
  ariaLabel,
  type = "text",
  placeholder,
}: {
  value: string;
  onCommit: (value: string) => void;
  ariaLabel: string;
  type?: "text" | "number";
  placeholder?: string;
}) {
  return (
    <input
      className="esco-edit__input"
      type={type}
      aria-label={ariaLabel}
      placeholder={placeholder}
      defaultValue={value}
      spellCheck={false}
      onBlur={(event) => {
        if (event.target.value !== value) onCommit(event.target.value);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
    />
  );
}

function findAoi(project: PlcProject, id: string): AddOnInstruction | undefined {
  for (const controller of project.controllers) {
    const aoi = controller.addOnInstructions.find((a) => a.id === id);
    if (aoi) return aoi;
  }
  return undefined;
}

function findUdt(project: PlcProject, id: string): UserDefinedType | undefined {
  for (const controller of project.controllers) {
    const udt = controller.dataTypes.find((d) => d.id === id);
    if (udt) return udt;
  }
  return undefined;
}

function findTrend(project: PlcProject, id: string): { controller: Controller; trend: ControllerTrend } | undefined {
  for (const controller of project.controllers) {
    const trend = controller.trends?.find((candidate) => candidate.id === id);
    if (trend) return { controller, trend };
  }
  return undefined;
}

function findController(project: PlcProject, id: string): Controller | undefined {
  return project.controllers.find((controller) => controller.id === id);
}

function findProgram(project: PlcProject, id: string): { controller: Controller; program: Program } | undefined {
  for (const controller of project.controllers) {
    const program = controller.programs.find((candidate) => candidate.id === id);
    if (program) return { controller, program };
  }
  return undefined;
}

function findTask(project: PlcProject, id: string): { controller: Controller; task: Task } | undefined {
  for (const controller of project.controllers) {
    const task = controller.tasks.find((candidate) => candidate.id === id);
    if (task) return { controller, task };
  }
  return undefined;
}

function meta(value: unknown): string {
  if (value === undefined || value === null || value === "") return "-";
  if (typeof value === "boolean") return value ? "yes" : "no";
  return escoBrandText(String(value));
}

function dimensionText(value: { dimension?: number; dimensions?: readonly number[] }): string {
  return arrayDimensionsOf(value).join(",");
}

function dimensionPatch(value: string): { dimension?: number; dimensions?: number[] } {
  const text = value.trim();
  if (!text) return { dimensions: [] };
  const dimensions = text.split(/[\s,]+/).filter(Boolean).map((part) => Number(part));
  return dimensions.length > 1 ? { dimensions } : { dimension: dimensions[0] ?? 0 };
}

function ProjectDetail({ project }: { project: PlcProject }) {
  const controllerCount = project.controllers.length;
  const programs = project.controllers.flatMap((controller) => controller.programs);
  const routines = programs.flatMap((program) => program.routines);
  const tags = project.controllers.flatMap((controller) => [
    ...controller.controllerTags,
    ...controller.programs.flatMap((program) => program.programTags),
  ]);
  return (
    <div className="esco-detail">
      <header className="esco-detail__head">
        <h1 className="esco-detail__title">Project · {project.name}</h1>
        <span className="esco-detail__readonly">Offline metadata</span>
      </header>
      {project.description ? <p className="esco-detail__desc">{project.description}</p> : null}
      <section className="esco-detail__section">
        <h2>Properties</h2>
        <table className="esco-detail__table">
          <tbody>
            <tr><th>Name</th><td>{project.name}</td></tr>
            <tr><th>Description</th><td>{meta(project.description)}</td></tr>
            <tr><th>Created</th><td>{meta(project.createdAt ? new Date(project.createdAt).toLocaleString() : undefined)}</td></tr>
            <tr><th>Updated</th><td>{meta(project.updatedAt ? new Date(project.updatedAt).toLocaleString() : undefined)}</td></tr>
            <tr><th>Storage</th><td>ESCO project file (.easproj)</td></tr>
          </tbody>
        </table>
      </section>
      <section className="esco-detail__section esco-detail__cards">
        <div><strong>{controllerCount}</strong><span>Controllers</span></div>
        <div><strong>{programs.length}</strong><span>Programs</span></div>
        <div><strong>{routines.length}</strong><span>Routines</span></div>
        <div><strong>{tags.length}</strong><span>Tags</span></div>
      </section>
    </div>
  );
}

function ControllerDetail({ controller }: { controller: Controller }) {
  return (
    <div className="esco-detail">
      <header className="esco-detail__head">
        <h1 className="esco-detail__title">Controller · {controller.name}</h1>
        <span className="esco-detail__readonly">Offline metadata</span>
      </header>
      <section className="esco-detail__section">
        <h2>Properties</h2>
        <table className="esco-detail__table">
          <tbody>
            <tr><th>Processor</th><td>{meta(controller.processorType)}</td></tr>
            <tr><th>Catalog</th><td>{meta(controller.catalogNumber)}</td></tr>
            <tr><th>Firmware</th><td>{meta(controller.firmwareRevision)}</td></tr>
            <tr><th>Chassis</th><td>{meta(controller.chassis)}</td></tr>
            <tr><th>Slot</th><td>{meta(controller.slot)}</td></tr>
            <tr><th>Fault routine</th><td>{meta(controller.faultRoutineName)}</td></tr>
            <tr><th>Power-up routine</th><td>{meta(controller.powerUpRoutineName)}</td></tr>
          </tbody>
        </table>
      </section>
      <section className="esco-detail__section esco-detail__cards">
        <div><strong>{controller.programs.length}</strong><span>Programs</span></div>
        <div><strong>{controller.tasks.length}</strong><span>Tasks</span></div>
        <div><strong>{controller.controllerTags.length}</strong><span>Controller tags</span></div>
        <div><strong>{controller.ioConfiguration.modules.length}</strong><span>I/O modules</span></div>
      </section>
    </div>
  );
}

function ProgramDetail({ controller, program, onOpenRoutine }: { controller: Controller; program: Program; onOpenRoutine: (id: string) => void }) {
  const main = program.mainRoutineId ? program.routines.find((routine) => routine.id === program.mainRoutineId) : undefined;
  const fault = program.faultRoutineId ? program.routines.find((routine) => routine.id === program.faultRoutineId) : undefined;
  return (
    <div className="esco-detail">
      <header className="esco-detail__head">
        <h1 className="esco-detail__title">Program · {program.name}</h1>
        <span className="esco-detail__readonly">Offline metadata</span>
      </header>
      {program.description ? <p className="esco-detail__desc">{program.description}</p> : null}
      <section className="esco-detail__section">
        <h2>Configuration</h2>
        <table className="esco-detail__table">
          <tbody>
            <tr><th>Controller</th><td>{controller.name}</td></tr>
            <tr><th>Main routine</th><td>{main ? <button type="button" className="esco-link" onClick={() => onOpenRoutine(main.id)}>{main.name}</button> : "-"}</td></tr>
            <tr><th>Fault routine</th><td>{fault ? <button type="button" className="esco-link" onClick={() => onOpenRoutine(fault.id)}>{fault.name}</button> : "-"}</td></tr>
            <tr><th>Inhibited</th><td>{meta(program.inhibited)}</td></tr>
          </tbody>
        </table>
      </section>
      <section className="esco-detail__section">
        <h2>Parameters ({program.parameters?.length ?? 0})</h2>
        {program.parameters?.length ? (
          <table className="esco-detail__table">
            <thead><tr><th>Name</th><th>Type</th><th>Usage</th><th>Required</th><th>Description</th></tr></thead>
            <tbody>
              {program.parameters.map((parameter) => (
                <tr key={parameter.name}>
                  <td>{parameter.name}</td>
                  <td>{parameter.dataType}</td>
                  <td>{meta(parameter.usage)}</td>
                  <td>{meta(parameter.required)}</td>
                  <td>{meta(parameter.description)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="esco-empty">No program parameters imported.</p>
        )}
      </section>
      <section className="esco-detail__section">
        <h2>Routines ({program.routines.length})</h2>
        <ul className="esco-detail__list">
          {program.routines.map((routine) => (
            <li key={routine.id}>
              <button type="button" className="esco-link" onClick={() => onOpenRoutine(routine.id)}>
                {routine.name}
              </button>
              <span className="esco-detail__muted"> · {routine.language}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function TaskDetail({ controller, task }: { controller: Controller; task: Task }) {
  const scheduled = task.scheduledProgramIds
    .map((id) => controller.programs.find((program) => program.id === id)?.name)
    .filter((name): name is string => Boolean(name));
  return (
    <div className="esco-detail">
      <header className="esco-detail__head">
        <h1 className="esco-detail__title">Task · {task.name}</h1>
        <span className="esco-detail__readonly">Offline metadata</span>
      </header>
      <section className="esco-detail__section">
        <h2>Scheduling</h2>
        <table className="esco-detail__table">
          <tbody>
            <tr><th>Controller</th><td>{controller.name}</td></tr>
            <tr><th>Type</th><td>{task.type}</td></tr>
            <tr><th>Period</th><td>{task.periodMs != null ? `${task.periodMs} ms` : "-"}</td></tr>
            <tr><th>Priority</th><td>{meta(task.priority)}</td></tr>
            <tr><th>Watchdog</th><td>{task.watchdogMs != null ? `${task.watchdogMs} ms` : "-"}</td></tr>
            <tr><th>Inhibited</th><td>{meta(task.inhibited)}</td></tr>
          </tbody>
        </table>
      </section>
      <section className="esco-detail__section">
        <h2>Scheduled programs ({scheduled.length})</h2>
        {scheduled.length ? (
          <ul className="esco-detail__list">
            {scheduled.map((name) => <li key={name}>{name}</li>)}
          </ul>
        ) : (
          <p className="esco-empty">No scheduled programs imported.</p>
        )}
      </section>
    </div>
  );
}

function AddUdtMemberRow({ onAdd }: { onAdd: (member: UdtMember) => void }) {
  const [name, setName] = useState("");
  const [dataType, setDataType] = useState("BOOL");
  const [dimension, setDimension] = useState("");
  const [description, setDescription] = useState("");
  const submit = () => {
    if (!name.trim()) return;
    onAdd({
      name: name.trim(),
      dataType: dataType.trim() || "BOOL",
      ...dimensionPatch(dimension),
      ...(description.trim() ? { description: description.trim() } : {}),
    });
    setName("");
    setDimension("");
    setDescription("");
  };
  return (
    <tr className="esco-edit__add-row">
      <td><input aria-label="New member name" className="esco-edit__input" value={name} placeholder="Member" spellCheck={false} onChange={(e) => setName(e.target.value)} /></td>
      <td><input aria-label="New member type" className="esco-edit__input" value={dataType} spellCheck={false} onChange={(e) => setDataType(e.target.value)} /></td>
      <td><input aria-label="New member dimension" className="esco-edit__input" value={dimension} placeholder="0 or 2,3" spellCheck={false} onChange={(e) => setDimension(e.target.value)} /></td>
      <td><input aria-label="New member description" className="esco-edit__input" value={description} spellCheck={false} onChange={(e) => setDescription(e.target.value)} /></td>
      <td><button type="button" className="esco-btn esco-btn--primary esco-btn--xs" disabled={!name.trim()} onClick={submit}>Add</button></td>
    </tr>
  );
}

/** UDT detail: editable members (with array dims), member paths, and tags using it. */
function UdtDetail({ udt, project, editing }: { udt: UserDefinedType; project: PlcProject; editing?: StructureEditing }) {
  const tags = tagsUsingType(project, udt.name);
  const paths = udtMemberPaths(udt);
  return (
    <div className="esco-detail">
      <header className="esco-detail__head">
        <h1 className="esco-detail__title">Data Type · {udt.name}</h1>
        <span className="esco-detail__readonly">{editing ? "Offline editable" : "Read-only"}</span>
      </header>
      {udt.description ? <p className="esco-detail__desc">{udt.description}</p> : null}

      <section className="esco-detail__section">
        <h2>Members ({udt.members.length})</h2>
        {udt.members.length === 0 && !editing ? (
          <p className="esco-empty">No members imported.</p>
        ) : (
          <table className="esco-detail__table">
            <thead><tr><th>Member</th><th>Type</th><th>Dimension</th><th>Description</th>{editing ? <th /> : null}</tr></thead>
            <tbody>
              {udt.members.map((m) => (
                <tr key={m.name}>
                  {editing ? (
                    <>
                      <td><CommitCell ariaLabel={`Member ${m.name} name`} value={m.name} onCommit={(v) => editing.updateUdtMember(udt.id, m.name, { name: v })} /></td>
                      <td><CommitCell ariaLabel={`Member ${m.name} type`} value={m.dataType} onCommit={(v) => editing.updateUdtMember(udt.id, m.name, { dataType: v })} /></td>
                      <td><CommitCell ariaLabel={`Member ${m.name} dimension`} value={dimensionText(m)} placeholder="0 or 2,3" onCommit={(v) => editing.updateUdtMember(udt.id, m.name, dimensionPatch(v))} /></td>
                      <td><CommitCell ariaLabel={`Member ${m.name} description`} value={m.description ?? ""} onCommit={(v) => editing.updateUdtMember(udt.id, m.name, { description: v })} /></td>
                      <td><button type="button" className="esco-btn esco-btn--danger esco-btn--xs" aria-label={`Remove member ${m.name}`} onClick={() => editing.removeUdtMember(udt.id, m.name)}>Remove</button></td>
                    </>
                  ) : (
                    <>
                      <td>{m.name}</td>
                      <td>{m.dataType}</td>
                      <td>{arrayDimensionSuffix(m) || "—"}</td>
                      <td>{m.description ?? ""}</td>
                    </>
                  )}
                </tr>
              ))}
              {editing ? <AddUdtMemberRow onAdd={(member) => editing.addUdtMember(udt.id, member)} /> : null}
            </tbody>
          </table>
        )}
      </section>

      <section className="esco-detail__section">
        <h2>Member paths</h2>
        <ul className="esco-detail__list">
          {paths.map((path) => (
            <li key={path}><code>{path}</code></li>
          ))}
        </ul>
      </section>

      <section className="esco-detail__section">
        <h2>Tags using this type ({tags.length})</h2>
        {tags.length === 0 ? (
          <p className="esco-empty">No tags use this type.</p>
        ) : (
          <ul className="esco-detail__list">
            {tags.map((t) => (
              <li key={`${t.scope}:${t.name}`}>
                {t.name}
                {arrayDimensionSuffix(t)}
                <span className="esco-detail__muted"> · {t.programName ? `program ${t.programName}` : "controller"}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function AddAoiParameterRow({ onAdd }: { onAdd: (parameter: AoiParameter) => void }) {
  const [name, setName] = useState("");
  const [dataType, setDataType] = useState("BOOL");
  const [usage, setUsage] = useState("Input");
  const [required, setRequired] = useState(false);
  const [defaultValue, setDefaultValue] = useState("");
  const [description, setDescription] = useState("");
  const submit = () => {
    if (!name.trim()) return;
    onAdd({
      name: name.trim(),
      dataType: dataType.trim() || "BOOL",
      usage,
      ...(required ? { required: true } : {}),
      ...(defaultValue.trim() ? { defaultValue: defaultValue.trim() } : {}),
      ...(description.trim() ? { description: description.trim() } : {}),
    });
    setName("");
    setDefaultValue("");
    setDescription("");
  };
  return (
    <tr className="esco-edit__add-row">
      <td><input aria-label="New parameter name" className="esco-edit__input" value={name} placeholder="Param" spellCheck={false} onChange={(e) => setName(e.target.value)} /></td>
      <td><input aria-label="New parameter type" className="esco-edit__input" value={dataType} spellCheck={false} onChange={(e) => setDataType(e.target.value)} /></td>
      <td>
        <select aria-label="New parameter usage" className="esco-edit__input" value={usage} onChange={(e) => setUsage(e.target.value)}>
          {AOI_USAGES.map((u) => <option key={u} value={u}>{u}</option>)}
        </select>
      </td>
      <td><input aria-label="New parameter required" type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} /></td>
      <td><input aria-label="New parameter default" className="esco-edit__input" value={defaultValue} spellCheck={false} onChange={(e) => setDefaultValue(e.target.value)} /></td>
      <td><input aria-label="New parameter description" className="esco-edit__input" value={description} spellCheck={false} onChange={(e) => setDescription(e.target.value)} /></td>
      <td><button type="button" className="esco-btn esco-btn--primary esco-btn--xs" disabled={!name.trim()} onClick={submit}>Add</button></td>
    </tr>
  );
}

function AddAoiLocalTagRow({ onAdd }: { onAdd: (localTag: AoiLocalTag) => void }) {
  const [name, setName] = useState("");
  const [dataType, setDataType] = useState("BOOL");
  const [dimension, setDimension] = useState("");
  const [description, setDescription] = useState("");
  const submit = () => {
    if (!name.trim()) return;
    onAdd({
      name: name.trim(),
      dataType: dataType.trim() || "BOOL",
      ...dimensionPatch(dimension),
      ...(description.trim() ? { description: description.trim() } : {}),
    });
    setName("");
    setDimension("");
    setDescription("");
  };
  return (
    <tr className="esco-edit__add-row">
      <td><input aria-label="New local tag name" className="esco-edit__input" value={name} placeholder="Tag" spellCheck={false} onChange={(e) => setName(e.target.value)} /></td>
      <td><input aria-label="New local tag type" className="esco-edit__input" value={dataType} spellCheck={false} onChange={(e) => setDataType(e.target.value)} /></td>
      <td><input aria-label="New local tag dimension" className="esco-edit__input" value={dimension} placeholder="0 or 2,3" spellCheck={false} onChange={(e) => setDimension(e.target.value)} /></td>
      <td><input aria-label="New local tag description" className="esco-edit__input" value={description} spellCheck={false} onChange={(e) => setDescription(e.target.value)} /></td>
      <td><button type="button" className="esco-btn esco-btn--primary esco-btn--xs" disabled={!name.trim()} onClick={submit}>Add</button></td>
    </tr>
  );
}

/** Add-On Instruction detail: parameters and local tags are editable unless source-protected. */
function AoiDetail({ aoi, project, onOpenRoutine, editing }: { aoi: AddOnInstruction; project: PlcProject; onOpenRoutine: (id: string) => void; editing?: StructureEditing }) {
  const references = aoiReferences(project, aoi.name);
  const review = describeAoiExecutionReview(aoi);
  const canEdit = editing && !aoi.protected ? editing : undefined;
  return (
    <div className="esco-detail">
      <header className="esco-detail__head">
        <h1 className="esco-detail__title">Add-On Instruction · {aoi.name}</h1>
        {aoi.revision ? <span className="esco-detail__tag">Rev {aoi.revision}</span> : null}
        {aoi.signature ? <span className="esco-detail__tag">Sig {aoi.signature}</span> : null}
        {aoi.protected ? <span className="esco-detail__tag esco-detail__tag--protected">Protected</span> : null}
        <span className="esco-detail__tag">{review.offlineExecutable ? "Offline RLL executable" : "Model-only pass-through"}</span>
        <span className="esco-detail__readonly">{canEdit ? "Offline editable" : "Read-only"}</span>
      </header>
      {aoi.description ? <p className="esco-detail__desc">{aoi.description}</p> : null}
      {aoi.protected ? (
        <p className="esco-detail__warning">
          Source-protected{aoi.protectionType ? ` (${aoi.protectionType})` : ""}. The logic is encrypted in the
          export and cannot be inspected; parameters and tags are shown where the export includes them.
        </p>
      ) : null}

      <section className="esco-detail__section" aria-label="AOI signature and source protection review">
        <h2>Signature / Source Protection</h2>
        <table className="esco-detail__table">
          <tbody>
            <tr><th>Signature ID</th><td>{meta(aoi.signature)}</td></tr>
            <tr><th>Source protected</th><td>{aoi.protected ? "yes" : "no"}</td></tr>
            <tr><th>Protection type</th><td>{meta(aoi.protectionType)}</td></tr>
            <tr><th>Safety class</th><td>{meta(aoi.safetyClass)}</td></tr>
            <tr><th>Revision</th><td>{meta([aoi.revision, aoi.revisionExtension].filter(Boolean).join("."))}</td></tr>
            <tr><th>Software revision</th><td>{meta(aoi.softwareRevision)}</td></tr>
            <tr><th>Vendor</th><td>{meta(aoi.vendor)}</td></tr>
            <tr><th>Created</th><td>{meta([aoi.createdDate, aoi.createdBy].filter(Boolean).join(" by "))}</td></tr>
            <tr><th>Edited</th><td>{meta([aoi.editedDate, aoi.editedBy].filter(Boolean).join(" by "))}</td></tr>
          </tbody>
        </table>
      </section>

      <section className="esco-detail__section">
        <h2>Execution review</h2>
        <table className="esco-detail__table">
          <tbody>
            <tr><th>Status</th><td>{review.status}</td></tr>
            <tr><th>Selected scan body</th><td>{review.selectedRoutineName ?? "—"}</td></tr>
            <tr><th>Boundary</th><td>{review.boundaries.map(aoiReviewBoundaryLabel).join("; ")}</td></tr>
          </tbody>
        </table>
      </section>

      <section className="esco-detail__section">
        <h2>Parameters ({aoi.parameters.length})</h2>
        {aoi.parameters.length === 0 && !canEdit ? (
          <p className="esco-empty">No parameters imported.</p>
        ) : (
          <table className="esco-detail__table">
            <thead>
              <tr><th>Name</th><th>Type</th><th>Usage</th><th>Required</th><th>Default</th><th>Description</th>{canEdit ? <th /> : null}</tr>
            </thead>
            <tbody>
              {aoi.parameters.map((p) => (
                <tr key={p.name}>
                  {canEdit ? (
                    <>
                      <td><CommitCell ariaLabel={`Parameter ${p.name} name`} value={p.name} onCommit={(v) => canEdit.updateAoiParameter(aoi.id, p.name, { name: v })} /></td>
                      <td><CommitCell ariaLabel={`Parameter ${p.name} type`} value={p.dataType} onCommit={(v) => canEdit.updateAoiParameter(aoi.id, p.name, { dataType: v })} /></td>
                      <td>
                        <select className="esco-edit__input" aria-label={`Parameter ${p.name} usage`} value={p.usage ?? "Input"} onChange={(e) => canEdit.updateAoiParameter(aoi.id, p.name, { usage: e.target.value })}>
                          {AOI_USAGES.map((u) => <option key={u} value={u}>{u}</option>)}
                        </select>
                      </td>
                      <td><input type="checkbox" aria-label={`Parameter ${p.name} required`} checked={Boolean(p.required)} onChange={(e) => canEdit.updateAoiParameter(aoi.id, p.name, { required: e.target.checked })} /></td>
                      <td><CommitCell ariaLabel={`Parameter ${p.name} default`} value={p.defaultValue ?? ""} onCommit={(v) => canEdit.updateAoiParameter(aoi.id, p.name, { defaultValue: v })} /></td>
                      <td><CommitCell ariaLabel={`Parameter ${p.name} description`} value={p.description ?? ""} onCommit={(v) => canEdit.updateAoiParameter(aoi.id, p.name, { description: v })} /></td>
                      <td><button type="button" className="esco-btn esco-btn--danger esco-btn--xs" aria-label={`Remove parameter ${p.name}`} onClick={() => canEdit.removeAoiParameter(aoi.id, p.name)}>Remove</button></td>
                    </>
                  ) : (
                    <>
                      <td>{p.name}</td>
                      <td>{p.dataType}</td>
                      <td>{p.usage ?? "—"}</td>
                      <td>{p.required ? "yes" : "—"}</td>
                      <td>{p.defaultValue ?? "—"}</td>
                      <td>{p.description ?? ""}</td>
                    </>
                  )}
                </tr>
              ))}
              {canEdit ? <AddAoiParameterRow onAdd={(parameter) => canEdit.addAoiParameter(aoi.id, parameter)} /> : null}
            </tbody>
          </table>
        )}
      </section>

      <section className="esco-detail__section">
        <h2>Local tags ({aoi.localTags.length})</h2>
        {aoi.localTags.length === 0 && !canEdit ? (
          <p className="esco-empty">No local tags imported.</p>
        ) : (
          <table className="esco-detail__table">
            <thead><tr><th>Name</th><th>Type</th><th>Dimension</th><th>Description</th>{canEdit ? <th /> : null}</tr></thead>
            <tbody>
              {aoi.localTags.map((t) => (
                <tr key={t.name}>
                  {canEdit ? (
                    <>
                      <td><CommitCell ariaLabel={`Local tag ${t.name} name`} value={t.name} onCommit={(v) => canEdit.updateAoiLocalTag(aoi.id, t.name, { name: v })} /></td>
                      <td><CommitCell ariaLabel={`Local tag ${t.name} type`} value={t.dataType} onCommit={(v) => canEdit.updateAoiLocalTag(aoi.id, t.name, { dataType: v })} /></td>
                      <td><CommitCell ariaLabel={`Local tag ${t.name} dimension`} value={dimensionText(t)} placeholder="0 or 2,3" onCommit={(v) => canEdit.updateAoiLocalTag(aoi.id, t.name, dimensionPatch(v))} /></td>
                      <td><CommitCell ariaLabel={`Local tag ${t.name} description`} value={t.description ?? ""} onCommit={(v) => canEdit.updateAoiLocalTag(aoi.id, t.name, { description: v })} /></td>
                      <td><button type="button" className="esco-btn esco-btn--danger esco-btn--xs" aria-label={`Remove local tag ${t.name}`} onClick={() => canEdit.removeAoiLocalTag(aoi.id, t.name)}>Remove</button></td>
                    </>
                  ) : (
                    <>
                      <td>{t.name}</td><td>{t.dataType}</td><td>{arrayDimensionSuffix(t) || "—"}</td><td>{t.description ?? ""}</td>
                    </>
                  )}
                </tr>
              ))}
              {canEdit ? <AddAoiLocalTagRow onAdd={(localTag) => canEdit.addAoiLocalTag(aoi.id, localTag)} /> : null}
            </tbody>
          </table>
        )}
      </section>

      <section className="esco-detail__section">
        <h2>Routines ({aoi.routineNames.length})</h2>
        {aoi.routineNames.length === 0 ? (
          <p className="esco-empty">
            {aoi.protected
              ? "Logic is source-protected and not exported."
              : "No routines imported (logic not available)."}
          </p>
        ) : (
          <ul className="esco-detail__list">
            {aoi.routineNames.map((name) => (
              <li key={name}>{name}{" "}
                <span className="esco-detail__muted">
                  ({aoiRoutineReviewBehaviorLabel(
                    review.routines.find((routine) => routine.name === name)?.behavior ?? "non-ladder-preserved-read-only",
                  )})
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="esco-detail__section">
        <h2>Used by ({references.length})</h2>
        {references.length === 0 ? (
          <p className="esco-empty">Not called in any imported routine.</p>
        ) : (
          <ul className="esco-detail__list">
            {references.map((ref, i) => (
              <li key={i}>
                <button type="button" className="esco-link" onClick={() => onOpenRoutine(ref.routineId)}>
                  {ref.programName} / {ref.routineName} · rung {ref.rungNumber}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function TrendDetail({ controller, trend }: { controller: Controller; trend: ControllerTrend }) {
  const attributeRows = Object.entries(trend.attributes ?? {});
  return (
    <div className="esco-detail">
      <header className="esco-detail__head">
        <h1 className="esco-detail__title">Trend · {trend.name}</h1>
        <span className="esco-detail__tag">Controller trend</span>
        <span className="esco-detail__readonly">Offline editable metadata</span>
      </header>
      {trend.description ? <p className="esco-detail__desc">{trend.description}</p> : null}

      <section className="esco-detail__section">
        <h2>Properties</h2>
        <table className="esco-detail__table">
          <tbody>
            <tr><th>Controller</th><td>{controller.name}</td></tr>
            <tr><th>Pens</th><td>{trend.pens.length}</td></tr>
            <tr><th>Template payload</th><td>{trend.template ? "Preserved" : "—"}</td></tr>
            <tr><th>Imported attributes</th><td>{attributeRows.length}</td></tr>
          </tbody>
        </table>
      </section>

      <section className="esco-detail__section">
        <h2>Pens ({trend.pens.length})</h2>
        {trend.pens.length ? (
          <table className="esco-detail__table">
            <thead><tr><th>Pen</th><th>Description</th><th>Attributes</th></tr></thead>
            <tbody>
              {trend.pens.map((pen) => (
                <tr key={pen.id}>
                  <td>{pen.name}</td>
                  <td>{meta(pen.description)}</td>
                  <td>{Object.keys(pen.attributes ?? {}).length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="esco-empty">No pens configured. Add pens through the next trend editor slice or import a controller trend definition.</p>
        )}
      </section>

      {attributeRows.length ? (
        <section className="esco-detail__section">
          <h2>Imported attributes</h2>
          <table className="esco-detail__table">
            <tbody>
              {attributeRows.map(([key, value]) => (
                <tr key={key}><th>{key}</th><td>{value}</td></tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
    </div>
  );
}

function moduleConnectionSummary(module: IoModule): string {
  if (!module.connections?.length) return "—";
  return module.connections
    .map((connection) =>
      [
        connection.name,
        connection.type,
        connection.rpi != null ? `${connection.rpi} us` : undefined,
        connection.priority,
        connection.unicast ? "unicast" : undefined,
        connection.inputConnectionType,
        connection.inputProductionTrigger,
      ]
        .filter(Boolean)
        .join(" / "),
    )
    .filter(Boolean)
    .join(", ") || "—";
}

function modulePortSummary(module: IoModule): string {
  if (!module.ports?.length) return "No port metadata";
  return module.ports
    .map((port, index) =>
      [
        port.id ? `Port ${port.id}` : `Port ${index + 1}`,
        port.type,
        port.address ? `address ${port.address}` : undefined,
        port.upstream ? "upstream" : undefined,
        port.busSize != null ? `${port.busSize} slots` : undefined,
      ]
        .filter(Boolean)
        .join(" / "),
    )
    .join(", ");
}

function moduleProfileReview(module: IoModule) {
  const catalogEntry = findIoDeviceCatalogEntry(module);
  const catalogProfile = catalogEntry ? ioDeviceProfileSummary(catalogEntry) : undefined;
  const persistedConnection = moduleConnectionSummary(module);
  const identity = [module.vendor, module.productType, module.productCode ? `code ${module.productCode}` : undefined]
    .filter(Boolean)
    .join(" / ");
  return {
    catalogEntry,
    profile: catalogProfile?.profile ?? (identity || "Imported module profile"),
    connection: persistedConnection !== "—" ? persistedConnection : catalogProfile?.connection ?? "No connection metadata",
    channels: catalogProfile?.channels ?? module.productType ?? "No channel summary available",
    configuration: catalogProfile?.configuration ?? "Imported/offline module metadata",
    data: catalogProfile?.data ?? ([module.catalogNumber, module.productType].filter(Boolean).join(" / ") || "No profile data summary"),
    ports: modulePortSummary(module),
  };
}

function isBackplaneModule(module: IoModule): boolean {
  return /1756-A|backplane|chassis/i.test(`${module.name} ${module.catalogNumber ?? ""} ${module.productType ?? ""}`);
}

function isProcessorModule(module: IoModule, controller: Controller): boolean {
  const text = escoBrandText(`${module.name} ${module.catalogNumber ?? ""} ${module.productType ?? ""}`);
  return module.slot === (controller.slot ?? 0) && /processor|controller|557|558|L7|L8/i.test(text);
}

function IoModuleProfileReview({ module, reviewRow }: { module: IoModule; reviewRow?: IoModuleReviewRow }) {
  const review = moduleProfileReview(module);
  const reviewImageUrl = deviceImageUrl(review.catalogEntry ?? module);
  return (
    <section className="esco-detail__section esco-io-profile-review">
      <h2>Selected Module Profile Review</h2>
      <div className="esco-io-profile-review__visual">
        <img className="esco-io-profile-review__image" src={reviewImageUrl} alt="" aria-hidden="true" />
        <div>
          <strong>{review.catalogEntry?.catalogNumber ?? module.catalogNumber ?? module.name}</strong>
          <span>{review.profile}</span>
        </div>
      </div>
      <div className="esco-io-profile-review__grid">
        <div><span>Name</span><strong>{module.name}</strong></div>
        <div><span>Catalog match</span><strong>{review.catalogEntry?.catalogNumber ?? module.catalogNumber ?? "Imported module"}</strong></div>
        <div><span>Profile summary</span><strong>{review.profile}</strong></div>
        <div><span>Advanced profile</span><strong>{reviewRow?.advancedProfileLabel ?? "Standard module profile"}</strong></div>
        <div><span>Connection summary</span><strong>{review.connection}</strong></div>
        <div><span>Channel summary</span><strong>{review.channels}</strong></div>
        <div><span>Profile source</span><strong>{review.configuration}</strong></div>
        <div><span>Profile data</span><strong>{review.data}</strong></div>
        <div><span>Ports</span><strong>{review.ports}</strong></div>
        <div>
          <span>Location</span>
          <strong>
            {[module.parentModule || "Local", module.parentPortId ? `port ${module.parentPortId}` : undefined, module.slot != null ? `slot ${module.slot}` : undefined]
              .filter(Boolean)
              .join(" / ")}
          </strong>
        </div>
        <div>
          <span>Revision/keying</span>
          <strong>
            {[
              module.majorRevision || module.minorRevision ? `${module.majorRevision ?? "0"}.${module.minorRevision ?? "0"}` : undefined,
              module.electronicKeying,
              module.inhibited ? "inhibited" : undefined,
            ]
              .filter(Boolean)
              .join(" / ") || "—"}
          </strong>
        </div>
      </div>
      {reviewRow?.advancedProfileReviewable ? (
        <p className="esco-detail__muted">{reviewRow.advancedProfileMessage}</p>
      ) : null}
      {reviewRow?.diagnostics.length ? (
        <>
          <h3>Offline Module Diagnostics</h3>
          <table className="esco-detail__table" aria-label="Synthetic module diagnostics">
            <tbody>
              {reviewRow.diagnostics.map((diagnostic) => (
                <tr key={`${diagnostic.source}-${diagnostic.label}`}>
                  <th>{diagnostic.status.toUpperCase()}</th>
                  <td>
                    <strong>{diagnostic.label}</strong>
                    <span>{diagnostic.detail}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}
    </section>
  );
}

function revisionLabel(module: IoModule): string {
  return module.majorRevision || module.minorRevision ? `${module.majorRevision ?? "0"}.${module.minorRevision ?? "0"}` : "—";
}

function moduleCatalogLabel(module: IoModule): string {
  return [module.catalogNumber, module.productType].filter(Boolean).join(" / ") || "Imported module";
}

function moduleStatusLabel(module: IoModule): string {
  return module.inhibited ? "Inhibited" : "Configured";
}

function inferChassisSlotCount(controller: Controller, modules: IoModule[], chassis?: IoModule): number {
  const source = `${controller.chassis ?? ""} ${chassis?.catalogNumber ?? ""} ${chassis?.name ?? ""}`;
  const match = /\bA(\d{1,2})\b/i.exec(source) ?? /\b(\d{1,2})-slot\b/i.exec(source);
  const declared = match ? Number(match[1]) : undefined;
  const highestUsed = Math.max(controller.slot ?? 0, ...modules.map((module) => module.slot ?? 0));
  return Math.max(declared && Number.isFinite(declared) ? declared : 10, highestUsed + 1, 1);
}

function nextOpenSlot(slotCount: number, usedSlots: Set<number>): string {
  for (let slot = 0; slot < slotCount; slot += 1) {
    if (!usedSlots.has(slot)) return String(slot);
  }
  return "Full";
}

/** Offline-editable I/O module tree: modules by slot, with an offline-only warning. */
function IoDetail({
  project,
  controllerId,
  moduleId,
  editing,
  onNewIoModule,
  onSelectIoModule,
  onIoModuleProperties,
  onToggleIoModuleInhibit,
  onDeleteIoModule,
}: {
  project: PlcProject;
  controllerId: string;
  moduleId?: string;
  editing?: StructureEditing;
  onNewIoModule?: (controllerId: string, initialQuery?: string, initialSlot?: number) => void;
  onSelectIoModule?: (controllerId: string, moduleId: string) => void;
  onIoModuleProperties?: (controllerId: string, moduleId: string) => void;
  onToggleIoModuleInhibit?: (controllerId: string, moduleId: string) => void;
  onDeleteIoModule?: (controllerId: string, moduleId: string) => void;
}) {
  const controller = project.controllers.find((c) => c.id === controllerId) ?? project.controllers[0];
  const allModules = controller?.ioConfiguration.modules ?? [];
  const reviewRows = controller ? ioModuleReviewReport(project).rows.filter((row) => row.controllerId === controller.id) : [];
  const reviewByModuleId = new Map(reviewRows.map((row) => [row.moduleId, row]));
  const chassis = allModules.find((module) => isBackplaneModule(module));
  const modules = [...allModules]
    .filter((module) => (controller ? !isBackplaneModule(module) && !isProcessorModule(module, controller) : true))
    .sort((a, b) => (a.slot ?? 0) - (b.slot ?? 0));
  const selectedModule = moduleId ? modules.find((module) => module.id === moduleId) : undefined;
  const processorSlot = controller?.slot ?? 0;
  const slotCount = controller ? inferChassisSlotCount(controller, allModules, chassis) : 0;
  const usedSlots = new Set<number>([
    processorSlot,
    ...modules.map((module) => module.slot).filter((slot): slot is number => slot != null),
  ]);
  const modulesBySlot = new Map<number, IoModule>();
  for (const module of modules) {
    if (module.slot != null) modulesBySlot.set(module.slot, module);
  }
  const selectedReviewRow = selectedModule ? reviewByModuleId.get(selectedModule.id) : undefined;
  const chassisLabel = chassis
    ? [chassis.name, chassis.catalogNumber].filter(Boolean).join(" / ")
    : controller?.chassis || "Local chassis";
  const chassisImageUrl = deviceImageUrl(chassis ? findIoDeviceCatalogEntry(chassis) ?? chassis : { imageKey: "chassis" });
  return (
    <div className="esco-detail esco-io-config">
      <header className="esco-detail__head">
        <h1 className="esco-detail__title">I/O Configuration{controller ? ` · ${controller.name}` : ""}</h1>
        <span className="esco-detail__readonly">{editing ? "Offline editable" : "Read-only"}</span>
      </header>
      <section className="esco-io-config__summary" aria-label="I/O configuration overview">
        <div className="esco-io-config__identity">
          <img className="esco-io-config__image" src={chassisImageUrl} alt="" aria-hidden="true" />
          <div>
            <span className="esco-io-config__eyebrow">Local Backplane</span>
            <strong>{chassisLabel}</strong>
            <small>{controller?.commPath ?? "No hardware path selected"}</small>
          </div>
        </div>
        <div className="esco-io-config__metrics">
          <div><span>Slots</span><strong>{slotCount}</strong></div>
          <div><span>Field modules</span><strong>{modules.length}</strong></div>
          <div><span>Next open slot</span><strong>{nextOpenSlot(slotCount, usedSlots)}</strong></div>
          <div><span>Connection</span><strong>Offline metadata</strong></div>
        </div>
        <div className="esco-io-config__actions" aria-label="I/O configuration actions">
          <button type="button" className="esco-btn esco-btn--primary" onClick={() => controller && onNewIoModule?.(controller.id)} disabled={!controller || !onNewIoModule}>
            New Module
          </button>
          <span>Right-click the backplane for the full New Module workflow.</span>
        </div>
      </section>

      <section className="esco-detail__section">
        <h2>Chassis Slots</h2>
        <div className="esco-io-slot-map" aria-label="Backplane slot map">
          {Array.from({ length: slotCount }, (_, slot) => {
            const module = modulesBySlot.get(slot);
            const isProcessor = slot === processorSlot;
            const selected = module?.id === moduleId;
            return (
              <button
                type="button"
                key={slot}
                className={`esco-io-slot${module || isProcessor ? " is-used" : ""}${selected ? " is-selected" : ""}${module?.inhibited ? " is-inhibited" : ""}`}
                onClick={() => {
                  if (!controller) return;
                  if (module) onSelectIoModule?.(controller.id, module.id);
                  else if (!isProcessor) onNewIoModule?.(controller.id, undefined, slot);
                }}
                disabled={!controller || (!module && isProcessor) || (!module && !onNewIoModule)}
                title={module ? `Select ${module.name}` : isProcessor ? "Controller processor slot" : `Create a module in slot ${slot}`}
              >
                <span>Slot {slot}</span>
                <strong>{module?.catalogNumber ?? (isProcessor ? controller?.catalogNumber ?? controller?.processorType ?? "Processor" : "Empty")}</strong>
                <small>{module?.name ?? (isProcessor ? controller?.name : "Available")}</small>
              </button>
            );
          })}
        </div>
      </section>

      <section className="esco-detail__section">
        <h2>Modules ({modules.length})</h2>
        {modules.length === 0 ? (
          <div className="esco-io-empty">
            <strong>No field I/O modules configured.</strong>
            <span>Use New Module or right-click the backplane to open the catalog and device definition workflow.</span>
          </div>
        ) : (
          <div className="esco-io-module-list" aria-label="Configured I/O modules">
            {modules.map((module) => {
              const reviewRow = reviewByModuleId.get(module.id);
              const review = moduleProfileReview(module);
              const diagnosticSummary = reviewRow
                ? `${reviewRow.diagnosticErrorCount} error / ${reviewRow.diagnosticWarningCount} warning`
                : "—";
              return (
              <article key={module.id} className={`esco-io-module-card${module.id === moduleId ? " is-selected" : ""}`}>
                <img className="esco-io-module-card__image" src={deviceImageUrl(review.catalogEntry ?? module)} alt="" aria-hidden="true" />
                <button
                  type="button"
                  className="esco-io-module-card__main"
                  onClick={() => controller && onSelectIoModule?.(controller.id, module.id)}
                >
                  <span>Slot {module.slot ?? "—"}</span>
                  <strong>{moduleCatalogLabel(module)}</strong>
                  <small>{module.name}</small>
                </button>
                <dl className="esco-io-module-card__meta">
                  <div><dt>Rev</dt><dd>{revisionLabel(module)}</dd></div>
                  <div><dt>Status</dt><dd>{reviewRow?.status === "needs-attention" ? "Needs attention" : moduleStatusLabel(module)}</dd></div>
                  <div><dt>Keying</dt><dd>{module.electronicKeying || "—"}</dd></div>
                  <div><dt>Diagnostics</dt><dd>{diagnosticSummary}</dd></div>
                </dl>
                <div className="esco-io-module-card__actions">
                  <button type="button" className="esco-btn esco-btn--xs" onClick={() => controller && onIoModuleProperties?.(controller.id, module.id)} disabled={!controller || !onIoModuleProperties}>
                    Properties
                  </button>
                  <button type="button" className="esco-btn esco-btn--xs" onClick={() => controller && onToggleIoModuleInhibit?.(controller.id, module.id)} disabled={!controller || !onToggleIoModuleInhibit}>
                    {module.inhibited ? "Uninhibit" : "Inhibit"}
                  </button>
                  <button type="button" className="esco-btn esco-btn--xs esco-btn--danger" onClick={() => controller && onDeleteIoModule?.(controller.id, module.id)} disabled={!controller || !onDeleteIoModule}>
                    Delete
                  </button>
                </div>
              </article>
              );
            })}
          </div>
        )}
      </section>
      {selectedModule ? <IoModuleProfileReview module={selectedModule} reviewRow={selectedReviewRow} /> : null}
    </div>
  );
}

/** Dispatches to the detail viewer/editor for the selected structure node. */
export function StructureView({
  project,
  selection,
  onOpenRoutine,
  editing,
  onNewIoModule,
  onSelectIoModule,
  onIoModuleProperties,
  onToggleIoModuleInhibit,
  onDeleteIoModule,
}: Props) {
  if (selection?.kind === "project") {
    return <ProjectDetail project={project} />;
  }
  if (selection?.kind === "controller") {
    const controller = findController(project, selection.id);
    if (controller) return <ControllerDetail controller={controller} />;
  }
  if (selection?.kind === "program") {
    const found = findProgram(project, selection.id);
    if (found) return <ProgramDetail controller={found.controller} program={found.program} onOpenRoutine={onOpenRoutine} />;
  }
  if (selection?.kind === "task") {
    const found = findTask(project, selection.id);
    if (found) return <TaskDetail controller={found.controller} task={found.task} />;
  }
  if (selection?.kind === "aoi") {
    const aoi = findAoi(project, selection.id);
    if (aoi) return <AoiDetail aoi={aoi} project={project} onOpenRoutine={onOpenRoutine} editing={editing} />;
  }
  if (selection?.kind === "udt") {
    const udt = findUdt(project, selection.id);
    if (udt) return <UdtDetail udt={udt} project={project} editing={editing} />;
  }
  if (selection?.kind === "trend") {
    const found = findTrend(project, selection.id);
    if (found) return <TrendDetail controller={found.controller} trend={found.trend} />;
  }
  if (selection?.kind === "io") {
    return (
      <IoDetail
        project={project}
        controllerId={selection.controllerId}
        moduleId={selection.moduleId}
        editing={editing}
        onNewIoModule={onNewIoModule}
        onSelectIoModule={onSelectIoModule}
        onIoModuleProperties={onIoModuleProperties}
        onToggleIoModuleInhibit={onToggleIoModuleInhibit}
        onDeleteIoModule={onDeleteIoModule}
      />
    );
  }
  return (
    <div className="esco-detail">
      <p className="esco-empty">Select a project, controller, task, program, Add-On Instruction, UDT, trend, or I/O module in the explorer.</p>
    </div>
  );
}
