import { arrayDimensionsOf, memberDefs, type Controller, type PlcProject, type Tag } from "@esco/core";

export type TagEngineeringUnitReviewStatus = "reviewable" | "needs-attention";

export type TagEngineeringUnitReviewIssue =
  | "blank-unit-text"
  | "duplicate-unit-operand"
  | "invalid-unit-operand"
  | "array-index-on-scalar"
  | "array-dimension-mismatch"
  | "array-index-out-of-range"
  | "member-not-structured"
  | "unknown-member";

export type TagEngineeringUnitReviewBoundary =
  | "no-controller-communication"
  | "no-engineering-unit-conversion"
  | "no-online-tag-property-edit"
  | "no-controller-download"
  | "no-live-display-formatting";

export type EngineeringUnitFamily =
  | "temperature"
  | "pressure"
  | "flow"
  | "length"
  | "mass"
  | "volume"
  | "power"
  | "rotation-rate"
  | "frequency"
  | "percentage"
  | "electrical-current"
  | "electrical-voltage";

export type EngineeringUnitConversionFailure =
  | "unknown-from-unit"
  | "unknown-to-unit"
  | "incompatible-unit-family"
  | "non-numeric-value";

export interface EngineeringUnitDescriptor {
  key: string;
  display: string;
  family: EngineeringUnitFamily;
  precision: number;
}

export interface EngineeringUnitFormatResult {
  ok: boolean;
  value?: number;
  text?: string;
  unit?: EngineeringUnitDescriptor;
  reason?: "unknown-unit" | "non-numeric-value";
}

export interface EngineeringUnitConversionResult {
  ok: boolean;
  value?: number;
  text?: string;
  fromUnit?: EngineeringUnitDescriptor;
  toUnit?: EngineeringUnitDescriptor;
  reason?: EngineeringUnitConversionFailure;
}

export interface TagEngineeringUnitReviewRow {
  controllerId: string;
  controllerName: string;
  programId?: string;
  programName?: string;
  tagId: string;
  tagName: string;
  tagScope: Tag["scope"];
  tagDataType: string;
  operand: string;
  path: string;
  unitText: string;
  status: TagEngineeringUnitReviewStatus;
  issues: TagEngineeringUnitReviewIssue[];
  normalizedUnitText?: string;
  engineeringUnitFamily?: EngineeringUnitFamily;
  formatPreview?: string;
  conversionPreview?: string;
  conversionTargetUnits: string[];
  engineeringUnitConversionModelled: boolean;
  onlineTagPropertyEditModelled: false;
  controllerDownloadModelled: false;
  liveDisplayFormattingModelled: boolean;
  boundaries: TagEngineeringUnitReviewBoundary[];
  message: string;
}

export interface TagEngineeringUnitReviewReport {
  rows: TagEngineeringUnitReviewRow[];
  rowCount: number;
  tagWithUnitsCount: number;
  controllerScopeUnitCount: number;
  programScopeUnitCount: number;
  tagLevelUnitCount: number;
  memberOrElementUnitCount: number;
  issueCount: number;
  blankUnitTextCount: number;
  duplicateOperandCount: number;
  invalidOperandCount: number;
  knownUnitCount: number;
  unknownUnitTextCount: number;
  engineeringUnitConversionModelledCount: number;
  liveDisplayFormattingModelledCount: number;
  warnings: string[];
}

interface MemberInfo {
  dataType: string;
  dimensions?: number[];
}

interface NamedMemberInfo extends MemberInfo {
  name: string;
}

type UnitMath = EngineeringUnitDescriptor & {
  aliases: string[];
  toBase: (value: number) => number;
  fromBase: (value: number) => number;
};

