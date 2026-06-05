import type {
  AddOnInstruction,
  Controller,
  ControllerCommPorts,
  ControllerEthernetConfig,
  ControllerTrend,
  IoModule,
  PlcProject,
  Program,
  ProgramParameter,
  ProgramParameterConnection,
  QuickWatchList,
  Routine,
  RoutineLanguage,
  Tag,
  Task,
  UserDefinedType,
} from "@esco/core";
import { createDefaultRegistry, type InstructionRegistry } from "@esco/instructions";
import { routineNodes, rungToText, type LadderRoutine, type LadderRung } from "@esco/ladder";
import { l5xDimensions } from "./dimensions";

export interface ExportInterchangeEvidence {
  format: "L5X";
  rootElement: "RSLogix5000Content";
  contentType: "Controller";
  exportName: "ESCO Automation Studio";
  targetName: string;
  exportDate: string;
  generatedOffline: true;
  proprietaryBinaryTouched: false;
  generatedNotice: string;
}

export interface ExportL5XResult {
  /** The generated `.L5X` XML text (a newly generated file). */
  xml: string;
  /** Human-readable notes about anything exported with caveats. */
  warnings: string[];
  /** Structured proof that this is offline L5X generation, not proprietary binary access. */
  evidence: ExportInterchangeEvidence;
}

/**
 * Embedded in every generated file so a reviewer always knows what it is. This
 * is not an original vendor export and is not controller-verified.
 */
const GENERATED_NOTICE =
  "Generated offline by ESCO Automation Studio. This is a newly generated, " +
  "best-effort .L5X for review only - not an original vendor export, not " +
  "controller-verified, and never written from or to a proprietary binary project file. No PLC " +
  "communication is involved. Review in a sandbox project before any use.";

/** Recognise a populated ladder routine stored in the loosely-typed `Routine.ladder`. */
function asLadderRoutine(ladder: unknown): LadderRoutine | undefined {
  if (ladder && typeof ladder === "object" && Array.isArray((ladder as { rungs?: unknown }).rungs)) {
    return ladder as LadderRoutine;
  }
  return undefined;
}

const ROUTINE_TYPE: Record<RoutineLanguage, string> = {
  ladder: "RLL",
  "structured-text": "ST",
  "function-block": "FBD",
  sfc: "SFC",
};

const ROUTINE_LABEL: Record<RoutineLanguage, string> = {
  ladder: "Ladder",
  "structured-text": "Structured Text",
  "function-block": "Function Block",
  sfc: "Sequential Function Chart",
};

const GRAPHICAL_CONTENT_TAG: Partial<Record<RoutineLanguage, string>> = {
  "function-block": "FBDContent",
  sfc: "SFCContent",
};

function taskTypeToL5X(type: Task["type"]): string {
  switch (type) {
    case "periodic":
      return "PERIODIC";
    case "event":
      return "EVENT";
    default:
      return "CONTINUOUS";
  }
}

type AttrValue = string | number | undefined;

/** A tiny, dependency-free, indenting XML writer. */
class XmlWriter {
  private parts: string[] = [];
  private depth = 0;

  private pad(): string {
    return "  ".repeat(this.depth);
  }

  private attrs(attrs: Record<string, AttrValue>): string {
    return Object.entries(attrs)
      .filter(([, value]) => value !== undefined && value !== null && value !== "")
      .map(([key, value]) => ` ${key}="${escapeAttr(String(value))}"`)
      .join("");
  }

  /** A literal line with no indentation (used for the XML prolog). */
  raw(line: string): void {
    this.parts.push(line);
  }

  /** Preformatted XML block indented at the current nesting level. */
  rawXmlBlock(value: string): void {
    for (const line of value.trim().split(/\r?\n/)) {
      this.parts.push(`${this.pad()}${line}`);
    }
  }

  comment(text: string): void {
    // `--` is illegal inside an XML comment; soften it defensively.
    this.parts.push(`${this.pad()}<!-- ${text.replace(/--/g, "—")} -->`);
  }

  open(tag: string, attrs: Record<string, AttrValue> = {}): void {
    this.parts.push(`${this.pad()}<${tag}${this.attrs(attrs)}>`);
    this.depth += 1;
  }

  close(tag: string): void {
    this.depth -= 1;
    this.parts.push(`${this.pad()}</${tag}>`);
  }

  /** A self-closing element with attributes only. */
  leaf(tag: string, attrs: Record<string, AttrValue> = {}): void {
    this.parts.push(`${this.pad()}<${tag}${this.attrs(attrs)}/>`);
  }

  /** An element whose body is CDATA text (Description / Comment / Text / Line). */
  cdataEl(tag: string, value: string, attrs: Record<string, AttrValue> = {}): void {
    this.parts.push(`${this.pad()}<${tag}${this.attrs(attrs)}>${cdata(value)}</${tag}>`);
  }

  /** An element whose body is plain, escaped text (e.g. SafetyTagMap). */
  textEl(tag: string, value: string, attrs: Record<string, AttrValue> = {}): void {
    this.parts.push(`${this.pad()}<${tag}${this.attrs(attrs)}>${escapeText(value)}</${tag}>`);
  }

  toString(): string {
    return `${this.parts.join("\n")}\n`;
  }
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function cdata(value: string): string {
  // Keep the CDATA well-formed even if the content contains the "]]>" sentinel.
  return `<![CDATA[${value.replace(/]]>/g, "]]]]><![CDATA[>")}]]>`;
}

function escapeText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;");
}

function writeDescription(xml: XmlWriter, description: string | undefined): void {
  if (description) xml.cdataEl("Description", description);
}

function tagType(tag: Tag): string {
  if (tag.aliasFor) return "Alias";
  if (tag.produced) return "Produced";
  if (tag.consumed) return "Consumed";
  return "Base";
}

