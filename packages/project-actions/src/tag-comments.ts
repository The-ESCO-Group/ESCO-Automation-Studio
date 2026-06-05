import type { Tag } from "@esco/core";

export interface TagCommentRow {
  tagName: string;
  operand: string;
  path: string;
  text: string;
}

function commentPath(tagName: string, operand: string): string {
  const trimmed = operand.trim();
  if (!trimmed) return tagName;
  if (trimmed.startsWith(".") || trimmed.startsWith("[")) return `${tagName}${trimmed}`;
  return `${tagName}.${trimmed}`;
}

export function tagCommentRows(tag: Tag): TagCommentRow[] {
  return (tag.comments ?? [])
    .filter((comment) => comment.operand.trim() || comment.text.trim())
    .map((comment) => ({
      tagName: tag.name,
      operand: comment.operand,
      path: commentPath(tag.name, comment.operand),
      text: comment.text,
    }));
}

export function tagCommentPreview(tag: Tag, limit = 3): string {
  const rows = tagCommentRows(tag);
  if (rows.length === 0) return "";
  const shown = rows.slice(0, Math.max(0, limit));
  const suffix = rows.length > shown.length ? `; +${rows.length - shown.length} more` : "";
  return `${shown.map((row) => `${row.path}: ${row.text}`).join("; ")}${suffix}`;
}
