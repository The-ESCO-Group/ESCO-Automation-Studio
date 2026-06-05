import type { PlcProject } from "@esco/core";
import { createDefaultRegistry } from "@esco/instructions";
import { rungNodes, type LadderNode, type LadderRoutine } from "@esco/ladder";
import type { ValidationFinding, ValidationRule } from "./types";

/**
 * Studio 5000 lets most built-in instructions appear inside Add-On Instruction
 * definitions, but a small set is rejected at verify time because AOI logic must
 * remain self-contained and cannot dispatch subroutines, event tasks, SFC
 * control, immediate output updates, or selected PhaseManager/motion ownership
 * commands. The current Rockwell Add-On Instructions programming manual lists:
 * BRK, EOT, EVENT, FOR, IOT, JSR, JXR, MAOC, PATT, PCLF, PCMD, PDET, POVR, RET,
 * SBR, SFP, and SFR.
 *
 * The same section allows ALMA, ALMD, all motion instructions, and MSG inside an
 * AOI only when their instruction data instance is passed through an InOut
 * parameter. It also narrows the GSV/SSV object classes that verify inside AOIs:
 * AddOnInstructionDefinition, CST, and HardwareStatus are GSV-only, and
 * programming-component classes (Task, Program, Routine, and
 * AddOnInstructionDefinition) support only the special instance name THIS.
 *
 * ESCO can check the data-instance operands declared in the instruction
 * registry: MSG.message, ALMA/ALMD.alarm, and motionControl operands on motion
 * blocks. Reordered motion forms without a declared motionControl operand are
 * intentionally left alone until their exact operand metadata is modelled.
 *
 * Source-protected and non-ladder AOI bodies are opaque in this offline model,
 * so the rule mirrors the simulator and only inspects unprotected ladder
 * routines whose AST is available.
 */

const registry = createDefaultRegistry();

const UNAVAILABLE_IN_AOI = new Map<string, string>([
  ["BRK", "Break"],
  ["EOT", "End of Transition"],
  ["EVENT", "Event Task Trigger"],
  ["FOR", "For"],
  ["IOT", "Immediate Output"],
  ["JSR", "Jump to Subroutine"],
  ["JXR", "Jump to External Routine"],
  ["MAOC", "Motion Arm Output Cam"],
  ["PATT", "Attach to Equipment Phase"],
  ["PCLF", "Equipment Phase Clear Failure"],
  ["PCMD", "Equipment Phase Command"],
  ["PDET", "Detach from Equipment Phase"],
  ["POVR", "Equipment Phase Override Command"],
  ["RET", "Return"],
  ["SBR", "Subroutine"],
  ["SFP", "SFC Pause"],
  ["SFR", "SFC Reset"],
]);

const AOI_GSV_SSV_CLASSES = new Map<string, string>([
  ["ADDONINSTRUCTIONDEFINITION", "AddOnInstructionDefinition"],
  ["AXIS", "Axis"],
  ["CONTROLLER", "Controller"],
  ["CONTROLLERDEVICE", "Controller Device"],
  ["COORDINATESYSTEM", "CoordinateSystem"],
  ["CST", "CST"],
  ["DF1", "DF1"],
  ["FAULTLOG", "FaultLog"],
  ["HARDWARESTATUS", "HardwareStatus"],
  ["MESSAGE", "Message"],
  ["MODULE", "Module"],
  ["MOTIONGROUP", "MotionGroup"],
  ["PROGRAM", "Program"],
  ["REDUNDANCY", "Redundancy"],
  ["ROUTINE", "Routine"],
  ["SAFETY", "Safety"],
  ["SERIALPORT", "Serial Port"],
  ["TASK", "Task"],
  ["TIMESYNCHRONIZE", "TimeSynchronize"],
  ["WALLCLOCKTIME", "WallClockTime"],
]);

const AOI_GSV_ONLY_CLASSES = new Set(["ADDONINSTRUCTIONDEFINITION", "CST", "HARDWARESTATUS"]);
const AOI_THIS_INSTANCE_CLASSES = new Set(["ADDONINSTRUCTIONDEFINITION", "PROGRAM", "ROUTINE", "TASK"]);

function asLadderRoutine(ladder: unknown): LadderRoutine | undefined {
  if (
    ladder &&
    typeof ladder === "object" &&
    Array.isArray((ladder as { rungs?: unknown }).rungs)
  ) {
    return ladder as LadderRoutine;
  }
  return undefined;
}

function rootIdentifier(value: string): string | undefined {
  return value.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)/)?.[1];
}

