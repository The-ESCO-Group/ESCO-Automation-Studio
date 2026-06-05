import { createId } from "@esco/shared";
import type {
  AddOnInstruction,
  ControllerCommPorts,
  ControllerEthernetConfig,
  ControllerTrend,
  IoModule,
  L5XAttributeMap,
  ProgramParameterConnection,
  QuickWatchList,
  UserDefinedType,
} from "@esco/core";
import type { InstructionRegistry } from "@esco/instructions";
import { attr, child, text, toArray, type L5XNode } from "./parseL5X";
import { extractRoutineList } from "./extractRoutines";
import { parseExternalAccess } from "./extractTags";
import { dimensionProps } from "./dimensions";

/**
 * Extract the controller's structural metadata that the simulator does not
 * execute but the engineer needs to see: user-defined types, Add-On Instruction
 * definitions, and the I/O module tree. All read-only — imported for display and
 * cross-reference, never executed or used for communication.
 */

function attrsExcept(node: L5XNode, excluded: readonly string[]): L5XAttributeMap | undefined {
  const excludedSet = new Set(excluded);
  const attrs: L5XAttributeMap = {};
  for (const [key, value] of Object.entries(node)) {
    if (!key.startsWith("@_")) continue;
    const name = key.slice(2);
    if (excludedSet.has(name)) continue;
    if (value == null) continue;
    attrs[name] = String(value);
  }
  return Object.keys(attrs).length > 0 ? attrs : undefined;
}

interface ModuleProfileChannel {
  id?: string;
  label?: string;
  direction?: string;
  signal?: string;
  enabled?: boolean;
  dataFormat?: string;
  range?: string;
  diagnostic?: string;
}

interface ModuleProfileExtension {
  profileChannels?: ModuleProfileChannel[];
}

function truthyAttr(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim().toLowerCase();
  return normalized === "true" || normalized === "1";
}

function extractModuleProfileChannels(moduleNode: L5XNode): ModuleProfileChannel[] {
  const directChannels = toArray<L5XNode>(child(child(moduleNode, "ProfileChannels"), "ProfileChannel"));
  const aliasChannels = toArray<L5XNode>(child(child(moduleNode, "ProfileChannels"), "Channel"));
  return [...directChannels, ...aliasChannels].flatMap((channelNode) => {
    const id = attr(channelNode, "Id") ?? attr(channelNode, "ID") ?? attr(channelNode, "Name");
    const label = attr(channelNode, "Label") ?? attr(channelNode, "Name");
    const direction = attr(channelNode, "Direction");
    const signal = attr(channelNode, "Signal") ?? attr(channelNode, "SignalType");
    const enabled = truthyAttr(attr(channelNode, "Enabled"));
    const dataFormat = attr(channelNode, "DataFormat") ?? attr(channelNode, "Format");
    const range = attr(channelNode, "Range") ?? attr(channelNode, "Mode");
    const diagnostic = attr(channelNode, "Diagnostic");
    const channel: ModuleProfileChannel = {
      ...(id ? { id } : {}),
      ...(label ? { label } : {}),
      ...(direction ? { direction } : {}),
      ...(signal ? { signal } : {}),
      ...(enabled !== undefined ? { enabled } : {}),
      ...(dataFormat ? { dataFormat } : {}),
      ...(range ? { range } : {}),
      ...(diagnostic ? { diagnostic } : {}),
    };
    return Object.keys(channel).length > 0 ? [channel] : [];
  });
}