const UNIT_DEFINITIONS: UnitMath[] = [
  unit("degc", "degC", "temperature", 2, ["c", "celsius"], (value) => value, (value) => value),
  unit("degf", "degF", "temperature", 2, ["f", "fahrenheit"], (value) => (value - 32) * 5 / 9, (value) => value * 9 / 5 + 32),
  unit("k", "K", "temperature", 2, ["kelvin"], (value) => value - 273.15, (value) => value + 273.15),
  unit("psi", "psi", "pressure", 2, ["psig"], (value) => value * 6894.757293168, (value) => value / 6894.757293168),
  unit("bar", "bar", "pressure", 3, [], (value) => value * 100000, (value) => value / 100000),
  unit("kpa", "kPa", "pressure", 2, [], (value) => value * 1000, (value) => value / 1000),
  unit("pa", "Pa", "pressure", 0, [], (value) => value, (value) => value),
  unit("lpm", "L/min", "flow", 2, ["l/min", "liter/min", "liters/min", "lmin"], (value) => value, (value) => value),
  unit("gpm", "gpm", "flow", 2, ["gal/min", "gallon/min", "gallons/min"], (value) => value * 3.785411784, (value) => value / 3.785411784),
  unit("m3h", "m3/h", "flow", 2, ["m^3/h", "m3/hr"], (value) => value * 1000 / 60, (value) => value * 60 / 1000),
  unit("mm", "mm", "length", 2, [], (value) => value / 1000, (value) => value * 1000),
  unit("cm", "cm", "length", 2, [], (value) => value / 100, (value) => value * 100),
  unit("m", "m", "length", 3, ["meter", "meters"], (value) => value, (value) => value),
  unit("in", "in", "length", 3, ["inch", "inches"], (value) => value * 0.0254, (value) => value / 0.0254),
  unit("ft", "ft", "length", 3, ["feet"], (value) => value * 0.3048, (value) => value / 0.3048),
  unit("g", "g", "mass", 2, ["gram", "grams"], (value) => value / 1000, (value) => value * 1000),
  unit("kg", "kg", "mass", 3, ["kilogram", "kilograms"], (value) => value, (value) => value),
  unit("lb", "lb", "mass", 3, ["lbs", "pound", "pounds"], (value) => value * 0.45359237, (value) => value / 0.45359237),
  unit("l", "L", "volume", 2, ["liter", "liters"], (value) => value, (value) => value),
  unit("gal", "gal", "volume", 2, ["gallon", "gallons"], (value) => value * 3.785411784, (value) => value / 3.785411784),
  unit("kw", "kW", "power", 2, ["kilowatt", "kilowatts"], (value) => value, (value) => value),
  unit("hp", "hp", "power", 2, ["horsepower"], (value) => value * 0.745699872, (value) => value / 0.745699872),
  unit("rpm", "rpm", "frequency", 1, ["rev/min"], (value) => value / 60, (value) => value * 60),
  unit("hz", "Hz", "frequency", 2, ["hertz"], (value) => value, (value) => value),
  unit("percent", "%", "percentage", 1, ["%", "pct", "percentage"], (value) => value, (value) => value),
  unit("a", "A", "electrical-current", 2, ["amp", "amps", "ampere", "amperes"], (value) => value, (value) => value),
  unit("v", "V", "electrical-voltage", 2, ["volt", "volts"], (value) => value, (value) => value),
];

const UNIT_LOOKUP = new Map<string, UnitMath>(
  UNIT_DEFINITIONS.flatMap((definition) => [
    [normalizeUnitKey(definition.key), definition] as const,
    [normalizeUnitKey(definition.display), definition] as const,
    ...definition.aliases.map((alias) => [normalizeUnitKey(alias), definition] as const),
  ]),
);

const SAMPLE_BY_FAMILY: Record<EngineeringUnitFamily, number> = {
  temperature: 25,
  pressure: 12.345,
  flow: 10,
  length: 1,
  mass: 5,
  volume: 20,
  power: 7.5,
  "rotation-rate": 60,
  frequency: 60,
  percentage: 50,
  "electrical-current": 4.2,
  "electrical-voltage": 24,
};

const CONVERSION_TARGETS: Record<string, string[]> = {
  degc: ["degf", "k"],
  degf: ["degc", "k"],
  k: ["degc", "degf"],
  psi: ["bar", "kpa"],
  bar: ["psi", "kpa"],
  kpa: ["psi", "bar"],
  pa: ["kpa", "psi"],
  lpm: ["gpm", "m3h"],
  gpm: ["lpm", "m3h"],
  m3h: ["lpm", "gpm"],
  mm: ["in", "m"],
  cm: ["in", "m"],
  m: ["ft", "in"],
  in: ["mm", "ft"],
  ft: ["m", "in"],
  g: ["kg", "lb"],
  kg: ["lb", "g"],
  lb: ["kg", "g"],
  l: ["gal"],
  gal: ["l"],
  kw: ["hp"],
  hp: ["kw"],
  rpm: ["hz"],
  hz: ["rpm"],
};

