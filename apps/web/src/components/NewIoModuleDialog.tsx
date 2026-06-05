import { useEffect, useMemo, useState } from "react";
import type { Controller, IoModule } from "@esco/core";
import type { AddIoModuleInput, UpdateIoModuleInput } from "@esco/project-actions";
import {
  IO_DEVICE_CATALOG,
  IO_DEVICE_CATEGORIES,
  findIoDeviceCatalogEntry,
  ioDeviceChannelProfiles,
  ioDeviceKeyingLabel,
  ioDeviceProfileDiagnostics,
  ioDeviceProfileSummary,
  ioDeviceSetupTags,
  type IoDeviceChannelProfile,
  type IoDeviceCatalogEntry,
  type IoDeviceCategoryFilter,
  type IoDeviceProfileDiagnostic,
  type IoDeviceSetupTag,
} from "../io-device-catalog";
import { deviceImageUrl } from "../device-image-assets";
import { escoCapabilityById } from "../escoCapabilityMap";
import { duplicateNameError, integerFieldError, showDialogHelp, studioIdentifierError } from "./dialogValidation";

interface Props {
  open: boolean;
  controller?: Controller;
  /** Optional catalog search prefilled when the dialog opens (e.g. "Chassis" for Add Backplane). */
  initialQuery?: string;
  /** Optional chassis slot prefilled when the user starts New Module from an empty backplane slot. */
  initialSlot?: number;
  /** Existing module when the dialog is opened from the Studio-style Change Module command. */
  existingModule?: IoModule;
  onClose: () => void;
  onCreate: (input: AddIoModuleInput, options?: { close?: boolean }) => void;
  onChange?: (input: UpdateIoModuleInput, options?: { close?: boolean }) => void;
}

const MODULE_BROWSER_TABS = ["Catalog", "Module Discovery", "Favorites"] as const;
const FAVORITES_KEY = "esco.ioModuleFavorites.v1";
const DEFAULT_DETAIL_SECTIONS = ["Overview", "Device Information", "Connection", "Channels", "Calibration"];
const INPUT_DATA_OPTIONS = ["Analog Only", "Analog and HART", "Digital Only", "Input Data", "Output Data"] as const;
const ELECTRONIC_KEYING_VALUES = ["ExactMatch", "CompatibleModule", "Disabled"] as const;
const CST_OPTIONS = ["Timestamped", "None", "CIP Sync", "Module Timestamp"] as const;
const DATA_FORMAT_OPTIONS = ["Float", "Integer", "Raw/Proportional", "Engineering Units"] as const;
const CHANNEL_FORMAT_OPTIONS = ["BOOL", "Float", "Float + HART", "Integer", "Raw/Proportional", "Engineering Units", "Safety BOOL", "Profile default"] as const;
type ModuleBrowserTab = (typeof MODULE_BROWSER_TABS)[number];
type CatalogCategory = Exclude<IoDeviceCategoryFilter, "All">;
type NewModuleStage = "catalog" | "definition";
type OverviewSection = string;
type DeviceDefinitionSnapshot = {
  name: string;
  series: string;
  majorRevision: string;
  minorRevision: string;
  description: string;
  electronicKeying: string;
  slot: string;
  connectionName: string;
  connectionType: string;
  connectionRpi: string;
  connectionPriority: string;
  parentModule: string;
  inputData: (typeof INPUT_DATA_OPTIONS)[number];
  parentPortId: string;
  coordinatedSystemTime: (typeof CST_OPTIONS)[number];
  commPath: string;
  dataFormat: (typeof DATA_FORMAT_OPTIONS)[number];
  channelRows: IoDeviceChannelProfile[];
};

const MODULE_DISCOVERY_CAPABILITY = escoCapabilityById("module-discovery");
const MODULE_BROWSER_TAB_LABELS: Record<ModuleBrowserTab, string> = {
  Catalog: "Catalog",
  "Module Discovery": "Offline Discovery",
  Favorites: "Favorites",
};
const MODULE_BROWSER_TAB_TITLES: Record<ModuleBrowserTab, string> = {
  Catalog: "Offline module catalog; no hardware is browsed.",
  "Module Discovery":
    MODULE_DISCOVERY_CAPABILITY?.summary ??
    "Physical module discovery and network browse do not run in this build.",
  Favorites: "Saved offline catalog profiles.",
};

const CATALOG_CATEGORIES = IO_DEVICE_CATEGORIES.filter((category): category is CatalogCategory => category !== "All");

