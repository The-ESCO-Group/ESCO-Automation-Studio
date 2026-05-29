import type { AddOnInstruction, AoiLocalTag, AoiParameter, PlcProject } from "@esco/core";
import { fail, ok } from "./helpers";
import type { ProjectActionResult } from "./types";

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

export interface AddAoiParameterInput {
  aoiId: string;
  parameter: AoiParameter;
}

export interface UpdateAoiParameterInput {
  aoiId: string;
  parameterName: string;
  patch: Partial<AoiParameter>;
}

export interface RemoveAoiParameterInput {
  aoiId: string;
  parameterName: string;
}

export interface AddAoiLocalTagInput {
  aoiId: string;
  localTag: AoiLocalTag;
}

export interface UpdateAoiLocalTagInput {
  aoiId: string;
  localTagName: string;
  patch: Partial<AoiLocalTag>;
}

export interface RemoveAoiLocalTagInput {
  aoiId: string;
  localTagName: string;
}

function findAoi(project: PlcProject, aoiId: string): AddOnInstruction | undefined {
  for (const controller of project.controllers) {
    const aoi = controller.addOnInstructions.find((candidate) => candidate.id === aoiId);
    if (aoi) return aoi;
  }
  return undefined;
}

function mapAoi(
  project: PlcProject,
  aoiId: string,
  fn: (aoi: AddOnInstruction) => AddOnInstruction,
): PlcProject {
  return {
    ...project,
    controllers: project.controllers.map((controller) => ({
      ...controller,
      addOnInstructions: controller.addOnInstructions.map((aoi) => (aoi.id === aoiId ? fn(aoi) : aoi)),
    })),
  };
}

/** Parameters and local tags share a name space inside an AOI; collect all names except `exclude`. */
function usedNames(aoi: AddOnInstruction, exclude?: string): Set<string> {
  const names = new Set<string>();
  for (const parameter of aoi.parameters) {
    if (parameter.name !== exclude) names.add(parameter.name.toLowerCase());
  }
  for (const localTag of aoi.localTags) {
    if (localTag.name !== exclude) names.add(localTag.name.toLowerCase());
  }
  return names;
}

/** Guard a write to an AOI: it must exist and not be source-protected. */
function editableAoi(
  project: PlcProject,
  aoiId: string,
): { aoi: AddOnInstruction } | { error: string } {
  const aoi = findAoi(project, aoiId);
  if (!aoi) return { error: `Add-On Instruction "${aoiId}" was not found.` };
  if (aoi.protected) {
    return { error: `Add-On Instruction "${aoi.name}" is source-protected and cannot be edited.` };
  }
  return { aoi };
}

function validateName(name: string | undefined, used: Set<string>, label: string): string | undefined {
  if (!name?.trim()) return `${label} name is required.`;
  if (!IDENTIFIER.test(name)) return `Invalid ${label.toLowerCase()} name "${name}".`;
  if (used.has(name.toLowerCase())) return `"${name}" already exists in this Add-On Instruction.`;
  return undefined;
}

/** Add an Input/Output/InOut parameter to an AOI. */
export function addAoiParameter(
  project: PlcProject,
  input: AddAoiParameterInput,
): ProjectActionResult<{ aoiId: string; parameterName: string }> {
  const guard = editableAoi(project, input.aoiId);
  if ("error" in guard) return fail(project, guard.error);

  const name = input.parameter.name?.trim() ?? "";
  const nameError = validateName(name, usedNames(guard.aoi), "Parameter");
  if (nameError) return fail(project, nameError);
  if (!input.parameter.dataType?.trim()) return fail(project, "Parameter data type is required.");

  const parameter: AoiParameter = {
    name,
    dataType: input.parameter.dataType.trim(),
    ...(input.parameter.usage?.trim() ? { usage: input.parameter.usage.trim() } : {}),
    ...(input.parameter.required ? { required: true } : {}),
    ...(input.parameter.defaultValue?.trim() ? { defaultValue: input.parameter.defaultValue.trim() } : {}),
    ...(input.parameter.description?.trim() ? { description: input.parameter.description.trim() } : {}),
  };
  return ok(
    mapAoi(project, input.aoiId, (aoi) => ({ ...aoi, parameters: [...aoi.parameters, parameter] })),
    { aoiId: input.aoiId, parameterName: name },
  );
}

