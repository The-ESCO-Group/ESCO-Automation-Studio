import {
  createTag as makeTag,
  isStructuredType,
  type Controller,
  type ExternalAccess,
  type PlcProject,
  type Program,
  type Tag,
  type TagComment,
  type TagEngineeringUnit,
} from "@esco/core";
import { baseTagName, referencedPaths } from "@esco/instructions";
import { mapRoutineNodes, routineNodes } from "@esco/ladder";
import {
  fail,
  getLadder,
  mapAllTags,
  ok,
  withControllerTag,
} from "./helpers";
import { dimensionPropsFrom } from "./dimensions";
import { logixIdentifierError } from "./logix-names";
import type {
  CreateTagInput,
  DeleteTagInput,
  ProjectActionResult,
  RenameTagInput,
  SetTagAliasInput,
  SetTagCommentsInput,
  SetTagDataTypeInput,
  SetTagDescriptionInput,
  SetTagDimensionsInput,
  SetTagEngineeringUnitsInput,
  SetTagMetadataInput,
} from "./types";

const ATOMIC_TYPES = new Set([
  "BOOL",
  "SINT",
  "INT",
  "DINT",
  "LINT",
  "USINT",
  "UINT",
  "UDINT",
  "ULINT",
  "REAL",
  "LREAL",
  "STRING",
]);

const UNMODELED_PREDEFINED_TYPES = new Set([
  "AXIS_GENERIC",
  "AXIS_GENERIC_DRIVE",
  "AXIS_SERVO",
  "AXIS_SERVO_DRIVE",
  "AXIS_VIRTUAL",
  "AXIS_CIP_DRIVE",
  "AXIS_CONSUMED",
  "MOTION_GROUP",
  "COORDINATE_SYSTEM",
  "CAM",
  "CAM_PROFILE",
  "OUTPUT_CAM",
  "OUTPUT_COMPENSATION",
  "MODULE",
  "CONNECTION",
  "ALIAS",
  "SERIAL_PORT_CONTROL",
  "ALARM",
]);

/**
 * Resolve a requested data type to its stored form, or report it unknown.
 * Atomics and predefined structured types are matched case-insensitively and
 * stored uppercase; project UDTs and AOIs are matched case-insensitively and
 * stored with their authored spelling.
 */
function resolveDataType(
  project: PlcProject,
  raw: string,
): { value?: string; error?: string } {
  const requested = raw.trim();
  const upper = requested.toUpperCase();
  if (ATOMIC_TYPES.has(upper) || isStructuredType(upper) || UNMODELED_PREDEFINED_TYPES.has(upper)) {
    return { value: upper };
  }
  for (const controller of project.controllers) {
    const udt = controller.dataTypes.find((type) => type.name.toUpperCase() === upper);
    if (udt) return { value: udt.name };
    const aoi = controller.addOnInstructions.find((instruction) => instruction.name.toUpperCase() === upper);
    if (aoi) return { value: aoi.name };
  }
  return { error: `Unknown data type "${requested}".` };
}

/** Stored default value for a freshly (re)typed tag, mirroring createTag. */
function defaultValueForType(dataType: string): boolean | string | number {
  if (dataType === "BOOL") return false;
  if (dataType === "STRING") return "";
  return 0;
}

const EXTERNAL_ACCESS_VALUES = new Set<ExternalAccess>(["read-write", "read-only", "none"]);

function normalizeExternalAccess(value: SetTagMetadataInput["externalAccess"]): {
  value?: ExternalAccess;
  clear?: boolean;
  error?: string;
} {
  if (value === undefined) return {};
  if (value === "") return { clear: true };
  if (EXTERNAL_ACCESS_VALUES.has(value)) return { value };
  return { error: `Unknown ExternalAccess value "${value}".` };
}

// Studio 5000 display radices ("Style"). Stored verbatim in their canonical
// capitalization so they round-trip through L5X export; matched case-insensitively.
const TAG_RADIX_VALUES = ["Binary", "Octal", "Decimal", "Hex", "ASCII", "Float", "Exponential"];