/** Emit "true"/"false" only when the flag was imported; undefined is dropped. */
function boolAttr(value: boolean | undefined): string | undefined {
  return value === undefined ? undefined : value ? "true" : "false";
}

function externalAccess(value: Tag["externalAccess"]): string | undefined {
  switch (value) {
    case "read-write":
      return "Read/Write";
    case "read-only":
      return "Read Only";
    case "none":
      return "None";
    default:
      return undefined;
  }
}

function writeTags(xml: XmlWriter, tags: Tag[]): void {
  if (tags.length === 0) {
    xml.leaf("Tags");
    return;
  }
  xml.open("Tags");
  for (const tag of tags) {
    const attrs: Record<string, AttrValue> = {
      Name: tag.name,
      TagType: tagType(tag),
      DataType: tag.dataType,
      Dimensions: l5xDimensions(tag),
      AliasFor: tag.aliasFor,
      // Re-assert the imported display radix so it survives export -> import.
      Radix: tag.radix,
      Constant: tag.constant ? "true" : undefined,
      ExternalAccess: externalAccess(tag.externalAccess),
      // Re-assert the imported safety partition so it survives export -> import.
      Class: tag.safetyClass,
      // Re-assert the imported OPC UA accessibility so it survives export -> import.
      OpcUaAccess: tag.opcUaAccess,
    };
    const consume = tag.consumed ? tag.consumeInfo : undefined;
    const produce = tag.produced ? tag.produceInfo : undefined;
    const comments = tag.comments?.length ? tag.comments : undefined;
    const engineeringUnits = tag.engineeringUnits?.length ? tag.engineeringUnits : undefined;
    if (tag.description || consume || produce || comments || engineeringUnits) {
      xml.open("Tag", attrs);
      writeDescription(xml, tag.description);
      // Re-assert per-element/member comments so they survive export -> import
      // (the importer reads Comments/Comment Operand). Display-only metadata.
      if (comments) {
        xml.open("Comments");
        for (const comment of comments) {
          xml.cdataEl("Comment", comment.text, { Operand: comment.operand });
        }
        xml.close("Comments");
      }
      // Re-assert per-element/member engineering units so they survive
      // export -> import (the importer reads EngineeringUnits/EngineeringUnit
      // Operand). Display-only metadata.
      if (engineeringUnits) {
        xml.open("EngineeringUnits");
        for (const unit of engineeringUnits) {
          xml.cdataEl("EngineeringUnit", unit.text, { Operand: unit.operand });
        }
        xml.close("EngineeringUnits");
      }
      if (produce) {
        xml.leaf("ProduceInfo", {
          ProduceCount: produce.produceCount,
          UnicastPermitted: boolAttr(produce.unicastPermitted),
          ProgrammaticallySendEventTrigger: boolAttr(produce.programmaticallySendEventTrigger),
        });
      }
      if (consume) {
        xml.leaf("ConsumeInfo", {
          Producer: consume.producer,
          RemoteTag: consume.remoteTag,
          RemoteInstance: consume.remoteInstance,
          RPI: consume.rpi,
          Unicast: boolAttr(consume.unicast),
        });
      }
      xml.close("Tag");
    } else {
      xml.leaf("Tag", attrs);
    }
  }
  xml.close("Tags");
}

function writeRung(xml: XmlWriter, rung: LadderRung): void {
  xml.open("Rung", { Number: rung.number, Type: "N" });
  if (rung.comment) xml.cdataEl("Comment", rung.comment);
  // Trailing ';' matches Studio 5000 neutral text; the importer ignores it.
  xml.cdataEl("Text", `${rungToText(rung)};`);
  xml.close("Rung");
}

function hasGraphicalContentRoot(source: string | undefined, contentTag: string): boolean {
  if (!source) return false;
  const trimmed = source.trim();
  return new RegExp(`^<${contentTag}(\\s|>|/)`).test(trimmed);
}

function writeRoutine(
  xml: XmlWriter,
  routine: Routine,
  where: string,
  warnings: string[],
): void {
  const ladder = asLadderRoutine(routine.ladder);
  xml.open("Routine", { Name: routine.name, Type: ROUTINE_TYPE[routine.language] });
  writeDescription(xml, routine.description);

  if (ladder) {
    if (ladder.rungs.length === 0) {
      xml.leaf("RLLContent");
    } else {
      xml.open("RLLContent");
      for (const rung of [...ladder.rungs].sort((a, b) => a.number - b.number)) {
        writeRung(xml, rung);
      }
      xml.close("RLLContent");
    }
  } else if (routine.language === "structured-text") {
    // Preserve the source line-by-line so it round-trips through re-import (the
    // importer re-reads STContent <Line> elements). An empty ST routine still
    // emits <STContent/> and stays ST — it is never downgraded to a stub.
    if (routine.structuredText) {
      const lines = routine.structuredText.split(/\r?\n/);
      xml.open("STContent");
      lines.forEach((line, index) => xml.cdataEl("Line", line, { Number: index }));
      xml.close("STContent");
      warnings.push(
        where.startsWith("AOI ")
          ? `${where}: ${ROUTINE_LABEL[routine.language]} AOI body preserved as read-only imported text (not simulated).`
          : `${where}: ${ROUTINE_LABEL[routine.language]} source preserved; Offline Simulation covers a limited ST subset.`,
      );
    } else {
      xml.leaf("STContent");
    }
  } else if (routine.language !== "ladder") {
    const contentTag = GRAPHICAL_CONTENT_TAG[routine.language];
    if (contentTag && hasGraphicalContentRoot(routine.sourceText, contentTag)) {
      xml.rawXmlBlock(routine.sourceText!);
      warnings.push(
        `${where}: ${ROUTINE_LABEL[routine.language]} body preserved as read-only imported XML (not simulated).`,
      );
    } else {
      warnings.push(
        `${where}: ${ROUTINE_LABEL[routine.language]} routine exported as a stub (its body was not available in a serializable form).`,
      );
    }
  }

  xml.close("Routine");
}