/** `<DataTypes><DataType>` → UDT definitions with their members. */
export function extractDataTypes(controllerNode: L5XNode): UserDefinedType[] {
  return toArray<L5XNode>(child(child(controllerNode, "DataTypes"), "DataType")).flatMap((dtNode) => {
    const name = attr(dtNode, "Name");
    if (!name) return [];
    const dtDescription = child(dtNode, "Description");
    // Data-type family (e.g. "StringFamily" for custom string types) is preserved
    // verbatim (read-only metadata; never parsed or validated) so it round-trips.
    const family = attr(dtNode, "Family");
    // Safety partition ("Safety" / "Standard") is preserved verbatim (read-only
    // metadata; never used to schedule a safety task) so it round-trips on export
    // (mirrors tag / program / task / AOI Class handling).
    const safetyClass = attr(dtNode, "Class");
    const members = toArray<L5XNode>(child(child(dtNode, "Members"), "Member")).flatMap((memberNode) => {
      const memberName = attr(memberNode, "Name");
      if (!memberName) return [];
      const descriptionNode = child(memberNode, "Description");
      // Display radix is preserved verbatim (display-only metadata); never parsed
      // or validated, so any vendor spelling round-trips unchanged (mirrors tags).
      const radix = attr(memberNode, "Radix");
      // Member external access is normalized and preserved (mirrors tags).
      const externalAccess = parseExternalAccess(attr(memberNode, "ExternalAccess"));
      // Bit-overlay layout: BOOL members are packed onto a hidden host integer
      // member. Hidden/Target/BitNumber are preserved verbatim (read-only layout
      // metadata) so the exact member packing round-trips through export.
      const hidden = attr(memberNode, "Hidden") === "true";
      const target = attr(memberNode, "Target");
      const bitNumberRaw = attr(memberNode, "BitNumber");
      const bitNumber = bitNumberRaw != null && bitNumberRaw !== "" ? Number(bitNumberRaw) : undefined;
      return [
        {
          name: memberName,
          dataType: attr(memberNode, "DataType") ?? "BOOL",
          ...dimensionProps(attr(memberNode, "Dimension")),
          ...(descriptionNode ? { description: text(descriptionNode) } : {}),
          ...(radix ? { radix } : {}),
          ...(externalAccess ? { externalAccess } : {}),
          ...(hidden ? { hidden: true } : {}),
          ...(target ? { target } : {}),
          ...(bitNumber != null && Number.isFinite(bitNumber) ? { bitNumber } : {}),
        },
      ];
    });
    return [{ id: createId("udt"), name, ...(dtDescription ? { description: text(dtDescription) } : {}), ...(family ? { family } : {}), ...(safetyClass ? { safetyClass } : {}), members }];
  });
}

/**
 * `<AddOnInstructionDefinitions><AddOnInstructionDefinition>` → AOI definitions
 * with parameters, local tags, and their imported routines. Source-protected AOI
 * logic is not available; unprotected RLL AOI routines can execute offline.
 */
export interface ExtractedAddOnInstructions {
  aois: AddOnInstruction[];
  warnings: string[];
}

