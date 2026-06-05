import { attr, child, parseL5X, text, toArray, type L5XNode } from "@esco/parser-l5x";

export interface FbdReviewElement {
  id?: string;
  x?: number;
  y?: number;
  attributes: Record<string, string>;
}

export interface FbdReviewBlock extends FbdReviewElement {
  type: string;
  typeImported: boolean;
  operand?: string;
  visible?: boolean;
  parameters: FbdReviewParameter[];
}

export interface FbdReviewRef extends FbdReviewElement {
  operand?: string;
}

export type FbdReviewParameterDirection = "input" | "output" | "inout" | "unknown";

export interface FbdReviewParameter extends FbdReviewElement {
  direction: FbdReviewParameterDirection;
  name?: string;
  value?: string;
}

export interface FbdReviewWire {
  id?: string;
  fromId?: string;
  toId?: string;
  fromOperand?: string;
  toOperand?: string;
  attributes: Record<string, string>;
}

export interface FbdReviewTextBox extends FbdReviewElement {
  text: string;
}

export interface FbdReviewUnknownElement {
  name: string;
  attributes: Record<string, string>;
}

export interface FbdReviewCountRow {
  name: string;
  count: number;
}

export type FbdReviewDiagnosticSeverity = "info" | "warning";

export interface FbdReviewDiagnostic {
  severity: FbdReviewDiagnosticSeverity;
  code: string;
  message: string;
  sheetNumber?: string;
  subject?: string;
}

export interface FbdReviewSheet {
  number?: string;
  name?: string;
  attributes: Record<string, string>;
  blocks: FbdReviewBlock[];
  inputRefs: FbdReviewRef[];
  outputRefs: FbdReviewRef[];
  wires: FbdReviewWire[];
  textBoxes: FbdReviewTextBox[];
  unknownElements: FbdReviewUnknownElement[];
}

export interface FbdRoutineReview {
  language: "function-block";
  modelOnly: true;
  executable: false;
  parseable: boolean;
  boundary: string;
  sheetSize?: string;
  summary: {
    sheetCount: number;
    blockCount: number;
    inputRefCount: number;
    outputRefCount: number;
    wireCount: number;
    connectedWireCount: number;
    wireEndpointGapCount: number;
    unresolvedWireEndpointCount: number;
    duplicateElementIdCount: number;
    missingBlockTypeCount: number;
    missingRefOperandCount: number;
    parameterCount: number;
    inputParameterCount: number;
    outputParameterCount: number;
    inOutParameterCount: number;
    unknownParameterCount: number;
    missingParameterNameCount: number;
    diagnosticCount: number;
    diagnosticWarningCount: number;
    textCount: number;
    unknownElementCount: number;
    blockTypes: FbdReviewCountRow[];
    unknownElementNames: FbdReviewCountRow[];
  };
  sheets: FbdReviewSheet[];
  diagnostics: FbdReviewDiagnostic[];
  warnings: string[];
}

const FBD_BOUNDARY =
  "Function Block Diagram is preserved for offline review only. ESCO does not execute FBD sheets or perform physical-controller online edits.";

const ELEMENT_KEYS = new Set([
  "Block",
  "IRef",
  "ORef",
  "Wire",
  "TextBox",
  "Text",
  "FeedbackWire",
  "Sheet",
]);

function emptyReview(warnings: string[] = []): FbdRoutineReview {
  return {
    language: "function-block",
    modelOnly: true,
    executable: false,
    parseable: false,
    boundary: FBD_BOUNDARY,
    summary: {
      sheetCount: 0,
      blockCount: 0,
      inputRefCount: 0,
      outputRefCount: 0,
      wireCount: 0,
      connectedWireCount: 0,
      wireEndpointGapCount: 0,
      unresolvedWireEndpointCount: 0,
      duplicateElementIdCount: 0,
      missingBlockTypeCount: 0,
      missingRefOperandCount: 0,
      parameterCount: 0,
      inputParameterCount: 0,
      outputParameterCount: 0,
      inOutParameterCount: 0,
      unknownParameterCount: 0,
      missingParameterNameCount: 0,
      diagnosticCount: 0,
      diagnosticWarningCount: 0,
      textCount: 0,
      unknownElementCount: 0,
      blockTypes: [],
      unknownElementNames: [],
    },
    sheets: [],
    diagnostics: [],
    warnings,
  };
}