function unit(
  key: string,
  display: string,
  family: EngineeringUnitFamily,
  precision: number,
  aliases: string[],
  toBase: (value: number) => number,
  fromBase: (value: number) => number,
): UnitMath {
  return { key, display, family, precision, aliases, toBase, fromBase };
}

function normalizeUnitKey(value: string): string {
  return value
    .trim()
    .replace(/\u00b0/g, "deg")
    .replace(/\s+/g, "")
    .replace(/_/g, "")
    .toLowerCase();
}

function asFiniteNumber(value: unknown): number | undefined {
  const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value.trim()) : Number.NaN;
  return Number.isFinite(numeric) ? numeric : undefined;
}

function formatNumber(value: number, precision: number): string {
  return value.toFixed(precision);
}

function unitTargets(unit: UnitMath): UnitMath[] {
  const preferred = CONVERSION_TARGETS[unit.key] ?? [];
  const targets = preferred
    .map((target) => UNIT_LOOKUP.get(normalizeUnitKey(target)))
    .filter((target): target is UnitMath => !!target && target.family === unit.family && target.key !== unit.key);
  if (targets.length > 0) return targets;
  return UNIT_DEFINITIONS.filter((target) => target.family === unit.family && target.key !== unit.key).slice(0, 2);
}

export function normalizeEngineeringUnit(unitText: string): EngineeringUnitDescriptor | undefined {
  const unit = UNIT_LOOKUP.get(normalizeUnitKey(unitText));
  if (!unit) return undefined;
  const { key, display, family, precision } = unit;
  return { key, display, family, precision };
}

export function formatEngineeringUnitValue(value: unknown, unitText: string): EngineeringUnitFormatResult {
  const numeric = asFiniteNumber(value);
  if (numeric == null) return { ok: false, reason: "non-numeric-value" };
  const unit = UNIT_LOOKUP.get(normalizeUnitKey(unitText));
  if (!unit) return { ok: false, value: numeric, reason: "unknown-unit" };
  return {
    ok: true,
    value: numeric,
    unit: normalizeEngineeringUnit(unit.display),
    text: `${formatNumber(numeric, unit.precision)} ${unit.display}`,
  };
}

export function convertEngineeringUnitValue(
  value: unknown,
  fromUnitText: string,
  toUnitText: string,
): EngineeringUnitConversionResult {
  const numeric = asFiniteNumber(value);
  if (numeric == null) return { ok: false, reason: "non-numeric-value" };
  const fromUnit = UNIT_LOOKUP.get(normalizeUnitKey(fromUnitText));
  if (!fromUnit) return { ok: false, reason: "unknown-from-unit" };
  const toUnit = UNIT_LOOKUP.get(normalizeUnitKey(toUnitText));
  if (!toUnit) return { ok: false, fromUnit: normalizeEngineeringUnit(fromUnit.display), reason: "unknown-to-unit" };
  if (fromUnit.family !== toUnit.family) {
    return {
      ok: false,
      fromUnit: normalizeEngineeringUnit(fromUnit.display),
      toUnit: normalizeEngineeringUnit(toUnit.display),
      reason: "incompatible-unit-family",
    };
  }
  const converted = toUnit.fromBase(fromUnit.toBase(numeric));
  return {
    ok: true,
    value: converted,
    fromUnit: normalizeEngineeringUnit(fromUnit.display),
    toUnit: normalizeEngineeringUnit(toUnit.display),
    text: `${formatNumber(converted, toUnit.precision)} ${toUnit.display}`,
  };
}

const IDENT = "[A-Za-z_][A-Za-z0-9_]*";

function blank(value: string | undefined): boolean {
  return value == null || value.trim() === "";
}

function unitPath(tagName: string, operand: string): string {
  const trimmed = operand.trim();
  if (!trimmed) return tagName;
  if (trimmed.startsWith(".") || trimmed.startsWith("[")) return `${tagName}${trimmed}`;
  return `${tagName}.${trimmed}`;
}