export function extractAddOnInstructions(
  controllerNode: L5XNode,
  registry?: InstructionRegistry,
  knownInstructionTypes: Set<string> = new Set(),
): ExtractedAddOnInstructions {
  const container = child(controllerNode, "AddOnInstructionDefinitions");
  const warnings: string[] = [];
  const aoiNodes = toArray<L5XNode>(child(container, "AddOnInstructionDefinition"));
  const allKnown = new Set(knownInstructionTypes);
  for (const aoiNode of aoiNodes) {
    const name = attr(aoiNode, "Name");
    if (name) allKnown.add(name.toUpperCase());
  }

  const aois = aoiNodes.flatMap((aoiNode) => {
    const name = attr(aoiNode, "Name");
    if (!name) return [];
    const id = createId("aoi");
    const descriptionNode = child(aoiNode, "Description");
    const revision = attr(aoiNode, "Revision");
    const revisionExtension = attr(aoiNode, "RevisionExtension");
    // Authoring software version (SoftwareRevision, e.g. "v32.11") is preserved
    // verbatim (read-only display metadata; never parsed or validated) so it
    // round-trips on export (mirrors RevisionExtension and Vendor).
    const softwareRevision = attr(aoiNode, "SoftwareRevision");
    const vendor = attr(aoiNode, "Vendor");
    const signature = attr(aoiNode, "SignatureID");
    // Authoring identity (CreatedDate / CreatedBy / EditedDate / EditedBy) is
    // preserved verbatim (read-only display metadata; never parsed or validated)
    // so the AOI change history round-trips on export (mirrors RevisionExtension
    // and Vendor). Present in nearly every Studio 5000 AOI definition.
    const createdDate = attr(aoiNode, "CreatedDate");
    const createdBy = attr(aoiNode, "CreatedBy");
    const editedDate = attr(aoiNode, "EditedDate");
    const editedBy = attr(aoiNode, "EditedBy");
    // Documentation children (<RevisionNote> / <AdditionalHelpText>) are
    // preserved verbatim (read-only display text; never parsed or validated) so
    // the authored notes round-trip on export (mirrors <Description>).
    const revisionNoteNode = child(aoiNode, "RevisionNote");
    const additionalHelpTextNode = child(aoiNode, "AdditionalHelpText");
    // Safety partition ("Safety" / "Standard") is preserved verbatim (read-only
    // metadata; never used to schedule a safety task) so it round-trips on
    // export (mirrors tag / program Class handling).
    const safetyClass = attr(aoiNode, "Class");
    // Scan-mode execution flags (ExecutePrescan / ExecutePostscan /
    // ExecuteEnableInFalse) are preserved verbatim (read-only metadata; never used
    // to drive the offline simulator) so the scan-mode configuration round-trips
    // on export. Only an explicit "true" is captured; the export drops absent flags.
    const executePrescan = attr(aoiNode, "ExecutePrescan") === "true";
    const executePostscan = attr(aoiNode, "ExecutePostscan") === "true";
    const executeEnableInFalse = attr(aoiNode, "ExecuteEnableInFalse") === "true";

    // Source-protected ("sealed") AOIs export an EncodedData blob and/or a
    // SourceProtectionType; their logic is encrypted and not available to inspect.
    const protectionType = attr(aoiNode, "SourceProtectionType");
    const isProtected = child(aoiNode, "EncodedData") != null || (protectionType != null && protectionType !== "None");

    const parameters = toArray<L5XNode>(child(child(aoiNode, "Parameters"), "Parameter")).flatMap(
      (paramNode) => {
        const paramName = attr(paramNode, "Name");
        if (!paramName) return [];
        const usage = attr(paramNode, "Usage");
        const defaultValue = attr(paramNode, "Default");
        const paramDesc = child(paramNode, "Description");
        // Display radix and external access are preserved verbatim (display-only
        // metadata; never parsed or validated) so they round-trip (mirrors tags,
        // UDT members, and AOI local tags).
        const radix = attr(paramNode, "Radix");
        const externalAccess = parseExternalAccess(attr(paramNode, "ExternalAccess"));
        return [
          {
            name: paramName,
            dataType: attr(paramNode, "DataType") ?? "BOOL",
            ...(usage ? { usage } : {}),
            // Array parameters (commonly InOut arrays passed by reference) carry a
            // Dimensions attribute; preserve it so the array-ness round-trips on
            // export (mirrors program parameters and AOI local tags).
            ...dimensionProps(attr(paramNode, "Dimensions")),
            ...(attr(paramNode, "Required") === "true" ? { required: true } : {}),
            // Instruction-face visibility (independent of Required); preserve the
            // explicit Visible="true" so the parameter face layout round-trips.
            ...(attr(paramNode, "Visible") === "true" ? { visible: true } : {}),
            ...(defaultValue != null ? { defaultValue } : {}),
            ...(paramDesc ? { description: text(paramDesc) } : {}),
            ...(radix ? { radix } : {}),
            ...(externalAccess ? { externalAccess } : {}),
            // Constant input parameters carry Constant="true"; preserve it
            // verbatim (read-only metadata) so it round-trips (mirrors program
            // parameters and tags).
            ...(attr(paramNode, "Constant") === "true" ? { constant: true } : {}),
          },
        ];
      },
    );

    const localTags = toArray<L5XNode>(child(child(aoiNode, "LocalTags"), "LocalTag")).flatMap(
      (tagNode) => {
        const tagName = attr(tagNode, "Name");
        if (!tagName) return [];
        const tagDesc = child(tagNode, "Description");
        // Display radix and external access are preserved verbatim (display-only
        // metadata; never parsed or validated) so they round-trip (mirrors tags
        // and UDT members).
        const radix = attr(tagNode, "Radix");
        const externalAccess = parseExternalAccess(attr(tagNode, "ExternalAccess"));
        return [
          {
            name: tagName,
            dataType: attr(tagNode, "DataType") ?? "BOOL",
            ...dimensionProps(attr(tagNode, "Dimensions")),
            ...(tagDesc ? { description: text(tagDesc) } : {}),
            ...(radix ? { radix } : {}),
            ...(externalAccess ? { externalAccess } : {}),
          },
        ];
      },
    );

    const routineNodes = toArray<L5XNode>(child(child(aoiNode, "Routines"), "Routine"));
    const routineNames = routineNodes
      .map((routineNode) => attr(routineNode, "Name"))
      .filter((routineName): routineName is string => Boolean(routineName));
    const extractedRoutines = registry && !isProtected
      ? extractRoutineList(routineNodes, `AOI ${name}`, id, registry, allKnown)
      : { routines: [], warnings: [] };
    warnings.push(...extractedRoutines.warnings);

    return [
      {
        id,
        name,
        ...(descriptionNode ? { description: text(descriptionNode) } : {}),
        ...(revision ? { revision } : {}),
        ...(revisionExtension ? { revisionExtension } : {}),
        ...(softwareRevision ? { softwareRevision } : {}),
        ...(vendor ? { vendor } : {}),
        ...(signature ? { signature } : {}),
        ...(createdDate ? { createdDate } : {}),
        ...(createdBy ? { createdBy } : {}),
        ...(editedDate ? { editedDate } : {}),
        ...(editedBy ? { editedBy } : {}),
        ...(revisionNoteNode ? { revisionNote: text(revisionNoteNode) } : {}),
        ...(additionalHelpTextNode ? { additionalHelpText: text(additionalHelpTextNode) } : {}),
        ...(safetyClass ? { safetyClass } : {}),
        ...(executePrescan ? { executePrescan: true } : {}),
        ...(executePostscan ? { executePostscan: true } : {}),
        ...(executeEnableInFalse ? { executeEnableInFalse: true } : {}),
        ...(isProtected ? { protected: true } : {}),
        ...(protectionType && protectionType !== "None" ? { protectionType } : {}),
        parameters,
        localTags,
        routineNames,
        ...(extractedRoutines.routines.length > 0 ? { routines: extractedRoutines.routines } : {}),
      },
    ];
  });

  return { aois, warnings };
}

