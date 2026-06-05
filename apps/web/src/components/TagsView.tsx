import { useEffect, useMemo, useState } from "react";
import type { ExternalAccess, PlcProject, Tag, TagComment, TagEngineeringUnit } from "@esco/core";
import { STRUCTURED_TYPES, TAG_DATA_TYPES, arrayDimensionsOf } from "@esco/core";
import { collectTagReferences, outputTags, tagCommentPreview, tagCommentRows } from "@esco/project-actions";
import { getTags } from "../project-edit";
import {
  coerceMonitorWriteValue,
  monitorTagValue,
  type Forces,
  type MonitorTagValue,
  type TagValues,
} from "../simulation";
import { capList } from "../windowing";
import { requestConfirmation } from "../confirmation";

/** Max tag rows rendered at once; search narrows large tag sets below this. */
const TAG_ROW_LIMIT = 200;
const TAG_FILTER_STORAGE_KEY = "esco.tags.filter";

/** ESCO Studio display radices ("Style"); mirrors the project-action's accepted set. */
const TAG_RADIX_OPTIONS = ["Binary", "Octal", "Decimal", "Hex", "ASCII", "Float", "Exponential"];
const ESCO_SCALAR_TYPES = ["BOOL", "SINT", "INT", "DINT", "LINT", "USINT", "UINT", "UDINT", "ULINT", "REAL", "LREAL", "STRING"];

interface Props {
  project: PlcProject;
  values: TagValues;
  onAddTag: (
    name: string,
    dataType: string,
    description: string,
    dimensions?: number[],
    scope?: "controller" | "program",
    programId?: string,
  ) => void;
  onRenameTag: (tag: Tag, to: string) => void;
  onDeleteTag: (tag: Tag) => void;
  onEditDescription: (tag: Tag, description: string) => void;
  onSetDataType: (tag: Tag, dataType: string) => void;
  onSetDimensions: (tag: Tag, dimensions: number[]) => void;
  onSetMetadata: (tag: Tag, patch: { externalAccess?: ExternalAccess | ""; constant?: boolean; radix?: string }) => void;
  onSetAlias: (tag: Tag, aliasFor: string) => void;
  onSetComments: (tag: Tag, comments: TagComment[]) => void;
  onSetEngineeringUnits: (tag: Tag, engineeringUnits: TagEngineeringUnit[]) => void;
  forces: Forces;
  onSetValue: (path: string, value: boolean | number | string) => void;
  onToggleForce: (path: string) => void;
  onWatchTag?: (tagName: string) => void;
  onCrossReferenceTag?: (tagName: string) => void;
  onExportCsv: () => void;
  onImportCsv: () => void;
  onExportTagComponent?: (tag: Tag) => void;
}

interface TagRow {
  tag: Tag;
  role: "input" | "output" | "internal";
  references: number;
  monitor: MonitorTagValue;
  canWrite: boolean;
  writeBlockedReason?: string;
  canForce: boolean;
}

interface ProgramOption {
  id: string;
  name: string;
  controllerName: string;
}

