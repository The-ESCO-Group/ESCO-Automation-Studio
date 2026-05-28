import { createTag, type Tag, type TagScope } from "@esco/core";
import { attr, child, text, toArray, type L5XNode } from "./parseL5X";

/**
 * Extract `<Tag>` elements from a `<Tags>` container into domain tags.
 * Reads Name, DataType, Description, and AliasFor (alias tags).
 */
export function extractTags(
  tagsContainer: unknown,
  controllerId: string,
  scope: TagScope,
  programId?: string,
): Tag[] {
  return toArray<L5XNode>(child(tagsContainer, "Tag")).flatMap((tagNode) => {
    const name = attr(tagNode, "Name");
    if (!name) return [];

    const aliasFor = attr(tagNode, "AliasFor");
    const dataType = attr(tagNode, "DataType") ?? (aliasFor ? "ALIAS" : "BOOL");
    const descriptionNode = child(tagNode, "Description");

    const tag = createTag(controllerId, name, dataType, {
      scope,
      programId,
      description: descriptionNode ? text(descriptionNode) : undefined,
      value: dataType === "BOOL" ? false : 0,
    });
    if (aliasFor) tag.aliasFor = aliasFor;
    return [tag];
  });
}