/** `<Modules><Module>` → the I/O module tree (offline view; no communication). */
export function extractModules(controllerNode: L5XNode): IoModule[] {
  return toArray<L5XNode>(child(child(controllerNode, "Modules"), "Module")).flatMap((moduleNode) => {
    const name = attr(moduleNode, "Name");
    if (!name) return [];
    const catalogNumber = attr(moduleNode, "CatalogNumber");
    const parentModule = attr(moduleNode, "ParentModule");
    const parentPortId = attr(moduleNode, "ParentModPortId") ?? attr(moduleNode, "ParentModulePortId");
    const commPath = attr(moduleNode, "CommPath") ?? attr(moduleNode, "CommMethod");
    const descriptionNode = child(moduleNode, "Description");
    const ports = toArray<L5XNode>(child(child(moduleNode, "Ports"), "Port")).map((portNode) => {
      // A backplane/chassis port carries a <Bus Size="N"/> child (slot count).
      // Preserve it verbatim (read-only display metadata) so it round-trips.
      const busNode = child(portNode, "Bus");
      const busSizeRaw = busNode ? attr(busNode, "Size") : undefined;
      const busSize = busSizeRaw != null && busSizeRaw !== "" ? Number(busSizeRaw) : undefined;
      // The CIP Safety Network Number (SafetyNetwork) identifies the safety
      // subnet a port belongs to. Preserve it verbatim (read-only metadata; never
      // used to verify a safety connection) so it round-trips on export.
      const safetyNetwork = attr(portNode, "SafetyNetwork");
      return {
        ...(attr(portNode, "Id") ? { id: attr(portNode, "Id") } : {}),
        ...(attr(portNode, "Type") ? { type: attr(portNode, "Type") } : {}),
        ...(attr(portNode, "Address") ? { address: attr(portNode, "Address") } : {}),
        ...(attr(portNode, "Upstream") === "true" ? { upstream: true } : {}),
        ...(busSize != null && Number.isFinite(busSize) ? { busSize } : {}),
        ...(safetyNetwork ? { safetyNetwork } : {}),
      };
    });

    // I/O connections (<Communications><Connections><Connection>) carry the
    // requested packet interval and connection role. Preserve them verbatim
    // (read-only configuration metadata; never used to open a real controller
    // connection) so the connection settings round-trip on export (mirrors the
    // consumed-tag <ConsumeInfo> RPI). Only attributes the model represents are
    // captured; the connection's logic children are not.
    const connections = toArray<L5XNode>(
      child(child(child(moduleNode, "Communications"), "Connections"), "Connection"),
    ).flatMap((connectionNode) => {
      const connName = attr(connectionNode, "Name");
      const rpiRaw = attr(connectionNode, "RPI");
      const rpi = rpiRaw != null && rpiRaw !== "" ? Number(rpiRaw) : undefined;
      const connType = attr(connectionNode, "Type");
      // Connection scheduling priority (e.g. "Scheduled") is preserved verbatim
      // (read-only QoS metadata; never used to open a real controller connection).
      const priority = attr(connectionNode, "Priority");
      const unicast = attr(connectionNode, "Unicast");
      // Event identifier for event-triggered connections (read-only metadata;
      // never used to open a real controller connection).
      const eventIdRaw = attr(connectionNode, "EventID");
      const eventId = eventIdRaw != null && eventIdRaw !== "" ? Number(eventIdRaw) : undefined;
      // Whether the connection may be triggered programmatically to fire an
      // event task (pairs with EventID). Read-only metadata; never used to open
      // a real connection or fire an event (mirrors the produced-tag flag).
      const eventTrigger = attr(connectionNode, "ProgrammaticallySendEventTrigger");
      // Input delivery/production and output-ownership QoS settings are preserved
      // verbatim (read-only metadata; never used to open a real controller
      // connection) so they round-trip on export.
      const inputConnectionType = attr(connectionNode, "InputConnectionType");
      const inputProductionTrigger = attr(connectionNode, "InputProductionTrigger");
      const outputRedundantOwner = attr(connectionNode, "OutputRedundantOwner");
      const connection: { name?: string; rpi?: number; type?: string; priority?: string; unicast?: boolean; eventId?: number; programmaticallySendEventTrigger?: boolean; inputConnectionType?: string; inputProductionTrigger?: string; outputRedundantOwner?: boolean } = {};
      if (connName) connection.name = connName;
      if (rpi != null && Number.isFinite(rpi)) connection.rpi = rpi;
      if (connType) connection.type = connType;
      if (priority) connection.priority = priority;
      if (unicast !== undefined) connection.unicast = unicast === "true";
      if (eventId != null && Number.isFinite(eventId)) connection.eventId = eventId;
      if (eventTrigger !== undefined) connection.programmaticallySendEventTrigger = eventTrigger === "true";
      if (inputConnectionType) connection.inputConnectionType = inputConnectionType;
      if (inputProductionTrigger) connection.inputProductionTrigger = inputProductionTrigger;
      if (outputRedundantOwner !== undefined) connection.outputRedundantOwner = outputRedundantOwner === "true";
      return Object.keys(connection).length > 0 ? [connection] : [];
    });
    const profileChannels = extractModuleProfileChannels(moduleNode);

    // Studio 5000 stores a module's electronic keying as an <EKey State="..."/>
    // child element (e.g. "ExactMatch" / "CompatibleModule" / "Disable"); older
    // and this tool's own exports also used an ElectronicKeying attribute. Prefer
    // the canonical child so keying round-trips from real files, falling back to
    // the attribute (read-only metadata; never used to verify a real connection).
    const ekeyNode = child(moduleNode, "EKey");
    const electronicKeying =
      (ekeyNode ? attr(ekeyNode, "State") : undefined) ?? attr(moduleNode, "ElectronicKeying");

    // Slot is sometimes a direct attribute and sometimes a Ports/Port Address.
    let slotText = attr(moduleNode, "Slot");
    if (slotText == null) {
      slotText = ports[0]?.address;
    }
    const slot = Number(slotText ?? "");

    const module: IoModule & ModuleProfileExtension = {
      id: createId("mod"),
      name,
      ...(catalogNumber ? { catalogNumber } : {}),
      ...(Number.isFinite(slot) ? { slot } : {}),
      ...(descriptionNode ? { description: text(descriptionNode) } : {}),
      ...(parentModule ? { parentModule } : {}),
      ...(parentPortId ? { parentPortId } : {}),
      ...(commPath ? { commPath } : {}),
      ...(attr(moduleNode, "Vendor") ? { vendor: attr(moduleNode, "Vendor") } : {}),
      ...(attr(moduleNode, "ProductType") ? { productType: attr(moduleNode, "ProductType") } : {}),
      ...(attr(moduleNode, "ProductCode") ? { productCode: attr(moduleNode, "ProductCode") } : {}),
      ...(attr(moduleNode, "Major") ? { majorRevision: attr(moduleNode, "Major") } : {}),
      ...(attr(moduleNode, "Minor") ? { minorRevision: attr(moduleNode, "Minor") } : {}),
      ...(electronicKeying ? { electronicKeying } : {}),
      ...(attr(moduleNode, "Inhibited") === "true" || attr(moduleNode, "InhibitModule") === "true" ? { inhibited: true } : {}),
      ...(attr(moduleNode, "MajorFault") === "true" ? { majorFault: true } : {}),
      ...(ports.length > 0 ? { ports } : {}),
      ...(connections.length > 0 ? { connections } : {}),
    };
    if (profileChannels.length > 0) module.profileChannels = profileChannels;
    return [module];
  });
}