function parseIndexList(raw: string): number[] | undefined {
  const indices = raw.split(",").map((part) => Number(part.trim()));
  if (!indices.every((index) => Number.isInteger(index) && index >= 0)) return undefined;
  return indices;
}

function consumeLeadingIndex(value: string): { indices: number[]; rest: string } | undefined {
  const match = value.match(/^\[([^\]]+)](.*)$/);
  if (!match) return undefined;
  const indices = parseIndexList(match[1]!);
  if (!indices) return undefined;
  return { indices, rest: match[2] ?? "" };
}

function parseMemberSegment(segment: string): { name: string; indices?: number[] } | undefined {
  const match = segment.match(new RegExp(`^(${IDENT})(?:\\[([^\\]]+)])?$`));
  if (!match) return undefined;
  const indices = match[2] != null ? parseIndexList(match[2]) : undefined;
  if (match[2] != null && !indices) return undefined;
  return {
    name: match[1]!,
    ...(indices ? { indices } : {}),
  };
}

function checkIndices(
  indices: readonly number[],
  dimensions: readonly number[] | undefined,
): TagEngineeringUnitReviewIssue[] {
  if (!dimensions || dimensions.length === 0) return ["array-index-on-scalar"];
  if (indices.length !== dimensions.length) return ["array-dimension-mismatch"];
  return indices.some((index, position) => index >= dimensions[position]!) ? ["array-index-out-of-range"] : [];
}

function memberInfoByType(controller: Controller): Map<string, Map<string, MemberInfo>> {
  const result = new Map<string, Map<string, MemberInfo>>();
  const add = (type: string, members: NamedMemberInfo[]) => {
    result.set(type, new Map(members.map((member) => [member.name, member])));
  };

  for (const type of ["TIMER", "COUNTER", "CONTROL", "MESSAGE", "PID", "PIDE", "ALARM_ANALOG", "ALARM_DIGITAL", "MOTION_INSTRUCTION", "EQUIPMENT_PHASE", "PHASE_INSTRUCTION"]) {
    add(type, memberDefs(type).map((member) => ({ name: member.name, dataType: member.type })));
  }
  for (const udt of controller.dataTypes) {
    add(
      udt.name,
      udt.members.map((member) => ({
        name: member.name,
        dataType: member.dataType,
        ...(arrayDimensionsOf(member).length > 0 ? { dimensions: arrayDimensionsOf(member) } : {}),
      })),
    );
  }
  for (const aoi of controller.addOnInstructions) {
    add(aoi.name, [
      ...aoi.parameters.map((parameter) => ({
        name: parameter.name,
        dataType: parameter.dataType,
        ...(arrayDimensionsOf(parameter).length > 0 ? { dimensions: arrayDimensionsOf(parameter) } : {}),
      })),
      ...aoi.localTags.map((localTag) => ({
        name: localTag.name,
        dataType: localTag.dataType,
        ...(arrayDimensionsOf(localTag).length > 0 ? { dimensions: arrayDimensionsOf(localTag) } : {}),
      })),
    ]);
  }
  return result;
}

function operandIssues(
  tag: Tag,
  operand: string,
  membersByType: Map<string, Map<string, MemberInfo>>,
): TagEngineeringUnitReviewIssue[] {
  let rest = operand.trim();
  const issues: TagEngineeringUnitReviewIssue[] = [];
  if (!rest) return issues;

  let currentType = tag.dataType;
  if (rest.startsWith("[")) {
    const indexed = consumeLeadingIndex(rest);
    if (!indexed) return ["invalid-unit-operand"];
    issues.push(...checkIndices(indexed.indices, arrayDimensionsOf(tag)));
    rest = indexed.rest;
    if (!rest) return issues;
  }

  if (!rest.startsWith(".")) return ["invalid-unit-operand"];
  const segments = rest.slice(1).split(".");
  if (segments.some((segment) => segment.trim() === "")) return ["invalid-unit-operand"];

  for (const segment of segments) {
    const parsed = parseMemberSegment(segment);
    if (!parsed) {
      issues.push("invalid-unit-operand");
      break;
    }
    const members = membersByType.get(currentType);
    if (!members) {
      issues.push("member-not-structured");
      break;
    }
    const member = members.get(parsed.name);
    if (!member) {
      issues.push("unknown-member");
      break;
    }
    if (parsed.indices) issues.push(...checkIndices(parsed.indices, member.dimensions));
    currentType = member.dataType;
  }
  return [...new Set(issues)];
}