function writeRoutines(xml: XmlWriter, routines: Routine[], program: string, warnings: string[]): void {
  if (routines.length === 0) {
    xml.leaf("Routines");
    return;
  }
  xml.open("Routines");
  for (const routine of routines) {
    writeRoutine(xml, routine, `${program}/${routine.name}`, warnings);
  }
  xml.close("Routines");
}

function writeProgramParameters(xml: XmlWriter, parameters: ProgramParameter[] | undefined): void {
  if (!parameters || parameters.length === 0) return;
  xml.open("Parameters");
  for (const param of parameters) {
    const attrs: Record<string, AttrValue> = {
      Name: param.name,
      DataType: param.dataType,
      Usage: param.usage,
      Required: param.required ? "true" : undefined,
      // Re-assert parameter-face visibility so it survives export -> import
      // (mirrors AOI parameters / Required).
      Visible: param.visible ? "true" : undefined,
      // Re-assert array dimensions so an array parameter survives export -> import.
      Dimensions: l5xDimensions(param),
      // Re-assert the imported default so it survives export -> import.
      Default: param.defaultValue,
      // Re-assert the imported display radix and external access so they survive
      // export -> import (mirrors AOI parameters).
      Radix: param.radix,
      ExternalAccess: externalAccess(param.externalAccess),
      // Re-assert the constant flag so a constant input parameter survives
      // export -> import (mirrors tags).
      Constant: param.constant ? "true" : undefined,
    };
    if (param.description) {
      xml.open("Parameter", attrs);
      writeDescription(xml, param.description);
      xml.close("Parameter");
    } else {
      xml.leaf("Parameter", attrs);
    }
  }
  xml.close("Parameters");
}

function writePrograms(xml: XmlWriter, programs: Program[], warnings: string[]): void {
  if (programs.length === 0) {
    xml.leaf("Programs");
    return;
  }
  xml.open("Programs");
  for (const program of programs) {
    const mainName = program.mainRoutineId
      ? program.routines.find((routine) => routine.id === program.mainRoutineId)?.name
      : undefined;
    const faultName = program.faultRoutineId
      ? program.routines.find((routine) => routine.id === program.faultRoutineId)?.name
      : undefined;
    xml.open("Program", {
      Name: program.name,
      // Re-assert the imported safety partition so it survives export -> import
      // (mirrors tag Class).
      Class: program.safetyClass,
      // Re-assert the folder/organizer designation so it survives export -> import
      // (the importer reads UseAsFolder). Read-only metadata; never scheduled.
      UseAsFolder: program.useAsFolder ? "true" : undefined,
      MainRoutineName: mainName,
      FaultRoutineName: faultName,
      Disabled: program.inhibited ? "true" : undefined,
      // Re-assert pending online test edits so the flag survives export -> import
      // (the importer reads TestEdits). Read-only metadata; never acted on.
      TestEdits: program.testEdits ? "true" : undefined,
    });
    writeDescription(xml, program.description);
    writeProgramParameters(xml, program.parameters);
    writeTags(xml, program.programTags);
    writeRoutines(xml, program.routines, program.name, warnings);
    xml.close("Program");
  }
  xml.close("Programs");
}

function writeTasks(xml: XmlWriter, tasks: Task[], programs: Program[]): void {
  if (tasks.length === 0) return;
  const nameById = new Map(programs.map((program) => [program.id, program.name]));
  xml.open("Tasks");
  for (const task of tasks) {
    // Re-assert imported scheduling metadata so it survives export -> import
    // (the importer reads Rate/Priority/Watchdog/InhibitTask/DisableUpdateOutputs).
    // Each attribute is emitted only when present; the XmlWriter drops undefined values.
    xml.open("Task", {
      Name: task.name,
      Type: taskTypeToL5X(task.type),
      Rate: task.periodMs != null && task.periodMs > 0 ? task.periodMs : undefined,
      Priority: task.priority != null && task.priority > 0 ? task.priority : undefined,
      Watchdog: task.watchdogMs != null && task.watchdogMs > 0 ? task.watchdogMs : undefined,
      InhibitTask: task.inhibited ? "true" : undefined,
      DisableUpdateOutputs: task.disableUpdateOutputs ? "true" : undefined,
      // Re-assert the safety partition so the Safety Task survives export -> import
      // (mirrors program / tag Class). Display-only metadata; never used here.
      Class: task.safetyClass,
    });
    // Re-assert the imported task description so it survives export -> import
    // (mirrors controller / program / routine / tag descriptions).
    writeDescription(xml, task.description);
    // Re-assert the EVENT trigger binding so it survives export -> import (the
    // importer reads EventInfo's EventTrigger/Tag). Display-only metadata; never
    // used to schedule or talk to a controller.
    if (
      task.eventInfo &&
      (task.eventInfo.eventTrigger ||
        task.eventInfo.eventTag ||
        task.eventInfo.enableTimeout !== undefined)
    ) {
      xml.leaf("EventInfo", {
        EventTrigger: task.eventInfo.eventTrigger,
        EnableTimeout: boolAttr(task.eventInfo.enableTimeout),
        Tag: task.eventInfo.eventTag,
      });
    }
    const scheduled = task.scheduledProgramIds
      .map((id) => nameById.get(id))
      .filter((name): name is string => Boolean(name));
    if (scheduled.length > 0) {
      xml.open("ScheduledPrograms");
      for (const name of scheduled) xml.leaf("ScheduledProgram", { Name: name });
      xml.close("ScheduledPrograms");
    }
    xml.close("Task");
  }
  xml.close("Tasks");
}