/**
 * `<Trends><Trend>` -> Logix Designer trend definitions (offline view; no live
 * trend sampling). Attribute maps intentionally preserve vendor/version fields
 * verbatim so the definitions can round-trip even as Rockwell extends the
 * TrendX schema.
 */
export function extractTrends(controllerNode: L5XNode): ControllerTrend[] {
  return toArray<L5XNode>(child(child(controllerNode, "Trends"), "Trend")).flatMap((trendNode) => {
    const name = attr(trendNode, "Name");
    if (!name) return [];
    const descriptionNode = child(trendNode, "Description");
    const templateNode = child(trendNode, "Template");
    const pens = toArray<L5XNode>(child(child(trendNode, "Pens"), "Pen")).flatMap((penNode) => {
      const penName = attr(penNode, "Name");
      if (!penName) return [];
      const penDescription = child(penNode, "Description");
      return [
        {
          id: createId("pen"),
          name: penName,
          ...(penDescription ? { description: text(penDescription) } : {}),
          ...(attrsExcept(penNode, ["Name"]) ? { attributes: attrsExcept(penNode, ["Name"]) } : {}),
        },
      ];
    });

    return [
      {
        id: createId("trend"),
        name,
        ...(descriptionNode ? { description: text(descriptionNode) } : {}),
        ...(attrsExcept(trendNode, ["Name"]) ? { attributes: attrsExcept(trendNode, ["Name"]) } : {}),
        ...(templateNode != null ? { template: text(templateNode) } : {}),
        pens,
      },
    ];
  });
}

