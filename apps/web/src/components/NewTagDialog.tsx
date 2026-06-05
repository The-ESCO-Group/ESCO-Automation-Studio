import { useEffect, useMemo, useState } from "react";
import type { ExternalAccess, PlcProject } from "@esco/core";
import { STRUCTURED_TYPES, TAG_DATA_TYPES } from "@esco/core";
import { duplicateNameError, showDialogHelp, studioIdentifierError } from "./dialogValidation";

export interface NewTagInput {
  name: string;
  dataType: string;
  description?: string;
  dimensions?: number[];
  scope: "controller" | "program";
  programId?: string;
  aliasFor?: string;
  externalAccess?: ExternalAccess;
  constant?: boolean;
  radix?: string;
  openConfiguration?: boolean;
}

interface Props {
  open: boolean;
  project: PlcProject;
  initialScope?: "controller" | "program";
  initialProgramId?: string;
  /** Prefill the tag name (e.g. when creating a tag from a missing operand). */
  initialName?: string;
  /** Prefill the data type (e.g. inferred BOOL/TIMER/COUNTER from an operand). */
  initialDataType?: string;
  onClose: () => void;
  onCreate: (input: NewTagInput) => void;
}

const ESCO_SCALAR_TYPES = ["BOOL", "SINT", "INT", "DINT", "LINT", "REAL", "LREAL", "STRING"];
const TAG_RADIX_OPTIONS = ["Binary", "Octal", "Decimal", "Hex", "ASCII", "Float", "Exponential"];

function parseDimensions(value: string): number[] {
  const text = value.trim();
  if (!text) return [];
  return text.split(/[\s,]+/).filter(Boolean).map((part) => Number(part));
}

function dimensionsError(value: string): string | undefined {
  const text = value.trim();
  if (!text) return undefined;
  const parts = text.split(/[\s,]+/).filter(Boolean);
  if (parts.some((part) => !Number.isInteger(Number(part)))) return "Dimensions must be whole numbers.";
  if (parts.some((part) => Number(part) <= 0)) return "Dimensions must be greater than zero.";
  return undefined;
}

function nextTagName(project: PlcProject): string {
  const controller = project.controllers[0];
  const existing = new Set(controller?.controllerTags.map((tag) => tag.name.toLowerCase()) ?? []);
  for (let index = 1; index < 1000; index += 1) {
    const candidate = `Tag_${index}`;
    if (!existing.has(candidate.toLowerCase())) return candidate;
  }
  return `Tag_${(controller?.controllerTags.length ?? 0) + 1}`;
}

