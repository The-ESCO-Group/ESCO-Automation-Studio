import type { PlcProject } from "@esco/core";
import { collectTagReferences } from "@esco/project-actions";

interface Props {
  project: PlcProject;
  selectedTagName?: string;
  onOpenRoutine: (routineId: string) => void;
}

export function CrossRefPanel({ project, selectedTagName, onOpenRoutine }: Props) {
  if (!selectedTagName) {
    return (
      <p className="esco-empty">
        Select a tag in the Project Explorer to see where it is used.
      </p>
    );
  }

  const references = collectTagReferences(project, selectedTagName);
  return (
    <div className="esco-xref">
      <div className="esco-xref__head">
        {selectedTagName} — {references.length} reference(s)
      </div>
      {references.length === 0 ? (
        <p className="esco-empty">No references found in any routine.</p>
      ) : (
        <table className="esco-watch">
          <thead>
            <tr>
              <th>Routine</th>
              <th>Rung</th>
              <th>Instruction</th>
              <th>Operand</th>
              <th>Dir</th>
            </tr>
          </thead>
          <tbody>
            {references.map((reference, index) => (
              <tr
                key={`${reference.routineId}-${reference.rungId}-${index}`}
                className="esco-xref__row"
                title="Open routine"
                onClick={() => onOpenRoutine(reference.routineId)}
              >
                <td>{`${reference.programName}/${reference.routineName}`}</td>
                <td>{reference.rungNumber}</td>
                <td>{reference.instructionType}</td>
                <td>{reference.operand}</td>
                <td className={`esco-xref__dir esco-xref__dir--${reference.direction}`}>
                  {reference.direction}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
