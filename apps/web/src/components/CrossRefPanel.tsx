import type { PlcProject } from "@esco/core";
import { baseTagName, isNumericLiteral, referencedPaths } from "@esco/instructions";
import {
  getHmiProject,
  type HmiGraphicElement,
  type HmiPropertyBinding,
  type HmiSurfaceBase,
  type HmiSurfaceKind,
} from "@esco/hmi-model";
import { collectTagReferences } from "@esco/project-actions";
import type { Forces } from "../simulation";

interface Props {
  project: PlcProject;
  selectedTagName?: string;
  selectedRoutineId?: string;
  selectedRoutineName?: string;
  forces?: Forces;
  onOpenRoutine: (routineId: string) => void;
  onWatchTag?: (tagName: string) => void;
  onForceTag?: (tagName: string) => void;
  onCrossReferenceTag?: (tagName: string) => void;
}

type CrossRefClass = "read" | "write" | "output" | "hmi" | "force";

interface CrossRefRow {
  key: string;
  tag?: string;
  location: string;
  rung: string;
  source: string;
  reference: string;
  className: CrossRefClass;
  classLabel: string;
  routineId?: string;
}

type HmiSurfaceContext = Pick<HmiSurfaceBase, "id" | "kind" | "name">;

const OUTPUT_INSTRUCTIONS = new Set(["OTE", "OTL", "OTU", "ONS", "RES"]);

function tagCandidates(value: string | undefined): string[] {
  const text = value?.trim();
  if (!text || isNumericLiteral(text)) return [];
  const paths = referencedPaths(text);
  const candidates = paths.length ? paths : [text];
  return candidates.flatMap((candidate) => {
    const base = baseTagName(candidate);
    return base ? [candidate, base] : [candidate];
  });
}

function matchesSelectedTag(value: string | undefined, selectedTagName: string | undefined): boolean {
  if (!selectedTagName) return tagCandidates(value).length > 0;
  const selected = selectedTagName.toLowerCase();
  return tagCandidates(value).some((candidate) => candidate.toLowerCase() === selected);
}

function firstTagCandidate(value: string | undefined): string | undefined {
  return tagCandidates(value)[0];
}

function forceKeyMatches(forcePath: string, selectedTagName: string | undefined): boolean {
  if (!selectedTagName) return true;
  const selected = selectedTagName.toLowerCase();
  return forcePath.toLowerCase() === selected || baseTagName(forcePath).toLowerCase() === selected;
}

function bindingDirection(binding: HmiPropertyBinding): string {
  if (binding.mode === "write") return "write binding";
  if (binding.mode === "read-write") return "read/write binding";
  return "read binding";
}

