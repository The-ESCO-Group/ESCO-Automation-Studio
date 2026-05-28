import type { AddOnInstruction, Controller, PlcProject, Program, Task, UserDefinedType } from "@esco/core";
import { aoiReferences, tagsUsingType, udtMemberPaths } from "@esco/project-actions";
import type { Selection } from "../selection";

interface Props {
  project: PlcProject;
  selection: Selection;
  onOpenRoutine: (routineId: string) => void;
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
  return String(value);
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
            <tr><th>Storage</th><td>Browser project export (.plcproj.json)</td></tr>
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

/** Read-only UDT detail: members (with array dims), member paths, and tags using it. */
function UdtDetail({ udt, project }: { udt: UserDefinedType; project: PlcProject }) {
  const tags = tagsUsingType(project, udt.name);
  const paths = udtMemberPaths(udt);
  return (
    <div className="esco-detail">
      <header className="esco-detail__head">
        <h1 className="esco-detail__title">Data Type · {udt.name}</h1>
        <span className="esco-detail__readonly">Read-only</span>
      </header>
      {udt.description ? <p className="esco-detail__desc">{udt.description}</p> : null}

      <section className="esco-detail__section">
        <h2>Members ({udt.members.length})</h2>
        {udt.members.length === 0 ? (
          <p className="esco-empty">No members imported.</p>
        ) : (
          <table className="esco-detail__table">
            <thead><tr><th>Member</th><th>Type</th><th>Dimension</th><th>Description</th></tr></thead>
            <tbody>
              {udt.members.map((m) => (
                <tr key={m.name}>
                  <td>{m.name}</td>
                  <td>{m.dataType}</td>
                  <td>{m.dimension ? `[${m.dimension}]` : "—"}</td>
                  <td>{m.description ?? ""}</td>
                </tr>
              ))}
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
                {t.dimension ? `[${t.dimension}]` : ""}
                <span className="esco-detail__muted"> · {t.programName ? `program ${t.programName}` : "controller"}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** Read-only Add-On Instruction detail: signature, parameters, local tags, calls. */
function AoiDetail({ aoi, project, onOpenRoutine }: { aoi: AddOnInstruction; project: PlcProject; onOpenRoutine: (id: string) => void }) {
  const references = aoiReferences(project, aoi.name);
  return (
    <div className="esco-detail">
      <header className="esco-detail__head">
        <h1 className="esco-detail__title">Add-On Instruction · {aoi.name}</h1>
        {aoi.revision ? <span className="esco-detail__tag">Rev {aoi.revision}</span> : null}
        {aoi.signature ? <span className="esco-detail__tag">Sig {aoi.signature}</span> : null}
        {aoi.protected ? <span className="esco-detail__tag esco-detail__tag--protected">Protected</span> : null}
        <span className="esco-detail__readonly">Read-only</span>
      </header>
      {aoi.description ? <p className="esco-detail__desc">{aoi.description}</p> : null}
      {aoi.protected ? (
        <p className="esco-detail__warning">
          Source-protected{aoi.protectionType ? ` (${aoi.protectionType})` : ""}. The logic is encrypted in the
          export and cannot be inspected; parameters and tags are shown where the export includes them.
        </p>
      ) : null}

      <section className="esco-detail__section">
        <h2>Parameters ({aoi.parameters.length})</h2>
        {aoi.parameters.length === 0 ? (
          <p className="esco-empty">No parameters imported.</p>
        ) : (
          <table className="esco-detail__table">
            <thead>
              <tr><th>Name</th><th>Type</th><th>Usage</th><th>Required</th><th>Default</th><th>Description</th></tr>
            </thead>
            <tbody>
              {aoi.parameters.map((p) => (
                <tr key={p.name}>
                  <td>{p.name}</td>
                  <td>{p.dataType}</td>
                  <td>{p.usage ?? "—"}</td>
                  <td>{p.required ? "yes" : "—"}</td>
                  <td>{p.defaultValue ?? "—"}</td>
                  <td>{p.description ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="esco-detail__section">
        <h2>Local tags ({aoi.localTags.length})</h2>
        {aoi.localTags.length === 0 ? (
          <p className="esco-empty">No local tags imported.</p>
        ) : (
          <table className="esco-detail__table">
            <thead><tr><th>Name</th><th>Type</th><th>Description</th></tr></thead>
            <tbody>
              {aoi.localTags.map((t) => (
                <tr key={t.name}><td>{t.name}</td><td>{t.dataType}</td><td>{t.description ?? ""}</td></tr>
              ))}
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
              <li key={name}>{name} <span className="esco-detail__muted">(logic preserved read-only)</span></li>
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

/** Read-only I/O module tree: modules by slot, with an offline-only warning. */
function IoDetail({ project, controllerId, moduleId }: { project: PlcProject; controllerId: string; moduleId?: string }) {
  const controller = project.controllers.find((c) => c.id === controllerId) ?? project.controllers[0];
  const modules = [...(controller?.ioConfiguration.modules ?? [])].sort(
    (a, b) => (a.slot ?? 0) - (b.slot ?? 0),
  );
  return (
    <div className="esco-detail">
      <header className="esco-detail__head">
        <h1 className="esco-detail__title">I/O Configuration{controller ? ` · ${controller.name}` : ""}</h1>
        <span className="esco-detail__readonly">Read-only</span>
      </header>
      <p className="esco-detail__warning">
        I/O configuration is imported metadata only. No controller communication.
      </p>

      <section className="esco-detail__section">
        <h2>Modules ({modules.length})</h2>
        {modules.length === 0 ? (
          <p className="esco-empty">No I/O modules imported.</p>
        ) : (
          <table className="esco-detail__table">
            <thead><tr><th>Name</th><th>Catalog / type</th><th>Slot</th><th>Parent</th><th>Comm path</th><th>Description</th></tr></thead>
            <tbody>
              {modules.map((m) => (
                <tr key={m.id} className={m.id === moduleId ? "is-selected" : undefined}>
                  <td>{m.name}</td>
                  <td>{m.catalogNumber ?? "—"}</td>
                  <td>{m.slot != null ? m.slot : "—"}</td>
                  <td>{m.parentModule ?? "—"}</td>
                  <td>{m.commPath ?? "—"}</td>
                  <td>{m.description ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

/** Dispatches to the read-only detail viewer for the selected structure node. */
export function StructureView({ project, selection, onOpenRoutine }: Props) {
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
    if (aoi) return <AoiDetail aoi={aoi} project={project} onOpenRoutine={onOpenRoutine} />;
  }
  if (selection?.kind === "udt") {
    const udt = findUdt(project, selection.id);
    if (udt) return <UdtDetail udt={udt} project={project} />;
  }
  if (selection?.kind === "io") {
    return <IoDetail project={project} controllerId={selection.controllerId} moduleId={selection.moduleId} />;
  }
  return (
    <div className="esco-detail">
      <p className="esco-empty">Select a project, controller, task, program, Add-On Instruction, UDT, or I/O module in the explorer.</p>
    </div>
  );
}
