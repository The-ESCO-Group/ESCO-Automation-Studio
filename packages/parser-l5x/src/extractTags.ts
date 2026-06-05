import { createTag, STRUCTURED_TYPES, TAG_DATA_TYPES, type ExternalAccess, type Tag, type TagScope } from "@esco/core";
import { attr, child, text, toArray, type L5XNode } from "./parseL5X";
import { dimensionProps } from "./dimensions";

export interface ExtractedTags {
  tags: Tag[];
  warnings: string[];
}

/** Data types the model understands (atomics, common integers, and structures). */
const KNOWN_DATATYPES = new Set<string>([
  ...TAG_DATA_TYPES, // BOOL, DINT, REAL, STRING, TIMER, COUNTER, CONTROL
  ...Object.keys(STRUCTURED_TYPES),
  "SINT",
  "INT",
  "LINT",
  "STRING",
  "ALIAS",
]);

export function parseExternalAccess(value: string | undefined): ExternalAccess | undefined {
  const normalized = (value ?? "").toLowerCase().replace(/[\s/_-]/g, "");
  if (normalized === "readwrite") return "read-write";
  if (normalized === "readonly") return "read-only";
  if (normalized === "none") return "none";
  return undefined;
}

/**
 * Extract `<Tag>` elements from a `<Tags>` container into domain tags, reading
 * Name, DataType, Description, and AliasFor. Emits warnings for alias tags and
 * for data types the model doesn't represent (UDTs, AOIs, module types), which
 * are still imported but treated as opaque by simulation/validation.
 */
export function extractTags(
  tagsContainer: unknown,
  controllerId: string,
  scope: TagScope,
  programId?: string,
): ExtractedTags {
  const warnings: string[] = [];
  const scopeLabel = scope === "controller" ? "Controller" : "Program";

  const tags = toArray<L5XNode>(child(tagsContainer, "Tag")).flatMap((tagNode) => {
    const name = attr(tagNode, "Name");
    if (!name) return [];

    const aliasFor = attr(tagNode, "AliasFor");
    const dataType = attr(tagNode, "DataType") ?? (aliasFor ? "ALIAS" : "BOOL");
    const descriptionNode = child(tagNode, "Description");
    const dimensions = dimensionProps(attr(tagNode, "Dimensions"));

    const tag = createTag(controllerId, name, dataType, {
      scope,
      programId,
      description: descriptionNode ? text(descriptionNode) : undefined,
      value: dataType === "BOOL" ? false : dataType === "STRING" ? "" : 0,
      ...dimensions,
    });

    // Read-only metadata: constant tags and produced/consumed roles.
    if (attr(tagNode, "Constant") === "true") tag.constant = true;
    const externalAccess = parseExternalAccess(attr(tagNode, "ExternalAccess"));
    if (externalAccess) tag.externalAccess = externalAccess;
    const tagType = (attr(tagNode, "TagType") ?? "").toLowerCase();
    if (tagType === "produced") {
      tag.produced = true;
      // Preserve the connection settings (display-only metadata; never used to
      // open a real controller connection) so they survive export -> import.
      const produceNode = child(tagNode, "ProduceInfo");
      if (produceNode) {
        const countRaw = attr(produceNode, "ProduceCount");
        const count = countRaw !== undefined && countRaw !== "" ? Number(countRaw) : undefined;
        const unicast = attr(produceNode, "UnicastPermitted");
        const eventTrigger = attr(produceNode, "ProgrammaticallySendEventTrigger");
        const produceInfo: NonNullable<Tag["produceInfo"]> = {};
        if (count !== undefined && Number.isFinite(count)) produceInfo.produceCount = count;
        if (unicast !== undefined) produceInfo.unicastPermitted = unicast === "true";
        if (eventTrigger !== undefined) produceInfo.programmaticallySendEventTrigger = eventTrigger === "true";
        if (Object.keys(produceInfo).length > 0) tag.produceInfo = produceInfo;
      }
    }
    if (tagType === "consumed") {
      tag.consumed = true;
      // Preserve the producer binding (display-only metadata; never used to
      // open a real controller connection) so it survives export -> import.
      const consumeNode = child(tagNode, "ConsumeInfo");
      if (consumeNode) {
        const producer = attr(consumeNode, "Producer");
        const remoteTag = attr(consumeNode, "RemoteTag");
        const remoteInstance = attr(consumeNode, "RemoteInstance");
        const rpiRaw = attr(consumeNode, "RPI");
        const rpi = rpiRaw !== undefined && rpiRaw !== "" ? Number(rpiRaw) : undefined;
        const unicast = attr(consumeNode, "Unicast");
        const consumeInfo: NonNullable<Tag["consumeInfo"]> = {};
        if (producer) consumeInfo.producer = producer;
        if (remoteTag) consumeInfo.remoteTag = remoteTag;
        if (remoteInstance) consumeInfo.remoteInstance = remoteInstance;
        if (rpi !== undefined && Number.isFinite(rpi)) consumeInfo.rpi = rpi;
        if (unicast !== undefined) consumeInfo.unicast = unicast === "true";
        if (Object.keys(consumeInfo).length > 0) tag.consumeInfo = consumeInfo;
      }
    }
    // Display radix is preserved verbatim (display-only metadata); never parsed
    // or validated, so any vendor spelling round-trips unchanged.
    const radix = attr(tagNode, "Radix");
    if (radix) tag.radix = radix;
    // Safety class ("Safety" / "Standard") is preserved verbatim; never used to
    // schedule a safety task, just kept so the partition round-trips on export.
    const safetyClass = attr(tagNode, "Class");
    if (safetyClass) tag.safetyClass = safetyClass;
    // OPC UA accessibility ("None" / "ReadWrite") is preserved verbatim
    // (display-only metadata; never used to open a real OPC UA connection), so
    // the setting round-trips on export.
    const opcUaAccess = attr(tagNode, "OpcUaAccess");
    if (opcUaAccess) tag.opcUaAccess = opcUaAccess;

    // Per-element/member comments (<Comments><Comment Operand=...>) are stored on
    // the tag in Logix, not the data type. Preserve them verbatim (display-only
    // metadata; never parsed or validated) so element/member descriptions survive
    // export -> import.
    const comments = toArray<L5XNode>(child(child(tagNode, "Comments"), "Comment")).flatMap(
      (commentNode) => {
        const operand = attr(commentNode, "Operand");
        if (!operand) return [];
        return [{ operand, text: text(commentNode) }];
      },
    );
    if (comments.length > 0) tag.comments = comments;

    // Per-element/member engineering units (<EngineeringUnits><EngineeringUnit
    // Operand=...>) are stored on the tag in Logix, parallel to <Comments>.
    // Preserve them verbatim (display-only metadata; never parsed or validated)
    // so units survive export -> import.
    const engineeringUnits = toArray<L5XNode>(
      child(child(tagNode, "EngineeringUnits"), "EngineeringUnit"),
    ).flatMap((unitNode) => {
      const operand = attr(unitNode, "Operand") ?? "";
      return [{ operand, text: text(unitNode) }];
    });
    if (engineeringUnits.length > 0) tag.engineeringUnits = engineeringUnits;

    if (aliasFor) {
      tag.aliasFor = aliasFor;
      warnings.push(`${scopeLabel} tag "${name}" is an alias for "${aliasFor}" (imported as alias).`);
    } else if (!KNOWN_DATATYPES.has(dataType)) {
      warnings.push(
        `${scopeLabel} tag "${name}" has unmodeled data type "${dataType}" (imported, treated as opaque).`,
      );
    }
    return [tag];
  });

  return { tags, warnings };
}