function toNumber(value: string | undefined): number | undefined {
  if (value == null || value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function toBool(value: string | undefined): boolean | undefined {
  if (value == null) return undefined;
  if (/^true$/i.test(value)) return true;
  if (/^false$/i.test(value)) return false;
  return undefined;
}

function attributesOf(node: unknown): Record<string, string> {
  if (!node || typeof node !== "object") return {};
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (!key.startsWith("@_") || value == null) continue;
    result[key.slice(2)] = String(value);
  }
  return result;
}

function firstAttr(attrs: Record<string, string>, names: string[]): string | undefined {
  for (const name of names) {
    const match = attrs[name];
    if (match != null && match.trim() !== "") return match;
  }
  return undefined;
}

function idFromAttrs(attrs: Record<string, string>): string | undefined {
  return firstAttr(attrs, ["ID", "Id", "LocalID", "UID"]);
}

function increment(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function topReviewRows(map: Map<string, number>, limit = 8): FbdReviewCountRow[] {
  return [...map.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, limit);
}

function baseElement(node: unknown): FbdReviewElement {
  const attrs = attributesOf(node);
  return {
    ...(firstAttr(attrs, ["ID", "Id", "LocalID", "UID"]) ? { id: firstAttr(attrs, ["ID", "Id", "LocalID", "UID"]) } : {}),
    ...(toNumber(firstAttr(attrs, ["X", "Left", "XPosition", "XPos"])) != null
      ? { x: toNumber(firstAttr(attrs, ["X", "Left", "XPosition", "XPos"])) }
      : {}),
    ...(toNumber(firstAttr(attrs, ["Y", "Top", "YPosition", "YPos"])) != null
      ? { y: toNumber(firstAttr(attrs, ["Y", "Top", "YPosition", "YPos"])) }
      : {}),
    attributes: attrs,
  };
}

function reviewBlock(node: unknown): FbdReviewBlock {
  const attrs = attributesOf(node);
  const importedType = firstAttr(attrs, ["Type", "Instruction", "Name"]);
  return {
    ...baseElement(node),
    type: importedType ?? "Block",
    typeImported: Boolean(importedType),
    ...(firstAttr(attrs, ["Operand", "Tag", "Instance"]) ? { operand: firstAttr(attrs, ["Operand", "Tag", "Instance"]) } : {}),
    ...(toBool(attrs.Visible) != null ? { visible: toBool(attrs.Visible) } : {}),
    parameters: reviewBlockParameters(node),
  };
}

function reviewParameter(node: unknown, direction: FbdReviewParameterDirection): FbdReviewParameter {
  const attrs = attributesOf(node);
  return {
    ...baseElement(node),
    direction,
    ...(firstAttr(attrs, ["Name", "Parameter", "Pin", "Port"]) ? { name: firstAttr(attrs, ["Name", "Parameter", "Pin", "Port"]) } : {}),
    ...(firstAttr(attrs, ["Operand", "Tag", "Value", "Expression", "Literal", "Constant"])
      ? { value: firstAttr(attrs, ["Operand", "Tag", "Value", "Expression", "Literal", "Constant"]) }
      : {}),
  };
}

function parameterChildren(
  node: unknown,
  direction: FbdReviewParameterDirection,
  directNames: readonly string[],
  containerNames: readonly string[],
): FbdReviewParameter[] {
  const parameters: FbdReviewParameter[] = [];
  const containerChildNames = [...new Set([...directNames, "Parameter", "Param"])];
  for (const name of directNames) {
    parameters.push(...toArray(child(node, name)).map((item) => reviewParameter(item, direction)));
  }
  for (const containerName of containerNames) {
    for (const container of toArray(child(node, containerName))) {
      for (const name of containerChildNames) {
        parameters.push(...toArray(child(container, name)).map((item) => reviewParameter(item, direction)));
      }
    }
  }
  return parameters;
}

function reviewBlockParameters(node: unknown): FbdReviewParameter[] {
  return [
    ...parameterChildren(node, "input", ["InputParameter", "InputParam", "InParameter"], ["InputParameters", "InputParams", "InParameters"]),
    ...parameterChildren(node, "output", ["OutputParameter", "OutputParam", "OutParameter"], ["OutputParameters", "OutputParams", "OutParameters"]),
    ...parameterChildren(node, "inout", ["InOutParameter", "InOutParam", "InOut"], ["InOutParameters", "InOutParams"]),
    ...parameterChildren(node, "unknown", ["Parameter", "Param"], ["Parameters", "Params"]),
  ];
}

function reviewRef(node: unknown): FbdReviewRef {
  const attrs = attributesOf(node);
  return {
    ...baseElement(node),
    ...(firstAttr(attrs, ["Operand", "Tag", "Name"]) ? { operand: firstAttr(attrs, ["Operand", "Tag", "Name"]) } : {}),
  };
}

function reviewWire(node: unknown): FbdReviewWire {
  const attrs = attributesOf(node);
  return {
    ...(firstAttr(attrs, ["ID", "Id", "LocalID", "UID"]) ? { id: firstAttr(attrs, ["ID", "Id", "LocalID", "UID"]) } : {}),
    ...(firstAttr(attrs, ["FromID", "FromId", "From"]) ? { fromId: firstAttr(attrs, ["FromID", "FromId", "From"]) } : {}),
    ...(firstAttr(attrs, ["ToID", "ToId", "To"]) ? { toId: firstAttr(attrs, ["ToID", "ToId", "To"]) } : {}),
    ...(firstAttr(attrs, ["FromOperand", "FromTag"]) ? { fromOperand: firstAttr(attrs, ["FromOperand", "FromTag"]) } : {}),
    ...(firstAttr(attrs, ["ToOperand", "ToTag"]) ? { toOperand: firstAttr(attrs, ["ToOperand", "ToTag"]) } : {}),
    attributes: attrs,
  };
}

function reviewTextBox(node: unknown): FbdReviewTextBox {
  const attrs = attributesOf(node);
  return {
    ...baseElement(node),
    text: firstAttr(attrs, ["Text", "Caption", "Description"]) ?? text(node),
  };
}

function sourceToFbdContent(source: string): { content?: L5XNode; warnings: string[] } {
  const trimmed = source.trim();
  if (!trimmed) return { warnings: ["FBD source is empty; no sheets are available for review."] };
  if (/&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[0-9a-f]+;)/i.test(trimmed)) {
    return { warnings: ["FBD source could not be parsed as XML; showing preserved source only."] };
  }
  try {
    const root = parseL5X(
      `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0">
  <Controller Use="Target" Name="FBDReview">
    <Programs>
      <Program Name="ReviewProgram">
        <Routines>
          <Routine Name="ReviewRoutine" Type="FBD">
${trimmed}
          </Routine>
        </Routines>
      </Program>
    </Programs>
  </Controller>
</RSLogix5000Content>`,
    );
    const content = child(
      child(child(child(child(child(root, "Controller"), "Programs"), "Program"), "Routines"), "Routine"),
      "FBDContent",
    );
    return content && typeof content === "object"
      ? { content: content as L5XNode, warnings: [] }
      : { warnings: ["FBD source did not contain an <FBDContent> body."] };
  } catch {
    return { warnings: ["FBD source could not be parsed as XML; showing preserved source only."] };
  }
}

function reviewSheet(node: unknown, index: number): FbdReviewSheet {
  const attrs = attributesOf(node);
  const unknownElements: FbdReviewUnknownElement[] = [];
  if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (key.startsWith("@_") || key === "#text" || ELEMENT_KEYS.has(key)) continue;
      for (const item of toArray(value)) {
        unknownElements.push({ name: key, attributes: attributesOf(item) });
      }
    }
  }
  return {
    number: firstAttr(attrs, ["Number", "Index"]) ?? String(index),
    ...(firstAttr(attrs, ["Name"]) ? { name: firstAttr(attrs, ["Name"]) } : {}),
    attributes: attrs,
    blocks: toArray(child(node, "Block")).map(reviewBlock),
    inputRefs: toArray(child(node, "IRef")).map(reviewRef),
    outputRefs: toArray(child(node, "ORef")).map(reviewRef),
    wires: [...toArray(child(node, "Wire")).map(reviewWire), ...toArray(child(node, "FeedbackWire")).map(reviewWire)],
    textBoxes: [...toArray(child(node, "TextBox")).map(reviewTextBox), ...toArray(child(node, "Text")).map(reviewTextBox)],
    unknownElements,
  };
}