function writeParameterConnections(
  xml: XmlWriter,
  connections: ProgramParameterConnection[] | undefined,
  warnings: string[],
): void {
  if (!connections || connections.length === 0) return;
  xml.open("ParameterConnections");
  for (const connection of connections) {
    xml.leaf("ParameterConnection", {
      EndPoint1: connection.endPoint1,
      EndPoint2: connection.endPoint2,
      ...connection.attributes,
    });
  }
  xml.close("ParameterConnections");
  warnings.push(
    "Program parameter connections are preserved for offline review/export; runtime parameter transfer and controller-verified binding are not modelled.",
  );
}

function writeDataTypes(xml: XmlWriter, dataTypes: UserDefinedType[]): void {
  if (dataTypes.length === 0) return;
  xml.open("DataTypes");
  for (const dt of dataTypes) {
    // Re-assert the imported data-type family (e.g. "StringFamily") so a custom
    // string type survives export -> import instead of collapsing to a plain
    // structure. Dropped by the XmlWriter when absent.
    xml.open("DataType", {
      Name: dt.name,
      Family: dt.family,
      // Re-assert the imported safety partition so a GuardLogix safety data type
      // survives export -> import (mirrors tag / program / task / AOI Class).
      Class: dt.safetyClass,
    });
    writeDescription(xml, dt.description);
    if (dt.members.length === 0) {
      xml.leaf("Members");
    } else {
      xml.open("Members");
      for (const member of dt.members) {
        const attrs: Record<string, AttrValue> = {
          Name: member.name,
          DataType: member.dataType,
          Dimension: l5xDimensions(member),
          // Re-assert the imported display radix so it survives export -> import.
          Radix: member.radix,
          // Re-assert the imported external access so it survives export -> import.
          ExternalAccess: externalAccess(member.externalAccess),
          // Re-assert the bit-overlay layout (hidden host member + bit packing)
          // so the exact member packing survives export -> import.
          Hidden: member.hidden ? "true" : undefined,
          Target: member.target,
          BitNumber: member.bitNumber != null ? member.bitNumber : undefined,
        };
        if (member.description) {
          xml.open("Member", attrs);
          writeDescription(xml, member.description);
          xml.close("Member");
        } else {
          xml.leaf("Member", attrs);
        }
      }
      xml.close("Members");
    }
    xml.close("DataType");
  }
  xml.close("DataTypes");
}