function normalizeRadix(value: SetTagMetadataInput["radix"]): {
  value?: string;
  clear?: boolean;
  error?: string;
} {
  if (value === undefined) return {};
  const trimmed = value.trim();
  if (trimmed === "") return { clear: true };
  const canonical = TAG_RADIX_VALUES.find((radix) => radix.toLowerCase() === trimmed.toLowerCase());
  if (canonical) return { value: canonical };
  return { error: `Unknown display radix "${value}".` };
}

const TAG_ANNOTATION_OPERAND = /^(?:\[\s*\d+(?:\s*,\s*\d+)*\s*])?(?:\.?[A-Za-z_][A-Za-z0-9_]*(?:\[\s*\d+(?:\s*,\s*\d+)*\s*])?)*$/;

type TagAnnotation = TagComment | TagEngineeringUnit;

function normalizeTagAnnotations<T extends TagAnnotation>(
  rows: readonly T[],
  label: string,
): { rows?: T[]; error?: string } {
  const normalized: T[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const operand = row.operand.trim();
    const text = row.text.trim();
    if (!operand && !text) continue;
    if (!text) return { error: `${label} text is required for operand "${operand || "<tag>"}".` };
    if (operand && !TAG_ANNOTATION_OPERAND.test(operand)) {
      return { error: `Invalid ${label.toLowerCase()} operand "${operand}".` };
    }
    const key = operand.toLowerCase();
    if (seen.has(key)) return { error: `Duplicate ${label.toLowerCase()} operand "${operand || "<tag>"}".` };
    seen.add(key);
    normalized.push({ ...row, operand, text });
  }
  return { rows: normalized };
}

function validateTagName(name: string): string | undefined {
  return logixIdentifierError(name, "Tag");
}