function issueLabel(issue: TagEngineeringUnitReviewIssue): string {
  switch (issue) {
    case "blank-unit-text":
      return "blank engineering-unit text";
    case "duplicate-unit-operand":
      return "duplicate engineering-unit operand";
    case "invalid-unit-operand":
      return "invalid engineering-unit operand";
    case "array-index-on-scalar":
      return "engineering-unit operand indexes a scalar";
    case "array-dimension-mismatch":
      return "engineering-unit operand subscript count does not match dimensions";
    case "array-index-out-of-range":
      return "engineering-unit operand index is out of range";
    case "member-not-structured":
      return "engineering-unit operand uses a member on a non-structured type";
    case "unknown-member":
      return "engineering-unit operand names an unknown member";
  }
}

function modelBoundaries(input: {
  engineeringUnitConversionModelled: boolean;
  liveDisplayFormattingModelled: boolean;
}): TagEngineeringUnitReviewBoundary[] {
  return [
    "no-controller-communication",
    ...(input.engineeringUnitConversionModelled ? [] : ["no-engineering-unit-conversion" as const]),
    "no-online-tag-property-edit",
    "no-controller-download",
    ...(input.liveDisplayFormattingModelled ? [] : ["no-live-display-formatting" as const]),
  ];
}

function messageFor(row: Omit<TagEngineeringUnitReviewRow, "message">): string {
  if (row.issues.length) {
    return `Engineering unit "${row.path}" needs attention: ${row.issues.map(issueLabel).join("; ")}.`;
  }
  const blocked = "Online tag-property edits, controller download, and controller communication remain blocked.";
  if (row.liveDisplayFormattingModelled && row.engineeringUnitConversionModelled) {
    return `Engineering unit "${row.path}" is reviewable offline; local display formatting and unit conversion are modelled (${row.conversionPreview}). ${blocked}`;
  }
  if (row.liveDisplayFormattingModelled) {
    return `Engineering unit "${row.path}" is reviewable offline; local display formatting is modelled (${row.formatPreview}) and no compatible conversion target is available. ${blocked}`;
  }
  return `Engineering unit "${row.path}" is preserved for review; ESCO does not recognize "${row.unitText || "<blank>"}" for offline formatting or conversion. ${blocked}`;
}

function rowFor(input: {
  controller: Controller;
  tag: Tag;
  programId?: string;
  programName?: string;
  operand: string;
  unitText: string;
  duplicate: boolean;
  membersByType: Map<string, Map<string, MemberInfo>>;
}): TagEngineeringUnitReviewRow {
  const issues = operandIssues(input.tag, input.operand, input.membersByType);
  if (blank(input.unitText)) issues.unshift("blank-unit-text");
  if (input.duplicate) issues.unshift("duplicate-unit-operand");
  const uniqueIssues = [...new Set(issues)];
  const unit = uniqueIssues.length ? undefined : UNIT_LOOKUP.get(normalizeUnitKey(input.unitText));
  const sampleValue = unit ? SAMPLE_BY_FAMILY[unit.family] : undefined;
  const formatPreview = unit && sampleValue != null ? formatEngineeringUnitValue(sampleValue, unit.display).text : undefined;
  const conversionTargets = unit ? unitTargets(unit).slice(0, 2) : [];
  const conversionPreview =
    unit && sampleValue != null && conversionTargets.length
      ? `${formatNumber(sampleValue, unit.precision)} ${unit.display} -> ${conversionTargets
          .map((target) => convertEngineeringUnitValue(sampleValue, unit.display, target.display).text)
          .filter((text): text is string => !!text)
          .join(" / ")}`
      : undefined;
  const liveDisplayFormattingModelled = !!formatPreview;
  const engineeringUnitConversionModelled = !!conversionPreview;
  const rowBase = {
    controllerId: input.controller.id,
    controllerName: input.controller.name,
    programId: input.programId,
    programName: input.programName,
    tagId: input.tag.id,
    tagName: input.tag.name,
    tagScope: input.tag.scope,
    tagDataType: input.tag.dataType,
    operand: input.operand,
    path: unitPath(input.tag.name, input.operand),
    unitText: input.unitText,
    status: uniqueIssues.length ? "needs-attention" as const : "reviewable" as const,
    issues: uniqueIssues,
    ...(unit ? {
      normalizedUnitText: unit.display,
      engineeringUnitFamily: unit.family,
    } : {}),
    ...(formatPreview ? { formatPreview } : {}),
    ...(conversionPreview ? { conversionPreview } : {}),
    conversionTargetUnits: conversionTargets.map((target) => target.display),
    engineeringUnitConversionModelled,
    onlineTagPropertyEditModelled: false as const,
    controllerDownloadModelled: false as const,
    liveDisplayFormattingModelled,
    boundaries: modelBoundaries({ engineeringUnitConversionModelled, liveDisplayFormattingModelled }),
  };
  return { ...rowBase, message: messageFor(rowBase) };
}