function writeAddOnInstructions(
  xml: XmlWriter,
  aois: AddOnInstruction[],
  warnings: string[],
): void {
  if (aois.length === 0) return;
  xml.open("AddOnInstructionDefinitions");
  for (const aoi of aois) {
    xml.open("AddOnInstructionDefinition", {
      Name: aoi.name,
      Revision: aoi.revision,
      // Re-assert imported authoring identity (display-only metadata) so it
      // survives export -> import.
      RevisionExtension: aoi.revisionExtension,
      SoftwareRevision: aoi.softwareRevision,
      Vendor: aoi.vendor,
      SignatureID: aoi.signature,
      // Re-assert the imported authoring identity (display-only change history)
      // so it survives export -> import (mirrors RevisionExtension / Vendor).
      CreatedDate: aoi.createdDate,
      CreatedBy: aoi.createdBy,
      EditedDate: aoi.editedDate,
      EditedBy: aoi.editedBy,
      // Re-assert the imported safety partition so it survives export -> import
      // (mirrors tag / program Class handling).
      Class: aoi.safetyClass,
      // Re-assert the imported scan-mode flags so they survive export -> import
      // (the importer reads ExecutePrescan / ExecutePostscan / ExecuteEnableInFalse).
      ExecutePrescan: aoi.executePrescan ? "true" : undefined,
      ExecutePostscan: aoi.executePostscan ? "true" : undefined,
      ExecuteEnableInFalse: aoi.executeEnableInFalse ? "true" : undefined,
      // Re-asserts protection so the imported flag is preserved; the encrypted
      // logic blob (EncodedData) is never reconstructed or exported.
      SourceProtectionType: aoi.protected ? aoi.protectionType ?? "Protected" : undefined,
    });
    writeDescription(xml, aoi.description);
    // Re-assert the imported documentation children so they survive export ->
    // import (the importer reads RevisionNote / AdditionalHelpText). Display-only
    // text; never parsed or validated.
    if (aoi.revisionNote) xml.cdataEl("RevisionNote", aoi.revisionNote);
    if (aoi.additionalHelpText) xml.cdataEl("AdditionalHelpText", aoi.additionalHelpText);

    if (aoi.parameters.length > 0) {
      xml.open("Parameters");
      for (const param of aoi.parameters) {
        const attrs: Record<string, AttrValue> = {
          Name: param.name,
          DataType: param.dataType,
          Usage: param.usage,
          // Re-assert array dimensions so InOut array parameters survive
          // export -> import (mirrors program parameters and AOI local tags).
          Dimensions: l5xDimensions(param),
          Required: param.required ? "true" : undefined,
          // Re-assert the instruction-face visibility so it survives export ->
          // import (mirrors Required).
          Visible: param.visible ? "true" : undefined,
          Default: param.defaultValue,
          // Re-assert the imported display radix and external access so they
          // survive export -> import (mirrors local tags and UDT members).
          Radix: param.radix,
          ExternalAccess: externalAccess(param.externalAccess),
          // Re-assert the constant-input flag so it survives export -> import
          // (mirrors program parameters and tags).
          Constant: param.constant ? "true" : undefined,
        };
        if (param.description) {
          xml.open("Parameter", attrs);
          writeDescription(xml, param.description);
          xml.close("Parameter");
        } else {
          xml.leaf("Parameter", attrs);
        }
      }
      xml.close("Parameters");
    }

    if (aoi.localTags.length > 0) {
      xml.open("LocalTags");
      for (const local of aoi.localTags) {
        const attrs: Record<string, AttrValue> = {
          Name: local.name,
          DataType: local.dataType,
          Dimensions: l5xDimensions(local),
          // Re-assert the imported display radix and external access so they
          // survive export -> import (mirrors tags and UDT members).
          Radix: local.radix,
          ExternalAccess: externalAccess(local.externalAccess),
        };
        if (local.description) {
          xml.open("LocalTag", attrs);
          writeDescription(xml, local.description);
          xml.close("LocalTag");
        } else {
          xml.leaf("LocalTag", attrs);
        }
      }
      xml.close("LocalTags");
    }

    const routines = aoi.routines?.length ? aoi.routines : [];
    if (routines.length > 0) {
      xml.open("Routines");
      for (const routine of routines) {
        writeRoutine(xml, routine, `AOI ${aoi.name}/${routine.name}`, warnings);
      }
      xml.close("Routines");
    } else if (aoi.routineNames.length > 0) {
      xml.open("Routines");
      for (const name of aoi.routineNames) xml.leaf("Routine", { Name: name, Type: "RLL" });
      xml.close("Routines");
    }

    xml.close("AddOnInstructionDefinition");

    if (aoi.protected) {
      warnings.push(
        `Add-On Instruction "${aoi.name}" is source-protected; only its metadata is exported (logic is encrypted and unavailable).`,
      );
    }
  }
  xml.close("AddOnInstructionDefinitions");
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

function moduleProfileChannels(module: IoModule): ModuleProfileChannel[] {
  const candidate = (module as IoModule & { profileChannels?: unknown }).profileChannels;
  if (!Array.isArray(candidate)) return [];
  return candidate.flatMap((row) => row && typeof row === "object" ? [row as ModuleProfileChannel] : []);
}

function writeModuleProfileChannels(xml: XmlWriter, channels: ModuleProfileChannel[]): void {
  if (channels.length === 0) return;
  xml.open("ProfileChannels");
  for (const channel of channels) {
    xml.leaf("ProfileChannel", {
      Id: channel.id,
      Label: channel.label,
      Direction: channel.direction,
      Signal: channel.signal,
      Enabled: boolAttr(channel.enabled),
      DataFormat: channel.dataFormat,
      Range: channel.range,
      Diagnostic: channel.diagnostic,
    });
  }
  xml.close("ProfileChannels");
}

function writeModules(xml: XmlWriter, modules: IoModule[]): void {
  if (modules.length === 0) return;
  xml.open("Modules");
  for (const module of modules) {
    const attrs: Record<string, AttrValue> = {
      Name: module.name,
      CatalogNumber: module.catalogNumber,
      Slot: module.slot != null ? module.slot : undefined,
      ParentModule: module.parentModule,
      ParentModPortId: module.parentPortId,
      CommPath: module.commPath,
      Vendor: module.vendor,
      ProductType: module.productType,
      ProductCode: module.productCode,
      Major: module.majorRevision,
      Minor: module.minorRevision,
      Inhibited: module.inhibited ? "true" : undefined,
      MajorFault: module.majorFault ? "true" : undefined,
    };
    const connections = module.connections?.length ? module.connections : undefined;
    const profileChannels = moduleProfileChannels(module);
    if (module.description || module.electronicKeying || module.ports?.length || connections || profileChannels.length) {
      xml.open("Module", attrs);
      writeDescription(xml, module.description);
      // Re-assert the imported electronic keying as the canonical <EKey State="..."/>
      // child element (matching Studio 5000) so it survives export -> import (the
      // importer reads Module/EKey State). Read-only metadata; never used to verify
      // a real connection.
      if (module.electronicKeying) {
        xml.leaf("EKey", { State: module.electronicKeying });
      }
      if (module.ports?.length) {
        xml.open("Ports");
        for (const port of module.ports) {
          const portAttrs: Record<string, AttrValue> = {
            Id: port.id,
            Type: port.type,
            Address: port.address,
            Upstream: port.upstream ? "true" : undefined,
            // Re-assert the CIP Safety Network Number so it survives export ->
            // import (read-only metadata; never used to verify a safety connection).
            SafetyNetwork: port.safetyNetwork,
          };
          // Re-assert the backplane/chassis size as a <Bus Size="N"/> child so it
          // survives export -> import (the importer reads Port/Bus Size).
          if (port.busSize != null) {
            xml.open("Port", portAttrs);
            xml.leaf("Bus", { Size: port.busSize });
            xml.close("Port");
          } else {
            xml.leaf("Port", portAttrs);
          }
        }
        xml.close("Ports");
      }
      // Re-assert imported/add-module profile-channel metadata so channel labels,
      // ranges, data formats, disabled state, and diagnostics survive export ->
      // import. Display/review only; no profile configuration is downloaded.
      writeModuleProfileChannels(xml, profileChannels);
      // Re-assert the imported I/O connections so the requested packet interval
      // and connection role survive export -> import (the importer reads
      // Communications/Connections/Connection). Read-only configuration metadata;
      // never used to open a real controller connection.
      if (connections) {
        xml.open("Communications");
        xml.open("Connections");
        for (const connection of connections) {
          xml.leaf("Connection", {
            Name: connection.name,
            RPI: connection.rpi,
            Type: connection.type,
            // Re-assert the imported connection scheduling priority so it
            // survives export -> import (read-only QoS metadata).
            Priority: connection.priority,
            Unicast: boolAttr(connection.unicast),
            // Re-assert the imported event-trigger identifier (read-only metadata).
            EventID: connection.eventId,
            // Re-assert whether the connection may be triggered programmatically
            // to fire an event task (read-only metadata; pairs with EventID).
            ProgrammaticallySendEventTrigger: boolAttr(connection.programmaticallySendEventTrigger),
            // Re-assert input delivery/production and output-ownership QoS
            // settings so they survive export -> import (read-only metadata).
            InputConnectionType: connection.inputConnectionType,
            InputProductionTrigger: connection.inputProductionTrigger,
            OutputRedundantOwner: boolAttr(connection.outputRedundantOwner),
          });
        }
        xml.close("Connections");
        xml.close("Communications");
      }
      xml.close("Module");
    } else {
      xml.leaf("Module", attrs);
    }
  }
  xml.close("Modules");
}

function writeTrends(xml: XmlWriter, trends: ControllerTrend[] | undefined, warnings: string[]): void {
  if (!trends || trends.length === 0) return;
  xml.open("Trends");
  for (const trend of trends) {
    xml.open("Trend", { Name: trend.name, ...trend.attributes });
    writeDescription(xml, trend.description);
    if (trend.template != null) {
      xml.cdataEl("Template", trend.template);
    }
    if (trend.pens.length > 0) {
      xml.open("Pens");
      for (const pen of trend.pens) {
        const attrs: Record<string, AttrValue> = { Name: pen.name, ...pen.attributes };
        if (pen.description) {
          xml.open("Pen", attrs);
          writeDescription(xml, pen.description);
          xml.close("Pen");
        } else {
          xml.leaf("Pen", attrs);
        }
      }
      xml.close("Pens");
    }
    xml.close("Trend");
    warnings.push(
      `Trend "${trend.name}" definition is preserved for offline review/export; sampled trend data and online trend execution are not modelled.`,
    );
  }
  xml.close("Trends");
}

function writeQuickWatchLists(
  xml: XmlWriter,
  quickWatchLists: QuickWatchList[] | undefined,
  warnings: string[],
): void {
  if (!quickWatchLists || quickWatchLists.length === 0) return;
  xml.open("QuickWatchLists");
  for (const list of quickWatchLists) {
    xml.open("QuickWatchList", { Name: list.name, ...list.attributes });
    writeDescription(xml, list.description);
    for (const tag of list.tags) {
      const attrs: Record<string, AttrValue> = {
        Specifier: tag.specifier,
        Scope: tag.scope,
        ...tag.attributes,
      };
      if (tag.description) {
        xml.open("WatchTag", attrs);
        writeDescription(xml, tag.description);
        xml.close("WatchTag");
      } else {
        xml.leaf("WatchTag", attrs);
      }
    }
    xml.close("QuickWatchList");
    warnings.push(
      `Quick Watch List "${list.name}" definition is preserved for offline review/export; online watch monitoring and live controller values are not modelled.`,
    );
  }
  xml.close("QuickWatchLists");
}

function writeEthernetConfig(
  xml: XmlWriter,
  ethernetConfig: ControllerEthernetConfig | undefined,
  warnings: string[],
): void {
  if (!ethernetConfig) return;
  if (ethernetConfig.internetProtocol) {
    xml.leaf("InternetProtocol", ethernetConfig.internetProtocol.attributes);
  }
  if (ethernetConfig.ports.length > 0) {
    xml.open("EthernetPorts");
    for (const port of ethernetConfig.ports) {
      xml.leaf("EthernetPort", port.attributes);
    }
    xml.close("EthernetPorts");
  }
  if (ethernetConfig.network) {
    xml.leaf("EthernetNetwork", ethernetConfig.network.attributes);
  }
  warnings.push(
    "Controller EtherNet/IP configuration is preserved for offline review/export; IP settings, network browsing, and live port state are not modelled.",
  );
}

function writeCommPorts(
  xml: XmlWriter,
  commPorts: ControllerCommPorts | undefined,
  warnings: string[],
): void {
  if (!commPorts || commPorts.serialPorts.length === 0) return;
  xml.open("CommPorts");
  for (const serialPort of commPorts.serialPorts) {
    if (serialPort.protocols.length === 0 && !serialPort.description) {
      xml.leaf("SerialPort", serialPort.attributes);
      continue;
    }
    xml.open("SerialPort", serialPort.attributes);
    // Re-assert the imported port <Description> (a child element, like every
    // other configurable element) so it survives export -> import rather than
    // being dropped when the port is re-emitted.
    writeDescription(xml, serialPort.description);
    for (const protocol of serialPort.protocols) {
      xml.leaf(protocol.elementName, protocol.attributes);
    }
    xml.close("SerialPort");
  }
  xml.close("CommPorts");
  warnings.push(
    "Controller serial communication port configuration is preserved for offline review/export; serial hardware access, DF1 runtime, and ASCII channel hardware state are not modelled.",
  );
}

function collectUnsupported(controller: Controller, registry: InstructionRegistry): string[] {
  const unsupported = new Set<string>();
  for (const program of controller.programs) {
    for (const routine of program.routines) {
      const ladder = asLadderRoutine(routine.ladder);
      if (!ladder) continue;
      for (const node of routineNodes(ladder)) {
        if (!registry.get(node.instructionType)) unsupported.add(node.instructionType);
      }
    }
  }
  return [...unsupported].sort();
}

function writeController(
  xml: XmlWriter,
  controller: Controller,
  warnings: string[],
  registry: InstructionRegistry,
): void {
  // Re-assert imported controller metadata so it survives export -> import. The
  // importer reads MajorRev/MinorRev (not a single FirmwareRevision attribute),
  // plus CatalogNumber, ChassisType, Slot, FaultHandler, and PowerLossHandler.
  // Undefined/empty attributes are dropped by the XmlWriter.
  const [majorRev, minorRev] = (controller.firmwareRevision ?? "").split(".");
  xml.open("Controller", {
    Use: "Target",
    Name: controller.name,
    ProcessorType: controller.processorType,
    CatalogNumber: controller.catalogNumber,
    MajorRev: majorRev || undefined,
    MinorRev: minorRev || undefined,
    ChassisType: controller.chassis,
    Slot: controller.slot != null ? controller.slot : undefined,
    FaultHandler: controller.faultRoutineName,
    PowerLossHandler: controller.powerUpRoutineName,
    // Re-assert the imported System Overhead Time Slice scheduling metadata so it
    // survives export -> import (read-only; never used by the simulator).
    TimeSlice: controller.timeSlice,
    ShareUnusedTimeSlice: controller.shareUnusedTimeSlice,
    // Re-assert the imported SFC execution-control scheduling metadata so it
    // survives export -> import (read-only; never used by the simulator).
    SFCExecutionControl: controller.sfcExecutionControl,
    SFCRestartPosition: controller.sfcRestartPosition,
    SFCLastScan: controller.sfcLastScan,
    // Re-assert the imported project documentation language configuration so it
    // survives export -> import (read-only; never used by the simulator).
    CurrentProjectLanguage: controller.currentProjectLanguage,
    DefaultProjectLanguage: controller.defaultProjectLanguage,
    ControllerLanguage: controller.controllerLanguage,
    // Re-assert the imported project documentation download / pass-through
    // configuration so it survives export -> import (read-only; never used by
    // the simulator).
    PassThroughConfiguration: controller.passThroughConfiguration,
    DownloadProjectDocumentationAndExtendedProperties:
      controller.downloadProjectDocumentationAndExtendedProperties,
    DownloadProjectCustomProperties: controller.downloadProjectCustomProperties,
    // Re-assert the imported project/controller matching and firmware-update
    // configuration so it survives export -> import (read-only; never used to
    // talk to a controller, match a serial number, or update firmware).
    MatchProjectToController: controller.matchProjectToController,
    ProjectSN: controller.projectSN,
    InhibitAutomaticFirmwareUpdate: controller.inhibitAutomaticFirmwareUpdate,
    // Re-assert whether a consumed tag may adopt the RPI requested by its
    // producer so it survives export -> import (read-only; never used to
    // schedule a connection or talk to a controller; pairs with the
    // produced/consumed tag <ConsumeInfo> RPI). Preserve both exported spellings.
    CanUseRPIFromProducer: controller.canUseRPIFromProducer,
    CanUseRPIFromController: controller.canUseRPIFromController,
    // Re-assert the imported project documentation/audit timestamps so they
    // survive export -> import (read-only; never parsed as a date or used by
    // the simulator).
    ProjectCreationDate: controller.projectCreationDate,
    LastModifiedDate: controller.lastModifiedDate,
    // Re-assert the imported arithmetic-overflow minor-fault reporting setting so
    // it survives export -> import (read-only; never used by the simulator to
    // decide overflow handling).
    ReportMinorOverflow: controller.reportMinorOverflow,
    // Re-assert the imported last-used communication path/driver so it survives
    // export -> import (read-only; never used to connect to, go online with, or
    // talk to a controller — this tool is offline-only).
    CommPath: controller.commPath,
    CommDriver: controller.commDriver,
  });
  // Re-assert the controller <Description> so it survives export -> import
  // (mirrors program / routine / tag descriptions).
  writeDescription(xml, controller.description);
  // Re-assert the imported redundancy configuration so it survives export ->
  // import (the importer reads RedundancyInfo's
  // Enabled / KeepTestEditsOnSwitchOver / IOMemoryPadPercentage /
  // DataTablePadPercentage / front-port crossload settings). Read-only; never
  // used by the simulator.
  if (controller.redundancyInfo) {
    const redundancy = controller.redundancyInfo;
    xml.leaf("RedundancyInfo", {
      Enabled: boolAttr(redundancy.enabled),
      KeepTestEditsOnSwitchOver: boolAttr(redundancy.keepTestEditsOnSwitchOver),
      IOMemoryPadPercentage: redundancy.ioMemoryPadPercentage,
      DataTablePadPercentage: redundancy.dataTablePadPercentage,
      FrontPortCrossloadEnabledPorts: redundancy.frontPortCrossloadEnabledPorts,
      FrontPortCrossloadSecurityEnabled: redundancy.frontPortCrossloadSecurityEnabled,
    });
  }
  // Re-assert the imported GuardLogix safety configuration so it survives
  // export -> import (the importer reads SafetyInfo's
  // SafetyEnabled / SafetyLocked / SafetySignatureID /
  // SafetySignatureTimestamp / SignatureRunModeProtect /
  // ConfigureSafetyIOAlways). Read-only; never used to verify a safety
  // signature or talk to a controller.
  if (controller.safetyInfo) {
    const safety = controller.safetyInfo;
    const safetyAttrs = {
      SafetyEnabled: safety.safetyEnabled,
      SafetyLocked: boolAttr(safety.safetyLocked),
      SafetySignatureID: safety.safetySignatureId,
      SafetySignatureTimestamp: safety.safetySignatureTimestamp,
      SignatureRunModeProtect: boolAttr(safety.signatureRunModeProtect),
      ConfigureSafetyIOAlways: boolAttr(safety.configureSafetyIOAlways),
      // Re-assert the certified safety integrity level (e.g. "SIL2/PLd") so it
      // survives export -> import (display-only metadata).
      SafetyLevel: safety.safetyLevel,
    };
    // The standard <-> safety tag mapping lives in a <SafetyTagMap> child
    // element (not an attribute), so emit <SafetyInfo> with a body when it is
    // present rather than self-closing; re-assert it verbatim so the mapping
    // survives export -> import (read-only; never resolved or used to move data
    // between safety and standard scope).
    if (safety.safetyTagMap) {
      xml.open("SafetyInfo", safetyAttrs);
      xml.textEl("SafetyTagMap", safety.safetyTagMap);
      xml.close("SafetyInfo");
    } else {
      xml.leaf("SafetyInfo", safetyAttrs);
    }
  }
  // Re-assert the imported wall-clock time configuration so it survives
  // export -> import (the importer reads WallClockTime's
  // LocalTimeAdjustment / TimeZone). Read-only; never used to set or read a
  // controller's clock.
  if (controller.wallClockTime) {
    const wallClock = controller.wallClockTime;
    xml.leaf("WallClockTime", {
      LocalTimeAdjustment: wallClock.localTimeAdjustment,
      TimeZone: wallClock.timeZone,
    });
  }
  // Re-assert the imported CIP Sync / IEEE 1588 time-synchronization
  // configuration so it survives export -> import (the importer reads
  // TimeSynchronize's PTPEnable / Priority1 / Priority2). Read-only; never used
  // to synchronize a clock or talk to a controller.
  if (controller.timeSync) {
    const timeSync = controller.timeSync;
    xml.leaf("TimeSynchronize", {
      PTPEnable: boolAttr(timeSync.ptpEnable),
      Priority1: timeSync.priority1,
      Priority2: timeSync.priority2,
    });
  }
  // Re-assert the imported Coordinated System Time configuration so it survives
  // export -> import (the importer reads CST's MasterID). Read-only; never used
  // to coordinate a system clock or talk to a controller.
  if (controller.cst) {
    xml.leaf("CST", {
      MasterID: controller.cst.masterId,
    });
  }
  // Re-assert the imported source-protection / change-detection configuration so
  // it survives export -> import (the importer reads Security's
  // Code / ChangesToDetect / SecurityAuthorityID / SecurityAuthorityName).
  // Read-only; never used to enforce permissions or talk to a controller.
  if (controller.security) {
    const security = controller.security;
    xml.leaf("Security", {
      Code: security.code,
      ChangesToDetect: security.changesToDetect,
      SecurityAuthorityID: security.securityAuthorityId,
      SecurityAuthorityName: security.securityAuthorityName,
    });
  }
  writeDataTypes(xml, controller.dataTypes);
  writeModules(xml, controller.ioConfiguration.modules);
  writeTrends(xml, controller.trends, warnings);
  writeQuickWatchLists(xml, controller.quickWatchLists, warnings);
  writeCommPorts(xml, controller.commPorts, warnings);
  writeEthernetConfig(xml, controller.ethernetConfig, warnings);
  writeAddOnInstructions(xml, controller.addOnInstructions, warnings);
  writeTags(xml, controller.controllerTags);
  writePrograms(xml, controller.programs, warnings);
  writeTasks(xml, controller.tasks, controller.programs);
  writeParameterConnections(xml, controller.parameterConnections, warnings);
  xml.close("Controller");

  const unsupported = collectUnsupported(controller, registry);
  if (unsupported.length > 0) {
    warnings.push(
      `Unsupported instruction(s) preserved as read-only logic (not simulated): ${unsupported.join(", ")}.`,
    );
  }
}

/**
 * Serialize a project into a newly generated `.L5X` XML string for offline
 * review. The output mirrors the subset the importer understands, so supported
 * logic round-trips (project -> export -> import is equivalent). Unsupported
 * instructions are preserved verbatim in the rung text and surfaced as warnings;
 * they are never dropped and never cause a crash.
 *
 * This never reads or writes proprietary binary controller-project files, never
 * modifies the original imported file, and never communicates with a controller.
 */
export function exportL5X(
  project: PlcProject,
  registry: InstructionRegistry = createDefaultRegistry(),
): ExportL5XResult {
  const warnings: string[] = [];
  const controllers = project.controllers;
  const controller = controllers[0];

  if (controllers.length > 1) {
    warnings.push(
      `Project has ${controllers.length} controllers; only the first ("${controller?.name}") is exported.`,
    );
  }

  const targetName = controller?.name ?? project.name;
  const exportDate = controller?.exportDate ?? project.updatedAt;

  const xml = new XmlWriter();
  xml.raw('<?xml version="1.0" encoding="UTF-8"?>');
  xml.open("RSLogix5000Content", {
    SchemaRevision: "1.0",
    // Preserve the originating Studio 5000 software version when one was imported
    // (omitted when unknown rather than fabricated).
    SoftwareRevision: controller?.softwareRevision,
    TargetName: targetName,
    // Preserve the originating export owner when one was imported (omitted when
    // unknown rather than fabricated), mirroring SoftwareRevision.
    Owner: controller?.exportOwner,
    // Preserve the originating export-scope options when imported (omitted when
    // unknown rather than fabricated), mirroring Owner.
    ExportOptions: controller?.exportOptions,
    // Preserve whether the file embeds surrounding project context when imported
    // (omitted when unknown rather than fabricated), mirroring ExportOptions.
    ContainsContext: controller?.containsContext,
    ContentType: "Controller",
    ExportName: "ESCO Automation Studio",
    // Re-assert the originating export date when one was imported so it survives
    // export -> import (read-only provenance; never parsed as a date or acted on),
    // mirroring SoftwareRevision / Owner / ExportOptions / ContainsContext above.
    // Fall back to this tool's own export time only when none was imported.
    ExportDate: exportDate,
  });
  xml.comment(GENERATED_NOTICE);

  if (controller) {
    writeController(xml, controller, warnings, registry);
  } else {
    xml.leaf("Controller", { Use: "Target", Name: project.name });
    warnings.push("Project has no controller; exported an empty controller shell.");
  }

  xml.close("RSLogix5000Content");
  return {
    xml: xml.toString(),
    warnings,
    evidence: {
      format: "L5X",
      rootElement: "RSLogix5000Content",
      contentType: "Controller",
      exportName: "ESCO Automation Studio",
      targetName,
      exportDate,
      generatedOffline: true,
      proprietaryBinaryTouched: false,
      generatedNotice: GENERATED_NOTICE,
    },
  };
}