function readFavoriteIds(): string[] {
  try {
    const raw = window.localStorage.getItem(FAVORITES_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : [];
  } catch {
    return [];
  }
}

function matchesDiscovery(entry: IoDeviceCatalogEntry): boolean {
  return /adapter|communication|device definition|vendor profile|generic|motion device|network/i.test(
    `${entry.category} ${entry.setupMethod} ${entry.signalNetwork} ${entry.productType} ${entry.templateId} ${entry.protocolBus}`,
  );
}

function toggleSetValue<T>(set: Set<T>, value: T): Set<T> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

function nextSlot(modules: IoModule[]): number {
  const used = new Set(modules.map((module) => module.slot).filter((slot): slot is number => slot != null));
  for (let slot = 0; slot < 256; slot += 1) {
    if (!used.has(slot)) return slot;
  }
  return modules.length;
}

function nextModuleName(prefix: string, modules: IoModule[]): string {
  const existing = new Set(modules.map((module) => module.name.toLowerCase()));
  for (let index = 1; index < 1000; index += 1) {
    const candidate = `${prefix}_${String(index).padStart(2, "0")}`;
    if (!existing.has(candidate.toLowerCase())) return candidate;
  }
  return `${prefix}_${modules.length + 1}`;
}

function defaultInputData(entry: IoDeviceCatalogEntry): (typeof INPUT_DATA_OPTIONS)[number] {
  const haystack =
    `${entry.category} ${entry.label} ${entry.channels} ${entry.productType} ${entry.signalNetwork} ${entry.protocolBus} ${entry.signalType} ${entry.dataDirection}`.toLowerCase();
  if (/hart/.test(haystack)) return "Analog and HART";
  if (/analog/.test(haystack)) return "Analog Only";
  if (/output/.test(haystack)) return "Output Data";
  if (/digital/.test(haystack)) return "Digital Only";
  return "Input Data";
}

function isInputDataOption(value: string | undefined): value is (typeof INPUT_DATA_OPTIONS)[number] {
  return INPUT_DATA_OPTIONS.includes(value as (typeof INPUT_DATA_OPTIONS)[number]);
}

function normalizeElectronicKeying(value: string | undefined): string {
  const text = value?.trim();
  if (!text) return "CompatibleModule";
  if (/^disable(?:d| keying)?$/i.test(text) || text === "DisableKeying") return "Disabled";
  if (/^exact match$/i.test(text)) return "ExactMatch";
  if (/^compatible module$/i.test(text)) return "CompatibleModule";
  return text;
}

function canonicalConnectionType(entry: IoDeviceCatalogEntry): string {
  const value = entry.connection?.inputConnectionType?.trim();
  if (value === "Multicast" || value === "Unicast" || value === "Null") return value;
  return entry.connection?.unicast ? "Unicast" : "Multicast";
}

function defaultSeries(entry: IoDeviceCatalogEntry): string {
  if (/^1756-/.test(entry.catalogNumber)) return "B";
  if (/^(5069|5094)-/.test(entry.catalogNumber)) return "A";
  return "A";
}

function moduleConnectionLabel(entry: IoDeviceCatalogEntry): string {
  return entry.connection?.name || entry.connection?.type || "Data";
}

function numberFromField(value: string): number | undefined {
  const text = value.trim();
  if (!text) return undefined;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : undefined;
}

function parentLocationKey(value: string | undefined): string {
  const text = value?.trim();
  return !text || /^local$/i.test(text) ? "local" : text.toLowerCase();
}

function helpMessage(mode: "new" | "change" = "new") {
  showDialogHelp(
    mode === "change" ? "Change Module" : "New Module",
    mode === "change"
      ? "Select the replacement module profile, review the device definition, then apply the change. ESCO preserves the module id and updates offline project metadata only."
      : "Select a module type, define the module identity, then confirm the New Module overview. ESCO stores this as offline project metadata until a verified controller transport exists.",
  );
}

function detailSectionsFor(entry: IoDeviceCatalogEntry): string[] {
  const sourceSections = entry.recommendedTabs.length > 0 ? entry.recommendedTabs : DEFAULT_DETAIL_SECTIONS;
  const sections = ["Overview", "Device Information", ...sourceSections, "Connection"];
  const seen = new Set<string>();
  return sections
    .map((section) => section.trim())
    .filter((section) => {
      if (!section || seen.has(section)) return false;
      seen.add(section);
      return true;
    });
}

export function NewIoModuleDialog({ open, controller, initialQuery, initialSlot, existingModule, onClose, onCreate, onChange }: Props) {
  const modules = controller?.ioConfiguration.modules ?? [];
  const isChangeMode = Boolean(existingModule);
  const modulesForValidation = useMemo(
    () => (existingModule ? modules.filter((module) => module.id !== existingModule.id) : modules),
    [existingModule, modules],
  );
  const families = useMemo(() => Array.from(new Set(IO_DEVICE_CATALOG.map((entry) => entry.family))).sort(), []);
  const [catalogId, setCatalogId] = useState(IO_DEVICE_CATALOG[0]?.id ?? "");
  const [stage, setStage] = useState<NewModuleStage>("catalog");
  const [definitionOpen, setDefinitionOpen] = useState(false);
  const [definitionSnapshot, setDefinitionSnapshot] = useState<DeviceDefinitionSnapshot | null>(null);
  const [overviewSection, setOverviewSection] = useState<OverviewSection>("Overview");
  const [activeTab, setActiveTab] = useState<ModuleBrowserTab>("Catalog");
  const [categoryFilters, setCategoryFilters] = useState<Set<CatalogCategory>>(() => new Set(CATALOG_CATEGORIES));
  const [familyFilters, setFamilyFilters] = useState<Set<string>>(() => new Set(families));
  const [filtersVisible, setFiltersVisible] = useState(true);
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(() => new Set(readFavoriteIds()));
  const [closeOnCreate, setCloseOnCreate] = useState(true);
  const [query, setQuery] = useState("");
  const [name, setName] = useState("");
  const [slot, setSlot] = useState("");
  const [parentModule, setParentModule] = useState("");
  const [parentPortId, setParentPortId] = useState("");
  const [commPath, setCommPath] = useState("");
  const [description, setDescription] = useState("");
  const [inhibited, setInhibited] = useState(false);
  const [series, setSeries] = useState("A");
  const [majorRevision, setMajorRevision] = useState("1");
  const [minorRevision, setMinorRevision] = useState("0");
  const [electronicKeying, setElectronicKeying] = useState("CompatibleModule");
  const [connectionName, setConnectionName] = useState("Data");
  const [connectionType, setConnectionType] = useState("Input");
  const [connectionRpi, setConnectionRpi] = useState("100000");
  const [connectionPriority, setConnectionPriority] = useState("Scheduled");
  const [inputData, setInputData] = useState<(typeof INPUT_DATA_OPTIONS)[number]>("Input Data");
  const [coordinatedSystemTime, setCoordinatedSystemTime] = useState<(typeof CST_OPTIONS)[number]>("Timestamped");
  const [dataFormat, setDataFormat] = useState<(typeof DATA_FORMAT_OPTIONS)[number]>("Float");
  const [channelRows, setChannelRows] = useState<IoDeviceChannelProfile[]>([]);
  const [createSetupTags, setCreateSetupTags] = useState(true);

  const selected = IO_DEVICE_CATALOG.find((entry) => entry.id === catalogId) ?? IO_DEVICE_CATALOG[0];
  const selectedProfile = useMemo(() => ioDeviceProfileSummary(selected), [selected]);
  const filteredCatalog = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return IO_DEVICE_CATALOG.filter((entry) => {
      if (activeTab === "Favorites" && !favoriteIds.has(entry.id)) return false;
      if (activeTab === "Module Discovery" && !matchesDiscovery(entry)) return false;
      if (!categoryFilters.has(entry.category)) return false;
      if (!familyFilters.has(entry.family)) return false;
      if (!needle) return true;
      return [
        entry.catalogNumber,
        entry.label,
        entry.detailTitle,
        entry.templateId,
        entry.family,
        entry.productType,
        entry.vendor,
        entry.workbookCategory,
        entry.setupMethod,
        entry.signalNetwork,
        entry.protocolBus,
        entry.signalType,
        entry.channels,
        entry.dataDirection,
        entry.typicalUse,
        entry.brandSafeNotes,
        entry.imageName ?? "",
      ].some((value) => value.toLowerCase().includes(needle));
    });
  }, [activeTab, categoryFilters, familyFilters, favoriteIds, query]);
  const selectedImageUrl = deviceImageUrl(selected);
  const detailSections = useMemo(() => detailSectionsFor(selected), [selected]);
  const informationSections = detailSections.filter((section) => /^(overview|device information)$/i.test(section));
  const configurationSections = detailSections.filter((section) => !informationSections.includes(section));
  const setupTags = useMemo(
    () =>
      ioDeviceSetupTags(selected, {
        moduleName: name,
        channels: channelRows,
        existingNames: (controller?.controllerTags ?? []).map((tag) => tag.name),
      }),
    [channelRows, controller?.controllerTags, name, selected],
  );
  const setupTagPreview = setupTags.slice(0, 8);
  const hasSetupTags = !isChangeMode && setupTags.length > 0;

  const applyEntryDefaults = (entry: IoDeviceCatalogEntry, nextModules = modulesForValidation, preferredSlot = initialSlot) => {
    const current = existingModule;
    const currentCatalogEntry = current ? findIoDeviceCatalogEntry(current) : undefined;
    const matchesCurrentProfile =
      currentCatalogEntry?.id === entry.id ||
      current?.catalogNumber?.trim().toLowerCase() === entry.catalogNumber.trim().toLowerCase();
    const currentConnection = matchesCurrentProfile ? current?.connections?.[0] : undefined;
    const currentChannels = matchesCurrentProfile
      ? (current as (IoModule & { profileChannels?: IoDeviceChannelProfile[] }) | undefined)?.profileChannels
      : undefined;
    setName(current?.name ?? nextModuleName(entry.namePrefix, nextModules));
    setSlot(String(preferredSlot ?? current?.slot ?? nextSlot(nextModules)));
    setParentModule(current?.parentModule ?? "Local");
    setParentPortId(current?.parentPortId ?? entry.defaultParentPortId ?? "");
    setCommPath(current?.commPath ?? "");
    setDescription(current?.description ?? "");
    setInhibited(current?.inhibited === true);
    setSeries(defaultSeries(entry));
    setMajorRevision(matchesCurrentProfile && current?.majorRevision ? current.majorRevision : entry.majorRevision);
    setMinorRevision(matchesCurrentProfile && current?.minorRevision ? current.minorRevision : entry.minorRevision);
    setElectronicKeying(
      normalizeElectronicKeying(
        matchesCurrentProfile && current?.electronicKeying ? current.electronicKeying : entry.electronicKeying || "CompatibleModule",
      ),
    );
    setConnectionName(currentConnection?.name ?? moduleConnectionLabel(entry));
    setConnectionType(currentConnection?.type ?? entry.connection?.type ?? "");
    setConnectionRpi(
      currentConnection?.rpi != null ? String(currentConnection.rpi) : entry.connection?.rpi != null ? String(entry.connection.rpi) : "",
    );
    setConnectionPriority(currentConnection?.priority ?? entry.connection?.priority ?? "");
    setInputData(isInputDataOption(currentConnection?.inputConnectionType) ? currentConnection.inputConnectionType : defaultInputData(entry));
    setCoordinatedSystemTime("Timestamped");
    setDataFormat(entry.category === "Analog" || entry.category === "Instruments" ? "Float" : "Integer");
    setChannelRows(currentChannels?.length ? currentChannels : ioDeviceChannelProfiles(entry));
    setCreateSetupTags(!isChangeMode);
    setDefinitionSnapshot(null);
  };

  useEffect(() => {
    if (!open || !controller) return;
    const existingCatalogEntry = existingModule ? findIoDeviceCatalogEntry(existingModule) : undefined;
    const requestedQuery = initialQuery ?? existingCatalogEntry?.catalogNumber ?? existingModule?.catalogNumber ?? existingModule?.productType ?? "";
    const entry =
      existingCatalogEntry ??
      IO_DEVICE_CATALOG.find((candidate) => candidate.catalogNumber.toLowerCase() === existingModule?.catalogNumber?.toLowerCase()) ??
      IO_DEVICE_CATALOG.find((candidate) => requestedQuery && candidate.catalogNumber.toLowerCase().includes(requestedQuery.toLowerCase())) ??
      IO_DEVICE_CATALOG[0];
    setCatalogId(entry.id);
    setStage("catalog");
    setDefinitionOpen(false);
    setDefinitionSnapshot(null);
    setOverviewSection("Overview");
    setActiveTab("Catalog");
    setCategoryFilters(new Set(CATALOG_CATEGORIES));
    setFamilyFilters(new Set(families));
    setFiltersVisible(true);
    setQuery(requestedQuery);
    applyEntryDefaults(entry, modulesForValidation, initialSlot);
    setCloseOnCreate(true);
  }, [controller, open, initialQuery, initialSlot, existingModule, modulesForValidation]);

  useEffect(() => {
    try {
      window.localStorage.setItem(FAVORITES_KEY, JSON.stringify(Array.from(favoriteIds)));
    } catch {
      /* local favorites are best-effort */
    }
  }, [favoriteIds]);

  useEffect(() => {
    if (!open || filteredCatalog.length === 0 || filteredCatalog.some((entry) => entry.id === catalogId)) return;
    const entry = filteredCatalog[0];
    setCatalogId(entry.id);
    applyEntryDefaults(entry, modulesForValidation, initialSlot);
  }, [catalogId, filteredCatalog, open]);

  useEffect(() => {
    if (!detailSections.includes(overviewSection)) {
      setOverviewSection(detailSections[0] ?? "Overview");
    }
  }, [detailSections, overviewSection]);

  if (!open || !controller) return null;

  const allCategoryFiltersSelected = categoryFilters.size === CATALOG_CATEGORIES.length;
  const allFamilyFiltersSelected = familyFilters.size === families.length;
  const favoriteSelected = favoriteIds.has(selected.id);
  const visibleCount = filteredCatalog.length;
  const dialogLabel = isChangeMode ? "Change Module" : "New Module";
  const selectTitle = isChangeMode ? "Select Replacement Module Type" : "Select Module Type";
  const primaryActionLabel = isChangeMode ? "Change" : "Create";
  const closeOnCreateLabel = isChangeMode ? "Close on Change" : "Close on Create";
  const readyMessage = isChangeMode ? "Ready to change offline module profile" : "Ready to create offline module profile";
  const parentLabel = parentModule.trim() || "Local";
  const revisionLabel = `${majorRevision || selected.majorRevision}.${minorRevision || selected.minorRevision}`;
  const moduleTitle = `${selected.catalogNumber}${name.trim() ? `, ${name.trim()}` : ","}`;
  const slotNumber = Number(slot.trim());
  const connectionRpiNumber = numberFromField(connectionRpi);
  const normalizedParent = parentModule.trim() || "Local";
  const normalizedParentPort = parentPortId.trim();
  const slotClash =
    slot.trim() && Number.isInteger(slotNumber)
      ? modulesForValidation.some(
          (module) =>
            module.slot === slotNumber &&
            parentLocationKey(module.parentModule) === parentLocationKey(normalizedParent) &&
            (module.parentPortId ?? "") === normalizedParentPort,
        )
      : false;
  const categoryFilterLabel = allCategoryFiltersSelected
    ? "All categories"
    : `${categoryFilters.size} of ${CATALOG_CATEGORIES.length} categories`;
  const familyFilterLabel = allFamilyFiltersSelected ? "All families" : `${familyFilters.size} of ${families.length} families`;
  const validationMessage =
    studioIdentifierError(name, "Module") ??
    duplicateNameError(name, modulesForValidation.map((module) => module.name), "Module") ??
    integerFieldError(slot, "Slot", { min: 0 }) ??
    (slotClash ? `Slot ${slotNumber} is already used at this I/O location.` : undefined) ??
    (!majorRevision.trim() ? "Major revision is required." : undefined) ??
    integerFieldError(majorRevision, "Major revision", { min: 1 }) ??
    (!minorRevision.trim() ? "Minor revision is required." : undefined) ??
    integerFieldError(minorRevision, "Minor revision", { min: 0 }) ??
    (selected.connection ? integerFieldError(connectionRpi, "RPI", { min: 1 }) : undefined) ??
    (!ELECTRONIC_KEYING_VALUES.includes(electronicKeying as (typeof ELECTRONIC_KEYING_VALUES)[number])
      ? "Electronic keying must be Exact Match, Compatible Module, or Disable Keying."
      : undefined);
  const profileDiagnostics = ioDeviceProfileDiagnostics(selected, {
    majorRevision,
    minorRevision,
    electronicKeying,
    rpi: selected.connection ? connectionRpiNumber : undefined,
    slot: Number.isFinite(slotNumber) ? slotNumber : undefined,
    slotConflict: slotClash,
  });

  const selectEntry = (entry: IoDeviceCatalogEntry) => {
    setCatalogId(entry.id);
    applyEntryDefaults(entry, modulesForValidation, initialSlot);
  };

  const captureDefinition = (): DeviceDefinitionSnapshot => ({
    name,
    series,
    majorRevision,
    minorRevision,
    description,
    electronicKeying,
    slot,
    connectionName,
    connectionType,
    connectionRpi,
    connectionPriority,
    parentModule,
    inputData,
    parentPortId,
    coordinatedSystemTime,
    commPath,
    dataFormat,
    channelRows,
  });

  const restoreDefinition = (snapshot: DeviceDefinitionSnapshot) => {
    setName(snapshot.name);
    setSeries(snapshot.series);
    setMajorRevision(snapshot.majorRevision);
    setMinorRevision(snapshot.minorRevision);
    setDescription(snapshot.description);
    setElectronicKeying(snapshot.electronicKeying);
    setSlot(snapshot.slot);
    setConnectionName(snapshot.connectionName);
    setConnectionType(snapshot.connectionType);
    setConnectionRpi(snapshot.connectionRpi);
    setConnectionPriority(snapshot.connectionPriority);
    setParentModule(snapshot.parentModule);
    setInputData(snapshot.inputData);
    setParentPortId(snapshot.parentPortId);
    setCoordinatedSystemTime(snapshot.coordinatedSystemTime);
    setCommPath(snapshot.commPath);
    setDataFormat(snapshot.dataFormat);
    setChannelRows(snapshot.channelRows);
  };

  const openDeviceDefinition = () => {
    setDefinitionSnapshot(captureDefinition());
    setDefinitionOpen(true);
  };

  const commitDeviceDefinition = () => {
    if (validationMessage) return;
    setDefinitionSnapshot(null);
    setDefinitionOpen(false);
  };

  const cancelDeviceDefinition = () => {
    if (definitionSnapshot) restoreDefinition(definitionSnapshot);
    setDefinitionSnapshot(null);
    setDefinitionOpen(false);
  };

  const createInput = (): AddIoModuleInput => {
    const input: AddIoModuleInput & { profileChannels?: IoDeviceChannelProfile[] } = {
      controllerId: controller.id,
      name: name.trim(),
      catalogNumber: selected.catalogNumber,
      slot: slot.trim() ? Number(slot) : undefined,
      description: description.trim(),
      parentModule: normalizedParent,
      parentPortId: parentPortId.trim(),
      commPath: commPath.trim(),
      vendor: selected.vendor,
      productType: selected.productType,
      majorRevision,
      minorRevision,
      electronicKeying: normalizeElectronicKeying(electronicKeying),
      inhibited,
      connection: selected.connection
        ? {
            ...selected.connection,
            name: connectionName.trim(),
            type: connectionType.trim(),
            rpi: connectionRpiNumber,
            priority: connectionPriority.trim(),
            inputConnectionType: canonicalConnectionType(selected),
          }
        : undefined,
      profileChannels: channelRows,
      setupTags: hasSetupTags && createSetupTags ? setupTags : undefined,
    };
    return input;
  };

  const startDefinition = () => {
    setStage("definition");
    openDeviceDefinition();
    setOverviewSection("Overview");
  };

  const createModule = () => {
    if (validationMessage) return;
    const input = createInput();
    if (existingModule && onChange) {
      onChange({ ...input, moduleId: existingModule.id }, { close: true });
      return;
    }
    onCreate(input, { close: closeOnCreate });
  };

  const clearFilters = () => {
    setQuery("");
    setCategoryFilters(new Set(CATALOG_CATEGORIES));
    setFamilyFilters(new Set(families));
    setActiveTab("Catalog");
  };

  const toggleFavorite = () => {
    setFavoriteIds((current) => toggleSetValue(current, selected.id));
  };

  const updateChannelRow = (id: string, patch: Partial<IoDeviceChannelProfile>) => {
    setChannelRows((rows) => rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  };

  const renderProfileDiagnostics = (rows: IoDeviceProfileDiagnostic[] = profileDiagnostics) => (
    <table className="esco-detail__table" aria-label="Offline profile diagnostics">
      <tbody>
        {rows.map((row) => (
          <tr key={`${row.label}-${row.detail}`}>
            <th>{row.status.toUpperCase()}</th>
            <td>
              <strong>{row.label}</strong>
              <span>{row.detail}</span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  const renderChannelTable = () =>
    channelRows.length > 0 ? (
      <table className="esco-new-module__table" aria-label="Profile channel configuration">
        <thead>
          <tr>
            <th>Use</th>
            <th>Channel</th>
            <th>Direction</th>
            <th>Signal</th>
            <th>Data Format</th>
            <th>Range / Mode</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {channelRows.map((row) => (
            <tr key={row.id}>
              <td>
                <input
                  type="checkbox"
                  aria-label={`${row.label} enabled`}
                  checked={row.enabled}
                  onChange={(event) => updateChannelRow(row.id, { enabled: event.target.checked })}
                />
              </td>
              <td><strong>{row.label}</strong></td>
              <td>{row.direction}</td>
              <td>{row.signal}</td>
              <td>
                <select
                  aria-label={`${row.label} data format`}
                  value={row.dataFormat}
                  onChange={(event) => updateChannelRow(row.id, { dataFormat: event.target.value })}
                >
                  {CHANNEL_FORMAT_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                </select>
              </td>
              <td>
                <input
                  aria-label={`${row.label} range`}
                  value={row.range}
                  spellCheck={false}
                  onChange={(event) => updateChannelRow(row.id, { range: event.target.value })}
                />
              </td>
              <td>{row.enabled ? row.diagnostic : "Disabled in offline profile"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    ) : (
      <p className="esco-new-module__hint">This profile provides summary metadata only, so no channel table is available.</p>
    );

  const renderSetupTags = () =>
    hasSetupTags ? (
      <section className="esco-new-module__setup-tags" aria-label="Offline setup tags">
        <label className="esco-check-field">
          <span />
          <span>
            <input type="checkbox" checked={createSetupTags} onChange={(event) => setCreateSetupTags(event.target.checked)} />
            Create offline setup tags
          </span>
        </label>
        <table className="esco-detail__table">
          <tbody>
            {setupTagPreview.map((tag: IoDeviceSetupTag) => (
              <tr key={tag.name}>
                <th>{tag.dataType}</th>
                <td>
                  <strong>{tag.name}</strong>
                  <span>{tag.source}</span>
                </td>
              </tr>
            ))}
            {setupTags.length > setupTagPreview.length ? (
              <tr>
                <th>MORE</th>
                <td>{setupTags.length - setupTagPreview.length} additional channel setup tag(s)</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>
    ) : null;

  const renderCatalog = () => (
    <section className="esco-modal__panel esco-new-module" role="dialog" aria-modal="true" aria-label={selectTitle}>
      <header className="esco-modal__header">
        <h2>{selectTitle}</h2>
        <button type="button" className="esco-icon-btn" aria-label={`Close ${selectTitle}`} onClick={onClose} />
      </header>

      <div className="esco-new-module__tabs" role="tablist" aria-label="Module selection mode">
        {MODULE_BROWSER_TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={activeTab === tab}
            className={activeTab === tab ? "is-active" : ""}
            title={MODULE_BROWSER_TAB_TITLES[tab]}
            onClick={() => setActiveTab(tab)}
          >
            {MODULE_BROWSER_TAB_LABELS[tab]}
          </button>
        ))}
      </div>

      <div className="esco-new-module__body">
        <div className="esco-new-module__catalog">
          <div className="esco-new-module__search-row">
            <input
              value={query}
              placeholder="Search catalog number, description, family, signal, or use"
              spellCheck={false}
              onChange={(event) => setQuery(event.target.value)}
            />
            <button type="button" className="esco-btn" onClick={clearFilters}>Clear Filters</button>
            <button type="button" className="esco-btn" onClick={() => setFiltersVisible((visible) => !visible)}>
              {filtersVisible ? "Hide Filters" : "Show Filters"}
            </button>
          </div>

          {filtersVisible ? (
            <div className="esco-new-module__filters">
              <fieldset>
                <legend>Module Type Category Filters</legend>
                <label>
                  <input
                    type="checkbox"
                    checked={allCategoryFiltersSelected}
                    onChange={(event) => setCategoryFilters(event.target.checked ? new Set(CATALOG_CATEGORIES) : new Set())}
                  />
                  All Categories
                </label>
                {CATALOG_CATEGORIES.map((candidate) => (
                  <label key={candidate}>
                    <input
                      type="checkbox"
                      checked={categoryFilters.has(candidate)}
                      onChange={() => setCategoryFilters((current) => toggleSetValue(current, candidate))}
                    />
                    {candidate}
                  </label>
                ))}
              </fieldset>
              <fieldset>
                <legend>Module Type Vendor/Family Filters</legend>
                <label>
                  <input
                    type="checkbox"
                    checked={allFamilyFiltersSelected}
                    onChange={(event) => setFamilyFilters(event.target.checked ? new Set(families) : new Set())}
                  />
                  All Families
                </label>
                {families.map((family) => (
                  <label key={family}>
                    <input
                      type="checkbox"
                      checked={familyFilters.has(family)}
                      onChange={() => setFamilyFilters((current) => toggleSetValue(current, family))}
                    />
                    {family}
                  </label>
                ))}
              </fieldset>
            </div>
          ) : null}

          <div className="esco-new-module__hint" aria-label="Catalog filter summary">
            <span>Mode: {MODULE_BROWSER_TAB_LABELS[activeTab]}</span>
            {activeTab === "Module Discovery" ? <span>Network scan: unsupported</span> : null}
            <span>Category: {categoryFilterLabel}</span>
            <span>Vendor/Family: {familyFilterLabel}</span>
            <span>Search: {query.trim() || "none"}</span>
          </div>

          <div className="esco-new-module__table-wrap">
            <table className="esco-new-module__table" aria-label="Module catalog">
              <thead>
                <tr>
                  <th>Catalog Number</th>
                  <th>Description</th>
                  <th>Vendor/Family</th>
                  <th>Category</th>
                  <th>Profile / Connection</th>
                </tr>
              </thead>
              <tbody>
                {filteredCatalog.map((entry) => {
                  const profile = ioDeviceProfileSummary(entry);
                  return (
                    <tr
                      key={entry.id}
                      className={entry.id === selected.id ? "is-selected" : undefined}
                      onClick={() => selectEntry(entry)}
                      onDoubleClick={startDefinition}
                    >
                      <td>
                        <div className="esco-new-module__catalog-ref">
                          <img className="esco-new-module__catalog-thumb" src={deviceImageUrl(entry)} alt="" />
                          <div>
                            <strong>{entry.catalogNumber}</strong>
                            <span>{entry.templateId}</span>
                          </div>
                        </div>
                      </td>
                      <td>
                        <strong>{entry.label}</strong>
                        <span>{entry.typicalUse || [entry.channels, entry.signalType, entry.protocolBus].filter(Boolean).join(" · ")}</span>
                      </td>
                      <td>{entry.family}</td>
                      <td>{entry.category}</td>
                      <td>
                        <strong>{profile.connection}</strong>
                        <span>{profile.channels}</span>
                      </td>
                    </tr>
                  );
                })}
                {filteredCatalog.length === 0 ? (
                  <tr>
                    <td colSpan={5}>No module types match the current filters.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          <div className="esco-new-module__catalog-footer">
            <span>{visibleCount} of {IO_DEVICE_CATALOG.length} Module Types Found</span>
            <button type="button" className="esco-btn" onClick={toggleFavorite}>
              {favoriteSelected ? "Remove Favorite" : "Add to Favorites"}
            </button>
          </div>
        </div>

        <div className="esco-new-module__fields">
          <div className="esco-new-module__pick-card">
            <img className="esco-new-module__module-render" src={selectedImageUrl} alt={`${selected.label} preview`} />
            <strong>{selected.catalogNumber}</strong>
            <small>{selected.label}</small>
            <small>{selected.templateId}</small>
          </div>
          <div className="esco-new-module__summary">
            <span>Vendor</span><strong>{selected.vendor}</strong>
            <span>Family</span><strong>{selected.family}</strong>
            <span>Category</span><strong>{selected.category}</strong>
            <span>Protocol</span><strong>{selected.protocolBus || selected.signalNetwork || "-"}</strong>
            <span>Signal</span><strong>{selected.signalType || "-"}</strong>
            <span>Channels</span><strong>{selected.channels || "-"}</strong>
            <span>Revision</span><strong>{selected.majorRevision}.{selected.minorRevision}</strong>
            <span>Keying</span><strong>{ioDeviceKeyingLabel(selected.electronicKeying)}</strong>
            <span>Setup Tags</span><strong>{hasSetupTags ? `${setupTags.length} offline tag${setupTags.length === 1 ? "" : "s"}` : "None"}</strong>
            <span>Use</span><strong>{selected.typicalUse || selected.signalNetwork}</strong>
          </div>
          <div className="esco-new-module__summary" aria-label="Selected profile review">
            <span>Profile Summary</span><strong>{selectedProfile.profile}</strong>
            <span>Connection Summary</span><strong>{selectedProfile.connection}</strong>
            <span>Channel Summary</span><strong>{selectedProfile.channels}</strong>
            <span>Profile Source</span><strong>{selectedProfile.configuration}</strong>
            <span>Profile Data</span><strong>{selectedProfile.data}</strong>
          </div>
          <p className="esco-new-module__hint">
            {isChangeMode
              ? "Change opens the device-definition step and preserves the selected module identity unless you edit it."
              : "Create opens the device-definition step for module name, slot, revision, keying, and connection setup."}
          </p>
        </div>
      </div>

      <footer className="esco-modal__footer">
        <label className="esco-new-module__close-create">
          <input
            type="checkbox"
            checked={isChangeMode ? true : closeOnCreate}
            disabled={isChangeMode}
            onChange={(event) => setCloseOnCreate(event.target.checked)}
          />
          {closeOnCreateLabel}
        </label>
        <div className="esco-modal__actions">
          <button type="button" className="esco-btn esco-btn--primary" disabled={filteredCatalog.length === 0} onClick={startDefinition}>{primaryActionLabel}</button>
          <button type="button" className="esco-btn" onClick={onClose}>Close</button>
          <button type="button" className="esco-btn" onClick={() => helpMessage(isChangeMode ? "change" : "new")}>Help</button>
        </div>
      </footer>
    </section>
  );

  const renderDeviceDefinition = () => (
    <div className="esco-new-module-stage__shade" role="presentation">
      <section className="esco-device-definition" role="dialog" aria-modal="true" aria-label="Device definition">
        <header className="esco-device-definition__header">
          <h3>Device definition</h3>
          <button type="button" className="esco-device-definition__close" aria-label="Close Device definition" onClick={cancelDeviceDefinition} />
        </header>
        <div className="esco-device-definition__body">
          <label className="esco-definition-field esco-definition-field--wide">
            <span>Device type:</span>
            <strong>{selected.catalogNumber} {selected.label}</strong>
          </label>
          <label className="esco-definition-field">
            <span>Series:</span>
            <select value={series} onChange={(event) => setSeries(event.target.value)}>
              {["A", "B", "C", "D"].map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>
          <label className="esco-definition-field esco-definition-field--wide">
            <span>Name:*</span>
            <input value={name} spellCheck={false} autoFocus onChange={(event) => setName(event.target.value)} />
          </label>
          <label className="esco-definition-field">
            <span>Revision:</span>
            <span className="esco-definition-field__split">
              <select value={majorRevision} onChange={(event) => setMajorRevision(event.target.value)}>
                {["1", "2", "3", "4", "5", "16", "20", "32"].map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
              <span>.</span>
              <select value={minorRevision} onChange={(event) => setMinorRevision(event.target.value)}>
                {["000", "001", "1", "2", "3", "10"].map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </span>
          </label>
          <label className="esco-definition-field esco-definition-field--wide">
            <span>Description:</span>
            <input value={description} spellCheck={false} onChange={(event) => setDescription(event.target.value)} />
          </label>
          <label className="esco-definition-field">
            <span>Electronic keying:</span>
            <select value={electronicKeying} onChange={(event) => setElectronicKeying(event.target.value)}>
              <option value="CompatibleModule">Compatible Module</option>
              <option value="ExactMatch">Exact Match</option>
              <option value="Disabled">Disable Keying</option>
            </select>
          </label>
          <label className="esco-definition-field esco-definition-field--short">
            <span>Slot:</span>
            <input value={slot} inputMode="numeric" spellCheck={false} onChange={(event) => setSlot(event.target.value)} />
          </label>
          <label className="esco-definition-field">
            <span>Connection:</span>
            <select value={connectionName} onChange={(event) => setConnectionName(event.target.value)}>
              {["Data", "Input", "Output", "Listen Only", "Rack Optimization"].map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </label>
          <label className="esco-definition-field">
            <span>Connection Type:</span>
            <select value={connectionType} onChange={(event) => setConnectionType(event.target.value)}>
              {["Input", "Output", "Standard", "SafetyInput", "SafetyOutput", "ListenOnly"].map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </label>
          <label className="esco-definition-field esco-definition-field--short">
            <span>RPI (us):</span>
            <input value={connectionRpi} inputMode="numeric" spellCheck={false} onChange={(event) => setConnectionRpi(event.target.value)} />
          </label>
          <label className="esco-definition-field">
            <span>Priority:</span>
            <select value={connectionPriority} onChange={(event) => setConnectionPriority(event.target.value)}>
              {["Scheduled", "High", "Low"].map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>
          <label className="esco-definition-field esco-definition-field--short">
            <span>Parent:</span>
            <input value={parentModule} placeholder="Local" spellCheck={false} onChange={(event) => setParentModule(event.target.value)} />
          </label>
          <label className="esco-definition-field">
            <span>Input Data:</span>
            <select value={inputData} onChange={(event) => setInputData(event.target.value as (typeof INPUT_DATA_OPTIONS)[number])}>
              {INPUT_DATA_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>
          <label className="esco-definition-field esco-definition-field--short">
            <span>Parent Port:</span>
            <input value={parentPortId} spellCheck={false} onChange={(event) => setParentPortId(event.target.value)} />
          </label>
          <label className="esco-definition-field">
            <span>Coordinated System Time:</span>
            <select
              value={coordinatedSystemTime}
              onChange={(event) => setCoordinatedSystemTime(event.target.value as (typeof CST_OPTIONS)[number])}
            >
              {CST_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>
          <label className="esco-definition-field esco-definition-field--wide">
            <span>Comm Path:</span>
            <input value={commPath} spellCheck={false} onChange={(event) => setCommPath(event.target.value)} />
          </label>
          <label className="esco-definition-field">
            <span>Data Format:</span>
            <select value={dataFormat} onChange={(event) => setDataFormat(event.target.value as (typeof DATA_FORMAT_OPTIONS)[number])}>
              {DATA_FORMAT_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>
        </div>
        <footer className="esco-device-definition__footer">
          {validationMessage ? <p className="esco-dialog-validation" role="alert">{validationMessage}</p> : null}
          <button type="button" className="esco-btn esco-btn--primary" disabled={!!validationMessage} onClick={commitDeviceDefinition}>OK</button>
          <button type="button" className="esco-btn" onClick={cancelDeviceDefinition}>Cancel</button>
          <button type="button" className="esco-btn" onClick={() => helpMessage(isChangeMode ? "change" : "new")}>Help</button>
        </footer>
      </section>
    </div>
  );

  const renderDefinitionStage = () => (
    <section className="esco-modal__panel esco-new-module-stage" role="dialog" aria-modal="true" aria-label={dialogLabel}>
      <header className="esco-new-module-stage__hero">
        <div>
          <h2>{moduleTitle}</h2>
          <span>Parent: {parentLabel}</span>
          <span>Slot: {slot || "--"}</span>
        </div>
        <button type="button" className="esco-icon-btn" aria-label={`Close ${dialogLabel}`} onClick={onClose} />
      </header>
      <div className="esco-new-module-stage__status">
        <span>Controller connection: Creating</span>
        <strong>Not Connected</strong>
      </div>
      <div className="esco-new-module-stage__workspace">
        <aside className="esco-new-module-stage__nav" aria-label="Module configuration sections">
          <span>INFORMATION</span>
          {informationSections.map((section) => (
            <button
              key={section}
              type="button"
              className={overviewSection === section ? "is-active" : ""}
              onClick={() => setOverviewSection(section)}
            >
              {section}{section === "Overview" && !definitionOpen ? "*" : ""}
            </button>
          ))}
          <span>CONFIGURATION</span>
          {configurationSections.map((section) => (
            <button
              key={section}
              type="button"
              className={overviewSection === section ? "is-active" : ""}
              onClick={() => setOverviewSection(section)}
            >
              {/channels/i.test(section) ? "▸ " : ""}{section}
            </button>
          ))}
        </aside>
        <main className="esco-new-module-stage__main">
          <section className="esco-new-module-overview" aria-label={`${overviewSection} overview`}>
            <h3>{selected.catalogNumber} {selected.detailTitle || selected.label}</h3>
            <div className="esco-new-module-overview__brand">
              <span className="esco-new-module-overview__badge" aria-hidden="true">EA</span>
              <strong>ESCO Automation</strong>
            </div>
            {overviewSection === "Overview" || overviewSection === "Device Information" ? (
              <div className="esco-new-module-overview__definition">
                <h4>Definition</h4>
                <dl>
                  <div><dt>Profile Summary:</dt><dd>{selectedProfile.profile}</dd></div>
                  <div><dt>Connection Summary:</dt><dd>{selectedProfile.connection}</dd></div>
                  <div><dt>Channel Summary:</dt><dd>{selectedProfile.channels}</dd></div>
                  <div><dt>Series:</dt><dd>{series}</dd></div>
                  <div><dt>Revision:</dt><dd>{revisionLabel}</dd></div>
                  <div><dt>Electronic keying:</dt><dd>{ioDeviceKeyingLabel(electronicKeying)}</dd></div>
                  <div><dt>Connection:</dt><dd>{connectionName}</dd></div>
                  <div><dt>Connection Type:</dt><dd>{connectionType || "-"}</dd></div>
                  <div><dt>RPI:</dt><dd>{connectionRpiNumber != null ? `${connectionRpiNumber} us (${connectionRpiNumber / 1000} ms)` : "-"}</dd></div>
                  <div><dt>Protocol / Bus:</dt><dd>{selected.protocolBus || "-"}</dd></div>
                  <div><dt>Signal Type:</dt><dd>{selected.signalType || "-"}</dd></div>
                  <div><dt>Channels / Points:</dt><dd>{selected.channels || "-"}</dd></div>
                  <div><dt>Input Data:</dt><dd>{inputData}</dd></div>
                  <div><dt>Coordinated System Time:</dt><dd>{coordinatedSystemTime}</dd></div>
                  <div><dt>Data Format:</dt><dd>{dataFormat}</dd></div>
                  <div><dt>Setup Tags:</dt><dd>{hasSetupTags ? `${createSetupTags ? "Create" : "Skip"} ${setupTags.length}` : "None"}</dd></div>
                  <div><dt>Description:</dt><dd>{description || "-"}</dd></div>
                  <div><dt>{isChangeMode ? "Change Validation" : "Creation Validation"}:</dt><dd>{validationMessage ?? readyMessage}</dd></div>
                </dl>
                <h4>Status</h4>
                {renderProfileDiagnostics()}
                {renderSetupTags()}
                <button type="button" className="esco-btn" onClick={openDeviceDefinition}>Change Device Definition</button>
              </div>
            ) : overviewSection === "Connection" ? (
              <div className="esco-new-module-overview__definition">
                <h4>Connection</h4>
                <dl>
                  <div><dt>Profile Connection:</dt><dd>{selectedProfile.connection}</dd></div>
                  <div><dt>Connection:</dt><dd>{connectionName}</dd></div>
                  <div><dt>Connection Type:</dt><dd>{connectionType || "-"}</dd></div>
                  <div><dt>RPI:</dt><dd>{connectionRpiNumber != null ? `${connectionRpiNumber} us (${connectionRpiNumber / 1000} ms)` : "-"}</dd></div>
                  <div><dt>Priority:</dt><dd>{connectionPriority || "-"}</dd></div>
                  <div><dt>Keying:</dt><dd>{ioDeviceKeyingLabel(electronicKeying)}</dd></div>
                  <div><dt>Slot Review:</dt><dd>{slotClash ? `Slot ${slotNumber} is already used at this I/O location.` : slot || "--"}</dd></div>
                  <div><dt>Parent:</dt><dd>{parentLabel}</dd></div>
                  <div><dt>Parent Port:</dt><dd>{parentPortId || "-"}</dd></div>
                  <div><dt>Comm Path:</dt><dd>{commPath || "Local chassis"}</dd></div>
                  <div><dt>Setup Method:</dt><dd>{selected.setupMethod || "-"}</dd></div>
                  <div><dt>Inhibit Module:</dt><dd>{inhibited ? "Yes" : "No"}</dd></div>
                </dl>
                {renderProfileDiagnostics()}
                {renderSetupTags()}
                <label className="esco-check-field">
                  <span />
                  <span>
                    <input type="checkbox" checked={inhibited} onChange={(event) => setInhibited(event.target.checked)} />
                    Inhibit Module
                  </span>
                </label>
              </div>
            ) : (
              <div className="esco-new-module-overview__definition">
                <h4>{overviewSection}</h4>
                <dl>
                  <div><dt>Channel Summary:</dt><dd>{selectedProfile.channels}</dd></div>
                  <div><dt>Profile Data:</dt><dd>{selectedProfile.data}</dd></div>
                  <div><dt>Data Format:</dt><dd>{dataFormat}</dd></div>
                  <div><dt>Input Data:</dt><dd>{inputData}</dd></div>
                </dl>
                {/channels/i.test(overviewSection) ? renderChannelTable() : null}
                {renderProfileDiagnostics()}
                {renderSetupTags()}
              </div>
            )}
            <img className="esco-new-module-overview__device" src={selectedImageUrl} alt="" aria-hidden="true" />
          </section>
        </main>
      </div>
      <footer className="esco-new-module-stage__footer">
        {validationMessage ? <p className="esco-dialog-validation" role="alert">{validationMessage}</p> : null}
        <button type="button" className="esco-btn esco-btn--primary" disabled={!!validationMessage} onClick={createModule}>OK</button>
        <button type="button" className="esco-btn" onClick={onClose}>Cancel</button>
        <button type="button" className="esco-btn" onClick={() => helpMessage(isChangeMode ? "change" : "new")}>Help</button>
      </footer>
      {definitionOpen ? renderDeviceDefinition() : null}
    </section>
  );

  return (
    <div className="esco-modal" role="presentation">
      {stage === "catalog" ? renderCatalog() : renderDefinitionStage()}
    </div>
  );
}