function tagRows(input: {
  controller: Controller;
  tag: Tag;
  programId?: string;
  programName?: string;
  membersByType: Map<string, Map<string, MemberInfo>>;
}): TagEngineeringUnitReviewRow[] {
  const units = input.tag.engineeringUnits ?? [];
  const counts = new Map<string, number>();
  for (const unit of units) {
    const key = unit.operand.trim().toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return units.map((unit) =>
    rowFor({
      ...input,
      operand: unit.operand,
      unitText: unit.text,
      duplicate: (counts.get(unit.operand.trim().toLowerCase()) ?? 0) > 1,
    }),
  );
}

export function tagEngineeringUnitReviewReport(project: PlcProject): TagEngineeringUnitReviewReport {
  const rows: TagEngineeringUnitReviewRow[] = [];
  const tagsWithUnits = new Set<string>();

  for (const controller of project.controllers) {
    const membersByType = memberInfoByType(controller);
    for (const tag of controller.controllerTags) {
      if (tag.engineeringUnits?.length) tagsWithUnits.add(tag.id);
      rows.push(...tagRows({ controller, tag, membersByType }));
    }
    for (const program of controller.programs) {
      for (const tag of program.programTags) {
        if (tag.engineeringUnits?.length) tagsWithUnits.add(tag.id);
        rows.push(...tagRows({ controller, tag, programId: program.id, programName: program.name, membersByType }));
      }
    }
  }

  const hasIssue = (issue: TagEngineeringUnitReviewIssue) =>
    rows.filter((row) => row.issues.includes(issue)).length;
  return {
    rows,
    rowCount: rows.length,
    tagWithUnitsCount: tagsWithUnits.size,
    controllerScopeUnitCount: rows.filter((row) => row.tagScope === "controller").length,
    programScopeUnitCount: rows.filter((row) => row.tagScope === "program").length,
    tagLevelUnitCount: rows.filter((row) => row.operand.trim() === "").length,
    memberOrElementUnitCount: rows.filter((row) => row.operand.trim() !== "").length,
    issueCount: rows.filter((row) => row.issues.length > 0).length,
    blankUnitTextCount: hasIssue("blank-unit-text"),
    duplicateOperandCount: hasIssue("duplicate-unit-operand"),
    invalidOperandCount:
      hasIssue("invalid-unit-operand") +
      hasIssue("array-index-on-scalar") +
      hasIssue("array-dimension-mismatch") +
      hasIssue("array-index-out-of-range") +
      hasIssue("member-not-structured") +
      hasIssue("unknown-member"),
    knownUnitCount: rows.filter((row) => !!row.normalizedUnitText).length,
    unknownUnitTextCount: rows.filter((row) => !row.issues.length && !row.normalizedUnitText).length,
    engineeringUnitConversionModelledCount: rows.filter((row) => row.engineeringUnitConversionModelled).length,
    liveDisplayFormattingModelledCount: rows.filter((row) => row.liveDisplayFormattingModelled).length,
    warnings: rows.filter((row) => row.issues.length > 0).map((row) => row.message),
  };
}
