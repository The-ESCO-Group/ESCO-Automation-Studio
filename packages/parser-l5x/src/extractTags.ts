import { createTag, type Tag, type TagScope } from "@esco/core";
import { attr, child, toArray, type L5XNode } from "./parseL5X";

/**
 * Extract `<Tag>` elements from a `<Tags>` container into domain tags.
 * `Name` and `DataType` are read; the value is left at its power-up default.
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
    const dataType = attr(tagNode, "DataType") ?? "BOOL";
    return [
      createTag(controllerId, name, dataType, {
        scope,
        programId,
        value: dataType === "BOOL" ? false : 0,
      }),
    ];
  });
}