/** Update one AOI parameter. */
export function updateAoiParameter(
  project: PlcProject,
  input: UpdateAoiParameterInput,
): ProjectActionResult<{ aoiId: string; parameterName: string }> {
  const guard = editableAoi(project, input.aoiId);
  if ("error" in guard) return fail(project, guard.error);
  const current = guard.aoi.parameters.find((parameter) => parameter.name === input.parameterName);
  if (!current) return fail(project, `Parameter "${input.parameterName}" was not found.`);

  const name = input.patch.name?.trim() ?? current.name;
  if (name !== current.name) {
    const nameError = validateName(name, usedNames(guard.aoi, input.parameterName), "Parameter");
    if (nameError) return fail(project, nameError);
  }
  const dataType = input.patch.dataType?.trim() ?? current.dataType;
  if (!dataType) return fail(project, "Parameter data type is required.");

  const merged: AoiParameter = {
    name,
    dataType,
    usage: input.patch.usage !== undefined ? input.patch.usage.trim() || undefined : current.usage,
    required: input.patch.required !== undefined ? input.patch.required : current.required,
    defaultValue:
      input.patch.defaultValue !== undefined
        ? input.patch.defaultValue.trim() || undefined
        : current.defaultValue,
    description:
      input.patch.description !== undefined
        ? input.patch.description.trim() || undefined
        : current.description,
  };
  return ok(
    mapAoi(project, input.aoiId, (aoi) => ({
      ...aoi,
      parameters: aoi.parameters.map((parameter) =>
        parameter.name === input.parameterName ? merged : parameter,
      ),
    })),
    { aoiId: input.aoiId, parameterName: name },
  );
}

/** Remove one AOI parameter. */
export function removeAoiParameter(
  project: PlcProject,
  input: RemoveAoiParameterInput,
): ProjectActionResult<{ aoiId: string; parameterName: string }> {
  const guard = editableAoi(project, input.aoiId);
  if ("error" in guard) return fail(project, guard.error);
  if (!guard.aoi.parameters.some((parameter) => parameter.name === input.parameterName)) {
    return fail(project, `Parameter "${input.parameterName}" was not found.`);
  }
  return ok(
    mapAoi(project, input.aoiId, (aoi) => ({
      ...aoi,
      parameters: aoi.parameters.filter((parameter) => parameter.name !== input.parameterName),
    })),
    { aoiId: input.aoiId, parameterName: input.parameterName },
  );
}

/** Add a local (private) tag to an AOI. */
export function addAoiLocalTag(
  project: PlcProject,
  input: AddAoiLocalTagInput,
): ProjectActionResult<{ aoiId: string; localTagName: string }> {
  const guard = editableAoi(project, input.aoiId);
  if ("error" in guard) return fail(project, guard.error);

  const name = input.localTag.name?.trim() ?? "";
  const nameError = validateName(name, usedNames(guard.aoi), "Local tag");
  if (nameError) return fail(project, nameError);
  if (!input.localTag.dataType?.trim()) return fail(project, "Local tag data type is required.");

  const localTag: AoiLocalTag = {
    name,
    dataType: input.localTag.dataType.trim(),
    ...(input.localTag.description?.trim() ? { description: input.localTag.description.trim() } : {}),
  };
  return ok(
    mapAoi(project, input.aoiId, (aoi) => ({ ...aoi, localTags: [...aoi.localTags, localTag] })),
    { aoiId: input.aoiId, localTagName: name },
  );
}

/** Update one AOI local tag. */
export function updateAoiLocalTag(
  project: PlcProject,
  input: UpdateAoiLocalTagInput,
): ProjectActionResult<{ aoiId: string; localTagName: string }> {
  const guard = editableAoi(project, input.aoiId);
  if ("error" in guard) return fail(project, guard.error);
  const current = guard.aoi.localTags.find((localTag) => localTag.name === input.localTagName);
  if (!current) return fail(project, `Local tag "${input.localTagName}" was not found.`);

  const name = input.patch.name?.trim() ?? current.name;
  if (name !== current.name) {
    const nameError = validateName(name, usedNames(guard.aoi, input.localTagName), "Local tag");
    if (nameError) return fail(project, nameError);
  }
  const dataType = input.patch.dataType?.trim() ?? current.dataType;
  if (!dataType) return fail(project, "Local tag data type is required.");

  const merged: AoiLocalTag = {
    name,
    dataType,
    description:
      input.patch.description !== undefined
        ? input.patch.description.trim() || undefined
        : current.description,
  };
  return ok(
    mapAoi(project, input.aoiId, (aoi) => ({
      ...aoi,
      localTags: aoi.localTags.map((localTag) =>
        localTag.name === input.localTagName ? merged : localTag,
      ),
    })),
    { aoiId: input.aoiId, localTagName: name },
  );
}

/** Remove one AOI local tag. */
export function removeAoiLocalTag(
  project: PlcProject,
  input: RemoveAoiLocalTagInput,
): ProjectActionResult<{ aoiId: string; localTagName: string }> {
  const guard = editableAoi(project, input.aoiId);
  if ("error" in guard) return fail(project, guard.error);
  if (!guard.aoi.localTags.some((localTag) => localTag.name === input.localTagName)) {
    return fail(project, `Local tag "${input.localTagName}" was not found.`);
  }
  return ok(
    mapAoi(project, input.aoiId, (aoi) => ({
      ...aoi,
      localTags: aoi.localTags.filter((localTag) => localTag.name !== input.localTagName),
    })),
    { aoiId: input.aoiId, localTagName: input.localTagName },
  );
}
