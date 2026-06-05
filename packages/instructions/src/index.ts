import { InstructionRegistry } from "./registry";
import { ONS, OSF, OSR, OTE, OTL, OTU, XIC, XIO } from "./bit";
import { CTD, CTU, RES, RTO, TOF, TON } from "./timer-counter";
import { COMPARE_ALIAS_INSTRUCTIONS, EQU, GEQ, GRT, LEQ, LES, MOV, MOVE, NEQ } from "./move-compare";
import { ADD, DIV, MUL, SUB } from "./math";
import { ABS, AND, CLR, CMP, CPT, DCD, DTR, ENC, LIM, LIMIT, MEQ, MOD, NEG, NOT, OR, SQR, XOR } from "./compute";
import { MATH_EXTENDED_INSTRUCTIONS } from "./math-extended";
import { BOOLEAN_LOGIC_INSTRUCTIONS } from "./boolean-logic";
import { MODEL_ONLY_EXTENDED_INSTRUCTIONS } from "./model-only-extended";
import { FBD_ONE_SHOT_INSTRUCTIONS } from "./fbd-one-shot";
import { COP, CPS, FLL, MVM, MVMT } from "./data-movement";
import { BCD_TO, BRK, BTD, BTDT, FOR, FRD, JMP, LBL, MCR, SWPB, TND, TOD, TO_BCD } from "./conversion-control";
import { SQL, SQC, SQI, SQO } from "./sequencer";
import { BSL, BSR } from "./shift";
import { ADVANCED_MODEL_ONLY } from "./advanced";
import { PROCESS_INSTRUCTIONS } from "./process";
import { SAFETY_INSTRUCTIONS } from "./safety";
import { PHASE_INSTRUCTIONS } from "./phase";
import { SFC_INSTRUCTIONS } from "./sfc";
import { FILE_ARRAY_INSTRUCTIONS } from "./file-array";
import { FILE_BIT_COMPARE_INSTRUCTIONS } from "./file-bit-compare";
import { STRING_ASCII_INSTRUCTIONS } from "./string-ascii";
import { AFI, IOT, NOP } from "./program-control";
import { JSR, RET, SBR } from "./routine-control";

export * from "./types";
export * from "./registry";
export * from "./operands";
export * from "./operand-path";
export * from "./infer-tag-type";
export * from "./model-only-review";
export * from "./expression";
export * from "./bit";
export * from "./timer-counter";
export * from "./move-compare";
export * from "./math";
export * from "./compute";
export * from "./math-extended";
export * from "./boolean-logic";
export * from "./model-only-extended";
export * from "./fbd-one-shot";
export * from "./data-movement";
export * from "./conversion-control";
export * from "./sequencer";
export * from "./shift";
export * from "./advanced";
export * from "./process";
export * from "./safety";
export * from "./phase";
export * from "./sfc";
export * from "./file-array";
export * from "./file-bit-compare";
export * from "./string-ascii";
export * from "./program-control";
export * from "./routine-control";

/** Default registry seeded with the supported instruction set. */
export function createDefaultRegistry(): InstructionRegistry {
  const registry = new InstructionRegistry();
  for (const def of [
    XIC, XIO, OTE, OTL, OTU, ONS, OSR, OSF,
    TON, TOF, RTO, CTU, CTD, RES,
    MOV, MOVE, EQU, GRT, LES, NEQ, LEQ, GEQ,
    ...COMPARE_ALIAS_INSTRUCTIONS,
    ADD, SUB, MUL, DIV,
    AND, OR, XOR, NOT, DCD, ENC, MOD, SQR, NEG, ABS, CPT, CMP, CLR, LIM, LIMIT, MEQ, DTR,
    ...MATH_EXTENDED_INSTRUCTIONS,
    ...BOOLEAN_LOGIC_INSTRUCTIONS,
    COP, CPS, FLL, MVM, MVMT,
    TOD, FRD, TO_BCD, BCD_TO, BTD, BTDT, SWPB,
    SQO, SQI, SQC, SQL,
    BSL, BSR,
    JSR, SBR, RET,
    NOP, AFI, IOT,
    TND, JMP, LBL, MCR, BRK, FOR,
    ...FILE_ARRAY_INSTRUCTIONS,
    ...FILE_BIT_COMPARE_INSTRUCTIONS,
    ...STRING_ASCII_INSTRUCTIONS,
    ...FBD_ONE_SHOT_INSTRUCTIONS,
    ...ADVANCED_MODEL_ONLY,
    ...PROCESS_INSTRUCTIONS,
    ...SAFETY_INSTRUCTIONS,
    ...PHASE_INSTRUCTIONS,
    ...SFC_INSTRUCTIONS,
    ...MODEL_ONLY_EXTENDED_INSTRUCTIONS,
  ]) {
    registry.register(def);
  }
  return registry;
}