function normalizeKeyword(value: string): string {
  return value.trim().replace(/^['"]|['"]$/g, "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

interface DataInstanceRequirement {
  operandIndex: number;
  label: string;
}

function dataInstanceRequirement(node: LadderNode): DataInstanceRequirement | undefined {
  const type = node.instructionType.toUpperCase();
  if (type === "MSG") return { operandIndex: 0, label: "message control tag" };
  if (type === "ALMA" || type === "ALMD") return { operandIndex: 0, label: "alarm backing tag" };

  const definition = registry.get(type);
  if (definition?.category !== "motion") return undefined;
  const motionControlIndex = definition.operands.findIndex((operand) => operand.name === "motionControl");
  return motionControlIndex >= 0
    ? { operandIndex: motionControlIndex, label: "motion control tag" }
    : undefined;
}

function isInOutUsage(usage: string | undefined): boolean {
  return usage?.toLowerCase() === "inout";
}

function checkGsvSsvClass(aoiName: string, routineName: string, rungTarget: string, node: LadderNode): ValidationFinding[] {
  const type = node.instructionType.toUpperCase();
  if (type !== "GSV" && type !== "SSV") return [];

  const findings: ValidationFinding[] = [];
  const rawClassName = node.operands[0]?.value?.trim() ?? "";
  if (!rawClassName) return findings;
  const classKey = normalizeKeyword(rawClassName);
  const classLabel = AOI_GSV_SSV_CLASSES.get(classKey);

  if (!classLabel) {
    findings.push({
      ruleId: "aoi-instruction-restrictions",
      severity: "error",
      message: `Add-On Instruction "${aoiName}" uses ${type} class "${rawClassName}" in routine "${routineName}"; controller-editor rules support only selected GSV/SSV object classes inside an Add-On Instruction.`,
      target: `${rungTarget}/${type}.className`,
    });
    return findings;
  }

  if (type === "SSV" && AOI_GSV_ONLY_CLASSES.has(classKey)) {
    findings.push({
      ruleId: "aoi-instruction-restrictions",
      severity: "error",
      message: `Add-On Instruction "${aoiName}" uses SSV class "${classLabel}" in routine "${routineName}"; controller-editor rules allow ${classLabel} inside an Add-On Instruction only with GSV.`,
      target: `${rungTarget}/${type}.className`,
    });
  }

  if (AOI_THIS_INSTANCE_CLASSES.has(classKey)) {
    const rawInstanceName = node.operands[1]?.value?.trim() ?? "";
    if (normalizeKeyword(rawInstanceName) !== "THIS") {
      findings.push({
        ruleId: "aoi-instruction-restrictions",
        severity: "error",
        message: `Add-On Instruction "${aoiName}" uses ${type} ${classLabel} instance "${rawInstanceName || "<blank>"}" in routine "${routineName}"; controller-editor rules require the instance name THIS for programming-component classes inside an Add-On Instruction.`,
        target: `${rungTarget}/${type}.instanceName`,
      });
    }
  }

  return findings;
}

export const aoiInstructionRestrictions: ValidationRule = {
  id: "aoi-instruction-restrictions",
  name: "AOI instruction restrictions",
  category: "syntax",
  severity: "error",
  run({ project }: { project: PlcProject }): ValidationFinding[] {
    const findings: ValidationFinding[] = [];

    for (const controller of project.controllers) {
      for (const aoi of controller.addOnInstructions) {
        if (aoi.protected) continue;

        const parameterByName = new Map(
          aoi.parameters.map((parameter) => [parameter.name.toUpperCase(), parameter]),
        );

        for (const routine of aoi.routines ?? []) {
          const ladder = asLadderRoutine(routine.ladder);
          if (!ladder) continue;
          const routineTarget = `${controller.name}/${aoi.name}/${routine.name}`;

          for (const rung of ladder.rungs) {
            const rungTarget = `${routineTarget}/Rung ${rung.number}`;
            for (const node of rungNodes(rung)) {
              const type = node.instructionType.toUpperCase();
              const unavailable = UNAVAILABLE_IN_AOI.get(type);
              if (unavailable) {
                findings.push({
                  ruleId: "aoi-instruction-restrictions",
                  severity: "error",
                  message: `Add-On Instruction "${aoi.name}" uses ${type} (${unavailable}) in routine "${routine.name}"; controller-editor rules do not allow ${type} inside an Add-On Instruction definition.`,
                  target: `${rungTarget}/${type}`,
                });
              }

              findings.push(...checkGsvSsvClass(aoi.name, routine.name, rungTarget, node));

              const dataInstance = dataInstanceRequirement(node);
              if (!dataInstance) continue;
              const operandValue = node.operands[dataInstance.operandIndex]?.value?.trim();
              if (!operandValue) continue;
              const root = rootIdentifier(operandValue);
              if (!root) continue;
              const parameter = parameterByName.get(root.toUpperCase());
              if (parameter && isInOutUsage(parameter.usage)) continue;

              findings.push({
                ruleId: "aoi-instruction-restrictions",
                severity: "error",
                message: `Add-On Instruction "${aoi.name}" uses ${type} with ${dataInstance.label} "${operandValue}"; controller-editor rules require this data instance to be passed as an InOut parameter when ${type} is used inside an Add-On Instruction.`,
                target: `${rungTarget}/${type}.${dataInstance.label}`,
              });
            }
          }
        }
      }
    }

    return findings;
  },
};
