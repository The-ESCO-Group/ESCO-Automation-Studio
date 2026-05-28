export type Selection =
  | { kind: "controller"; id: string }
  | { kind: "program"; id: string }
  | { kind: "routine"; id: string }
  | { kind: "tag"; id: string }
  | { kind: "rung"; routineId: string; rungId: string }
  | { kind: "instruction"; routineId: string; rungId: string; nodeId: string }
  | null;
