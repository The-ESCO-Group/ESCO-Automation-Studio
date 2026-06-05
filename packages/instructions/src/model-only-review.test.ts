import { describe, expect, it } from "vitest";
import type { LadderNode, OperandKind } from "@esco/ladder";
import { createDefaultRegistry, describeModelOnlyInstructionReview } from "./index";

function node(type: string, operands: Array<[string, string, OperandKind?]>): LadderNode {
  return {
    id: `n-${type}`,
    instructionType: type,
    operands: operands.map(([name, value, kind = "tag"]) => ({ name, value, kind })),
  };
}

describe("model-only instruction review projection", () => {
  const registry = createDefaultRegistry();

  it("does not project executable or unknown instructions", () => {
    expect(describeModelOnlyInstructionReview(registry.get("XIC"), node("XIC", [["bit", "StartPB"]]))).toBeUndefined();
    expect(describeModelOnlyInstructionReview(registry.get("XUNKNOWN"), node("XUNKNOWN", []))).toBeUndefined();
  });

  it("describes MSG/GSV/SSV review operands without implying communication or system transfer", () => {
    const msg = describeModelOnlyInstructionReview(registry.get("MSG"), node("MSG", [["message", "MsgCtl"]]));
    expect(msg).toMatchObject({
      instructionType: "MSG",
      displayName: "Message",
      supportLevel: "model-only",
      fidelityStatus: "model-only",
      fidelityLabel: "Model-only",
      rungBehavior: "pass-through",
      runtimeEffects: {
        tagMemoryAccess: false,
        controllerCommunication: false,
        messageExecution: false,
        cipMessageConnection: false,
        remoteDataTransfer: false,
        messageControlStatusUpdate: false,
      },
    });
    expect(msg?.boundaries).toEqual(expect.arrayContaining([
      "pass-through-rung-power",
      "no-runtime-tag-memory-access",
      "no-controller-communication",
      "no-message-execution",
      "no-cip-message-connection",
      "no-remote-data-transfer",
      "no-message-control-status-update",
    ]));
    expect(msg?.operands[0]).toMatchObject({
      name: "message",
      label: "Message",
      value: "MsgCtl",
      role: "tag",
      declaredDirection: "write",
      allowedTypes: ["MESSAGE"],
    });

    const gsv = describeModelOnlyInstructionReview(
      registry.get("GSV"),
      node("GSV", [
        ["className", "WALLCLOCKTIME", "literal"],
        ["instanceName", "", "literal"],
        ["attributeName", "DateTime", "literal"],
        ["dest", "Clock[0]"],
      ]),
    );
    expect(gsv?.boundaries).toContain("no-system-value-transfer");
    expect(gsv?.boundaries).toContain("no-controller-object-attribute-read");
    expect(gsv?.boundaries).not.toContain("no-controller-object-attribute-write");
    expect(gsv?.runtimeEffects).toMatchObject({
      systemValueTransfer: false,
      controllerObjectAttributeRead: false,
    });
    expect(gsv?.operands.map((operand) => [operand.name, operand.role, operand.value, operand.declaredDirection])).toEqual([
      ["className", "keyword", "WALLCLOCKTIME", "read"],
      ["instanceName", "keyword", "", "read"],
      ["attributeName", "keyword", "DateTime", "read"],
      ["dest", "tag", "Clock[0]", "write"],
    ]);

    const ssv = describeModelOnlyInstructionReview(
      registry.get("SSV"),
      node("SSV", [
        ["className", "PROGRAM", "literal"],
        ["instanceName", "MainProgram", "literal"],
        ["attributeName", "DisableFlag", "literal"],
        ["source", "DisableValue"],
      ]),
    );
    expect(ssv?.boundaries).toEqual(expect.arrayContaining([
      "no-system-value-transfer",
      "no-controller-object-attribute-write",
    ]));
    expect(ssv?.boundaries).not.toContain("no-controller-object-attribute-read");
    expect(ssv?.runtimeEffects).toMatchObject({
      systemValueTransfer: false,
      controllerObjectAttributeWrite: false,
    });
    expect(ssv?.operands.map((operand) => [operand.name, operand.role, operand.value, operand.declaredDirection])).toEqual([
      ["className", "keyword", "PROGRAM", "read"],
      ["instanceName", "keyword", "MainProgram", "read"],
      ["attributeName", "keyword", "DisableFlag", "read"],
      ["source", "tag", "DisableValue", "read"],
    ]);
  });

  it("distinguishes process, safety, motion, alarm, phase, SFC, event, and serial boundaries", () => {
    const examples = [
      ["PID", node("PID", [["loop", "Pid01"], ["pv", "TankLevel"], ["tieback", ""], ["cv", "ValveCmd"]]), "no-process-loop-execution"],
      ["ESTOP", node("ESTOP", [["safety", "EStop01"]]), "no-safety-evaluation"],
      ["MAM", node("MAM", [["axis", "Axis_1"], ["motionControl", "MoveCtl"]]), "no-motion-command"],
      ["ALMD", node("ALMD", [["alarm", "MotorAlarm"], ["in", "MotorFault"]]), "no-alarm-evaluation"],
      ["PCMD", node("PCMD", [["phase", "Phase01"]]), "no-phase-state-engine"],
      ["SFR", node("SFR", [["sfcRoutine", "BatchSFC", "routine"]]), "no-sfc-state-engine"],
      ["EVENT", node("EVENT", [["task", "EventTask", "literal"]]), "no-asynchronous-task-or-interrupt-trigger"],
      ["AHL", node("AHL", [["channel", "SerialChannel"]]), "no-serial-port-access"],
    ] as const;

    for (const [type, ladderNode, boundary] of examples) {
      const review = describeModelOnlyInstructionReview(registry.get(type), ladderNode);
      expect(review?.boundaries, type).toContain(boundary);
      expect(review?.boundaries, type).toContain("no-runtime-tag-memory-access");
      expect(review?.notes.join(" "), type).toContain("Operand directions describe review/cross-reference roles");
    }
  });

  it("splits process review into PID loop and signal-conditioning runtime boundaries", () => {
    const pid = describeModelOnlyInstructionReview(
      registry.get("PID"),
      node("PID", [
        ["loop", "Pid01"],
        ["pv", "TankLevel"],
        ["tieback", "ValveFeedback"],
        ["cv", "ValveCmd"],
      ]),
    );

    expect(pid?.boundaries).toEqual(expect.arrayContaining([
      "no-process-loop-execution",
      "no-pid-algorithm-execution",
      "no-process-variable-sampling",
      "no-control-variable-output",
      "no-loop-update-scheduling",
      "no-process-status-or-alarm-update",
      "no-manual-cascade-or-tieback-handling",
      "no-closed-loop-tuning",
    ]));
    expect(pid?.boundaries).not.toContain("no-signal-conditioning-or-totalizer-calculation");
    expect(pid?.runtimeEffects).toMatchObject({
      processLoopExecution: false,
      pidAlgorithmExecution: false,
      processVariableSampling: false,
      controlVariableOutput: false,
      loopUpdateScheduling: false,
      processStatusOrAlarmUpdate: false,
      manualCascadeOrTiebackHandling: false,
      closedLoopTuning: false,
    });
    expect(pid?.operands.map((operand) => [operand.name, operand.declaredDirection])).toEqual([
      ["loop", "write"],
      ["pv", "read"],
      ["tieback", "read"],
      ["cv", "write"],
      ["masterLoop", "read"],
      ["inholdBit", "read"],
      ["inholdValue", "read"],
    ]);

    const totalizer = describeModelOnlyInstructionReview(registry.get("TOT"), node("TOT", [["block", "Totalizer01"]]));
    expect(totalizer?.boundaries).toEqual(expect.arrayContaining([
      "no-process-loop-execution",
      "no-loop-update-scheduling",
      "no-process-status-or-alarm-update",
      "no-closed-loop-tuning",
      "no-signal-conditioning-or-totalizer-calculation",
    ]));
    expect(totalizer?.boundaries).not.toContain("no-pid-algorithm-execution");
    expect(totalizer?.runtimeEffects).toMatchObject({
      signalConditioningOrTotalizerCalculation: false,
      pidAlgorithmExecution: false,
    });
    expect(totalizer?.operands[0]).toMatchObject({
      name: "block",
      declaredDirection: "write",
      allowedTypes: ["TOT"],
    });
  });

  it("describes AHL hardware handshaking without implying serial line or status effects", () => {
    const review = describeModelOnlyInstructionReview(
      registry.get("AHL"),
      node("AHL", [
        ["channel", "0", "literal"],
        ["andMask", "ResetMask", "tag"],
        ["orMask", "SetMask", "tag"],
        ["control", "AhlCtl", "tag"],
        ["channelStatus", "AhlStatus", "tag"],
      ]),
    );

    expect(review?.boundaries).toEqual(expect.arrayContaining([
      "no-controller-communication",
      "no-serial-port-access",
      "no-ascii-handshake-line-read",
      "no-ascii-handshake-line-write",
      "no-ascii-handshake-mask-application",
      "no-serial-control-status-update",
    ]));
    expect(review?.runtimeEffects).toMatchObject({
      controllerCommunication: false,
      serialPortAccess: false,
      asciiHandshakeLineRead: false,
      asciiHandshakeLineWrite: false,
      asciiHandshakeMaskApplication: false,
      serialControlStatusUpdate: false,
    });

    // The serial-port offline guarantee is keyed off the AHL instruction type,
    // not its description text, so it survives wording changes to the def.
    const ahlWithoutSerialPortInDescription = describeModelOnlyInstructionReview(
      { ...registry.get("AHL")!, description: "Read/set handshake lines" },
      node("AHL", [["channel", "0", "literal"]]),
    );
    expect(ahlWithoutSerialPortInDescription?.boundaries).toContain("no-serial-port-access");
    expect(review?.operands.map((operand) => [
      operand.name,
      operand.role,
      operand.value,
      operand.declaredDirection,
      operand.allowedTypes,
    ])).toEqual([
      ["channel", "literal", "0", "read", ["DINT", "REAL"]],
      ["andMask", "tag", "ResetMask", "read", ["DINT", "REAL"]],
      ["orMask", "tag", "SetMask", "read", ["DINT", "REAL"]],
      ["control", "tag", "AhlCtl", "write", ["CONTROL"]],
      ["channelStatus", "tag", "AhlStatus", "write", ["DINT", "REAL"]],
    ]);
  });

  it("splits alarm review into condition, status, latch/acknowledge, and timing boundaries", () => {
    for (const [type, backingType] of [
      ["ALMA", "ALARM_ANALOG"],
      ["ALMD", "ALARM_DIGITAL"],
    ] as const) {
      const review = describeModelOnlyInstructionReview(
        registry.get(type),
        node(type, [["alarm", "MotorAlarm"], ["in", "MotorFault"]]),
      );

      expect(review?.boundaries, type).toEqual(expect.arrayContaining([
        "no-alarm-evaluation",
        "no-alarm-condition-evaluation",
        "no-alarm-status-update",
        "no-alarm-latch-or-acknowledge",
        "no-alarm-deadband-or-delay-timing",
      ]));
      expect(review?.runtimeEffects, type).toMatchObject({
        alarmEvaluation: false,
        alarmConditionEvaluation: false,
        alarmStatusUpdate: false,
        alarmLatchOrAcknowledge: false,
        alarmDeadbandOrDelayTiming: false,
      });
      // The owned alarm tag is a write review operand; the input stays a read.
      expect(review?.operands.map((operand) => [operand.name, operand.declaredDirection]), type).toEqual([
        ["alarm", "write"],
        ["in", "read"],
      ]);
      expect(review?.operands[0]?.allowedTypes, type).toEqual([backingType]);
      // Alarm blocks never touch the message/motion/process runtimes.
      expect(review?.boundaries, type).not.toContain("no-motion-command");
      expect(review?.boundaries, type).not.toContain("no-pid-algorithm-execution");
    }
  });

  it("splits phase review into command, failure, ownership, and external-request boundaries", () => {
    for (const [type, granular] of [
      ["PSC", "no-phase-command-dispatch"],
      ["PCMD", "no-phase-command-dispatch"],
      ["POVR", "no-phase-command-dispatch"],
      ["PPD", "no-phase-command-dispatch"],
      ["PFL", "no-phase-failure-handling"],
      ["PCLF", "no-phase-failure-handling"],
      ["PATT", "no-phase-ownership-arbitration"],
      ["PDET", "no-phase-ownership-arbitration"],
      ["PXRQ", "no-phase-external-request"],
      ["PRNP", "no-phase-external-request"],
    ] as const) {
      const review = describeModelOnlyInstructionReview(registry.get(type), node(type, []));
      // Every phase block keeps the umbrella state-engine boundary...
      expect(review?.boundaries, type).toContain("no-phase-state-engine");
      // ...plus exactly the one granular slice for its phase.ts section.
      expect(review?.boundaries, type).toContain(granular);
      const phaseGranular = [
        "no-phase-command-dispatch",
        "no-phase-failure-handling",
        "no-phase-ownership-arbitration",
        "no-phase-external-request",
      ].filter((boundary) => review?.boundaries.includes(boundary as never));
      expect(phaseGranular, type).toEqual([granular]);
      expect(review?.runtimeEffects, type).toMatchObject({
        phaseStateEngine: false,
        phaseCommandDispatch: false,
        phaseFailureHandling: false,
        phaseOwnershipArbitration: false,
        phaseExternalRequest: false,
      });
      // Phase blocks never touch the alarm/motion/process runtimes.
      expect(review?.boundaries, type).not.toContain("no-alarm-evaluation");
      expect(review?.boundaries, type).not.toContain("no-motion-command");
    }
  });

  it("splits SFC review into step-reset, chart-pause, and transition-marking boundaries", () => {
    for (const [type, ladderNode, granular] of [
      ["SFR", node("SFR", [["sfcRoutine", "BatchSFC", "routine"]]), "no-sfc-step-reset"],
      ["SFP", node("SFP", [["sfcRoutine", "BatchSFC", "routine"]]), "no-sfc-chart-pause"],
      ["EOT", node("EOT", [["bit", "TransDone"]]), "no-sfc-transition-marking"],
    ] as const) {
      const review = describeModelOnlyInstructionReview(registry.get(type), ladderNode);
      // Every SFC block keeps the umbrella state-engine boundary...
      expect(review?.boundaries, type).toContain("no-sfc-state-engine");
      expect(review?.fidelityStatus, type).toBe("review-only");
      // ...plus exactly the one granular slice for its sfc.ts section.
      expect(review?.boundaries, type).toContain(granular);
      const sfcGranular = [
        "no-sfc-step-reset",
        "no-sfc-chart-pause",
        "no-sfc-transition-marking",
      ].filter((boundary) => review?.boundaries.includes(boundary as never));
      expect(sfcGranular, type).toEqual([granular]);
      expect(review?.runtimeEffects, type).toMatchObject({
        sfcStateEngine: false,
        sfcStepReset: false,
        sfcChartPause: false,
        sfcTransitionMarking: false,
      });
      // SFC blocks never touch the phase/alarm/motion runtimes.
      expect(review?.boundaries, type).not.toContain("no-phase-state-engine");
      expect(review?.boundaries, type).not.toContain("no-alarm-evaluation");
      expect(review?.boundaries, type).not.toContain("no-motion-command");
    }
  });

  it("does not project SQC as model-only now that legacy sequencer compare executes", () => {
    expect(registry.get("SQC")?.modelOnly).toBeFalsy();
    expect(
      describeModelOnlyInstructionReview(
        registry.get("SQC"),
        node("SQC", [
          ["array", "StepData[0]"],
          ["mask", "StepMask"],
          ["source", "Inputs"],
          ["control", "SeqCtl"],
          ["length", "8"],
        ]),
      ),
    ).toBeUndefined();
  });

  it("splits model-only motion review into planner, axis, drive, and feedback boundaries", () => {
    const review = describeModelOnlyInstructionReview(
      registry.get("MAM"),
      node("MAM", [["axis", "Axis_1"], ["motionControl", "MoveCtl"]]),
    );

    expect(review?.boundaries).toEqual(expect.arrayContaining([
      "no-motion-command",
      "no-motion-planner-execution",
      "no-axis-state-update",
      "no-drive-command",
      "no-motion-feedback",
    ]));
    expect(review?.runtimeEffects).toMatchObject({
      motionCommand: false,
      motionPlannerExecution: false,
      axisStateUpdate: false,
      driveCommand: false,
      motionFeedback: false,
    });
    expect(review?.operands.map((operand) => [operand.name, operand.declaredDirection])).toEqual([
      ["axis", "write"],
      ["motionControl", "write"],
    ]);
  });

  it("marks coordinated and group motion as non-executing coordinate/group review", () => {
    const coordinated = describeModelOnlyInstructionReview(
      registry.get("MCLM"),
      node("MCLM", [["coordinateSystem", "CoordSys"], ["motionControl", "PathCtl"]]),
    );
    expect(coordinated?.boundaries).toEqual(expect.arrayContaining([
      "no-coordinate-system-transform",
      "no-motion-group-coordination",
    ]));
    expect(coordinated?.runtimeEffects).toMatchObject({
      coordinateSystemTransform: false,
      motionGroupCoordination: false,
    });

    const group = describeModelOnlyInstructionReview(
      registry.get("MGS"),
      node("MGS", [["motionGroup", "MotionGroup"], ["motionControl", "GroupCtl"]]),
    );
    expect(group?.boundaries).toContain("no-motion-group-coordination");
    expect(group?.boundaries).not.toContain("no-coordinate-system-transform");
  });

  it("marks cam, gear, and motion event blocks as review-only side effects", () => {
    const gear = describeModelOnlyInstructionReview(registry.get("MAG"), node("MAG", [["slaveAxis", "Slave"]]));
    const outputCam = describeModelOnlyInstructionReview(registry.get("MAOC"), node("MAOC", [["axis", "Axis_1"]]));
    const watch = describeModelOnlyInstructionReview(registry.get("MAW"), node("MAW", [["axis", "Axis_1"]]));

    // MCSV and MCCP calculate against the cam — they assert the same guarantee.
    const slaveValues = describeModelOnlyInstructionReview(registry.get("MCSV"), node("MCSV", [["axis", "Axis_1"]]));
    const calcCamProfile = describeModelOnlyInstructionReview(
      registry.get("MCCP"),
      node("MCCP", [["motionControl", "CamCtl"]]),
    );

    expect(gear?.boundaries).toContain("no-cam-or-gear-evaluation");
    expect(slaveValues?.boundaries).toContain("no-cam-or-gear-evaluation");
    expect(calcCamProfile?.boundaries).toContain("no-cam-or-gear-evaluation");
    expect(calcCamProfile?.boundaries).not.toContain("no-coordinate-system-transform");
    expect(calcCamProfile?.runtimeEffects).toMatchObject({ camOrGearEvaluation: false });
    expect(outputCam?.boundaries).toEqual(expect.arrayContaining([
      "no-cam-or-gear-evaluation",
      "no-motion-event-watch-or-registration",
    ]));
    expect(watch?.boundaries).toContain("no-motion-event-watch-or-registration");
    expect(watch?.boundaries).not.toContain("no-cam-or-gear-evaluation");
  });

  it("marks missing required operands and keeps undeclared trailing operands as review data", () => {
    const review = describeModelOnlyInstructionReview(
      registry.get("MCT"),
      node("MCT", [
        ["coordinateSystem", ""],
        ["transformDim", "2", "literal"],
      ]),
    );

    expect(review?.operands[0]).toMatchObject({
      name: "coordinateSystem",
      required: true,
      missing: true,
      declared: true,
      declaredDirection: "write",
    });
    expect(review?.operands[1]).toMatchObject({
      name: "transformDim",
      label: "transformDim",
      value: "2",
      role: "literal",
      declared: false,
      missing: false,
      declaredDirection: "read",
    });
  });
});