function sameName(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function owningProgram(project: PlcProject, tag: Tag) {
  if (tag.scope !== "program" || !tag.programId) return undefined;
  for (const controller of project.controllers) {
    const program = controller.programs.find((candidate) => candidate.id === tag.programId);
    if (program) return program;
  }
  return undefined;
}

function tagValuePath(project: PlcProject, tag: Tag): string {
  const program = owningProgram(project, tag);
  return program ? `Program:${program.name}.${tag.name}` : tag.name;
}

function programHasLocal(project: PlcProject, programName: string, tagName: string): boolean {
  for (const controller of project.controllers) {
    const program = controller.programs.find((candidate) => sameName(candidate.name, programName));
    if (program?.programTags.some((tag) => sameName(tag.name, tagName))) return true;
  }
  return false;
}

function referenceCountForTag(project: PlcProject, tag: Tag, refs: ReturnType<typeof collectTagReferences>): number {
  if (tag.scope === "program") {
    const program = owningProgram(project, tag);
    if (!program) return 0;
    const qualified = `Program:${program.name}.${tag.name}`;
    return refs.filter((ref) =>
      (sameName(ref.tag, tag.name) && sameName(ref.programName, program.name)) ||
      sameName(ref.tag, qualified)
    ).length;
  }
  return refs.filter((ref) =>
    sameName(ref.tag, tag.name) && !programHasLocal(project, ref.programName, tag.name)
  ).length;
}

function monitorWriteBlockedReason(tag: Tag, role: TagRow["role"], monitor: MonitorTagValue): string | undefined {
  if (monitor.kind === "aggregate") return "Array and structured tags are display-only in the monitor grid.";
  if (role === "output") return "Logic writes this tag during the offline scan.";
  if (tag.constant) return "Constant tags cannot be written from monitor mode.";
  if (tag.consumed) return "Consumed tags are driven by their producer.";
  return undefined;
}

function MonitorValueCell({
  tag,
  row,
  forced,
  onSetValue,
}: {
  tag: Tag;
  row: TagRow;
  forced: boolean;
  onSetValue: (path: string, value: boolean | number | string) => void;
}) {
  const forcedMark = forced ? <span className="esco-watch__forced" title="Forced offline value">F</span> : null;
  const title = row.writeBlockedReason ?? "Offline simulation value";

  if (!row.canWrite) {
    return (
      <span className="esco-tags__value" title={title}>
        {row.monitor.display} {forcedMark}
      </span>
    );
  }

  if (row.monitor.kind === "bool") {
    const on = row.monitor.value === true;
    return (
      <span className="esco-watch__bool" title={title}>
        <button
          type="button"
          className={`esco-btn esco-btn--toggle${on ? " is-on" : ""}`}
          aria-label={`Toggle value for ${tag.name}`}
          onClick={() => onSetValue(row.monitor.path, !on)}
        >
          {on ? "true" : "false"}
        </button>
        {forcedMark}
      </span>
    );
  }

  if (row.monitor.kind === "string") {
    return (
      <span className="esco-watch__bool" title={title}>
        <input
          className="esco-tags__cell-input"
          value={String(row.monitor.value ?? "")}
          spellCheck={false}
          aria-label={`Value for ${tag.name}`}
          onChange={(event) => onSetValue(row.monitor.path, event.target.value)}
        />
        {forcedMark}
      </span>
    );
  }

  return (
    <span className="esco-watch__bool" title={title}>
      <input
        className="esco-tags__cell-input"
        type="number"
        value={Number(row.monitor.value ?? 0)}
        aria-label={`Value for ${tag.name}`}
        onChange={(event) => {
          const next = coerceMonitorWriteValue(tag.dataType, event.target.value);
          if (next !== undefined) onSetValue(row.monitor.path, next);
        }}
      />
      {forcedMark}
    </span>
  );
}

function dimensionText(tag: Tag): string {
  return arrayDimensionsOf(tag).join(",");
}

function parseDimensionText(value: string): number[] {
  const text = value.trim();
  if (!text) return [];
  return text.split(/[\s,]+/).filter(Boolean).map((part) => Number(part));
}

function dimensionErrorText(value: string): string | undefined {
  const text = value.trim();
  if (!text) return undefined;
  const dimensions = parseDimensionText(text);
  if (dimensions.some((dimension) => !Number.isInteger(dimension) || dimension <= 0)) {
    return "Dimensions must be positive whole numbers.";
  }
  return undefined;
}

function invalidLogixIdentifierReason(name: string): string | undefined {
  if (name.length === 0) return "Tag name is required.";
  if (name.length > 40) return "Tag names are limited to 40 characters.";
  if (!/^[A-Za-z_]/.test(name)) return "Tag names must begin with a letter or underscore.";
  if (!/^[A-Za-z0-9_]+$/.test(name)) return "Tag names may only contain letters, digits, and underscores.";
  if (name.includes("__")) return "Tag names cannot contain consecutive underscores.";
  if (name.endsWith("_")) return "Tag names cannot end with an underscore.";
  return undefined;
}

function usageText(tag: Tag): string {
  if (tag.aliasFor) return "Alias";
  if (tag.produced) return "Produced";
  if (tag.consumed) return "Consumed";
  return "Base";
}

function baseTagText(tag: Tag): string {
  const alias = tag.aliasFor?.trim();
  if (!alias) return "";
  return alias.split(/[.[\]]/).find(Boolean) ?? alias;
}

function annotationText(rows: readonly (TagComment | TagEngineeringUnit)[] | undefined): string {
  return rows?.map((row) => `${row.operand.trim()}=${row.text}`).join(" | ") ?? "";
}

function parseAnnotationText(value: string): TagComment[] {
  return value
    .split(/\s*\|\s*/)
    .filter((part) => part.trim().length > 0)
    .map((part) => {
      const equals = part.indexOf("=");
      if (equals < 0) return { operand: "", text: part.trim() };
      return {
        operand: part.slice(0, equals).trim(),
        text: part.slice(equals + 1).trim(),
      };
    })
    .filter((row) => row.operand || row.text);
}

function annotationPreview(rows: readonly (TagComment | TagEngineeringUnit)[] | undefined): string {
  if (!rows?.length) return "";
  const shown = rows.slice(0, 3).map((row) => `${row.operand || "<tag>"}: ${row.text}`);
  return `${shown.join("; ")}${rows.length > shown.length ? `; +${rows.length - shown.length} more` : ""}`;
}

function sameTagScope(tag: Tag, scope: "controller" | "program", programId?: string): boolean {
  return tag.scope === scope && (scope === "controller" || tag.programId === programId);
}

function tagNameExists(project: PlcProject, name: string, scope: "controller" | "program", programId?: string, excludeId?: string): boolean {
  return getTags(project).some((tag) =>
    tag.id !== excludeId && sameTagScope(tag, scope, programId) && sameName(tag.name, name),
  );
}

function storedTagFilter(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(TAG_FILTER_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

function uniqueTypes(types: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of types) {
    const type = raw.trim();
    const key = type.toUpperCase();
    if (!type || seen.has(key)) continue;
    seen.add(key);
    result.push(type);
  }
  return result.sort((left, right) => left.localeCompare(right));
}

export function TagsView({
  project,
  values,
  onAddTag,
  onRenameTag,
  onDeleteTag,
  onEditDescription,
  onSetDataType,
  onSetDimensions,
  onSetMetadata,
  onSetAlias,
  onSetComments,
  onSetEngineeringUnits,
  forces,
  onSetValue,
  onToggleForce,
  onWatchTag,
  onCrossReferenceTag,
  onExportCsv,
  onImportCsv,
  onExportTagComponent,
}: Props) {
  const [mode, setMode] = useState<"monitor" | "edit">("edit");
  const [filter, setFilter] = useState(storedTagFilter);
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState("BOOL");
  const [newScope, setNewScope] = useState<"controller" | "program">("controller");
  const [newProgramId, setNewProgramId] = useState("");
  const [newDimensions, setNewDimensions] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [selectedControllerId, setSelectedControllerId] = useState(project.controllers[0]?.id ?? "");

  useEffect(() => {
    if (project.controllers.some((controller) => controller.id === selectedControllerId)) return;
    setSelectedControllerId(project.controllers[0]?.id ?? "");
  }, [project.controllers, selectedControllerId]);

  useEffect(() => {
    try {
      window.localStorage.setItem(TAG_FILTER_STORAGE_KEY, filter);
    } catch {
      // Ignore storage failures; the grid still works without persistence.
    }
  }, [filter]);

  const rows = useMemo<TagRow[]>(() => {
    const outputs = outputTags(project);
    const refs = collectTagReferences(project);
    return getTags(project).map((tag) => {
      const references = referenceCountForTag(project, tag, refs);
      const path = tagValuePath(project, tag);
      const role: TagRow["role"] = outputs.has(path) ? "output" : references > 0 ? "input" : "internal";
      const monitor = monitorTagValue(project, values, tag);
      const writeBlockedReason = monitorWriteBlockedReason(tag, role, monitor);
      return {
        tag,
        role,
        references,
        monitor,
        canWrite: !writeBlockedReason,
        writeBlockedReason,
        canForce: monitor.kind !== "aggregate",
      };
    });
  }, [project, values]);
  const scopedRows = useMemo(
    () => rows.filter((row) => !selectedControllerId || row.tag.controllerId === selectedControllerId),
    [rows, selectedControllerId],
  );
  const dataTypeOptions = useMemo(() => uniqueTypes([
    ...ESCO_SCALAR_TYPES,
    ...TAG_DATA_TYPES,
    ...Object.keys(STRUCTURED_TYPES),
    ...project.controllers.flatMap((controller) => controller.dataTypes.map((dataType) => dataType.name)),
    ...project.controllers.flatMap((controller) => controller.addOnInstructions.map((aoi) => aoi.name)),
  ]), [project]);
  const programOptions = useMemo<ProgramOption[]>(() =>
    project.controllers
      .filter((controller) => !selectedControllerId || controller.id === selectedControllerId)
      .flatMap((controller) =>
      controller.programs.map((program) => ({
        id: program.id,
        name: program.name,
        controllerName: controller.name,
      })),
    ),
  [project, selectedControllerId]);
  const selectedProgramId =
    programOptions.some((program) => program.id === newProgramId)
      ? newProgramId
      : programOptions[0]?.id || "";
  const addName = newName.trim();
  const addDimensionError = dimensionErrorText(newDimensions);
  const addError =
    invalidLogixIdentifierReason(addName) ||
    addDimensionError ||
    (newScope === "program" && !selectedProgramId ? "Choose a program for the local tag." : undefined) ||
    (tagNameExists(project, addName, newScope, newScope === "program" ? selectedProgramId : undefined)
      ? `${newScope === "program" ? "Program" : "Controller"} tag "${addName}" already exists.`
      : undefined);
  const canAdd = !addError;

  const term = filter.trim().toLowerCase();
  const visible = useMemo(
    () =>
      term
        ? scopedRows.filter((r) =>
              r.tag.name.toLowerCase().includes(term) ||
              r.tag.dataType.toLowerCase().includes(term) ||
              usageText(r.tag).toLowerCase().includes(term) ||
              (r.tag.aliasFor ?? "").toLowerCase().includes(term) ||
              baseTagText(r.tag).toLowerCase().includes(term) ||
              (r.tag.externalAccess ?? "").toLowerCase().includes(term) ||
              (r.tag.radix ?? "").toLowerCase().includes(term) ||
              (r.tag.description ?? "").toLowerCase().includes(term) ||
              r.monitor.display.toLowerCase().includes(term) ||
              annotationText(r.tag.comments).toLowerCase().includes(term) ||
              annotationText(r.tag.engineeringUnits).toLowerCase().includes(term) ||
              tagCommentRows(r.tag).some((comment) =>
                comment.path.toLowerCase().includes(term) || comment.text.toLowerCase().includes(term),
              ),
          )
        : scopedRows,
    [scopedRows, term],
  );
  // Cap rendered rows for very large projects (search to narrow down).
  const windowed = capList(visible, TAG_ROW_LIMIT);

  const handleAdd = () => {
    const name = newName.trim();
    if (!canAdd) return;
    onAddTag(
      name,
      newType,
      newDesc.trim(),
      parseDimensionText(newDimensions),
      newScope,
      newScope === "program" ? selectedProgramId : undefined,
    );
    setNewName("");
    setNewDimensions("");
    setNewDesc("");
  };

  return (
    <div className="esco-tags">
      <div className="esco-tags__bar">
        <label className="esco-tags__field">
          <span>Scope:</span>
          <select
            className="esco-tags__select"
            value={selectedControllerId}
            onChange={(e) => {
              setSelectedControllerId(e.target.value);
              setNewProgramId("");
            }}
          >
            {project.controllers.map((controller) => (
              <option key={controller.id} value={controller.id}>{controller.name}</option>
            ))}
          </select>
        </label>
        <label className="esco-tags__field esco-tags__field--show">
          <span>Show:</span>
          <input
            className="esco-tags__search"
            value={filter}
            placeholder="Search tags, aliases, comments, units"
            onChange={(e) => setFilter(e.target.value)}
            spellCheck={false}
          />
        </label>
        <span className="esco-tags__count">{visible.length} of {scopedRows.length} tags</span>
        <button type="button" className="esco-btn" onClick={onExportCsv}>
          Export CSV
        </button>
        <button type="button" className="esco-btn" onClick={onImportCsv}>
          Import CSV
        </button>
      </div>

      <div className="esco-tags__add">
        <input
          className="esco-tags__input"
          placeholder="New tag name"
          value={newName}
          spellCheck={false}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleAdd();
          }}
        />
        <input
          className="esco-tags__input"
          list="esco-tag-data-types"
          placeholder="Data type"
          value={newType}
          spellCheck={false}
          onChange={(e) => setNewType(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleAdd();
          }}
        />
        <select
          className="esco-tags__select"
          value={newScope}
          aria-label="New tag scope"
          onChange={(e) => setNewScope(e.target.value as "controller" | "program")}
        >
          <option value="controller">Controller</option>
          <option value="program" disabled={programOptions.length === 0}>Program</option>
        </select>
        <select
          className="esco-tags__select"
          value={selectedProgramId}
          aria-label="New tag program"
          disabled={newScope !== "program" || programOptions.length === 0}
          onChange={(e) => setNewProgramId(e.target.value)}
        >
          {programOptions.map((program) => (
            <option key={program.id} value={program.id}>
              {programOptions.length > 1 ? `${program.controllerName}/${program.name}` : program.name}
            </option>
          ))}
        </select>
        <input
          className="esco-tags__input"
          placeholder="Dims (optional)"
          value={newDimensions}
          spellCheck={false}
          onChange={(e) => setNewDimensions(e.target.value)}
        />
        <input
          className="esco-tags__input"
          placeholder="Description (optional)"
          value={newDesc}
          spellCheck={false}
          onChange={(e) => setNewDesc(e.target.value)}
        />
        <button
          type="button"
          className="esco-btn esco-btn--primary"
          disabled={!canAdd}
          title={addError ?? "Add tag"}
          onClick={handleAdd}
        >
          Add Tag
        </button>
      </div>

      <div className="esco-tags__grid">
        <table className="esco-tags__table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Usage</th>
              <th>Alias For</th>
              <th>Base Tag</th>
              <th>Data Type</th>
              <th>Dimension</th>
              <th>Style</th>
              <th>Description</th>
              <th>Comments</th>
              <th>Engineering Units</th>
              <th>External Access</th>
              <th>Constant</th>
              {mode === "monitor" ? <th>Value</th> : null}
              {mode === "monitor" ? <th>Watch</th> : null}
              {mode === "monitor" ? <th>XRef</th> : null}
              {mode === "monitor" ? <th>Force</th> : null}
              <th className="esco-tags__command-head" aria-label="Commands" />
            </tr>
          </thead>
          <tbody>
            {windowed.items.length === 0 ? (
              <tr className="esco-tags__blank-row">
                <td colSpan={mode === "monitor" ? 17 : 13} />
              </tr>
            ) : (
              windowed.items.map((row) => {
                const { tag, references, monitor } = row;
                const forced = monitor.path in forces;
                return (
                <tr key={tag.id} className={forced ? "is-forced" : undefined}>
                  <td>
                    <input
                      className="esco-tags__cell-input"
                      defaultValue={tag.name}
                      spellCheck={false}
                      title="Rename (commits on blur)"
                      onBlur={(e) => {
                        const next = e.target.value.trim();
                        if (!next || next === tag.name) {
                          e.currentTarget.value = tag.name;
                          return;
                        }
                        const nameError = invalidLogixIdentifierReason(next);
                        const duplicate = tagNameExists(project, next, tag.scope, tag.programId, tag.id);
                        if (nameError || duplicate) {
                          e.currentTarget.value = tag.name;
                          return;
                        }
                        onRenameTag(tag, next);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") e.currentTarget.blur();
                      }}
                    />
                  </td>
                  <td>{usageText(tag)}</td>
                  <td>
                    <input
                      className="esco-tags__cell-input esco-tags__cell-input--alias"
                      list="esco-tag-names"
                      defaultValue={tag.aliasFor ?? ""}
                      placeholder="—"
                      spellCheck={false}
                      aria-label={`Alias target for ${tag.name}`}
                      title="Base tag this tag aliases (commits on blur; blank clears)"
                      onBlur={(e) => {
                        if (e.target.value.trim() !== (tag.aliasFor ?? "")) onSetAlias(tag, e.target.value);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") e.currentTarget.blur();
                      }}
                    />
                  </td>
                  <td>{baseTagText(tag) || "—"}</td>
                  <td>
                    <input
                      className="esco-tags__cell-input"
                      list="esco-tag-data-types"
                      defaultValue={tag.dataType}
                      spellCheck={false}
                      aria-label={`Data type for ${tag.name}`}
                      title="Data type (commits on blur)"
                      onBlur={(e) => {
                        const next = e.target.value.trim();
                        if (next && next !== tag.dataType) onSetDataType(tag, next);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") e.currentTarget.blur();
                      }}
                    />
                  </td>
                  <td>
                    <input
                      className="esco-tags__cell-input"
                      defaultValue={dimensionText(tag)}
                      placeholder="—"
                      spellCheck={false}
                      aria-label={`Dimensions for ${tag.name}`}
                      title="Array dimensions, e.g. 8 or 2,3 (commits on blur; blank clears)"
                      onBlur={(e) => {
                        if (e.target.value.trim() !== dimensionText(tag)) {
                          onSetDimensions(tag, parseDimensionText(e.target.value));
                        }
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") e.currentTarget.blur();
                      }}
                    />
                  </td>
                  <td>
                    <select
                      className="esco-tags__cell-select"
                      value={tag.radix ?? ""}
                      aria-label={`Display style for ${tag.name}`}
                      title="ESCO Studio display radix (Style); display-only, round-trips through L5X"
                      onChange={(e) => onSetMetadata(tag, { radix: e.target.value })}
                    >
                      <option value="">Default</option>
                      {TAG_RADIX_OPTIONS.map((radix) => (
                        <option key={radix} value={radix}>{radix}</option>
                      ))}
                    </select>
                  </td>
                  <td title={tagCommentPreview(tag) || "No element/member comments"}>
                    <input
                      className="esco-tags__cell-input"
                      defaultValue={tag.description ?? ""}
                      placeholder="—"
                      spellCheck={false}
                      onBlur={(e) => {
                        if (e.target.value !== (tag.description ?? "")) onEditDescription(tag, e.target.value);
                      }}
                    />
                  </td>
                  <td title={tagCommentPreview(tag) || "Use operand=text pairs separated by |"}>
                    <input
                      className="esco-tags__cell-input esco-tags__cell-input--annotation"
                      defaultValue={annotationText(tag.comments)}
                      placeholder="—"
                      spellCheck={false}
                      aria-label={`Comments for ${tag.name}`}
                      title="Element/member comments, e.g. .Speed=Commanded speed | [0]=First element"
                      onBlur={(e) => {
                        const current = annotationText(tag.comments);
                        const next = e.target.value.trim();
                        if (next !== current) onSetComments(tag, parseAnnotationText(next));
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") e.currentTarget.blur();
                      }}
                    />
                  </td>
                  <td title={annotationPreview(tag.engineeringUnits) || "Use operand=unit pairs separated by |"}>
                    <input
                      className="esco-tags__cell-input esco-tags__cell-input--annotation"
                      defaultValue={annotationText(tag.engineeringUnits)}
                      placeholder="—"
                      spellCheck={false}
                      aria-label={`Engineering units for ${tag.name}`}
                      title="Engineering units, e.g. =psi | .Speed=RPM | [0]=gal/min"
                      onBlur={(e) => {
                        const current = annotationText(tag.engineeringUnits);
                        const next = e.target.value.trim();
                        if (next !== current) onSetEngineeringUnits(tag, parseAnnotationText(next));
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") e.currentTarget.blur();
                      }}
                    />
                  </td>
                  <td>
                    <select
                      className="esco-tags__cell-select"
                      value={tag.externalAccess ?? ""}
                      aria-label={`External access for ${tag.name}`}
                      title="ESCO Studio ExternalAccess metadata"
                      onChange={(e) => onSetMetadata(tag, { externalAccess: e.target.value as ExternalAccess | "" })}
                    >
                      <option value="">Default</option>
                      <option value="read-write">Read/Write</option>
                      <option value="read-only">Read Only</option>
                      <option value="none">None</option>
                    </select>
                  </td>
                  <td className="esco-tags__check-cell">
                    <input
                      type="checkbox"
                      checked={!!tag.constant}
                      aria-label={`Constant tag ${tag.name}`}
                      title="ESCO Studio Constant tag flag"
                      onChange={(e) => onSetMetadata(tag, { constant: e.target.checked })}
                    />
                  </td>
                  {mode === "monitor" ? (
                    <td className="esco-tags__value">
                      <MonitorValueCell tag={tag} row={row} forced={forced} onSetValue={onSetValue} />
                    </td>
                  ) : null}
                  {mode === "monitor" ? (
                    <td>
                      <button
                        type="button"
                        className="esco-btn esco-btn--quick"
                        aria-label={`Watch ${monitor.path}`}
                        disabled={!onWatchTag}
                        onClick={() => onWatchTag?.(monitor.path)}
                      >
                        Watch
                      </button>
                    </td>
                  ) : null}
                  {mode === "monitor" ? (
                    <td>
                      <button
                        type="button"
                        className="esco-btn esco-btn--quick"
                        aria-label={`Cross reference ${monitor.path}`}
                        disabled={!onCrossReferenceTag}
                        onClick={() => onCrossReferenceTag?.(monitor.path)}
                      >
                        XRef
                      </button>
                    </td>
                  ) : null}
                  {mode === "monitor" ? (
                    <td>
                      {row.canForce ? (
                        <button
                          type="button"
                          className={`esco-btn esco-btn--toggle${forced ? " is-on" : ""}`}
                          aria-label={`${forced ? "Unforce" : "Force"} ${monitor.path}`}
                          title={forced ? "Remove offline force" : "Force this offline value"}
                          onClick={() => onToggleForce(monitor.path)}
                        >
                          {forced ? "Unforce" : "Force"}
                        </button>
                      ) : (
                        <span className="esco-watch__value" title="Array and structured tags cannot be forced as one value.">-</span>
                      )}
                    </td>
                  ) : null}
                  <td className="esco-tags__command-cell">
                    <button
                      type="button"
                      className="esco-btn esco-btn--quick"
                      aria-label={`Export ${tag.name}`}
                      title="Export this tag as an ESCO-native component"
                      disabled={!onExportTagComponent}
                      onClick={() => onExportTagComponent?.(tag)}
                    >
                      Export
                    </button>
                    <button
                      type="button"
                      className="esco-tags__delete"
                      disabled={references > 0}
                      aria-label={`Delete ${tag.name}`}
                      title={references > 0 ? `Referenced by ${references} operand(s)` : "Delete tag"}
                      onClick={async () => {
                        if (
                          await requestConfirmation({
                            title: "Delete Tag",
                            message: `Delete tag "${tag.name}"?`,
                            confirmLabel: "Delete",
                            tone: "danger",
                          })
                        ) {
                          onDeleteTag(tag);
                        }
                      }}
                    />
                  </td>
                </tr>
                );
              })
            )}
          </tbody>
        </table>
        {windowed.truncated ? (
          <p className="esco-tags__more">
            Showing first {windowed.items.length} of {visible.length} tags — search to narrow down.
          </p>
        ) : null}
      </div>
      <div className="esco-tags__tabs" role="tablist" aria-label="Tag monitor edit tabs">
        <button
          type="button"
          className={`esco-tags__tab${mode === "monitor" ? " is-active" : ""}`}
          onClick={() => setMode("monitor")}
        >
          Monitor Tags
        </button>
        <button
          type="button"
          className={`esco-tags__tab${mode === "edit" ? " is-active" : ""}`}
          onClick={() => setMode("edit")}
        >
          Edit Tags
        </button>
      </div>
      <datalist id="esco-tag-names">
        {rows.map((row) => (
          <option key={row.tag.id} value={row.tag.name} />
        ))}
      </datalist>
      <datalist id="esco-tag-data-types">
        {dataTypeOptions.map((type) => (
          <option key={type} value={type} />
        ))}
      </datalist>
    </div>
  );
}
