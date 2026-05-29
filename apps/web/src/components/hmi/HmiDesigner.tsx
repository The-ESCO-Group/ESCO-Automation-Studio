import { useEffect, useMemo, useState } from "react";
import {
  getHmiElementDefinition,
  hmiElementDefinitionsByCategory,
  validateHmiProject,
  type HmiBindingSourceKind,
  type HmiElementDefinition,
  type HmiElementPropertyDefinition,
  type HmiGraphicElement,
  type HmiProject,
  type HmiPropertyBinding,
  type HmiSurfaceKind,
} from "@esco/hmi-model";
import "./HmiDesigner.css";

type SurfaceSelection =
  | { kind: "screen"; id: string }
  | { kind: "popup"; id: string }
  | { kind: "system-banner"; id: string };

/** A binding the inspector proposes; App fills a stable id when one is absent. */
export type BindingDraft = Omit<HmiPropertyBinding, "id"> & { id?: string };

/** Partial element edit (name / properties / style / visibility / lock). */
export interface ElementPatch {
  name?: string;
  properties?: Record<string, unknown>;
  visible?: boolean;
  locked?: boolean;
}

interface Props {
  hmi: HmiProject | undefined;
  knownTagPaths: string[];
  selectedSurface?: SurfaceSelection;
  onEnableProject: () => void;
  onCreateScreen: (name: string) => void;
  onCreatePopup: (name: string) => void;
  onAddElement: (surfaceKind: HmiSurfaceKind, surfaceId: string, typeId: string) => void;
  onSelectSurface: (selection: SurfaceSelection) => void;
  onUpdateElement: (surfaceKind: HmiSurfaceKind, surfaceId: string, elementId: string, patch: ElementPatch) => void;
  onUpdateElementGeometry: (
    surfaceKind: HmiSurfaceKind,
    surfaceId: string,
    elementId: string,
    geometry: HmiGraphicElement["geometry"],
  ) => void;
  onDeleteElement: (surfaceKind: HmiSurfaceKind, surfaceId: string, elementId: string) => void;
  onSetBinding: (surfaceKind: HmiSurfaceKind, surfaceId: string, elementId: string, binding: BindingDraft) => void;
  onRemoveBinding: (surfaceKind: HmiSurfaceKind, surfaceId: string, elementId: string, bindingId: string) => void;
  onAddNavigationEvent: (
    surfaceKind: HmiSurfaceKind,
    surfaceId: string,
    elementId: string,
    targetScreenId: string,
    eventType: "press" | "release",
  ) => void;
  onRemoveEventCommand: (
    surfaceKind: HmiSurfaceKind,
    surfaceId: string,
    elementId: string,
    eventId: string,
    commandId: string,
  ) => void;
  onSetHomeScreen: (screenId: string) => void;
  onRenameSurface: (surfaceKind: "screen" | "popup", surfaceId: string, name: string) => void;
  onDeleteSurface: (surfaceKind: "screen" | "popup", surfaceId: string) => void;
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

const BINDING_SOURCE_KINDS: HmiBindingSourceKind[] = ["tag", "expression", "property", "system-tag"];

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
    opacity: element.visible === false ? 0.35 : element.style?.opacity,
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

/** One typed property editor input, driven by the element-definition property type. */
function PropertyField({
  definition,
  value,
  screens,
  knownTagPaths,
  onCommit,
}: {
  definition: HmiElementPropertyDefinition;
  value: unknown;
  screens: { id: string; name: string }[];
  knownTagPaths: string[];
  onCommit: (value: unknown) => void;
}) {
  const id = `hmi-prop-${definition.name}`;
  if (definition.dataType === "boolean") {
    return (
      <label className="esco-hmi-edit__row esco-hmi-edit__row--check">
        <span>{definition.label}</span>
        <input
          type="checkbox"
          aria-label={`Property ${definition.name}`}
          defaultChecked={Boolean(value)}
          onChange={(event) => onCommit(event.target.checked)}
        />
      </label>
    );
  }
  if (definition.dataType === "screen-id") {
    return (
      <label className="esco-hmi-edit__row">
        <span>{definition.label}</span>
        <select
          aria-label={`Property ${definition.name}`}
          defaultValue={value === undefined || value === null ? "" : String(value)}
          onChange={(event) => onCommit(event.target.value || undefined)}
        >
          <option value="">(none)</option>
          {screens.map((screen) => (
            <option key={screen.id} value={screen.id}>
              {screen.name}
            </option>
          ))}
        </select>
      </label>
    );
  }
  const inputType =
    definition.dataType === "number" ? "number" : definition.dataType === "color" ? "color" : "text";
  const listId = definition.dataType === "tag-path" ? `${id}-tags` : undefined;
  return (
    <label className="esco-hmi-edit__row">
      <span>{definition.label}</span>
      <input
        type={inputType}
        aria-label={`Property ${definition.name}`}
        list={listId}
        defaultValue={value === undefined || value === null ? "" : String(value)}
        spellCheck={false}
        onBlur={(event) => {
          const raw = event.target.value;
          const next = definition.dataType === "number" ? (raw === "" ? undefined : Number(raw)) : raw;
          if (String(next ?? "") !== String(value ?? "")) onCommit(next);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
      />
      {listId ? (
        <datalist id={listId}>
          {knownTagPaths.map((path) => (
            <option key={path} value={path} />
          ))}
        </datalist>
      ) : null}
    </label>
  );
}

/** Editable inspector for the selected element. Remounted per element via React key. */
function ElementInspector({
  element,
  screens,
  knownTagPaths,
  onUpdate,
  onUpdateGeometry,
  onDelete,
  onSetBinding,
  onRemoveBinding,
  onAddNavigation,
  onRemoveEventCommand,
}: {
  element: HmiGraphicElement;
  screens: { id: string; name: string }[];
  knownTagPaths: string[];
  onUpdate: (patch: ElementPatch) => void;
  onUpdateGeometry: (geometry: HmiGraphicElement["geometry"]) => void;
  onDelete: () => void;
  onSetBinding: (binding: BindingDraft) => void;
  onRemoveBinding: (bindingId: string) => void;
  onAddNavigation: (targetScreenId: string, eventType: "press" | "release") => void;
  onRemoveEventCommand: (eventId: string, commandId: string) => void;
}) {
  const definition = getHmiElementDefinition(element.typeId);
  const bindableProps = definition?.properties.filter((property) => property.bindable) ?? [];
  const eventTypes = definition?.events ?? [];

  const [bindTarget, setBindTarget] = useState(bindableProps[0]?.name ?? "value");
  const [bindKind, setBindKind] = useState<HmiBindingSourceKind>("tag");
  const [bindPath, setBindPath] = useState("");
  const [bindMode, setBindMode] = useState<HmiPropertyBinding["mode"]>("read");
  const [navScreen, setNavScreen] = useState(screens[0]?.id ?? "");
  const [navEvent, setNavEvent] = useState<"press" | "release">("press");

  if (element.unsupported || !definition) {
    return (
      <>
        <div className="esco-hmi-properties__title">
          <h2>{element.name}</h2>
          <span className="esco-hmi-badge esco-hmi-badge--warn">Read-only</span>
        </div>
        <dl>
          <dt>Type</dt>
          <dd>{elementCaption(element)}</dd>
        </dl>
        <p className="esco-hmi-note">
          {element.unsupported?.readonlyReason ?? "This element type is not registered and cannot be edited."}
        </p>
        <button type="button" className="esco-btn esco-btn--danger" onClick={onDelete}>
          Delete element
        </button>
      </>
    );
  }

  const geo = element.geometry;
  const commitGeometry = (patch: Partial<HmiGraphicElement["geometry"]>) =>
    onUpdateGeometry({ ...geo, ...patch });

  return (
    <>
      <div className="esco-hmi-properties__title">
        <h2>{elementCaption(element)}</h2>
        {definition.runtimeSupport === "model-only" ? <span className="esco-hmi-badge">Model-only</span> : null}
      </div>

      <section>
        <h3>Element</h3>
        <label className="esco-hmi-edit__row">
          <span>Name</span>
          <input
            aria-label="Element name"
            defaultValue={element.name}
            spellCheck={false}
            onBlur={(event) => {
              const next = event.target.value.trim();
              if (next && next !== element.name) onUpdate({ name: next });
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
          />
        </label>
        <label className="esco-hmi-edit__row esco-hmi-edit__row--check">
          <span>Visible</span>
          <input
            type="checkbox"
            aria-label="Element visible"
            defaultChecked={element.visible !== false}
            onChange={(event) => onUpdate({ visible: event.target.checked })}
          />
        </label>
        <label className="esco-hmi-edit__row esco-hmi-edit__row--check">
          <span>Locked</span>
          <input
            type="checkbox"
            aria-label="Element locked"
            defaultChecked={Boolean(element.locked)}
            onChange={(event) => onUpdate({ locked: event.target.checked })}
          />
        </label>
      </section>

      <section>
        <h3>Geometry</h3>
        <div className="esco-hmi-edit__grid">
          {(["x", "y", "width", "height"] as const).map((dim) => (
            <label key={dim} className="esco-hmi-edit__cell">
              <span>{dim}</span>
              <input
                type="number"
                aria-label={`Geometry ${dim}`}
                defaultValue={geo[dim]}
                onBlur={(event) => {
                  const value = Number(event.target.value);
                  if (Number.isFinite(value) && value !== geo[dim]) commitGeometry({ [dim]: value });
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                }}
              />
            </label>
          ))}
        </div>
      </section>

      {definition.properties.length ? (
        <section>
          <h3>Properties</h3>
          {definition.properties.map((property) => (
            <PropertyField
              key={property.name}
              definition={property}
              value={element.properties[property.name]}
              screens={screens}
              knownTagPaths={knownTagPaths}
              onCommit={(value) => onUpdate({ properties: { [property.name]: value } })}
            />
          ))}
        </section>
      ) : null}

      <section>
        <h3>Bindings ({element.bindings.length})</h3>
        {element.bindings.length === 0 ? (
          <p className="esco-empty">No bindings configured.</p>
        ) : (
          <ul className="esco-hmi-edit__list">
            {element.bindings.map((binding) => (
              <li key={binding.id}>
                <div className="esco-hmi-edit__list-main">
                  <strong>{binding.targetProperty}</strong>
                  <span>
                    {binding.source.kind}: {binding.source.path || "(blank)"} · {binding.mode}
                  </span>
                </div>
                <button
                  type="button"
                  className="esco-btn esco-btn--danger esco-btn--xs"
                  aria-label={`Remove binding ${binding.targetProperty}`}
                  onClick={() => onRemoveBinding(binding.id)}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="esco-hmi-edit__form" aria-label="Add binding">
          <select aria-label="Binding property" value={bindTarget} onChange={(event) => setBindTarget(event.target.value)}>
            {(bindableProps.length ? bindableProps : definition.properties).map((property) => (
              <option key={property.name} value={property.name}>
                {property.label}
              </option>
            ))}
          </select>
          <select aria-label="Binding source kind" value={bindKind} onChange={(event) => setBindKind(event.target.value as HmiBindingSourceKind)}>
            {BINDING_SOURCE_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {kind}
              </option>
            ))}
          </select>
          <input
            aria-label="Binding source path"
            list="hmi-bind-tags"
            placeholder={bindKind === "tag" ? "Tag path" : "Source path / expression"}
            value={bindPath}
            spellCheck={false}
            onChange={(event) => setBindPath(event.target.value)}
          />
          <datalist id="hmi-bind-tags">
            {knownTagPaths.map((path) => (
              <option key={path} value={path} />
            ))}
          </datalist>
          <select aria-label="Binding mode" value={bindMode} onChange={(event) => setBindMode(event.target.value as HmiPropertyBinding["mode"])}>
            <option value="read">read</option>
            <option value="write">write</option>
            <option value="read-write">read-write</option>
          </select>
          <button
            type="button"
            className="esco-btn esco-btn--primary esco-btn--xs"
            disabled={!bindPath.trim()}
            onClick={() => {
              onSetBinding({
                targetProperty: bindTarget,
                source: { kind: bindKind, path: bindPath.trim() },
                mode: bindMode,
              });
              setBindPath("");
            }}
          >
            Bind
          </button>
        </div>
      </section>

      <section>
        <h3>Events</h3>
        {element.events.length === 0 ? (
          <p className="esco-empty">No event handlers.</p>
        ) : (
          <ul className="esco-hmi-edit__list">
            {element.events.flatMap((event) =>
              event.commands.map((command) => (
                <li key={command.id}>
                  <div className="esco-hmi-edit__list-main">
                    <strong>
                      {event.eventType} → {command.type}
                    </strong>
                    <span>
                      {command.safety}
                      {typeof command.args.screenId === "string"
                        ? ` · ${screens.find((screen) => screen.id === command.args.screenId)?.name ?? command.args.screenId}`
                        : ""}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="esco-btn esco-btn--danger esco-btn--xs"
                    aria-label={`Remove ${event.eventType} command`}
                    onClick={() => onRemoveEventCommand(event.id, command.id)}
                  >
                    Remove
                  </button>
                </li>
              )),
            )}
          </ul>
        )}
        {eventTypes.length && screens.length ? (
          <div className="esco-hmi-edit__form" aria-label="Add navigation event">
            <select aria-label="Navigation event type" value={navEvent} onChange={(event) => setNavEvent(event.target.value as "press" | "release")}>
              {(eventTypes.includes("press") ? ["press"] : []).concat(eventTypes.includes("release") ? ["release"] : []).map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
            <select aria-label="Navigation target screen" value={navScreen} onChange={(event) => setNavScreen(event.target.value)}>
              {screens.map((screen) => (
                <option key={screen.id} value={screen.id}>
                  {screen.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="esco-btn esco-btn--primary esco-btn--xs"
              disabled={!navScreen}
              onClick={() => onAddNavigation(navScreen, navEvent)}
            >
              Add navigate
            </button>
          </div>
        ) : (
          <p className="esco-empty">This element supports no runtime-preview events, or no screens exist yet.</p>
        )}
      </section>

      <button type="button" className="esco-btn esco-btn--danger" onClick={onDelete}>
        Delete element
      </button>
    </>
  );
}

/** Editable inspector for the selected surface (no element selected). */
function SurfaceInspector({
  surface,
  isHome,
  onRename,
  onSetHome,
  onDelete,
}: {
  surface: ActiveSurface;
  isHome: boolean;
  onRename: (name: string) => void;
  onSetHome: () => void;
  onDelete: () => void;
}) {
  const editable = surface.kind === "screen" || surface.kind === "popup";
  return (
    <>
      <h2>Surface</h2>
      {editable ? (
        <label className="esco-hmi-edit__row">
          <span>Name</span>
          <input
            aria-label="Surface name"
            defaultValue={surface.name}
            spellCheck={false}
            onBlur={(event) => {
              const next = event.target.value.trim();
              if (next && next !== surface.name) onRename(next);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
          />
        </label>
      ) : (
        <dl>
          <dt>Name</dt>
          <dd>{surface.name}</dd>
        </dl>
      )}
      <dl>
        <dt>Kind</dt>
        <dd>{surface.kind}</dd>
        <dt>Canvas</dt>
        <dd>
          {surface.width} x {surface.height}
        </dd>
        <dt>Update rate</dt>
        <dd>{surface.updateRateMs} ms</dd>
        <dt>Elements</dt>
        <dd>{surface.elements.length}</dd>
      </dl>
      {surface.kind === "screen" ? (
        <button type="button" className="esco-btn" disabled={isHome} onClick={onSetHome}>
          {isHome ? "Home screen" : "Set as home"}
        </button>
      ) : null}
      {editable ? (
        <button type="button" className="esco-btn esco-btn--danger" onClick={onDelete}>
          Delete {surface.kind}
        </button>
      ) : null}
    </>
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
  onUpdateElement,
  onUpdateElementGeometry,
  onDeleteElement,
  onSetBinding,
  onRemoveBinding,
  onAddNavigationEvent,
  onRemoveEventCommand,
  onSetHomeScreen,
  onRenameSurface,
  onDeleteSurface,
}: Props) {
  const [screenName, setScreenName] = useState("Overview");
  const [popupName, setPopupName] = useState("Popup");
  const [selectedElementId, setSelectedElementId] = useState<string | undefined>();
  const groups = useMemo(() => hmiElementDefinitionsByCategory(), []);
  const findings = useMemo(() => validateHmiProject(hmi, { knownTagPaths }), [hmi, knownTagPaths]);
  const surface = hmi ? surfaceFromSelection(hmi, selectedSurface) : undefined;
  const selectedElement = surface?.elements.find((element) => element.id === selectedElementId);
  const screens = hmi?.screens.map((screen) => ({ id: screen.id, name: screen.name })) ?? [];

  useEffect(() => {
    setSelectedElementId(undefined);
  }, [surface?.id]);

  // Drop the element selection if the element was just deleted.
  useEffect(() => {
    if (selectedElementId && !selectedElement) setSelectedElementId(undefined);
  }, [selectedElementId, selectedElement]);

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
          <strong>
            {hmi.targetDevice.width} x {hmi.targetDevice.height}
          </strong>
          <em>Offline runtime preview</em>
        </div>
      </header>

      <div className="esco-hmi__workspace">
        <aside className="esco-hmi-nav">
          <section>
            <h2>Screens</h2>
            <div className="esco-hmi-create">
              <input value={screenName} onChange={(event) => setScreenName(event.target.value)} aria-label="New HMI screen name" />
              <button type="button" onClick={() => onCreateScreen(screenName)}>
                New
              </button>
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
              <button type="button" onClick={() => onCreatePopup(popupName)}>
                New
              </button>
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
                    <em>
                      {popup.width}x{popup.height}
                    </em>
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

        <aside className="esco-hmi-properties">
          {!surface ? (
            <p className="esco-empty">Create a screen or select the system banner.</p>
          ) : selectedElement ? (
            <ElementInspector
              key={selectedElement.id}
              element={selectedElement}
              screens={screens}
              knownTagPaths={knownTagPaths}
              onUpdate={(patch) => onUpdateElement(surface.kind, surface.id, selectedElement.id, patch)}
              onUpdateGeometry={(geometry) => onUpdateElementGeometry(surface.kind, surface.id, selectedElement.id, geometry)}
              onDelete={() => onDeleteElement(surface.kind, surface.id, selectedElement.id)}
              onSetBinding={(binding) => onSetBinding(surface.kind, surface.id, selectedElement.id, binding)}
              onRemoveBinding={(bindingId) => onRemoveBinding(surface.kind, surface.id, selectedElement.id, bindingId)}
              onAddNavigation={(targetScreenId, eventType) =>
                onAddNavigationEvent(surface.kind, surface.id, selectedElement.id, targetScreenId, eventType)
              }
              onRemoveEventCommand={(eventId, commandId) =>
                onRemoveEventCommand(surface.kind, surface.id, selectedElement.id, eventId, commandId)
              }
            />
          ) : (
            <SurfaceInspector
              key={surface.id}
              surface={surface}
              isHome={surface.kind === "screen" && hmi.homeScreenId === surface.id}
              onRename={(name) =>
                surface.kind === "screen" || surface.kind === "popup"
                  ? onRenameSurface(surface.kind, surface.id, name)
                  : undefined
              }
              onSetHome={() => onSetHomeScreen(surface.id)}
              onDelete={() =>
                surface.kind === "screen" || surface.kind === "popup"
                  ? onDeleteSurface(surface.kind, surface.id)
                  : undefined
              }
            />
          )}
        </aside>
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
