import {
  ESCO_CAPABILITY_AREAS,
  ESCO_CAPABILITY_STATUS_LABELS,
  escoCapabilityCounts,
} from "../escoCapabilityMap";
import {
  ESCO_COMMAND_SURFACE_KIND_LABELS,
  escoCommandSurfaceCounts,
  escoCommandSurfaceGroupSummaries,
  escoCommandSurfaceGuardFindings,
} from "../command-surface";
import {
  EASRT_LEGACY_EXTENSION,
  ESCO_COMPONENT_ARTIFACT_FORMATS,
  ESCO_FILE_FORMATS,
  PLCPROJ_JSON_LEGACY_EXTENSION,
  type EscoFormatStatus,
} from "@esco/project-actions";

const SHORTCUTS: { keys: string; action: string }[] = [
  { keys: "F1", action: "Open Help" },
  { keys: "Ctrl+F", action: "Open Search Results" },
  { keys: "F3 / Shift+F3", action: "Find next / previous" },
  { keys: "Ctrl+S / Ctrl+Shift+S", action: "Save / Save As" },
  { keys: "Ctrl+N / Ctrl+O", action: "New project / Open project" },
  { keys: "Ctrl+Z", action: "Undo" },
  { keys: "Ctrl+Y / Ctrl+Shift+Z", action: "Redo" },
  { keys: "Ctrl+Tab", action: "Cycle open routine tabs" },
  { keys: "Enter (chat)", action: "Send prompt to the assistant" },
];

const LIMITATIONS = [
  "Offline/simulator first — no real physical PLC / controller communication.",
  "ESCO-native project and runtime files are the primary workflow.",
  "Proprietary binary controller-project files are blocked.",
  "L5X import/export is legacy review-only; it is not the primary project backbone.",
  "Unsupported instructions are preserved read-only and not simulated.",
  "Scan-cycle simulation is an offline approximation, not exact controller timing.",
  "No external AI key required — the assistant runs a local rule-based provider.",
];

const FORMAT_STATUS_LABELS: Record<EscoFormatStatus, string> = {
  implemented: "Implemented",
  "schema-registered": "Schema registered",
  "name-registered": "Name registered",
};

