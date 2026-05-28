import { useMemo, useState } from "react";
import type { PlcProject, Tag } from "@esco/core";
import { TAG_DATA_TYPES, isStructuredType, memberDefs } from "@esco/core";
import { collectTagReferences, outputTags } from "@esco/project-actions";
import { getTags } from "../project-edit";
import type { TagValues } from "../simulation";

interface Props {
  project: PlcProject;
  values: TagValues;
  onAddTag: (name: string, dataType: string, description: string) => void;
  onRenameTag: (from: string, to: string) => void;
  onDeleteTag: (name: string) => void;
  onEditDescription: (name: string, description: string) => void;
}

interface TagRow {
  tag: Tag;
  role: "input" | "output" | "internal";
  references: number;
  value: string;
}

function formatValue(values: TagValues, tag: Tag): string {
  if (isStructuredType(tag.dataType)) {
    return memberDefs(tag.dataType)
      .map((m) => `${m.name}=${String(values[`${tag.name}.${m.name}`] ?? (m.type === "BOOL" ? false : 0))}`)
      .join(" · ");
  }
  return String(values[tag.name] ?? (tag.dataType === "BOOL" ? false : 0));
}

export function TagsView({
  project,
  values,
  onAddTag,
  onRenameTag,
  onDeleteTag,
  onEditDescription,
}: Props) {
  const [filter, setFilter] = useState("");
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState("BOOL");
  const [newDesc, setNewDesc] = useState("");

  const rows = useMemo<TagRow[]>(() => {
    const outputs = outputTags(project);
    const refsByTag = new Map<string, number>();
    for (const ref of collectTagReferences(project)) {
      refsByTag.set(ref.tag, (refsByTag.get(ref.tag) ?? 0) + 1);
    }
    return getTags(project).map((tag) => {
      const references = refsByTag.get(tag.name) ?? 0;
      const role: TagRow["role"] = outputs.has(tag.name) ? "output" : references > 0 ? "input" : "internal";
      return { tag, role, references, value: formatValue(values, tag) };
    });
  }, [project, values]);

  const term = filter.trim().toLowerCase();
  const visible = term
    ? rows.filter((r) => r.tag.name.toLowerCase().includes(term) || r.tag.dataType.toLowerCase().includes(term))
    : rows;

  const handleAdd = () => {
    const name = newName.trim();
    if (!name) return;
    onAddTag(name, newType, newDesc.trim());
    setNewName("");
    setNewDesc("");
  };

  return (
    <div className="esco-tags">
      <div className="esco-tags__bar">
        <input
          className="esco-tags__search"
          placeholder="Search tags…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          spellCheck={false}
        />
        <span className="esco-tags__count">{visible.length} of {rows.length} tags</span>
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
        <select className="esco-tags__select" value={newType} onChange={(e) => setNewType(e.target.value)}>
          {TAG_DATA_TYPES.map((type) => (
            <option key={type} value={type}>{type}</option>
          ))}
        </select>
        <input
          className="esco-tags__input"
          placeholder="Description (optional)"
          value={newDesc}
          spellCheck={false}
          onChange={(e) => setNewDesc(e.target.value)}
        />
        <button type="button" className="esco-btn esco-btn--primary" onClick={handleAdd}>
          Add Tag
        </button>
      </div>

      {rows.length === 0 ? (
        <p className="esco-empty">No tags yet. Add one above.</p>
      ) : (
        <table className="esco-tags__table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th>Scope</th>
              <th>Description</th>
              <th>Value</th>
              <th>Role</th>
              <th>Refs</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {visible.map(({ tag, role, references, value }) => (
              <tr key={tag.id}>
                <td>
                  <input
                    className="esco-tags__cell-input"
                    defaultValue={tag.name}
                    spellCheck={false}
                    title="Rename (commits on blur)"
                    onBlur={(e) => {
                      const next = e.target.value.trim();
                      if (next && next !== tag.name) onRenameTag(tag.name, next);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.currentTarget.blur();
                    }}
                  />
                </td>
                <td>{tag.dataType}</td>
                <td>{tag.scope}</td>
                <td>
                  <input
                    className="esco-tags__cell-input"
                    defaultValue={tag.description ?? ""}
                    placeholder="—"
                    spellCheck={false}
                    onBlur={(e) => {
                      if (e.target.value !== (tag.description ?? "")) onEditDescription(tag.name, e.target.value);
                    }}
                  />
                </td>
                <td className="esco-tags__value">{value}</td>
                <td>
                  <span className={`esco-role esco-role--${role}`}>{role}</span>
                </td>
                <td>{references}</td>
                <td>
                  <button
                    type="button"
                    className="esco-btn esco-btn--danger"
                    disabled={references > 0}
                    title={references > 0 ? `Referenced by ${references} operand(s)` : "Delete tag"}
                    onClick={() => onDeleteTag(tag.name)}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