/**
 * `<QuickWatchLists><QuickWatchList>` -> Logix Designer Quick Watch
 * definitions (offline view; no live monitoring). Studio stores watch entries as
 * `<WatchTag Specifier="..." Scope="..."/>`; Scope is empty/absent for
 * controller-scope tags. A few hand-authored files wrap tags in `<WatchTags>`,
 * so the importer accepts both shapes while exporting the documented direct
 * `WatchTag` form.
 */
export function extractQuickWatchLists(controllerNode: L5XNode): QuickWatchList[] {
  return toArray<L5XNode>(child(child(controllerNode, "QuickWatchLists"), "QuickWatchList")).flatMap((listNode) => {
    const name = attr(listNode, "Name");
    if (!name) return [];
    const descriptionNode = child(listNode, "Description");
    const directWatchTags = toArray<L5XNode>(child(listNode, "WatchTag"));
    const nestedWatchTags = toArray<L5XNode>(child(child(listNode, "WatchTags"), "WatchTag"));
    const tags = [...directWatchTags, ...nestedWatchTags].flatMap((tagNode) => {
      const specifier = attr(tagNode, "Specifier") ?? attr(tagNode, "Name");
      if (!specifier) return [];
      const scope = attr(tagNode, "Scope");
      const tagDescription = child(tagNode, "Description");
      const attributes = attrsExcept(tagNode, ["Specifier", "Scope", "Name"]);
      return [
        {
          id: createId("qwt"),
          specifier,
          ...(scope && scope.trim() !== "" ? { scope } : {}),
          ...(tagDescription ? { description: text(tagDescription) } : {}),
          ...(attributes ? { attributes } : {}),
        },
      ];
    });

    const attributes = attrsExcept(listNode, ["Name"]);
    return [
      {
        id: createId("qwl"),
        name,
        ...(descriptionNode ? { description: text(descriptionNode) } : {}),
        ...(attributes ? { attributes } : {}),
        tags,
      },
    ];
  });
}

