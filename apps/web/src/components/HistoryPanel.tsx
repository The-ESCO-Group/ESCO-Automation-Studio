import type { ActivityEntry } from "../activity";

interface Props {
  undoDepth: number;
  redoDepth: number;
  dirty: boolean;
  activity: ActivityEntry[];
}

const KIND_LABEL: Record<ActivityEntry["kind"], string> = {
  import: "Import",
  export: "Export",
  open: "Open",
  ai: "AI",
  compare: "Compare",
  info: "Info",
};

function formatTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleTimeString();
}

/** Inspector History tab: undo/redo depth, dirty state, and a session activity log. */
export function HistoryPanel({ undoDepth, redoDepth, dirty, activity }: Props) {
  return (
    <div className="esco-history">
      <div className="esco-history__heading">Edit state</div>
      <dl className="esco-history__state">
        <div className="esco-props__row">
          <dt>Undo steps</dt>
          <dd>{undoDepth}</dd>
        </div>
        <div className="esco-props__row">
          <dt>Redo steps</dt>
          <dd>{redoDepth}</dd>
        </div>
        <div className="esco-props__row">
          <dt>Unsaved</dt>
          <dd>{dirty ? "Yes — autosaved locally" : "No"}</dd>
        </div>
      </dl>

      <div className="esco-history__heading">Session activity</div>
      {activity.length === 0 ? (
        <p className="esco-empty">No activity yet. Imports, exports, and AI applies appear here.</p>
      ) : (
        <ul className="esco-history__log">
          {activity.map((entry) => (
            <li key={entry.id} className="esco-history__entry">
              <span className={`esco-history__kind esco-history__kind--${entry.kind}`}>
                {KIND_LABEL[entry.kind]}
              </span>
              <span className="esco-history__msg">{entry.message}</span>
              <span className="esco-history__time">{formatTime(entry.at)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
