import { useEffect, useMemo, useState } from "react";
import {
  getHmiElementDefinition,
  hmiElementDefinitionsByCategory,
  validateHmiProject,
  type HmiElementDefinition,
  type HmiGraphicElement,
  type HmiProject,
  type HmiSurfaceKind,
} from "@esco/hmi-model";
import "./HmiDesigner.css";

type SurfaceSelection =
  | { kind: "screen"; id: string }
  | { kind: "popup"; id: string }
  | { kind: "system-banner"; id: string };

interface Props {
  hmi: HmiProject | undefined;
  knownTagPaths: string[];
  selectedSurface?: SurfaceSelection;
  onEnableProject: () => void;
  onCreateScreen: (name: string) => void;
  onCreatePopup: (name: string) => void;
  onAddElement: (surfaceKind: HmiSurfaceKind, surfaceId: string, typeId: string) => void;
  onSelectSurface: (selection: SurfaceSelection) => void;
}

interface ActiveSurface {
  kind: HmiSurfaceKind;
  id: string;
  name: string;
  width: number;
  height: number;
  background: string;
  updateRateMs: number;
  elements: HmiGraphicElement[];
}

const CATEGORY_LABELS: Record<string, string> = {
  common: "Common",
  alarms: "Alarms",
  diagnostics: "Diagnostics",
  navigation: "Navigation",
  trends: "Trends",
  media: "Media",
  system: "System",
};

function elementCaption(element: HmiGraphicElement): string {
  const definition = getHmiElementDefinition(element.typeId);
  return definition?.displayName ?? element.unsupported?.originalType ?? element.typeId;
}

function propertyLabel(element: HmiGraphicElement): string {
  const text =
    element.properties.text ??
    element.properties.label ??
    element.properties.title ??
    element.properties.altText ??
    element.name;
  return String(text);
}

function surfaceFromSelection(hmi: HmiProject, selection?: SurfaceSelection): ActiveSurface | undefined {
  if (selection?.kind === "screen") return hmi.screens.find((screen) => screen.id === selection.id);
  if (selection?.kind === "popup") return hmi.popups.find((popup) => popup.id === selection.id);
  if (selection?.kind === "system-banner" && selection.id === hmi.systemBanner.id) return hmi.systemBanner;
  return hmi.screens[0] ?? hmi.systemBanner;
}

function renderElementBody(element: HmiGraphicElement) {
  const definition = getHmiElementDefinition(element.typeId);
  const caption = propertyLabel(element);
  const valueBinding = element.bindings.find((binding) => binding.targetProperty === "value");
  if (element.unsupported || !definition) {
    return (
      <>
        <strong>{element.name}</strong>
        <span>Read-only unsupported</span>
      </>
    );
  }
  if (definition.typeId === "common.button") return <strong>{caption}</strong>;
  if (definition.typeId === "common.numeric-display") {
    return (
      <>
        <span>{caption}</span>
        <strong>{valueBinding?.source.path ?? "0"}</strong>
      </>
    );
  }
  if (definition.typeId === "common.numeric-input") {
    return (
      <>
        <span>{caption}</span>
        <strong>{valueBinding?.source.path ?? "enter value"}</strong>
      </>
    );
  }
  if (definition.typeId === "trends.trend-chart") {
    return (
      <>
        <strong>{caption}</strong>
        <span className="esco-hmi-element__gridline" />
        <span>Model-only trend</span>
      </>
    );
  }
  if (definition.typeId === "alarms.alarm-summary") {
    return (
      <>
        <strong>{caption}</strong>
        <span>Time | Severity | Message</span>
        <span>Alarm model preserved</span>
      </>
    );
  }
  if (definition.typeId === "navigation.menu") {
    return (
      <>
        <strong>Navigation</strong>
        <span>Home</span>
        <span>Alarms</span>
        <span>Trends</span>
      </>
    );
  }
  if (definition.typeId === "media.image-placeholder") {
    return (
      <>
        <strong>Image</strong>
        <span>{caption}</span>
      </>
    );
  }
  return <strong>{caption}</strong>;
}

function ElementOnCanvas({
  element,
  surface,
  selected,
  onSelect,
}: {
  element: HmiGraphicElement;
  surface: ActiveSurface;
  selected: boolean;
  onSelect: () => void;
}) {
  const definition = getHmiElementDefinition(element.typeId);
  const style = {
    left: `${(element.geometry.x / surface.width) * 100}%`,
    top: `${(element.geometry.y / surface.height) * 100}%`,
    width: `${(element.geometry.width / surface.width) * 100}%`,
    height: `${(element.geometry.height / surface.height) * 100}%`,
    zIndex: element.zIndex,
    background: element.style?.fill,
    borderColor: element.style?.stroke,
    color: element.style?.textColor,
    opacity: element.style?.opacity,
    fontSize: element.style?.fontSize ? `${element.style.fontSize}px` : undefined,
  };
  return (
    <button
      type="button"
      className={[
        "esco-hmi-element",
        selected ? "is-selected" : "",
        element.unsupported ? "is-unsupported" : "",
        definition?.runtimeSupport === "model-only" ? "is-model-only" : "",
      ].join(" ")}
      style={style}
      onClick={onSelect}
      title={element.unsupported?.readonlyReason ?? definition?.description}
    >
      {renderElementBody(element)}
    </button>
  );
}

