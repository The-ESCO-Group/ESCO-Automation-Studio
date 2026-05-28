import type { AddOnInstruction, PlcProject } from "@esco/core";
import { aoiReferences } from "@esco/project-actions";
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

/** Dispatches to the read-only detail viewer for the selected structure node. */
export function StructureView({ project, selection, onOpenRoutine }: Props) {
  if (selection?.kind === "aoi") {
    const aoi = findAoi(project, selection.id);
    if (aoi) return <AoiDetail aoi={aoi} project={project} onOpenRoutine={onOpenRoutine} />;
  }
  return (
    <div className="esco-detail">
      <p className="esco-empty">Select an Add-On Instruction, UDT, or I/O module in the explorer.</p>
    </div>
  );
}