function hmiRows(project: PlcProject, selectedTagName: string | undefined, selectedRoutineId: string | undefined): CrossRefRow[] {
  if (selectedRoutineId) return [];
  const hmi = getHmiProject(project);
  if (!hmi) return [];
  const rows: CrossRefRow[] = [];

  const addRow = (input: Omit<CrossRefRow, "className" | "classLabel" | "rung"> & { rung?: string }) => {
    rows.push({
      ...input,
      rung: input.rung ?? "-",
      className: "hmi",
      classLabel: "HMI",
    });
  };

  const scanElement = (surface: HmiSurfaceContext, element: HmiGraphicElement) => {
    const location = `${surface.name}/${element.name}`;
    for (const binding of element.bindings) {
      if (binding.source.kind !== "tag" || !matchesSelectedTag(binding.source.path, selectedTagName)) continue;
      addRow({
        key: `hmi:${surface.kind}:${surface.id}:element:${element.id}:binding:${binding.id}`,
        tag: firstTagCandidate(binding.source.path),
        location,
        source: `HMI ${bindingDirection(binding)}`,
        reference: `${binding.targetProperty} <- ${binding.source.path}`,
      });
    }
    for (const animation of element.animations) {
      if (animation.source.kind !== "tag" || !matchesSelectedTag(animation.source.path, selectedTagName)) continue;
      addRow({
        key: `hmi:${surface.kind}:${surface.id}:element:${element.id}:animation:${animation.id}`,
        tag: firstTagCandidate(animation.source.path),
        location,
        source: "HMI animation",
        reference: `${animation.targetProperty} <- ${animation.source.path}`,
      });
    }
    for (const event of element.events) {
      for (const command of event.commands) {
        for (const [key, value] of Object.entries(command.args)) {
          if (typeof value !== "string" || !matchesSelectedTag(value, selectedTagName)) continue;
          addRow({
            key: `hmi:${surface.kind}:${surface.id}:element:${element.id}:event:${event.id}:command:${command.id}:arg:${key}`,
            tag: firstTagCandidate(value),
            location,
            source: `HMI ${event.eventType}`,
            reference: `${command.type} ${key}: ${value}`,
          });
        }
      }
    }
  };

  const surfaces: HmiSurfaceBase[] = [...hmi.screens, ...hmi.popups, hmi.systemBanner];
  for (const surface of surfaces) {
    for (const element of surface.elements) scanElement(surface, element);
  }
  for (const graphic of hmi.addOnGraphics) {
    const surface = { id: graphic.id, kind: "add-on-graphic" as HmiSurfaceKind, name: graphic.name };
    for (const element of graphic.elements) scanElement(surface, element);
  }
  for (const alarm of hmi.alarms) {
    if (!matchesSelectedTag(alarm.tagPath, selectedTagName)) continue;
    addRow({
      key: `hmi:alarm:${alarm.id}`,
      tag: firstTagCandidate(alarm.tagPath),
      location: `Alarm/${alarm.name}`,
      source: "HMI alarm",
      reference: alarm.tagPath,
    });
  }
  for (const trend of hmi.trends) {
    for (const trace of trend.traces) {
      if (trace.source.kind !== "tag" || !matchesSelectedTag(trace.source.path, selectedTagName)) continue;
      addRow({
        key: `hmi:trend:${trend.id}:trace:${trace.id}`,
        tag: firstTagCandidate(trace.source.path),
        location: `Trend/${trend.name}`,
        source: "HMI trend",
        reference: `${trace.label}: ${trace.source.path}`,
      });
    }
  }
  for (const log of hmi.dataLogs) {
    for (const tagPath of log.tagPaths) {
      if (!matchesSelectedTag(tagPath, selectedTagName)) continue;
      addRow({
        key: `hmi:data-log:${log.id}:tag:${tagPath}`,
        tag: firstTagCandidate(tagPath),
        location: `Data Log/${log.name}`,
        source: "HMI data log",
        reference: tagPath,
      });
    }
    if (matchesSelectedTag(log.statusTagPath, selectedTagName)) {
      addRow({
        key: `hmi:data-log:${log.id}:status`,
        tag: firstTagCandidate(log.statusTagPath),
        location: `Data Log/${log.name}`,
        source: "HMI data log status",
        reference: log.statusTagPath ?? "",
      });
    }
  }
  return rows;
}

function forceRows(forces: Forces | undefined, selectedTagName: string | undefined, selectedRoutineId: string | undefined): CrossRefRow[] {
  if (selectedRoutineId || !forces) return [];
  return Object.keys(forces)
    .filter((path) => forceKeyMatches(path, selectedTagName))
    .map((path) => ({
      key: `force:${path}`,
      tag: baseTagName(path) || path,
      location: "Offline Forces",
      rung: "-",
      source: "Force table",
      reference: `${path} = ${String(forces[path])}`,
      className: "force" as const,
      classLabel: "Force",
    }));
}