/**
 * Controller EtherNet/IP configuration objects (`<InternetProtocol>`,
 * `<EthernetPorts>`, and `<EthernetNetwork>`) as authored in the L5X. Attribute
 * maps are kept opaque so controller/network vendor fields round-trip without
 * ESCO trying to apply them to a live adapter.
 */
export function extractEthernetConfig(controllerNode: L5XNode): ControllerEthernetConfig | undefined {
  const internetProtocolNode = child(controllerNode, "InternetProtocol") as L5XNode | undefined;
  const ethernetNetworkNode = child(controllerNode, "EthernetNetwork") as L5XNode | undefined;
  const ports = toArray<L5XNode>(child(child(controllerNode, "EthernetPorts"), "EthernetPort")).flatMap((portNode) => {
    const attributes = attrsExcept(portNode, []);
    return attributes ? [{ id: createId("ethport"), attributes }] : [];
  });

  const internetProtocolAttributes = internetProtocolNode ? attrsExcept(internetProtocolNode, []) : undefined;
  const ethernetNetworkAttributes = ethernetNetworkNode ? attrsExcept(ethernetNetworkNode, []) : undefined;
  if (!internetProtocolAttributes && ports.length === 0 && !ethernetNetworkAttributes) return undefined;

  return {
    ...(internetProtocolAttributes ? { internetProtocol: { attributes: internetProtocolAttributes } } : {}),
    ports,
    ...(ethernetNetworkAttributes ? { network: { attributes: ethernetNetworkAttributes } } : {}),
  };
}

/**
 * Controller serial communication configuration (`<CommPorts><SerialPort>`).
 * Studio stores the serial port settings and child protocol objects such as
 * `<ASCII>` and `<DF1>` as controller configuration metadata. ESCO keeps the
 * attributes opaque so the project can round-trip without trying to open a
 * serial port or emulate DF1/ASCII hardware.
 */
export function extractCommPorts(controllerNode: L5XNode): ControllerCommPorts | undefined {
  const serialPorts = toArray<L5XNode>(child(child(controllerNode, "CommPorts"), "SerialPort")).map((portNode) => {
    const protocols = Object.entries(portNode).flatMap(([key, value]) => {
      if (key.startsWith("@_") || key === "Description" || key === "#text") return [];
      return toArray<unknown>(value).map((protocolNode) => ({
        id: createId("serialproto"),
        elementName: key,
        attributes:
          protocolNode && typeof protocolNode === "object"
            ? attrsExcept(protocolNode as L5XNode, []) ?? {}
            : {},
      }));
    });

    // The port's <Description> child is preserved verbatim (read-only display
    // metadata; never parsed) so it round-trips on export like every other
    // configurable element. It is a child element, so the opaque attribute map
    // above does not capture it and the protocols loop already skips it.
    const descriptionNode = child(portNode, "Description");
    return {
      id: createId("serialport"),
      attributes: attrsExcept(portNode, []) ?? {},
      ...(descriptionNode ? { description: text(descriptionNode) } : {}),
      protocols,
    };
  });

  return serialPorts.length > 0 ? { serialPorts } : undefined;
}

/**
 * `<ParameterConnections><ParameterConnection>` -> Studio 5000
 * program-parameter bindings. EndPoint1/EndPoint2 are preserved verbatim for
 * offline review; ESCO does not perform runtime parameter transfer.
 */
export function extractParameterConnections(controllerNode: L5XNode): ProgramParameterConnection[] {
  return toArray<L5XNode>(child(child(controllerNode, "ParameterConnections"), "ParameterConnection")).map(
    (connectionNode) => {
      const attributes = attrsExcept(connectionNode, ["EndPoint1", "EndPoint2"]);
      return {
        id: createId("paramconn"),
        ...(attr(connectionNode, "EndPoint1") !== undefined ? { endPoint1: attr(connectionNode, "EndPoint1") } : {}),
        ...(attr(connectionNode, "EndPoint2") !== undefined ? { endPoint2: attr(connectionNode, "EndPoint2") } : {}),
        ...(attributes ? { attributes } : {}),
      };
    },
  );
}
