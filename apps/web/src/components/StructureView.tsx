import type { AddOnInstruction, PlcProject, UserDefinedType } from "@esco/core";
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
        <span className="esco-detail__readonly">Read-only</span>
      </header>
      {aoi.description ? <p className="esco-detail__desc">{aoi.description}</p> : null}

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
          <p className="esco-empty">No routines imported (logic not available).</p>
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
      <p className="esco-empty">Select an Add-On Instruction, UDT, or I/O module in the explorer.</p>
    </div>
  );
}
