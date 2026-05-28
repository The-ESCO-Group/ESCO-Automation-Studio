import { createTag, TAG_DATA_TYPES, type Tag, type TagScope } from "@esco/core";
import { attr, child, text, toArray, type L5XNode } from "./parseL5X";

export interface ExtractedTags {
  tags: Tag[];
  warnings: string[];
}

/** Data types the model understands (atomics, common integers, and structures). */
const KNOWN_DATATYPES = new Set<string>([
  ...TAG_DATA_TYPES, // BOOL, DINT, REAL, TIMER, COUNTER
  "SINT",
  "INT",
  "LINT",
  "STRING",
  "ALIAS",
]);

/**
 * Extract `<Tag>` elements from a `<Tags>` container into domain tags, reading
 * Name, DataType, Description, and AliasFor. Emits warnings for alias tags and
 * for data types the model doesn't represent (UDTs, AOIs, module types), which
 * are still imported but treated as opaque by simulation/validation.
 */
export function extractTags(
  tagsContainer: unknown,
  controllerId: string,
  scope: TagScope,
  programId?: string,
): ExtractedTags {
  const warnings: string[] = [];
  const scopeLabel = scope === "controller" ? "Controller" : "Program";

  const tags = toArray<L5XNode>(child(tagsContainer, "Tag")).flatMap((tagNode) => {
    const name = attr(tagNode, "Name");
    if (!name) return [];

    const aliasFor = attr(tagNode, "AliasFor");
    const dataType = attr(tagNode, "DataType") ?? (aliasFor ? "ALIAS" : "BOOL");
    const descriptionNode = child(tagNode, "Description");
    // Dimensions may be "8" or multi-dim "8 4"; model the first (outer) dimension.
    const firstDim = Number((attr(tagNode, "Dimensions") ?? "").trim().split(/\s+/)[0]);
    const dimension = Number.isFinite(firstDim) && firstDim > 0 ? firstDim : undefined;

    const tag = createTag(controllerId, name, dataType, {
      scope,
      programId,
      description: descriptionNode ? text(descriptionNode) : undefined,
      value: dataType === "BOOL" ? false : 0,
      dimension,
    });

    if (aliasFor) {
      tag.aliasFor = aliasFor;
      warnings.push(`${scopeLabel} tag "${name}" is an alias for "${aliasFor}" (imported as alias).`);
    } else if (!KNOWN_DATATYPES.has(dataType)) {
      warnings.push(
        `${scopeLabel} tag "${name}" has unmodeled data type "${dataType}" (imported, treated as opaque).`,
      );
    }
    return [tag];
  });

  return { tags, warnings };
}
