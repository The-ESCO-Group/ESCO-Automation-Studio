import type {
  AddOnInstruction,
  Controller,
  IoModule,
  PlcProject,
  Program,
  Routine,
  RoutineLanguage,
  Tag,
  Task,
  UserDefinedType,
} from "@esco/core";
import { createDefaultRegistry, type InstructionRegistry } from "@esco/instructions";
import { routineNodes, rungToText, type LadderRoutine, type LadderRung } from "@esco/ladder";

export interface ExportL5XResult {
  /** The generated `.L5X` XML text (a newly generated file). */
  xml: string;
  /** Human-readable notes about anything exported with caveats. */
  warnings: string[];
}

/**
 * Embedded in every generated file so a reviewer always knows what it is. This
 * is NOT a Studio 5000 export and is not controller-verified.
 */
const GENERATED_NOTICE =
  "Generated offline by ESCO Automation Studio. This is a newly generated, " +
  "best-effort .L5X for review only - not an original Studio 5000 export, not " +
  "controller-verified, and never written from or to an .ACD file. No PLC " +
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

function writeDescription(xml: XmlWriter, description: string | undefined): void {
  if (description) xml.cdataEl("Description", description);
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
      TagType: tag.aliasFor ? "Alias" : "Base",
      DataType: tag.dataType,
      Dimensions: tag.dimension && tag.dimension > 0 ? tag.dimension : undefined,
      AliasFor: tag.aliasFor,
    };
    if (tag.description) {
      xml.open("Tag", attrs);
      writeDescription(xml, tag.description);
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
  } else if (routine.language === "structured-text" && routine.structuredText) {
    // Preserve the source so it is not silently dropped from the generated file.
    // Note: the current importer does not re-read STContent (see caveats).
    const lines = routine.structuredText.split(/\r?\n/);
    xml.open("STContent");
    lines.forEach((line, index) => xml.cdataEl("Line", line, { Number: index }));
    xml.close("STContent");
    warnings.push(
      `${where}: ${ROUTINE_LABEL[routine.language]} source is preserved in the file but is not re-imported by this tool.`,
    );
  } else if (routine.language !== "ladder") {
    warnings.push(
      `${where}: ${ROUTINE_LABEL[routine.language]} routine exported as a stub (its body is not yet serialized).`,
    );
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
    xml.open("Program", { Name: program.name, MainRoutineName: mainName });
    writeDescription(xml, program.description);
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
    xml.open("Task", { Name: task.name, Type: taskTypeToL5X(task.type) });
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

function writeDataTypes(xml: XmlWriter, dataTypes: UserDefinedType[]): void {
  if (dataTypes.length === 0) return;
  xml.open("DataTypes");
  for (const dt of dataTypes) {
    xml.open("DataType", { Name: dt.name });
    writeDescription(xml, dt.description);
    if (dt.members.length === 0) {
      xml.leaf("Members");
    } else {
      xml.open("Members");
      for (const member of dt.members) {
        const attrs: Record<string, AttrValue> = {
          Name: member.name,
          DataType: member.dataType,
          Dimension: member.dimension && member.dimension > 0 ? member.dimension : undefined,
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
      SignatureID: aoi.signature,
      // Re-asserts protection so the imported flag is preserved; the encrypted
      // logic blob (EncodedData) is never reconstructed or exported.
      SourceProtectionType: aoi.protected ? aoi.protectionType ?? "Protected" : undefined,
    });
    writeDescription(xml, aoi.description);

    if (aoi.parameters.length > 0) {
      xml.open("Parameters");
      for (const param of aoi.parameters) {
        const attrs: Record<string, AttrValue> = {
          Name: param.name,
          DataType: param.dataType,
          Usage: param.usage,
          Required: param.required ? "true" : undefined,
          Default: param.defaultValue,
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
        const attrs: Record<string, AttrValue> = { Name: local.name, DataType: local.dataType };
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

    if (aoi.routineNames.length > 0) {
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

function writeModules(xml: XmlWriter, modules: IoModule[]): void {
  if (modules.length === 0) return;
  xml.open("Modules");
  for (const module of modules) {
    const attrs: Record<string, AttrValue> = {
      Name: module.name,
      CatalogNumber: module.catalogNumber,
      Slot: module.slot != null ? module.slot : undefined,
      ParentModule: module.parentModule,
      CommPath: module.commPath,
    };
    if (module.description) {
      xml.open("Module", attrs);
      writeDescription(xml, module.description);
      xml.close("Module");
    } else {
      xml.leaf("Module", attrs);
    }
  }
  xml.close("Modules");
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
  xml.open("Controller", {
    Use: "Target",
    Name: controller.name,
    ProcessorType: controller.processorType,
    FirmwareRevision: controller.firmwareRevision,
  });
  writeDataTypes(xml, controller.dataTypes);
  writeModules(xml, controller.ioConfiguration.modules);
  writeAddOnInstructions(xml, controller.addOnInstructions, warnings);
  writeTags(xml, controller.controllerTags);
  writePrograms(xml, controller.programs, warnings);
  writeTasks(xml, controller.tasks, controller.programs);
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
 * This never reads or writes `.ACD` files, never modifies the original imported
 * file, and never communicates with a controller.
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

  const xml = new XmlWriter();
  xml.raw('<?xml version="1.0" encoding="UTF-8"?>');
  xml.open("RSLogix5000Content", {
    SchemaRevision: "1.0",
    TargetName: controller?.name ?? project.name,
    ContentType: "Controller",
    ExportName: "ESCO Automation Studio",
    ExportDate: project.updatedAt,
  });
  xml.comment(GENERATED_NOTICE);

  if (controller) {
    writeController(xml, controller, warnings, registry);
  } else {
    xml.leaf("Controller", { Use: "Target", Name: project.name });
    warnings.push("Project has no controller; exported an empty controller shell.");
  }

  xml.close("RSLogix5000Content");
  return { xml: xml.toString(), warnings };
}