function elementSubject(kind: string, id?: string, fallback?: string): string {
  return `${kind}${id ? ` ${id}` : fallback ? ` ${fallback}` : ""}`.trim();
}

function addDiagnostic(
  diagnostics: FbdReviewDiagnostic[],
  diagnostic: FbdReviewDiagnostic,
): void {
  diagnostics.push(diagnostic);
}

function semanticDiagnosticsForSheets(sheets: readonly FbdReviewSheet[]): {
  diagnostics: FbdReviewDiagnostic[];
  unresolvedWireEndpointCount: number;
  duplicateElementIdCount: number;
  missingBlockTypeCount: number;
  missingRefOperandCount: number;
  missingParameterNameCount: number;
} {
  const diagnostics: FbdReviewDiagnostic[] = [];
  let unresolvedWireEndpointCount = 0;
  let duplicateElementIdCount = 0;
  let missingBlockTypeCount = 0;
  let missingRefOperandCount = 0;
  let missingParameterNameCount = 0;

  for (const sheet of sheets) {
    const sheetNumber = sheet.number;
    const knownIds = new Set<string>();
    const idCounts = new Map<string, number>();
    const noteId = (id: string | undefined): void => {
      if (!id) return;
      knownIds.add(id);
      idCounts.set(id, (idCounts.get(id) ?? 0) + 1);
    };

    for (const block of sheet.blocks) noteId(block.id);
    for (const block of sheet.blocks) {
      for (const parameter of block.parameters) noteId(parameter.id);
    }
    for (const ref of sheet.inputRefs) noteId(ref.id);
    for (const ref of sheet.outputRefs) noteId(ref.id);
    for (const textBox of sheet.textBoxes) noteId(textBox.id);
    for (const element of sheet.unknownElements) noteId(idFromAttrs(element.attributes));

    for (const [id, count] of idCounts) {
      if (count <= 1) continue;
      duplicateElementIdCount += count - 1;
      addDiagnostic(diagnostics, {
        severity: "warning",
        code: "duplicate-element-id",
        sheetNumber,
        subject: id,
        message: `FBD sheet ${sheetNumber ?? "-"} imports duplicate element id ${id}; wire/reference review may be ambiguous.`,
      });
    }

    for (const block of sheet.blocks) {
      if (!block.typeImported) {
        missingBlockTypeCount += 1;
        addDiagnostic(diagnostics, {
          severity: "warning",
          code: "missing-block-type",
          sheetNumber,
          subject: elementSubject("Block", block.id),
          message: `FBD block ${block.id ?? "-"} on sheet ${sheetNumber ?? "-"} has no imported Type/Instruction/Name metadata.`,
        });
      }
      if (!block.operand) {
        addDiagnostic(diagnostics, {
          severity: "info",
          code: "block-without-operand",
          sheetNumber,
          subject: elementSubject(block.type, block.id),
          message: `FBD block ${block.type}${block.id ? ` (${block.id})` : ""} has no Operand/Tag/Instance metadata; pins and parameters remain preserved as imported attributes.`,
        });
      }
      for (const parameter of block.parameters) {
        if (parameter.name) continue;
        missingParameterNameCount += 1;
        addDiagnostic(diagnostics, {
          severity: "warning",
          code: "missing-parameter-name",
          sheetNumber,
          subject: elementSubject(`${block.type} parameter`, parameter.id, parameter.value),
          message: `FBD ${parameter.direction} parameter on block ${block.type}${block.id ? ` (${block.id})` : ""} has no imported parameter name metadata.`,
        });
      }
    }

    for (const [kind, refs] of [
      ["input reference", sheet.inputRefs],
      ["output reference", sheet.outputRefs],
    ] as const) {
      for (const ref of refs) {
        if (ref.operand) continue;
        missingRefOperandCount += 1;
        addDiagnostic(diagnostics, {
          severity: "warning",
          code: "missing-reference-operand",
          sheetNumber,
          subject: elementSubject(kind, ref.id),
          message: `FBD ${kind} ${ref.id ?? "-"} on sheet ${sheetNumber ?? "-"} has no imported operand metadata.`,
        });
      }
    }

    for (const wire of sheet.wires) {
      const wireSubject = elementSubject("Wire", wire.id);
      const hasFrom = Boolean(wire.fromId || wire.fromOperand);
      const hasTo = Boolean(wire.toId || wire.toOperand);
      if (!hasFrom || !hasTo) {
        addDiagnostic(diagnostics, {
          severity: "warning",
          code: "missing-wire-endpoint",
          sheetNumber,
          subject: wireSubject,
          message: `FBD wire ${wire.id ?? "-"} on sheet ${sheetNumber ?? "-"} is missing imported ${!hasFrom && !hasTo ? "source and destination" : !hasFrom ? "source" : "destination"} endpoint metadata.`,
        });
      }
      for (const [label, id] of [
        ["source", wire.fromId],
        ["destination", wire.toId],
      ] as const) {
        if (!id || knownIds.has(id)) continue;
        unresolvedWireEndpointCount += 1;
        addDiagnostic(diagnostics, {
          severity: "warning",
          code: "unresolved-wire-endpoint",
          sheetNumber,
          subject: wireSubject,
          message: `FBD wire ${wire.id ?? "-"} on sheet ${sheetNumber ?? "-"} references unknown ${label} endpoint id ${id}.`,
        });
      }
    }
  }

  return {
    diagnostics,
    unresolvedWireEndpointCount,
    duplicateElementIdCount,
    missingBlockTypeCount,
    missingRefOperandCount,
    missingParameterNameCount,
  };
}