function sameLogixName(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function findProgramOwner(
  project: PlcProject,
  programId: string,
): { controller: Controller; program: Program } | undefined {
  for (const controller of project.controllers) {
    const program = controller.programs.find((candidate) => candidate.id === programId);
    if (program) return { controller, program };
  }
  return undefined;
}

interface TagSelector {
  name: string;
  scope?: "controller" | "program";
  programId?: string;
}

interface ScopedTagSelection {
  controller: Controller;
  program?: Program;
  tag: Tag;
}

const IDENT = "[A-Za-z_][A-Za-z0-9_]*";
const QUALIFIED_TAG_PATH = new RegExp(`^Program:(${IDENT})\\.(${IDENT})(.*)$`, "i");
const BARE_TAG_PATH = new RegExp(`^(${IDENT})(.*)$`);
const TAG_PATH_TOKEN = new RegExp(
  `Program:${IDENT}\\.${IDENT}(?:\\[[^\\]]+\\])?(?:\\.${IDENT}(?:\\[[^\\]]+\\])?)*|${IDENT}(?:\\[[^\\]]+\\])?(?:\\.${IDENT}(?:\\[[^\\]]+\\])?)*`,
  "g",
);

function scopedTagName(selection: ScopedTagSelection): string {
  return selection.program ? `Program:${selection.program.name}.${selection.tag.name}` : selection.tag.name;
}

function resolveTagSelection(project: PlcProject, input: TagSelector): { selection?: ScopedTagSelection; error?: string } {
  const name = input.name.trim();
  const programId = input.programId?.trim();
  const requestedScope = input.scope ?? (programId ? "program" : undefined);

  if (requestedScope === "program" && !programId) {
    return { error: "Program id is required to target a program-scoped tag." };
  }
  if (requestedScope === "controller" && programId) {
    return { error: "Controller-scoped tag target cannot specify a program id." };
  }

  if (requestedScope === "program") {
    const owner = findProgramOwner(project, programId!);
    if (!owner) return { error: `Program "${programId}" not found.` };
    const matches = owner.program.programTags.filter((tag) => sameLogixName(tag.name, name));
    if (matches.length === 0) return { error: `Program tag "${name}" does not exist in "${owner.program.name}".` };
    if (matches.length > 1) return { error: `Program tag "${name}" is duplicated in "${owner.program.name}".` };
    return { selection: { controller: owner.controller, program: owner.program, tag: matches[0]! } };
  }

  if (requestedScope === "controller") {
    const matches = project.controllers.flatMap((controller) =>
      controller.controllerTags
        .filter((tag) => sameLogixName(tag.name, name))
        .map((tag) => ({ controller, tag })),
    );
    if (matches.length === 0) return { error: `Controller tag "${name}" does not exist.` };
    if (matches.length > 1) return { error: `Controller tag "${name}" is duplicated across controllers.` };
    return { selection: matches[0] };
  }

  const matches: ScopedTagSelection[] = [];
  for (const controller of project.controllers) {
    for (const tag of controller.controllerTags) {
      if (sameLogixName(tag.name, name)) matches.push({ controller, tag });
    }
    for (const program of controller.programs) {
      for (const tag of program.programTags) {
        if (sameLogixName(tag.name, name)) matches.push({ controller, program, tag });
      }
    }
  }

  if (matches.length === 0) return { error: `Tag "${name}" does not exist.` };
  if (matches.length > 1) return { error: `Tag "${name}" exists in multiple controller scopes; specify scope and programId.` };
  return { selection: matches[0] };
}

function mapSelectedTag(project: PlcProject, selection: ScopedTagSelection, fn: (tag: Tag) => Tag | null): PlcProject {
  return mapAllTags(project, (tag) => (tag.id === selection.tag.id ? fn(tag) : tag));
}

function parseQualifiedPath(value: string): { programName: string; baseName: string; suffix: string } | undefined {
  const match = value.trim().match(QUALIFIED_TAG_PATH);
  if (!match) return undefined;
  return { programName: match[1]!, baseName: match[2]!, suffix: match[3] ?? "" };
}

function parseBarePath(value: string): { baseName: string; suffix: string } | undefined {
  const match = value.trim().match(BARE_TAG_PATH);
  if (!match) return undefined;
  return { baseName: match[1]!, suffix: match[2] ?? "" };
}

function programHasLocalTag(program: Program, name: string): boolean {
  return program.programTags.some((tag) => sameLogixName(tag.name, name));
}

function pathTargetsSelection(path: string, currentProgram: Program, selection: ScopedTagSelection): boolean {
  const qualified = parseQualifiedPath(path);
  if (qualified) {
    return Boolean(
      selection.program &&
        sameLogixName(qualified.programName, selection.program.name) &&
        sameLogixName(qualified.baseName, selection.tag.name),
    );
  }

  const bare = parseBarePath(path);
  if (!bare || !sameLogixName(bare.baseName, selection.tag.name)) return false;

  if (selection.program) return currentProgram.id === selection.program.id;
  return !programHasLocalTag(currentProgram, bare.baseName);
}

function operandReferencePaths(value: string): string[] {
  const paths = referencedPaths(value);
  if (paths.length > 0) return paths;
  return baseTagName(value) ? [value.trim()] : [];
}

function replaceOperandReferences(value: string, currentProgram: Program, selection: ScopedTagSelection, to: string): string {
  return value.replace(TAG_PATH_TOKEN, (path) => {
    if (!pathTargetsSelection(path, currentProgram, selection)) return path;
    const qualified = parseQualifiedPath(path);
    if (qualified) return `Program:${qualified.programName}.${to}${qualified.suffix}`;
    const bare = parseBarePath(path)!;
    return `${to}${bare.suffix}`;
  });
}

function resolveAliasTarget(
  project: PlcProject,
  context: ScopedTagSelection,
  aliasFor: string,
): ScopedTagSelection | undefined {
  const trimmed = aliasFor.trim();
  const qualified = parseQualifiedPath(trimmed);
  if (qualified) {
    const program = context.controller.programs.find((candidate) => sameLogixName(candidate.name, qualified.programName));
    const tag = program?.programTags.find((candidate) => sameLogixName(candidate.name, qualified.baseName));
    return program && tag ? { controller: context.controller, program, tag } : undefined;
  }

  const base = baseTagName(trimmed);
  if (!base) return undefined;
  if (context.program) {
    const local = context.program.programTags.find((tag) => sameLogixName(tag.name, base));
    if (local) return { controller: context.controller, program: context.program, tag: local };
  }

  const controllerTag = context.controller.controllerTags.find((tag) => sameLogixName(tag.name, base));
  if (controllerTag) return { controller: context.controller, tag: controllerTag };

  const global = resolveTagSelection(project, { name: base });
  return global.selection;
}

/** Create a new tag (controller-scoped by default). Fails if the name exists. */
export function createTag(
  project: PlcProject,
  input: CreateTagInput,
): ProjectActionResult<{ tagId: string }> {
  const name = input.name?.trim();
  if (!name) return fail(project, "Tag name is required.");
  const invalidName = validateTagName(name);
  if (invalidName) return fail(project, invalidName);

  const scope = input.scope ?? "controller";
  const programId = input.programId?.trim();
  if (scope === "program" && !programId) return fail(project, "Program id is required for program-scoped tags.");
  if (scope === "controller" && programId) return fail(project, "Controller-scoped tags cannot specify a program id.");

  const owner = scope === "program" ? findProgramOwner(project, programId!) : undefined;
  if (scope === "program" && !owner) return fail(project, `Program "${programId}" not found.`);

  const controller = owner?.controller ?? project.controllers[0];
  if (!controller) return fail(project, "No controller to add the tag to.");

  if (scope === "program") {
    if (owner!.program.programTags.some((tag) => sameLogixName(tag.name, name))) {
      return fail(project, `Program tag "${name}" already exists in "${owner!.program.name}".`);
    }
  } else if (controller.controllerTags.some((tag) => sameLogixName(tag.name, name))) {
    return fail(project, `Controller tag "${name}" already exists.`);
  }

  const requestedType = input.dataType?.trim() || "BOOL";
  const resolvedType = resolveDataType(project, requestedType);
  if (resolvedType.error) return fail(project, resolvedType.error);
  const dataType = resolvedType.value!;
  const dimensions = dimensionPropsFrom(input, "Tag");
  if (dimensions.error) return fail(project, dimensions.error);
  const externalAccess = normalizeExternalAccess(input.externalAccess);
  if (externalAccess.error) return fail(project, externalAccess.error);
  const tag = makeTag(controller.id, name, dataType, {
    scope,
    programId: scope === "program" ? programId : undefined,
    description: input.description,
    value: defaultValueForType(dataType),
    ...(externalAccess.value ? { externalAccess: externalAccess.value } : {}),
    ...(input.constant ? { constant: true } : {}),
    ...dimensions.props,
  });

  if (scope === "program") {
    const next: PlcProject = {
      ...project,
      controllers: project.controllers.map((c) => ({
        ...c,
        programs: c.programs.map((program) =>
          program.id === programId
            ? { ...program, programTags: [...program.programTags, tag] }
            : program,
        ),
      })),
    };
    return ok(next, { tagId: tag.id });
  }

  return ok(withControllerTag(project, tag), { tagId: tag.id });
}

/** Update a tag's description (no rename, no reference changes). */
export function setTagDescription(
  project: PlcProject,
  input: SetTagDescriptionInput,
): ProjectActionResult<{ name: string }> {
  const name = input.name?.trim();
  if (!name) return fail(project, "Tag name is required.");
  const resolved = resolveTagSelection(project, { name, scope: input.scope, programId: input.programId });
  if (resolved.error) return fail(project, resolved.error);
  const selection = resolved.selection!;
  return ok(
    mapSelectedTag(project, selection, (tag) => ({ ...tag, description: input.description })),
    { name: scopedTagName(selection) },
  );
}

/** Set or clear a tag's array dimensions without changing its type or references. */
export function setTagDimensions(
  project: PlcProject,
  input: SetTagDimensionsInput,
): ProjectActionResult<{ name: string }> {
  const name = input.name?.trim();
  if (!name) return fail(project, "Tag name is required.");
  const resolved = resolveTagSelection(project, { name, scope: input.scope, programId: input.programId });
  if (resolved.error) return fail(project, resolved.error);
  const selection = resolved.selection!;
  const dimensions = dimensionPropsFrom(input, "Tag");
  if (dimensions.error) return fail(project, dimensions.error);

  return ok(
    mapSelectedTag(project, selection, (tag) => {
      const next = { ...tag };
      if (dimensions.props.dimension !== undefined) next.dimension = dimensions.props.dimension;
      else delete next.dimension;
      if (dimensions.props.dimensions !== undefined) next.dimensions = dimensions.props.dimensions;
      else delete next.dimensions;
      return next;
    }),
    { name: scopedTagName(selection) },
  );
}

/**
 * Change a tag's data type (the editable "Data Type" column in the Studio 5000
 * Tags editor). Validates the new type is known (atomic, predefined structured,
 * a project UDT, or an AOI), resets the stored value to the new type's default,
 * and preserves dimensions/metadata/scope. Aliases derive their type from the
 * base tag, so retyping an alias is rejected. Operand references are not
 * remapped — a warning surfaces when the tag is still referenced by logic.
 */
export function setTagDataType(
  project: PlcProject,
  input: SetTagDataTypeInput,
): ProjectActionResult<{ name: string; dataType: string }> {
  const name = input.name?.trim();
  if (!name) return fail(project, "Tag name is required.");
  const resolvedSelection = resolveTagSelection(project, { name, scope: input.scope, programId: input.programId });
  if (resolvedSelection.error) return fail(project, resolvedSelection.error);
  const selection = resolvedSelection.selection!;

  const requested = input.dataType?.trim();
  if (!requested) return fail(project, "A data type is required.");

  const existing = selection.tag;
  if (existing?.aliasFor) {
    return fail(project, `Tag "${scopedTagName(selection)}" is an alias; its data type follows its base tag.`);
  }

  const resolved = resolveDataType(project, requested);
  if (resolved.error) return fail(project, resolved.error);
  const dataType = resolved.value!;

  const displayName = scopedTagName(selection);
  if (existing?.dataType === dataType) return ok(project, { name: displayName, dataType });

  const references = countReferences(project, selection);
  const warnings =
    references > 0
      ? [`"${displayName}" is referenced by ${references} operand(s); verify the logic still matches the new type.`]
      : undefined;

  return ok(
    mapSelectedTag(project, selection, (tag) => ({ ...tag, dataType, value: defaultValueForType(dataType) })),
    { name: displayName, dataType },
    warnings,
  );
}

/** Set or clear Studio 5000 tag metadata authored from the tag properties grid. */
export function setTagMetadata(
  project: PlcProject,
  input: SetTagMetadataInput,
): ProjectActionResult<{ name: string }> {
  const name = input.name?.trim();
  if (!name) return fail(project, "Tag name is required.");
  const resolved = resolveTagSelection(project, { name, scope: input.scope, programId: input.programId });
  if (resolved.error) return fail(project, resolved.error);
  const selection = resolved.selection!;

  const externalAccess = normalizeExternalAccess(input.externalAccess);
  if (externalAccess.error) return fail(project, externalAccess.error);
  const radix = normalizeRadix(input.radix);
  if (radix.error) return fail(project, radix.error);

  return ok(
    mapSelectedTag(project, selection, (tag) => {
      const next = { ...tag };
      if (input.externalAccess !== undefined) {
        if (externalAccess.clear) delete next.externalAccess;
        else next.externalAccess = externalAccess.value;
      }
      if (input.constant !== undefined) {
        if (input.constant) next.constant = true;
        else delete next.constant;
      }
      if (input.radix !== undefined) {
        if (radix.clear) delete next.radix;
        else next.radix = radix.value;
      }
      return next;
    }),
    { name: scopedTagName(selection) },
  );
}

/**
 * Set or clear a tag's alias target. An alias points at a base tag (or a
 * member/element path of one, e.g. "Motor.Run" or "Pumps[2]"). Validates that
 * the referenced base tag exists, the tag is not aliased to itself, and the
 * alias chain does not form a cycle. Pass a blank `aliasFor` to clear the alias.
 */
export function setTagAlias(
  project: PlcProject,
  input: SetTagAliasInput,
): ProjectActionResult<{ name: string; aliasFor?: string }> {
  const name = input.name?.trim();
  if (!name) return fail(project, "Tag name is required.");
  const resolved = resolveTagSelection(project, { name, scope: input.scope, programId: input.programId });
  if (resolved.error) return fail(project, resolved.error);
  const selection = resolved.selection!;
  const displayName = scopedTagName(selection);

  const aliasFor = input.aliasFor?.trim();
  if (!aliasFor) {
    return ok(
      mapSelectedTag(project, selection, (tag) => ({ ...tag, aliasFor: undefined })),
      { name: displayName },
    );
  }

  const target = resolveAliasTarget(project, selection, aliasFor);
  if (!target) return fail(project, `Alias target "${aliasFor}" does not exist.`);
  if (target.tag.id === selection.tag.id) return fail(project, `Tag "${displayName}" cannot alias itself.`);

  // Walk the alias chain from the resolved base; reaching this tag means a cycle.
  const seen = new Set<string>();
  let cursor: ScopedTagSelection | undefined = target;
  while (cursor) {
    if (cursor.tag.id === selection.tag.id) {
      return fail(project, `Aliasing "${displayName}" to "${aliasFor}" would create an alias cycle.`);
    }
    if (seen.has(cursor.tag.id)) break; // a pre-existing cycle elsewhere — stop walking
    seen.add(cursor.tag.id);
    cursor = cursor.tag.aliasFor ? resolveAliasTarget(project, cursor, cursor.tag.aliasFor) : undefined;
  }

  return ok(
    mapSelectedTag(project, selection, (tag) => ({ ...tag, aliasFor })),
    { name: displayName, aliasFor },
  );
}

/** Set or clear per-element/member comments for a tag. */
export function setTagComments(
  project: PlcProject,
  input: SetTagCommentsInput,
): ProjectActionResult<{ name: string; commentCount: number }> {
  const name = input.name?.trim();
  if (!name) return fail(project, "Tag name is required.");
  const resolved = resolveTagSelection(project, { name, scope: input.scope, programId: input.programId });
  if (resolved.error) return fail(project, resolved.error);
  const selection = resolved.selection!;
  const displayName = scopedTagName(selection);
  const comments = normalizeTagAnnotations(input.comments ?? [], "Tag comment");
  if (comments.error) return fail(project, comments.error);

  return ok(
    mapSelectedTag(project, selection, (tag) => {
      const next = { ...tag };
      if (comments.rows!.length > 0) next.comments = comments.rows!;
      else delete next.comments;
      return next;
    }),
    { name: displayName, commentCount: comments.rows!.length },
  );
}

/** Set or clear per-element/member engineering units for a tag. */
export function setTagEngineeringUnits(
  project: PlcProject,
  input: SetTagEngineeringUnitsInput,
): ProjectActionResult<{ name: string; engineeringUnitCount: number }> {
  const name = input.name?.trim();
  if (!name) return fail(project, "Tag name is required.");
  const resolved = resolveTagSelection(project, { name, scope: input.scope, programId: input.programId });
  if (resolved.error) return fail(project, resolved.error);
  const selection = resolved.selection!;
  const displayName = scopedTagName(selection);
  const engineeringUnits = normalizeTagAnnotations(input.engineeringUnits ?? [], "Engineering unit");
  if (engineeringUnits.error) return fail(project, engineeringUnits.error);

  return ok(
    mapSelectedTag(project, selection, (tag) => {
      const next = { ...tag };
      if (engineeringUnits.rows!.length > 0) next.engineeringUnits = engineeringUnits.rows!;
      else delete next.engineeringUnits;
      return next;
    }),
    { name: displayName, engineeringUnitCount: engineeringUnits.rows!.length },
  );
}

/** Count how many ladder operands reference a selected tag with Logix scope precedence. */
function countReferences(project: PlcProject, selection: ScopedTagSelection): number {
  let count = 0;
  for (const controller of project.controllers) {
    for (const program of controller.programs) {
      for (const routine of program.routines) {
        const ladder = getLadder(routine);
        if (!ladder) continue;
        for (const node of routineNodes(ladder)) {
          for (const operand of node.operands) {
            if (operandReferencePaths(operand.value).some((path) => pathTargetsSelection(path, program, selection))) {
              count += 1;
            }
          }
        }
      }
    }
  }
  return count;
}

/** Rename a tag and remap every operand reference (preserving member/array suffixes). */
export function renameTag(
  project: PlcProject,
  input: RenameTagInput,
): ProjectActionResult<{ from: string; to: string }> {
  const from = input.from?.trim();
  const to = input.to?.trim();
  if (!from || !to) return fail(project, "Both 'from' and 'to' tag names are required.");
  const resolved = resolveTagSelection(project, { name: from, scope: input.scope, programId: input.programId });
  if (resolved.error) return fail(project, resolved.error);
  const selection = resolved.selection!;
  const displayFrom = scopedTagName(selection);
  if (sameLogixName(selection.tag.name, to)) return ok(project, { from: displayFrom, to: selection.tag.name });
  const invalidName = validateTagName(to);
  if (invalidName) return fail(project, invalidName);
  if (selection.program) {
    if (selection.program.programTags.some((tag) => tag.id !== selection.tag.id && sameLogixName(tag.name, to))) {
      return fail(project, `Program tag "${to}" already exists in "${selection.program.name}".`);
    }
  } else if (selection.controller.controllerTags.some((tag) => tag.id !== selection.tag.id && sameLogixName(tag.name, to))) {
    return fail(project, `Controller tag "${to}" already exists.`);
  }

  const renamed = mapSelectedTag(project, selection, (tag) => ({ ...tag, name: to }));
  const scopedRemapped: PlcProject = {
    ...renamed,
    controllers: renamed.controllers.map((controller) => ({
      ...controller,
      programs: controller.programs.map((program) => ({
        ...program,
        routines: program.routines.map((routine) => {
          const ladder = getLadder(routine);
          return ladder
            ? {
                ...routine,
                ladder: mapRoutineNodes(ladder, (node) => ({
                  ...node,
                  operands: node.operands.map((operand) => ({
                    ...operand,
                    value: replaceOperandReferences(operand.value, program, selection, to),
                  })),
                })),
              }
            : routine;
        }),
      })),
    })),
  };
  return ok(scopedRemapped, { from: displayFrom, to });
}

/** Delete a tag only if it is not referenced by any ladder logic. */
export function deleteTag(
  project: PlcProject,
  input: DeleteTagInput,
): ProjectActionResult<{ name: string }> {
  const name = input.name?.trim();
  if (!name) return fail(project, "Tag name is required.");
  const resolved = resolveTagSelection(project, { name, scope: input.scope, programId: input.programId });
  if (resolved.error) return fail(project, resolved.error);
  const selection = resolved.selection!;
  const displayName = scopedTagName(selection);

  const references = countReferences(project, selection);
  if (references > 0) {
    return fail(project, `Cannot delete "${displayName}": still referenced by ${references} operand(s).`);
  }

  return ok(mapSelectedTag(project, selection, () => null), { name: displayName });
}