function referenceRows(project: PlcProject, selectedTagName: string | undefined, selectedRoutineId: string | undefined): CrossRefRow[] {
  return collectTagReferences(project, selectedTagName)
    .filter((reference) => !selectedRoutineId || reference.routineId === selectedRoutineId)
    .map((reference, index) => {
      const className: CrossRefClass =
        reference.direction === "write" && OUTPUT_INSTRUCTIONS.has(reference.instructionType) ? "output" : reference.direction;
      return {
        key: `logic:${reference.routineId}:${reference.rungId}:${index}`,
        tag: reference.tag,
        location: `${reference.programName}/${reference.routineName}`,
        rung: String(reference.rungNumber),
        source: reference.instructionType,
        reference: reference.operand,
        className,
        classLabel: className === "output" ? "Output" : reference.direction === "write" ? "Write" : "Read",
        routineId: reference.routineId,
      };
    });
}

export function CrossRefPanel({
  project,
  selectedTagName,
  selectedRoutineId,
  selectedRoutineName,
  forces,
  onOpenRoutine,
  onWatchTag,
  onForceTag,
  onCrossReferenceTag,
}: Props) {
  const references = [
    ...referenceRows(project, selectedTagName, selectedRoutineId),
    ...hmiRows(project, selectedTagName, selectedRoutineId),
    ...forceRows(forces, selectedTagName, selectedRoutineId),
  ];
  const title = selectedTagName
    ? selectedRoutineName
      ? `${selectedTagName} in ${selectedRoutineName}`
      : selectedTagName
    : selectedRoutineName
      ? `${selectedRoutineName} routine`
      : "Project";

  return (
    <div className="esco-xref">
      <div className="esco-xref__head">
        <span>
          {title} - {references.length} reference(s)
        </span>
        {selectedTagName ? (
          <span className="esco-xref__actions">
            <button type="button" className="esco-btn esco-btn--quick" disabled={!onWatchTag} onClick={() => onWatchTag?.(selectedTagName)}>
              Watch
            </button>
            <button type="button" className="esco-btn esco-btn--quick" disabled={!onCrossReferenceTag} onClick={() => onCrossReferenceTag?.(selectedTagName)}>
              Cross Reference
            </button>
            <button type="button" className="esco-btn esco-btn--quick" disabled={!onForceTag} onClick={() => onForceTag?.(selectedTagName)}>
              Force
            </button>
          </span>
        ) : null}
      </div>
      {references.length === 0 ? (
        <p className="esco-empty">
          {selectedTagName || selectedRoutineId
            ? "No references found for the current selection."
            : "No tag references found in this project."}
        </p>
      ) : (
        <table className="esco-watch">
          <thead>
            <tr>
              <th>Location</th>
              <th>Rung</th>
              <th>Source</th>
              <th>Reference</th>
              <th>Class</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {references.map((reference) => (
              <tr
                key={reference.key}
                className="esco-xref__row"
                title={reference.routineId ? "Open routine" : reference.location}
                onClick={() => {
                  if (reference.routineId) onOpenRoutine(reference.routineId);
                }}
              >
                <td>{reference.location}</td>
                <td>{reference.rung}</td>
                <td>{reference.source}</td>
                <td>{reference.reference}</td>
                <td className={`esco-xref__dir esco-xref__dir--${reference.className}`}>
                  {reference.classLabel}
                </td>
                <td>
                  {reference.routineId ? (
                    <button
                      type="button"
                      className="esco-btn esco-btn--quick"
                      onClick={(event) => {
                        event.stopPropagation();
                        onOpenRoutine(reference.routineId!);
                      }}
                    >
                      Open
                    </button>
                  ) : null}
                  {reference.tag ? (
                    <>
                      <button
                        type="button"
                        className="esco-btn esco-btn--quick"
                        disabled={!onWatchTag}
                        onClick={(event) => {
                          event.stopPropagation();
                          onWatchTag?.(reference.tag!);
                        }}
                      >
                        Watch
                      </button>
                      <button
                        type="button"
                        className="esco-btn esco-btn--quick"
                        disabled={!onCrossReferenceTag}
                        onClick={(event) => {
                          event.stopPropagation();
                          onCrossReferenceTag?.(reference.tag!);
                        }}
                      >
                        XRef
                      </button>
                    </>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