export function reviewFbdRoutineSource(source: string): FbdRoutineReview {
  const { content, warnings } = sourceToFbdContent(source);
  if (!content) return emptyReview(warnings);

  const directSheets = toArray(child(content, "Sheet"));
  const sheetNodes = directSheets.length ? directSheets : [content];
  const sheets = sheetNodes.map(reviewSheet);
  const blockTypes = new Map<string, number>();
  const unknownElementNames = new Map<string, number>();
  const semantic = semanticDiagnosticsForSheets(sheets);
  const summary = sheets.reduce(
    (current, sheet) => {
      let connectedWireCount = 0;
      let wireEndpointGapCount = 0;
      for (const block of sheet.blocks) increment(blockTypes, block.type || "Block");
      for (const element of sheet.unknownElements) increment(unknownElementNames, element.name);
      for (const wire of sheet.wires) {
        const hasFrom = Boolean(wire.fromId || wire.fromOperand);
        const hasTo = Boolean(wire.toId || wire.toOperand);
        if (hasFrom && hasTo) connectedWireCount += 1;
        else wireEndpointGapCount += 1;
      }
      return {
        sheetCount: current.sheetCount + 1,
        blockCount: current.blockCount + sheet.blocks.length,
        inputRefCount: current.inputRefCount + sheet.inputRefs.length,
        outputRefCount: current.outputRefCount + sheet.outputRefs.length,
        wireCount: current.wireCount + sheet.wires.length,
        connectedWireCount: current.connectedWireCount + connectedWireCount,
        wireEndpointGapCount: current.wireEndpointGapCount + wireEndpointGapCount,
        unresolvedWireEndpointCount: current.unresolvedWireEndpointCount,
        duplicateElementIdCount: current.duplicateElementIdCount,
        missingBlockTypeCount: current.missingBlockTypeCount,
        missingRefOperandCount: current.missingRefOperandCount,
        parameterCount: current.parameterCount + sheet.blocks.reduce((sum, block) => sum + block.parameters.length, 0),
        inputParameterCount: current.inputParameterCount + sheet.blocks.reduce((sum, block) => sum + block.parameters.filter((parameter) => parameter.direction === "input").length, 0),
        outputParameterCount: current.outputParameterCount + sheet.blocks.reduce((sum, block) => sum + block.parameters.filter((parameter) => parameter.direction === "output").length, 0),
        inOutParameterCount: current.inOutParameterCount + sheet.blocks.reduce((sum, block) => sum + block.parameters.filter((parameter) => parameter.direction === "inout").length, 0),
        unknownParameterCount: current.unknownParameterCount + sheet.blocks.reduce((sum, block) => sum + block.parameters.filter((parameter) => parameter.direction === "unknown").length, 0),
        missingParameterNameCount: current.missingParameterNameCount,
        diagnosticCount: current.diagnosticCount,
        diagnosticWarningCount: current.diagnosticWarningCount,
        textCount: current.textCount + sheet.textBoxes.length,
        unknownElementCount: current.unknownElementCount + sheet.unknownElements.length,
        blockTypes: current.blockTypes,
        unknownElementNames: current.unknownElementNames,
      };
    },
    {
      sheetCount: 0,
      blockCount: 0,
      inputRefCount: 0,
      outputRefCount: 0,
      wireCount: 0,
      connectedWireCount: 0,
      wireEndpointGapCount: 0,
      unresolvedWireEndpointCount: 0,
      duplicateElementIdCount: 0,
      missingBlockTypeCount: 0,
      missingRefOperandCount: 0,
      parameterCount: 0,
      inputParameterCount: 0,
      outputParameterCount: 0,
      inOutParameterCount: 0,
      unknownParameterCount: 0,
      missingParameterNameCount: 0,
      diagnosticCount: 0,
      diagnosticWarningCount: 0,
      textCount: 0,
      unknownElementCount: 0,
      blockTypes: [] as FbdReviewCountRow[],
      unknownElementNames: [] as FbdReviewCountRow[],
    },
  );
  summary.unresolvedWireEndpointCount = semantic.unresolvedWireEndpointCount;
  summary.duplicateElementIdCount = semantic.duplicateElementIdCount;
  summary.missingBlockTypeCount = semantic.missingBlockTypeCount;
  summary.missingRefOperandCount = semantic.missingRefOperandCount;
  summary.missingParameterNameCount = semantic.missingParameterNameCount;
  summary.diagnosticCount = semantic.diagnostics.length;
  summary.diagnosticWarningCount = semantic.diagnostics.filter((diagnostic) => diagnostic.severity === "warning").length;
  summary.blockTypes = topReviewRows(blockTypes);
  summary.unknownElementNames = topReviewRows(unknownElementNames);
  if (summary.unknownElementCount > 0) {
    warnings.push(`${summary.unknownElementCount} unrecognized FBD element(s) preserved for source review.`);
  }
  if (summary.wireEndpointGapCount > 0) {
    warnings.push(`${summary.wireEndpointGapCount} FBD wire(s) are missing imported endpoint metadata.`);
  }
  if (summary.unresolvedWireEndpointCount > 0) {
    warnings.push(`${summary.unresolvedWireEndpointCount} FBD wire endpoint reference(s) did not resolve to imported sheet elements.`);
  }
  if (summary.duplicateElementIdCount > 0) {
    warnings.push(`${summary.duplicateElementIdCount} duplicate FBD element id occurrence(s) may make wire review ambiguous.`);
  }
  if (summary.missingRefOperandCount > 0) {
    warnings.push(`${summary.missingRefOperandCount} FBD input/output reference(s) are missing operand metadata.`);
  }
  if (summary.missingParameterNameCount > 0) {
    warnings.push(`${summary.missingParameterNameCount} FBD block parameter(s) are missing imported name metadata.`);
  }

  return {
    language: "function-block",
    modelOnly: true,
    executable: false,
    parseable: true,
    boundary: FBD_BOUNDARY,
    ...(attr(content, "SheetSize") ? { sheetSize: attr(content, "SheetSize") } : {}),
    summary,
    sheets,
    diagnostics: semantic.diagnostics,
    warnings,
  };
}