/** Inspector Help tab: offline safety posture, shortcuts, and current limitations. */
export function HelpPanel() {
  const parityCounts = escoCapabilityCounts();
  const commandCounts = escoCommandSurfaceCounts();
  const commandGroups = escoCommandSurfaceGroupSummaries();
  const commandGuardFindings = escoCommandSurfaceGuardFindings();
  const runnableOffline = parityCounts.implemented + parityCounts["simulation-only"];
  const reviewOnly = parityCounts["model-only"] + parityCounts["review-only"];

  return (
    <div className="esco-help">
      <div className="esco-help__heading">Safety</div>
      <p className="esco-help__notice">
        ESCO Automation Studio is an offline internal engineering tool. ESCO-native project and
        runtime files are the primary workflow; vendor interchange is legacy review-only. The app
        edits project models locally and never communicates with a physical controller. Generated
        changes are previews you review and apply through the controlled action layer — verify all
        logic in a sandbox project before any production use.
      </p>

      <div className="esco-help__heading">Shortcuts</div>
      <dl className="esco-props">
        {SHORTCUTS.map((s) => (
          <div className="esco-props__row" key={s.action}>
            <dt>{s.keys}</dt>
            <dd>{s.action}</dd>
          </div>
        ))}
      </dl>

      <div className="esco-help__heading">ESCO capability map</div>
      <p className="esco-help__notice">
        Current surface: {runnableOffline} implemented or simulation-only areas, {parityCounts.partial} partial
        areas, {reviewOnly} model/review-only areas, {parityCounts.planned} planned area, and{" "}
        {parityCounts.unsupported} unsupported hardware or native-format areas. The map is intentionally
        conservative: a feature is marked runnable only when the IDE has an offline path to exercise it.
      </p>
      <ul className="esco-parity__list esco-parity__list--help">
        {ESCO_CAPABILITY_AREAS.map((area) => (
          <li key={area.area} className={`esco-parity__row is-${area.status}`}>
            <div>
              <strong>{area.area}</strong>
              <small>
                {area.summary} Visible in: {area.visibleIn}. Next: {area.next}
              </small>
            </div>
            <span title={ESCO_CAPABILITY_STATUS_LABELS[area.status]}>{area.label}</span>
          </li>
        ))}
      </ul>

      <div className="esco-help__heading">Command surface audit</div>
      <p className="esco-help__notice">
        Ribbon, toolbar, path/status, and organizer context commands are classified by their action path.
        Offline actions mutate the local ESCO project model, review commands import/export inspectable
        artifacts, simulation commands use local runtime state, and hardware commands remain guarded by
        the controller capability map.
      </p>
      <dl className="esco-props">
        {Object.entries(commandCounts).map(([kind, count]) => (
          <div className="esco-props__row" key={kind}>
            <dt>{ESCO_COMMAND_SURFACE_KIND_LABELS[kind as keyof typeof ESCO_COMMAND_SURFACE_KIND_LABELS]}</dt>
            <dd>{count}</dd>
          </div>
        ))}
        <div className="esco-props__row">
          <dt>Guard audit</dt>
          <dd>{commandGuardFindings.length === 0 ? "All guarded hardware commands map to unsupported capability gates." : `${commandGuardFindings.length} finding(s)`}</dd>
        </div>
      </dl>
      <div className="esco-help__formats" aria-label="ESCO command surface coverage">
        <table>
          <thead>
            <tr>
              <th>Surface</th>
              <th>Group</th>
              <th>Total</th>
              <th>Offline</th>
              <th>Review</th>
              <th>Sim</th>
              <th>Guarded</th>
            </tr>
          </thead>
          <tbody>
            {commandGroups
              .filter((group) => group.total >= 4 || group.guarded > 0)
              .map((group) => (
                <tr key={group.key}>
                  <td>{group.surface}</td>
                  <td>{group.group}</td>
                  <td>{group.total}</td>
                  <td>{group.offline}</td>
                  <td>{group.review}</td>
                  <td>{group.simulation}</td>
                  <td>{group.guarded}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      <div className="esco-help__heading">ESCO file formats</div>
      <p className="esco-help__notice">
        ESCO-native files are inspectable JSON artifacts owned by ESCO Automation Studio. They are
        offline project/runtime/component files only: no proprietary binary project container, no
        physical-controller upload/download, and no online edit transport is implied.
      </p>
      <div className="esco-help__formats" aria-label="ESCO native file format reference">
        <table>
          <thead>
            <tr>
              <th>Extension</th>
              <th>Name</th>
              <th>Status</th>
              <th>Purpose</th>
            </tr>
          </thead>
          <tbody>
            {ESCO_FILE_FORMATS.map((format) => (
              <tr key={format.extension}>
                <td>
                  <strong>{format.extension}</strong>
                  {format.aliases?.length ? <span>Alias: {format.aliases.join(", ")}</span> : null}
                </td>
                <td>{format.name}</td>
                <td>{FORMAT_STATUS_LABELS[format.status]}</td>
                <td>{format.role}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <dl className="esco-help__format-notes">
        <div>
          <dt>Editable project</dt>
          <dd>
            `.easproj` is the current project-of-record format; {PLCPROJ_JSON_LEGACY_EXTENSION} remains a
            compatibility import alias.
          </dd>
        </div>
        <div>
          <dt>Runtime and package</dt>
          <dd>
            `.easruntime` and `.easpkg` are implemented with checksum validation; {EASRT_LEGACY_EXTENSION} is
            accepted only as an older runtime import name.
          </dd>
        </div>
        <div>
          <dt>Component artifacts</dt>
          <dd>
            {ESCO_COMPONENT_ARTIFACT_FORMATS.map((format) => format.extension).join(", ")}
          </dd>
        </div>
      </dl>

      <div className="esco-help__heading">Current limitations</div>
      <ul className="esco-help__list">
        {LIMITATIONS.map((limitation) => (
          <li key={limitation}>{limitation}</li>
        ))}
      </ul>
    </div>
  );
}
