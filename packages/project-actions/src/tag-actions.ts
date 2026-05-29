import { createTag as makeTag, type PlcProject } from "@esco/core";
import { baseTagName } from "@esco/instructions";
import { mapRoutineNodes, routineNodes } from "@esco/ladder";
import {
  fail,
  getAllTags,
  getLadder,
  mapAllLadders,
  mapAllTags,
  ok,
  tagExists,
  withControllerTag,
} from "./helpers";
import type {
  CreateTagInput,
  DeleteTagInput,
  ProjectActionResult,
  RenameTagInput,
  SetTagAliasInput,
  SetTagDescriptionInput,
} from "./types";

/** Create a new tag (controller-scoped by default). Fails if the name exists. */
export function createTag(
  project: PlcProject,
  input: CreateTagInput,
): ProjectActionResult<{ tagId: string }> {
  const name = input.name?.trim();
  if (!name) return fail(project, "Tag name is required.");
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    return fail(project, `Invalid tag name "${name}".`);
  }
  if (tagExists(project, name)) return fail(project, `Tag "${name}" already exists.`);

  const controller = project.controllers[0];
  if (!controller) return fail(project, "No controller to add the tag to.");

  const dataType = input.dataType ?? "BOOL";
  const tag = makeTag(controller.id, name, dataType, {
    scope: input.scope ?? "controller",
    programId: input.programId,
    description: input.description,
    value: dataType === "BOOL" ? false : 0,
  });

  if (input.scope === "program" && input.programId) {
    const next: PlcProject = {
      ...project,
      controllers: project.controllers.map((c) => ({
        ...c,
        programs: c.programs.map((program) =>
          program.id === input.programId
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
  if (!tagExists(project, name)) return fail(project, `Tag "${name}" does not exist.`);
  return ok(
    mapAllTags(project, (tag) =>
      tag.name === name ? { ...tag, description: input.description } : tag,
    ),
    { name },
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
  if (!tagExists(project, name)) return fail(project, `Tag "${name}" does not exist.`);

  const aliasFor = input.aliasFor?.trim();
  if (!aliasFor) {
    return ok(
      mapAllTags(project, (tag) => (tag.name === name ? { ...tag, aliasFor: undefined } : tag)),
      { name },
    );
  }

  const base = baseTagName(aliasFor);
  if (!base) return fail(project, "Alias target is invalid.");
  if (base === name) return fail(project, `Tag "${name}" cannot alias itself.`);
  if (!tagExists(project, base)) return fail(project, `Alias target "${base}" does not exist.`);

  // Walk the alias chain from the base; reaching `name` again means a cycle.
  const tagsByName = new Map(getAllTags(project).map((tag) => [tag.name, tag] as const));
  const seen = new Set<string>();
  let cursor: string | undefined = base;
  while (cursor) {
    if (cursor === name) {
      return fail(project, `Aliasing "${name}" to "${aliasFor}" would create an alias cycle.`);
    }
    if (seen.has(cursor)) break; // a pre-existing cycle elsewhere — stop walking
    seen.add(cursor);
    const next: string | undefined = tagsByName.get(cursor)?.aliasFor;
    cursor = next ? baseTagName(next) : undefined;
  }

  return ok(
    mapAllTags(project, (tag) => (tag.name === name ? { ...tag, aliasFor } : tag)),
    { name, aliasFor },
  );
}

/** Count how many ladder operands reference `tagName` (by base name) across the project. */
function countReferences(project: PlcProject, tagName: string): number {
  let count = 0;
  for (const controller of project.controllers) {
    for (const program of controller.programs) {
      for (const routine of program.routines) {
        const ladder = getLadder(routine);
        if (!ladder) continue;
        for (const node of routineNodes(ladder)) {
          for (const operand of node.operands) {
            if (baseTagName(operand.value) === tagName) count += 1;
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
  if (!tagExists(project, from)) return fail(project, `Tag "${from}" does not exist.`);
  if (from === to) return ok(project, { from, to });
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(to)) return fail(project, `Invalid tag name "${to}".`);
  if (tagExists(project, to)) return fail(project, `Tag "${to}" already exists.`);

  const renamed = mapAllTags(project, (tag) => (tag.name === from ? { ...tag, name: to } : tag));
  const remapped = mapAllLadders(renamed, (ladder) =>
    mapRoutineNodes(ladder, (node) => ({
      ...node,
      operands: node.operands.map((operand) =>
        baseTagName(operand.value) === from
          ? { ...operand, value: to + operand.value.slice(from.length) }
          : operand,
      ),
    })),
  );
  return ok(remapped, { from, to });
}

/** Delete a tag only if it is not referenced by any ladder logic. */
export function deleteTag(
  project: PlcProject,
  input: DeleteTagInput,
): ProjectActionResult<{ name: string }> {
  const name = input.name?.trim();
  if (!name) return fail(project, "Tag name is required.");
  if (!tagExists(project, name)) return fail(project, `Tag "${name}" does not exist.`);

  const references = countReferences(project, name);
  if (references > 0) {
    return fail(project, `Cannot delete "${name}": still referenced by ${references} operand(s).`);
  }

  return ok(mapAllTags(project, (tag) => (tag.name === name ? null : tag)), { name });
}