function ToolboxGroup({
  label,
  definitions,
  disabled,
  onAdd,
}: {
  label: string;
  definitions: HmiElementDefinition[];
  disabled: boolean;
  onAdd: (typeId: string) => void;
}) {
  return (
    <section className="esco-hmi-toolbox__group">
      <h3>{label}</h3>
      <div className="esco-hmi-toolbox__buttons">
        {definitions.map((definition) => (
          <button
            key={definition.typeId}
            type="button"
            disabled={disabled}
            onClick={() => onAdd(definition.typeId)}
            title={definition.description}
          >
            <span>{definition.displayName}</span>
            {definition.runtimeSupport === "model-only" ? <em>model</em> : null}
          </button>
        ))}
      </div>
    </section>
  );
}

function PropertiesPanel({
  surface,
  element,
}: {
  surface: ActiveSurface | undefined;
  element: HmiGraphicElement | undefined;
}) {
  if (!surface) {
    return (
      <aside className="esco-hmi-properties">
        <h2>Properties</h2>
        <p className="esco-empty">Create a screen or select the system banner.</p>
      </aside>
    );
  }

  if (!element) {
    return (
      <aside className="esco-hmi-properties">
        <h2>Surface Properties</h2>
        <dl>
          <dt>Name</dt>
          <dd>{surface.name}</dd>
          <dt>Kind</dt>
          <dd>{surface.kind}</dd>
          <dt>Canvas</dt>
          <dd>{surface.width} x {surface.height}</dd>
          <dt>Update rate</dt>
          <dd>{surface.updateRateMs} ms</dd>
          <dt>Elements</dt>
          <dd>{surface.elements.length}</dd>
        </dl>
      </aside>
    );
  }

  const definition = getHmiElementDefinition(element.typeId);
  return (
    <aside className="esco-hmi-properties">
      <div className="esco-hmi-properties__title">
        <h2>{element.name}</h2>
        {element.unsupported ? <span className="esco-hmi-badge esco-hmi-badge--warn">Read-only</span> : null}
        {definition?.runtimeSupport === "model-only" ? <span className="esco-hmi-badge">Model-only</span> : null}
      </div>
      <dl>
        <dt>Type</dt>
        <dd>{elementCaption(element)}</dd>
        <dt>Position</dt>
        <dd>{element.geometry.x}, {element.geometry.y}</dd>
        <dt>Size</dt>
        <dd>{element.geometry.width} x {element.geometry.height}</dd>
        <dt>Bindings</dt>
        <dd>{element.bindings.length || "None"}</dd>
        <dt>Events</dt>
        <dd>{element.events.length || "None"}</dd>
      </dl>
      {element.unsupported ? <p className="esco-hmi-note">{element.unsupported.readonlyReason}</p> : null}
      <section>
        <h3>Properties</h3>
        <ul>
          {Object.entries(element.properties).length ? (
            Object.entries(element.properties).map(([key, value]) => (
              <li key={key}><span>{key}</span><strong>{String(value)}</strong></li>
            ))
          ) : (
            <li><span>No custom properties</span></li>
          )}
        </ul>
      </section>
      <section>
        <h3>Bindings</h3>
        <ul>
          {element.bindings.length ? (
            element.bindings.map((binding) => (
              <li key={binding.id}>
                <span>{binding.targetProperty}</span>
                <strong>{binding.source.kind}: {binding.source.path}</strong>
              </li>
            ))
          ) : (
            <li><span>No bindings configured</span></li>
          )}
        </ul>
      </section>
    </aside>
  );
}