export function NewTagDialog({ open, project, initialScope = "controller", initialProgramId, initialName, initialDataType, onClose, onCreate }: Props) {
  const [name, setName] = useState("");
  const [dataType, setDataType] = useState("BOOL");
  const [description, setDescription] = useState("");
  const [dimensions, setDimensions] = useState("");
  const [scope, setScope] = useState<"controller" | "program">("controller");
  const [programId, setProgramId] = useState("");
  const [usage, setUsage] = useState<"base" | "alias">("base");
  const [aliasFor, setAliasFor] = useState("");
  const [externalAccess, setExternalAccess] = useState<ExternalAccess | "">("read-write");
  const [constant, setConstant] = useState(false);
  const [radix, setRadix] = useState("");
  const [openConfiguration, setOpenConfiguration] = useState(false);

  const dataTypeOptions = useMemo(() => {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const raw of [
      ...ESCO_SCALAR_TYPES,
      ...TAG_DATA_TYPES,
      ...Object.keys(STRUCTURED_TYPES),
      ...project.controllers.flatMap((controller) => controller.dataTypes.map((type) => type.name)),
      ...project.controllers.flatMap((controller) => controller.addOnInstructions.map((aoi) => aoi.name)),
    ]) {
      const type = raw.trim();
      const key = type.toUpperCase();
      if (!type || seen.has(key)) continue;
      seen.add(key);
      result.push(type);
    }
    return result.sort((left, right) => left.localeCompare(right));
  }, [project]);
  const programOptions = useMemo(
    () =>
      project.controllers.flatMap((controller) =>
        controller.programs.map((program) => ({
          id: program.id,
          name: program.name,
          controllerName: controller.name,
        })),
      ),
    [project],
  );
  const tagNameOptions = useMemo(
    () =>
      project.controllers.flatMap((controller) => [
        ...controller.controllerTags.map((tag) => tag.name),
        ...controller.programs.flatMap((program) => program.programTags.map((tag) => `${program.name}.${tag.name}`)),
      ]),
    [project],
  );

  useEffect(() => {
    if (!open) return;
    const defaultProgramId = initialProgramId ?? programOptions[0]?.id ?? "";
    setName(initialName?.trim() || nextTagName(project));
    setDataType(initialDataType?.trim() || "BOOL");
    setDescription("");
    setDimensions("");
    setScope(initialScope);
    setProgramId(defaultProgramId);
    setUsage("base");
    setAliasFor("");
    setExternalAccess("read-write");
    setConstant(false);
    setRadix("");
    setOpenConfiguration(false);
  }, [initialDataType, initialName, initialProgramId, initialScope, open, programOptions, project]);

  if (!open) return null;
  const controller = project.controllers[0];
  const ownerProgram = project.controllers
    .flatMap((candidate) => candidate.programs)
    .find((program) => program.id === programId);
  const duplicateNames =
    scope === "program"
      ? ownerProgram?.programTags.map((tag) => tag.name) ?? []
      : controller?.controllerTags.map((tag) => tag.name) ?? [];
  const validationMessage =
    studioIdentifierError(name, "Tag") ??
    duplicateNameError(name, duplicateNames, "Tag") ??
    (!dataType.trim() ? "Data type is required." : undefined) ??
    dimensionsError(dimensions) ??
    (scope === "program" && !programId ? "Select a program for program-scoped tags." : undefined) ??
    (usage === "alias" && !aliasFor.trim() ? "Alias tags require an Alias For target." : undefined);
  const showHelp = () =>
    showDialogHelp(
      "New Tag",
      "OK creates the offline tag with scope, data type, dimensions, access, constant, style, and alias metadata. Open Configuration moves to the tag editor after creation; Cancel closes without creating a tag.",
    );

  const create = () => {
    const trimmedName = name.trim();
    if (!trimmedName || validationMessage) return;
    onCreate({
      name: trimmedName,
      dataType,
      description: description.trim() || undefined,
      dimensions: parseDimensions(dimensions),
      scope,
      programId: scope === "program" ? programId || undefined : undefined,
      aliasFor: usage === "alias" ? aliasFor.trim() || undefined : undefined,
      externalAccess: externalAccess || undefined,
      constant,
      radix: radix || undefined,
      openConfiguration,
    });
  };

  return (
    <div className="esco-modal" role="presentation">
      <section className="esco-modal__panel esco-program-props" role="dialog" aria-modal="true" aria-label="New Tag">
        <header className="esco-modal__header">
          <h2>New Tag</h2>
          <button type="button" className="esco-icon-btn" aria-label="Close New Tag" onClick={onClose} />
        </header>

        <div className="esco-routine-props__body">
          <aside className="esco-routine-props__identity" aria-label="Tag identity">
            <span className="esco-tag-props__icon" aria-hidden="true" />
            <strong>Tag</strong>
            <small>{dataType}</small>
          </aside>

          <div className="esco-routine-props__fields">
            <label className="esco-field">
              <span>Name</span>
              <input value={name} spellCheck={false} autoFocus onChange={(event) => setName(event.target.value)} />
            </label>
            <label className="esco-field">
              <span>Usage</span>
              <select value={usage} onChange={(event) => setUsage(event.target.value as "base" | "alias")}>
                <option value="base">Base</option>
                <option value="alias">Alias</option>
              </select>
            </label>
            <label className="esco-field">
              <span>Alias For</span>
              <input
                value={aliasFor}
                list="esco-new-tag-names"
                disabled={usage !== "alias"}
                spellCheck={false}
                onChange={(event) => setAliasFor(event.target.value)}
              />
            </label>
            <label className="esco-field">
              <span>Data Type</span>
              <select value={dataType} onChange={(event) => setDataType(event.target.value)}>
                {dataTypeOptions.map((type) => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
            </label>
            <label className="esco-field">
              <span>Dimension</span>
              <input value={dimensions} placeholder="e.g. 10 or 2,3" spellCheck={false} onChange={(event) => setDimensions(event.target.value)} />
            </label>
            <label className="esco-field">
              <span>Style</span>
              <select value={radix} onChange={(event) => setRadix(event.target.value)}>
                <option value="">Default</option>
                {TAG_RADIX_OPTIONS.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </label>
            <label className="esco-field">
              <span>Scope</span>
              <select value={scope} onChange={(event) => setScope(event.target.value as "controller" | "program")}>
                <option value="controller">Controller</option>
                <option value="program">Program</option>
              </select>
            </label>
            <label className="esco-field">
              <span>Program</span>
              <select value={programId} disabled={scope !== "program"} onChange={(event) => setProgramId(event.target.value)}>
                {programOptions.map((program) => (
                  <option key={program.id} value={program.id}>{program.controllerName}.{program.name}</option>
                ))}
              </select>
            </label>
            <label className="esco-field">
              <span>External Access</span>
              <select value={externalAccess} onChange={(event) => setExternalAccess(event.target.value as ExternalAccess | "")}>
                <option value="">Default</option>
                <option value="read-write">Read/Write</option>
                <option value="read-only">Read Only</option>
                <option value="none">None</option>
              </select>
            </label>
            <label className="esco-field">
              <span>Description</span>
              <textarea value={description} rows={4} onChange={(event) => setDescription(event.target.value)} />
            </label>
            <label className="esco-check-field">
              <span />
              <span>
                <input type="checkbox" checked={constant} onChange={(event) => setConstant(event.target.checked)} />
                Constant
              </span>
            </label>
            <label className="esco-check-field">
              <span />
              <span>
                <input type="checkbox" checked={openConfiguration} onChange={(event) => setOpenConfiguration(event.target.checked)} />
                Open Configuration
              </span>
            </label>
          </div>
        </div>

        <footer className="esco-modal__footer">
          {validationMessage ? <p className="esco-dialog-validation" role="alert">{validationMessage}</p> : null}
          <div className="esco-modal__actions">
            <button type="button" className="esco-btn esco-btn--primary" disabled={!!validationMessage} onClick={create}>OK</button>
            <button type="button" className="esco-btn" onClick={onClose}>Cancel</button>
            <button type="button" className="esco-btn" onClick={showHelp}>Help</button>
          </div>
        </footer>
        <datalist id="esco-new-tag-names">
          {tagNameOptions.map((tagName) => (
            <option key={tagName} value={tagName} />
          ))}
        </datalist>
      </section>
    </div>
  );
}
