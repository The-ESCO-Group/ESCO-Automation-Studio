import type { PlcProject } from "@esco/core";
import { collectTagReferences, type TagReference } from "./cross-reference";

/** Per-tag rollup of every reference, mirroring Studio's Cross Reference window. */
export interface TagReferenceSummary {
  /** Reference key — a base tag name, or `Program:ProgramName.Tag` for a qualified program-scope reference. */
  tag: string;
  /** Total references collected for this tag. */
  total: number;
  /** References whose instruction reads the operand. */
  reads: number;
  /** Destructive references — instructions that write the operand. */
  writes: number;
  /** Distinct routines the tag is referenced in. */
  routineCount: number;
  /** The individual references, in collection order. */
  references: TagReference[];
}

/** A declared tag that no routine references (Studio's Verify flags these as unused). */
export interface UnreferencedTag {
  /** Display name — qualified `Program:ProgramName.Tag` for program-scoped tags, bare name otherwise. */
  tag: string;
  scope: "controller" | "program";
  programName?: string;
  dataType: string;
}

/** A Studio-style Cross Reference report: per-tag rollups plus unused-tag detection. */
export interface CrossReferenceReport {
  /** One entry per referenced tag, sorted by tag name. */
  tags: TagReferenceSummary[];
  /** Declared tags that are never referenced in any routine, sorted by display name. */
  unreferencedTags: UnreferencedTag[];
}

/**
 * Roll up ladder references into a Studio-style Cross Reference report: one entry
 * per referenced tag (with read / destructive-write / distinct-routine counts) plus
 * the declared tags that no routine references.
 *
 * References are matched by operand text (the same base/qualified naming
 * `collectTagReferences` produces); alias targets are not resolved, so a tag used
 * only through an alias counts the alias name, mirroring a text-level cross
 * reference. Pass pre-collected `references` to avoid re-walking the project.
 */
export function summarizeTagReferences(
  project: PlcProject,
  references: TagReference[] = collectTagReferences(project),
): CrossReferenceReport {
  const byTag = new Map<string, TagReference[]>();
  for (const reference of references) {
    const bucket = byTag.get(reference.tag);
    if (bucket) bucket.push(reference);
    else byTag.set(reference.tag, [reference]);
  }

  const tags: TagReferenceSummary[] = [...byTag.entries()]
    .map(([tag, refs]) => ({
      tag,
      total: refs.length,
      reads: refs.filter((ref) => ref.direction === "read").length,
      writes: refs.filter((ref) => ref.direction === "write").length,
      routineCount: new Set(refs.map((ref) => ref.routineId)).size,
      references: refs,
    }))
    .sort((a, b) => a.tag.localeCompare(b.tag));

  const referenced = new Set(references.map((ref) => ref.tag));
  const unreferencedTags: UnreferencedTag[] = [];
  for (const controller of project.controllers) {
    for (const tag of controller.controllerTags) {
      if (!referenced.has(tag.name)) {
        unreferencedTags.push({ tag: tag.name, scope: "controller", dataType: tag.dataType });
      }
    }
    for (const program of controller.programs) {
      for (const tag of program.programTags) {
        const qualified = `Program:${program.name}.${tag.name}`;
        if (!referenced.has(tag.name) && !referenced.has(qualified)) {
          unreferencedTags.push({
            tag: qualified,
            scope: "program",
            programName: program.name,
            dataType: tag.dataType,
          });
        }
      }
    }
  }
  unreferencedTags.sort((a, b) => a.tag.localeCompare(b.tag));

  return { tags, unreferencedTags };
}