export function HmiDesigner({
  hmi,
  knownTagPaths,
  selectedSurface,
  onEnableProject,
  onCreateScreen,
  onCreatePopup,
  onAddElement,
  onSelectSurface,
}: Props) {
  const [screenName, setScreenName] = useState("Overview");
  const [popupName, setPopupName] = useState("Popup");
  const [selectedElementId, setSelectedElementId] = useState<string | undefined>();
  const groups = useMemo(() => hmiElementDefinitionsByCategory(), []);
  const findings = useMemo(() => validateHmiProject(hmi, { knownTagPaths }), [hmi, knownTagPaths]);
  const surface = hmi ? surfaceFromSelection(hmi, selectedSurface) : undefined;
  const selectedElement = surface?.elements.find((element) => element.id === selectedElementId);

  useEffect(() => {
    setSelectedElementId(undefined);
  }, [surface?.id]);

  if (!hmi) {
    return (
      <div className="esco-hmi esco-hmi--empty">
        <div className="esco-hmi-empty-card">
          <span className="esco-hmi-empty-card__icon">HMI</span>
          <h1>HMI View Designer</h1>
          <p>
            Add a real HMI project model to this ESCO project. Screens, popups, banners, bindings,
            events, alarms, trends, data logs, security, and language packs will persist in project data.
          </p>
          <button type="button" className="esco-btn esco-btn--primary" onClick={onEnableProject}>
            Enable HMI Project
          </button>
        </div>
      </div>
    );
  }

  const addToSurface = (typeId: string) => {
    if (!surface) return;
    onAddElement(surface.kind, surface.id, typeId);
  };

  return (
    <div className="esco-hmi" data-testid="hmi-designer">
      <header className="esco-hmi__header">
        <div>
          <p className="esco-kicker">HMI View Designer</p>
          <h1>{hmi.name}</h1>
        </div>
        <div className="esco-hmi__device">
          <span>{hmi.targetDevice.name}</span>
          <strong>{hmi.targetDevice.width} x {hmi.targetDevice.height}</strong>
          <em>Offline runtime preview</em>
        </div>
      </header>

      <div className="esco-hmi__workspace">
        <aside className="esco-hmi-nav">
          <section>
            <h2>Screens</h2>
            <div className="esco-hmi-create">
              <input value={screenName} onChange={(event) => setScreenName(event.target.value)} aria-label="New HMI screen name" />
              <button type="button" onClick={() => onCreateScreen(screenName)}>New</button>
            </div>
            <ul>
              {hmi.screens.map((screen) => (
                <li key={screen.id}>
                  <button
                    type="button"
                    className={surface?.id === screen.id ? "is-active" : undefined}
                    onClick={() => onSelectSurface({ kind: "screen", id: screen.id })}
                  >
                    <span>{screen.name}</span>
                    {hmi.homeScreenId === screen.id ? <em>Home</em> : null}
                  </button>
                </li>
              ))}
              {hmi.screens.length === 0 ? <li className="esco-hmi-nav__empty">No screens created</li> : null}
            </ul>
          </section>

          <section>
            <h2>Popups</h2>
            <div className="esco-hmi-create">
              <input value={popupName} onChange={(event) => setPopupName(event.target.value)} aria-label="New HMI popup name" />
              <button type="button" onClick={() => onCreatePopup(popupName)}>New</button>
            </div>
            <ul>
              {hmi.popups.map((popup) => (
                <li key={popup.id}>
                  <button
                    type="button"
                    className={surface?.id === popup.id ? "is-active" : undefined}
                    onClick={() => onSelectSurface({ kind: "popup", id: popup.id })}
                  >
                    <span>{popup.name}</span>
                    <em>{popup.width}x{popup.height}</em>
                  </button>
                </li>
              ))}
              {hmi.popups.length === 0 ? <li className="esco-hmi-nav__empty">No popups created</li> : null}
            </ul>
          </section>

          <section>
            <h2>Shared</h2>
            <button
              type="button"
              className={surface?.id === hmi.systemBanner.id ? "esco-hmi-nav__banner is-active" : "esco-hmi-nav__banner"}
              onClick={() => onSelectSurface({ kind: "system-banner", id: hmi.systemBanner.id })}
            >
              <span>System Banner</span>
              <em>{hmi.systemBanner.height}px</em>
            </button>
          </section>
        </aside>

        <main className="esco-hmi-main">
          <div className="esco-hmi-toolbox">
            {Object.entries(groups).map(([category, definitions]) => (
              <ToolboxGroup
                key={category}
                label={CATEGORY_LABELS[category] ?? category}
                definitions={definitions}
                disabled={!surface}
                onAdd={addToSurface}
              />
            ))}
          </div>

          <section className="esco-hmi-canvas">
            <div className="esco-hmi-canvas__toolbar">
              <strong>{surface?.name ?? "No surface selected"}</strong>
              <span>{surface ? `${surface.width} x ${surface.height}` : "Create a screen to begin"}</span>
              <em>No controller or device connection active</em>
            </div>
            {surface ? (
              <div
                className="esco-hmi-canvas__surface"
                style={{ aspectRatio: `${surface.width} / ${surface.height}`, background: surface.background }}
              >
                <div className="esco-hmi-canvas__grid" aria-hidden="true" />
                {surface.elements.map((element) => (
                  <ElementOnCanvas
                    key={element.id}
                    element={element}
                    surface={surface}
                    selected={element.id === selectedElementId}
                    onSelect={() => setSelectedElementId(element.id)}
                  />
                ))}
                {surface.elements.length === 0 ? (
                  <div className="esco-hmi-canvas__empty">
                    <strong>Empty {surface.kind}</strong>
                    <span>Add an element from the toolbox above.</span>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="esco-hmi-canvas__placeholder">Create a screen to open the HMI canvas.</div>
            )}
          </section>
        </main>

        <PropertiesPanel surface={surface} element={selectedElement} />
      </div>

      <footer className="esco-hmi-diagnostics">
        <strong>HMI Diagnostics</strong>
        <span>{findings.filter((finding) => finding.severity === "error").length} errors</span>
        <span>{findings.filter((finding) => finding.severity === "warning").length} warnings</span>
        <span>{findings.filter((finding) => finding.severity === "info").length} messages</span>
        <div>
          {findings.slice(0, 3).map((finding) => (
            <p key={`${finding.ruleId}:${finding.target ?? ""}`}>
              <em>{finding.severity}</em>
              {finding.message}
            </p>
          ))}
        </div>
      </footer>
    </div>
  );
}
